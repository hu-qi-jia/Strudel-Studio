# Agent 侧边栏功能实现文档（基于实际代码）

## 概述

在 Strudel REPL 页面右侧新增一个 AI Agent 侧边栏，用户可通过自然语言与 Agent 对话，Agent 可对编辑器中的代码进行增删改查。支持用户自定义配置模型（OpenAI 兼容、Anthropic 兼容、Gemini），对话记录按项目隔离并缓存在本地。

## 技术架构

### 核心技术栈

- **AI SDK**: Vercel AI SDK (`ai` 包)
  - `streamText()` - 流式文本生成
  - `tool()` - 工具定义（使用 `execute` 回调）
  - `fullStream` - 流式事件迭代
- **官方 Provider 包**:
  - `@ai-sdk/openai` - OpenAI 兼容 API
  - `@ai-sdk/anthropic` - Anthropic Claude API
  - `@ai-sdk/google` - Google Gemini API
- **状态管理**: nanostores（`@nanostores/persistent` + `@nanostores/react`）
- **存储**: IndexedDB（对话历史）+ localStorage（模型配置）
- **UI**: React 19 + Tailwind CSS

### 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    UI Layer (React)                      │
│  AgentSidebar.jsx  ChatMessage.jsx  ChatInput.jsx       │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│              Agent Core Layer (AI SDK)                   │
│  streamText() + fullStream 事件迭代                      │
│  tool() + execute 回调（自动工具循环）                   │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│           Provider Layer (官方 Provider 包)              │
│  @ai-sdk/openai  @ai-sdk/anthropic  @ai-sdk/google      │
│  - 自动处理流式解析                                      │
│  - 自动处理工具调用                                      │
│  - 自动处理错误和重试                                    │
└────────────────┬────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────┐
│              Tool Layer (Strudel 工具)                   │
│  read_code  write_code  insert_code  replace_code       │
│  execute_code  stop_playback                            │
│  - validateCode() 验证无效方法                           │
└─────────────────────────────────────────────────────────┘
```

## 核心实现

### 1. Provider 层 - `providers.mjs`

使用官方 provider 包创建模型实例，自动处理流式解析、工具调用、错误处理。

```javascript
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export function getModel(config) {
  const temperature = parseFloat(config.temperature) || 0.7;

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return openai.chat(config.model, { temperature });
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
        headers: {
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      return anthropic(config.model, { temperature });
    }
    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
      });
      return google(config.model, { temperature });
    }
    default: {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return openai.chat(config.model, { temperature });
    }
  }
}
```

**关键点**：
- Anthropic 需要特殊 header `anthropic-dangerous-direct-browser-access: 'true'` 才能从浏览器直接调用
- OpenAI 兼容模式使用 `.chat()` 方法（Chat Completions API），因为第三方 provider 不支持 Responses API
- `temperature` 从 localStorage 读取时是字符串，需要 `parseFloat()` 转换

### 2. 工具层 - `tools.mjs`

使用 AI SDK 的 `tool()` 函数定义工具，通过 `execute` 回调自动处理工具调用。

```javascript
import { tool, jsonSchema } from 'ai';

export function createTools(editorRef) {
  return {
    read_code: tool({
      description: 'Read the current code in the editor...',
      inputSchema: noParams,
      execute: async () => {
        const editor = editorRef.current;
        if (!editor) return 'Editor not available';
        return editor.editor.state.doc.toString();
      },
    }),
    write_code: tool({
      description: 'Replace ALL code in the editor...',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          code: { type: 'string', description: '...' },
        },
        required: ['code'],
      }),
      execute: async ({ code }) => {
        const warnings = validateCode(code);
        if (warnings.length > 0) {
          return `Code validation failed:\n${warnings.join('\n')}`;
        }
        const editor = editorRef.current;
        if (!editor) return 'Editor not available';
        editor.setCode(code);
        return 'Code written successfully';
      },
    }),
    // ... 其他工具
  };
}
```

**关键点**：
- 使用 `tool()` 的 `execute` 回调，AI SDK 自动处理工具调用循环（`maxSteps`）
- 不使用 `useEffect` 监听消息变化，避免竞态条件
- `validateCode()` 验证代码，检查无效方法（`.reverb()`、`.echo()` 等）

### 3. 代码验证 - `validateCode()`

```javascript
const INVALID_METHODS = {
  reverb: 'Use .room(0.7).size(0.8) for reverb',
  echo: 'Use .delay(0.5).delaytime(0.25).delayfeedback(0.7) for delay/echo',
  chorus: 'Not available in Strudel',
  // ...
};

const INVALID_FUNCTIONS = {
  func: 'Not a Strudel function',
  play: 'Use execute_code tool to play',
  melody: 'Use note("c3 e3 g3") for melody',
  // ...
};

function validateCode(code) {
  const warnings = [];

  // 检查无效方法链：.method()
  for (const [method, hint] of Object.entries(INVALID_METHODS)) {
    const regex = new RegExp(`\\.${method}\\s*\\(`, 'i');
    if (regex.test(code)) {
      warnings.push(`.${method}() does not exist in Strudel — ${hint}`);
    }
  }

  // 检查无效独立函数调用
  for (const [name, hint] of Object.entries(INVALID_FUNCTIONS)) {
    const regex = new RegExp(`(?<!\\.)\\b${name}\\s*\\(`, 'i');
    if (regex.test(code)) {
      warnings.push(`${name}() is not a Strudel function — ${hint}`);
    }
  }

  // 检查常见错误
  if (/\bnote\s*\(\s*\[\s*/.test(code)) {
    warnings.push('note() expects a mini notation string, not an array');
  }

  return warnings;
}
```

### 4. 流式响应处理 - `AgentSidebar.jsx`

使用 `streamText()` + `fullStream` 事件迭代处理流式响应。

```javascript
import { streamText } from 'ai';

const handleSend = async (text) => {
  const model = getModel(config);
  const tools = createTools(editorRef);

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: toCoreMessages(truncatedMessages),
    tools,
    toolChoice: 'auto',
    maxSteps: 5,
    maxTokens: parseInt(config.maxTokens, 10) || 4096,
    providerOptions: getProviderOptions(config),
    abortSignal: abortController.signal,
    onStepFinish: ({ toolResults, usage: stepUsage }) => {
      // 跟踪步骤进度
      setStepCount((prev) => prev + 1);
      // 更新 token 使用量
      if (stepUsage) {
        setTokenUsage((prev) => ({
          prompt: (prev?.prompt || 0) + (stepUsage.inputTokens || 0),
          completion: (prev?.completion || 0) + (stepUsage.outputTokens || 0),
          total: (prev?.total || 0) + (stepUsage.inputTokens || 0) + (stepUsage.outputTokens || 0),
        }));
      }
    },
    onFinish: ({ usage, finishReason: reason }) => {
      // 最终 token 使用量
      if (usage) {
        setTokenUsage({
          prompt: usage.inputTokens,
          completion: usage.outputTokens,
          total: (usage.inputTokens || 0) + (usage.outputTokens || 0),
        });
      }
    },
  });

  // 处理流式事件
  let currentAssistantId = null;
  let currentContent = '';
  let currentToolInvocations = [];

  for await (const event of result.fullStream) {
    switch (event.type) {
      case 'text-delta': {
        if (!currentAssistantId) {
          currentAssistantId = nextId();
          currentContent = '';
          currentToolInvocations = [];
          setMessages((prev) => [
            ...prev,
            { id: currentAssistantId, role: 'assistant', content: '', toolInvocations: [] },
          ]);
        }
        currentContent += event.text;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentAssistantId ? { ...m, content: currentContent } : m,
          ),
        );
        break;
      }

      case 'tool-call': {
        currentToolInvocations = [
          ...currentToolInvocations,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.input,
            state: 'call',
          },
        ];
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentAssistantId
              ? { ...m, toolInvocations: currentToolInvocations }
              : m,
          ),
        );
        break;
      }

      case 'tool-result': {
        currentToolInvocations = currentToolInvocations.map((inv) =>
          inv.toolCallId === event.toolCallId
            ? { ...inv, state: 'result', result: event.output }
            : inv,
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentAssistantId
              ? { ...m, toolInvocations: currentToolInvocations }
              : m,
          ),
        );
        break;
      }

      case 'finish-step': {
        currentAssistantId = null;
        break;
      }

      case 'error': {
        const errorText = event.error?.message || String(event.error);
        // 处理错误
        break;
      }
    }
  }
};
```

**关键点**：
- 使用 `streamText()` 而不是 `useChat` hook（`useChat` 是为 client-server 架构设计的）
- 使用 `fullStream` 事件迭代处理流式响应
- 手动管理消息状态（`useState`），更灵活
- `maxSteps: 5` 允许 AI SDK 自动执行多步工具调用

### 5. 消息转换 - `toCoreMessages()`

将 UI 消息格式转换为 AI SDK 的 core message 格式。

```javascript
export function toCoreMessages(uiMessages) {
  const result = [];
  for (const msg of uiMessages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content || '' });
    } else if (msg.role === 'assistant') {
      const completedInvocations = (msg.toolInvocations || []).filter(
        (inv) => inv.state === 'result',
      );
      const hasToolCalls = completedInvocations.length > 0;

      const parts = [];
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
      for (const inv of completedInvocations) {
        parts.push({
          type: 'tool-call',
          toolCallId: inv.toolCallId,
          toolName: inv.toolName,
          input: inv.args,
        });
      }

      if (parts.length === 0) continue;

      result.push({ role: 'assistant', content: parts });

      if (hasToolCalls) {
        result.push({
          role: 'tool',
          content: completedInvocations.map((inv) => ({
            type: 'tool-result',
            toolCallId: inv.toolCallId,
            toolName: inv.toolName,
            output: {
              type: 'text',
              value: typeof inv.result === 'string' ? inv.result : JSON.stringify(inv.result),
            },
          })),
        });
      }
    }
  }
  return result;
}
```

### 6. System Prompt - `providers.mjs`

443 行的完整 System Prompt，包含：
- Mini notation 语法表
- 200+ 个有效音色名称
- 所有 pattern 函数分类
- 所有效果器参数
- **关键**：`CRITICAL: INVALID METHODS AND FUNCTIONS` 一节，明确列出 `.reverb()`、`.echo()` 等不存在的方法

```javascript
export const SYSTEM_PROMPT = `You are an expert AI assistant for Strudel...

## CORE CONCEPTS
Strudel uses **mini notation** inside strings to describe musical patterns...

### Mini Notation Syntax
| Syntax | Meaning | Example |
|--------|---------|---------|
| space | sequence | \`"bd sd hh oh"\` |
| \`[]\` | sub-cycle | \`"bd [hh hh] sd"\` |
...

## SOUND SOURCES
CRITICAL: Only use sound names listed below...

### Drum Samples (default bank, use with .s())
\`bd\` (kick), \`sd\` (snare), \`hh\` (closed hi-hat), ...

### Drum Machine Banks (use with .bank())
Full names: \`RolandTR808\`, \`RolandTR909\`, ...

### GM Soundfonts (128 instruments, use with .s())
Piano: \`gm_piano\`, \`gm_epiano1\`, ...

## PATTERN FUNCTIONS
### Creating patterns
\`s("bd sd hh oh")\` — play samples
\`note("c3 e3 g3 c4")\` — play notes
...

## EFFECTS AND CONTROLS
### Global effects
\`.room(0.7)\` — reverb amount
\`.size(0.8)\` — reverb room size
...

## CRITICAL: INVALID METHODS AND FUNCTIONS
The following do NOT exist in Strudel and WILL cause runtime errors:

### Invalid method chains (do NOT use):
- \`.reverb()\` — USE \`.room(0.7).size(0.8)\` instead
- \`.echo()\` — USE \`.delay(0.5).delaytime(0.25).delayfeedback(0.7)\` instead
...

### Invalid standalone functions (do NOT use):
- \`func()\` — not a Strudel function
- \`play()\` — not a Strudel function; use \`execute_code\` tool to play
...

## WORKFLOW
1. When user asks to modify code: first use \`read_code\` to see current code
2. Then use \`write_code\` or \`replace_code\` to make changes
3. After modifying, use \`execute_code\` to let the user hear the result
...`;
```

**为什么需要 443 行**：
- 30 行的 prompt 会让模型频繁幻觉出不存在的函数名
- 需要明确的音色列表，否则模型会编造音色名
- 需要明确的无效方法警告，否则模型会频繁犯错

### 7. 状态管理 - `store.mjs`

使用 nanostores persistentMap 存储模型配置。

```javascript
import { persistentMap } from '@nanostores/persistent';
import { atom } from 'nanostores';

export const $modelConfig = persistentMap('agent-model-', {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o',
  maxTokens: '4096',      // 字符串类型（localStorage 只存字符串）
  temperature: '0.7',     // 字符串类型
  enableIntentDetection: 'true',
  parallelToolCalls: 'true',
});

export const $isAgentOpen = atom(false);

export const providerDefaults = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  gemini: {
    baseUrl: '',
    model: 'gemini-2.5-flash',
  },
};
```

**关键点**：
- `maxTokens` 和 `temperature` 是字符串类型（localStorage 只存字符串）
- 使用时需要 `parseInt()` 和 `parseFloat()` 转换

### 8. 存储层 - `storage.mjs`

使用 IndexedDB 存储对话历史，按项目隔离。

```javascript
const DB_NAME = 'agent-conversations';
const STORE_NAME = 'conversations';
const DB_VERSION = 1;

export function getProjectId() {
  if (typeof window === 'undefined') return 'default';
  const hash = window.location.hash || '#default';
  const path = window.location.pathname || '/';
  return `${path}${hash}`;
}

export async function saveMessages(projectId, messages) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.put({
    projectId,
    messages: JSON.parse(JSON.stringify(messages)),
    updatedAt: Date.now(),
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadMessages(projectId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.get(projectId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result?.messages || []);
    request.onerror = () => reject(request.error);
  });
}

export async function clearMessages(projectId) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(projectId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

**关键点**：
- 项目 ID 使用 `pathname + hash`（hash 是代码的压缩编码）
- 同一个 hash 下用户可能做完全不同的会话，但当前实现至少能按"代码快照"隔离对话

### 9. UI 组件

#### AgentSidebar.jsx

主组件，包含：
- 消息列表
- 输入框
- 工具调用展示
- Token 使用量显示
- 步骤进度显示

#### ChatMessage.jsx

消息渲染组件：
- 用户消息（右对齐）
- Agent 消息（左对齐）
- 工具调用徽章（显示工具名、参数、结果）
- 代码块渲染

#### ChatInput.jsx

输入框组件：
- 自动调整高度
- Enter 发送，Shift+Enter 换行
- 流式响应时显示 stop 按钮

## 文件清单

### 新增文件

| 文件路径 | 用途 |
|---------|------|
| `website/src/repl/components/agent/AgentSidebar.jsx` | Agent 侧边栏主组件 |
| `website/src/repl/components/agent/ChatMessage.jsx` | 消息渲染组件 |
| `website/src/repl/components/agent/ChatInput.jsx` | 输入框组件 |
| `website/src/repl/agent/providers.mjs` | Provider 创建 + System Prompt + 消息转换 |
| `website/src/repl/agent/tools.mjs` | 工具定义 + 代码验证 |
| `website/src/repl/agent/store.mjs` | 模型配置状态管理 |
| `website/src/repl/agent/storage.mjs` | IndexedDB 对话存储 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `website/package.json` | 新增 `ai`、`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google` 依赖 |
| `website/src/repl/components/ReplEditor.jsx` | 引入 AgentSidebar，在右侧添加 Agent 面板 |
| `website/src/repl/components/Header.jsx` | 添加 "agent" 按钮 |
| `website/src/settings.mjs` | 新增 `isAgentOpen` 设置项 |
| `website/src/repl/components/panel/Panel.jsx` | 添加 ModelSection 设置面板 |
| `website/src/repl/components/panel/settings/ModelSection.jsx` | 模型配置 UI |

## 依赖

```json
{
  "dependencies": {
    "ai": "^5.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "@ai-sdk/google": "^1.0.0"
  }
}
```

## 关键设计决策

### 1. 为什么不用 `useChat` hook？

`useChat` 是为 client-server 架构设计的，假设你在用 `ChatTransport`。实际代码直接在浏览器调用 LLM API，不需要 `useChat` 的抽象。手动管理状态更灵活。

### 2. 为什么用 `tool()` 的 `execute` 回调？

AI SDK 的 `tool()` 函数提供了 `execute` 回调，自动处理工具调用循环（`maxSteps`）。如果使用 `useEffect` 监听消息变化来执行工具，会有竞态条件问题。

### 3. 为什么用官方 provider 包？

官方 provider 包（`@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`）已经处理好了：
- 流式解析（SSE）
- 工具调用格式
- 错误处理和重试
- 不同 provider 的格式差异

手写这些逻辑是自找麻烦。

### 4. 为什么 System Prompt 需要 443 行？

30 行的 prompt 会让模型频繁幻觉出不存在的函数名（`.reverb()`、`.chorus()` 等）。需要：
- 完整的音色列表（200+ 个）
- 完整的函数列表
- 明确的无效方法警告

### 5. 为什么 `maxTokens` 和 `temperature` 是字符串？

nanostores persistentMap 通过 localStorage 持久化，localStorage 只存字符串。取出时类型会变，使用时需要 `parseInt()` 和 `parseFloat()` 转换。

### 6. Anthropic 的特殊处理

Anthropic API 要求特殊 header `anthropic-dangerous-direct-browser-access: 'true'` 才能从浏览器直接调用。否则会被拒绝（CORS）。

## 验证步骤

1. 点击 Header "agent" 按钮，侧边栏正确展开/收起
2. 侧边栏可拖拽调整宽度
3. 模型配置：填写 API Key 后可正常连接对应 provider
4. 发送消息后流式输出回复
5. Agent 调用 `read_code` 工具可正确读取编辑器内容
6. Agent 调用 `write_code` 工具可正确修改编辑器内容
7. Agent 调用 `execute_code` 可触发代码执行
8. 刷新页面后对话记录保留
9. 切换不同代码 hash 后，对话记录按项目隔离
10. Zen 模式下 Agent 侧边栏隐藏
11. 工具调用时显示工具名、参数、结果
12. 流式响应时可点击 stop 停止
13. 显示 token 使用量和步骤进度

## 已知限制

1. **项目 ID 策略**：使用 `pathname + hash` 作为项目标识，hash 是代码的压缩编码，非常长。同一个 hash 下用户可能做完全不同的会话。更好的做法可能是让用户手动命名项目。

2. **上下文截断**：当前使用硬编码的 `MAX_MESSAGE_PAIRS = 20` 截断消息，不考虑 token 限制。更好的做法是基于 token 数量动态截断。

3. **意图检测**：当前使用关键词匹配 + LLM 检测意图，可能不准确。更好的做法是让 LLM 自己决定何时使用工具（`toolChoice: 'auto'`）。

4. **音色列表硬编码**：System Prompt 中的音色列表是硬编码的，如果 Strudel 添加了新音色，需要手动更新。更好的做法是从 `soundMap` 动态获取。

## 总结

实际实现正确地使用了 Vercel AI SDK 的高层 API：
- `streamText()` + `fullStream` 事件迭代
- `tool()` 的 `execute` 回调
- 官方 provider 包

避免了方案中的错误设计：
- ChatTransport（为 client-server 架构设计）
- 手写 SSE 解析
- `useEffect` 监听消息变化执行工具

System Prompt 443 行，包含完整的 Strudel 语法参考和无效方法警告，有效减少模型幻觉。
