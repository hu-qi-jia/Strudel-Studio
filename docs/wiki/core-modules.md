# 核心模块详解

本文档详细介绍 Strudel 的核心包及其关键类和函数。

## @strudel/core

核心包是 Strudel 的基础,包含模式系统、时间处理、调度器等核心功能。

### 主要模块

#### 1. Pattern (pattern.mjs)

**Pattern 类**是整个系统的核心,表示一个时间模式。

##### 关键属性

```javascript
class Pattern {
  query: Function      // 查询函数: State → [Hap]
  _Pattern: boolean    // 类型标识
  _steps: Fraction     // 每周期的步数
}
```

##### 核心方法

| 方法 | 说明 | 示例 |
|------|------|------|
| `withValue(func)` | 对每个事件的值应用函数 | `pattern.withValue(v => v + 1)` |
| `withState(func)` | 对查询状态应用函数 | `pattern.withState(s => s)` |
| `withHap(func)` | 对每个事件应用函数 | `pattern.withHap(h => h)` |
| `withHaps(func)` | 对事件数组应用函数 | `pattern.withHaps(hs => hs)` |
| `query(state)` | 查询模式在给定状态下的所有事件 | `pattern.query(state)` |
| `queryArc(begin, end)` | 查询时间范围内的所有事件 | `pattern.queryArc(0, 1)` |
| `firstCycle()` | 查询第一个周期的事件 | `pattern.firstCycle()` |

##### 模式组合方法

| 方法 | 说明 | 示例 |
|------|------|------|
| `stack(other)` | 并行组合两个模式 | `p1.stack(p2)` |
| `seq(other)` | 顺序组合两个模式 | `p1.seq(p2)` |
| `fast(factor)` | 加速模式 | `pattern.fast(2)` |
| `slow(factor)` | 减速模式 | `pattern.slow(2)` |
| `rev()` | 反转模式 | `pattern.rev()` |
| `early(offset)` | 提前播放 | `pattern.early(0.5)` |
| `late(offset)` | 延迟播放 | `pattern.late(0.5)` |

##### 工厂函数

```javascript
// 创建纯值模式
pure(value) → Pattern

// 创建静默模式
silence → Pattern

// 创建序列模式
sequence(...values) → Pattern

// 创建堆叠模式
stack(...patterns) → Pattern

// 创建慢速序列
slowcat(...patterns) → Pattern
```

#### 2. TimeSpan (timespan.mjs)

**TimeSpan 类**表示时间跨度,使用分数精确表示时间。

```javascript
class TimeSpan {
  begin: Fraction    // 开始时间
  end: Fraction      // 结束时间

  // 方法
  duration() → Fraction              // 时长
  midpoint() → Fraction              // 中点
  withBegin(begin) → TimeSpan        // 设置开始时间
  withEnd(end) → TimeSpan            // 设置结束时间
  shift(offset) → TimeSpan           // 平移
  union(other) → TimeSpan            // 并集
  intersection(other) → TimeSpan     // 交集
}
```

#### 3. Hap (hap.mjs)

**Hap 类**表示一个事件(Happening),包含值和时间信息。

```javascript
class Hap {
  whole: TimeSpan     // 整体时间跨度
  part: TimeSpan      // 部分时间跨度(可能被分割)
  value: any          // 事件值

  // 方法
  withValue(func) → Hap              // 应用函数到值
  withWhole(whole) → Hap             // 设置整体跨度
  withPart(part) → Hap               // 设置部分跨度
  show() → string                    // 显示事件信息
}
```

#### 4. State (state.mjs)

**State 类**表示查询状态,包含时间范围和上下文。

```javascript
class State {
  span: TimeSpan      // 查询的时间范围
  // 其他上下文信息

  // 方法
  withSpan(span) → State             // 设置时间范围
}
```

#### 5. Fraction (fraction.mjs)

**Fraction 类**封装了 `fraction.js` 库,用于精确的有理数运算。

```javascript
import Fraction from 'fraction.js';

const f1 = new Fraction(1, 3);  // 1/3
const f2 = new Fraction(1, 2);  // 1/2

f1.add(f2)    // 5/6
f1.mul(f2)    // 1/6
f1.compare(f2) // -1
```

#### 6. Cyclist & NeoCyclist (cyclist.mjs, neocyclist.mjs)

**调度器**,负责定期查询模式并触发音频播放。

##### Cyclist (单标签页)

```javascript
class Cyclist {
  constructor(options) {
    onTrigger: Function    // 触发回调
    getTime: Function      // 获取当前时间
    onToggle: Function     // 播放/暂停回调
  }

  setPattern(pattern, autostart)    // 设置模式
  start()                           // 开始播放
  stop()                            // 停止播放
}
```

##### NeoCyclist (多标签页同步)

使用 `SharedWorker` 实现跨标签页同步:

```javascript
class NeoCyclist extends Cyclist {
  // 使用 SharedWorker
  // 多个标签页共享同一个调度器
}
```

#### 7. REPL (repl.mjs)

**REPL 函数**,创建完整的实时编程环境。

```javascript
function repl(options) {
  defaultOutput: Function     // 默认输出函数
  onEvalError: Function       // 求值错误回调
  beforeEval: Function        // 求值前回调
  afterEval: Function         // 求值后回调
  getTime: Function           // 获取当前时间
  transpiler: Function        // 代码转换器
  onToggle: Function          // 播放/暂停回调
  editPattern: Function       // 模式编辑器
  onUpdateState: Function     // 状态更新回调
  sync: boolean               // 是否同步多标签页
  id: string                  // REPL ID
}

// 返回值
{
  scheduler: Cyclist,         // 调度器
  evaluate: Function,         // 求值函数
  hush: Function,             // 停止所有声音
  setPattern: Function,       // 设置模式
  getState: Function,         // 获取状态
}
```

#### 8. Controls (controls.mjs)

**控制函数**,用于创建和操作模式。

##### 基本控制

```javascript
// 音符
note(...notes) → Pattern

// 采样
s(...samples) → Pattern
sound(...samples) → Pattern

// 增益
gain(value) → Pattern

// 速度
speed(value) → Pattern

// 声像
pan(value) → Pattern

// 频率
freq(value) → Pattern
```

##### 效果控制

```javascript
// 滤波器
cutoff(value) → Pattern
resonance(value) → Pattern

// 延迟
delay(value) → Pattern
delaytime(value) → Pattern
delayfeedback(value) → Pattern

// 混响
room(value) → Pattern
size(value) → Pattern

// 失真
distort(value) → Pattern

// 立体声
pan(value) → Pattern
```

#### 9. Euclid (euclid.mjs)

**欧几里得节奏**,生成均匀分布的节奏模式。

```javascript
// euclid(k, n) - 在 n 拍中均匀分布 k 个事件
euclid(3, 8)  // 在 8 拍中均匀分布 3 个事件
// 结果: X . . X . . X .

// euclidInv(k, n) - 反向欧几里得
euclidInv(3, 8)  // 结果: . X X . X X . X
```

#### 10. Evaluate (evaluate.mjs)

**代码求值**,执行用户代码并返回模式。

```javascript
function evaluate(code, options) {
  // 选项
  scope: Object           // 变量作用域
  transpiler: Function    // 代码转换器
  onError: Function       // 错误回调
}

// 返回值
{
  pattern: Pattern,       // 求值得到的模式
  error: Error,           // 错误信息
}
```

#### 11. Signal (signal.mjs)

**信号处理**,用于连续值的变化。

```javascript
// 线性变化
linseg(...points) → Pattern

// 指数变化
expseg(...points) → Pattern

// 正弦波
sine(freq) → Pattern

// 锯齿波
saw(freq) → Pattern
```

#### 12. DrawLine (drawLine.mjs)

**绘制线条**,用于可视化。

```javascript
function drawLine(points, options) {
  // 返回 SVG 路径字符串
}
```

### 工具模块

#### Util (util.mjs)

通用工具函数:

```javascript
// 数组操作
flatten(arr) → Array
uniqsortr(arr) → Array
listRange(start, end) → Array

// 数学
mod(n, m) → number
lcm(a, b) → number

// 函数式
curry(fn) → Function
id(x) → x
```

#### Logger (logger.mjs)

日志工具:

```javascript
logger(message)        // 普通日志
errorLogger(error)     // 错误日志
```

## @strudel/mini

迷你记谱法解析器,将简洁的文本语法转换为模式。

### Mini 函数

```javascript
function mini(notation) → Pattern
```

### 语法规则

| 语法 | 说明 | 示例 |
|------|------|------|
| `a b` | 顺序播放 | `mini('a b')` → a 在第 1 拍,b 在第 2 拍 |
| `[a b]` | 加快一倍 | `mini('[a b]')` → a 和 b 各占半拍 |
| `a,b` | 并行播放 | `mini('a,b')` → a 和 b 同时播放 |
| `a*2` | 重复 | `mini('a*2')` → a 重复 2 次 |
| `a/2` | 减慢 | `mini('a/2')` → a 占 2 拍 |
| `a@n` | 指定位置 | `mini('a@0.5')` → a 在半拍位置 |
| `<a b>` | 交替 | `mini('<a b>')` → 第 1 周期 a,第 2 周期 b |
| `!a` | 静音 | `mini('!a')` → 静音事件 |
| `~` | 静默 | `mini('~')` → 静默 |

### 解析器实现

使用 [Peggy](https://peggyjs.org/) 解析器生成器:

```
krill.pegjs → krill-parser.js
```

构建命令:

```bash
npm run build:parser
```

## @strudel/tonal

音乐理论函数,提供音符、音阶、和弦等操作。

### 主要功能

#### 1. 音符操作

```javascript
// 音符名称
note('c3')      // C3 音符
note('db4')     // D♭4 音符

// MIDI 编号
midi(60)        // MIDI 60 = C4

// 频率
freq(440)       // 440 Hz = A4
```

#### 2. 音阶

```javascript
// 内置音阶
scale('major')       // 大调音阶
scale('minor')       // 小调音阶
scale('pentatonic')  // 五声音阶

// 使用音阶
note('c3').scale('major')  // C 大调音阶
```

#### 3. 和弦

```javascript
// 内置和弦
chord('major')     // 大三和弦
chord('minor')     // 小三和弦
chord('7')         // 属七和弦

// 使用和弦
note('c3').chord('major')  // C 大三和弦
```

#### 4. 音程

```javascript
// 音程操作
interval(5)        // 纯五度
semitones(7)       // 7 个半音
```

#### 5. 转位

```javascript
// 和弦转位
voicing('major', { inversion: 1 })
```

### 依赖库

- `@tonaljs/tonal`: Tonal.js 音乐理论库
- `chord-voicings`: 和弦转位库
- `webmidi`: Web MIDI API 封装

## @strudel/transpiler

代码转换器,处理用户代码以便求值。

### 主要功能

#### 1. 迷你记谱法位置标记

```javascript
// 输入
note("c3 [e3 g3]")

// 输出
note(mini("c3 [e3 g3]").withMiniLocation(7, 17))
```

#### 2. 音符变量转换

```javascript
// 输入
c3.s('sawtooth')

// 输出
note('c3').s('sawtooth')
```

#### 3. 返回语句添加

```javascript
// 输入
note('c3')

// 输出
return note('c3');
```

### API

```javascript
function transpiler(code, options) {
  wrapAsync: boolean     // 是否包装为 async
  addReturn: boolean     // 是否添加 return
  simpleLocs: boolean    // 是否简化位置信息
}

// 返回转换后的代码
```

## @strudel/webaudio

Web Audio API 绑定,将模式连接到音频输出。

### 主要函数

#### 1. 初始化

```javascript
// 初始化音频上下文
initAudioOnFirstClick() → Promise

// 获取音频上下文
getAudioContext() → AudioContext
```

#### 2. 音频输出

```javascript
// Web Audio 输出函数
function webaudioOutput(hap, time, duration) {
  // 将 Hap 转换为音频参数
  // 调用 superdough 播放
}
```

#### 3. 可视化

```javascript
// 波形显示
scope(canvas, options)

// 频谱显示
spectrum(canvas, options)
```

### 使用示例

```javascript
import { repl, note } from '@strudel/core';
import { initAudioOnFirstClick, getAudioContext, webaudioOutput } from '@strudel/webaudio';

initAudioOnFirstClick();
const ctx = getAudioContext();

const { scheduler } = repl({
  defaultOutput: webaudioOutput,
  getTime: () => ctx.currentTime
});

const pattern = note('c3 [e3 g3]').s('sawtooth');
scheduler.setPattern(pattern);
scheduler.start();
```

## superdough

独立的音频引擎,提供采样器和合成器功能。

### 主要 API

#### 1. 播放声音

```javascript
superdough(value, deadline, duration)
```

**参数说明**:

| 参数 | 类型 | 说明 |
|------|------|------|
| `value` | Object | 声音属性 |
| `deadline` | number | 播放时间(秒) |
| `duration` | number | 持续时间(秒) |

**value 属性**:

| 属性 | 说明 | 范围 |
|------|------|------|
| `s` | 采样/合成器名称 | 字符串 |
| `n` | 采样编号 | 整数 |
| `note` | 音符 | 字符串或 MIDI 编号 |
| `gain` | 增益 | 0-1 |
| `speed` | 播放速度 | >0 |
| `pan` | 声像 | 0-1 |
| `cutoff` | 低通滤波器截止频率 | Hz |
| `resonance` | 低通滤波器共振 | 0-20 |
| `delay` | 延迟混合 | 0-1 |
| `room` | 混响混合 | 0-1 |
| `attack` | 起音时间 | 秒 |
| `decay` | 衰减时间 | 秒 |
| `sustain` | 保持电平 | 0-1 |
| `release` | 释放时间 | 秒 |

#### 2. 加载采样

```javascript
// 从对象加载
samples({
  '_base': 'https://example.com/sounds/',
  'bd': 'kick.mp3',
  'sd': ['snare1.mp3', 'snare2.mp3']
})

// 从 JSON 文件加载
samples('https://example.com/samples.json')

// 从 GitHub 仓库加载
samples('github:user/repo')
```

#### 3. 注册合成器

```javascript
// 注册默认合成器
registerSynthSounds()

// 自定义合成器
registerSound('mySynth', (params) => {
  // 返回 AudioBufferSourceNode 或 OscillatorNode
})
```

### 内置合成器

- `sawtooth`: 锯齿波
- `square`: 方波
- `triangle`: 三角波
- `sine`: 正弦波

### 效果链

Superdough 内置多种效果:

- **滤波器**: 低通、高通、带通
- **延迟**: 立体声延迟
- **混响**: 卷积混响
- **失真**: 波形失真
- **比特压缩**: 振度量化
- **声码器**: 元音滤波器

## @strudel/codemirror

CodeMirror 6 编辑器扩展。

### 主要功能

#### 1. 语法高亮

```javascript
import { strudelHighlight } from '@strudel/codemirror';

const editor = new EditorView({
  extensions: [strudelHighlight()]
});
```

#### 2. 自动完成

```javascript
import { strudelAutocomplete } from '@strudel/codemirror';

const editor = new EditorView({
  extensions: [strudelAutocomplete()]
});
```

#### 3. 键绑定

```javascript
import { vimKeybindings, emacsKeybindings } from '@strudel/codemirror';

const editor = new EditorView({
  extensions: [vimKeybindings()]
});
```

#### 4. 主题

内置 30+ 主题:

```javascript
import { monokai, dracula, nord } from '@strudel/codemirror/themes';

const editor = new EditorView({
  extensions: [monokai]
});
```

#### 5. 小部件

```javascript
import { sliderWidget, buttonWidget } from '@strudel/codemirror';

// 在代码中嵌入交互式小部件
```

## @strudel/repl

REPL Web 组件,提供完整的交互式编程环境。

### 使用方式

#### 作为 Web Component

```html
<script type="module">
  import '@strudel/repl';
</script>

<strudel-repl>
  note('c3 [e3 g3]').s('sawtooth')
</strudel-repl>
```

#### 编程方式

```javascript
import { createRepl } from '@strudel/repl';

const repl = createRepl({
  container: document.getElementById('repl'),
  defaultCode: 'note("c3").s("sawtooth")'
});
```

### 功能特性

- 代码编辑器 (CodeMirror)
- 播放/暂停控制
- 实时求值
- 错误提示
- 模式可视化
- 文件管理
- 设置面板

## 总结

核心模块遵循以下设计原则:

1. **单一职责**: 每个模块专注一个功能
2. **函数式**: 优先使用纯函数和不可变数据
3. **可组合**: 通过组合构建复杂功能
4. **可测试**: 所有核心功能都有单元测试
5. **文档化**: JSDoc 注释和示例代码

这些模块共同构成了 Strudel 的强大功能基础。
