# Agent 侧边栏功能实现方案

## 概述

在 Strudel REPL 页面右侧新增一个 AI Agent 侧边栏，用户可通过自然语言与 Agent 对话，Agent 可对编辑器中的代码进行增删改查。支持用户自定义配置模型（OpenAI 兼容、Anthropic 兼容、Gemini），对话记录按项目隔离并缓存在本地。

## 开源项目复用评估

### OpenCode (anomalyco/opencode) — 不可直接复用
- Go 语言实现，TUI 基于 Go bubbletea 库，桌面端独立应用
- 架构与 React Web 应用完全不兼容，无法嵌入
- **可借鉴**: 多 provider 支持（75+ 模型）、工具系统设计、会话管理

### Vercel AI SDK (`ai` + `@ai-sdk/react`) — 核心复用
- `useChat` hook 封装了消息流式传输、状态管理、错误处理
- 支持自定义 `ChatTransport` 接口，可从浏览器直接调用 LLM API（无需服务端）
- 原生支持 tool calling UI 渲染
- **复用方式**: 使用 `@ai-sdk/react` 的 `useChat` + 自定义 `ChatTransport`

### 结论
采用 **Vercel AI SDK** 作为 Agent 核心框架，复用其消息管理、流式传输、工具调用 UI，自行实现客户端直连 LLM 的 Transport 层。

## 现状分析

### 技术栈
- **框架**: React 19 + Astro（SSG），Vite 构建
- **状态管理**: nanostores（`@nanostores/persistent` 持久化 + `@nanostores/react` 绑定）
- **编辑器**: CodeMirror 6，封装为 `StrudelMirror` 类（`@strudel/codemirror`）
- **样式**: Tailwind CSS 3 + CSS 变量主题系统
- **桌面端**: Tauri v2（`window.__TAURI__` 检测）
- **本地存储**: `@nanostores/persistent`（localStorage 封装）、IndexedDB（仅用于音频样本）

### 现有布局结构
[ReplEditor.jsx](file:///e:/个人项目/strudel/website/src/repl/components/ReplEditor.jsx) 是主布局组件，结构为：
```
┌─────────────────────────────────────────────┐
│ Header                                       │
├──────┬──────────────────────┬───────────────┤
│Sounds│      Code Editor     │ Console/Panel │
│(left)│                      │   (right)     │
│      │                      │               │
└──────┴──────────────────────┴───────────────┘
```
- 右侧已有 `ConsoleSidebar`（可右/底部）和 `VerticalPanel`（设置面板，可右/底部）
- `ResizeHandle` 组件已实现拖拽调整面板尺寸
- 设置系统通过 `settingsMap`（persistentMap）管理，Header 中有按钮切换面板

### 编辑器 API
`StrudelMirror` 类（[codemirror.mjs](file:///e:/个人项目/strudel/packages/codemirror/codemirror.mjs#L135-L377)）暴露：
- `setCode(code)` — 替换全部代码
- `appendCode(code)` — 在光标位置追加代码
- `getCursorLocation()` / `setCursorLocation(col)` — 光标操作
- `this.editor` — CodeMirror EditorView 实例（可做更细粒度操作）
- `evaluate()` — 执行代码

### 项目隔离
当前项目无"项目"概念，Tauri 桌面端仅使用 `BaseDirectory.Audio` 读取音频文件。需引入项目标识用于对话隔离。

## 实现方案

### 1. 新增依赖

```bash
pnpm add ai @ai-sdk/react --filter @strudel/website
```

- `ai` — AI SDK 核心（ChatTransport 接口、消息类型定义）
- `@ai-sdk/react` — React hooks（useChat）

### 2. 新增文件清单

| 文件路径 | 用途 |
|---------|------|
| `website/src/repl/components/agent/AgentSidebar.jsx` | Agent 侧边栏主组件 |
| `website/src/repl/components/agent/ChatMessage.jsx` | 单条消息组件 |
| `website/src/repl/components/agent/ChatInput.jsx` | 输入框组件 |
| `website/src/repl/components/agent/ModelSettings.jsx` | 模型配置弹窗 |
| `website/src/repl/agent/store.mjs` | Agent 状态管理（模型配置） |
| `website/src/repl/agent/transport.mjs` | 自定义 ChatTransport（客户端直连 LLM） |
| `website/src/repl/agent/providers.mjs` | 三种 provider 的请求/响应适配 |
| `website/src/repl/agent/tools.mjs` | Agent 工具定义（编辑器操作） |
| `website/src/repl/agent/storage.mjs` | IndexedDB 存储层（对话记录持久化） |

### 3. 自定义 ChatTransport — `agent/transport.mjs`

这是方案的核心。实现 AI SDK 的 `ChatTransport` 接口，直接从浏览器调用 LLM API：

```js
import { ChatTransport } from 'ai';

export class DirectLLMTransport extends ChatTransport {
  constructor(getConfig, getEditorRef, tools) {
    super();
    this.getConfig = getConfig;       // () => modelConfig
    this.getEditorRef = getEditorRef; // () => editorRef
    this.tools = tools;
  }

  async doRequest({ messages, tools, abortSignal }) {
    const config = this.getConfig();
    const provider = getProvider(config.provider);

    // 将 AI SDK 格式的 messages 转换为 provider 格式
    const providerMessages = provider.formatMessages(messages, tools);
    // 发起流式请求
    const response = await provider.streamChat(providerMessages, config, abortSignal);
    // 将 provider 的 SSE 响应转换为 AI SDK 的 StreamData
    return provider.parseStream(response);
  }
}
```

### 4. Provider 适配层 — `agent/providers.mjs`

每个 provider 负责三件事：格式化消息、发起请求、解析流式响应：

```js
// OpenAI 兼容（也覆盖 DeepSeek、Ollama 等兼容端点）
export const openaiProvider = {
  async streamChat(messages, config, signal) {
    const url = `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools: formatTools(config.tools),
        stream: true,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
      signal,
    });
    return res;
  },
  formatMessages(messages, tools) { /* 转换为 OpenAI 格式 */ },
  parseStream(response) { /* 解析 SSE → AI SDK StreamData */ },
};

// Anthropic 兼容
export const anthropicProvider = {
  async streamChat(messages, config, signal) {
    const url = `${config.baseUrl || 'https://api.anthropic.com'}/v1/messages`;
    // ... Anthropic 特有的请求格式
  },
  formatMessages(messages, tools) { /* 转换为 Anthropic 格式 */ },
  parseStream(response) { /* 解析 SSE → AI SDK StreamData */ },
};

// Gemini
export const geminiProvider = {
  async streamChat(messages, config, signal) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?key=${config.apiKey}`;
    // ... Gemini 特有的请求格式
  },
  formatMessages(messages, tools) { /* 转换为 Gemini 格式 */ },
  parseStream(response) { /* 解析 SSE → AI SDK StreamData */ },
};

export function getProvider(name) {
  switch (name) {
    case 'openai': return openaiProvider;
    case 'anthropic': return anthropicProvider;
    case 'gemini': return geminiProvider;
  }
}
```

### 5. Agent 侧边栏主组件 — `AgentSidebar.jsx`

使用 `useChat` hook + 自定义 Transport：

```jsx
import { useChat } from '@ai-sdk/react';
import { DirectLLMTransport } from '../../agent/transport.mjs';
import { $modelConfig } from '../../agent/store.mjs';
import { editorTools, executeTool } from '../../agent/tools.mjs';

export function AgentSidebar({ context }) {
  const { editorRef } = context;
  const modelConfig = useStore($modelConfig);

  const transport = useMemo(() => new DirectLLMTransport(
    () => $modelConfig.get(),
    () => editorRef,
    editorTools,
  ), [editorRef]);

  const {
    messages, sendMessage, status, stop, error, setMessages
  } = useChat({
    transport,
    onError: (err) => console.error('Agent error:', err),
  });

  // 工具调用处理
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'assistant' && lastMessage.toolInvocations) {
      for (const invocation of lastMessage.toolInvocations) {
        if (invocation.state === 'call') {
          const result = executeTool(invocation.toolName, invocation.args, editorRef);
          // 将工具结果追加到消息
          addToolResult({ toolCallId: invocation.toolCallId, result });
        }
      }
    }
  }, [messages]);

  return (
    <div className="flex flex-col bg-lineHighlight text-foreground overflow-hidden border-l"
         style={{ borderColor: '...', width: `${width}px`, fontFamily }}>
      <ResizeHandle side="left" onResize={handleResize} minSize={280} maxSize={600} />
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b">
        <span className="text-[var(--fs-label)] font-medium">agent</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowSettings(true)}>⚙</button>
          <button onClick={() => setIsAgentOpen(false)}>✕</button>
        </div>
      </div>
      {/* 消息列表 */}
      <div className="flex-1 overflow-auto p-2">
        {messages.map(msg => <ChatMessage key={msg.id} message={msg} />)}
      </div>
      {/* 输入框 */}
      <ChatInput onSend={sendMessage} disabled={status !== 'ready'} onStop={stop} />
      {/* 模型配置弹窗 */}
      {showSettings && <ModelSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
```

### 6. 状态管理 — `agent/store.mjs`

模型配置使用 nanostores persistentMap（与项目现有模式一致），对话状态由 `useChat` 管理：

```js
import { persistentMap } from '@nanostores/persistent';
import { atom } from 'nanostores';

export const $modelConfig = persistentMap('agent-model-', {
  provider: 'openai',    // 'openai' | 'anthropic' | 'gemini'
  apiKey: '',
  baseUrl: '',           // 自定义端点（留空使用默认）
  model: 'gpt-4o',
  maxTokens: 4096,
  temperature: 0.7,
});

export const $isAgentOpen = atom(false);
```

### 7. 项目隔离策略 — `agent/storage.mjs`

使用 IndexedDB 按项目隔离存储对话记录：

- **项目 ID 生成**: 使用 `window.location.hash`（当前代码的 hash）+ 当前 URL path 组合作为项目标识
- **存储结构**: IndexedDB `agent-conversations` 数据库，`conversations` 表，以 `projectId` 为索引
- **加载逻辑**: 组件挂载时从 IndexedDB 加载对应对话，消息变化时自动保存

```js
const DB_CONFIG = {
  dbName: 'agent-conversations',
  table: 'conversations',
  columns: ['projectId', 'messages', 'updatedAt'],
  version: 1,
};

export function getProjectId() {
  const hash = window.location.hash;
  const path = window.location.pathname;
  return `${path}#${hash}`;
}

export async function saveMessages(projectId, messages) { /* ... */ }
export async function loadMessages(projectId) { /* ... */ }
```

### 8. Agent 工具系统 — `agent/tools.mjs`

定义 Agent 可调用的工具，使用 OpenAI function calling 格式（AI SDK 标准）：

```js
export const editorTools = [
  {
    type: 'function',
    function: {
      name: 'read_code',
      description: '读取编辑器中的当前代码',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_code',
      description: '替换编辑器中的全部代码',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要写入的完整代码' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_code',
      description: '在指定位置插入代码',
      parameters: {
        type: 'object',
        properties: {
          position: { type: 'number', description: '插入位置（字符偏移）' },
          code: { type: 'string', description: '要插入的代码' },
        },
        required: ['position', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_code',
      description: '替换指定范围的代码',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'number', description: '起始位置' },
          to: { type: 'number', description: '结束位置' },
          code: { type: 'string', description: '替换后的代码' },
        },
        required: ['from', 'to', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description: '执行编辑器中的代码（播放）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_playback',
      description: '停止播放',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export function executeTool(name, args, editorRef) {
  const editor = editorRef.current;
  switch (name) {
    case 'read_code':
      return editor.editor.state.doc.toString();
    case 'write_code':
      editor.setCode(args.code);
      return 'Code written successfully';
    case 'insert_code':
      editor.editor.dispatch({
        changes: { from: args.position, insert: args.code },
      });
      return 'Code inserted successfully';
    case 'replace_code':
      editor.editor.dispatch({
        changes: { from: args.from, to: args.to, insert: args.code },
      });
      return 'Code replaced successfully';
    case 'execute_code':
      editor.evaluate();
      return 'Code execution started';
    case 'stop_playback':
      editor.repl.setActive(false);
      return 'Playback stopped';
  }
}
```

### 9. 布局集成 — 修改 `ReplEditor.jsx`

在现有右侧面板区域之后添加 Agent 侧边栏：

```jsx
import { AgentSidebar } from './agent/AgentSidebar';

// 在 VerticalPanel 之后添加：
{!isZen && isAgentOpen && <AgentSidebar context={context} />}
```

### 10. Header 集成 — 修改 `Header.jsx`

在 Header 左侧按钮组中添加 "agent" 按钮（与 patterns/sounds/console 并列）：

```jsx
<button
  onClick={() => setIsAgentOpen(!isAgentOpen)}
  className={cx(
    'px-2 py-1 hover:opacity-50 text-[var(--fs-label)] rounded transition-colors cursor-pointer',
    isAgentOpen && 'opacity-50',
  )}
>
  agent
</button>
```

### 11. 设置集成 — 修改 `settings.mjs`

在 `defaultSettings` 中新增：

```js
isAgentOpen: false,
```

### 12. 模型配置 UI — `ModelSettings.jsx`

弹窗式配置界面（复用现有 `Modal` 组件），包含：
- Provider 选择（OpenAI / Anthropic / Gemini）
- API Key 输入（密码类型）
- Base URL 输入（默认值根据 provider 自动填充，可自定义覆盖）
- Model 名称输入
- Temperature / Max Tokens 滑块

### 13. System Prompt

```
你是 Strudel 的 AI 助手。Strudel 是一个基于 TidalCycles 的音乐实时编码环境。
你可以帮助用户编写、修改和调试 Strudel 代码。
使用提供的工具来读取和修改编辑器中的代码。

Strudel 使用 mini notation 来描述音乐模式，例如：
- s("bd sd hh oh") 播放鼓点
- note("c3 eb3 g3").s("sawtooth") 播放音符
- $: 前缀表示每拍循环
- .bank("tr909") 切换鼓机音色
- .slow(2) 将节奏放慢一倍
- .fast(2) 将节奏加快一倍
- .rev() 反转节奏
- .every(3, x => x.rev()) 每3个循环应用一次效果

当用户要求修改代码时，先使用 read_code 查看当前代码，再使用 write_code 或 replace_code 修改。
修改完成后，可以使用 execute_code 让用户听到效果。
```

## 修改文件汇总

| 文件 | 修改内容 |
|------|---------|
| `website/package.json` | 新增 `ai`、`@ai-sdk/react` 依赖 |
| `website/src/repl/components/ReplEditor.jsx` | 引入 AgentSidebar，在右侧添加 Agent 面板 |
| `website/src/repl/components/Header.jsx` | 添加 "agent" 按钮 |
| `website/src/settings.mjs` | 新增 `isAgentOpen` 设置项 |

## 新增文件汇总

| 文件 | 说明 |
|------|------|
| `website/src/repl/components/agent/AgentSidebar.jsx` | 侧边栏主组件（使用 useChat hook） |
| `website/src/repl/components/agent/ChatMessage.jsx` | 消息气泡组件（含工具调用展示） |
| `website/src/repl/components/agent/ChatInput.jsx` | 输入框组件 |
| `website/src/repl/components/agent/ModelSettings.jsx` | 模型配置弹窗 |
| `website/src/repl/agent/store.mjs` | 模型配置状态管理 |
| `website/src/repl/agent/transport.mjs` | 自定义 ChatTransport（客户端直连 LLM） |
| `website/src/repl/agent/providers.mjs` | 三种 provider 的请求/响应适配 |
| `website/src/repl/agent/tools.mjs` | 工具定义与执行 |
| `website/src/repl/agent/storage.mjs` | IndexedDB 对话存储 |

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

## 假设与决策

1. **复用 Vercel AI SDK**: 使用 `@ai-sdk/react` 的 `useChat` hook 管理对话状态和流式渲染，自定义 `ChatTransport` 实现客户端直连 LLM。避免从零实现消息管理和流式解析。
2. **项目 ID 策略**: 使用 `pathname + hash` 作为项目标识，与现有 URL hash 机制一致。
3. **工具调用格式**: 遵循 OpenAI function calling 格式（AI SDK 标准），Anthropic/Gemini 适配层负责转换。
4. **安全性**: API Key 存储在 localStorage（通过 nanostores persistent），仅在客户端使用，不发送到任何第三方服务器。
5. **CORS 问题**: 部分提供商 API 可能不支持浏览器直接调用（CORS 限制）。对于 Tauri 桌面端无此问题；Web 端需用户配置支持 CORS 的代理端点（如 OpenAI 兼容的 Ollama、one-api 等中转服务），或在 Base URL 中填写代理地址。
