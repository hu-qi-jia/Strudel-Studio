# 架构设计

## 整体架构

Strudel 采用 **Monorepo** 架构,使用 pnpm workspaces 和 Lerna 管理多个独立包。整个系统遵循分层设计,从底层的模式系统到上层的用户界面,各层职责清晰。

### 架构层次图

```
┌─────────────────────────────────────────────────────────┐
│                    用户界面层 (UI Layer)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Website    │  │     REPL     │  │  CodeMirror  │  │
│  │   (Astro)    │  │  Component   │  │   Editor     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                   应用层 (Application Layer)             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Transpiler  │  │   Evaluator  │  │   Scheduler  │  │
│  │              │  │              │  │  (Cyclist)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                    核心层 (Core Layer)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Pattern    │  │     Mini     │  │    Tonal     │  │
│  │   System     │  │   Notation   │  │   Functions  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                   音频层 (Audio Layer)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Superdough  │  │  Web Audio   │  │   SoundFonts │  │
│  │   Engine     │  │    API       │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 核心设计理念

### 1. 模式驱动 (Pattern-Driven)

Strudel 的核心是 **Pattern(模式)** 系统,它是一个函数式的设计:

```javascript
Pattern.query(State) → [Hap]
```

- **Pattern**: 表示一个时间模式,可以查询任意时间范围内的事件
- **State**: 查询状态,包含时间范围和上下文信息
- **Hap**: 事件(Happening),包含值、时间跨度等信息

### 2. 函数式组合 (Functional Composition)

模式通过函数组合来构建复杂结构:

```javascript
// 简单模式
const p1 = note('c3');

// 组合模式
const p2 = note('c3 [e3 g3]').s('sawtooth').gain(0.5);

// 模式变换
const p3 = p2.slow(2).rev();
```

### 3. 时间抽象 (Time Abstraction)

时间使用分数表示,支持精确的有理数运算:

```javascript
// 使用 fraction.js
import Fraction from 'fraction.js';

const time = new Fraction(1, 3); // 1/3 拍
```

### 4. 实时求值 (Live Evaluation)

支持实时编辑和求值,通过调度器(Cyclist)管理:

```javascript
scheduler.setPattern(pattern); // 设置新模式
scheduler.start();             // 开始播放
scheduler.stop();              // 停止播放
```

## Monorepo 结构

### 包组织策略

```
packages/
├── core/           # 核心模式系统 (无外部依赖)
├── mini/           # 迷你记谱法解析
├── tonal/          # 音乐理论函数
├── transpiler/     # 代码转换器
├── webaudio/       # Web Audio 绑定
├── superdough/     # 音频引擎
├── codemirror/     # 编辑器扩展
├── repl/           # REPL 组件
└── [extensions]/   # 其他扩展 (midi, osc, hydra, etc.)
```

### 依赖原则

1. **单向依赖**: 上层依赖下层,下层不依赖上层
2. **最小依赖**: 每个包只依赖必需的其他包
3. **核心独立**: `@strudel/core` 不依赖任何其他 Strudel 包
4. **可替换性**: 音频引擎、编辑器等可替换

## 数据流

### 模式求值流程

```
用户代码 (String)
    ↓
[Transpiler] → 转换代码,添加位置信息
    ↓
[Evaluator] → 执行代码,返回 Pattern
    ↓
[Scheduler] → 定期查询 Pattern
    ↓
Pattern.query(State) → [Hap]
    ↓
[Audio Output] → 播放音频事件
```

### 实时更新流程

```
用户编辑代码
    ↓
[CodeMirror] → 触发 onChange 事件
    ↓
[REPL] → 调用 evaluate()
    ↓
[Transpiler + Evaluator] → 求值新代码
    ↓
[Scheduler] → 更新模式 (无缝切换)
    ↓
继续播放新模式
```

## 关键技术决策

### 1. 为什么使用 Monorepo?

- **代码共享**: 多个包共享工具和配置
- **统一版本**: 便于版本管理和发布
- **开发便利**: 本地包链接,实时测试
- **原子提交**: 跨包修改可原子提交

### 2. 为什么使用 pnpm?

- **磁盘效率**: 使用硬链接节省磁盘空间
- **严格依赖**: 避免幽灵依赖
- **工作区支持**: 原生支持 monorepo
- **性能**: 比 npm/yarn 更快

### 3. 为什么使用 Web Audio API?

- **浏览器原生**: 无需插件
- **低延迟**: 适合实时音频
- **功能强大**: 支持复杂音频处理
- **跨平台**: 所有现代浏览器支持

### 4. 为什么使用 CodeMirror 6?

- **性能**: 虚拟滚动,支持大文件
- **扩展性**: 模块化设计
- **功能丰富**: 语法高亮、自动完成等
- **活跃维护**: 持续更新

## 扩展机制

### 插件系统

Strudel 支持通过包扩展功能:

```javascript
// 添加新的输出方式
import { oscOutput } from '@strudel/osc';
repl({ defaultOutput: oscOutput });

// 添加新的编辑器功能
import { vimKeybindings } from '@strudel/codemirror';
```

### 自定义音频引擎

可以替换默认的 `superdough`:

```javascript
import { customAudioOutput } from './my-engine';
repl({ defaultOutput: customAudioOutput });
```

## 性能优化

### 1. 模式缓存

```javascript
// Pattern 内部缓存查询结果
pattern.queryArc(0, 1); // 缓存结果
```

### 2. 增量求值

```javascript
// 只重新求值改变的部分
transpiler(code, { incremental: true });
```

### 3. Web Workers

```javascript
// NeoCyclist 使用 SharedWorker 进行跨标签页同步
const scheduler = new NeoCyclist(options);
```

### 4. 音频 Worklet

```javascript
// 音频处理在独立线程
// packages/superdough/ola-processor.js
```

## 安全考虑

### 1. 代码求值

```javascript
// 使用受限的 evalScope
evaluate(code, { scope: evalScope });
```

### 2. CSP 兼容

```javascript
// 不使用 eval,使用 Function 构造器
const fn = new Function('return ' + code);
```

### 3. 输入验证

```javascript
// 验证用户输入
if (!isPattern(value)) {
  throw new TypeError('Expected a Pattern');
}
```

## 部署架构

### Web 版本

```
用户浏览器
    ↓
静态资源 (HTML/CSS/JS)
    ↓
Web Audio API (本地)
```

### 桌面版本 (Tauri)

```
Tauri 应用
    ├── WebView (前端)
    └── Rust 后端
        ├── 文件系统访问
        ├── MIDI 接口
        └── OSC 通信
```

## 未来架构演进

### 计划改进

1. **WASM 加速**: 使用 WebAssembly 加速模式计算
2. **协作编辑**: 实时多人协作
3. **云同步**: 模式云存储和分享
4. **插件市场**: 第三方插件系统

### 架构原则

- **渐进增强**: 保持向后兼容
- **模块化**: 继续拆分大包
- **标准化**: 遵循 Web 标准
- **可测试**: 提高测试覆盖率
