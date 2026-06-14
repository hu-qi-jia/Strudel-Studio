// utils.mjs — agent 模块通用工具函数（无副作用，可被任意 agent/ 与 components/agent/ 复用）。

/** 字节数 → 人类可读（B/KB/MB）。null/undefined 返回 '?'。 */
export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
