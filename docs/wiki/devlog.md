# 开发日志

## 2026-06-12 Reference 分类导航与字号规范化

### 变更概要

1. **Reference 面板分类导航重构** — 从扁平列表改为树形折叠结构
2. **全局字号体系升级** — 所有 CSS 变量 +1px，表单组件硬编码字号改为变量引用
3. **表单组件字号规范化** — 消除硬编码，统一使用 CSS 变量

---

### 一、Reference 面板分类导航

#### 背景

原站 Reference 面板使用 `@tags` JSDoc 注解实现函数分类（如 amplitude、envelope、filter 等功能导向分类），当前项目 `doc.json` 中缺少 `@tags` 字段，仅有 `meta.path` 和 `meta.filename`。

#### 实现方案

基于 `meta.path`（包名）+ `meta.filename`（core 内部按文件名）自动推断分类：

| 分类 | 来源 | 数量 |
|------|------|------|
| pattern | core/pattern.mjs | ~105 |
| control | core/controls.mjs | ~137 |
| signal | core/signal.mjs | ~52 |
| pick | core/pick.mjs | ~13 |
| euclid | core/euclid.mjs | ~5 |
| superdough | superdough 包 | ~17 |
| tonal | tonal 包 | ~7 |
| motion | motion 包 | ~15 |
| midi | midi 包 | ~4 |
| audio | webaudio 包 | ~3 |
| visualization | draw 包 | ~4 |
| editor | codemirror 包 | ~2 |
| osc | osc 包 | ~1 |
| csound | csound 包 | ~1 |
| internal | repl/util/drawLine | ~4 |
| untagged | 未匹配 | - |

#### UI 结构

```
┌──────────────────┬─────────────────────────┐
│  左侧 (1/3)       │  右侧详情 (2/3)          │
│ ┌──────────────┐ │                         │
│ │ Search...    │ │  h3: 函数名              │
│ ├──────────────┤ │  分类标签                │
│ │ ▶ pattern 105│ │  Synonyms: ...          │
│ │ ▶ control 137│ │  描述 (HTML)            │
│ │ ▼ signal   52│ │  参数列表               │
│ │   cosine     │ │  代码示例               │
│ │   sine       │ │                         │
│ │   ...        │ │                         │
│ │ ▶ pick     13│ │                         │
│ │ ...          │ │                         │
│ └──────────────┘ │                         │
└──────────────────┴─────────────────────────┘
```

- **一级节点**：分类名称 + 函数数量，点击展开/折叠
- **二级节点**：函数名称 + 同义词，点击在右侧显示详情
- **搜索**：实时过滤，搜索时自动展开所有匹配分类
- **右侧**：仅显示选中函数的详情内容

#### 涉及文件

- `website/src/repl/components/panel/Reference.jsx` — 完全重写
- `website/src/repl/Repl.css` — Reference 内容区字号调整

---

### 二、全局字号体系升级

#### 变更内容

所有 CSS 变量字号 +1px（两次调整，累计 +2px）：

| 变量 | 原值 | 新值 | 用途 |
|------|------|------|------|
| `--fs-hint` | 10px | 12px | 提示/辅助文字 |
| `--fs-input` | 11px | 13px | 表单输入框、按钮 |
| `--fs-label` | 14px | 16px | 表单标签 |
| `--fs-body` | 14px | 16px | 正文、标题、编辑器 |
| `--fs-icon-btn` | 14px | 16px | 图标按钮 |
| `--fs-loading` | 18px | 20px | 加载状态 |

#### Reference 内容区字号

| 元素 | 原值 | 新值 |
|------|------|------|
| 基础 | 12px | 14px |
| h2 | 14px | 16px |
| h3 | 12px | 14px |
| p | 13px | 15px |
| code | 11px | 13px |
| li | 13px | 15px |
| pre | 11px | 13px |

#### 涉及文件

- `website/src/styles/index.css` — 全局字号变量定义
- `website/src/repl/Repl.css` — Reference 内容区字号

---

### 三、表单组件字号规范化

#### 背景

Forms.jsx 及相关组件中存在硬编码 `13px` 字号，当全局字号变量变化时不会跟随更新。

#### 变更内容

将所有硬编码 `fontSize: '13px'` / `text-[13px]` 替换为 `var(--fs-input)`：

| 文件 | 组件 | 变更 |
|------|------|------|
| Forms.jsx | ButtonGroup | `fontSize: '13px'` → `var(--fs-input)` |
| Forms.jsx | Checkbox | `text-[13px]` → `style={{ fontSize: 'var(--fs-input)' }}` |
| Forms.jsx | SelectInput | `fontSize: '13px'` → `var(--fs-input)` |
| Forms.jsx | NumberSlider | `fontSize: '13px'` → `var(--fs-input)` |
| action-button.jsx | ActionButton | `text-[13px]` → `style={{ fontSize: 'var(--fs-input)' }}` |
| ImportSoundsButton.jsx | — | `fontSize: '13px'` → `var(--fs-input)` |
| SoundsTab.jsx | — | `text-[13px]` → `style={{ fontSize: 'var(--fs-input)' }}` |

#### 涉及文件

- `website/src/repl/components/panel/Forms.jsx`
- `website/src/repl/components/button/action-button.jsx`
- `website/src/repl/components/panel/ImportSoundsButton.jsx`
- `website/src/repl/components/panel/SoundsTab.jsx`

---

### 四、其他修复

- **Reference.jsx** — 移除未使用的 `Fragment` import
- **Reference.jsx** — 分类标签字号从 `text-[11px]` 改为 `var(--fs-hint)`（12px）
