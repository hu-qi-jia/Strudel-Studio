// thinkingParse.mjs — 把流式文本里的「思考段」(<think>/<thinking>/…) 切出来（纯模块，零依赖，可 node 单测）。
//
// 为什么独立：Q2「折叠思考过程」的解析是 ChatMessage 里最容易出边界 bug 的部分——
// 未闭合标签（流式中间态）、多种标签名、多段交替。埋在 .jsx 组件里没法单测，抽成纯函数
// 后可覆盖各类流式中间态与边界。ChatMessage 只负责渲染切出来的段。

const THINK_TAG = 'think|thinking|reasoning|reflection';

/**
 * 把文本切成 [文本段, 思考段] 交替。思考段由 <think>/<thinking>/<reasoning>/<reflection> 包裹。
 * 未闭合（流式中、或模型漏写闭合标签）也算思考段（closed=false），避免半截思考被当成正文刷屏。
 * @param {string} text
 * @returns {Array<{type:'text'|'thinking', text:string, closed?:boolean}>}
 *   空文本返回 []；连续两个文本段不会出现（中间必夹思考段）。
 */
export function splitThinking(text) {
  if (!text) return [];
  const segments = [];
  const openRe = new RegExp(`<(${THINK_TAG})>`, 'g');
  let i = 0;
  let m;
  while ((m = openRe.exec(text)) !== null) {
    const openStart = m.index;
    const tag = m[1];
    if (openStart > i) segments.push({ type: 'text', text: text.slice(i, openStart) });
    const innerStart = openStart + m[0].length;
    // 闭合标签与开标签同名成对（<think>↔</think>），避免 <think>…</thinking> 错配。
    const closeRe = new RegExp(`</${tag}>`, 'g');
    closeRe.lastIndex = innerStart;
    const cm = closeRe.exec(text);
    if (cm) {
      segments.push({ type: 'thinking', text: text.slice(innerStart, cm.index), closed: true });
      i = cm.index + cm[0].length;
      openRe.lastIndex = i;
    } else {
      segments.push({ type: 'thinking', text: text.slice(innerStart), closed: false });
      i = text.length;
      break;
    }
  }
  if (i < text.length) segments.push({ type: 'text', text: text.slice(i) });
  return segments;
}

/** 仅返回剥离所有思考段后的可见正文（供 token 估算 / 摘要等用）。 */
export function extractVisibleText(text) {
  return splitThinking(text)
    .filter((s) => s.type === 'text')
    .map((s) => s.text)
    .join('');
}
