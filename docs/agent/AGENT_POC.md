# Strudel Agent 技术预研报告

## 一、验证目标

验证以下三个关键技术点的可行性：
1. `soundMap` 的访问方式 - 能否动态获取所有可用音色
2. 错误信息的获取 - 能否获取代码执行时的错误
3. CodeMirror 编辑器的 undo/selection API - 能否获取选中代码和执行撤销

---

## 二、验证结果

### 2.1 soundMap 访问方式 ✅ 可行

**结论**：可以直接从 `@strudel/webaudio` 导入 `soundMap`。

**证据**：

1. `soundMap` 定义在 [superdough.mjs](file:///e:/个人项目/strudel/packages/superdough/superdough.mjs#L38)：
```javascript
export const soundMap = map();
```

2. `@strudel/webaudio` 的 [index.mjs](file:///e:/个人项目/strudel/packages/webaudio/index.mjs#L10) 重新导出了 superdough：
```javascript
export * from 'superdough';
```

3. 因此可以在 agent 代码中这样导入：
```javascript
import { soundMap } from '@strudel/webaudio';
```

**soundMap 的数据结构**：

`soundMap` 是一个 `nanostores` 的 `map` 对象，存储所有已注册的音色。

每个音色的结构：
```javascript
{
  onTrigger: Function,  // 触发播放的函数
  data: {
    type: 'sample' | 'synth' | 'soundfont',
    tag?: string,       // 'drum-machines' 等
    samples?: Array | Object,  // 采样数据
    fonts?: Array,      // soundfont 数据
  }
}
```

**访问方式**：
```javascript
// 获取所有音色
const allSounds = soundMap.get();

// 遍历
for (const [name, entry] of Object.entries(soundMap.get())) {
  console.log(name, entry.data.type, entry.data.tag);
}

// 监听变化
soundMap.listen((newMap) => {
  console.log('Sound map updated:', Object.keys(newMap));
});
```

**实现 SoundRegistry 的方式**：

```javascript
import { soundMap } from '@strudel/webaudio';

class SoundRegistry {
  constructor() {
    this.sounds = new Map();
    this.lastUpdate = 0;
    this.updateInterval = 5000; // 5秒更新一次
  }

  sync() {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval) return;
    
    this.sounds.clear();
    const map = soundMap.get();
    
    for (const [name, entry] of Object.entries(map)) {
      if (name.startsWith('_')) continue;
      
      const { data } = entry;
      this.sounds.set(name, {
        name,
        type: data.type,
        tag: data.tag,
        sampleCount: this.getSampleCount(data),
        category: this.categorize(data),
      });
    }
    
    this.lastUpdate = now;
  }

  getSampleCount(data) {
    if (data.type === 'sample') {
      return Array.isArray(data.samples) 
        ? data.samples.length 
        : Object.keys(data.samples || {}).length;
    } else if (data.type === 'soundfont') {
      return data.fonts?.length || 0;
    }
    return 0;
  }

  categorize(data) {
    if (data.type === 'synth') return 'Synths';
    if (data.type === 'soundfont') return 'GM Soundfonts';
    if (data.tag === 'drum-machines') return 'Drum Machines';
    return 'Samples';
  }

  query(filter) {
    this.sync();
    let results = Array.from(this.sounds.values());
    
    if (filter?.category) {
      results = results.filter(s => s.category === filter.category);
    }
    
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(s => 
        s.name.toLowerCase().includes(search)
      );
    }
    
    return results;
  }
}
```

---

### 2.2 错误信息获取 ⚠️ 部分可行

**结论**：可以通过 `repl.state` 获取错误信息，但需要扩展 `StrudelMirror` 的 API。

**证据**：

1. `repl.mjs` 中的 `state` 对象包含错误信息：
```javascript
// packages/core/repl.mjs:45
state.error = state.evalError || state.schedulerError;
```

2. `evaluate()` 函数会捕获错误并存储：
```javascript
// packages/core/repl.mjs:235
logger(`[eval] error: ${err.message}`, 'error');
```

3. `StrudelMirror` 有 `this.repl` 属性，可以通过它访问 state：
```javascript
// 在 agent 工具中
const editor = editorRef.current;
const error = editor?.repl?.state?.error;
const evalError = editor?.repl?.state?.evalError;
const schedulerError = editor?.repl?.state?.schedulerError;
```

4. `Repl.jsx` 中已经有错误处理的逻辑：
```javascript
// website/src/repl/Repl.jsx
const [error, setError] = useState(null);
// ...
{error && <UserFacingErrorMessage error={error} />}
```

**实现 get_errors 工具的方式**：

```javascript
const get_errors = tool({
  description: 'Get syntax errors and warnings in the current code.',
  inputSchema: jsonSchema({ type: 'object', properties: {}, required: [] }),
  execute: async () => {
    const editor = editorRef.current;
    if (!editor) return 'Editor not available';
    
    // 方式1：通过 repl.state 获取
    const error = editor.repl?.state?.error;
    const evalError = editor.repl?.state?.evalError;
    const schedulerError = editor.repl?.state?.schedulerError;
    
    if (!error && !evalError && !schedulerError) {
      return 'No errors found';
    }
    
    return JSON.stringify({
      error: error?.message || null,
      evalError: evalError?.message || null,
      schedulerError: schedulerError?.message || null,
    }, null, 2);
  },
});
```

**限制**：
- 错误信息可能不够详细（只有 message，没有行号）
- 需要在代码执行后才能获取错误
- 如果代码没有执行过，不会有错误信息

**改进建议**：
- 可以在 `StrudelMirror` 中添加 `getErrors()` 方法
- 或者在 `evaluate()` 时捕获更详细的错误信息（包括行号）

---

### 2.3 CodeMirror undo/selection API ✅ 可行

**结论**：CodeMirror 编辑器支持 undo 和 selection API。

**证据**：

1. `history()` 扩展已启用：
```javascript
// packages/codemirror/codemirror.mjs:94
history(),
```

2. `historyKeymap` 已导入并使用：
```javascript
// packages/codemirror/keybindings.mjs:30
return [active ? active() : [], keymap.of(historyKeymap)];
```

3. `StrudelMirror` 暴露了 `this.editor`（CodeMirror EditorView）：
```javascript
// packages/codemirror/codemirror.mjs:165
this.editor = initEditor({...});
```

4. CodeMirror 的 selection API：
```javascript
// 获取选中内容
const selection = editor.state.selection.main;
const selectedText = editor.state.doc.sliceString(selection.from, selection.to);

// 获取光标位置
const cursorPos = editor.state.selection.main.head;
const line = editor.state.doc.lineAt(cursorPos);
```

**实现 get_selection 工具的方式**：

```javascript
const get_selection = tool({
  description: 'Get the currently selected code in the editor.',
  inputSchema: jsonSchema({ type: 'object', properties: {}, required: [] }),
  execute: async () => {
    const editor = editorRef.current;
    if (!editor) return 'Editor not available';
    
    const selection = editor.editor.state.selection.main;
    if (selection.empty) {
      return 'No code selected. The user needs to select some code first.';
    }
    
    return editor.editor.state.doc.sliceString(selection.from, selection.to);
  },
});
```

**实现 undo 工具的方式**：

```javascript
import { undo } from '@codemirror/commands';

const undo_tool = tool({
  description: 'Undo the last code modification.',
  inputSchema: jsonSchema({ type: 'object', properties: {}, required: [] }),
  execute: async () => {
    const editor = editorRef.current;
    if (!editor) return 'Editor not available';
    
    // CodeMirror 的 undo 需要通过 dispatch 调用
    undo(editor.editor);
    return 'Undo successful';
  },
});
```

**注意**：
- `undo()` 需要从 `@codemirror/commands` 导入
- 它接受一个 `EditorView` 参数
- 如果 undo 栈为空，不会有任何效果

---

## 三、技术预研代码

### 3.1 创建 POC 文件

创建一个简单的 POC 文件来验证这些功能：

```javascript
// website/src/repl/agent/poc.mjs

import { soundMap } from '@strudel/webaudio';
import { undo } from '@codemirror/commands';

// 验证 1: soundMap 访问
export function testSoundMap() {
  console.log('=== Testing soundMap ===');
  const sounds = soundMap.get();
  console.log('Total sounds:', Object.keys(sounds).length);
  
  // 分类统计
  const categories = {
    sample: 0,
    synth: 0,
    soundfont: 0,
  };
  
  for (const [name, entry] of Object.entries(sounds)) {
    const type = entry.data.type;
    if (categories[type] !== undefined) {
      categories[type]++;
    }
  }
  
  console.log('Categories:', categories);
  
  // 列出前10个音色
  const first10 = Object.entries(sounds).slice(0, 10);
  console.log('First 10 sounds:');
  for (const [name, entry] of first10) {
    console.log(`  ${name}: ${entry.data.type}`);
  }
  
  return { total: Object.keys(sounds).length, categories };
}

// 验证 2: 错误信息获取
export function testErrorAccess(editorRef) {
  console.log('=== Testing error access ===');
  const editor = editorRef.current;
  if (!editor) {
    console.log('Editor not available');
    return null;
  }
  
  const error = editor.repl?.state?.error;
  const evalError = editor.repl?.state?.evalError;
  const schedulerError = editor.repl?.state?.schedulerError;
  
  console.log('Error:', error?.message || 'None');
  console.log('Eval Error:', evalError?.message || 'None');
  console.log('Scheduler Error:', schedulerError?.message || 'None');
  
  return { error, evalError, schedulerError };
}

// 验证 3: selection API
export function testSelection(editorRef) {
  console.log('=== Testing selection API ===');
  const editor = editorRef.current;
  if (!editor) {
    console.log('Editor not available');
    return null;
  }
  
  const selection = editor.editor.state.selection.main;
  console.log('Selection empty:', selection.empty);
  console.log('Selection from:', selection.from);
  console.log('Selection to:', selection.to);
  
  if (!selection.empty) {
    const selectedText = editor.editor.state.doc.sliceString(selection.from, selection.to);
    console.log('Selected text:', selectedText);
    return selectedText;
  }
  
  return null;
}

// 验证 4: undo API
export function testUndo(editorRef) {
  console.log('=== Testing undo API ===');
  const editor = editorRef.current;
  if (!editor) {
    console.log('Editor not available');
    return false;
  }
  
  try {
    undo(editor.editor);
    console.log('Undo successful');
    return true;
  } catch (e) {
    console.log('Undo failed:', e.message);
    return false;
  }
}

// 运行所有测试
export function runAllTests(editorRef) {
  console.log('=== Running all POC tests ===\n');
  
  testSoundMap();
  console.log('');
  
  testErrorAccess(editorRef);
  console.log('');
  
  testSelection(editorRef);
  console.log('');
  
  testUndo(editorRef);
  console.log('');
  
  console.log('=== All tests completed ===');
}
```

### 3.2 在浏览器中测试

可以在浏览器控制台中运行：

```javascript
// 导入 POC 模块
import { runAllTests } from './repl/agent/poc.mjs';

// 获取 editor ref（需要从 React 组件中获取）
// 或者直接在 Repl.jsx 中添加测试代码
```

---

## 四、总结

### 4.1 验证结果汇总

| 技术点 | 状态 | 说明 |
|--------|------|------|
| soundMap 访问 | ✅ 可行 | 可以直接从 `@strudel/webaudio` 导入 |
| 错误信息获取 | ⚠️ 部分可行 | 可以通过 `repl.state` 获取，但信息不够详细 |
| undo API | ✅ 可行 | CodeMirror 的 `undo()` 函数可用 |
| selection API | ✅ 可行 | 可以通过 `editor.state.selection` 获取 |

### 4.2 风险评估

1. **soundMap 访问** - 低风险
   - `soundMap` 是公开导出的
   - 数据结构清晰
   - 可以直接使用

2. **错误信息获取** - 中风险
   - 可以通过 `repl.state` 获取错误
   - 但错误信息可能不够详细（没有行号）
   - 建议：在 `StrudelMirror` 中添加 `getErrors()` 方法

3. **undo/selection API** - 低风险
   - CodeMirror 的 API 稳定
   - 已有 `history()` 扩展
   - 可以直接使用

### 4.3 实施建议

1. **Phase 1: 创建 SoundRegistry**
   - 使用 `soundMap` 动态获取音色
   - 实现 `list_sounds`、`get_sound_info`、`preview_sound` 工具

2. **Phase 2: 增强编辑器工具**
   - 添加 `get_selection`、`get_cursor_position`、`get_errors`、`undo` 工具
   - 改进 `replace_code` 为基于文本匹配

3. **Phase 3: 创建 useAgent hook**
   - 封装所有 agent 逻辑
   - 分离 UI 和逻辑

4. **Phase 4: 测试和优化**
   - 端到端测试
   - 性能优化

### 4.4 下一步

1. 在浏览器中运行 POC 代码，验证实际效果
2. 根据验证结果调整设计方案
3. 开始实施 Phase 1

---

## 五、附录

### 5.1 soundMap 数据结构示例

```javascript
// 采样音色
{
  onTrigger: Function,
  data: {
    type: 'sample',
    samples: ['bd.wav', 'sd.wav', ...] // 或 Object
  }
}

// 合成器音色
{
  onTrigger: Function,
  data: {
    type: 'synth'
  }
}

// Soundfont 音色
{
  onTrigger: Function,
  data: {
    type: 'soundfont',
    fonts: [...]
  }
}

// 鼓机音色
{
  onTrigger: Function,
  data: {
    type: 'sample',
    tag: 'drum-machines',
    samples: [...]
  }
}
```

### 5.2 CodeMirror EditorView API

```javascript
// 获取文档内容
const doc = editor.state.doc.toString();

// 获取选中内容
const selection = editor.state.selection.main;
const selectedText = editor.state.doc.sliceString(selection.from, selection.to);

// 获取光标位置
const cursorPos = editor.state.selection.main.head;
const line = editor.state.doc.lineAt(cursorPos);

// 修改文档
editor.dispatch({
  changes: { from: 0, to: 10, insert: 'new text' }
});

// 撤销
undo(editor);

// 重做
redo(editor);
```

### 5.3 repl.state 结构

```javascript
{
  error: Error | null,
  evalError: Error | null,
  schedulerError: Error | null,
  pattern: Pattern | null,
  cps: number,
  // ...
}
```
