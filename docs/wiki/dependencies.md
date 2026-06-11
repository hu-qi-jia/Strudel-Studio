# 依赖关系

本文档详细说明 Strudel 的包依赖关系和外部依赖库。

## 包依赖关系图

### 核心依赖层次

```
@strudel/core (基础层)
    ↓
├── @strudel/mini
├── @strudel/tonal
├── @strudel/transpiler
└── @strudel/xen
    ↓
├── @strudel/draw
├── @strudel/webaudio
└── @strudel/codemirror
    ↓
├── @strudel/repl
└── [其他扩展]
```

### 详细依赖关系

#### 1. @strudel/core

**无 Strudel 包依赖** (最底层)

外部依赖:
- `fraction.js@^5.2.1` - 分数运算库

```
@strudel/core
└── fraction.js
```

#### 2. @strudel/mini

依赖:
- `@strudel/core@workspace:*`

外部依赖:
- `peggy@^4.2.0` (dev) - 解析器生成器

```
@strudel/mini
├── @strudel/core
│   └── fraction.js
└── peggy (dev)
```

#### 3. @strudel/tonal

依赖:
- `@strudel/core@workspace:*`

外部依赖:
- `@tonaljs/tonal@^4.10.0` - 音乐理论库
- `chord-voicings@^0.0.1` - 和弦转位
- `webmidi@^3.1.12` - Web MIDI API

```
@strudel/tonal
├── @strudel/core
│   └── fraction.js
├── @tonaljs/tonal
├── chord-voicings
└── webmidi
```

#### 4. @strudel/transpiler

依赖:
- `@strudel/core@workspace:*`

```
@strudel/transpiler
└── @strudel/core
    └── fraction.js
```

#### 5. @strudel/draw

依赖:
- `@strudel/core@workspace:*`

```
@strudel/draw
└── @strudel/core
    └── fraction.js
```

#### 6. superdough

**无 Strudel 包依赖** (独立音频引擎)

外部依赖:
- `nanostores@^0.11.3` - 状态管理

```
superdough
└── nanostores
```

#### 7. @strudel/webaudio

依赖:
- `@strudel/core@workspace:*`
- `@strudel/draw@workspace:*`
- `superdough@workspace:*`

```
@strudel/webaudio
├── @strudel/core
│   └── fraction.js
├── @strudel/draw
│   └── @strudel/core
└── superdough
    └── nanostores
```

#### 8. @strudel/codemirror

依赖:
- `@strudel/core@workspace:*`
- `@strudel/draw@workspace:*`
- `@strudel/transpiler@workspace:*`

外部依赖:
- `@codemirror/*` - CodeMirror 6 相关包
- `@lezer/highlight@^1.2.1` - 语法高亮
- `@replit/codemirror-*` - Vim/Emacs 键绑定
- `nanostores@^0.11.3` - 状态管理
- `@nanostores/persistent@^0.10.2` - 持久化状态

```
@strudel/codemirror
├── @strudel/core
├── @strudel/draw
├── @strudel/transpiler
├── @codemirror/autocomplete
├── @codemirror/commands
├── @codemirror/lang-javascript
├── @codemirror/language
├── @codemirror/search
├── @codemirror/state
├── @codemirror/view
├── @lezer/highlight
├── @replit/codemirror-emacs
├── @replit/codemirror-vim
├── @replit/codemirror-vscode-keymap
├── nanostores
└── @nanostores/persistent
```

#### 9. @strudel/repl

依赖:
- `@strudel/codemirror@workspace:*`
- `@strudel/core@workspace:*`
- `@strudel/draw@workspace:*`
- `@strudel/hydra@workspace:*`
- `@strudel/midi@workspace:*`
- `@strudel/mini@workspace:*`
- `@strudel/soundfonts@workspace:*`
- `@strudel/tonal@workspace:*`
- `@strudel/transpiler@workspace:*`
- `@strudel/webaudio@workspace:*`

```
@strudel/repl
├── @strudel/codemirror (及其所有依赖)
├── @strudel/core
├── @strudel/draw
├── @strudel/hydra
├── @strudel/midi
├── @strudel/mini
├── @strudel/soundfonts
├── @strudel/tonal
├── @strudel/transpiler
└── @strudel/webaudio
```

#### 10. @strudel/csound

依赖:
- `@strudel/core@workspace:*`
- `@strudel/webaudio@workspace:*`

外部依赖:
- `@csound/browser@6.18.7` - Csound 浏览器绑定

```
@strudel/csound
├── @strudel/core
├── @strudel/webaudio
│   ├── @strudel/core
│   ├── @strudel/draw
│   └── superdough
└── @csound/browser
```

### 扩展包依赖

#### @strudel/midi

依赖:
- `@strudel/core@workspace:*`

```
@strudel/midi
└── @strudel/core
```

#### @strudel/osc

依赖:
- `@strudel/core@workspace:*`

```
@strudel/osc
└── @strudel/core
```

#### @strudel/hydra

依赖:
- `@strudel/core@workspace:*`

```
@strudel/hydra
└── @strudel/core
```

#### @strudel/gamepad

依赖:
- `@strudel/core@workspace:*`

```
@strudel/gamepad
└── @strudel/core
```

#### @strudel/motion

依赖:
- `@strudel/core@workspace:*`

```
@strudel/motion
└── @strudel/core
```

#### @strudel/serial

依赖:
- `@strudel/core@workspace:*`

```
@strudel/serial
└── @strudel/core
```

#### @strudel/mqtt

依赖:
- `@strudel/core@workspace:*`

```
@strudel/mqtt
└── @strudel/core
```

#### @strudel/soundfonts

依赖:
- `@strudel/core@workspace:*`
- `@strudel/webaudio@workspace:*`

```
@strudel/soundfonts
├── @strudel/core
└── @strudel/webaudio
```

#### @strudel/xen

依赖:
- `@strudel/core@workspace:*`

外部依赖:
- `tune.js` - 微音程库

```
@strudel/xen
├── @strudel/core
└── tune.js
```

#### @strudel/desktopbridge

依赖:
- `@strudel/core@workspace:*`

```
@strudel/desktopbridge
└── @strudel/core
```

## 外部依赖分类

### 核心依赖

| 库 | 版本 | 用途 | 使用包 |
|---|------|------|--------|
| `fraction.js` | ^5.2.1 | 精确分数运算 | @strudel/core |

### 音频相关

| 库 | 版本 | 用途 | 使用包 |
|---|------|------|--------|
| `@csound/browser` | 6.18.7 | Csound 绑定 | @strudel/csound |

### 音乐理论

| 库 | 版本 | 用途 | 使用包 |
|---|------|------|--------|
| `@tonaljs/tonal` | ^4.10.0 | 音乐理论库 | @strudel/tonal |
| `chord-voicings` | ^0.0.1 | 和弦转位 | @strudel/tonal |
| `webmidi` | ^3.1.12 | Web MIDI API | @strudel/tonal |

### 编辑器相关

| 库 | 版本 | 用途 | 使用包 |
|---|------|------|--------|
| `@codemirror/autocomplete` | ^6.18.4 | 自动完成 | @strudel/codemirror |
| `@codemirror/commands` | ^6.8.0 | 命令 | @strudel/codemirror |
| `@codemirror/lang-javascript` | ^6.2.2 | JS 语法 | @strudel/codemirror |
| `@codemirror/language` | ^6.10.8 | 语言支持 | @strudel/codemirror |
| `@codemirror/search` | ^6.5.8 | 搜索 | @strudel/codemirror |
| `@codemirror/state` | ^6.5.1 | 状态管理 | @strudel/codemirror |
| `@codemirror/view` | ^6.36.2 | 视图层 | @strudel/codemirror |
| `@lezer/highlight` | ^1.2.1 | 语法高亮 | @strudel/codemirror |
| `@replit/codemirror-emacs` | ^6.1.0 | Emacs 键绑定 | @strudel/codemirror |
| `@replit/codemirror-vim` | ^6.2.1 | Vim 键绑定 | @strudel/codemirror |
| `@replit/codemirror-vscode-keymap` | ^6.0.2 | VSCode 键绑定 | @strudel/codemirror |

### 状态管理

| 库 | 版本 | 用途 | 使用包 |
|---|------|------|--------|
| `nanostores` | ^0.11.3 | 微型状态管理 | superdough, codemirror, repl |
| `@nanostores/persistent` | ^0.10.2 | 持久化状态 | @strudel/codemirror |

### 解析器

| 库 | 版本 | 用途 | 使用包 |
|---|------|------|--------|
| `peggy` | ^4.2.0 | 解析器生成器 | @strudel/mini (dev) |

### 构建工具

| 库 | 版本 | 用途 | 使用包 |
|---|------|------|--------|
| `vite` | ^6.0.11 | 构建工具 | 所有包 (dev) |
| `vitest` | ^3.0.4 | 测试框架 | 所有包 (dev) |

### Website 依赖

| 库 | 版本 | 用途 |
|---|------|------|
| `astro` | ^5.1.9 | 静态站点生成 |
| `react` | ^19.0.0 | UI 框架 |
| `react-dom` | ^19.0.0 | React DOM |
| `@astrojs/mdx` | ^4.0.7 | MDX 支持 |
| `@astrojs/react` | ^4.1.6 | React 集成 |
| `@astrojs/tailwind` | ^5.1.5 | Tailwind 集成 |
| `tailwindcss` | ^3.4.17 | CSS 框架 |
| `@headlessui/react` | ^2.2.0 | 无样式 UI 组件 |
| `@heroicons/react` | ^2.2.0 | 图标库 |
| `@docsearch/react` | ^3.8.3 | 搜索组件 |
| `@supabase/supabase-js` | ^2.48.1 | 数据库 |
| `@tauri-apps/api` | ^2.2.0 | Tauri API |

## 开发依赖

### 根目录开发依赖

```json
{
  "@eslint/compat": "^1.2.5",
  "@eslint/eslintrc": "^3.2.0",
  "@eslint/js": "^9.19.0",
  "@tauri-apps/cli": "^2.2.7",
  "@vitest/coverage-v8": "3.0.4",
  "@vitest/ui": "^3.0.4",
  "acorn": "^8.14.0",
  "dependency-tree": "^11.0.1",
  "eslint": "^9.19.0",
  "eslint-plugin-import": "^2.31.0",
  "events": "^3.3.0",
  "globals": "^15.14.0",
  "jsdoc": "^4.0.4",
  "jsdoc-json": "^2.0.2",
  "lerna": "^8.1.9",
  "prettier": "^3.4.2",
  "vitest": "^3.0.4",
  "vite-plugin-bundle-audioworklet": "workspace:*"
}
```

### 用途说明

| 工具 | 用途 |
|------|------|
| ESLint | 代码检查 |
| Prettier | 代码格式化 |
| Vitest | 单元测试 |
| Lerna | Monorepo 管理 |
| JSDoc | 文档生成 |
| Tauri CLI | 桌面应用构建 |

## 依赖版本策略

### 版本固定

- **生产依赖**: 使用 `^` 前缀,允许次版本更新
- **开发依赖**: 使用 `^` 前缀,允许次版本更新
- **Workspace 依赖**: 使用 `workspace:*`,指向本地包

### 更新策略

1. **安全更新**: 自动接受补丁版本更新
2. **次版本更新**: 需要测试后接受
3. **主版本更新**: 需要评估破坏性变更

### 依赖锁定

使用 `pnpm-lock.yaml` 锁定确切版本,确保可重现构建。

## 依赖优化建议

### 减小包体积

1. **Tree Shaking**: 使用 ES 模块,支持 tree shaking
2. **按需导入**: 只导入需要的函数
3. **替代方案**: 评估是否可以用更小的库

### 示例

```javascript
// 不推荐: 导入整个库
import _ from 'lodash';

// 推荐: 按需导入
import debounce from 'lodash/debounce';
```

### 依赖审计

定期运行依赖审计:

```bash
# 检查安全漏洞
pnpm audit

# 检查过时依赖
pnpm outdated

# 更新依赖
pnpm update
```

## 循环依赖检测

Strudel 包之间**没有循环依赖**,依赖关系是有向无环图(DAG)。

### 验证方法

```bash
# 使用 dependency-tree 检测
npx dependency-tree packages/core/index.mjs
```

## 总结

依赖关系设计遵循以下原则:

1. **单向依赖**: 上层依赖下层,避免循环
2. **最小依赖**: 每个包只依赖必需的包
3. **明确职责**: 每个依赖都有明确的用途
4. **版本管理**: 使用语义化版本
5. **安全审计**: 定期检查安全漏洞

这种设计使得 Strudel 具有良好的模块化和可维护性。
