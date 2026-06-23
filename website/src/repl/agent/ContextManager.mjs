// ContextManager - 动态 System Prompt 构建 + 智能上下文压缩
import { soundRegistry } from './SoundRegistry.mjs';
import { $webSearchMode } from './store.mjs';
// 音乐知识语料库：从社区曲目与引擎源码提炼的编排技法 + 采样音色知识。
// 与本文件的 prompt 装配逻辑解耦，集中维护在 knowledge.mjs 便于持续「学习」扩充。
import { ARRANGEMENT_TOOLKIT, LIVING_PATTERNS, FORM_TEMPLATES, SAMPLES_GUIDE, GENRE_COOKBOOK, HARMONY_ARCHITECTURE, INSTRUMENT_RELIABILITY, COMMUNITY_TRACKS, SOUND_CHARACTER_GUIDE, MUSICAL_ANTI_PATTERNS, SELF_CRITIQUE_CHECKLIST } from './knowledge.mjs';
// 本地文档片段检索：构建期把 learn/workshop .mdx + jsdoc 切片为 docFragments.json，
// 运行时按用户消息关键词命中注入，让 agent 能参考精确语法说明。
import { matchDocFragmentsByText, buildDocKnowledgeSection } from './docKnowledge.mjs';
// 通用工具（token 估算等）。抽到 utils.mjs 避免与 docKnowledge.mjs 循环依赖。
import { estimateTextTokens } from './utils.mjs';
// re-export 保持向后兼容（其他模块可能从 ContextManager import estimateTextTokens）
export { estimateTextTokens };
// 可调参数集中在 config.mjs。DEFAULT_CONTEXT_BUDGET 是未知 provider 的回退值；
// 按 provider 动态覆盖见 providers.mjs 的 getContextBudget。
import { DEFAULT_CONTEXT_BUDGET, MAX_SYSTEM_PROMPT_TOKENS } from './config.mjs';
export { DEFAULT_CONTEXT_BUDGET };

// ─── 核心 System Prompt（始终注入，~500 tokens）──────────────

const CORE_PROMPT = `You are an expert AI assistant for Strudel, a music live-coding environment based on TidalCycles patterns.
You help users write, modify, and debug Strudel code. Always use the provided tools to read and modify the editor code.

## CORE CONCEPTS

Strudel uses **mini notation** inside strings to describe musical patterns. A pattern repeats every cycle (default 2 seconds at 30 cpm).

### Mini Notation Syntax

| Syntax | Meaning | Example |
|--------|---------|---------|
| space | sequence (evenly divide cycle) | \`"bd sd hh oh"\` |
| \`[]\` | sub-cycle (nested subdivision) | \`"bd [hh hh] sd"\` |
| \`[[]]\` | deeper nesting | \`"bd [[rim rim] hh]"\` |
| \`<>\` | alternating (one element per cycle) | \`"<bd sd hh>"\` |
| \`,\` | parallel/stack (polyphony) | \`"bd*2, hh*4"\` |
| \`*n\` | speed up / repeat n times | \`"bd*4"\` |
| \`/n\` | slow down | \`"[c a f e]/2"\` |
| \`!n\` | duplicate (no speed change) | \`"c!3 e"\` |
| \`@n\` | time weight / extend | \`"c@3 eb"\` |
| \`~\` or \`-\` | rest / silence | \`"bd ~ sd ~"\` |
| \`:n\` | select sample variant | \`"hh:0 hh:1"\` |
| \`?\` | 50% random removal | \`"bd*8?"\` |
| \`?n\` | n probability removal | \`"bd*8?0.1"\` |
| \`|\` | random choice | \`"bd | sd | hh"\` |
| \`(beats, segments)\` | Euclidean rhythm | \`"bd(3,8)"\` |

### Multi-track with $: prefix

CRITICAL: When writing multiple patterns that should play simultaneously, you MUST use \`$:\` prefix on each pattern. Without \`$:\`, only the LAST pattern will play — all previous patterns are silently overwritten.

WRONG (only last pattern plays):
\`\`\`
note("c3 e3 g3").s("piano")
s("bd sd hh oh")
\`\`\`

CORRECT (all patterns play in parallel):
\`\`\`
$: note("c3 e3 g3").s("piano")
$: s("bd sd hh oh")
\`\`\`

Use \`_$:\` to mute a track.`;

// ─── 完成契约（始终注入，最高优先级指令）──────────────────────

const COMPLETION_CONTRACT = `

## COMPLETION CONTRACT — NEVER STOP MID-TASK (HIGHEST PRIORITY)

When the user asks you to CREATE / MAKE / GENERATE / WRITE / PLAY any music, sound, beat, melody, pattern, or instrument (e.g. "给我一段鼓组", "写一段钢琴曲", "来一段节奏", "make a beat", "give me drums"), you MUST drive the task all the way to PLAYING CODE. This contract overrides any tendency to stop early.

1. **Discovery is a STEP, never the answer.** \`list_sounds\` and \`get_sound_info\` only gather information. After calling them you MUST follow up with \`write_code\` (new pattern) or \`edit_lines\` (modify existing). NEVER reply by merely listing or summarizing available sounds and then stopping — that is a failure of your task.
2. **Skip sound discovery when you already know the answer — but plan the arrangement first.** Common drums (\`bd sd hh oh cp rim rs lt mt ch\`), core synths (\`sine triangle square sawtooth supersaw\`), and \`piano\` are documented in this prompt — write the pattern directly with \`write_code\`, do not call \`list_sounds\`. Only call \`list_sounds\` when the user names a SPECIFIC unfamiliar sound. "Directly" means no unnecessary lookups, NOT "skip planning": decide your layers, velocity, swing, and panning before writing (see ARRANGEMENT & MUSICALITY).
3. **Retry on error — do not give up.** If \`write_code\` or \`edit_lines\` returns an engine error: READ the message, FIX the Strudel syntax, and call the SAME tool again. Retry up to 5 times. Never tell the user "it failed" and stop — fix it and keep going until the tool reports it is playing.
4. **Finish only with playing code + structured summary.** Stop only after a tool returns "playing successfully", then write a structured summary (see SUMMARY FORMAT below). Do NOT echo the full code unless asked.
5. **Do not pause for permission** between discovery and generation. Chain the tool calls autonomously in one turn.
6. **Self-evaluate quality before finishing (non-optional).** Once the code plays, call \`analyze_arrangement\`. If \`form\` or \`layers\` FAIL, or the score is low, you are NOT done — improve the code using the findings (add real sections with \`@N\`/\`cat\`/\`.mask\` from FORM TEMPLATES, layer more tracks, add velocity/pan/automation) and re-check until \`form\` and \`layers\` pass. For any track the user will judge by ear, also call \`analyze_pattern_audio\` ONCE after the arrangement passes, and fix any reported SILENCE or CLIPPING. Never declare a track finished while \`form\`/\`layers\` fail, or while the rendered audio is silent or clipping. The summary you give the user must honestly reflect the analyze_arrangement score.

BAD (stops after discovery — FORBIDDEN): user says "give me drums" → you call list_sounds → you reply "here are the available drums: bd, sd, hh..." → STOP.
GOOD: user says "give me drums" → you call write_code with this code:
\`\`\`
// kick — sparse heartbeat
$: s("bd ~ ~ bd ~ | bd ~ ~ ~").gain("1 0.85")
// hats — swung, accented
$: s("hh*4").swing(0.16).gain("<0.5 0.9>")
// clap — panned accent
$: s("~ ~ cp ~").jux(x => x.late(0.01))
\`\`\`
 it plays → you reply with the structured summary (see SUMMARY FORMAT).

Notice this is NOT a flat loop: tracks have different densities (sparse kick vs busy hats), velocity varies (.gain(...)), hats swing, and the clap is panned (.jux()). Match this depth for every music-generation request — a single bar of identical-velocity, dead-center hits is a failure even if it plays.`;

// ─── 按需注入的参考片段 ──────────────────────────────────────
// SUMMARY_SECTION 已合并进 WORKFLOW_SECTION 末尾（精简版），不再独立常驻。

const SOUND_REFERENCE = `

## SOUND SOURCES

CRITICAL: Only use sound names listed below. Any other name will cause "sound not found" errors.
Use the \`list_sounds\` and \`get_sound_info\` tools to discover and query available sounds dynamically.

### Synths (use with .s())
\`sine\`, \`triangle\` (alias: \`tri\`), \`square\` (alias: \`sqr\`), \`sawtooth\` (alias: \`saw\`),
\`supersaw\`, \`pulse\`, \`sbd\` (synth bass drum), \`bytebeat\`

### Noise
\`white\`, \`pink\`, \`brown\`, \`crackle\`

### ZZFX Synths
\`z_sine\`, \`z_sawtooth\`, \`z_triangle\`, \`z_square\`, \`z_tan\`, \`z_noise\`

### Piano Samples
\`.s("piano")\` — built-in piano sample library (multi-sampled, A0-C8)
\`.piano()\` — shortcut that sets \`.s("piano").release(0.1)\` with stereo pan by pitch`;

const PATTERN_FUNCTIONS = `

## PATTERN FUNCTIONS

### Creating patterns
\`s("bd sd hh oh")\` — play samples
\`note("c3 e3 g3 c4")\` — play notes (pitch)
\`n("0 2 4 7")\` — note numbers (for samples or synths)
\`freq("220 330 440")\` — frequency in Hz

### Combining patterns
\`stack(a, b)\` — play patterns simultaneously (parallel)
\`sequence(a, b)\` or \`seq(a, b)\` — play patterns in sequence
\`cat(a, b)\` — slow sequence (each takes full cycle)
\`polymeter("{a b c, x y}")\` — different cycle lengths

### Time modifiers
\`.slow(n)\` or \`/n\` — slow down by factor n
\`.fast(n)\` or \`*n\` — speed up by factor n
\`.early(n)\` — shift events earlier
\`.late(n)\` — shift events later
\`.rev()\` — reverse pattern
\`.palindrome()\` — play forward then backward
\`.iter(n)\` — rotate pattern each cycle
\`.ply(n)\` — repeat each event n times
\`.euclid(n, m)\` or \`(n,m)\` — Euclidean rhythm
\`.swing(n)\` — add swing feel

### Conditional modifiers
\`.sometimes(fn)\` — 50% chance to apply fn
\`.sometimesBy(prob, fn)\` — prob chance to apply fn
\`.often(fn)\` — 75% chance
\`.rarely(fn)\` — 25% chance
\`.degradeBy(prob)\` — randomly remove events

### Accumulation modifiers
\`.off(time, fn)\` — overlay a time-offset copy
\`.superimpose(fn)\` — overlay a modified copy
\`.stut(n, decay, time)\` — stutter effect

### Sample manipulation
\`.begin(0.5)\` — start sample at midpoint
\`.end(0.8)\` — end sample at 80%
\`.speed(2)\` — play at 2x speed
\`.cut(1)\` — cut group
\`.chop(n)\` — granular chop into n pieces

### Tonal functions
\`.scale("C:minor")\` — constrain to scale
\`.transpose(5)\` — transpose up 5 semitones
\`.chord("C^7")\` — set chord context (iReal notation: ^7/M7 not maj7; see ARRANGEMENT TOOLKIT)

### Stereo / spatial
\`.pan(0.5)\` — center (0=left, 0.5=center, 1=right)
\`.jux(fn)\` — apply fn to right channel only

### Signals (continuous modulation)
\`sine.range(100, 5000).slow(2)\` — sine wave modulation
\`tri.range(0, 1)\` — triangle wave
\`rand.range(0, 1)\` — random values
\`perlin.range(0, 1)\` — Perlin noise`;

const EFFECTS_REFERENCE = `

## EFFECTS AND CONTROLS

### Global effects (shared per orbit)
\`.room(0.7)\` — reverb amount (0-1)
\`.size(0.8)\` or \`.roomsize(0.8)\` — reverb room size
\`.delay(0.5)\` — delay amount (0-1)
\`.delaytime(0.25)\` — delay time in cycles
\`.delayfeedback(0.7)\` — delay feedback (0-1)
\`.dry(0.5)\` — dry signal
\`.orbit(2)\` — route to orbit 2

### Per-event effects
\`.gain(0.8)\` — volume (0-1)
\`.lpf(1000)\` — low-pass filter cutoff (Hz)
\`.hpf(500)\` — high-pass filter cutoff
\`.bpf(2000)\` — band-pass filter
\`.vowel('a')\` — vowel formant filter
\`.crush(8)\` — bit depth reduction
\`.distort(0.5)\` — distortion
\`.attack(0.01)\` / \`.decay(0.1)\` / \`.sustain(0.5)\` / \`.release(0.3)\` — ADSR
\`.fm(2)\` — FM synthesis ratio
\`.fshift(100)\` — frequency shifter
\`.ring(0.5)\` — ring modulation
\`.compressor(0.5)\` — compression
\`.phaser(0.5)\` — phaser rate

### Pitch glide / slide (camelCase!)
\`.slide(0.5)\` — pitch glide amount
\`.deltaSlide(0.2)\` — per-note slide delta. It is \`.deltaSlide()\`, NOT \`.slidedelta()\`. Strudel multi-word controls are camelCase.`;

const INVALID_METHODS_SECTION = `

## CRITICAL: INVALID METHODS AND FUNCTIONS

The following do NOT exist in Strudel and WILL cause runtime errors:

### Invalid method chains (do NOT use):
- \`.reverb()\` — USE \`.room(0.7).size(0.8)\` instead
- \`.echo()\` — USE \`.delay(0.5).delaytime(0.25).delayfeedback(0.7)\` instead
- \`.chorus()\` — not available
- \`.flanger()\` / \`.flange()\` — not available
- \`.limiter()\` — not available
- \`.wah()\` — not available
- \`.eq()\` — not available
- \`.distortion()\` — USE \`.distort(0.5)\` instead
- \`.bitcrusher()\` — USE \`.crush(8)\` instead
- \`.pitchShift()\` — USE \`.fshift(100)\` instead
- \`.slidedelta()\` — USE \`.deltaSlide(...)\` instead (Strudel controls are camelCase)

### Invalid standalone functions (do NOT use):
- \`play()\` — use write_code to play
- \`melody()\` — USE \`note("c3 e3 g3")\` instead
- \`synth()\` — USE \`.s("sawtooth")\` instead
- \`beat()\` / \`rhythm()\` — USE \`s("bd sd hh oh")\` instead

### Tempo functions that DO exist (don't confuse them):
\`setcps\`, \`setcpm\`, and \`.cpm()\` are all valid. The ONLY mistake is the bare form — never write \`setcps(124)\` (that is 124 cycles/second). The correct idiom is \`setcpm(124/4)\` or \`setcps(124/60/4)\`. See ARRANGEMENT TOOLKIT for details.

### Common mistakes:
- Never pass arrays to note() or s() — use mini notation strings
- Never use multi-line strings — keep all strings on a single line
- Multi-word controls are camelCase: use \`.deltaSlide()\` not \`.slidedelta()\`, \`.delayfeedback()\` not \`.delay_feedback()\`. Lowercase Tidal-style names cause "is not a function" errors.`;

const WORKFLOW_SECTION = `

## WORKFLOW — HOW TO EDIT CODE (Cursor-style)

The user's CURRENT editor code is provided below under "CURRENT EDITOR CODE". You usually do NOT need to call read_code first.

### Choose the right tool
- **Targeted change** (modify a few lines): use \`edit_lines\` (replace a line range). Precise and cheap — prefer it over a full rewrite.
- **Full rewrite / brand-new pattern**: use \`write_code\` (replaces the whole file).
- **Hear a sound before using it**: there is no separate preview tool. Write a short pattern with \`write_code\` (it auto-plays and validates), then call \`undo\` to revert. This never loses the user's code beyond a single undo.

### Every edit auto-plays and self-validates
Both editing tools (write_code / edit_lines) write the code, play it immediately, and check the engine for errors.
- If a tool returns an error, the new code was NOT played (the previous pattern continues). Read the error, fix the code, and call the tool again.
- Do not stop after an error. Always converge on working, playing code.

### After the edit
Once the code plays successfully, briefly tell the user what you changed and why (1-3 sentences). Do not dump the full code back unless they ask.

### Example: "add reverb to the piano"
1. The current code is shown below. Suppose line 1 is \`$: note("c3 e3 g3 c4").s("piano")\`.
2. Call \`edit_lines\` with start_line=1, end_line=1, new_code=\`$: note("c3 e3 g3 c4").s("piano").room(0.7).size(0.8)\`.
3. It plays automatically. Tell the user: "Added reverb (room 0.7) to the piano track."

### Sound discovery
- If user asks about sounds, use \`list_sounds\` (filter by category/type/tag/search) and \`get_sound_info\`.

### Hard rules
- Use mini notation strings for all pattern data — never pass arrays.
- Never use multi-line strings. All strings must be on a single line.
- When writing multiple patterns that should play simultaneously, you MUST use \`$:\` prefix on each pattern.

### Summary (mandatory after every task)
End your final reply with a concise summary block (under 6 lines):
---
**Summary**
- **What I did**: <1-2 sentences>
- **Tools used**: <comma-separated>
- **Result**: <1 sentence: playing successfully / error fixed / etc.>
- **Key changes**: <brief bullets for code edits; N/A for queries>
---
The summary is the LAST thing in your reply. If the task failed after all retries, say so honestly.`;

// ─── 关键词检测（支持中英文）──────────────────────────────
// 注意：\b 是 ASCII 词边界，无法匹配 CJK 字符
// 策略：英文用 \b...\b，中文直接列出（不用 \b）

const MUSICALITY_SECTION = `

## ARRANGEMENT & MUSICALITY (QUALITY STANDARD)

A *valid* pattern is not the same as a *good* one. A flat loop — every track the same length and velocity, dead-center, looping one bar forever — is a failure even when it plays. Aim for contrast, layering, and groove. This section defines what "good" means here.

### 1. Distinct role + density per track
Layer 2–4 tracks, each a different rhythmic density (sparse → busy):
- Heartbeat (kick): sparse and grounded — s("bd ~ ~ ~ | bd ~ ~ ~")
- Drive (hats / percussion): the busy layer — s("hh*4")
- Accent (clap / snare / fill): rare hits that mark the beat — s("~ ~ cp ~")
- Tonal (bass / melody): the note() content

### 2. Velocity contrast — never one flat gain
Vary loudness so the groove breathes instead of every hit identical:
- s("bd*4").gain("1 0.7 0.8 0.6")        // humanized kick
- s("hh*8").gain("<0.5 0.9>")             // accented hats (loud-soft)

### 3. Groove — break the grid
- .swing(0.16) on hats / percussion adds human feel
- .sometimes(x => x.late(0.02)) nudges selected hits off the beat

### 4. Spatial separation — give each layer its place
Don't stack everything dead-center. Keep kick and bass centered and dry; pan and add space to supporting layers:
- Drums centered; bass centered (they own the low end and the middle)
- Hats wider: s("hh*4").jux(x => x.late(0.01)).pan("<0.3 0.7>")
- Melody gets air: note("<c3 eb3 g3>").s("piano").room(0.4).size(0.8); keep the kick dry (low .room)

### 5. Section contrast ("distinction")
When the user wants contrast or distinct sections, introduce change over cycles instead of looping one bar forever — use <> alternation or .every(n, fn) for fills:
- s("hh*4").every(4, x => x.fast(2))      // fill every 4 cycles
- alternate sparse vs busy every cycle with <>

### Self-check before you finish (a flat loop fails this)
1. Do the tracks have different densities?
2. Is there velocity variation?
3. Are layers panned / spatially separated?
4. Is there at least one change over time?
5. **Does it have MACRO form** — sections that change over many cycles (intro/verse/chorus via \`@N\` holds, \`pickRestart\`, \`.mask\`, or \`cat\`), not one bar looped forever?
6. **Does at least one sustained layer BREATHE** — a moving parameter (filter sweep, gain swell, pan drift) via a signal pattern, not a dead-constant value?
7. **Do all chosen sounds actually load here?** Previewed any GM name or drum-machine bank; fell back to a synth if one failed?
Aim for "yes" on all. If 5, 6, or 7 are "no", it is not production-grade yet — add form, automate a layer, or swap a dead sound before you stop.`;

const KEYWORD_PATTERNS = {
  needsPatternFunctions: /\b(pattern|function|slow|fast|rev|every|sometimes|stack|sequence|euclid|swing|struct|degrade|stut|off|superimpose|layer|chop|striate|scale|chord|transpose|pan|jux|signal|sine|tri|rand|perlin|piece|music|song|melody|composition|generate|create|write|compose)\b|曲子|旋律|节奏|和弦|生成|创作|编写|乐曲|伴奏|节拍|循环|模式/i,
  needsEffects: /\b(effect|reverb|delay|filter|lpf|hpf|bpf|distort|crush|compressor|phaser|vowel|attack|release|sustain|decay|fm|ring|gain|room|size)\b|效果|混响|延迟|滤波|失真|压缩|回声/i,
  needsSounds: /\b(sound|sample|drum|bank|synth|piano|gm_|sine|triangle|square|sawtooth|supersaw|zzfx|vcsl|instrument|tone|audio|play|music|beat|melody)\b|钢琴|鼓|音乐|音色|采样|合成器|声音|喇叭|吉他|贝斯|琴|弦乐|木管|铜管|打击|人声|合唱/i,
  // 流派/曲风/速度 → 注入流派编排骨架，让 agent 产出「完整作品」而非单一 loop
  needsGenreCookbook: /\b(house|techno|trap|lofi|lo-fi|hip ?hop|hiphop|ambient|drum ?and ?bass|\bdnb\b|synthwave|disco|funk|funky|jazz|reggae|dubstep|trance|edm|electro|soul|r&b|rnb|ballad|waltz|drum ?n ?bass|cover|remix|genre|style|tempo|bpm|complete|full ?song|full ?track|arrangement)\b|浩室|科技舞曲|陷阱|低保真|嘻哈|氛围|迪斯科|放克|爵士|雷鬼|电子|舞曲|风格|曲风|速度|完整|整首|编排|改编|翻唱/i,
  // 和声/琶音/复刻 → 注入和声架构（chord 字典 + arp 模块化 + voicing + 调式漂移）
  needsHarmony: /\b(chord|voicing|arp|arpeggio|progression|harmony|harmonic|pad|cover|remix)\b|和弦|和声|琶音|进行|复刻|翻唱|改编|配和声|织体/i,
  // 社区曲目/案例/教程/clone/完整曲目 → 注入社区曲目知识库 + fetch_song 工具指引
  // 触发面广：用户要"完整曲目/做首歌/cover/案例"时都应注入，让 agent 主动用 fetch_song 拉取社区曲目学习结构
  needsCommunityTracks: /\b(cover|remix|example|tutorial|clone|repo|github|awesome.strudel|eefano|terryds|song.?collection|learn from|reference track|complete|full ?song|full ?track|make.*song|make.*track|create.*song|create.*track|write.*song|社区|案例|教程|学习|参考曲目|完整|整首|做首|写首|来首)\b/i,
};

// 代码风格硬性约束（常驻）：注释简洁、专业、纯 ASCII，禁止 emoji。
// 作为 prompt 指引——配合 tools.mjs 的 stripEmojis 兜底，双保险。
const CODE_STYLE_SECTION = `

## CODE STYLE — COMMENTS & EMOJI
- **Add a short comment BEFORE every \`$:\` track identifying its role/instrument.** This is mandatory — it helps the user read the arrangement at a glance. Example:
  \`\`\`
  // kick — 808, euclidean 3,8
  $: s("bd(3,8)").bank("RolandTR808").gain(0.95).cpm(35)
  // snare — 808, backbeat
  $: s("~ sd ~ sd").bank("RolandTR808").gain(0.7).room(0.25).cpm(35)
  // hats — 808, swung 8ths
  $: s("hh*8").bank("RolandTR808").swing(0.15).gain(0.5).cpm(35)
  // chords — triangle pad, C minor
  $: note("<[c5 eb5 g5 bb5] [f5 ab5 c6 eb6]>/2").s("triangle").room(0.8).gain(0.4).cpm(35)
  // bass — triangle sub, root movement
  $: note("<c2 [c2 g2] f2 [eb2 bb1]>/2").s("triangle").lpf(500).gain(0.85).cpm(35)
  \`\`\`
  The comment goes on its OWN line above the \`$:\` line. Keep it short: role + key detail (sound bank, rhythm, pitch, etc.).
- When you do comment, keep it short, professional, and **plain ASCII English**.
- **NEVER put emoji, pictographs, or any non-ASCII symbols in the code or comments.** This is a hard rule.
- **When using custom samples via \`samples()\`, ALSO add a comment on the same line marking each sample name and its source.** Example:
  \`\`\`
  samples({
    vox: 'vox_chorus.wav', // vocal sample — Grimes Music 4 Machines
    bd: 'kick/bd_01.wav',  // kick drum — custom pack
  }, 'https://raw.githubusercontent.com/user/repo/main/samples/');
  \`\`\`
  This helps users identify what each sample is and where it came from.`;

// 常驻段一次性拼接（模块加载时）：只保留行为契约与核心工作流（4 段，~1.2k token）。
// 知识类段落（PATTERN_FUNCTIONS / EFFECTS_REFERENCE / MUSICALITY / ARRANGEMENT_TOOLKIT /
// LIVING_PATTERNS / FORM_TEMPLATES / INVALID_METHODS / INSTRUMENT_RELIABILITY）改为按需注入
// （见 buildSystemPrompt 的关键词触发），简单问题不再背 3k+ token 知识库。
// 此前 12 段常驻 ~3.5k token，既慢又使前缀无法被提供商缓存，且违背「简单问题 ~500 token」目标。
// export 供 engine.mjs 做 Anthropic prompt caching——STATIC_PREFIX 在请求间不变，
// 打上 cacheControl 后 Anthropic 会缓存这段 ~1.2k token，后续请求命中缓存省 90% 输入 token。
export const STATIC_PREFIX = [
  CORE_PROMPT,
  CODE_STYLE_SECTION,
  COMPLETION_CONTRACT,
  WORKFLOW_SECTION,
].join('');

// ─── ContextManager ──────────────────────────────────────────

export class ContextManager {
  /**
   * 动态构建 System Prompt
   * 根据用户消息内容按需注入参考片段，减少 token 消耗
   */
  buildSystemPrompt(userMessage, { messages = [], currentCode = '' } = {}) {
    // ─── 注入优先级（高 → 低）──────────────────────────────────
    // 1. STATIC_PREFIX（CORE_PROMPT + CODE_STYLE + COMPLETION_CONTRACT + WORKFLOW）— 不可裁
    // 2. 按需 knowledge 段（SOUND_REFERENCE / PATTERN_FUNCTIONS / EFFECTS / GENRE / HARMONY / COMMUNITY）
    //    — 人工提炼，高信噪比，整段注入不裁剪
    // 3. docKnowledge 片段 — 文档原文切片，最低优先级，超预算时第一个被跳过
    //    （模型有训练数据兜底，缺文档片段不致命；缺 knowledge 段则可能用错 API）
    // 4. CURRENT EDITOR CODE — 不可裁（agent 需要看到当前代码才能编辑）
    //
    // knowledge 与 docKnowledge 的分工：
    // - knowledge = 「怎么做」：编排技法、流派骨架、和声理论（人工提炼，教 agent 怎么写好音乐）
    // - docKnowledge = 「API 是什么」：函数签名、参数说明、语法示例（文档原文，教 agent API 细节）
    // 两者互补不互斥——用户问"加混响"时，knowledge 告诉 agent .room().size() 的用法，
    // docKnowledge 补充 learn/effects 文档里的完整参数表和示例。
    let prompt = STATIC_PREFIX;

    // 联网提示：read_web / wiki 由 web-research 插件提供（零配置，浏览器直连，无需用户配置）。
    // $webSearchMode 由对话框左侧 🌐 按钮切换：开启时指示 agent 本轮优先联网查。
    const webMode = $webSearchMode.get();
    prompt += `

## WEB TOOLS (optional, zero-config)
${webMode
  ? '**WEB MODE IS ON — the user asked to go online this turn.** Before writing the pattern, proactively call `wiki({ query })` for the main genre/style/artist the user mentioned, and `read_web({ url })` if they pasted a link. Only skip the lookup if the request is purely about editing existing code.'
  : 'You already know most artist styles and genres from training — for "make it sound like X" requests, usually just write the pattern directly.'}
- \`wiki({ query })\` — look up a concise Wikipedia summary of a genre/technique/artist (e.g. "phonk", "IDM").
- \`read_web({ url })\` — read the content of a SPECIFIC page the user pasted (article, tutorial, Reddit/GitHub thread, docs) and base the pattern on it.
- \`fetch_song({ name?, genre? })\` — pull a REAL complete Strudel song from the curated song-library (65 community tracks) to use as a structural reference. Call with no args to browse by genre, or with a name to get its full code. Use it when the user wants a specific style or a cover, or asks for a complete reference track — then ADAPT (change notes, swap to locally-loadable sounds, retune tempo), never paste verbatim.
Do not invent URLs. Never use these as a substitute for write_code — after reading, you still MUST call write_code to make sound.`;

    // 多轮上下文决策：基于最近 N 轮消息 + 当前消息，避免中途丢失参考。
    const recentText = this._collectRecentText(messages, userMessage);
    const needsSounds = KEYWORD_PATTERNS.needsSounds.test(recentText);
    const needsGenreCookbook = KEYWORD_PATTERNS.needsGenreCookbook.test(recentText);
    const needsHarmony = KEYWORD_PATTERNS.needsHarmony.test(recentText);
    // 新增：模式函数与效果器知识按需注入（原先常驻 STATIC_PREFIX，现瘦身移出）
    const needsPatternFunctions = KEYWORD_PATTERNS.needsPatternFunctions.test(recentText);
    const needsEffects = KEYWORD_PATTERNS.needsEffects.test(recentText);
    const msgLen = (userMessage || '').length;

    // 音色库 + 动态摘要：按需注入（摘要较大，无需音色时不注入省 token）。
    // 触发条件：含音色关键词、或含曲风关键词（生成流派曲目必然要选乐器/鼓机）、
    // 或很短的模糊消息（无法判断意图，保守注入避免漏掉音色线索）。
    const wantSounds = needsSounds || needsGenreCookbook || (msgLen > 0 && msgLen < 15);
    if (wantSounds) {
      prompt += SOUND_REFERENCE;
      // 采样音色识别：鼓机音色库 / GM 音色命名 / github 自定义采样包加载。
      // 与 SOUND_REFERENCE 同条件注入——它们一起构成「音色知识」全集。
      prompt += SAMPLES_GUIDE;
      // 音色特征与选音指南：每个音色听起来什么样、什么流派该用什么音色。
      // 让 agent 像有经验的制作人一样选音色，而非随机挑名字。
      prompt += SOUND_CHARACTER_GUIDE;
      prompt += '\n\n' + soundRegistry.generateSummary();
      // 乐器可靠性表：音色相关时才注入（原先常驻，现按需）
      prompt += INSTRUMENT_RELIABILITY;
    }

    // 模式函数参考：命中 pattern/function/euclid/swing 等关键词时注入。
    // 简单的「加个鼓」不需要完整函数字典——write_code 的 description 已含最小集。
    if (needsPatternFunctions) {
      prompt += PATTERN_FUNCTIONS;
    }

    // 效果器参考 + 无效方法表：命中 effect/reverb/delay/filter 等时注入。
    // INVALID_METHODS 与 EFFECTS_REFERENCE 同条件——用户要效果时才需要知道哪些不能用。
    // codeGuard.mjs 运行时仍会拦截，这里只是 prompt 层提前告知减少往返。
    if (needsEffects) {
      prompt += EFFECTS_REFERENCE;
      prompt += INVALID_METHODS_SECTION;
    }

    // 流派编排骨架 + 编排质量标准 + 活体模式 + 曲式模板：命中曲风/风格/速度关键词时注入。
    // 这四段构成「完整作品」知识全集，只在用户要完整曲目/流派时才需要。
    if (needsGenreCookbook) {
      prompt += GENRE_COOKBOOK;
      prompt += MUSICAL_ANTI_PATTERNS;
      prompt += SELF_CRITIQUE_CHECKLIST;
      prompt += MUSICALITY_SECTION;
      prompt += ARRANGEMENT_TOOLKIT;
      prompt += LIVING_PATTERNS;
      prompt += FORM_TEMPLATES;
    }

    // 和声架构：命中和弦/琶音/voicing/进行/复刻/翻唱 关键词时注入。chord 字典 + arp
    // 模块化 + voicing + 调式漂移——复刻与和声密集型作品才需要，故按需注入省 token。
    if (needsHarmony) {
      prompt += HARMONY_ARCHITECTURE;
    }

    // 社区曲目知识库：命中 cover/remix/example/clone/tutorial/repo 等关键词时注入。
    // 包含从 awesome-strudel + strudel-songs-collection 提炼的 10 大编排技法模板，
    // 以及 fetch_song / browse_repo / fetch_example 工具的使用指引（分工见知识段内说明）。
    const needsCommunityTracks = KEYWORD_PATTERNS.needsCommunityTracks.test(recentText);
    if (needsCommunityTracks) {
      prompt += COMMUNITY_TRACKS;
    }

    // 本地文档片段注入：从 learn/workshop .mdx + jsdoc/doc.json 切片中按关键词命中
    // 检索相关章节，让 agent 能参考精确语法说明（API 名称、参数、示例代码）。
    // 与 knowledge.mjs 的区别：knowledge 是人工提炼的技法，docFragments 是文档原文切片。
    // 复用上方已计算的 recentText（含当前消息 + 最近 6 轮），避免重复收集。
    //
    // Token 预算守卫：docKnowledge 是最低优先级的可裁剪段（模型有训练数据兜底）。
    // 如果当前 prompt 已接近 MAX_SYSTEM_PROMPT_TOKENS，跳过 docKnowledge 注入。
    const docMatches = matchDocFragmentsByText(recentText);
    if (docMatches.length > 0) {
      const docSection = buildDocKnowledgeSection(docMatches);
      const docTokens = estimateTextTokens(docSection);
      const currentTokens = estimateTextTokens(prompt);
      // 预留编辑器代码空间（~500 token）+ docSection 自身
      if (currentTokens + docTokens + 500 <= MAX_SYSTEM_PROMPT_TOKENS) {
        prompt += docSection;
      }
      // 超预算则跳过——模型有训练数据兜底，不会致命
    }

    // 注入当前编辑器代码（省去 read_code 往返，Cursor 式）
    if (currentCode != null && currentCode.length > 0) {
      prompt += `\n\n## CURRENT EDITOR CODE\nThis is the user's current code (snapshot at send time; call read_code if it may be stale after several edits). Line numbers are 1-based.\n\`\`\`\n${currentCode}\n\`\`\``;
    } else {
      prompt += `\n\n## CURRENT EDITOR CODE\nThe editor is currently empty. To create a pattern, call write_code.`;
    }

    // 最终 token 上限守卫：如果总 prompt 仍超限（编辑器代码很长的情况），
    // 截断编辑器代码尾部，保留 STATIC_PREFIX + 按需知识 + 代码开头。
    const finalTokens = estimateTextTokens(prompt);
    if (finalTokens > MAX_SYSTEM_PROMPT_TOKENS) {
      // 按 token 比例截断，留 200 token 给结尾标记
      const ratio = (MAX_SYSTEM_PROMPT_TOKENS - 200) / finalTokens;
      const cutLen = Math.floor(prompt.length * ratio);
      prompt = prompt.slice(0, cutLen) + '\n\n[... prompt truncated to fit token budget]';
    }

    return prompt;
  }

  // 收集最近 N 轮消息的文本（含当前消息），用于多轮关键词决策
  _collectRecentText(messages, userMessage) {
    const parts = [];
    const recent = Array.isArray(messages) ? messages.slice(-6) : [];
    for (const m of recent) {
      if (typeof m.content === 'string' && m.content) parts.push(m.content);
    }
    if (userMessage) parts.push(userMessage);
    return parts.join('\n');
  }

  /**
   * 智能上下文压缩
   * 基于滑动窗口保留最近消息，同时保护工具调用对的完整性
   *
   * 关键不变量：永远保留最近一条 user 消息（当前轮的用户请求）。
   * 如果它被丢弃，模型不知道用户要什么 → 不写码 → 催办再试 → 还是不知道
   * → 循环耗尽 MAX_CONTINUATIONS → 任务中断（用户需重复提问）。
   * 即使超预算也强制保留它——多几百 token 远比丢失请求好。
   */
  compressMessages(messages, maxTokens = DEFAULT_CONTEXT_BUDGET) {
    if (!messages || messages.length === 0) return messages;

    const totalTokens = this._estimateTokens(messages);
    if (totalTokens <= maxTokens) return messages;

    // 找到最近的 user 消息索引——压缩时绝不能丢弃它
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }

    // 从后往前保留消息，确保工具调用对完整
    const kept = [];
    const keptIndices = new Set(); // 安全网判定用：避免重复添加
    let currentTokens = 0;
    let i = messages.length - 1;

    while (i >= 0) {
      const msg = messages[i];
      const tokens = this._estimateMessageTokens(msg);

      // 如果是 tool 消息，必须同时保留对应的 assistant 消息（带 tool-call）
      if (msg.role === 'tool') {
        // 找到对应的 assistant 消息
        const assistantIdx = this._findCorrespondingAssistant(messages, i);
        if (assistantIdx >= 0) {
          const assistantTokens = this._estimateMessageTokens(messages[assistantIdx]);
          if (currentTokens + tokens + assistantTokens <= maxTokens) {
            kept.unshift(messages[assistantIdx]);
            keptIndices.add(assistantIdx);
            currentTokens += assistantTokens;
            kept.unshift(msg);
            keptIndices.add(i);
            currentTokens += tokens;
            i = assistantIdx - 1;
            continue;
          } else {
            // 空间不够，停止——但不直接 return，继续走安全网补 user 消息
            break;
          }
        }
      }

      // 强制保留最近的 user 消息（即使超预算）——丢失当前请求会导致 agent 中断
      const isLastUser = i === lastUserIdx;
      if (isLastUser || currentTokens + tokens <= maxTokens) {
        kept.unshift(msg);
        keptIndices.add(i);
        currentTokens += tokens;
      } else {
        break;
      }
      i--;
    }

    // 安全网：上面的 break（尤其 tool 分支）可能在到达 lastUserIdx 之前就停下，
    // 导致最近 user 消息不在 kept 中。此时强制补到最前——丢失它会让模型不知道
    // 用户要什么 → 不写码 → 催办再试 → 还是不知道 → 循环耗尽 → 任务中断。
    // 多几百 token 远比丢失请求好。
    if (lastUserIdx >= 0 && !keptIndices.has(lastUserIdx)) {
      kept.unshift(messages[lastUserIdx]);
    }

    return kept;
  }

  _findCorrespondingAssistant(messages, toolIdx) {
    // 向前查找包含对应 tool-call 的 assistant 消息
    const toolMsg = messages[toolIdx];
    const toolCallIds = new Set();
    if (Array.isArray(toolMsg.content)) {
      for (const part of toolMsg.content) {
        if (part.type === 'tool-result') {
          toolCallIds.add(part.toolCallId);
        }
      }
    }

    for (let i = toolIdx - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const hasMatchingCall = msg.content.some(
          (part) => part.type === 'tool-call' && toolCallIds.has(part.toolCallId)
        );
        if (hasMatchingCall) return i;
      }
    }
    return -1;
  }

  /** 公开的上下文 token 估算（供 UI 显示）。粗略：4 字符 ≈ 1 token。 */
  estimateContextTokens(messages) {
    return this._estimateTokens(messages);
  }

  _estimateTokens(messages) {
    return messages.reduce((sum, msg) => sum + this._estimateMessageTokens(msg), 0);
  }

  _estimateMessageTokens(msg) {
    let content = msg.content || '';
    // Vercel AI SDK v6 中 assistant/tool 消息的 content 经常是数组
    // （含 {type:'text',text} / {type:'tool-call',...} / {type:'tool-result',...} 部分）。
    // 直接当字符串用会导致 estimateTextTokens 里 for..of 遍历对象元素，
    // 触发 "ch.codePointAt is not a function" —— 这正是 agent 中途崩溃的根因。
    if (Array.isArray(content)) {
      content = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part?.text) return part.text;
          if (part?.type === 'tool-call' || part?.type === 'tool-result') return JSON.stringify(part);
          return '';
        })
        .join('');
    }
    // 兜底：确保 content 一定是字符串（防止数字/对象等漏网）
    if (typeof content !== 'string') {
      content = String(content ?? '');
    }
    if (msg.toolInvocations) {
      content += msg.toolInvocations
        .map((inv) => {
          const args = JSON.stringify(inv.args || '');
          const result = typeof inv.result === 'string' ? inv.result : JSON.stringify(inv.result ?? '');
          return args + result;
        })
        .join('');
    }
    return estimateTextTokens(content);
  }
}

// 单例
export const contextManager = new ContextManager();
