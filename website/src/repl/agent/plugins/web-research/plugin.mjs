// plugin.mjs — web-research 插件：两个零配置的联网工具，浏览器直连，无需后端/Key/用户配置。
//
// 设计取舍（为什么这样做）：
// - 音乐风格/曲风这类知识，LLM 训练数据里基本都有，多数情况不需要联网。
// - 模型真正做不到的只有两件事：①读用户贴的某个具体网页 ②查百科式的风格定义。
//   这两件事都有「免 Key + 浏览器直连 + 带 CORS」的公开 API，所以不需要 Worker / 后端 / Key。
//   - read_web → Jina Reader（https://r.jina.ai/{url}）：返回页面正文 markdown，免 Key，限流 ~20 RPM。
//   - wiki     → 维基 API（?origin=*）：官方支持匿名 CORS，返回条目导言摘要。
// - 产物是「网页/百科文本」——回灌给 LLM，由它据此调 write_code 落地。
// - 两个 fetch 都是「简单请求」（GET、无自定义头、无 body）→ 不触发 CORS 预检，直连即可。
//   这是受信内置插件、只访问这两个公开端点，故不走 net:fetch 域名白名单（留给未来第三方插件）。

import { jsonSchema } from 'ai';
import { WEB_RESEARCH_MAX_CHARS as MAX_CHARS } from '../../config.mjs';

async function readWeb(input) {
  const url = typeof input?.url === 'string' ? input.url.trim() : '';
  if (!url) return 'Error: read_web requires a non-empty "url".';
  if (!/^https?:\/\//i.test(url)) {
    return 'Error: read_web requires an absolute http(s) URL, e.g. "https://example.com/page".';
  }
  let res;
  try {
    // 不加自定义头，保持「简单请求」以避开 CORS 预检；Jina Reader 默认返回 markdown。
    res = await fetch(`https://r.jina.ai/${url}`);
  } catch (e) {
    return `read_web failed (network): ${e?.message || e}. The page may be unreachable.`;
  }
  if (!res.ok) {
    return `read_web failed (HTTP ${res.status}) for ${url}.`;
  }
  let text;
  try {
    text = await res.text();
  } catch (e) {
    return `read_web failed (read body): ${e?.message || e}.`;
  }
  if (!text || !text.trim()) {
    return `read_web: no readable content at ${url} (it may be a JS-only page).`;
  }
  const truncated = text.length > MAX_CHARS;
  return `Content of ${url}:\n\n${text.slice(0, MAX_CHARS)}${truncated ? '\n\n[...truncated]' : ''}`;
}

async function wikiLookup(input) {
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!query) return 'Error: wiki requires a non-empty "query".';
  // generator=search：一次请求完成「搜索 + 取摘要」；origin=* 开启匿名 CORS；
  // exintro+explaintext 取纯文本导言；redirects=1 解析重定向到规范条目。
  const api =
    'https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
    encodeURIComponent(query) +
    '&gsrlimit=1&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*';
  let data;
  try {
    const res = await fetch(api);
    if (!res.ok) return `wiki failed (HTTP ${res.status}).`;
    data = await res.json();
  } catch (e) {
    return `wiki failed (network): ${e?.message || e}.`;
  }
  const pages = data?.query?.pages;
  const page = pages ? Object.values(pages)[0] : null;
  if (!page || typeof page.extract !== 'string' || !page.extract.trim()) {
    return `No Wikipedia article found for "${query}". Proceed from your own knowledge.`;
  }
  const link = page.pageid ? `https://en.wikipedia.org/?curid=${page.pageid}` : 'https://en.wikipedia.org';
  const truncated = page.extract.length > MAX_CHARS;
  return `Wikipedia — ${page.title}:\n\n${page.extract.slice(0, MAX_CHARS)}${truncated ? '\n\n[...truncated]' : ''}\n\nSource: ${link}`;
}

const plugin = {
  id: 'web-research',
  version: '0.2.0',
  description:
    'Two zero-config web tools (keyless, browser-direct, no backend): read a specific page, or look up a Wikipedia summary. Lets the agent handle pasted links and factual style/genre questions without any user configuration.',

  tools: [
    {
      name: 'read_web',
      description:
        'Read the text content of a SPECIFIC web page by URL (via the keyless Jina Reader). Use when the user pastes a link (an article, tutorial, Reddit/GitHub thread, docs) and wants you to base a pattern on it. Returns the page as plain markdown (truncated). After reading, call write_code to make the pattern. Do NOT invent URLs, and do NOT use this for searching — use wiki or your own knowledge instead.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Absolute http(s) URL of the page to read, e.g. "https://en.wikipedia.org/wiki/Phonk".',
          },
        },
        required: ['url'],
      }),
      execute: async (input) => readWeb(input),
    },
    {
      name: 'wiki',
      description:
        'Look up a concise Wikipedia overview of a music genre, technique, subculture, or artist (English Wikipedia, keyless). Use when you want a factual summary of what a style actually is — e.g. "phonk", "IDM", "dubstep", "Aphex Twin". Returns the intro extract. After reading, call write_code to make the pattern. For most "make it sound like X" requests your own knowledge is enough; use this only when you want to confirm specifics.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The topic to look up, e.g. "phonk" or "intelligent dance music".',
          },
        },
        required: ['query'],
      }),
      execute: async (input) => wikiLookup(input),
    },
  ],
};

export default plugin;
