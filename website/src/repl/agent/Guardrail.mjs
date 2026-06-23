// Guardrail.mjs — 任务完成护栏的纯逻辑（从 useAgent.jsx 抽出，零依赖，可 node 单测）。
//
// 为什么独立成模块：护栏判定（这是不是生成请求？这轮写出可播放代码了吗？成本/重复
// 是否触顶？）是 agent 里最容易出错、也最该被测试覆盖的逻辑。埋在 useAgent 的闭包里
// 没法单测——useAgent 依赖 React，tools.mjs 依赖 superdough worklet（node 下不可 import）。
// 抽成纯函数 + 零外部依赖，可被 vitest 直接跑（见 Guardrail.test.mjs）。
//
// 关键设计：
// - turnProducedPlayingCode 优先读 code-edit 工具返回的结构化 resultData.playing，
//   不再与工具返回的英文措辞字符串耦合（改一句工具文案不会让护栏失效）。
//   字符串回退保留：兼容历史返回或非结构化工具。
// - STEP_BUDGET / COST_BUDGET_TOKENS / REPEAT_TOOL_LIMIT 是「单次 sendMessage」的预算
//   （跨护栏多轮累计）。useAgent 在 onStepFinish 里触顶即 abort——maxSteps 是单轮上限，
//   STEP_BUDGET 是单次请求上限，两者叠加才能既允许正常多步任务、又拦住病态会话烧 token。
// - 所有可调参数集中在 config.mjs，本模块只负责判定逻辑。

import {
  STEP_BUDGET,
  COST_BUDGET_TOKENS,
  REPEAT_TOOL_LIMIT,
} from './config.mjs';

// 代码编辑类工具：只有这些工具成功执行（产出可播放代码）才算「完成任务」。
export const CODE_EDIT_TOOLS = new Set(['write_code', 'edit_lines']);

// re-export 让 useAgent 可从 Guardrail 统一导入（避免 useAgent 同时依赖 config + Guardrail）。
export { STEP_BUDGET, COST_BUDGET_TOKENS, REPEAT_TOOL_LIMIT };

// 判定用户这次发言是否为「生成/修改类请求」——需要写出可播放代码才算完成。
// 对明显的提问/信息/盘点类返回 false，不强制写码。
// 偏好「宁可多触发」：在音乐 REPL 里演示一段 pattern 几乎总是有益的；
// 而漏掉生成请求会导致 agent 停在中途（这正是要修的 bug）。
export function isGenerationRequest(text) {
  const t = (text || '').trim();
  if (!t) return false;

  // 先检测生成/修改类关键词——即便消息以「能不能 / can you / 请问」开头，
  // 只要含音乐名词或生成动词，就判为生成请求。
  // 这修复了「能不能给我一段鼓组」「can you make a beat」被误判为提问的 bug。
  const hasGenerationKeyword = /\b(give|make|create|write|generate|play|produce|compose|drum|beat|melody|song|music|pattern|loop|bass|track|808|909|piano|chord|arp|sequence|riff|add|change|swap|replace|remove|turn|remix)\b|给我|来一|来个|来段|来首|来点|写一|写段|写首|生成|创作|做一|做段|做首|弄一|弄个|整一|整段|加点|加个|加上|再加|加|改成|改一|换成|变成|配一|编一|弹一|鼓|琴|贝斯|吉他|合成|节奏|旋律|和弦|低音|节拍|音色/i.test(t);

  // 含生成关键词 → 生成请求（即便以提问形式开头）
  if (hasGenerationKeyword) {
    // 但排除纯盘点类：「有哪些鼓」「list available drums」即便含名词也只是查询
    if (/\b(list|show me)\b[^\n]{0,40}\b(available|existing)\b/i.test(t)) return false;
    if (/(有哪些|有什么|看看有|查看有|查一下|列出|查询|告诉我).{0,8}(音色|音源|鼓机?|乐器|声音|采样|合成器|效果|鼓点?)/.test(t)) return false;
    return true;
  }

  // 无生成关键词时，按提问/控制类处理
  // 明显的提问/信息类：不强制写码
  if (/^(how|what|why|when|where|who|which|can you|could you|explain|tell me|what's|whats|does|do you|is there|are there|show me how)\b/i.test(t)) return false;
  if (/^(怎么|如何|啥|什么|为啥|为什么|为何|哪儿|哪里|是否|能否|能不能|可以吗|请问|介绍|解释|哪个|哪种|有没有)/.test(t)) return false;
  if (/[?？]\s*$/.test(t) || /(吗|嘛|呢)\s*[?？]?\s*$/.test(t) || /是不是|对不对|能不能/.test(t)) return false;

  // 控制类指令（停止/暂停/静音/清空/重置）：不需要写码
  if (/^(stop|pause|halt|silence|quiet|mute|clear|reset|turn off|undo)\b/i.test(t)) return false;
  if (/^(停|停下|停止|暂停|静音|关掉|关上|清空|清除|重置|取消|不要|别)/.test(t)) return false;

  // 纯盘点/查询类：即便含「鼓/音色」等名词，也只是问「有什么」，不要求写码。
  if (/\b(list|show me)\b[^\n]{0,40}\b(available|existing)\b/i.test(t)) return false;
  if (/(有哪些|有什么|看看有|查看有|查一下|列出|查询|告诉我).{0,8}(音色|音源|鼓机?|乐器|声音|采样|合成器|效果|鼓点?)/.test(t)) return false;

  return false;
}

// 判定本轮（自 sinceIdx 起）是否已产出「成功播放的代码」。
// 优先读结构化 resultData.playing（code-edit 工具返回 { ok, playing, message }），
// 不再依赖结果字符串里的英文措辞；字符串回退兼容历史/非结构化返回。
export function turnProducedPlayingCode(messages, sinceIdx) {
  for (let i = sinceIdx; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    for (const inv of m.toolInvocations || []) {
      if (!CODE_EDIT_TOOLS.has(inv.toolName) || inv.state !== 'result') continue;
      // 结构化信号优先（与 tools.mjs 各 code-edit 工具的返回契约对齐）
      if (inv.resultData && inv.resultData.playing === true) return true;
      // 兼容字符串返回：措辞匹配（历史路径，非 code-edit 工具或未结构化时兜底）
      const r = typeof inv.result === 'string' ? inv.result : '';
      if (/playing|applied successfully|inserted at|replaced successfully|edited lines/i.test(r)) {
        return true;
      }
    }
  }
  return false;
}

// 催办消息：模型在一轮结束后未产出可播放代码时注入，强制其继续。
// 仅进入模型输入，不写入 messagesRef / 不显示在 UI（useAgent 里据此处理）。
//
// 设计要点：
// - 包含原始用户请求（originalRequest），防止长对话压缩后模型丢失上下文。
//   compressMessages 可能丢弃较早的消息（包括用户当前轮的请求），导致模型
//   不知道要做什么 → 不写码 → 催办再试 → 还是不知道 → 循环耗尽 → 任务中断。
// - 不假设模型"只查询不写码"——可能是 write_code 失败、maxTokens 截断、
//   或模型只回了文字。措辞用"did not produce playing code"涵盖所有情况。
// - 保留原有的 ARRANGEMENT checklist 要求，确保产出质量。
export const CONTINUATION_NUDGE =
  'SYSTEM — CONTINUATION REQUIRED: Your previous turn ended WITHOUT producing any playing Strudel code (the user heard nothing). This may be because you only explored/listed sounds, or because your write_code/edit_lines call failed. Either way, listing sounds or describing what you would do is NOT a complete answer. Stop exploring. Do NOT call list_sounds again. Immediately call write_code with a concrete, playable Strudel pattern that fulfills the user\'s original request — use a $: prefix on every simultaneous track. Before stopping, apply the ARRANGEMENT checklist from the system prompt: distinct densities per track, velocity variation, spatial separation (pan/room), and at least one change over time — a single flat, identical-velocity, dead-center loop is NOT acceptable. Only after write_code reports "playing successfully" should you stop and briefly confirm to the user what you made.';

/**
 * 生成包含原始用户请求的催办消息。
 * 当 compressMessages 丢弃了用户原始消息时，催办中的请求摘要让模型仍知道要做什么。
 *
 * @param {string} originalRequest - 用户这一次 sendMessage 的原始文本
 * @returns {string} 催办消息（含原始请求摘要）
 */
export function buildContinuationNudge(originalRequest) {
  const request = (originalRequest || '').trim();
  if (!request) return CONTINUATION_NUDGE;
  // 截断过长的请求（避免催办本身烧太多 token），保留开头 500 字符通常足够理解意图
  const truncated = request.length > 500 ? request.slice(0, 500) + '…' : request;
  return `${CONTINUATION_NUDGE}\n\n--- ORIGINAL USER REQUEST (for reference, do NOT ask the user to repeat it) ---\n${truncated}`;
}

// ─── 成本护栏（新增）──────────────────────────────────────────────────
// 判定单次 sendMessage 累计 token 是否超过预算。COST_BUDGET_TOKENS=0 表示不限制。
// useAgent 在 onStepFinish 里累计 tokenUsage.total，触顶即 abort。
// 返回 { exceeded, used, budget } 便于 UI 显示「成本 X / 预算 Y」。
export function costBudgetExceeded(totalTokens, budget = COST_BUDGET_TOKENS) {
  if (!budget || budget <= 0) return { exceeded: false, used: totalTokens, budget: 0 };
  return { exceeded: totalTokens >= budget, used: totalTokens, budget };
}

// ─── 重复调用检测（新增）──────────────────────────────────────────────
// 判定「同一工具 + 同一参数」是否连续调用超过 REPEAT_TOOL_LIMIT 次。
// 几乎必然是模型卡在循环里（如反复 list_sounds 相同参数、反复 write_code 相同代码）。
//
// callHistory: Array<{ toolName, args }> —— 单次 sendMessage 内已发生的工具调用序列
// （按时间顺序，最新在末尾）。useAgent 在 onStepFinish 里维护并传入。
// 返回 { repeated, toolName, count, limit } —— repeated=true 时 useAgent 应 abort。
export function detectRepeatedToolCall(callHistory, limit = REPEAT_TOOL_LIMIT) {
  if (!Array.isArray(callHistory) || callHistory.length === 0) {
    return { repeated: false, toolName: null, count: 0, limit };
  }
  // 取最近一次调用，向前数连续相同的次数
  const last = callHistory[callHistory.length - 1];
  let count = 1;
  for (let i = callHistory.length - 2; i >= 0; i--) {
    const prev = callHistory[i];
    if (prev.toolName !== last.toolName) break;
    if (!argsEqual(prev.args, last.args)) break;
    count++;
  }
  return {
    repeated: count > limit,
    toolName: last.toolName,
    count,
    limit,
  };
}

// 参数相等判定：JSON 序列化后比较。工具参数都是 zod schema 校验过的 plain object，
// JSON.stringify 稳定（key 顺序由 zod 定义决定，一致）。性能不是问题（参数很小）。
function argsEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
