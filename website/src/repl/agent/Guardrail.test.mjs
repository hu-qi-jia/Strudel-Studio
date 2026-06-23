// Guardrail.test.mjs — 护栏纯逻辑测试
//
// 覆盖：isGenerationRequest / turnProducedPlayingCode / costBudgetExceeded /
// detectRepeatedToolCall。这些是 agent 里最容易出错、也最该被测试覆盖的逻辑。
// useAgent.jsx 依赖 React、tools.mjs 依赖 superdough worklet（node 下不可 import），
// 故只测 Guardrail.mjs 这个零依赖纯模块。

import { describe, it, expect } from 'vitest';
import {
  isGenerationRequest,
  turnProducedPlayingCode,
  buildContinuationNudge,
  CONTINUATION_NUDGE,
  costBudgetExceeded,
  detectRepeatedToolCall,
  STEP_BUDGET,
  COST_BUDGET_TOKENS,
  REPEAT_TOOL_LIMIT,
} from './Guardrail.mjs';

// ─── isGenerationRequest ─────────────────────────────────────────────
describe('isGenerationRequest', () => {
  it('识别中文生成请求', () => {
    expect(isGenerationRequest('给我一段鼓组')).toBe(true);
    expect(isGenerationRequest('写一段旋律')).toBe(true);
    expect(isGenerationRequest('来个 808 beat')).toBe(true);
    expect(isGenerationRequest('加个 reverb')).toBe(true);
    expect(isGenerationRequest('创作一首 lo-fi')).toBe(true);
  });

  it('识别英文生成请求', () => {
    expect(isGenerationRequest('make a beat')).toBe(true);
    expect(isGenerationRequest('write a melody')).toBe(true);
    expect(isGenerationRequest('give me a bassline')).toBe(true);
    expect(isGenerationRequest('create a techno pattern')).toBe(true);
  });

  it('提问类不强制写码', () => {
    expect(isGenerationRequest('怎么用 reverb？')).toBe(false);
    expect(isGenerationRequest('如何写 euclidean rhythm')).toBe(false);
    expect(isGenerationRequest('how does euclidean work?')).toBe(false);
    expect(isGenerationRequest('what is a polyrhythm')).toBe(false);
    expect(isGenerationRequest('can you explain $: prefix')).toBe(false);
  });

  it('控制类不强制写码', () => {
    expect(isGenerationRequest('停止')).toBe(false);
    expect(isGenerationRequest('stop')).toBe(false);
    expect(isGenerationRequest('清空')).toBe(false);
    expect(isGenerationRequest('reset')).toBe(false);
  });

  it('盘点类不强制写码（即便含音色名词）', () => {
    expect(isGenerationRequest('有哪些鼓')).toBe(false);
    expect(isGenerationRequest('有什么音色')).toBe(false);
    expect(isGenerationRequest('list available drums')).toBe(false);
    expect(isGenerationRequest('show me existing sounds')).toBe(false);
  });

  it('空输入返回 false', () => {
    expect(isGenerationRequest('')).toBe(false);
    expect(isGenerationRequest('   ')).toBe(false);
    expect(isGenerationRequest(null)).toBe(false);
    expect(isGenerationRequest(undefined)).toBe(false);
  });

  it('导出常量来自 config.mjs（单一事实源）', () => {
    expect(STEP_BUDGET).toBe(50);
    expect(COST_BUDGET_TOKENS).toBe(200000);
    expect(REPEAT_TOOL_LIMIT).toBe(3);
  });
});

// ─── turnProducedPlayingCode ─────────────────────────────────────────
describe('turnProducedPlayingCode', () => {
  const mk = (toolName, state, resultData, result) => ({
    role: 'assistant',
    toolInvocations: [{ toolName, state, resultData, result, toolCallId: 'c1' }],
  });

  it('结构化信号：write_code 返回 playing=true → 已完成', () => {
    const msgs = [mk('write_code', 'result', { ok: true, playing: true }, 'ok')];
    expect(turnProducedPlayingCode(msgs, 0)).toBe(true);
  });

  it('结构化信号：write_code 返回 playing=false → 未完成', () => {
    const msgs = [mk('write_code', 'result', { ok: false, playing: false }, 'err')];
    expect(turnProducedPlayingCode(msgs, 0)).toBe(false);
  });

  it('字符串回退：result 含 "playing" → 已完成', () => {
    const msgs = [mk('write_code', 'result', undefined, 'Code is now playing.')];
    expect(turnProducedPlayingCode(msgs, 0)).toBe(true);
  });

  it('字符串回退：result 含 "applied successfully" → 已完成', () => {
    const msgs = [mk('edit_lines', 'result', undefined, 'Edit applied successfully.')];
    expect(turnProducedPlayingCode(msgs, 0)).toBe(true);
  });

  it('非 code-edit 工具不算完成', () => {
    const msgs = [mk('list_sounds', 'result', { ok: true }, 'listed 10 sounds')];
    expect(turnProducedPlayingCode(msgs, 0)).toBe(false);
  });

  it('未完成的工具调用（state≠result）不算', () => {
    const msgs = [mk('write_code', 'call', { playing: true }, undefined)];
    expect(turnProducedPlayingCode(msgs, 0)).toBe(false);
  });

  it('sinceIdx 之前的消息被忽略', () => {
    const before = mk('write_code', 'result', { playing: true }, 'ok');
    const after = mk('list_sounds', 'result', { ok: true }, 'listed');
    expect(turnProducedPlayingCode([before, after], 1)).toBe(false);
  });

  it('空消息列表 → false', () => {
    expect(turnProducedPlayingCode([], 0)).toBe(false);
  });
});

// ─── costBudgetExceeded ──────────────────────────────────────────────
describe('costBudgetExceeded', () => {
  it('未达预算 → exceeded=false', () => {
    const r = costBudgetExceeded(100, 200);
    expect(r.exceeded).toBe(false);
    expect(r.used).toBe(100);
    expect(r.budget).toBe(200);
  });

  it('恰好等于预算 → exceeded=true（>= 语义，触顶即停）', () => {
    expect(costBudgetExceeded(200, 200).exceeded).toBe(true);
  });

  it('超过预算 → exceeded=true', () => {
    expect(costBudgetExceeded(201, 200).exceeded).toBe(true);
  });

  it('budget=0 → 不限制（exceeded 恒 false）', () => {
    expect(costBudgetExceeded(999999, 0).exceeded).toBe(false);
    expect(costBudgetExceeded(999999, -1).exceeded).toBe(false);
  });

  it('默认 budget 取自 COST_BUDGET_TOKENS', () => {
    // 不传 budget 参数，应使用 config.mjs 的 COST_BUDGET_TOKENS=200000
    expect(costBudgetExceeded(199999).exceeded).toBe(false);
    expect(costBudgetExceeded(200000).exceeded).toBe(true);
  });
});

// ─── detectRepeatedToolCall ──────────────────────────────────────────
describe('detectRepeatedToolCall', () => {
  const call = (toolName, args) => ({ toolName, args });

  it('空历史 → repeated=false', () => {
    const r = detectRepeatedToolCall([]);
    expect(r.repeated).toBe(false);
    expect(r.count).toBe(0);
  });

  it('单次调用 → repeated=false', () => {
    const r = detectRepeatedToolCall([call('list_sounds', { q: 'bd' })]);
    expect(r.repeated).toBe(false);
    expect(r.count).toBe(1);
  });

  it('同工具同参数连续 3 次（limit=3）→ repeated=false（3>3=false）', () => {
    const hist = [
      call('list_sounds', { q: 'bd' }),
      call('list_sounds', { q: 'bd' }),
      call('list_sounds', { q: 'bd' }),
    ];
    const r = detectRepeatedToolCall(hist);
    expect(r.repeated).toBe(false);
    expect(r.count).toBe(3);
  });

  it('同工具同参数连续 4 次（limit=3）→ repeated=true（4>3，卡循环）', () => {
    const hist = [
      call('list_sounds', { q: 'bd' }),
      call('list_sounds', { q: 'bd' }),
      call('list_sounds', { q: 'bd' }),
      call('list_sounds', { q: 'bd' }),
    ];
    const r = detectRepeatedToolCall(hist);
    expect(r.repeated).toBe(true);
    expect(r.toolName).toBe('list_sounds');
    expect(r.count).toBe(4);
  });

  it('同工具不同参数 → 重新计数，不触发', () => {
    const hist = [
      call('list_sounds', { q: 'bd' }),
      call('list_sounds', { q: 'sd' }),
      call('list_sounds', { q: 'hh' }),
      call('list_sounds', { q: 'cp' }),
    ];
    const r = detectRepeatedToolCall(hist);
    expect(r.repeated).toBe(false);
    expect(r.count).toBe(1);
  });

  it('不同工具交替 → 不触发', () => {
    const hist = [
      call('list_sounds', { q: 'bd' }),
      call('write_code', { code: 's("bd")' }),
      call('list_sounds', { q: 'bd' }),
      call('write_code', { code: 's("bd")' }),
    ];
    const r = detectRepeatedToolCall(hist);
    expect(r.repeated).toBe(false);
  });

  it('write_code 相同代码连续 4 次 → repeated=true', () => {
    const code = '$: s("bd sd hh oh")';
    const hist = [
      call('write_code', { code }),
      call('write_code', { code }),
      call('write_code', { code }),
      call('write_code', { code }),
    ];
    const r = detectRepeatedToolCall(hist);
    expect(r.repeated).toBe(true);
    expect(r.toolName).toBe('write_code');
  });

  it('自定义 limit', () => {
    const hist = [call('x', {}), call('x', {})];
    expect(detectRepeatedToolCall(hist, 1).repeated).toBe(true); // 2>1
    expect(detectRepeatedToolCall(hist, 5).repeated).toBe(false); // 2>5=false
  });

  it('非数组输入 → repeated=false（防御）', () => {
    expect(detectRepeatedToolCall(null).repeated).toBe(false);
    expect(detectRepeatedToolCall(undefined).repeated).toBe(false);
  });
});

// ─── buildContinuationNudge ─────────────────────────────────────────
describe('buildContinuationNudge', () => {
  it('空输入 → 返回基础催办（CONTINUATION_NUDGE）', () => {
    expect(buildContinuationNudge('')).toBe(CONTINUATION_NUDGE);
    expect(buildContinuationNudge('   ')).toBe(CONTINUATION_NUDGE);
  });

  it('null/undefined → 返回基础催办', () => {
    expect(buildContinuationNudge(null)).toBe(CONTINUATION_NUDGE);
    expect(buildContinuationNudge(undefined)).toBe(CONTINUATION_NUDGE);
  });

  it('包含原始请求 → 催办末尾附加请求', () => {
    const nudge = buildContinuationNudge('给我一段鼓组');
    expect(nudge).toContain(CONTINUATION_NUDGE);
    expect(nudge).toContain('给我一段鼓组');
    expect(nudge).toContain('ORIGINAL USER REQUEST');
  });

  it('英文请求也能附加', () => {
    const nudge = buildContinuationNudge('make a techno beat');
    expect(nudge).toContain('make a techno beat');
  });

  it('超长请求截断到 500 字符 + …', () => {
    const long = 'a'.repeat(800);
    const nudge = buildContinuationNudge(long);
    // 基础催办 + 分隔 + 截断请求
    expect(nudge).toContain(CONTINUATION_NUDGE);
    expect(nudge).toContain('…');
    // 截断后的请求部分不应超过 501 字符（500 + …）
    const requestPart = nudge.split('---\n').pop();
    expect(requestPart.length).toBeLessThanOrEqual(501);
  });

  it('短请求不截断', () => {
    const short = '写一段钢琴旋律';
    const nudge = buildContinuationNudge(short);
    expect(nudge).toContain(short);
    expect(nudge).not.toContain('…');
  });

  it('催办消息含 ARRANGEMENT checklist 关键词', () => {
    const nudge = buildContinuationNudge('test');
    // 确保催办仍提醒编排质量，不只是催促写码
    expect(nudge).toMatch(/ARRANGEMENT|arrangement/i);
    expect(nudge).toMatch(/velocity/i);
    expect(nudge).toMatch(/pan|spatial/i);
  });
});
