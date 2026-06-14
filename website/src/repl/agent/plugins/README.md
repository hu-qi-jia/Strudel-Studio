# Agent Features (internal extension framework)

This folder is how a **developer** adds new capabilities to the agent (e.g. the bundled
`mp3-analyzer`). It is an **internal, build-time framework** — end users never see the word
"plugin" and never enable or authorize anything. Registered features are treated as built-in
agent abilities: their tools are always available, their upload buttons always render.

> The framework files live one level up: `../ToolRegistry.mjs` (registry + manifest
> validation), `../ToolContext.mjs` (capability-scoped context), `../attachments.mjs`
> (the attachment session API). Read those headers for the authoritative detail.

## Mental model

1. You write a **manifest** describing your feature: the tools it adds, the capabilities
   those tools need, and optional UI hooks (a chat upload button, a result renderer).
2. You register it in `./index.mjs`.
3. You rebuild. From the user's perspective, your feature is just part of the agent.

There is **no enable/disable toggle and no permission-grant UI**. Every registered feature is
on by default. Capability-scoping (`ToolContext`) still runs internally — each tool receives a
least-privilege `ctx` containing only the capabilities it declared in `requires`. That keeps the
architecture safe without burdening users with a consent ceremony for local, in-browser work.

## The manifest (`AgentFeature`)

```ts
{
  id: string;                 // unique, kebab-case, e.g. "mp3-analyzer"
  version: string;            // free-form, e.g. "0.1.0"
  description?: string;       // one-line English summary (shown to maintainers, not users)

  permissions: Array<{        // declarative: what this feature WANTS (informational + docs)
    capability: string;       //   one of the capability names below
    reason: string;           //   English human-readable why
  }>;

  tools: Array<{
    name: string;             // GLOBALLY unique across all features (see "Tool-name uniqueness")
    description: string;      // English — this is what the LLM reads to decide when to call it
    inputSchema: object;      // jsonSchema(...) from 'ai'
    requires: string[];       // capabilities this tool needs; it gets exactly these on ctx
    execute: async (input, ctx) => any;   // return a plain object (kept as resultData) or a string
  }>;

  ui?: {
    chatInputActions?: Array<{ id: string; label: string; accept?: string; icon?: string }>;
    renderers?: { [toolName: React.Component] };  // keyed by tool name; reads invocation.resultData
  };
}
```

`register()` validates the manifest structure **and** checks tool-name uniqueness at app load,
so a malformed or colliding feature fails fast with a precise error — not silently at runtime.

## Capabilities

A tool's `requires` controls which facets appear on its `ctx`. Available capabilities:

| Capability | `ctx` facet | What it gives |
|---|---|---|
| `editor:read` | `ctx.editor` | `read()` → current editor code (string) |
| `sounds:query` | `ctx.sounds` | `query(filter)`, `get(name)` against the sound registry |
| `attachments:read` | `ctx.attachments` | `read(handleId)` → ArrayBuffer, `meta(handleId)`, `list()` |
| `audio:decode` | `ctx.audio` | `decode(buf)` → `getAudioContext().decodeAudioData(buf)` (no playback, no context swap) |
| `net:fetch` | `ctx.net` | `fetch(url, opts)` restricted to a per-feature domain allowlist, `credentials:'omit'` |

Notes:
- There is **no `editor:write`** for features. To change code, return a suggestion/draft and let
  the LLM call the core `write_code` tool — that single write path runs `validateCode`, the
  dangerous-call blocklist, and auto-play validation. Reuse it; don't bypass it.
- Attachments arrive as a `handleId` in the user message (the providers layer injects a synthetic
  note). Your tool takes `handleId` as input and reads bytes via `ctx.attachments.read(handleId)`.

## Tool-name uniqueness

Tool names are global keys in the object passed to `streamText({ tools })`. Two features sharing a
name would silently overwrite. `register()` therefore **throws** on a collision, naming both
features. Convention: prefix with your feature id, e.g. `mp3_analyzer_transcribe`. (The bundled
`mp3-analyzer` uses `analyze_audio` — unique, so it passes; new features should prefer the prefix.)

## Adding a new feature

1. Create `./<your-feature>/plugin.mjs` (and any `.mjs` logic + `.jsx` renderer beside it).
2. Register it in `./index.mjs`:
   ```js
   import { toolRegistry } from '../ToolRegistry.mjs';
   import myFeature from './my-feature/plugin.mjs';
   toolRegistry.register(myFeature);
   ```
3. `pnpm astro build`. Done — the tool is live, the chat action renders, the renderer is wired.

### Skeleton

```js
// ./my-feature/plugin.mjs
import { jsonSchema } from 'ai';
import MyResultPanel from './MyResultPanel.jsx';

export default {
  id: 'my-feature',
  version: '0.1.0',
  description: 'One-line English summary.',

  permissions: [
    { capability: 'editor:read', reason: 'Read editor code to …' },
  ],

  tools: [{
    name: 'my_feature_do_thing',
    description: 'What this does and when the LLM should call it. Keep it English and specific.',
    requires: ['editor:read'],
    inputSchema: jsonSchema({
      type: 'object',
      properties: { x: { type: 'string', description: '…' } },
      required: ['x'],
    }),
    execute: async (input, ctx) => {
      const code = ctx.editor.read();        // only the required facets exist on ctx
      // …do work…
      return { ok: true, summary: '…', detail: code.length };
      // Return an OBJECT to keep structured data (rendered by your renderer via resultData).
      // Return a STRING for a plain error/notice (falls back to the default tool badge).
    },
  }],

  ui: {
    chatInputActions: [{ id: 'my-action', label: 'do thing', icon: '★' }],
    renderers: { my_feature_do_thing: MyResultPanel },
  },
};
```

A renderer receives `{ invocation }` and reads `invocation.resultData` (the object your `execute`
returned) and/or `invocation.result` (its stringified form). Render only when `resultData` is
present; `ChatMessage` falls back to the default badge otherwise (e.g. for string/error returns).

## Security notes & caveats

- **No runtime sandbox.** Capability-scoping limits the `ctx` handed to `execute`, but a feature's
  own bundled code has full JS access to whatever it imports. This is acceptable because features
  are first-party, reviewed, and built into the bundle. It is **not** a model for hosting
  untrusted third-party code.
- **`net:fetch` consent is a known gap.** It is auto-granted today (no feature uses it yet). If a
  future feature uses `net:fetch` to send data to a third party, add a per-action consent prompt
  ("this feature wants to send audio to X — allow?") before exposing that tool — do **not** rely on
  the current silent auto-grant for anything privacy-sensitive.
- **No runtime / end-user loading.** Features are statically imported and bundled. There is no
  marketplace, no URL install, no `import()` of remote manifests. (Dynamic loading was an explicit
  non-goal; revisit as a separate milestone if ever needed.)

## Reference implementation

`./mp3-analyzer/` is the canonical example: `plugin.mjs` (manifest), `analyzer.mjs` (logic),
`AnalysisPanel.jsx` (renderer). Read it end-to-end before writing your own.
