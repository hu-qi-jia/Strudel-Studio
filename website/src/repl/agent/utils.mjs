// utils.mjs — agent 模块通用工具函数（无副作用，可被任意 agent/ 与 components/agent/ 复用）。

/** 字节数 → 人类可读（B/KB/MB）。null/undefined 返回 '?'。 */
export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ─── token 估算 ────────────────────────────────────────────────
// 上下文 token 估算（供压缩阈值 + UI「ctx X / 预算」显示）。
// 早期用「4 字符 ≈ 1 token」对中文严重失准：1 个 CJK 字符实际 ≈ 1–2 token，
// /4 会低估，导致预算提前被突破才发现。这里按脚本区分：CJK/日韩全角字符每个 ≈ 1 token，
// 其余（ASCII/拉丁）按 ~4 字符/token。仍是粗估（无 tiktoken），但对中英混合的 strudel
// 对话误差从「低估 4×」收敛到「±20%」级别，足够做压缩触发判断。
const CJK_RANGES = [
  [0x4e00, 0x9fff], // CJK 统一表意文字（中文主区）
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x3000, 0x30ff], // CJK 标点 + 假名
  [0xff00, 0xffef], // 全角字符
];
function isCjkCodePoint(code) {
  for (const [lo, hi] of CJK_RANGES) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}
export function estimateTextTokens(text) {
  if (!text) return 0;
  // 防御：非字符串（数组/对象/数字）统一转字符串，避免 for..of 遍历出非字符元素
  // 触发 "ch.codePointAt is not a function"
  if (typeof text !== 'string') {
    text = Array.isArray(text) ? text.join('') : String(text);
  }
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (isCjkCodePoint(code)) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}

// ─── 工具超时 ───────────────────────────────────────────────────
/**
 * 给 async 函数包一层超时保护。超时后返回 fallbackValue（不抛异常——工具 execute
 * 应返回错误消息让模型自纠正，而非中断整个流）。
 *
 * @param {() => Promise} fn - 要执行的异步函数
 * @param {number} ms - 超时毫秒
 * @param {string} fallbackValue - 超时时的返回值
 * @returns {Promise} fn 的结果或 fallbackValue
 */
export async function withTimeout(fn, ms, fallbackValue) {
  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    });
    return await Promise.race([fn(), timeoutPromise]);
  } catch (e) {
    if (e?.message?.startsWith('timeout')) {
      return fallbackValue;
    }
    throw e; // 非超时异常继续抛出
  } finally {
    if (timer) clearTimeout(timer);
  }
}
