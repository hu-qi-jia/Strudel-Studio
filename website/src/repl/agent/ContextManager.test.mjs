// ContextManager.test.mjs — compressMessages 上下文压缩的纯逻辑测试
//
// 覆盖：compressMessages 的核心行为——滑动窗口保留、工具调用对完整性保护、
// 最近 user 消息强制保留（agent 中断修复的关键不变量）。
//
// ContextManager.mjs 的 buildSystemPrompt 依赖 soundRegistry / docKnowledge 等运行时模块，
// 但 compressMessages 本身是纯逻辑（只用 _estimateMessageTokens + _findCorrespondingAssistant）。
// 这里直接 import contextManager 实例测其 compressMessages 方法。

import { describe, it, expect } from 'vitest';
import { contextManager } from './ContextManager.mjs';

// ─── 辅助构造函数 ──────────────────────────────────────────────

const userMsg = (text) => ({ role: 'user', content: text });
const assistantTextMsg = (text) => ({ role: 'assistant', content: text });
const assistantToolMsg = (toolCallId, toolName, args) => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId, toolName, input: args }],
});
const toolResultMsg = (toolCallId, toolName, result) => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId, toolName, output: { type: 'text', value: result } }],
});

// 生成超长文本消息（用于触发压缩）
const bigMsg = (role, prefix, size = 5000) => ({
  role,
  content: prefix + 'x'.repeat(size),
});

// ─── compressMessages ─────────────────────────────────────────

describe('compressMessages', () => {
  it('空数组 → 原样返回', () => {
    expect(contextManager.compressMessages([], 1000)).toEqual([]);
  });

  it('null/undefined → 原样返回', () => {
    expect(contextManager.compressMessages(null, 1000)).toBe(null);
    expect(contextManager.compressMessages(undefined, 1000)).toBe(undefined);
  });

  it('未超预算 → 原样返回全部消息', () => {
    const msgs = [userMsg('hi'), assistantTextMsg('hello')];
    const result = contextManager.compressMessages(msgs, 100000);
    expect(result).toBe(msgs); // 同一引用（未触发压缩）
  });

  it('超预算 → 保留最近消息，丢弃最旧消息', () => {
    const msgs = [
      bigMsg('user', 'old-', 3000),
      bigMsg('assistant', 'old-resp-', 3000),
      bigMsg('user', 'new-', 100),
      bigMsg('assistant', 'new-resp-', 100),
    ];
    // 预算设很小，强制压缩
    const result = contextManager.compressMessages(msgs, 500);
    // 最新的两条应该被保留
    expect(result.length).toBeLessThan(msgs.length);
    expect(result[result.length - 1].content).toContain('new-resp-');
  });

  // ─── 关键不变量：最近 user 消息必须保留 ──────────────────────

  it('最近 user 消息在预算内 → 正常保留', () => {
    const msgs = [
      bigMsg('assistant', 'old-', 3000),
      userMsg('给我一段鼓组'),
      assistantTextMsg('好的'),
    ];
    const result = contextManager.compressMessages(msgs, 500);
    const hasUser = result.some((m) => m.role === 'user' && m.content === '给我一段鼓组');
    expect(hasUser).toBe(true);
  });

  it('最近 user 消息超预算 → 仍强制保留（agent 中断修复核心）', () => {
    const msgs = [
      bigMsg('assistant', 'old-', 3000),
      bigMsg('user', '给我', 3000), // 超预算的 user 消息
      assistantTextMsg('ok'),
    ];
    const result = contextManager.compressMessages(msgs, 200);
    const hasUser = result.some((m) => m.role === 'user');
    expect(hasUser).toBe(true);
  });

  it('tool 分支 break 不跳过 user 消息（安全网）', () => {
    // 构造场景：user 在最前面，后面跟大量 tool 对，压缩时 tool 对超预算 break
    const msgs = [
      userMsg('make a beat'), // lastUserIdx = 0
      assistantToolMsg('tc1', 'list_sounds', { q: 'bd' }),
      toolResultMsg('tc1', 'list_sounds', 'found 10 sounds'),
      assistantToolMsg('tc2', 'list_sounds', { q: 'sd' }),
      toolResultMsg('tc2', 'list_sounds', 'found 8 sounds'),
      assistantToolMsg('tc3', 'write_code', { code: '$: s("bd")' }),
      toolResultMsg('tc3', 'write_code', 'playing successfully'),
    ];
    // 预算设极小，让第一个 tool 对就超预算 → break
    const result = contextManager.compressMessages(msgs, 50);
    // 安全网应补入 user 消息
    const hasUser = result.some((m) => m.role === 'user' && m.content === 'make a beat');
    expect(hasUser).toBe(true);
  });

  it('无 user 消息 → 安全网不报错', () => {
    const msgs = [
      bigMsg('assistant', 'a-', 3000),
      bigMsg('assistant', 'b-', 3000),
    ];
    const result = contextManager.compressMessages(msgs, 200);
    // 不应崩溃，正常返回压缩结果
    expect(Array.isArray(result)).toBe(true);
  });

  // ─── 工具调用对完整性 ───────────────────────────────────────

  it('tool 消息和对应 assistant 消息成对保留', () => {
    const msgs = [
      bigMsg('user', 'filler-', 2000),
      assistantToolMsg('tc1', 'list_sounds', { q: 'bd' }),
      toolResultMsg('tc1', 'list_sounds', 'found sounds'),
      userMsg('now write code'),
    ];
    const result = contextManager.compressMessages(msgs, 2000);
    // 如果 tool 被保留，对应的 assistant 也应被保留
    const hasTool = result.some(
      (m) => m.role === 'tool' && Array.isArray(m.content) && m.content[0]?.toolCallId === 'tc1',
    );
    const hasAssistant = result.some(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content[0]?.type === 'tool-call' &&
        m.content[0]?.toolCallId === 'tc1',
    );
    // 要么都不在（被压缩掉），要么都在（成对保留）
    expect(hasTool).toBe(hasAssistant);
  });

  it('tool 对超预算 → 一起丢弃（不拆散）', () => {
    const msgs = [
      userMsg('hi'),
      assistantToolMsg('tc1', 'list_sounds', { q: 'bd' }),
      toolResultMsg('tc1', 'list_sounds', 'x'.repeat(5000)),
      assistantTextMsg('done'),
    ];
    const result = contextManager.compressMessages(msgs, 300);
    // tool 对太大应被整体丢弃
    const hasTool = result.some((m) => m.role === 'tool');
    const hasAssistantToolCall = result.some(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((p) => p.type === 'tool-call'),
    );
    expect(hasTool).toBe(false);
    expect(hasAssistantToolCall).toBe(false);
  });
});
