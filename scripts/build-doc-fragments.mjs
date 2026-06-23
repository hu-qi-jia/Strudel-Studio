// build-doc-fragments.mjs — 构建期脚本：把本地文档（learn/workshop .mdx + jsdoc/doc.json）
// 切片并提取关键词，输出 docFragments.json 供运行时按需注入 agent 的 system prompt。
//
// 设计取舍（为什么这样做）：
// - 语料规模小（~20 万字符 ≈ 5 万 token），且高度结构化（API 名称 + 章节标题），
//   关键词检索比向量数据库更准、更轻、零运行时依赖。
// - 构建期一次性切片 + 提关键词，运行时只做字符串匹配，O(n) 且无外部服务。
// - 与 ContextManager 现有的 KEYWORD_PATTERNS 按需注入机制无缝衔接。
//
// 切片策略：
//   .mdx  → 按 H2 (##) 切片；H2 下到下一个 H2 为一个片段。无 H2 则整篇一个片段。
//   jsdoc → 每个函数一个片段（name + description + examples + synonyms）。
//
// 关键词来源：
//   - 标题分词（英文按空格/连字符，中文按字符）
//   - 正文中的 `code` 标记（反引号包围的词，通常是 API 名称）
//   - jsdoc 的 name + synonyms 字段
//
// 输出格式（docFragments.json）：
//   [{
//     "id": "learn/mini-notation#multiplication",
//     "source": "learn/mini-notation",
//     "title": "Multiplication",
//     "keywords": ["multiplication", "speed", "fast", "asterisk", "*"],
//     "body": "A sequence can be sped up by multiplying...",
//     "tokens": 45
//   }, ...]

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// ─── 路径配置 ──────────────────────────────────────────────────
const LEARN_DIR = join(projectRoot, 'website/src/pages/learn');
const WORKSHOP_DIR = join(projectRoot, 'website/src/pages/workshop');
const JSDOC_PATH = join(projectRoot, 'jsdoc/doc.json');
const OUTPUT_PATH = join(projectRoot, 'website/src/repl/agent/docFragments.json');

// ─── token 估算（与 ContextManager.mjs 的 estimateTextTokens 一致）────────
const CJK_RANGES = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x3000, 0x30ff],
  [0xff00, 0xffef],
];
function isCjk(code) {
  for (const [lo, hi] of CJK_RANGES) if (code >= lo && code <= hi) return true;
  return false;
}
function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCjk(ch.codePointAt(0))) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}

// ─── 关键词提取 ────────────────────────────────────────────────
// 停用词表：过滤掉无信息量的高频词
const STOP_WORDS = new Set([
  // 英文
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as',
  'and', 'or', 'but', 'not', 'if', 'then', 'else', 'when', 'where',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
  'you', 'your', 'we', 'our', 'i', 'me', 'my',
  'can', 'could', 'will', 'would', 'should', 'shall', 'may', 'might',
  'do', 'does', 'did', 'done', 'have', 'has', 'had',
  'from', 'into', 'out', 'up', 'down', 'over', 'under',
  'how', 'what', 'which', 'who', 'whom', 'whose', 'why',
  'use', 'used', 'using', 'get', 'set', 'put', 'let',
  'more', 'less', 'most', 'much', 'many', 'some', 'any', 'all',
  'each', 'every', 'both', 'other', 'same', 'such',
  'than', 'so', 'very', 'too', 'also', 'just', 'only',
  // 中文停用词
  '的', '了', '在', '是', '我', '你', '他', '她', '它', '们',
  '这', '那', '和', '与', '或', '但', '不', '也', '都', '就',
  '把', '被', '让', '给', '为', '对', '向', '从', '到', '于',
  '一', '个', '些', '种', '上', '下', '里', '外', '中', '内',
  '会', '能', '可', '以', '要', '想', '需', '须', '应', '该',
  '用', '使', '做', '作', '看', '听', '说', '写', '读',
]);

// 从一段文本提取关键词
function extractKeywords(text) {
  const words = new Set();

  // 1. 提取反引号包围的 code 标记（通常是 API 名称、语法符号）
  const codeMatches = text.matchAll(/`([^`]+)`/g);
  for (const m of codeMatches) {
    const code = m[1].trim();
    if (code && code.length <= 40) {
      // 拆分链式调用：.foo().bar() → foo, bar
      const parts = code.split(/[.\s(){}\[\],;:|<>]+/).filter(Boolean);
      for (const p of parts) {
        if (p.length >= 1 && p.length <= 30 && !STOP_WORDS.has(p.toLowerCase())) {
          words.add(p.toLowerCase());
        }
      }
    }
  }

  // 2. 英文单词（含连字符）
  const enMatches = text.matchAll(/[a-zA-Z][a-zA-Z-]+/g);
  for (const m of enMatches) {
    const w = m[0].toLowerCase();
    if (w.length >= 2 && !STOP_WORDS.has(w)) {
      words.add(w);
    }
  }

  // 3. 中文词组（简单按 2-3 字滑窗，覆盖单字也加入）
  // 不做分词，直接把连续 CJK 字符串里的 2-gram 加入
  const cjkRuns = text.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g);
  for (const m of cjkRuns) {
    const run = m[0];
    // 2-gram
    for (let i = 0; i < run.length - 1; i++) {
      const gram = run.slice(i, i + 2);
      if (!STOP_WORDS.has(gram)) words.add(gram);
    }
    // 整个 run 也加入（如果是短词，<=6 字）
    if (run.length <= 6 && !STOP_WORDS.has(run)) words.add(run);
  }

  // 4. 特殊语法符号（mini-notation 里的 * / < > [ ] 等）
  const syntaxMatches = text.matchAll(/`([*<>[\]{}(),!@~?|/]+)`/g);
  for (const m of syntaxMatches) {
    words.add(m[1]);
  }

  return [...words];
}

// 从标题提取关键词（更宽松，保留所有词）
function extractTitleKeywords(title) {
  const words = new Set();
  // 英文
  const enMatches = title.matchAll(/[a-zA-Z][a-zA-Z-]+/g);
  for (const m of enMatches) {
    const w = m[0].toLowerCase();
    if (w.length >= 1) words.add(w);
  }
  // 中文
  const cjkMatches = title.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]+/g);
  for (const m of cjkMatches) {
    words.add(m[0]);
  }
  return [...words];
}

// ─── .mdx 切片 ─────────────────────────────────────────────────
// 去掉 frontmatter、import 语句、JSX 组件，保留 markdown 文本和代码块
function cleanMdx(content) {
  // 去 frontmatter
  content = content.replace(/^---[\s\S]*?---\n/, '');
  // 去 import 语句
  content = content.replace(/^import\s+.*$/gm, '');
  // 去 JSX 组件标签（<MiniRepl .../>），但保留其内容（代码字符串）
  // 简单策略：把 <Component...>...</Component> 和 <Component.../> 整个移除
  // 保留 prop 里的 tune={`...`} 代码（因为那是有用的示例）
  content = content.replace(/<(\w+)([^>]*?)\/>/g, (match, tag, props) => {
    // 提取 tune={`...`} 或 tune="..." 里的代码
    const tuneMatch = props.match(/tune=\{`([\s\S]*?)`\}/);
    if (tuneMatch) return '\n```\n' + tuneMatch[1].trim() + '\n```\n';
    return '';
  });
  content = content.replace(/<(\w+)([^>]*?)>([\s\S]*?)<\/\1>/g, (match, tag, props, inner) => {
    const tuneMatch = props.match(/tune=\{`([\s\S]*?)`\}/);
    if (tuneMatch) return '\n```\n' + tuneMatch[1].trim() + '\n```\n';
    return inner;
  });
  return content;
}

// 按 H2 切片 .mdx
function sliceMdx(content, sourceId) {
  const cleaned = cleanMdx(content);
  const lines = cleaned.split('\n');
  const fragments = [];
  let currentTitle = null;
  let currentBody = [];

  // 提取 H1 作为页面标题（用于无 H2 时的 fallback）
  let h1Title = sourceId;

  const flush = () => {
    if (currentTitle !== null) {
      const body = currentBody.join('\n').trim();
      if (body) {
        const titleKeywords = extractTitleKeywords(currentTitle);
        const bodyKeywords = extractKeywords(body);
        const keywords = [...new Set([...titleKeywords, ...bodyKeywords])];
        fragments.push({
          id: `${sourceId}#${slugify(currentTitle)}`,
          source: sourceId,
          title: currentTitle,
          keywords,
          body,
          tokens: estimateTokens(body),
        });
      }
    }
    currentTitle = null;
    currentBody = [];
  };

  for (const line of lines) {
    // H1
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      h1Title = h1Match[1].trim();
      continue;
    }
    // H2
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flush();
      currentTitle = h2Match[1].trim();
      currentBody = [];
      continue;
    }
    // H3 作为子标题，也触发新切片（粒度更细）
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      flush();
      currentTitle = h3Match[1].trim();
      currentBody = [];
      continue;
    }
    if (currentTitle !== null) {
      currentBody.push(line);
    } else {
      // H1 之前的内容，归到 H1 标题下
      if (line.trim()) {
        if (currentTitle === null) {
          currentTitle = h1Title;
          currentBody = [];
        }
        currentBody.push(line);
      }
    }
  }
  flush();

  return fragments;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── jsdoc 切片 ────────────────────────────────────────────────
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function sliceJsdoc(docJson) {
  const docs = docJson.docs || [];
  const fragments = [];

  for (const doc of docs) {
    if (!doc.name || doc.name.startsWith('_')) continue;

    const description = stripHtml(doc.description || '');
    const examples = (doc.examples || []).join('\n');
    const synonyms = doc.synonyms || [];
    const params = (doc.params || [])
      .map((p) => {
        const desc = stripHtml(typeof p.description === 'string' ? p.description : '');
        const types = p.type?.names?.join(' | ') || '';
        return `${p.name}${types ? ': ' + types : ''}${desc ? ' - ' + desc : ''}`;
      })
      .join('\n');

    // 拼正文
    const parts = [];
    if (description) parts.push(description);
    if (params) parts.push('Parameters:\n' + params);
    if (examples) parts.push('Examples:\n```\n' + examples + '\n```');
    const body = parts.join('\n\n').trim();

    if (!body) continue;

    // 关键词：name + synonyms + 正文提取
    const keywords = new Set();
    keywords.add(doc.name.toLowerCase());
    for (const s of synonyms) {
      if (s) keywords.add(s.toLowerCase());
    }
    for (const k of extractKeywords(body)) keywords.add(k);

    // 分类（与 Reference.jsx 的 getCategory 一致，简化版）
    const path = doc.meta?.path || '';
    const filename = doc.meta?.filename || '';
    let category = 'untagged';
    if (path.includes('superdough')) category = 'superdough';
    else if (path.includes('tonal')) category = 'tonal';
    else if (path.includes('core') || filename === 'pattern.mjs') category = 'pattern';
    else if (filename === 'controls.mjs') category = 'control';
    else if (filename === 'signal.mjs') category = 'signal';

    fragments.push({
      id: `ref/${doc.name}`,
      source: `reference/${category}`,
      title: doc.name + (synonyms.length ? ` (${synonyms.join(', ')})` : ''),
      keywords: [...keywords],
      body,
      tokens: estimateTokens(body),
    });
  }

  return fragments;
}

// ─── 主流程 ────────────────────────────────────────────────────
function listMdxFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => join(dir, f));
}

function main() {
  const allFragments = [];

  // 1. learn 文档
  const learnFiles = listMdxFiles(LEARN_DIR);
  for (const file of learnFiles) {
    const content = readFileSync(file, 'utf-8');
    const sourceId = 'learn/' + basename(file, '.mdx');
    const frags = sliceMdx(content, sourceId);
    allFragments.push(...frags);
  }

  // 2. workshop 文档
  const workshopFiles = listMdxFiles(WORKSHOP_DIR);
  for (const file of workshopFiles) {
    const content = readFileSync(file, 'utf-8');
    const sourceId = 'workshop/' + basename(file, '.mdx');
    const frags = sliceMdx(content, sourceId);
    allFragments.push(...frags);
  }

  // 3. jsdoc reference
  if (existsSync(JSDOC_PATH)) {
    const docJson = JSON.parse(readFileSync(JSDOC_PATH, 'utf-8'));
    const refFrags = sliceJsdoc(docJson);
    allFragments.push(...refFrags);
  } else {
    console.warn('[build-doc-fragments] jsdoc/doc.json not found, skipping reference. Run "npm run jsdoc-json" first.');
  }

  // 过滤掉过短或过长的片段
  const MIN_TOKENS = 10;
  const MAX_TOKENS = 800;
  const filtered = allFragments.filter((f) => {
    if (f.tokens < MIN_TOKENS) return false;
    if (f.tokens > MAX_TOKENS) {
      // 截断过长的片段
      const ratio = MAX_TOKENS / f.tokens;
      const cutLen = Math.floor(f.body.length * ratio);
      f.body = f.body.slice(0, cutLen) + '\n[...truncated]';
      f.tokens = estimateTokens(f.body);
    }
    return true;
  });

  // 去重（按 id）
  const seen = new Set();
  const deduped = filtered.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  // 输出
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    fragmentCount: deduped.length,
    fragments: deduped,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');

  // 统计
  const totalTokens = deduped.reduce((s, f) => s + f.tokens, 0);
  const bySource = {};
  for (const f of deduped) {
    bySource[f.source.split('/')[0]] = (bySource[f.source.split('/')[0]] || 0) + 1;
  }
  console.log(`[build-doc-fragments] Generated ${deduped.length} fragments (${totalTokens} tokens total)`);
  console.log('[build-doc-fragments] By source:', JSON.stringify(bySource));
  console.log(`[build-doc-fragments] Output: ${relative(projectRoot, OUTPUT_PATH)}`);
}

main();
