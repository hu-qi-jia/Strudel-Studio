---
name: "theme-component-guide"
description: "Strudel 项目主题跟随规则 + 全局字号规范。新建组件时必须遵循此规则以确保组件跟随主题切换且字号统一。当创建新 UI 组件或修改现有组件样式时自动应用。"
---

# Strudel 主题跟随规则

## 核心原则

**所有 UI 组件必须使用主题系统提供的 CSS 变量或 Tailwind 颜色类，禁止使用硬编码颜色值。**

## 主题系统工作原理

主题系统通过 `activateTheme()` 函数（位于 `packages/codemirror/themes.mjs`）动态更新以下 CSS 变量：

```
--background      // 背景色
--foreground      // 前景色（文字）
--lineBackground  // 行背景
--caret           // 光标色
--selection       // 选区色
--lineHighlight   // 行高亮
--gutterBackground // 行号背景
--gutterForeground // 行号前景
```

## 正确用法

### 1. Tailwind 颜色类（推荐）

Tailwind 已在 `tailwind.config.cjs` 中配置了主题颜色映射：

```jsx
// 背景色
<div className="bg-background">
<div className="bg-background/50">  // 50% 透明度

// 文字色
<span className="text-foreground">
<span className="text-foreground/70">  // 70% 透明度

// 边框色
<div className="border border-foreground/20">

// 其他主题色
<div className="bg-lineHighlight text-caret">
```

### 2. CSS 变量（用于非 Tailwind 场景）

```css
.my-component {
  background-color: var(--background);
  color: var(--foreground);
  border-color: var(--foreground);
}
```

```jsx
// 内联样式
<div style={{ backgroundColor: 'var(--background)' }}>
```

## 错误用法

```jsx
// ❌ 硬编码颜色
<div className="bg-[#222] text-white">
<div style={{ color: '#fff' }}>

// ❌ 使用静态 CSS 变量（不会随主题变化）
<div className="bg-[var(--bg)] text-[var(--fg)]">
```

## 透明度处理

**重要：Tailwind 对 CSS 变量颜色的透明度修饰符支持有限，必须使用 `color-mix()` 函数！**

### 正确方法：使用 style 属性 + color-mix()

```jsx
// ✅ 正确：使用 color-mix() 函数
<select
  className="w-full px-2 py-1 rounded border"
  style={{
    backgroundColor: 'color-mix(in srgb, var(--foreground) 7%, transparent)',
    color: 'var(--foreground)',
    borderColor: 'color-mix(in srgb, var(--foreground) 15%, transparent)',
  }}
>

// ✅ 正确：文字透明度
<span style={{ color: 'color-mix(in srgb, var(--foreground) 40%, transparent)' }}>

// ✅ 正确：边框透明度
<div
  className="border-b"
  style={{ borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
>
```

### 错误方法：Tailwind 透明度修饰符

```jsx
// ❌ 错误：Tailwind 无法正确解析 CSS 变量的透明度
<div className="bg-foreground/[0.07]">
<div className="border-foreground/[0.15]">
<span className="text-foreground/[0.40]">
```

### 常用透明度值

| 用途 | color-mix 百分比 |
|------|-----------------|
| 极淡边框 | `8%` |
| 淡边框/分隔线 | `10%` |
| 表单边框 | `15%` |
| 背景色 | `7%` 或 `30%` |
| 次要文字 | `40%` |
| hover 状态 | `70%` |

## 浅色主题注意事项

浅色主题（如 `vscodeLight`, `githubLight`）的 `--foreground` 是深色，`--background` 是浅色。

确保：
- 文字使用 `text-foreground`（不是 `text-white` 或 `text-black`）
- 背景使用 `bg-background`（不是 `bg-black` 或 `bg-white`）
- 边框使用 `border-foreground/XX`（自动适应深浅主题）

## 组件示例

```jsx
// ✅ 正确：跟随主题的弹窗组件
function Modal({ children }) {
  return (
    <div className="bg-background text-foreground border border-foreground/20">
      {children}
    </div>
  );
}

// ❌ 错误：硬编码颜色
function Modal({ children }) {
  return (
    <div className="bg-[#222] text-white border border-white/20">
      {children}
    </div>
  );
}
```

## 检查清单

新建或修改组件时，确认：

- [ ] 无硬编码颜色值（`#xxx`, `white`, `black`）
- [ ] 使用 `bg-background` / `text-foreground` 或对应 CSS 变量
- [ ] 边框使用 `border-foreground/XX` 透明度形式
- [ ] 在浅色和深色主题下都测试显示效果

---

# 表单组件样式规范

**所有表单组件必须遵循以下统一样式规范。新建表单组件时直接复用。**

## 统一规格

| 属性 | 值 |
|------|-----|
| 控件高度 | **28px** (select / input / number) |
| 控件字号 | **10px** (`var(--fs-input)`) |
| 标签字号 | **11px** (`var(--fs-label)`) |
| 行高 | **1.4** |
| 圆角 | **0** (无圆角) |
| 内边距 | **px-2 py-1** |

## 统一样式模板

### Select 下拉框

```jsx
<select
  className="w-full px-2 py-1 border text-foreground"
  style={{
    height: '28px',
    fontSize: '10px',
    lineHeight: '1.4',
    backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
    color: 'var(--foreground)',
    borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
    borderRadius: '0',
  }}
>
```

### Input 文本框 / 数字框

```jsx
<input
  className="w-full px-2 py-1 border text-foreground placeholder-foreground/50"
  style={{
    height: '28px',
    fontSize: '10px',
    lineHeight: '1.4',
    backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
    color: 'var(--foreground)',
    borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
    borderRadius: '0',
  }}
/>
```

### Checkbox 复选框

```jsx
<label className="flex items-center gap-1 cursor-pointer text-[var(--fs-input)] hover:opacity-80">
  <input
    type="checkbox"
    style={{ width: '14px', height: '14px', margin: 0 }}
  />
  <span>{label}</span>
</label>
```

### Range 滑块

```jsx
<input
  className="flex-1 accent-[var(--caret)]"
  type="range"
  style={{ height: '14px' }}
/>
```

### ButtonGroup 按钮（标签切换）

```jsx
<button
  className={cx(
    'px-2 py-0.5 border-b whitespace-nowrap text-[var(--fs-input)] transition-colors',
    isActive ? 'border-foreground' : 'border-transparent text-foreground/50 hover:text-foreground/70',
  )}
  style={{ height: '24px', fontSize: '10px' }}
>
```

### FormItem 容器

```jsx
<div
  className="flex flex-col gap-1 mb-3 pb-3 border-b last:border-b-0"
  style={{ borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
>
  <label className="text-[var(--fs-label)] font-medium text-foreground">
    {label}
  </label>
  {children}
</div>
```

## 现有表单组件位置

| 组件 | 文件路径 | 用途 |
|------|---------|------|
| ButtonGroup | `src/repl/components/panel/Forms.jsx` | 标签切换组 |
| Checkbox | `src/repl/components/panel/Forms.jsx` | 复选框 |
| SelectInput | `src/repl/components/panel/Forms.jsx` | Object 版下拉框 |
| NumberSlider | `src/repl/components/panel/Forms.jsx` | 数字滑块 |
| FormItem | `src/repl/components/panel/Forms.jsx` | 表单项容器 |
| Textbox | `src/repl/components/textbox/Textbox.jsx` | 文本输入框 |
| SelectInput | `src/repl/components/panel/SelectInput.jsx` | Map 版下拉框 |

## 重要提醒

1. **必须使用内联 style 设置尺寸**：`@tailwindcss/forms` 插件会覆盖 Tailwind class 的默认值
2. **禁止使用 Tailwind 的 rounded 类**：统一无圆角设计
3. **禁止使用 p-2 等大 padding**：统一使用 px-2 py-1
4. **新建表单组件时必须复制上述模板**

---

# 全局字号规范

**所有 UI 文字必须使用 `--fs-*` CSS 变量，禁止使用 Tailwind 固定字号类（text-xs/sm/base/lg/xl/2xl/3xl）或硬编码 px 值。**

## 字号变量体系

变量定义位置：`website/src/styles/index.css`

| 变量 | 值 | 用途 | Tailwind 写法 |
|------|-----|------|--------------|
| `--fs-hint` | 10px | 辅助提示文字、次要说明 | `text-[var(--fs-hint)]` |
| `--fs-input` | 11px | 表单输入框、按钮文字、列表项、代码块 | `text-[var(--fs-input)]` |
| `--fs-label` | 12px | 表单标签、Reference 正文段落/列表 | `text-[var(--fs-label)]` |
| `--fs-body` | 13px | 正文、标题基础、Logo、通用文字 | `text-[var(--fs-body)]` |
| `--fs-icon-btn` | 13px | 图标按钮文字 | `text-[var(--fs-icon-btn)]` |
| `--fs-loading` | 17px | 加载状态、大号播放按钮 | `text-[var(--fs-loading)]` |

## 各 UI 元素字号映射

### 顶部栏 (Header)
| 元素 | 变量 | 说明 |
|------|------|------|
| Logo "strudel" | `--fs-body` | 主标题 |
| "REPL" / "DOCS" 标签 | `--fs-input` | 副标签 |
| 操作按钮文字 (play/stop/update/learn/settings) | `--fs-input` | 按钮文字 |
| Patterns / Reference 按钮 | `--fs-input` | 顶部栏按钮 |

### 弹窗 (Modal)
| 元素 | 变量 | 说明 |
|------|------|------|
| 弹窗标题 | `--fs-label` | 标题文字 |
| 关闭按钮 | `--fs-input` | ✕ 按钮 |

### 设置面板 (Settings)
| 元素 | 变量 | 说明 |
|------|------|------|
| 子标签名 (audio/appearance/editor) | `--fs-input` | 标签切换 |
| 表单标签 (FormItem label) | `--fs-label` | 表单标题 |
| 表单输入框文字 | `--fs-input` | select/input/number |
| 复选框标签 | `--fs-input` | checkbox 文字 |
| 辅助提示 (sublabel) | `--fs-hint` | 灰色说明文字 |
| 按钮组文字 (ButtonGroup) | `--fs-input` | 标签切换按钮 |

### Reference 面板
| 元素 | 变量/值 | 说明 |
|------|---------|------|
| 搜索框 | `--fs-input` | 输入框 |
| 左侧列表项 | `--fs-input` | 函数名列表 |
| h2 标题 | 14px (固定) | "API Reference" |
| h3 函数名 | 12px + font-mono | 各函数标题 |
| 正文段落 | `--fs-label` | 描述文字 |
| 代码/行内代码 | `--fs-input` | code 元素 |
| 列表项 | `--fs-label` | 参数列表 |
| 代码示例 (pre) | `--fs-input` | 示例代码块 |

### Patterns 面板
| 元素 | 变量 | 说明 |
|------|------|------|
| 操作按钮 (new/duplicate/delete/import/export) | `--fs-input` | 按钮文字 |
| 模式列表项 | 继承 body | PatternLabel |

### Sounds 面板
| 元素 | 变量 | 说明 |
|------|------|------|
| 声音列表项 | `--fs-input` | 声音名称 |

### Console 面板
| 元素 | 变量 | 说明 |
|------|------|------|
| 日志文字 | `--fs-input` | 控制台输出 |

### 其他组件
| 元素 | 变量 | 说明 |
|------|------|------|
| 大号播放按钮 | `--fs-loading` | BigPlayButton |
| 数字增减器 | `--fs-input` | NumberInput/Incrementor |
| OSC 警告文字 | `--fs-input` | AudioEngineTargetSelector |
| 加载状态 | `--fs-loading` | #loading |

## 禁止用法

```jsx
// ❌ 禁止使用 Tailwind 固定字号类
<span className="text-sm">
<span className="text-xs">
<span className="text-base">
<span className="text-lg">
<span className="text-2xl">

// ❌ 禁止硬编码 px 值（@tailwindcss/forms 覆盖场景除外）
<span style={{ fontSize: '10px' }}>
<span style={{ fontSize: '14px' }}>
```

## 正确用法

```jsx
// ✅ 使用 CSS 变量
<span className="text-[var(--fs-input)]">
<span className="text-[var(--fs-label)]">
<span className="text-[var(--fs-body)]">

// ✅ 内联 style 中使用变量（表单组件必须）
<input style={{ fontSize: 'var(--fs-input)' }} />
```

## 特殊场景：@tailwindcss/forms 覆盖

表单组件（select/input/textarea）会被 `@tailwindcss/forms` 插件覆盖样式，必须使用内联 style 强制设置：

```jsx
<select style={{ fontSize: 'var(--fs-input)', height: '28px' }}>
```

## 特殊场景：prose 排版区域

Reference 等 prose 排版区域，prose 类会使用 em 相对单位设置子元素字号。必须通过高优先级 CSS 选择器覆盖：

```css
#reference-container .ref-content h3 {
  font-size: 12px;  /* 覆盖 prose 默认的 1.25em */
}
#reference-container .ref-content p {
  font-size: var(--fs-label);  /* 覆盖 prose 默认的 1em */
}
```

## 字号变量定义位置

```
website/src/styles/index.css  → :root { --fs-*: Xpx; }
```

修改字号时只需更改此文件中的变量值，全局自动生效。

## 检查清单

新建或修改组件时，确认：

- [ ] 无 Tailwind 固定字号类（text-xs/sm/base/lg/xl/2xl）
- [ ] 无硬编码 px 值（表单组件内联 style 除外，但必须使用 `var(--fs-*)`）
- [ ] 使用对应的 `--fs-*` 变量
- [ ] 表单组件使用内联 style + `var(--fs-input)` 覆盖 @tailwindcss/forms
- [ ] prose 区域使用 CSS 选择器覆盖默认字号
