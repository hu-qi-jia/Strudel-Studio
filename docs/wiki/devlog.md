# 开发日志

## 2026-06-20 Agent「审美」根因排查：和弦符号静默失败 + 受限网络死采样

### 触发

让 agent 写一个「梦核 beat」，产出大量静音层且报 `[voicing]: unknown chord "Cmaj7"`。
效果很不好。用户问：如何提升 agent 审美？它怎么知道代码编排好听？

### 根因

1. **和弦符号 bug（确定性，错误信息明示）**：`voicing()` 字典（`packages/tonal/ireal.mjs`）
   是 iReal 爵士记号，大七 = `^7`/`M7`，**不认 `maj7`**。`renderVoicing`（`tonleiter.mjs:144`
   `dictionary[symbol].map(...)`）对未知符号访问 undefined 抛异常，而 `voicings.mjs:209-212`
   **静默吞掉返回 silence**——不报错、只是没声。更糟的是 `knowledge.mjs` 和
   `ContextManager.mjs:214` 的示例**本身就在教 `Cmaj7` 这个错写法**，agent 原样复制。
2. **受限网络死采样（网络相关，取决于 VPN 状态；非本次确定性原因）**：用户 CN 网络下
   若 VPN 关闭，`bd`/`sd`/`hh`（默认 Dirt-Samples）和 `gm_*`（GM soundfont）会 403 静默无输出
   （见 [[sample-cdn-jsdelivr]]）。本次生成代码大量用了这类音色——VPN 开则正常、关则半哑。
   已有记忆载明用户选了 VPN、sample-based 配方应保留；故不把"死采样"当本次确定性根因，
   但它是一个真实且无反馈的风险（静默无输出），值得常驻护栏兜底。
3. **静默失败零反馈**：voicing() 吞异常；死采样静默无输出。agent 完全不知道某层哑了，
   `analyze_audio` 测的是整体 RMS，读不出「某层静音」。

### 修复

- **`codeGuard.mjs`**：新增 `BAD_CHORD_SYMBOLS` 静态拦截——扫描字符串字面量里的
  `maj7/min7/maj9/min9/maj11/min11/maj13`，给出 iReal 修正（`^7`/`M7`/`-7`/`m7`…）。
  agent 的写入护栏自己挡住错写法 → 触发自纠正回路。+3 单测（共 15）。
- **`knowledge.mjs`**：
  - 修掉所有示例里的 `Cmaj7`/`Fmaj7` → `C^7`/`F^7`（ARRANGEMENT_TOOLKIT / FORM_TEMPLATES A,C /
    GENRE_COOKBOOK）。
  - 新增「Chord symbol notation」权威记号表（对照 `voicings.mdx` 官方文档核实）+
    「prefer explicit note arrays for sustained pads」（显式音符 `note("<[c3,e3,g3,b3]>")`
    永不静默失败）。
  - 新增常驻导出 `INSTRUMENT_RELIABILITY`：ALWAYS-LOADS（合成器/噪声/ZZFX/piano/vcsl/sbd）
    vs VERIFY-FIRST（`gm_*`/鼓机 `.bank()`/默认 `bd`-`sd`-`hh`/自定义采样）硬规则 + 一套
    任何网络都能响的**合成鼓配方**（sine kick + noise snare/hat + sine sub）兜底。
    注：这是**网络无关的 verify-first 原则**（VPN 开则 preview 通过、不触发兜底；VPN 关则自动
    换合成器），与既有决策「用户用 VPN、保留 sample-based 配方」一致——不动既有模板的乐器，
    只加一层「先 preview、哑了就回退」的护栏 + 兜底配方。
- **`ContextManager.mjs`**：导入并**常驻注入** `INSTRUMENT_RELIABILITY`（放在 ARRANGEMENT_TOOLKIT
  之前，作为头号前提规则）；修掉 `PATTERN_FUNCTIONS` 里 `.chord("Cmaj7")` 错示例。

### 验证

`node --check` 三文件 OK；`knowledge.mjs` 运行时导入校验（INSTRUMENT_RELIABILITY 渲染、
无残留 `Cmaj7`、`C^7` 正确）；vitest **40/40**（+3 和弦测试）；eslint 0 error；
网站构建 70 页 + PWA 成功。

### 给用户的「审美」结论

agent 的「审美」= 正确的 API 基础（无幻觉）+ 能真正发声的音色 + 能抓到静默失败的反馈回路 +
从已验证的好模板出发。前三项此前都弱：知识库教错和弦符号、用网络死音色当默认、静默失败零反馈。
本轮把「正确性」和「能发声」补上——这是审美的大前提；有了它，已有的 analyze_arrangement/
analyze_audio 自检回路才有意义。

## 2026-06-20 Agent「听觉反馈回路」收尾 + 思考过程折叠 + 一处潜在崩溃修复

### 背景

目标：让 agent 像世界级 live-coding 作曲家那样产出好听、完整度高的作品。本轮聚焦两件用户提的事——
①某些多模态模型有声音识别能力，能否用它判生成质量？②生成时思考过程太长，能否折叠——
并补齐/验证「自我评估回路」与「曲式脚手架」两块 P0。

### Q1：多模态判质量的结论（不在代码，记录决策）

技术上 Gemini、OpenAI `gpt-4o-audio` 能收音频输入判质量，**Anthropic 完全不能**（无音频模态）。
而 `providers.mjs` 刻意**不发原始音频**给模型（只发合成文本提示 + handleId，跨 provider 安全）。
故「多模态评判」可行但 **provider 锁定 + 贵 + 当前管线不支持**。改为落地**两条 provider 无关**的本地反馈：

- **静态耳朵 `analyze_arrangement`**：扫源码给编排打分（分层/力度/空间/效果/曲式/自动化/速度 7 维），零成本零风险，每次生成都跑。
- **DSP 耳朵 `analyze_audio`**：离线渲染几 cycle → 测削波/响度/动态/三频平衡/立体声/静音，听静态看不出的物理问题。

这两条由 `COMPLETION_CONTRACT` 第 6 条强制：写码后必跑 `analyze_arrangement`，`form`/`layers` 不过或低分就不算完成；编排合格后对「要靠耳判断」的曲子再跑一次 `analyze_audio`。

### Q2：折叠过长的思考过程（双路实现）

根因：`useAgent` 的 stream 循环**没消费 `reasoning-*` 事件**，`ChatMessage` **不解析 `<think>` 标签** →
原生思考模型（Anthropic 扩展思考/o 系列/Gemini thinking）的思考被整段丢弃；GLM/DeepSeek/Qwen 等
OpenAI 兼容模型把 `<think>…</think>` 当普通文本流，于是内联刷屏。两条路都要治：

| 文件 | 改动 |
|------|------|
| `website/src/repl/agent/useAgent.jsx` | 新增 `reasoning-start`/`reasoning-delta`/`reasoning-end` 事件处理，累积到 `message.reasoning`（仅 UI 展示，`toCoreMessages` 不回灌模型，避免某些 provider 拒收外部 reasoning） |
| `website/src/repl/agent/thinkingParse.mjs`（新） | 纯函数 `splitThinking`：把文本切成「正文 / 思考段」交替，支持 `<think>/<thinking>/<reasoning>/<reflection>`，未闭合（流式中）也算思考段；成对闭合（`<think>`↔`</think>`，不与 `</thinking>` 错配） |
| `website/src/repl/components/agent/ChatMessage.jsx` | 抽出内联解析改 import 纯模块；新增 `ThinkingBlock`（原生 `<details>` 默认折叠，显示字符/行数）；`message.reasoning` 与内联思考段都折叠展示 |

### 一处潜在崩溃修复：webaudio 离线渲染拆分

`tools.mjs` 的 `analyze_audio` 从 `@strudel/webaudio` import 了 `renderPatternToBuffer`，但 `webaudio.mjs`
当时只导出**单体**的 `renderPatternAudio`（内部硬编码下载 WAV + 全局 context swap）——即该 import 拿到的是
`undefined`，`analyze_audio` 一调就崩。本轮把渲染核心抽出：

| 文件 | 改动 |
|------|------|
| `packages/webaudio/webaudio.mjs` | 新增 `renderPatternToBuffer(...)`：只渲染返回 `AudioBuffer`、不下载，内部仍做安全的 context swap+恢复；`renderPatternAudio` 变成「渲染 + 转 WAV + 下载」薄包装（行为完全不变）；`OfflineAudioContext` 长度加 `Math.max(1,…)` 防御零长度 |

### UX 修复：`analyze_audio` 分析后恢复播放

`analyze_audio` 渲染前会停掉调度器（镜像 `handleExport` 的安全编排），原实现分析完不恢复 → 用户被留在静音。
现分析后调 `editor.evaluate()`（默认 autostart）重新起播。

### 质量：lint 修复 + 新增单测

| 文件 | 改动 |
|------|------|
| `website/src/repl/agent/tools.mjs` | 3 处空 `catch {}` 补注释（`no-empty`） |
| `website/src/repl/agent/ContextManager.mjs` | WEB TOOLS 单引号字符串里的多余 `\`` 转义去掉（`no-useless-escape`） |
| `website/src/repl/agent/codeGuard.mjs` | EMOJI_REGEX 的 `no-misleading-character-class`（FE0F/200D/20E3 在 `/u` 字符类里属误报）加 `eslint-disable-next-line`，正则逐字节不变 |
| `website/src/repl/agent/plugins/mp3-analyzer/analyzer.mjs` | 未使用的 `catch (e)` → `catch`（`no-unused-vars`） |
| `eslint.config.mjs` | 测试文件放宽 `import/no-extraneous-dependencies`（vitest 在根 devDeps，website 下无声明；测试 runner 不算外部依赖） |
| `thinkingParse.test.mjs` / `arrangementCheck.test.mjs` / `audioAnalysis.test.mjs` / `codeGuard.test.mjs`（新） | 37 个单测：思考解析边界（闭合/未闭合/多标签/错配）、编排打分（flat loop 低分 / production 100 分 / stack 计多声部）、DSP（静音/削波/糊低频/平衡噪声/立体声相关）、**codeGuard 安全不变量**（外泄原语 fetch/WebSocket/localStorage/eval/Function/setTimeout、间接访问 globalThis["fetch"]/Reflect.get、注释不误报、无效 API） |

### 验证

- `node --check`：`webaudio.mjs` / `knowledge.mjs` / `ContextManager.mjs` / `tools.mjs` / `Guardrail.mjs` / `codeGuard.mjs` / `thinkingParse.mjs` 全 OK
- IDE 诊断：`useAgent.jsx` / `ChatMessage.jsx` / `tools.mjs` / `webaudio.mjs` 均 0 错
- `eslint`：`website/src/repl/agent/` 全目录 + `webaudio.mjs` + `eslint.config.mjs` 0 error；既有 `packages/core` 测试 0 error（17 既有 warning 不变，零回归）
- `vitest`：新增 4 文件 37/37 通过
- `npm run build`（website）：70 页 + PWA 生成成功（两次，含 ChatMessage 重构后）

### 已知权衡（非 bug）

- `COMPLETION_CONTRACT` 第 6 条让 `analyze_arrangement` 对**每个**生成请求强制——简单请求（"就给个 kick"）也会被推向多声部+曲式。这是为「完整度高」目标刻意调强的；若用户只想要单声部，需在指令里明说。
- `<think>` 思考内容仍随 `message.content` 原样回灌模型（多轮历史里保留）。对 DeepSeek 等有独立 `reasoning_content` 的 API 略冗余，但剥离有 provider 特异性风险，保持现状。

## 2026-06-19 采样 403 报错治理：错误去重 + 永久失败缓存 + 根因排查

### 问题

1. `play` 时日志面板不断刷新同一条 `[getTrigger] error: HTTP 403 for .../RolandTR808/.../BD0000.WAV`，刷屏。
2. 排查 403 根因。

### 根因（从用户本机 curl 实测，反映的是用户真实网络）

- jsDelivr 对 **>50MB 的 GitHub 仓库整体 403**，响应体明说 `Package size exceeded the configured limit of 50 MB`。中招仓库：`ritchse/tidal-drum-machines`（所有鼓机 kit）、`tidalcycles/Dirt-Samples`（连默认 `bd/sd/hh` 也 403）。
- `raw.githubusercontent.com` / `api.github.com` / `*.github.io`（GM 音色主机 `felixroos.github.io`）/ 各类 CN GitHub 代理 / `gcore.jsdelivr` / `statically` 在本网络下全部 **000（不可达）**。
- 唯一可达的镜像只有 `cdn.jsdelivr.net`，而它又受 50MB 限制 → 大仓库里的采样在本网络**彻底无法加载**（合成器波形 + `dough-samples` 内的 piano/vcsl 仍可用）。
- 报错刷屏的直接机制：`loadBuffer` 失败时无条件 `delete loadCache[url]` → 每个 cycle 都重新 fetch + 失败 + 由 `getTrigger` 捕获并 `errorLogger` 打印。

### 修复

| 文件 | 改动 |
|------|------|
| `packages/core/logger.mjs` | `errorLogger` 用 `Set`（key=`${origin}::${message}`）去重；新增 `resetErrorLog()` |
| `packages/core/repl.mjs` | `evaluate` 开头调用 `resetErrorLog()`——改代码/重播时让同类错误可再提示一次 |
| `packages/superdough/sampler.mjs` | `loadBuffer` 改为 `entry={promise,permanentFailAt}` 结构；新增 `isPermanentError()`：4xx（除 408/429）按 60s TTL 缓存失败、不再每 cycle 重 fetch；网络错误/5xx 仍清缓存立即重试 |

三个文件均通过 `node --check`。**注意：本改动只解决日志刷屏与无谓重试，并不让那些 >50MB 的鼓机采样"能加载"——那需要 VPN 或改用合成打击乐。**

## 2026-06-19 Agent 音乐知识增强：编排技法 + 采样音色识别

### 变更概要

1. **联网学习 awesome-strudel** — 研读社区曲目（eefano/strudel-songs-collection 等）与音色库资源，提炼编排技法与采样运用规律
2. **新增知识语料库 `knowledge.mjs`** — 集中维护编排工具箱、采样音色识别、流派编排骨架、社区采样包四段知识
3. **修正 `setcps` 误判** — `setcps` 本是合法函数（`repl.mjs` 导出），原黑名单误伤；改为教授正确的 `setcpm(bpm/4)` / `setcps(bpm/60/4)` 速度换算
4. **ContextManager 按需注入** — 编排工具箱常驻；采样/流派/采样包知识按关键词（中英文）注入

---

### 一、研究产出：从曲目中提炼的编排规律

研读 `terryds/awesome-strudel` 及其指向的 `eefano/strudel-songs-collection`（80+ 首翻唱/原创，含 Pyramid Song、Rhythm of the Night、Pump Up The Jam、Enjoy the Silence、Stranger Things 等），归纳出 agent 此前缺失的关键技法：

| 技法 | 曲目实证 | 旧 prompt 状态 |
|------|----------|----------------|
| 速度设置 `setcps(bpm/60/4)` / `.cpm(bpm/4)` | 几乎每首开头都有 | **被误判为非法并禁用** |
| `stack()` 多声部 + 命名轨道 `drums:`/`bass:` | 所有多声部作品 | 仅强调 `$:`，未教 stack |
| 和声系统 `chord()/.anchor()/.voicing()/.rootNotes()/.struct()` | oh.js / rhythmofthenight / happybirthday | 仅提 `.chord()` 一行 |
| scale 带八度 `"c4:minor"` / `"c2:minor"` | 区分贝斯/旋律音区 | 仅示 `"C:minor"` |
| `.apply(voiceFn)` / `.layer()` 音色与音符解耦 | enjoythesilence | 未提及 |
| 鼓机 `.bank("RolandTR909")` 等 | pumpupthejam / clubbed | 仅一笔带过 |
| GM 音色 `gm_oboe`/`gm_piccolo` 等 | oh.js / cadenza | 未给命名规律 |
| GitHub 加载采样包 `await samples({...},'github:...')` | enjoythesilence | 完全缺失 |

所有技法在引入 prompt 前，均**对照本仓库引擎源码核实存在**：`setcps`/`setcpm`/`cpm`（`repl.mjs`）、`samples()`（`superdough/sampler.mjs:229`）、`.bank/.chord/.anchor/.voicing/.struct/.apply`（`controls.mjs` / `tonal/voicings.mjs`）。

### 二、实现

- **`website/src/repl/agent/knowledge.mjs`（新增）** — 导出 4 段 prompt 片段：
  - `ARRANGEMENT_TOOLKIT`：速度换算、stack+命名轨道、chord/voicing 和声、scale+八度、apply/layer、段落变化（**常驻注入**）
  - `SAMPLES_GUIDE`：鼓机音色库（按流派选 kit）、GM 音色命名规律（按乐器族）、GitHub 自定义采样包加载（与 `SOUND_REFERENCE` 同条件注入）
  - `GENRE_COOKBOOK`：浩室/低保真/陷阱/氛围/翻唱 5 个完整作品起点模板（命中曲风关键词注入）
  - `SAMPLE_BANKS`：awesome-strudel 社区采样包索引（命中 github/采样包关键词注入）
- **`website/src/repl/agent/tools.mjs`** — 从 `INVALID_FUNCTIONS` 移除 `setcps`（修正误伤，附注释说明历史原因）
- **`website/src/repl/agent/ContextManager.mjs`**：
  - 导入 `knowledge.mjs` 四段
  - `INVALID_METHODS_SECTION` 删除错误的 `setcps → setcpm` 条目，改为正向速度函数说明
  - `KEYWORD_PATTERNS` 新增 `needsGenreCookbook`、`needsSampleBanks`（中英文）
  - `buildSystemPrompt` 装配：编排工具箱常驻；音色知识在 needsSounds/needsGenreCookbook/短消息 时注入；流派/采样包按需注入

### 三、验证

- 三文件均通过 `node --check`，IDE 无诊断告警
- 导出内容校验：4 段均非空，`setcpm(124/4)` / `stack(` / `.voicing()` / `.bank("RolandTR909")` / `gm_oboe` / `await samples(` / `github:USER/REPO` / `setDefaultVoicings` 全部就位
- 关键词正则在「来一段浩室舞曲 / 给我一段lofi / 写一首完整的曲子 / 帮我加载github采样包 / 给我鼓组 / make a trap beat」上命中符合预期

### 四、设计取舍

- **知识与装配解耦**：大段语料放 `knowledge.mjs`，`ContextManager` 只管按需注入，便于后续持续「学习」扩充
- **模板用最稳原语**：流派模板用显式音符/和弦 + scale（而非易错的 `chord()/voicing()` 链），进阶和声技法在 TOOLKIT 文档化、由模型按需升级
- **音色名不强记全集**：GM/鼓机名给命名规律 + 常用代表，明确指示「不确定时 `list_sounds` 核实」，避免幻觉出引擎不存在的名字

---

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

---

## 2026-06-13 ~ 2026-06-14 Agent 架构审查与重构

### 变更概要

1. **Agent 架构审查** — 以专家视角审查现有 agent 设计，识别核心问题
2. **SoundRegistry** — 从 `soundMap` 动态同步音色，解决采样库无法查询的根本问题
3. **ContextManager** — 动态 System Prompt + 智能上下文压缩，替代 443 行硬编码 SYSTEM_PROMPT
4. **useAgent hook** — 分离 UI 与业务逻辑，AgentSidebar 从 387 行降至 117 行
5. **工具增强** — 新增 6 个工具，改进 replace_code
6. **移除意图检测** — 删除冗余的 detectIntent，使用 `toolChoice: 'auto'`
7. **Bug 修复** — 项目隔离、输出中断、闭包陷阱、渲染风暴等

---

### 一、架构审查：发现的问题

| 问题 | 严重程度 | 说明 |
|------|----------|------|
| 采样库音色无法动态查询 | **致命** | System Prompt 硬编码少量音色名，无法感知运行时 `soundMap` 中的全部音色 |
| System Prompt 臃肿(443行) | 高 | 所有参考信息一次性注入，浪费 token，且无法按需调整 |
| 逻辑与 UI 紧耦合 | 高 | AgentSidebar 387 行混合了流处理、工具调用、状态管理、UI 渲染 |
| 意图检测冗余 | 中 | `detectIntent` 与 Vercel AI SDK 的 `toolChoice: 'auto'` 功能重叠 |
| maxTokens 上限太小 | 中 | 最大 16384，主流 LLM 已支持百万上下文 |
| maxSteps 太小 | 高 | 初始值 5，复杂任务需要多步工具调用，频繁中断 |
| 项目隔离缺失 | 高 | 新建 pattern 时 agent 对话不刷新，所有项目共享同一对话 |
| 闭包陷阱 | 高 | `sendMessage` 依赖 `[messages, ...]`，每次 `setMessages` 重新创建函数导致中断 |
| 渲染风暴 | 中 | 每个 `text-delta` 事件都调用 `setMessages`，导致 UI 卡顿 |

---

### 二、SoundRegistry — 采样库音色动态查询

#### 背景

原方案在 System Prompt 中硬编码少量音色名（如 `s0`, `s1`），agent 无法感知运行时 `soundMap` 中的全部可用音色。用户要求 agent 能识别和调用采样库中的音频。

#### 实现

- 从 `@strudel/webaudio` 导入 `soundMap`（与 SoundsTab.jsx 一致）
- `soundMap.get()` 获取运行时所有可用音色的 Map
- `generateSummary()` 生成音色摘要，注入 System Prompt
- 提供 3 个工具供 agent 查询：

| 工具 | 功能 |
|------|------|
| `list_sounds` | 按分类列出可用音色，支持关键词过滤 |
| `get_sound_info` | 获取单个音色的详细信息（URL、分类、标签） |
| `preview_sound` | 预听音色（在编辑器中插入播放代码） |

#### 踩坑

- `import { soundMap } from 'superdough'` — Vite 无法解析，改为 `import { soundMap } from '@strudel/webaudio'`
- 采样库音色来源于外部链接（freesound.org 等），后续可替换为自部署的 Cloudflare 资源

#### 涉及文件

- `website/src/repl/agent/SoundRegistry.mjs` — 新建

---

### 三、ContextManager — 动态 System Prompt + 上下文压缩

#### 背景

原 `providers.mjs` 中硬编码 443 行 SYSTEM_PROMPT，所有参考信息一次性注入，无论用户问题是否需要。

#### 实现

- `buildSystemPrompt(userMessage)` 按需注入参考片段：
  - 基础身份与行为规则（始终注入）
  - Strudel 语法参考（检测到代码相关问题才注入）
  - 音色摘要（检测到音色相关问题才注入）
  - 常见模式参考（检测到模式/效果问题才注入）
- `$:` 语法警告升级为 CRITICAL 级别，包含 WRONG/RIGHT 对比示例
- `compressMessages(messages, maxTokens = 30000)` 基于重要性压缩历史消息

#### 涉及文件

- `website/src/repl/agent/ContextManager.mjs` — 新建

---

### 四、useAgent hook — UI 与业务分离

#### 背景

AgentSidebar.jsx 原有 387 行，混合了流处理、工具调用、状态管理、UI 渲染，难以维护。

#### 实现

核心 hook 封装所有 agent 逻辑：

- **闭包陷阱修复**：使用 `messagesRef` 替代 `messages` 作为 `sendMessage` 依赖
- **双模式更新**：`scheduleUpdate`（50ms 防抖批量）+ `flushNow`（立即刷新），解决渲染风暴
- **项目隔离**：监听 `$viewingPatternData`（nanostores sessionAtom），基于 `viewingPatternData.id` 切换对话
- **maxSteps: 100**：参考 OpenCode/Cline/Codex 等主流 agent，不限制 step 数
- **工具错误不中断流**：`isToolError` 判断，工具失败不终止整个流
- **中断信号检查**：`abortController.signal.aborted` 检查

#### 项目隔离关键代码

```javascript
const viewingPatternData = useStore($viewingPatternData);
useEffect(() => {
  const newProjectId = getProjectIdFromPattern(viewingPatternData);
  if (currentProjectIdRef.current === newProjectId) return;
  if (currentProjectIdRef.current && messagesRef.current.length > 0) {
    saveMessages(currentProjectIdRef.current, messagesRef.current);
  }
  currentProjectIdRef.current = newProjectId;
  loadMessages(newProjectId).then((saved) => {
    setMessages(saved);
    messagesRef.current = saved;
  });
}, [viewingPatternData]);
```

#### 涉及文件

- `website/src/repl/agent/useAgent.jsx` — 新建
- `website/src/repl/components/agent/AgentSidebar.jsx` — 从 387 行精简到 ~117 行

---

### 五、工具增强

#### 新增工具

| 工具 | 功能 |
|------|------|
| `list_sounds` | 按分类列出可用音色，支持关键词过滤 |
| `get_sound_info` | 获取单个音色详细信息 |
| `preview_sound` | 预听音色 |
| `get_selection` | 获取编辑器当前选区文本 |
| `get_errors` | 获取编辑器当前错误信息 |
| `undo` | 撤销编辑器最后一次修改 |

#### replace_code 改进

- 新增 `find_text` 参数：基于文本匹配定位替换位置，不再依赖行号
- `validateCode()` 新增检测：多顶层 pattern 没有 `$:` 前缀时发出警告

#### 踩坑

- `@codemirror/commands` 动态导入 Vite 无法解析 → 添加为 website 直接依赖，改为静态导入 `import { undo as cmUndo } from '@codemirror/commands'`

#### 涉及文件

- `website/src/repl/agent/tools.mjs` — 大幅增强
- `website/package.json` — 新增 `@codemirror/commands` 依赖

---

### 六、移除意图检测

#### 背景

原 `providers.mjs` 中 `detectIntent` 函数与 Vercel AI SDK 的 `toolChoice: 'auto'` 功能重叠，增加了不必要的复杂度和 token 消耗。

#### 变更

- 删除 `detectIntent` 函数及相关调用
- 删除 `truncateMessages` 函数（由 ContextManager 替代）
- 删除 `SYSTEM_PROMPT`（由 ContextManager 替代）
- `providers.mjs` 从 ~650 行精简到 ~112 行
- `store.mjs` 移除 `enableIntentDetection` 字段
- `ModelSection.jsx` 移除 Intent Detection 开关

#### 涉及文件

- `website/src/repl/agent/providers.mjs` — 从 ~650 行精简到 ~112 行
- `website/src/repl/agent/store.mjs` — 移除 `enableIntentDetection`
- `website/src/repl/components/panel/settings/ModelSection.jsx` — 移除 Intent Detection 开关

---

### 七、其他修复

| 问题 | 修复 |
|------|------|
| maxTokens 上限太小 | 最大值从 16384 改为 65536，步长从 256 改为 1024，默认值从 4096 改为 16384 |
| maxSteps 太小导致中断 | 5 → 10 → 15 → 50 → 100（参考 OpenCode/Cline/Codex 不限制 step 数） |
| 闭包陷阱导致中断 | `messagesRef` 替代 `messages` 作为 `sendMessage` 依赖 |
| 渲染风暴导致卡顿 | `scheduleUpdate`(50ms 防抖) + `flushNow`(立即) 双模式更新 |
| 项目隔离用 hashchange 无效 | 改为 `useStore($viewingPatternData)` 监听，项目 ID 从 `viewingPatternData.id` 提取 |
| localStorage 类型问题 | `maxTokens`/`temperature` 需要 `parseInt`/`parseFloat` 转换 |
| 多声部 pattern 只有最后一个播放 | System Prompt 中 `$:` 语法警告升级为 CRITICAL，`validateCode()` 添加检测 |
| `nextId` 函数语法错误 | 模板字符串反引号写错，修复 |

#### 涉及文件

- `website/src/repl/agent/store.mjs` — maxTokens 默认值/上限调整
- `website/src/repl/agent/storage.mjs` — `getProjectId()` 改为优先从 `viewingPatternData` 获取
- `website/src/repl/components/panel/settings/ModelSection.jsx` — 滑块范围调整

---

### 八、调研与参考

#### 主流 Agent maxSteps 调研

通过 GitHub API 查看 OpenCode 源码，发现主流 agent 都不限制 step 数：

| Agent | maxSteps 设置 | 语言 |
|-------|--------------|------|
| OpenCode | 不限制（循环直到完成） | Go |
| Cline | 不限制（循环直到完成） | TypeScript |
| Codex | 不限制（循环直到完成） | Rust |

最终设置 `maxSteps: 100` 作为安全上限。

#### Agent 框架复用性评估

不能直接复用（语言/运行环境不兼容），但设计模式值得借鉴：

- **Codex 的 auto-compact**：LLM 生成摘要压缩上下文（后续可借鉴）
- **OpenCode 的标题生成**：对话标题自动生成（后续可借鉴）
- **OpenCode 的结构化工具结果**：工具返回结构化格式（后续可借鉴）

---

### 九、方案文档

| 文档 | 说明 |
|------|------|
| `docs/agent/AGENT_REFACTOR_PROPOSAL.md` | 早期方案文档（已被后续文档替代） |
| `docs/agent/AGENT_DETAILED_DESIGN.md` | 详细设计文档 |
| `docs/agent/AGENT_POC.md` | 技术预研文档 |
| `docs/agent/AGENT_IMPLEMENTATION.md` | 基于实际代码的实现文档（最新版） |
