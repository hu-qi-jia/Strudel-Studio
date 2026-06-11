# 扩展模块详解

本文档介绍 Strudel 的扩展包,这些包提供额外的功能和集成。

## 音频相关扩展

### @strudel/soundfonts

SoundFont 支持,允许使用高质量的 SoundFont 音色库。

#### 主要功能

```javascript
import { soundfont } from '@strudel/soundfonts';

// 使用 SoundFont
note('c3 e3 g3').s(soundfont('piano'))

// 指定 SoundFont URL
soundfont('piano', { url: 'path/to/piano.sf2' })
```

#### 支持的格式

- SF2 (SoundFont 2)
- SF3 (压缩的 SoundFont)
- DLS (Downloadable Sounds)

#### 内置音色

- 钢琴
- 吉他
- 鼓组
- 管弦乐器

### @strudel/csound

Csound 绑定,允许使用 Csound 进行音频合成。

#### 使用方式

```javascript
import { csound } from '@strudel/csound';

// 使用 Csound 乐器
note('c3 e3 g3').s(csound('myOrcFile.orc'))
```

#### 配置

```javascript
csound({
  orc: 'path/to/orchestra.orc',
  sco: 'path/to/score.sco'
})
```

## 输入输出扩展

### @strudel/midi

MIDI 输入输出支持。

#### MIDI 输出

```javascript
import { midiOutput } from '@strudel/midi';

// 使用 MIDI 输出
repl({
  defaultOutput: midiOutput({
    device: 'my-synth',
    channel: 1
  })
});
```

#### MIDI 输入

```javascript
import { midiInput } from '@strudel/midi';

// 监听 MIDI 输入
midiInput({
  device: 'my-controller',
  onNote: (note, velocity) => {
    // 处理音符
  },
  onControl: (controller, value) => {
    // 处理控制变化
  }
});
```

#### Web MIDI API

基于浏览器的 Web MIDI API,需要用户授权。

### @strudel/osc

OSC (Open Sound Control) 支持,用于与其他音乐软件通信。

#### OSC 输出

```javascript
import { oscOutput } from '@strudel/osc';

// 使用 OSC 输出
repl({
  defaultOutput: oscOutput({
    host: 'localhost',
    port: 57120  // SuperCollider 默认端口
  })
});
```

#### OSC 消息格式

```javascript
// 发送 OSC 消息
osc.send('/play', ['note', 60, 'velocity', 100]);
```

#### 服务器

包含 OSC 服务器实现:

```javascript
// packages/osc/server.js
// 接收 OSC 消息并转发到 Strudel
```

### @strudel/serial

串口通信支持,用于与硬件设备交互。

#### 使用方式

```javascript
import { serialOutput } from '@strudel/serial';

// 通过串口发送数据
repl({
  defaultOutput: serialOutput({
    port: '/dev/ttyUSB0',
    baudRate: 9600
  })
});
```

#### 应用场景

- Arduino 通信
- 硬件合成器
- 自定义硬件

### @strudel/mqtt

MQTT 协议支持,用于物联网和网络通信。

#### 使用方式

```javascript
import { mqttOutput } from '@strudel/mqtt';

// 通过 MQTT 发送
repl({
  defaultOutput: mqttOutput({
    broker: 'mqtt://broker.example.com',
    topic: 'music/pattern'
  })
});
```

#### 应用场景

- 远程控制
- 分布式音乐系统
- 物联网集成

## 可视化扩展

### @strudel/draw

模式可视化,绘制钢琴卷帘、波形等。

#### 钢琴卷帘

```javascript
import { pianoroll } from '@strudel/draw';

// 绘制钢琴卷帘
pianoroll(pattern, {
  canvas: document.getElementById('canvas'),
  width: 800,
  height: 200
});
```

#### 波形绘制

```javascript
import { waveform } from '@strudel/draw';

// 绘制波形
waveform(audioBuffer, {
  canvas: canvas,
  color: 'blue'
});
```

#### 螺旋可视化

```javascript
import { spiral } from '@strudel/draw';

// 螺旋时间线
spiral(pattern, {
  canvas: canvas,
  revolutions: 4
});
```

### @strudel/hydra

[Hydra](https://hydra.ojack.xyz/) 视觉合成器集成。

#### 使用方式

```javascript
import { hydra } from '@strudel/hydra';

// 使用 Hydra 可视化
hydra(`
  osc(4, 0.1, 1)
    .rotate(0, 0.1)
    .out()
`);
```

#### 与模式同步

```javascript
// 模式驱动视觉
note('c3 e3 g3')
  .s('sawtooth')
  .hydra('osc(4).out()')
```

## 输入设备扩展

### @strudel/gamepad

游戏手柄支持,用于实时控制。

#### 使用方式

```javascript
import { gamepad } from '@strudel/gamepad';

// 监听游戏手柄
gamepad({
  onButton: (button, pressed) => {
    if (pressed) {
      playSound(button);
    }
  },
  onAxis: (axis, value) => {
    // 处理摇杆
    setParameter(axis, value);
  }
});
```

#### 映射配置

```javascript
gamepad({
  mappings: {
    'button0': 'play',
    'button1': 'stop',
    'axis0': 'pan'
  }
});
```

### @strudel/motion

设备运动传感器支持(移动设备)。

#### 使用方式

```javascript
import { motion } from '@strudel/motion';

// 监听设备运动
motion({
  onAccelerometer: (x, y, z) => {
    // 使用加速度数据
    pattern.gain(Math.abs(x));
  },
  onGyroscope: (alpha, beta, gamma) => {
    // 使用陀螺仪数据
    pattern.pan((alpha / 360));
  }
});
```

#### 应用场景

- 移动设备控制
- 倾斜控制
- 手势识别

## 桥接扩展

### @strudel/desktopbridge

桌面应用桥接,提供额外的系统功能。

#### 功能

- 文件系统访问
- 系统通知
- 剪贴板
- 窗口控制

#### 使用方式

```javascript
import { desktopbridge } from '@strudel/desktopbridge';

// 保存文件
await desktopbridge.saveFile('pattern.json', patternData);

// 读取文件
const data = await desktopbridge.readFile('pattern.json');

// 系统通知
desktopbridge.notify('Pattern saved!');
```

### @strudel/tidal

TidalCycles Haskell 代码支持。

#### 使用方式

```javascript
import { tidal } from '@strudel/tidal';

// 执行 Tidal 代码
tidal('sound "bd sn" # speed 1.5');
```

#### 转换器

将 Tidal Haskell 语法转换为 Strudel JavaScript:

```javascript
// Haskell: sound "bd sn"
// JavaScript: s('bd sn')
```

## 记谱法扩展

### @strudel/mondo

Mondo 记谱法,一种替代的简洁记谱法。

#### 语法

```javascript
import { mondo } from '@strudel/mondo';

// Mondo 记谱法
mondo('c3 e3 g3 | a3 c4 e4');
```

#### 特点

- 更接近传统乐谱
- 支持和弦记号
- 支持小节线

### @strudel/mondough

Mondo + Superdough 集成。

```javascript
import { mondough } from '@strudel/mondough';

// 直接播放 Mondo 记谱
mondough('c3 e3 g3').play();
```

## 高级扩展

### @strudel/xen

微音程和异调系统支持。

#### 使用方式

```javascript
import { xen } from '@strudel/xen';

// 使用微音程
xen.note('c3+25c')  // C3 + 25 音分

// 使用异调系统
xen.scale([0, 120, 240, 360, 480, 600, 720])  // 自定义音阶(音分)
```

#### 内置系统

- 平均律 (12-TET, 24-TET, etc.)
- 纯律
- 中庸全音律
- 自定义音阶

### @strudel/reference

API 参考生成器,自动生成文档。

#### 使用方式

```javascript
import { generateReference } from '@strudel/reference';

// 生成 API 文档
const docs = generateReference('@strudel/core');
```

## 工具扩展

### @strudel/embed

嵌入式播放器,用于在网页中嵌入 Strudel。

#### 使用方式

```html
<script src="@strudel/embed"></script>
<div id="player"></div>

<script>
strudelEmbed({
  container: '#player',
  code: 'note("c3 e3 g3").s("sawtooth")',
  autoplay: false
});
</script>
```

#### 特点

- 轻量级
- 无需完整 REPL
- 适合分享和嵌入

### @strudel/sampler

采样服务器,用于本地采样管理。

#### 使用方式

```bash
# 启动采样服务器
cd packages/sampler
node sample-server.mjs
```

#### 功能

- 本地采样库管理
- 自动生成采样映射
- 热重载

### vite-plugin-bundle-audioworklet

Vite 插件,用于打包 Audio Worklet。

#### 使用方式

```javascript
// vite.config.js
import bundleAudioworklet from 'vite-plugin-bundle-audioworklet';

export default {
  plugins: [
    bundleAudioworklet()
  ]
};
```

#### 功能

- 自动打包 Audio Worklet
- 处理 Worklet 依赖
- 优化音频代码

## 示例项目

### examples/minimal-repl

最小化 REPL 示例。

```bash
cd examples/minimal-repl
pnpm install
pnpm start
```

### examples/codemirror-repl

CodeMirror REPL 示例。

```bash
cd examples/codemirror-repl
pnpm install
pnpm start
```

### examples/headless-repl

无头 REPL 示例,用于自定义界面。

```bash
cd examples/headless-repl
pnpm install
pnpm start
```

### examples/buildless

无构建示例,直接在浏览器中运行。

```html
<!-- examples/buildless/basic.html -->
<script type="module">
  import * as strudel from 'https://cdn.strudel.cc';
  // 直接使用 Strudel
</script>
```

## 扩展开发指南

### 创建新扩展

1. 创建包目录:

```bash
mkdir packages/my-extension
cd packages/my-extension
```

2. 创建 package.json:

```json
{
  "name": "@strudel/my-extension",
  "version": "1.0.0",
  "main": "index.mjs",
  "dependencies": {
    "@strudel/core": "workspace:*"
  }
}
```

3. 实现功能:

```javascript
// index.mjs
export function myExtension(options) {
  // 实现扩展功能
}
```

4. 添加测试:

```javascript
// test/my-extension.test.mjs
import { myExtension } from '../index.mjs';

test('my extension works', () => {
  // 测试代码
});
```

5. 添加文档:

```markdown
# @strudel/my-extension

描述扩展功能和使用方式。
```

### 最佳实践

1. **依赖最小化**: 只依赖必需的包
2. **类型安全**: 使用 JSDoc 注释
3. **测试覆盖**: 编写单元测试
4. **文档完善**: 提供清晰的文档和示例
5. **性能优化**: 避免不必要的计算

## 总结

扩展模块遵循以下原则:

1. **模块化**: 每个扩展独立可用
2. **可选性**: 核心功能不依赖扩展
3. **标准化**: 统一的 API 设计
4. **文档化**: 完善的文档和示例
5. **可测试**: 包含测试用例

这些扩展使 Strudel 能够适应各种使用场景,从简单的网页音乐到复杂的现场表演系统。
