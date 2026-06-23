# Strudel Agent 架构重构方案

## 一、现状问题总结

### 核心问题
1. **缺乏 Agent 抽象** - 只是 LLM 包装器，没有状态机、行为策略、记忆系统
2. **上下文管理简陋** - 硬编码截断，无动态压缩，无代码上下文注入
3. **意图检测混乱** - 逻辑复杂、额外消耗、分类过于简化
4. **工具设计不合理** - 缺少关键工具（selection/cursor/errors），位置参数难用
5. **System Prompt 臃肿** - 443 行，3000+ tokens，无法动态调整
6. **逻辑 UI 紧耦合** - AgentSidebar.jsx 387 行，承担所有职责
7. **缺乏可观测性** - 无工具成功率、性能指标、行为追踪
8. **扩展性差** - 难以添加新工具、多 agent、自定义策略

---

## 二、开源 Agent 框架调研

### 主流框架对比

| 框架 | 语言 | 浏览器支持 | 适用场景 | 是否推荐 |
|------|------|-----------|---------|---------|
| **LangGraph** | Python | ❌ | 复杂工作流、图结构 | ❌ 不适合浏览器 |
| **CrewAI** | Python | ❌ | 多 agent 协作 | ❌ 不适合浏览器 |
| **AutoGen** | Python | ❌ | 已进入维护模式 | ❌ 已废弃 |
| **OpenAI Agents JS** | TypeScript | ✅ | 多 agent 工作流 | ⚠️ 可参考但过重 |
| **Vercel AI SDK** | TypeScript | ✅ | 单 agent、工具调用 | ✅ 当前基础 |
| **Mastra** | TypeScript | ✅ | 生产级 agent | ✅ 值得参考 |
| **Eliza** | TypeScript | ✅ | 社交 agent | ❌ 场景不符 |

### 推荐方案：基于 Vercel AI SDK 自建 Agent 层

**理由**：
1. Vercel AI SDK 已提供底层能力（streamText、工具调用、多模型支持）
2. 浏览器端成熟的 agent 框架稀缺，大多数是 Python
3. Strudel 场景相对简单，不需要复杂的多 agent 编排
4. 自建可以完全控制 agent 行为，针对音乐编程场景优化
5. 可以参考 Mastra、OpenAI Agents JS 的设计模式

---

## 三、重构架构设计

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────┐
│                   UI Layer (React)                   │
│  AgentSidebar.jsx  ChatMessage.jsx  ChatInput.jsx   │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│              Agent Hook Layer (React)                │
│         useAgent.ts  - Agent 状态和交互              │
│         useAgentTools.ts - 工具注册和调用            │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│            Agent Core Layer (Framework-agnostic)     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │ AgentEngine  │  │  Memory      │  │ Context  │  │
│  │ (状态机)     │  │ (记忆系统)   │  │ Manager  │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
│  │  Planner     │  │  Executor    │  │ Observer │  │
│  │ (规划器)     │  │ (执行器)     │  │ (观察器) │  │
│  └──────────────┘  └──────────────┘  └──────────┘  │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│              Tool Layer (Strudel-specific)           │
│  CodeTools  EditorTools  ValidationTools  AudioTools│
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│              LLM Provider Layer (Vercel AI SDK)      │
│         getModel()  streamText()  generateText()    │
└─────────────────────────────────────────────────────┘
```

### 3.2 核心模块设计

#### A. AgentEngine - Agent 状态机

```typescript
// agent/core/AgentEngine.ts
export type AgentState = 
  | 'idle'           // 等待用户输入
  | 'thinking'       // LLM 思考中
  | 'planning'       // 规划步骤
  | 'executing'      // 执行工具
  | 'observing'      // 观察结果
  | 'reflecting'     // 反思和总结
  | 'error';         // 错误状态

export interface AgentConfig {
  maxSteps: number;           // 最大执行步骤
  enableReflection: boolean;  // 是否启用反思
  enablePlanning: boolean;    // 是否启用规划
  contextWindowSize: number;  // 上下文窗口大小
}

export class AgentEngine {
  private state: AgentState = 'idle';
  private steps: AgentStep[] = [];
  private config: AgentConfig;
  
  async run(userMessage: string): Promise<AgentResult> {
    this.state = 'thinking';
    
    // 1. 理解意图（简化版，不再单独调用 LLM）
    const intent = await this.understandIntent(userMessage);
    
    // 2. 规划步骤（可选）
    if (this.config.enablePlanning && intent.complexity > 'simple') {
      this.state = 'planning';
      const plan = await this.createPlan(intent);
    }
    
    // 3. 执行循环
    while (this.steps.length < this.config.maxSteps) {
      this.state = 'executing';
      const result = await this.executeStep();
      
      this.state = 'observing';
      const observation = this.observe(result);
      
      if (this.shouldStop(observation)) break;
      
      // 4. 反思（可选）
      if (this.config.enableReflection) {
        this.state = 'reflecting';
        await this.reflect(observation);
      }
    }
    
    return this.getResult();
  }
}
```

#### B. Memory - 记忆系统

```typescript
// agent/core/Memory.ts
export interface MemoryItem {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'code';
  content: any;
  timestamp: number;
  importance: number;  // 0-1，用于压缩决策
  tokens: number;
}

export class Memory {
  private items: MemoryItem[] = [];
  private maxTokens: number;
  
  // 智能压缩：基于重要性而非简单截断
  compress(): MemoryItem[] {
    const totalTokens = this.items.reduce((sum, item) => sum + item.tokens, 0);
    
    if (totalTokens <= this.maxTokens) {
      return this.items;
    }
    
    // 按重要性排序，保留重要的
    const sorted = [...this.items].sort((a, b) => b.importance - a.importance);
    const compressed: MemoryItem[] = [];
    let currentTokens = 0;
    
    for (const item of sorted) {
      if (currentTokens + item.tokens <= this.maxTokens) {
        compressed.push(item);
        currentTokens += item.tokens;
      }
    }
    
    // 按时间顺序返回
    return compressed.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  // 计算重要性
  calculateImportance(item: MemoryItem): number {
    // 错误和工具结果更重要
    if (item.type === 'error') return 1.0;
    if (item.type === 'tool' && item.content.success === false) return 0.9;
    
    // 最近的更重要
    const age = Date.now() - item.timestamp;
    const recencyScore = Math.max(0, 1 - age / (1000 * 60 * 30)); // 30分钟内
    
    // 代码修改比闲聊重要
    if (item.type === 'tool' && item.content.toolName.includes('code')) {
      return 0.7 + recencyScore * 0.3;
    }
    
    return 0.3 + recencyScore * 0.4;
  }
  
  // 摘要压缩（调用 LLM）
  async summarize(items: MemoryItem[]): Promise<string> {
    const oldMessages = items.map(i => i.content).join('\n');
    const summary = await generateText({
      model: this.model,
      prompt: `Summarize the following conversation concisely:\n${oldMessages}`,
      maxTokens: 200,
    });
    return summary.text;
  }
}
```

#### C. ContextManager - 上下文管理

```typescript
// agent/core/ContextManager.ts
export class ContextManager {
  // 动态构建上下文
  async buildContext(
    memory: Memory,
    editorState: EditorState,
    userMessage: string
  ): Promise<Context> {
    const context: Context = {
      system: await this.buildSystemPrompt(userMessage),
      messages: memory.compress(),
      editor: {
        currentCode: editorState.code,
        selection: editorState.selection,
        cursorPosition: editorState.cursorPosition,
        errors: editorState.errors,
      },
    };
    
    return context;
  }
  
  // 动态 System Prompt
  async buildSystemPrompt(userMessage: string): Promise<string> {
    const basePrompt = CORE_INSTRUCTIONS; // ~500 tokens
    
    // 根据任务类型注入相关参考
    if (this.needsSyntaxReference(userMessage)) {
      return basePrompt + '\n\n' + MINI_NOTATION_REFERENCE;
    }
    
    if (this.needsEffectsReference(userMessage)) {
      return basePrompt + '\n\n' + EFFECTS_REFERENCE;
    }
    
    if (this.needsSoundReference(userMessage)) {
      return basePrompt + '\n\n' + SOUND_SOURCES_REFERENCE;
    }
    
    return basePrompt;
  }
  
  // 注入当前代码上下文
  injectCodeContext(messages: Message[], code: string): Message[] {
    // 如果最近没有 read_code 调用，自动注入
    const hasRecentCode = messages.slice(-5).some(
      m => m.role === 'tool' && m.toolName === 'read_code'
    );
    
    if (!hasRecentCode) {
      messages.push({
        role: 'system',
        content: `[Current editor code]\n${code}`,
      });
    }
    
    return messages;
  }
}
```

#### D. Tool System - 工具系统重构

```typescript
// agent/tools/EditorTools.ts
export const editorTools = {
  // 获取选中的代码
  get_selection: tool({
    description: 'Get the currently selected code in the editor',
    inputSchema: noParams,
    execute: async () => {
      const editor = editorRef.current;
      if (!editor) return 'Editor not available';
      const selection = editor.editor.state.selection.main;
      if (selection.empty) return 'No code selected';
      return editor.editor.state.doc.sliceString(selection.from, selection.to);
    },
  }),
  
  // 获取光标位置
  get_cursor_position: tool({
    description: 'Get the current cursor position (line and column)',
    inputSchema: noParams,
    execute: async () => {
      const editor = editorRef.current;
      if (!editor) return 'Editor not available';
      const pos = editor.editor.state.selection.main.head;
      const line = editor.editor.state.doc.lineAt(pos);
      return JSON.stringify({
        line: line.number,
        column: pos - line.from,
        characterOffset: pos,
      });
    },
  }),
  
  // 获取当前代码错误
  get_errors: tool({
    description: 'Get syntax errors and warnings in the current code',
    inputSchema: noParams,
    execute: async () => {
      const editor = editorRef.current;
      if (!editor) return 'Editor not available';
      const errors = editor.getErrors?.() || [];
      if (errors.length === 0) return 'No errors found';
      return JSON.stringify(errors, null, 2);
    },
  }),
  
  // 撤销上一次修改
  undo: tool({
    description: 'Undo the last code modification',
    inputSchema: noParams,
    execute: async () => {
      const editor = editorRef.current;
      if (!editor) return 'Editor not available';
      editor.editor.undo();
      return 'Undo successful';
    },
  }),
  
  // 改进的 replace_code - 基于文本匹配而非位置
  replace_code: tool({
    description: 'Replace specific code pattern with new code. Provide the exact text to find and replace.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        find: { 
          type: 'string', 
          description: 'The exact code text to find and replace' 
        },
        replace: { 
          type: 'string', 
          description: 'The new code to replace with' 
        },
      },
      required: ['find', 'replace'],
    }),
    execute: async ({ find, replace }) => {
      const editor = editorRef.current;
      if (!editor) return 'Editor not available';
      
      const doc = editor.editor.state.doc.toString();
      const index = doc.indexOf(find);
      
      if (index === -1) {
        return `Error: Could not find the text "${find}" in the editor`;
      }
      
      editor.editor.dispatch({
        changes: { from: index, to: index + find.length, insert: replace },
      });
      
      return 'Code replaced successfully';
    },
  }),
};
```

#### E. useAgent Hook - 分离逻辑和 UI

```typescript
// agent/hooks/useAgent.ts
export function useAgent(editorRef: RefObject<Editor>) {
  const [state, setState] = useState<AgentState>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [metrics, setMetrics] = useState<AgentMetrics>({
    totalTokens: 0,
    toolSuccessRate: 0,
    avgResponseTime: 0,
  });
  
  const engine = useMemo(() => new AgentEngine(), []);
  const memory = useMemo(() => new Memory(), []);
  const contextManager = useMemo(() => new ContextManager(), []);
  
  const sendMessage = useCallback(async (text: string) => {
    setState('thinking');
    const startTime = Date.now();
    
    try {
      // 构建上下文
      const editorState = getEditorState(editorRef.current);
      const context = await contextManager.buildContext(memory, editorState, text);
      
      // 运行 agent
      const result = await engine.run(text, context);
      
      // 更新记忆
      memory.add({ type: 'user', content: text, timestamp: Date.now() });
      memory.add({ type: 'assistant', content: result.response, timestamp: Date.now() });
      
      // 更新指标
      updateMetrics(result, Date.now() - startTime);
      
      setState('idle');
      return result;
    } catch (error) {
      setState('error');
      throw error;
    }
  }, [engine, memory, contextManager, editorRef]);
  
  return {
    state,
    messages,
    metrics,
    sendMessage,
    clearHistory: () => memory.clear(),
  };
}
```

---

## 四、关键技术改进

### 4.1 移除意图检测

**问题**：当前的意图检测逻辑复杂、额外消耗、不准确

**方案**：完全移除，让 LLM 自己决定

```typescript
// 之前
const toolChoice = await detectIntent(model, text, config);
const result = streamText({ toolChoice, ... });

// 之后
const result = streamText({
  toolChoice: 'auto',  // 让 LLM 自己决定
  ...
});
```

**理由**：
- 现代 LLM（GPT-4、Claude）已经能很好地判断何时使用工具
- 减少一次 LLM 调用，节省成本和时间
- 简化代码逻辑

### 4.2 动态 System Prompt

**问题**：443 行的 prompt，每次消耗 3000+ tokens

**方案**：分层注入

```typescript
// 核心指令（~500 tokens）
const CORE_INSTRUCTIONS = `
You are an expert AI assistant for Strudel, a music live-coding environment.
Help users write, modify, and debug Strudel code.
Always use the provided tools to read and modify the editor code.
`;

// 按需注入
const MINI_NOTATION_REFERENCE = `...`; // ~800 tokens
const EFFECTS_REFERENCE = `...`;       // ~600 tokens
const SOUND_SOURCES_REFERENCE = `...`; // ~1000 tokens

// 根据用户问题动态选择
function buildSystemPrompt(userMessage: string): string {
  let prompt = CORE_INSTRUCTIONS;
  
  if (needsSyntaxReference(userMessage)) {
    prompt += '\n\n' + MINI_NOTATION_REFERENCE;
  }
  
  if (needsEffectsReference(userMessage)) {
    prompt += '\n\n' + EFFECTS_REFERENCE;
  }
  
  return prompt;
}
```

**效果**：
- 简单问题：~500 tokens（节省 80%）
- 复杂问题：~1500 tokens（节省 50%）

### 4.3 智能上下文压缩

**问题**：硬编码保留 20 轮，不考虑 token 限制

**方案**：基于重要性的动态压缩

```typescript
// 计算消息重要性
function calculateImportance(message: Message): number {
  // 错误和工具失败最重要
  if (message.role === 'tool' && message.content?.success === false) return 1.0;
  if (message.content?.includes('Error')) return 0.9;
  
  // 代码修改比闲聊重要
  if (message.toolName?.includes('code')) return 0.7;
  
  // 最近的消息更重要
  const age = Date.now() - message.timestamp;
  const recency = Math.max(0, 1 - age / (1000 * 60 * 30)); // 30分钟衰减
  
  return 0.3 + recency * 0.4;
}

// 压缩策略
async function compressMessages(messages: Message[], maxTokens: number): Promise<Message[]> {
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  
  if (totalTokens <= maxTokens) return messages;
  
  // 1. 按重要性排序
  const sorted = [...messages].sort((a, b) => 
    calculateImportance(b) - calculateImportance(a)
  );
  
  // 2. 保留重要的消息
  const kept: Message[] = [];
  let currentTokens = 0;
  
  for (const msg of sorted) {
    const tokens = estimateTokens(msg);
    if (currentTokens + tokens <= maxTokens) {
      kept.push(msg);
      currentTokens += tokens;
    }
  }
  
  // 3. 如果还有空间，添加摘要
  if (currentTokens < maxTokens * 0.8) {
    const removed = messages.filter(m => !kept.includes(m));
    if (removed.length > 3) {
      const summary = await summarize(removed);
      kept.unshift({
        role: 'system',
        content: `[Earlier conversation summary]\n${summary}`,
      });
    }
  }
  
  // 4. 按时间顺序返回
  return kept.sort((a, b) => a.timestamp - b.timestamp);
}
```

### 4.4 可观测性增强

```typescript
// agent/core/Metrics.ts
export interface AgentMetrics {
  // 性能指标
  totalTokens: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  
  // 工具指标
  toolCalls: number;
  toolSuccessRate: number;
  toolFailureReasons: Record<string, number>;
  
  // 质量指标
  userSatisfaction?: number;  // 可以通过反馈收集
  conversationLength: number;
  
  // 成本指标
  estimatedCost: number;
}

export class MetricsCollector {
  private metrics: AgentMetrics = {
    totalTokens: 0,
    avgResponseTime: 0,
    p95ResponseTime: 0,
    toolCalls: 0,
    toolSuccessRate: 0,
    toolFailureReasons: {},
    conversationLength: 0,
    estimatedCost: 0,
  };
  
  recordToolCall(toolName: string, success: boolean, duration: number) {
    this.metrics.toolCalls++;
    
    if (success) {
      const successes = this.metrics.toolSuccessRate * (this.metrics.toolCalls - 1);
      this.metrics.toolSuccessRate = (successes + 1) / this.metrics.toolCalls;
    } else {
      this.metrics.toolFailureReasons[toolName] = 
        (this.metrics.toolFailureReasons[toolName] || 0) + 1;
    }
  }
  
  // 导出指标（可用于调试和优化）
  export(): AgentMetrics {
    return { ...this.metrics };
  }
}
```

---

## 五、实施计划

### Phase 1: 基础重构（2-3 周）

**目标**：分离逻辑和 UI，建立 agent 抽象

1. **创建 Agent Core 层**
   - [ ] 实现 AgentEngine 状态机
   - [ ] 实现 Memory 记忆系统
   - [ ] 实现 ContextManager 上下文管理

2. **重构工具系统**
   - [ ] 添加 get_selection、get_cursor_position、get_errors、undo 工具
   - [ ] 改进 replace_code（基于文本匹配）
   - [ ] 工具验证失败时提供修复建议

3. **分离逻辑和 UI**
   - [ ] 创建 useAgent hook
   - [ ] 将 AgentSidebar 中的逻辑移到 hook
   - [ ] UI 组件只负责渲染

**验收标准**：
- AgentSidebar.jsx 减少到 100 行以内
- 工具成功率提升 20%
- 可以单元测试 agent 逻辑

### Phase 2: 智能优化（2 周）

**目标**：提升 agent 智能水平和效率

1. **移除意图检测**
   - [ ] 删除 detectIntent 相关代码
   - [ ] 使用 toolChoice: 'auto'

2. **动态 System Prompt**
   - [ ] 拆分 SYSTEM_PROMPT 为核心 + 参考
   - [ ] 实现按需注入逻辑
   - [ ] 测试 token 节省效果

3. **智能上下文压缩**
   - [ ] 实现重要性评估
   - [ ] 实现动态压缩算法
   - [ ] 添加摘要功能

**验收标准**：
- System prompt token 减少 50%
- 上下文利用率提升 30%
- 响应时间减少 20%

### Phase 3: 可观测性和优化（1-2 周）

**目标**：建立完整的监控和优化体系

1. **可观测性**
   - [ ] 实现 MetricsCollector
   - [ ] 添加工具成功率统计
   - [ ] 添加性能指标（响应时间、token 使用）

2. **错误处理优化**
   - [ ] 添加重试机制（网络错误、API 限流）
   - [ ] 工具失败时提供恢复建议
   - [ ] 友好的错误分类和提示

3. **调试工具**
   - [ ] Agent 行为可视化（状态转换、工具调用链）
   - [ ] 导出对话和指标用于分析

**验收标准**：
- 可以追踪所有工具调用和性能指标
- 错误恢复成功率提升 50%
- 可以可视化 agent 行为

### Phase 4: 高级功能（可选，3-4 周）

**目标**：支持更复杂的 agent 行为

1. **多步骤工作流**
   - [ ] 定义工作流模板（如 "修改→执行→验证"）
   - [ ] 工作流引擎
   - [ ] 失败回滚机制

2. **多 Agent 支持**
   - [ ] Agent 路由（根据任务选择不同 agent）
   - [ ] Agent 协作（如 "作曲家" + "编曲家"）
   - [ ] Agent 切换 UI

3. **自定义 Agent**
   - [ ] Agent 配置界面
   - [ ] 自定义工具和策略
   - [ ] Agent 插件系统

---

## 六、技术选型决策

### 为什么不用 LangGraph / CrewAI / AutoGen？

| 框架 | 问题 |
|------|------|
| **LangGraph** | Python 为主，浏览器支持差，过于复杂 |
| **CrewAI** | Python 为主，面向多 agent 协作，场景不符 |
| **AutoGen** | 已进入维护模式，微软转向 Agent Framework |
| **OpenAI Agents JS** | 过于重量级，面向通用场景，不够灵活 |

### 为什么基于 Vercel AI SDK 自建？

1. **已在使用** - 项目已经使用 Vercel AI SDK，无需引入新依赖
2. **浏览器友好** - Vercel AI SDK 原生支持浏览器
3. **轻量灵活** - 可以完全控制 agent 行为，针对 Strudel 优化
4. **生态成熟** - Vercel AI SDK 社区活跃，文档完善
5. **成本可控** - 不需要引入大型框架，减少包体积

### 可以借鉴的设计

1. **Mastra** - 生产级 agent 设计模式
2. **OpenAI Agents JS** - 多 agent 工作流（未来扩展）
3. **LangGraph** - 状态机和图结构（简化版）

---

## 七、风险和缓解

### 风险 1: 重构周期长

**缓解**：
- 分阶段实施，每个阶段都有可交付成果
- Phase 1 完成后就可以获得收益（代码质量提升）
- 保持向后兼容，不影响现有功能

### 风险 2: 自建 agent 层复杂度高

**缓解**：
- 从简单开始，逐步迭代
- 参考成熟的开源项目（Mastra、OpenAI Agents JS）
- 先实现核心功能，高级功能按需添加

### 风险 3: 性能问题

**缓解**：
- 智能上下文压缩减少 token 使用
- 动态 system prompt 减少不必要的信息
- 缓存和预计算优化性能

### 风险 4: 测试困难

**缓解**：
- 分离逻辑和 UI，便于单元测试
- 使用 mock LLM 和工具进行测试
- 建立端到端测试框架

---

## 八、成功指标

### 代码质量指标
- AgentSidebar.jsx 行数：387 → <100
- 测试覆盖率：0% → >70%
- 代码复杂度降低 50%

### 性能指标
- System prompt token：3000+ → <1500
- 平均响应时间：减少 30%
- Token 使用：减少 40%

### 功能指标
- 工具成功率：提升 20%
- 错误恢复成功率：提升 50%
- 用户满意度：提升 30%

### 扩展性指标
- 添加新工具的时间：1天 → 1小时
- 支持多 agent：不支持 → 支持
- 自定义策略：不支持 → 支持

---

## 九、总结

### 核心改进

1. **建立真正的 Agent 抽象** - 状态机、记忆系统、上下文管理
2. **分离逻辑和 UI** - useAgent hook，便于测试和维护
3. **智能上下文管理** - 基于重要性的压缩，动态 system prompt
4. **改进工具设计** - 添加关键工具，改进易用性
5. **增强可观测性** - 完整的指标和调试工具

### 技术路线

- **基于 Vercel AI SDK 自建** - 轻量、灵活、浏览器友好
- **分阶段实施** - 4 个阶段，每个阶段都有可交付成果
- **渐进式重构** - 保持向后兼容，不影响现有功能

### 预期收益

- **代码质量** - 更清晰、更易测试、更易维护
- **性能提升** - token 使用减少 40%，响应时间减少 30%
- **功能增强** - 更智能的 agent，更好的用户体验
- **扩展性** - 易于添加新工具、多 agent、自定义策略

---

## 十、参考资料

- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
- [Mastra Agent Patterns](https://mastra.ai/docs)
- [OpenAI Agents JS SDK](https://github.com/openai/openai-agents-js)
- [LangGraph State Machine Patterns](https://langchain-ai.github.io/langgraph/)
- [Building Effective Agents - Anthropic](https://www.anthropic.com/research/building-effective-agents)
