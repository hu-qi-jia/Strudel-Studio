# Strudel Agent 详细设计文档

## 一、当前 Agent 能力分析

### 1.1 当前能力

**能做到的**：
- ✅ 通过工具读写编辑器代码
- ✅ 代码验证（检查无效方法如 `.reverb()`、`.echo()`）
- ✅ System Prompt 包含完整的 Strudel 语法参考（443行）
- ✅ 执行和停止播放

**做不到的**：
- ❌ **无法动态查询可用音色** - System Prompt 中硬编码了音色列表，但实际加载的音色可能不同
- ❌ **无法浏览采样库** - 不知道当前有哪些 drum machine、GM soundfont、VCSL 音色
- ❌ **无法预览音色** - 用户问"有什么钢琴音色"时，agent 只能猜测
- ❌ **无法获取错误信息** - 代码执行失败时，agent 不知道具体错误
- ❌ **无法获取选中代码** - 用户说"修改这段"时，agent 不知道是哪段
- ❌ **上下文管理简陋** - 硬编码保留20轮，不考虑 token 限制
- ❌ **System Prompt 臃肿** - 每次请求消耗 3000+ tokens

### 1.2 Strudel 音色系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Sound Sources                         │
├─────────────────────────────────────────────────────────┤
│ 1. Drum Samples (default bank)                           │
│    bd, sd, hh, oh, cp, cr, rd, ht, mt, lt, rim, ...   │
│    来源: dirt-samples, uzu-drumkit                       │
├─────────────────────────────────────────────────────────┤
│ 2. Drum Machines (tag: 'drum-machines')                  │
│    TR808, TR909, TR707, ..., RolandTR808, ...          │
│    来源: tidal-drum-machines                             │
├─────────────────────────────────────────────────────────┤
│ 3. GM Soundfonts (128 instruments)                       │
│    gm_piano, gm_violin, gm_trumpet, ...                 │
│    来源: packages/soundfonts/gm.mjs                      │
├─────────────────────────────────────────────────────────┤
│ 4. VCSL Orchestral Samples                               │
│    ballwhistle, bassdrum1, bongo, conga, ...            │
│    来源: github:sgossner/VCSL                            │
├─────────────────────────────────────────────────────────┤
│ 5. Synths                                                │
│    sine, triangle, square, sawtooth, supersaw, ...      │
│    来源: registerSynthSounds()                           │
├─────────────────────────────────────────────────────────┤
│ 6. ZZFX Synths                                           │
│    z_sine, z_sawtooth, z_triangle, ...                  │
│    来源: registerZZFXSounds()                            │
├─────────────────────────────────────────────────────────┤
│ 7. Piano                                                 │
│    piano (multi-sampled, A0-C8)                          │
│    来源: piano.json                                      │
├─────────────────────────────────────────────────────────┤
│ 8. Special Samples                                       │
│    casio, crow, insect, wind, jazz, metal, east, ...    │
│    来源: dirt-samples                                    │
└─────────────────────────────────────────────────────────┘
```

**关键数据结构**：
- `soundMap` (from `@strudel/webaudio`) - 运行时所有可用音色的 Map 对象
- 每个音色包含: `{ data: { type, tag, samples, fonts }, onTrigger }`
- `type`: 'sample' | 'synth' | 'soundfont'
- `tag`: 'drum-machines' | undefined

---

## 二、Agent 架构设计

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                      UI Layer (React)                        │
│  AgentSidebar.jsx  ChatMessage.jsx  ChatInput.jsx           │
│  - 只负责渲染和用户交互                                      │
│  - 通过 useAgent hook 获取状态和数据                         │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                 Agent Hook Layer (React)                     │
│  useAgent.ts - Agent 状态管理、消息处理、流式响应             │
│  - 封装所有 agent 逻辑                                       │
│  - 暴露简洁的 API 给 UI                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Agent Core Layer (Framework-agnostic)           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ AgentEngine  │  │    Memory    │  │ ContextManager   │  │
│  │ (状态机)     │  │ (记忆系统)   │  │ (上下文构建)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ SoundRegistry│  │ CodeValidator│  │ MetricsCollector │  │
│  │ (音色注册表) │  │ (代码验证)   │  │ (指标收集)       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                Tool Layer (Strudel-specific)                 │
│  CodeTools      - 代码读写工具                               │
│  EditorTools    - 编辑器交互工具（selection, cursor, errors）│
│  SoundTools     - 音色查询和预览工具                         │
│  PlaybackTools  - 播放控制工具                               │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              LLM Provider Layer (Vercel AI SDK)              │
│  getModel()  streamText()  generateText()                   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块设计

#### A. SoundRegistry - 音色注册表（核心创新）

```typescript
// agent/core/SoundRegistry.ts
import { soundMap } from '@strudel/webaudio';

export interface SoundInfo {
  name: string;
  type: 'sample' | 'synth' | 'soundfont';
  tag?: string;
  sampleCount?: number;
  category: string; // 人类可读的分类
  description?: string;
}

export class SoundRegistry {
  private sounds: Map<string, SoundInfo> = new Map();
  private lastUpdate: number = 0;
  private updateInterval: number = 5000; // 5秒更新一次

  // 从 soundMap 同步音色信息
  sync(): void {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval) return;
    
    this.sounds.clear();
    
    for (const [name, entry] of Object.entries(soundMap)) {
      if (name.startsWith('_')) continue;
      
      const { data } = entry;
      const info: SoundInfo = {
        name,
        type: data.type,
        tag: data.tag,
        category: this.categorize(data),
      };
      
      if (data.type === 'sample') {
        info.sampleCount = Array.isArray(data.samples) 
          ? data.samples.length 
          : Object.keys(data.samples).length;
      } else if (data.type === 'soundfont') {
        info.sampleCount = data.fonts?.length || 0;
      }
      
      this.sounds.set(name, info);
    }
    
    this.lastUpdate = now;
  }

  // 分类音色
  private categorize(data: any): string {
    if (data.type === 'synth') return 'Synths';
    if (data.type === 'soundfont') return 'GM Soundfonts';
    if (data.tag === 'drum-machines') return 'Drum Machines';
    if (['piano', 'casio', 'jazz', 'metal', 'east'].includes(data.name)) {
      return 'Special Samples';
    }
    return 'Samples';
  }

  // 查询音色
  query(filter?: {
    type?: string;
    category?: string;
    search?: string;
  }): SoundInfo[] {
    this.sync();
    
    let results = Array.from(this.sounds.values());
    
    if (filter?.type) {
      results = results.filter(s => s.type === filter.type);
    }
    
    if (filter?.category) {
      results = results.filter(s => s.category === filter.category);
    }
    
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(s => 
        s.name.toLowerCase().includes(search) ||
        s.category.toLowerCase().includes(search)
      );
    }
    
    return results;
  }

  // 获取音色详情
  getSound(name: string): SoundInfo | undefined {
    this.sync();
    return this.sounds.get(name);
  }

  // 获取所有分类
  getCategories(): string[] {
    this.sync();
    const categories = new Set<string>();
    for (const sound of this.sounds.values()) {
      categories.add(sound.category);
    }
    return Array.from(categories).sort();
  }

  // 生成音色列表摘要（用于 System Prompt）
  generateSummary(): string {
    this.sync();
    
    const byCategory = new Map<string, SoundInfo[]>();
    for (const sound of this.sounds.values()) {
      if (!byCategory.has(sound.category)) {
        byCategory.set(sound.category, []);
      }
      byCategory.get(sound.category)!.push(sound);
    }
    
    let summary = '## Available Sounds\n\n';
    
    for (const [category, sounds] of byCategory) {
      summary += `### ${category} (${sounds.length})\n`;
      
      // 每个分类最多显示20个
      const display = sounds.slice(0, 20);
      const names = display.map(s => {
        let desc = `\`${s.name}\``;
        if (s.sampleCount && s.sampleCount > 1) {
          desc += `(${s.sampleCount})`;
        }
        return desc;
      }).join(', ');
      
      summary += names;
      if (sounds.length > 20) {
        summary += `, ... and ${sounds.length - 20} more`;
      }
      summary += '\n\n';
    }
    
    return summary;
  }
}
```

#### B. ContextManager - 智能上下文构建

```typescript
// agent/core/ContextManager.ts
import { SoundRegistry } from './SoundRegistry';

export class ContextManager {
  private soundRegistry: SoundRegistry;
  
  constructor(soundRegistry: SoundRegistry) {
    this.soundRegistry = soundRegistry;
  }

  // 动态构建 System Prompt
  async buildSystemPrompt(userMessage: string): Promise<string> {
    // 核心指令（~500 tokens）
    let prompt = this.getCoreInstructions();
    
    // 根据用户问题注入相关参考
    if (this.needsSyntaxReference(userMessage)) {
      prompt += '\n\n' + this.getMiniNotationReference();
    }
    
    if (this.needsEffectsReference(userMessage)) {
      prompt += '\n\n' + this.getEffectsReference();
    }
    
    // 始终注入可用音色摘要（动态生成）
    prompt += '\n\n' + this.soundRegistry.generateSummary();
    
    return prompt;
  }

  private getCoreInstructions(): string {
    return `You are an expert AI assistant for Strudel, a music live-coding environment.
Help users write, modify, and debug Strudel code.

## CORE WORKFLOW
1. Use \`read_code\` to see current code
2. Use \`write_code\` or \`replace_code\` to modify
3. Use \`execute_code\` to play the result
4. Explain changes clearly

## CRITICAL RULES
- Use mini notation strings: note("c3 e3 g3"), NOT arrays
- Use valid methods only: .room().size() for reverb, NOT .reverb()
- Use valid sound names from the available sounds list above
- All strings must be on a single line (no multi-line strings)`;
  }

  private needsSyntaxReference(message: string): boolean {
    const keywords = ['mini notation', 'pattern', 'syntax', 'how to', 'write', 'create'];
    return keywords.some(k => message.toLowerCase().includes(k));
  }

  private needsEffectsReference(message: string): boolean {
    const keywords = ['effect', 'reverb', 'delay', 'filter', 'room', 'pan'];
    return keywords.some(k => message.toLowerCase().includes(k));
  }

  private getMiniNotationReference(): string {
    // ~800 tokens
    return `## Mini Notation Syntax
| Syntax | Meaning | Example |
|--------|---------|---------|
| space | sequence | "bd sd hh oh" |
| [] | sub-cycle | "bd [hh hh] sd" |
| <> | alternating | "<bd sd hh>" |
| , | parallel | "bd*2, hh*4" |
| *n | repeat | "bd*4" |
| /n | slow | "[c a f e]/2" |
| ~ | rest | "bd ~ sd ~" |
| :n | sample variant | "hh:0 hh:1" |
| ? | random removal | "bd*8?" |
| (n,m) | Euclidean | "bd(3,8)" |`;
  }

  private getEffectsReference(): string {
    // ~600 tokens
    return `## Effects
.room(0.7) - reverb amount
.size(0.8) - reverb room size
.delay(0.5) - delay amount
.delaytime(0.25) - delay time
.delayfeedback(0.7) - delay feedback
.lpf(1000) - low-pass filter
.hpf(500) - high-pass filter
.pan(0.5) - stereo position
.gain(0.8) - volume`;
  }

  // 构建完整上下文
  async buildContext(
    memory: MemoryItem[],
    editorState: EditorState,
    userMessage: string
  ): Promise<Context> {
    return {
      system: await this.buildSystemPrompt(userMessage),
      messages: this.compressMessages(memory),
      editor: {
        currentCode: editorState.code,
        selection: editorState.selection,
        cursorPosition: editorState.cursorPosition,
        errors: editorState.errors,
      },
    };
  }

  // 智能压缩消息
  private compressMessages(messages: MemoryItem[]): MemoryItem[] {
    const maxTokens = 8000; // 预留 8k tokens 给对话历史
    let totalTokens = messages.reduce((sum, m) => sum + this.estimateTokens(m), 0);
    
    if (totalTokens <= maxTokens) return messages;
    
    // 按重要性排序
    const sorted = [...messages].sort((a, b) => 
      this.calculateImportance(b) - this.calculateImportance(a)
    );
    
    // 保留重要的消息
    const kept: MemoryItem[] = [];
    let currentTokens = 0;
    
    for (const msg of sorted) {
      const tokens = this.estimateTokens(msg);
      if (currentTokens + tokens <= maxTokens) {
        kept.push(msg);
        currentTokens += tokens;
      }
    }
    
    // 按时间顺序返回
    return kept.sort((a, b) => a.timestamp - b.timestamp);
  }

  private calculateImportance(item: MemoryItem): number {
    if (item.type === 'error') return 1.0;
    if (item.type === 'tool' && item.content?.success === false) return 0.9;
    if (item.type === 'tool' && item.content?.toolName?.includes('code')) return 0.7;
    
    const age = Date.now() - item.timestamp;
    const recency = Math.max(0, 1 - age / (1000 * 60 * 30)); // 30分钟衰减
    
    return 0.3 + recency * 0.4;
  }

  private estimateTokens(item: MemoryItem): number {
    const content = typeof item.content === 'string' 
      ? item.content 
      : JSON.stringify(item.content);
    return Math.ceil(content.length / 4); // 粗略估计
  }
}
```

#### C. Enhanced Tools - 增强的工具系统

```typescript
// agent/tools/SoundTools.ts
import { tool, jsonSchema } from 'ai';
import { SoundRegistry } from '../core/SoundRegistry';

export function createSoundTools(soundRegistry: SoundRegistry, editorRef: any) {
  return {
    // 查询可用音色
    list_sounds: tool({
      description: 'List available sounds in Strudel. Use this to discover what sounds are available before writing code.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          category: { 
            type: 'string',
            description: 'Filter by category: "Drum Machines", "GM Soundfonts", "Samples", "Synths", etc.'
          },
          search: { 
            type: 'string',
            description: 'Search term to filter sounds by name'
          },
        },
        required: [],
      }),
      execute: async ({ category, search }) => {
        const sounds = soundRegistry.query({ category, search });
        
        if (sounds.length === 0) {
          return 'No sounds found matching the criteria.';
        }
        
        const formatted = sounds.map(s => {
          let desc = s.name;
          if (s.sampleCount && s.sampleCount > 1) {
            desc += ` (${s.sampleCount} samples)`;
          }
          return desc;
        }).join('\n');
        
        return `Found ${sounds.length} sounds:\n${formatted}`;
      },
    }),

    // 获取音色详情
    get_sound_info: tool({
      description: 'Get detailed information about a specific sound, including sample count and usage examples.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          soundName: { 
            type: 'string',
            description: 'The name of the sound to query'
          },
        },
        required: ['soundName'],
      }),
      execute: async ({ soundName }) => {
        const sound = soundRegistry.getSound(soundName);
        
        if (!sound) {
          return `Sound "${soundName}" not found. Use list_sounds to see available sounds.`;
        }
        
        let info = `Sound: ${sound.name}\n`;
        info += `Category: ${sound.category}\n`;
        info += `Type: ${sound.type}\n`;
        
        if (sound.sampleCount) {
          info += `Samples: ${sound.sampleCount}\n`;
        }
        
        // 添加使用示例
        info += '\nUsage examples:\n';
        
        if (sound.type === 'sample') {
          if (sound.sampleCount && sound.sampleCount > 1) {
            info += `s("${sound.name}").n("0 1 2 3")\n`;
          } else {
            info += `s("${sound.name}")\n`;
          }
        } else if (sound.type === 'soundfont') {
          info += `note("c3 e3 g3").s("${sound.name}")\n`;
        } else if (sound.type === 'synth') {
          info += `note("c3 e3 g3").s("${sound.name}")\n`;
        }
        
        return info;
      },
    }),

    // 预览音色
    preview_sound: tool({
      description: 'Preview a sound by playing a short pattern. Use this to let the user hear a sound before using it in code.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          soundName: { 
            type: 'string',
            description: 'The name of the sound to preview'
          },
        },
        required: ['soundName'],
      }),
      execute: async ({ soundName }) => {
        const sound = soundRegistry.getSound(soundName);
        
        if (!sound) {
          return `Sound "${soundName}" not found.`;
        }
        
        const editor = editorRef.current;
        if (!editor) return 'Editor not available';
        
        // 生成预览代码
        let previewCode: string;
        
        if (sound.type === 'sample') {
          if (sound.sampleCount && sound.sampleCount > 1) {
            previewCode = `s("${soundName}").n("0 1 2 3 4 5 6 7").slow(2)`;
          } else {
            previewCode = `s("${soundName}")`;
          }
        } else if (sound.type === 'soundfont' || sound.type === 'synth') {
          previewCode = `note("c3 e3 g3 c4").s("${soundName}").room(0.3)`;
        } else {
          previewCode = `s("${soundName}")`;
        }
        
        // 写入并执行
        editor.setCode(previewCode);
        editor.evaluate();
        
        return `Previewing sound: ${soundName}\nCode: ${previewCode}`;
      },
    }),
  };
}

// agent/tools/EditorTools.ts
export function createEditorTools(editorRef: any) {
  return {
    // 获取选中的代码
    get_selection: tool({
      description: 'Get the currently selected code in the editor. Use this when the user refers to "this" or "selected code".',
      inputSchema: jsonSchema({ type: 'object', properties: {}, required: [] }),
      execute: async () => {
        const editor = editorRef.current;
        if (!editor) return 'Editor not available';
        
        const selection = editor.editor.state.selection.main;
        if (selection.empty) return 'No code selected. The user needs to select some code first.';
        
        return editor.editor.state.doc.sliceString(selection.from, selection.to);
      },
    }),

    // 获取光标位置
    get_cursor_position: tool({
      description: 'Get the current cursor position (line and column).',
      inputSchema: jsonSchema({ type: 'object', properties: {}, required: [] }),
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

    // 获取代码错误
    get_errors: tool({
      description: 'Get syntax errors and warnings in the current code. Use this after execute_code fails to understand what went wrong.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, required: [] }),
      execute: async () => {
        const editor = editorRef.current;
        if (!editor) return 'Editor not available';
        
        // TODO: 需要从 StrudelMirror 获取错误信息
        // 目前 StrudelMirror 可能没有暴露错误 API
        // 可以通过监听 repl 的错误事件来获取
        const errors = editor.getErrors?.() || [];
        
        if (errors.length === 0) return 'No errors found';
        
        return JSON.stringify(errors, null, 2);
      },
    }),

    // 撤销
    undo: tool({
      description: 'Undo the last code modification.',
      inputSchema: jsonSchema({ type: 'object', properties: {}, required: [] }),
      execute: async () => {
        const editor = editorRef.current;
        if (!editor) return 'Editor not available';
        
        editor.editor.undo();
        return 'Undo successful';
      },
    }),

    // 改进的 replace_code - 基于文本匹配
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
          return `Error: Could not find the text "${find}" in the editor. Make sure to provide the exact text to replace.`;
        }
        
        editor.editor.dispatch({
          changes: { from: index, to: index + find.length, insert: replace },
        });
        
        return 'Code replaced successfully';
      },
    }),
  };
}
```

#### D. useAgent Hook - 分离逻辑和 UI

```typescript
// agent/hooks/useAgent.ts
import { useState, useCallback, useMemo, useRef } from 'react';
import { streamText } from 'ai';
import { getModel, getProviderOptions } from '../providers.mjs';
import { SoundRegistry } from '../core/SoundRegistry';
import { ContextManager } from '../core/ContextManager';
import { Memory, type MemoryItem } from '../core/Memory';
import { createSoundTools } from '../tools/SoundTools';
import { createEditorTools } from '../tools/EditorTools';
import { createCodeTools } from '../tools/CodeTools';
import { saveMessages, loadMessages, getProjectId } from '../storage.mjs';

export interface AgentState {
  isStreaming: boolean;
  messages: Message[];
  tokenUsage: TokenUsage | null;
  stepCount: number;
  error: string | null;
}

export function useAgent(editorRef: any, modelConfig: any) {
  const [state, setState] = useState<AgentState>({
    isStreaming: false,
    messages: [],
    tokenUsage: null,
    stepCount: 0,
    error: null,
  });
  
  const abortRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<any>(null);
  
  // 初始化核心模块
  const soundRegistry = useMemo(() => new SoundRegistry(), []);
  const contextManager = useMemo(() => new ContextManager(soundRegistry), [soundRegistry]);
  const memory = useMemo(() => new Memory(), []);
  
  // 创建工具
  const tools = useMemo(() => ({
    ...createSoundTools(soundRegistry, editorRef),
    ...createEditorTools(editorRef),
    ...createCodeTools(editorRef),
  }), [soundRegistry, editorRef]);

  // 加载历史消息
  const loadHistory = useCallback(async () => {
    const projectId = getProjectId();
    const saved = await loadMessages(projectId);
    if (saved.length > 0) {
      setState(prev => ({ ...prev, messages: saved }));
      memory.loadFromMessages(saved);
    }
  }, [memory]);

  // 发送消息
  const sendMessage = useCallback(async (text: string) => {
    if (!modelConfig.apiKey) {
      setState(prev => ({ ...prev, error: 'API key not configured' }));
      return;
    }

    const userMessage: Message = {
      id: nextId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isStreaming: true,
      tokenUsage: null,
      stepCount: 0,
      error: null,
    }));

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // 构建上下文
      const editorState = getEditorState(editorRef.current);
      const context = await contextManager.buildContext(
        memory.getItems(),
        editorState,
        text
      );

      const model = getModel(modelConfig);

      const result = streamText({
        model,
        system: context.system,
        messages: context.messages,
        tools,
        toolChoice: 'auto',
        maxSteps: 5,
        maxTokens: parseInt(modelConfig.maxTokens, 10) || 4096,
        providerOptions: getProviderOptions(modelConfig),
        abortSignal: abortController.signal,
        onStepFinish: ({ usage }) => {
          if (usage) {
            setState(prev => ({
              ...prev,
              stepCount: prev.stepCount + 1,
              tokenUsage: {
                prompt: (prev.tokenUsage?.prompt || 0) + (usage.inputTokens || 0),
                completion: (prev.tokenUsage?.completion || 0) + (usage.outputTokens || 0),
                total: (prev.tokenUsage?.total || 0) + (usage.inputTokens || 0) + (usage.outputTokens || 0),
              },
            }));
          }
        },
      });

      // 处理流式响应
      let currentAssistantId = nextId();
      let currentContent = '';
      let currentToolInvocations: ToolInvocation[] = [];

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, {
          id: currentAssistantId,
          role: 'assistant',
          content: '',
          toolInvocations: [],
          timestamp: Date.now(),
        }],
      }));

      for await (const event of result.fullStream) {
        switch (event.type) {
          case 'text-delta': {
            currentContent += event.text;
            setState(prev => ({
              ...prev,
              messages: prev.messages.map(m =>
                m.id === currentAssistantId
                  ? { ...m, content: currentContent }
                  : m
              ),
            }));
            break;
          }

          case 'tool-call': {
            currentToolInvocations.push({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.input,
              state: 'call',
            });
            setState(prev => ({
              ...prev,
              messages: prev.messages.map(m =>
                m.id === currentAssistantId
                  ? { ...m, toolInvocations: [...currentToolInvocations] }
                  : m
              ),
            }));
            break;
          }

          case 'tool-result': {
            currentToolInvocations = currentToolInvocations.map(inv =>
              inv.toolCallId === event.toolCallId
                ? { ...inv, state: 'result', result: event.output }
                : inv
            );
            setState(prev => ({
              ...prev,
              messages: prev.messages.map(m =>
                m.id === currentAssistantId
                  ? { ...m, toolInvocations: [...currentToolInvocations] }
                  : m
              ),
            }));
            break;
          }

          case 'finish-step': {
            currentAssistantId = nextId();
            currentContent = '';
            currentToolInvocations = [];
            break;
          }

          case 'error': {
            const errorMsg = event.error?.message || String(event.error);
            setState(prev => ({ ...prev, error: errorMsg }));
            break;
          }
        }
      }

      // 更新记忆
      memory.add({ type: 'user', content: text, timestamp: Date.now() });
      memory.add({ type: 'assistant', content: currentContent, timestamp: Date.now() });

      // 保存消息
      saveMessagesToStorage(state.messages);

    } catch (e) {
      if (e.name !== 'AbortError') {
        const errorMsg = e.message || String(e);
        setState(prev => ({ ...prev, error: errorMsg }));
      }
    } finally {
      setState(prev => ({ ...prev, isStreaming: false }));
      abortRef.current = null;
    }
  }, [modelConfig, tools, contextManager, memory, editorRef]);

  // 停止生成
  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  // 清空历史
  const clearHistory = useCallback(() => {
    setState(prev => ({ ...prev, messages: [] }));
    memory.clear();
    clearMessagesFromStorage();
  }, [memory]);

  return {
    ...state,
    sendMessage,
    stop,
    clearHistory,
    loadHistory,
  };
}

// 辅助函数
function nextId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getEditorState(editor: any): EditorState {
  if (!editor) {
    return { code: '', selection: null, cursorPosition: null, errors: [] };
  }
  
  const doc = editor.editor.state.doc.toString();
  const selection = editor.editor.state.selection.main;
  
  return {
    code: doc,
    selection: selection.empty ? null : doc.slice(selection.from, selection.to),
    cursorPosition: {
      line: doc.slice(0, selection.head).split('\n').length,
      column: selection.head - doc.lastIndexOf('\n', selection.head - 1),
    },
    errors: editor.getErrors?.() || [],
  };
}
```

---

## 三、关键改进点

### 3.1 动态音色查询（核心创新）

**问题**：当前 System Prompt 硬编码了音色列表，但实际加载的音色可能不同，且无法查询。

**解决方案**：
1. `SoundRegistry` 从 `soundMap`（`@strudel/webaudio`）动态同步音色信息
2. 提供 `list_sounds`、`get_sound_info`、`preview_sound` 工具
3. System Prompt 中动态注入可用音色摘要

**效果**：
- Agent 可以准确知道当前有哪些音色可用
- 用户可以问"有什么钢琴音色？"，agent 会调用 `list_sounds({ category: "GM Soundfonts", search: "piano" })`
- 用户可以要求"预览 TR808"，agent 会调用 `preview_sound({ soundName: "TR808" })`

### 3.2 智能上下文管理

**问题**：硬编码保留20轮，不考虑 token 限制。

**解决方案**：
1. `ContextManager` 动态构建 System Prompt（按需注入语法参考）
2. `Memory` 基于重要性压缩消息（错误和工具结果更重要）
3. 自动摘要旧消息

**效果**：
- System Prompt 从 3000+ tokens 降到 ~1500 tokens
- 上下文利用率提升 30%
- 重要信息不会被截断

### 3.3 增强的编辑器工具

**问题**：缺少关键工具（selection、cursor、errors），replace_code 需要精确位置。

**解决方案**：
1. 添加 `get_selection` - 获取选中代码
2. 添加 `get_cursor_position` - 获取光标位置
3. 添加 `get_errors` - 获取代码错误
4. 添加 `undo` - 撤销修改
5. 改进 `replace_code` - 基于文本匹配而非位置

**效果**：
- 用户说"修改这段"时，agent 可以调用 `get_selection`
- 代码执行失败时，agent 可以调用 `get_errors` 了解具体错误
- `replace_code` 更易用，不需要计算字符位置

### 3.4 分离逻辑和 UI

**问题**：AgentSidebar.jsx 387 行，承担所有职责。

**解决方案**：
1. `useAgent` hook 封装所有 agent 逻辑
2. UI 组件只负责渲染
3. AgentSidebar 简化为 ~100 行

**效果**：
- 代码更清晰、更易测试
- 可以单元测试 agent 逻辑
- UI 和逻辑解耦

---

## 四、实施计划

### Phase 1: 核心模块（1周）

1. **创建 SoundRegistry**
   - 实现音色同步和查询
   - 集成 `soundMap` from `@strudel/webaudio`

2. **创建 ContextManager**
   - 实现动态 System Prompt
   - 拆分现有 SYSTEM_PROMPT 为核心 + 参考

3. **创建 Memory**
   - 实现基于重要性的压缩

### Phase 2: 工具增强（1周）

1. **创建 SoundTools**
   - `list_sounds` - 查询音色
   - `get_sound_info` - 获取音色详情
   - `preview_sound` - 预览音色

2. **创建 EditorTools**
   - `get_selection` - 获取选中代码
   - `get_cursor_position` - 获取光标位置
   - `get_errors` - 获取错误
   - `undo` - 撤销
   - 改进 `replace_code` - 基于文本匹配

### Phase 3: Hook 重构（1周）

1. **创建 useAgent hook**
   - 封装所有 agent 逻辑
   - 集成 SoundRegistry、ContextManager、Memory

2. **重构 AgentSidebar**
   - 使用 useAgent hook
   - 简化为 ~100 行

### Phase 4: 测试和优化（1周）

1. **端到端测试**
   - 测试音色查询
   - 测试代码修改
   - 测试错误恢复

2. **性能优化**
   - 测试 token 节省效果
   - 优化响应时间

---

## 五、预期效果

### 功能增强

| 功能 | 当前 | 改进后 |
|------|------|--------|
| 音色查询 | ❌ 无法查询 | ✅ 动态查询所有可用音色 |
| 音色预览 | ❌ 无法预览 | ✅ 可以预览任意音色 |
| 选中代码 | ❌ 无法获取 | ✅ 可以获取选中代码 |
| 代码错误 | ❌ 无法获取 | ✅ 可以获取错误信息 |
| 撤销修改 | ❌ 不支持 | ✅ 支持撤销 |
| 上下文管理 | ⚠️ 硬编码截断 | ✅ 智能压缩 |
| System Prompt | ⚠️ 3000+ tokens | ✅ ~1500 tokens |

### 代码质量

| 指标 | 当前 | 改进后 |
|------|------|--------|
| AgentSidebar.jsx 行数 | 387 | <100 |
| 测试覆盖率 | 0% | >70% |
| 代码复杂度 | 高 | 低 |

### 性能提升

| 指标 | 当前 | 改进后 |
|------|------|--------|
| System Prompt tokens | 3000+ | ~1500 |
| 平均响应时间 | 基准 | -30% |
| Token 使用 | 基准 | -40% |

---

## 六、技术细节

### 6.1 SoundRegistry 集成

```typescript
// 在 useAgent 中初始化
const soundRegistry = useMemo(() => new SoundRegistry(), []);

// 在构建上下文时同步音色
soundRegistry.sync();
```

### 6.2 动态 System Prompt 示例

**用户问**："有什么钢琴音色？"

**生成的 System Prompt**：
```
You are an expert AI assistant for Strudel...

## Available Sounds

### GM Soundfonts (128)
`gm_piano`, `gm_epiano1`, `gm_epiano2`, `gm_harpsichord`, ...

### Samples (50)
`piano`, `casio`, ...

...
```

**Agent 响应**：
调用 `list_sounds({ category: "GM Soundfonts", search: "piano" })`

返回：
```
Found 5 sounds:
gm_piano (10 samples)
gm_epiano1 (12 samples)
gm_epiano2 (10 samples)
gm_harpsichord (10 samples)
gm_clavinet (10 samples)
```

### 6.3 工具调用流程

```
用户: "有什么钢琴音色？"
  ↓
Agent: 调用 list_sounds({ category: "GM Soundfonts", search: "piano" })
  ↓
Tool: 返回音色列表
  ↓
Agent: "我找到了以下钢琴音色：\n- gm_piano: 传统钢琴\n- gm_epiano1: 电钢琴\n..."
  ↓
用户: "预览 gm_piano"
  ↓
Agent: 调用 preview_sound({ soundName: "gm_piano" })
  ↓
Tool: 写入代码 `note("c3 e3 g3 c4").s("gm_piano").room(0.3)` 并执行
  ↓
Agent: "正在预览 gm_piano 音色，你应该能听到一个 C 大调琶音。"
```

---

## 七、风险和缓解

### 风险 1: soundMap 访问

**问题**：`soundMap` 是 `@strudel/webaudio` 的内部状态，可能不直接暴露。

**缓解**：
- 检查 `soundMap` 是否可以从 `@strudel/webaudio` 导入
- 如果不直接暴露，可以通过 `SoundsTab` 组件的状态获取
- 或者在 `prebake()` 时记录所有加载的音色

### 风险 2: 错误信息获取

**问题**：`StrudelMirror` 可能没有暴露错误 API。

**缓解**：
- 检查 `StrudelMirror` 的 API
- 可以通过监听 `repl` 的错误事件获取
- 或者在 `evaluate()` 时捕获异常

### 风险 3: 性能问题

**问题**：动态同步 `soundMap` 可能影响性能。

**缓解**：
- 使用 `updateInterval` 限制同步频率（5秒一次）
- 只在需要时同步（调用 `query()` 时）
- 缓存音色信息

---

## 八、总结

本设计文档详细描述了一个增强的 Strudel Agent 架构，核心改进包括：

1. **SoundRegistry** - 动态查询可用音色，解决"不知道有什么音色"的问题
2. **ContextManager** - 智能上下文构建，减少 token 消耗
3. **增强的工具系统** - 添加音色查询、预览、选中代码、错误获取等工具
4. **useAgent hook** - 分离逻辑和 UI，提升代码质量

这些改进将使 Agent 能够：
- ✅ 准确知道当前有哪些音色可用
- ✅ 帮助用户发现和预览音色
- ✅ 更好地理解用户意图（通过选中代码）
- ✅ 更好地处理错误（通过获取错误信息）
- ✅ 更高效地使用 token（通过智能上下文管理）

实施后，Agent 将成为一个真正的"Strudel 专家助手"，而不仅仅是一个代码编辑器。
