# Strudel Agent 系统架构文档

> **⚠️ 现状更新（2026-06）**：本文档记录的是重构前的历史架构。以下工具已删除，下文
> 凡提及均为历史记录，不代表当前代码：
> - `insert_code` / `replace_code` —— 已删除，编辑工具收敛为 `write_code`（全量）+ `edit_lines`（按行）两个
> - `preview_sound` / `restore_code` —— 已删除，试听机制（savedCode 闭包）整体移除
>
> 本次同步新增的架构变更：
> - 可调参数集中到 [config.mjs](../../website/src/repl/agent/config.mjs)（STEP_BUDGET / 成本预算 / 重复检测阈值等）
> - 上下文预算按 provider 动态（Gemini 800k / Claude 160k / GPT-4o 100k），见 [providers.mjs](../../website/src/repl/agent/providers.mjs) 的 `CONTEXT_BUDGETS`
> - 新增成本护栏 `costBudgetExceeded` + 重复调用检测 `detectRepeatedToolCall`，见 [Guardrail.mjs](../../website/src/repl/agent/Guardrail.mjs)
>
> 阅读下文时请以上述现状为准。

## 1. 系统概述

Strudel Agent 是嵌入在 Strudel 音乐实时编码环境中的 AI 助手系统。它允许用户通过自然语言对话来创建、修改和调试 Strudel 音乐模式代码，实现"对话式音乐创作"。系统基于 Vercel AI SDK 构建，采用流式响应 + 工具调用架构，支持 OpenAI / Anthropic / Gemini 三大 LLM 提供商及其兼容 API。

---

## 2. 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ReplEditor (页面容器)                           │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Header   │  │   Code Editor    │  │ Console  │  │  AgentSidebar  │  │
│  │          │  │  (StrudelMirror)  │  │ Sidebar  │  │                │  │
│  │          │  │                  │  │          │  │ ┌────────────┐ │  │
│  │          │  │  editorRef ────────────────────────►│ useAgent   │ │  │
│  │          │  │                  │  │          │  │ │  (Hook)    │ │  │
│  └──────────┘  └──────────────────┘  └──────────┘  │ └─────┬──────┘ │  │
│                                                     │       │        │  │
│                                                     │  ┌────▼─────┐  │  │
│                                                     │  │ ChatInput │  │  │
│                                                     │  └──────────┘  │  │
│                                                     │  ┌──────────┐  │  │
│                                                     │  │ChatMessage│  │  │
│                                                     │  └──────────┘  │  │
│                                                     └────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        Agent 核心模块 (useAgent)                         │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐   │
│  │  providers   │    │    tools     │    │    ContextManager        │   │
│  │  (模型创建)   │    │  (工具定义)   │    │  (System Prompt 构建     │   │
│  │              │    │              │    │   + 上下文压缩)           │   │
│  │ - getModel() │    │ - write_code │    │                          │   │
│  │ - getProvider│    │ - edit_lines │    │ - buildSystemPrompt()    │   │
│  │   Options()  │    │ - insert_code│    │ - compressMessages()     │   │
│  │ - toCoreMsgs │    │ - replace_   │    │                          │   │
│  │              │    │   code       │    └──────────┬───────────────┘   │
│  └──────┬───────┘    │ - read_code  │               │                   │
│         │            │ - execute_   │    ┌──────────▼───────────────┐   │
│         │            │   code       │    │    SoundRegistry         │   │
│         │            │ - stop_      │    │  (音色注册表)             │   │
│         │            │   playback   │    │                          │   │
│         │            │ - list_      │    │ - sync()                 │   │
│         │            │   sounds     │    │ - query()                │   │
│         │            │ - get_sound_ │    │ - getSound()             │   │
│         │            │   info       │    │ - generateSummary()      │   │
│         │            │ - preview_   │    └──────────────────────────┘   │
│         │            │   sound      │                                   │
│         │            │ - restore_   │    ┌──────────────────────────┐   │
│         │            │   code       │    │       storage            │   │
│         │            │ - get_       │    │  (IndexedDB 持久化)       │   │
│         │            │   selection  │    │                          │   │
│         │            │ - get_errors │    │ - saveMessages()         │   │
│         │            │ - undo       │    │ - loadMessages()         │   │
│         │            └──────┬───────┘    │ - clearMessages()        │   │
│         │                   │            └──────────────────────────┘   │
│         │                   │            ┌──────────────────────────┐   │
│         │                   │            │        store             │   │
│         │                   │            │  (Nanostores 状态)        │   │
│         │                   │            │                          │   │
│         │                   │            │ - $modelConfig           │   │
│         │                   │            │ - $isAgentOpen           │   │
│         │                   │            └──────────────────────────┘   │
└─────────┼───────────────────┼──────────────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────┐
│          Vercel AI SDK (streamText)      │
│                                         │
│  ┌─────────┐  ┌──────────┐  ┌────────┐ │
│  │ OpenAI  │  │ Anthropic │  │ Gemini │ │
│  │ Provider│  │ Provider  │  │Provider│ │
│  └────┬────┘  └─────┬─────┘  └───┬────┘ │
│       │             │             │      │
└───────┼─────────────┼─────────────┼──────┘
        │             │             │
        ▼             ▼             ▼
   LLM API Cloud (OpenAI / Anthropic / Google)
```

---

## 3. 模块功能说明

### 3.1 useAgent (核心 Hook)

**文件**: [useAgent.jsx](file:///e:/个人项目/strudel/website/src/repl/agent/useAgent.jsx)

Agent 系统的核心入口，是一个 React Hook，封装了全部 agent 业务逻辑，与 UI 完全分离。

**职责**:
- 管理对话消息状态 (`messages`, `messagesRef`)
- 流式调用 LLM (`streamText`)
- 流式事件处理（text-delta / tool-call / tool-result / finish-step / error）
- 任务完成护栏（Completion Guardrail）：检测模型是否在生成类请求中产出可播放代码，否则自动催办
- 项目隔离：根据 `viewingPatternData` 切换对话上下文
- 自动保存（防抖 2 秒）
- 并发防护：流进行中拒绝新请求
- 步数预算：单次 `sendMessage` 最多 30 步，防止病态会话烧 token

**导出接口**:
```js
{
  messages,       // Array<Message> - 对话消息列表
  isStreaming,    // boolean - 是否正在流式响应
  tokenUsage,    // { prompt, completion, total } - token 使用量
  stepCount,     // number - 当前步数
  finishReason,  // string - 结束原因
  error,         // string | null - 错误信息
  needsConfig,   // boolean - 是否需要配置 API Key
  messagesEndRef,// Ref - 自动滚动锚点
  sendMessage,   // (text: string) => Promise<boolean>
  stop,          // () => void - 中止当前流
  clearHistory,  // () => void - 清空对话历史
}
```

### 3.2 providers (模型提供者)

**文件**: [providers.mjs](file:///e:/个人项目/strudel/website/src/repl/agent/providers.mjs)

负责创建 AI SDK 模型实例和消息格式转换。

**核心函数**:

| 函数 | 说明 |
|------|------|
| `getModel(config)` | 根据 config.provider 创建对应的 AI SDK 模型实例，支持 openai/anthropic/gemini，默认走 OpenAI 兼容模式 |
| `getProviderOptions(config)` | 构建提供商特定选项（如 OpenAI 的 parallelToolCalls） |
| `toCoreMessages(uiMessages)` | 将 UI 消息格式转换为 AI SDK v6 的 CoreMessage[] 格式，过滤不完整的工具调用，将 tool-result 包装为 `{ type: 'text', value }` 的 discriminated union |

**消息转换关键逻辑**:
- 只保留 `state === 'result'` 且 `toolCallId`/`toolName` 完整的工具调用
- assistant 消息的 content 使用 parts 数组（text + tool-call）
- tool-result 的 output 必须使用 `{ type: 'text', value }` 格式（v6 schema 要求）
- DEV 模式下使用 `modelMessageSchema` 做运行时校验

### 3.3 tools (工具定义)

**文件**: [tools.mjs](file:///e:/个人项目/strudel/website/src/repl/agent/tools.mjs)

定义了 Agent 可调用的全部工具，绑定到编辑器实例。

**工具分类**:

#### 代码编辑工具（写入后自动播放 + 引擎校验）

| 工具 | 说明 | 关键行为 |
|------|------|----------|
| `write_code` | 替换全部代码 | 写入 → evaluate → 读取引擎错误 → 返回结果 |
| `edit_lines` | 替换指定行范围 | 1-based 行号，支持删除（new_code=""） |
| `insert_code` | 在语义锚点插入代码 | 支持 beginning/end/after_line/before_line/after_text/before_text |
| `replace_code` | 替换精确文本 | 优先使用 find_text，回退到 from/to 字符偏移 |

#### 播放控制工具

| 工具 | 说明 |
|------|------|
| `execute_code` | 播放当前代码（不修改） |
| `stop_playback` | 停止播放 |
| `restore_code` | 恢复 preview_sound 前的原始代码 |

#### 编辑器工具

| 工具 | 说明 |
|------|------|
| `read_code` | 读取当前编辑器代码 |
| `get_selection` | 获取选中的代码 |
| `get_errors` | 获取最近执行错误 |
| `undo` | 撤销上次修改 |

#### 音色工具

| 工具 | 说明 |
|------|------|
| `list_sounds` | 查询可用音色（支持 category/type/tag/search 过滤） |
| `get_sound_info` | 获取特定音色详情及用法示例 |
| `preview_sound` | 试听音色（保存当前代码 → 临时替换 → 播放） |

**代码安全校验** (`validateCode`):
- 无效方法黑名单（`.reverb()`, `.echo()`, `.chorus()` 等）
- 无效函数黑名单（`play()`, `melody()`, `synth()` 等）
- 危险 API 拦截（`fetch()`, `localStorage`, `eval()`, `new Worker()` 等）
- 数组传参检查（`note([])`, `s([])` 不合法）
- 多顶层 pattern 检查（缺少 `$:` 前缀）
- 多行字符串字面量检查

**试听机制** (`preview_sound`):
- `savedCode` 闭包变量保存原始代码
- 编辑类工具执行前自动调用 `clearPreviewIfActive()` 恢复原始代码
- `restore_code` 手动恢复

### 3.4 ContextManager (上下文管理)

**文件**: [ContextManager.mjs](file:///e:/个人项目/strudel/website/src/repl/agent/ContextManager.mjs)

动态构建 System Prompt 并管理上下文窗口。

**System Prompt 结构**（按注入顺序）:

| 片段 | 注入策略 | 大致 Token 数 |
|------|----------|--------------|
| `CORE_PROMPT` | 始终注入 | ~500 |
| `COMPLETION_CONTRACT` | 始终注入（最高优先级指令） | ~200 |
| `INVALID_METHODS_SECTION` | 始终注入 | ~150 |
| `PATTERN_FUNCTIONS` | 始终注入 | ~300 |
| `EFFECTS_REFERENCE` | 始终注入 | ~200 |
| `WORKFLOW_SECTION` | 始终注入 | ~200 |
| `SOUND_REFERENCE` | 按需注入（关键词匹配或短消息） | ~100 |
| `soundRegistry.generateSummary()` | 按需注入（同上） | ~200 |
| 当前编辑器代码 | 始终注入（Cursor 式） | 动态 |

**核心方法**:

| 方法 | 说明 |
|------|------|
| `buildSystemPrompt(userMessage, { messages, currentCode })` | 根据用户消息和上下文动态构建 System Prompt |
| `compressMessages(messages, maxTokens=30000)` | 滑动窗口压缩，保护工具调用对完整性 |
| `_collectRecentText(messages, userMessage)` | 收集最近 6 轮消息文本，用于关键词决策 |
| `_findCorrespondingAssistant(messages, toolIdx)` | 查找 tool 消息对应的 assistant 消息 |

**上下文压缩策略**:
- 从后往前保留消息，确保 tool 消息与对应 assistant 消息成对
- 最大 token 预算 30000（粗略估计：4 字符 ≈ 1 token）
- 空间不足时停止保留更早的消息

### 3.5 SoundRegistry (音色注册表)

**文件**: [SoundRegistry.mjs](file:///e:/个人项目/strudel/website/src/repl/agent/SoundRegistry.mjs)

从 `@strudel/webaudio` 的 `soundMap` 动态同步音色信息，为工具调用和 System Prompt 提供音色数据。

**核心方法**:

| 方法 | 说明 |
|------|------|
| `sync()` | 从 soundMap 同步音色数据（5 秒缓存） |
| `query({ category, type, tag, search })` | 多维度过滤查询 |
| `getSound(name)` | 精确查找音色 |
| `getCategories()` | 获取所有分类 |
| `generateSummary()` | 生成音色摘要（每类前 15 个 + 总数），注入 System Prompt |

**音色分类**:
- Drum Machines
- GM Soundfonts
- Samples
- Synths
- Special Samples

### 3.6 storage (持久化存储)

**文件**: [storage.mjs](file:///e:/个人项目/strudel/website/src/repl/agent/storage.mjs)

基于 IndexedDB 的对话持久化。

| 函数 | 说明 |
|------|------|
| `saveMessages(projectId, messages)` | 保存消息到 IndexedDB |
| `loadMessages(projectId)` | 加载指定项目的消息 |
| `clearMessages(projectId)` | 清除指定项目的消息 |

**存储结构**:
- 数据库名: `agent-conversations`
- Object Store: `conversations`（keyPath: `projectId`）
- 索引: `updatedAt`
- 每条记录: `{ projectId, messages, updatedAt }`

### 3.7 store (状态管理)

**文件**: [store.mjs](file:///e:/个人项目/strudel/website/src/repl/agent/store.mjs)

基于 Nanostores 的响应式状态管理。

| Store | 类型 | 说明 |
|-------|------|------|
| `$modelConfig` | `persistentMap` | 模型配置（provider/apiKey/baseUrl/model/maxTokens/temperature/parallelToolCalls），持久化到 localStorage |
| `$isAgentOpen` | `atom` | Agent 侧边栏开关状态 |

**providerDefaults**:
```js
{
  openai:    { baseUrl: 'https://api.openai.com/v1',    model: 'gpt-4o' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514' },
  gemini:    { baseUrl: '',                              model: 'gemini-2.5-flash' },
}
```

### 3.8 UI 组件

#### AgentSidebar

**文件**: [AgentSidebar.jsx](file:///e:/个人项目/strudel/website/src/repl/components/agent/AgentSidebar.jsx)

Agent 侧边栏容器组件，可调整宽度（280-600px）。

- 标题栏：显示步数、token 用量、清空按钮、关闭按钮
- 消息列表：渲染 ChatMessage 组件
- 输入区域：ChatInput 组件
- 未配置 API Key 时点击发送会打开设置面板

#### ChatInput

**文件**: [ChatInput.jsx](file:///e:/个人项目/strudel/website/src/repl/components/agent/ChatInput.jsx)

聊天输入组件，支持 Enter 发送 / Shift+Enter 换行，自动调整高度（最大 120px）。

#### ChatMessage

**文件**: [ChatMessage.jsx](file:///e:/个人项目/strudel/website/src/repl/components/agent/ChatMessage.jsx)

消息渲染组件，包含：
- 角色标签（you / agent）
- 消息内容（支持代码块渲染）
- 工具调用徽章（ToolCallBadge）：显示工具名、参数摘要、执行结果

---

## 4. 关键流程描述

### 4.1 用户发送消息流程

```
用户输入文本
    │
    ▼
ChatInput.handleSubmit
    │
    ▼
AgentSidebar.handleSend
    │  ┌─ needsConfig? → 打开设置面板
    │  └─ 否 → sendMessage(text)
    │
    ▼
useAgent.sendMessage
    │
    ├─ 并发防护（abortRef 存在则拒绝）
    ├─ 创建 userMessage，追加到 messages
    ├─ 创建 AbortController
    ├─ 获取 model 实例 (getModel)
    ├─ 记录 turnStartIdx
    │
    ▼
┌─── 任务完成护栏循环 (MAX_CONTINUATIONS=3, STEP_BUDGET=30) ───┐
│                                                                │
│  runOneTurn(isContinuation)                                    │
│    │                                                           │
│    ├─ contextManager.buildSystemPrompt(text, { messages,       │
│    │    currentCode })                                         │
│    ├─ contextManager.compressMessages(toCoreMessages(...))     │
│    ├─ [isContinuation] 追加 CONTINUATION_NUDGE                 │
│    │                                                           │
│    ▼                                                           │
│  streamText({ model, system, messages, tools, ... })          │
│    │                                                           │
│    ▼                                                           │
│  for await (event of result.fullStream)                        │
│    │                                                           │
│    ├─ text-delta → 追加文本到当前 assistant 消息               │
│    ├─ tool-call → 记录工具调用（state: 'call'）                │
│    ├─ tool-result → 更新工具结果（state: 'result'）            │
│    ├─ finish-step → 刷新缓冲区，重置当前 assistant 状态        │
│    ├─ error → 区分流级错误 vs 工具错误                         │
│    │                                                           │
│    ▼                                                           │
│  流结束，返回 { ok: !streamError }                              │
│                                                                │
│  护栏判定:                                                      │
│  ├─ 流级错误 → 停止                                            │
│  ├─ 步数预算耗尽 → 停止                                        │
│  ├─ 非生成类请求 → 停止                                        │
│  ├─ 已产出可播放代码 → 停止                                    │
│  └─ 否则 → continuationRound++，注入催办再跑一轮               │
│                                                                │
└────────────────────────────────────────────────────────────────┘
    │
    ▼
finally:
  ├─ setIsStreaming(false)
  ├─ 取消防抖保存定时器
  └─ saveMessages(projectId, messages)
```

### 4.2 工具调用执行流程（以 write_code 为例）

```
LLM 生成 tool-call: write_code({ code: "..." })
    │
    ▼
AI SDK 调用 tool.execute({ code })
    │
    ├─ validateCode(code) ── 校验失败 → 返回错误信息，模型自纠正
    │
    ├─ clearPreviewIfActive() ── 恢复试听前的原始代码
    │
    ├─ editor.setCode(code) ── 写入编辑器
    │
    ├─ editor.evaluate() ── 执行代码，播放
    │
    ├─ readEngineError(editor) ── 读取引擎错误
    │   ├─ 有错误 → 返回 "Code was written but produced an error..."
    │   └─ 无错误 → 返回 "Code applied successfully and is now playing."
    │
    ▼
工具结果返回给 LLM → LLM 决定下一步（继续修改 / 回复用户）
```

### 4.3 项目隔离流程

```
viewingPatternData 变化
    │
    ▼
useEffect 监听
    │
    ├─ 计算新 projectId (getProjectIdFromPattern)
    │   格式: "pattern_{id}" 或 "hash_{location.hash}"
    │
    ├─ projectId 未变 → 跳过
    │
    ├─ 中止在途流（abortRef.current.abort()）
    ├─ 清除防抖保存定时器
    │
    ├─ 保存旧项目消息 (saveMessages)
    │
    ├─ 切换到新项目
    ├─ 加载新项目消息 (loadMessages)
    └─ 重置统计（tokenUsage/stepCount/finishReason/error）
```

### 4.4 音色试听流程

```
LLM 调用 preview_sound({ soundName })
    │
    ├─ soundRegistry.getSound(soundName) ── 未找到 → 返回错误
    │
    ├─ savedCode === null → 保存当前编辑器代码到 savedCode
    │
    ├─ 根据音色类型生成预览代码
    │   ├─ sample + drum-machines → s("bd sd [~ bd] sd,hh*8").bank(name)
    │   ├─ sample + multi-sample → s(name).n("0 1 2 3 4 5 6 7").slow(2)
    │   ├─ soundfont/synth → note("c3 e3 g3 c4").s(name).room(0.3)
    │   └─ 其他 → s(name)
    │
    ├─ editor.setCode(previewCode) ── 替换为预览代码
    ├─ editor.evaluate() ── 播放预览
    │
    └─ 返回提示（包含 restore_code 指引）

后续恢复：
  ├─ LLM 调用 restore_code → 从 savedCode 恢复原始代码
  └─ 或 LLM 调用 write_code/edit_lines → clearPreviewIfActive() 自动恢复
```

---

## 5. 组件间接口定义

### 5.1 useAgent ↔ AgentSidebar

```typescript
// useAgent 导出
interface AgentAPI {
  messages: Message[];
  isStreaming: boolean;
  tokenUsage: { prompt: number; completion: number; total: number } | null;
  stepCount: number;
  finishReason: string | null;
  error: string | null;
  needsConfig: boolean;
  messagesEndRef: React.RefObject<HTMLElement>;
  sendMessage: (text: string) => Promise<boolean>;
  stop: () => void;
  clearHistory: () => void;
}

// Message 格式
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolInvocations?: ToolInvocation[];
}

// ToolInvocation 格式
interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  args: Record<string, any>;
  state: 'call' | 'partial' | 'result';
  result?: string;
}
```

### 5.2 useAgent ↔ providers

```typescript
// getModel 输入
interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'gemini';
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: string;
}

// toCoreMessages 输入/输出
type UIMessage = Message; // 同上
type CoreMessage = import('ai').CoreMessage; // AI SDK v6 格式
```

### 5.3 useAgent ↔ ContextManager

```typescript
// buildSystemPrompt 输入
interface BuildPromptOptions {
  messages: Message[];
  currentCode: string;
}

// compressMessages 输入/输出
compressMessages(messages: CoreMessage[], maxTokens?: number): CoreMessage[]
```

### 5.4 tools ↔ editorRef

```typescript
// editorRef.current 提供的接口
interface StrudelMirror {
  editor: {
    state: {
      doc: { toString(): string; sliceString(from: number, to: number): string; lines: number; line(n: number): { from: number; to: number } };
      selection: { main: { from: number; to: number; empty: boolean } };
    };
    dispatch(transaction: { changes: { from: number; to: number; insert: string } }): void;
  };
  repl: {
    state: { evalError?: Error; schedulerError?: Error; error?: Error; pattern?: any };
    stop(): void;
    setCps(cps: number): void;
    scheduler: { cps: number; stop(): void };
  };
  setCode(code: string): void;
  evaluate(play?: boolean): Promise<void>;
}
```

### 5.5 tools ↔ SoundRegistry

```typescript
interface SoundInfo {
  name: string;
  type: 'sample' | 'synth' | 'soundfont';
  tag: string | null;
  sampleCount: number;
  category: string;
}

interface SoundQuery {
  category?: string;
  type?: string;
  tag?: string;
  search?: string;
}

// SoundRegistry 接口
class SoundRegistry {
  sync(): void;
  query(filter: SoundQuery): SoundInfo[];
  getSound(name: string): SoundInfo | undefined;
  getCategories(): string[];
  generateSummary(): string;
}
```

### 5.6 storage 接口

```typescript
// IndexedDB 存储结构
interface ConversationRecord {
  projectId: string;  // 主键，格式: "pattern_{id}" | "hash_{hash}" | "default"
  messages: Message[];
  updatedAt: number;  // 时间戳
}

// storage 函数
saveMessages(projectId: string, messages: Message[]): Promise<void>
loadMessages(projectId: string): Promise<Message[]>
clearMessages(projectId: string): Promise<void>
```

### 5.7 store 接口

```typescript
// $modelConfig 持久化 Map
interface ModelConfigMap {
  provider: string;        // 'openai' | 'anthropic' | 'gemini'
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: string;
  temperature: string;
  parallelToolCalls: string;  // 'true' | 'false'
}

// $isAgentOpen 原子
$isAgentOpen: WritableAtom<boolean>
```

---

## 6. 安全机制

### 6.1 代码安全校验

Agent 生成的代码在写入编辑器前经过 `validateCode()` 静态检查：

1. **危险 API 拦截**: `fetch()`, `XMLHttpRequest`, `WebSocket`, `localStorage`, `eval()`, `new Worker()` 等 — 防止提示注入导致数据外泄或任意代码执行
2. **无效方法/函数检查**: `.reverb()`, `.echo()`, `play()`, `melody()` 等 — 防止模型幻觉出不存在的 API
3. **语法检查**: 数组传参、多行字符串、多顶层 pattern 缺少 `$:` 前缀

校验采用三层剥离策略：
- `stripComments()`: 剥离注释（保留字符串）
- `stripStrings()`: 剥离字符串字面量
- 方法/函数名检查在 `stripStrings(stripComments(code))` 上进行，避免误报
- 危险 API 检查在 `stripComments(code)` 上进行（需保留字符串以捕获字符串内的外泄调用）

### 6.2 引擎真实校验

代码写入后自动 `evaluate()` 并读取引擎错误。如果引擎报错，代码不会被播放（前一个 pattern 继续播放），错误信息返回给模型自纠正。

### 6.3 并发防护

- 流进行中拒绝新的 `sendMessage` 调用
- 项目切换时中止在途流
- 默认关闭 `parallelToolCalls`（编辑器类工具共享状态，并行会竞争）

---

## 7. 任务完成护栏

护栏机制确保 Agent 在生成类请求中不会中途停止（如只查询音色不写代码）。

### 7.1 请求分类

`isGenerationRequest(text)` 判定用户消息是否为生成/修改类请求：
- **非生成类**: 提问（how/what/why/...）、控制指令（stop/pause/...）→ 不强制写码
- **生成类**: 包含音乐名词或生成/修改动词 → 必须产出可播放代码

### 7.2 完成判定

`turnProducedPlayingCode(messages, sinceIdx)` 检查本轮是否已产出成功播放的代码：
- 检查 `write_code`/`edit_lines`/`insert_code`/`replace_code` 工具的返回结果
- 匹配 "playing"/"applied successfully"/"inserted at"/"replaced successfully"/"edited lines" 关键词

### 7.3 催办机制

如果生成类请求未产出可播放代码，注入 `CONTINUATION_NUDGE` 催办消息（仅进模型输入，不写入 UI/历史），强制模型继续写出代码。最多催办 3 轮，总步数预算 30 步。

---

## 8. 数据流总结

```
用户输入
  │
  ▼
ChatInput ──► AgentSidebar.handleSend ──► useAgent.sendMessage
  │                                            │
  │                                    ┌───────▼────────┐
  │                                    │ 构建 System     │
  │                                    │ Prompt          │
  │                                    │ (ContextManager) │
  │                                    └───────┬────────┘
  │                                            │
  │                                    ┌───────▼────────┐
  │                                    │ 压缩消息        │
  │                                    │ (ContextManager) │
  │                                    └───────┬────────┘
  │                                            │
  │                                    ┌───────▼────────┐
  │                                    │ 转换消息格式    │
  │                                    │ (providers)     │
  │                                    └───────┬────────┘
  │                                            │
  │                                    ┌───────▼────────┐
  │                                    │ streamText      │
  │                                    │ (AI SDK)        │
  │                                    └───────┬────────┘
  │                                            │
  │                              ┌─────────────┼─────────────┐
  │                              │             │             │
  │                        text-delta     tool-call      error
  │                              │             │             │
  │                              ▼             ▼             ▼
  │                        更新消息状态   执行工具函数    错误处理
  │                              │             │
  │                              │    ┌────────▼────────┐
  │                              │    │ editor.setCode  │
  │                              │    │ editor.evaluate │
  │                              │    │ readEngineError │
  │                              │    └────────┬────────┘
  │                              │             │
  │                              ▼             ▼
  │                        React 状态更新 → UI 重渲染
  │                                            │
  │                                    ┌───────▼────────┐
  │                                    │ 护栏判定        │
  │                                    │ (完成/催办/停止) │
  │                                    └───────┬────────┘
  │                                            │
  │                                    ┌───────▼────────┐
  │                                    │ saveMessages    │
  │                                    │ (IndexedDB)     │
  │                                    └────────────────┘
```

---

## 9. 依赖关系

### 9.1 外部依赖

| 依赖 | 用途 |
|------|------|
| `ai` (Vercel AI SDK) | 流式 LLM 调用、工具定义、消息 schema |
| `@ai-sdk/openai` | OpenAI 兼容提供商 |
| `@ai-sdk/anthropic` | Anthropic 提供商 |
| `@ai-sdk/google` | Gemini 提供商 |
| `nanostores` / `@nanostores/react` / `@nanostores/persistent` | 响应式状态管理 |
| `@strudel/webaudio` | 音频引擎（soundMap、evaluate） |
| `@strudel/codemirror` | 编辑器（StrudelMirror、undo） |
| `@codemirror/commands` | 编辑器命令（undo） |
| `@heroicons/react` | UI 图标 |

### 9.2 内部模块依赖图

```
useAgent.jsx
  ├── providers.mjs
  │     └── ai (SDK)
  ├── tools.mjs
  │     ├── ai (SDK)
  │     ├── SoundRegistry.mjs
  │     │     └── @strudel/webaudio (soundMap)
  │     └── @codemirror/commands
  ├── ContextManager.mjs
  │     └── SoundRegistry.mjs
  ├── storage.mjs
  │     └── IndexedDB
  ├── store.mjs
  │     └── nanostores
  └── user_pattern_utils.mjs

AgentSidebar.jsx
  ├── useAgent.jsx
  ├── ChatMessage.jsx
  ├── ChatInput.jsx
  └── settings.mjs

ReplEditor.jsx
  ├── AgentSidebar.jsx
  ├── Header.jsx
  ├── Code.jsx
  └── useReplContext.jsx
```
