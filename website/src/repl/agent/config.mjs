// config.mjs — Agent 全局可调参数集中表
//
// 为什么独立成模块：STEP_BUDGET / MAX_CONTINUATIONS / MAX_CHARS 等常量原本散落在
// Guardrail.mjs / useAgent.jsx / ContextManager.mjs / attachments.mjs / 各 plugin
// 共 6+ 文件，调一个参数要 grep 全仓库。集中后单一事实源，调参 / A/B / 灰度都改这里。
//
// 分组：
//   - STEP / CONTINUATION：单次 sendMessage 的步数与催办轮预算
//   - STREAM：流式错误重试
//   - CONTEXT：上下文压缩预算（按 provider 动态，见 providers.mjs 的 CONTEXT_BUDGETS）
//   - ATTACHMENT / TOOL：附件与单工具产出上限
//   - COST / REPEAT：成本护栏与重复调用检测（新增，防病态会话烧 token）
//
// 所有数值均为「单次 sendMessage」维度（跨护栏多轮累计），非全局会话维度。

// ─── 步数与催办预算 ───────────────────────────────────────────────────
// 单次 sendMessage 的总步数预算（跨护栏多轮累计）。触顶即在 onStepFinish 里 abort。
// 取值依据：典型生成任务 2–6 步，复杂复刻 + 重试 < 15 步；50 给足余量又能兜住失控。
export const STEP_BUDGET = 50;

// 催办轮上限：模型「只查询不写码」后注入 CONTINUATION_NUDGE 的最大次数。
// 触顶仍无代码则放弃，把现状告诉用户——避免无限催办烧 token。
export const MAX_CONTINUATIONS = 4;

// ─── 流式重试 ─────────────────────────────────────────────────────────
// 流级错误（网络中断 / provider 5xx）最多重试次数（共 MAX_STREAM_RETRIES+1 次尝试）。
export const MAX_STREAM_RETRIES = 2;
// 重试前等待 ms，给 provider 缓冲。
export const STREAM_RETRY_DELAY = 1500;

// ─── 上下文压缩 ───────────────────────────────────────────────────────
// 默认上下文预算（token）。按 provider 动态覆盖见 providers.mjs 的 CONTEXT_BUDGETS。
// 保留此默认值用于：未知 provider / 估算回退 / UI 显示分母。
export const DEFAULT_CONTEXT_BUDGET = 30000;
// compressMessages 滑动窗口保留的最近消息对数（用户+助手成对）。
export const COMPRESS_KEEP_PAIRS = 4;

// ─── 附件与工具产出上限 ───────────────────────────────────────────────
// 单个附件字节上限（50MB）。超出在 attachments.mjs 拒收。
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
// list_sounds 单次返回条目上限（tools.mjs）。
export const LIST_SOUNDS_MAX = 50;
// web-research 插件单页抓取字符上限。
export const WEB_RESEARCH_MAX_CHARS = 4000;
// song-library 插件单首代码回灌字符上限。
export const SONG_LIBRARY_MAX_CODE_CHARS = 6000;

// ─── 意图检测与催办开关（重构提案第 4.1 节）──────────────────────────
// 是否启用 isGenerationRequest 正则意图检测 + CONTINUATION_NUDGE 催办。
// false（默认）：让 LLM 自主决策何时写码——现代模型已能判断，正则误判率高
//   （"给我看看有哪些鼓"被误判为生成请求），催办 prompt 烧 token 且是 Anthropic
//   反对的"对 LLM 喊话"反模式。步数预算 + 成本护栏 + 重复检测已能兜底病态会话。
// true：恢复旧行为（正则判定生成请求 + 未写码则催办），用于 A/B 对比或回退。
export const ENABLE_INTENT_DETECTION = false;

// ─── 成本护栏（新增）──────────────────────────────────────────────────
// 单次 sendMessage 累计 token 上限（prompt+completion 合计）。触顶即 abort。
// 取值依据：50 步 × 平均 4k token/步 ≈ 200k，与 Claude 200k 上下文对齐；
// Gemini 用户可调高，GPT-4o 用户可调低。0 表示不限制。
export const COST_BUDGET_TOKENS = 200000;

// ─── 重复调用检测（新增）──────────────────────────────────────────────
// 同一工具 + 同一参数连续调用次数上限。触顶即 abort——几乎必然是模型卡在循环里。
// 例：list_sounds 连续 3 次相同参数 = 卡死，立即停止。
export const REPEAT_TOOL_LIMIT = 3;

// ─── 文档片段注入（docKnowledge）──────────────────────────────────────
// 构建期脚本 scripts/build-doc-fragments.mjs 把 learn/workshop .mdx + jsdoc/doc.json
// 切片为 docFragments.json，运行时 docKnowledge.mjs 按用户消息关键词命中注入。
// 这让 agent 能参考本地文档的精确语法说明，而非仅靠 LLM 训练数据（可能过时/不全）。
//
// 取值依据：典型 API 查询命中 2-4 个片段（每个 ~200 token），2000 token 预算够用且
// 不会挤占核心 prompt 空间。单片段上限 600 token 避免长章节灌满预算。
// 设为 0 可禁用整个文档注入（DOC_FRAGMENT_BUDGET_TOKENS=0）。
export const DOC_FRAGMENT_BUDGET_TOKENS = 2000; // 单次注入的总 token 预算
export const DOC_FRAGMENT_MAX_COUNT = 5; // 单次最多注入的片段数
export const DOC_FRAGMENT_MAX_TOKENS_EACH = 600; // 单个片段 token 上限（超长截断）

// ─── System Prompt 总 token 上限 ──────────────────────────────────────
// buildSystemPrompt 产出的完整 system prompt 的 token 硬上限。
// 取值依据：行业最佳实践 System Instructions 应占预算 10-15%。
//   - 最小 provider 预算 30K（DEFAULT_CONTEXT_BUDGET）→ 4500 token
//   - 我们取 6000 覆盖静态段(~1.2K) + 按需知识(~3K) + 文档片段(~2K) + 编辑器代码
// 超限时按优先级裁剪：docKnowledge → knowledge 按需段 → 动态摘要。
// STATIC_PREFIX（CORE_PROMPT + CODE_STYLE + WORKFLOW）和 CURRENT EDITOR CODE 不可裁。
export const MAX_SYSTEM_PROMPT_TOKENS = 6000;

// ─── 工具超时（毫秒）──────────────────────────────────────────────────
// 防止网络/CPU 密集型工具卡住整个 agent 流。超时后返回错误消息让模型自纠正，
// 不中断流。本地工具（read_code/write_code/edit_lines/undo/list_sounds）不设超时——
// 它们是同步快操作，卡住说明引擎本身挂了，超时也救不回来。
export const TOOL_TIMEOUTS = {
  browse_repo: 15000, // GitHub API 调用，含 rate-limit 重试
  fetch_example: 15000, // GitHub raw content 拉取
  analyze_pattern_audio: 30000, // 离线渲染 + DSP 分析，复杂 pattern 可能较慢
};
