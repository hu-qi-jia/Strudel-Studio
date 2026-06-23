// docKnowledge.mjs — 运行时模块：从本地文档片段中按需检索并注入 system prompt。
//
// 与 ContextManager 的关系：
//   ContextManager.buildSystemPrompt 调用 matchDocFragmentsByText(recentText)
//   → 返回命中的片段 → buildDocKnowledgeSection 格式化为 prompt 片段 → 拼进 system prompt。
//
// 匹配策略（关键词驱动，无向量库）：
//   1. 把用户消息 + 最近 N 轮对话拼成查询文本
//   2. 对每个片段计算关键词命中分数（标题命中权重更高）
//   3. 按分数降序取 top N，受 token 预算约束
//
// 为什么不用向量数据库：语料小（~5 万 token）且高度结构化（API 名称 + 章节标题），
// 关键词匹配对精确术语（函数名、语法符号）比语义向量更准，且零运行时依赖。

import { DOC_FRAGMENT_BUDGET_TOKENS, DOC_FRAGMENT_MAX_COUNT, DOC_FRAGMENT_MAX_TOKENS_EACH } from './config.mjs';
import { estimateTextTokens } from './utils.mjs';

// 加载构建期生成的片段索引。Vite 原生支持 JSON import，无需 import attributes。
// 文件不存在时（如未跑构建脚本）Vite 会在构建期报错，开发时需先跑 npm run build-doc-fragments。
import docFragmentsData from './docFragments.json';

const defaultFragments = docFragmentsData.fragments || [];

// 知识版本追踪：模块加载时打印当前知识版本（debug 级别，默认不可见）。
// 用于调试时确认 agent 用的是哪个版本的 knowledge + docFragments。
console.debug(
  `[docKnowledge] knowledge v${docFragmentsData.version || '?'} (${docFragmentsData.fragmentCount || defaultFragments.length} fragments, built ${docFragmentsData.generatedAt || '?'})`,
);

// ─── 中英文同义词表 ─────────────────────────────────────────────
// 文档片段的关键词是英文（构建期从 .mdx 提取），但用户常用中文提问（"加混响"、"来段鼓组"）。
// 没有这张表时，"混响" 不会命中 "reverb"/"room" 的片段，导致文档注入失效。
// 映射方向：中文词 → 英文同义词数组（英文是文档索引语言）。
// 只收录高频音乐/编程术语，保持精简——过多低频词会引入噪声匹配。
const SYNONYMS = {
  // 效果
  混响: ['reverb', 'room'],
  延迟: ['delay', 'echo'],
  合唱: ['chorus'],
  失真: ['distort', 'distortion'],
  削波: ['clip', 'clipping'],
  滤波: ['filter', 'lpf', 'hpf', 'bpf'],
  低通: ['lpf', 'lowpass'],
  高通: ['hpf', 'highpass'],
  带通: ['bpf', 'bandpass'],
  颤音: ['vibrato'],
  移相: ['phaser'],
  振荡器: ['oscillator', 'sine', 'saw', 'square'],
  包络: ['envelope', 'adsr'],
  起音: ['attack'],
  衰减: ['decay'],
  延音: ['sustain'],
  释音: ['release'],
  压缩: ['compressor', 'compress'],
  // 音色
  采样: ['sample'],
  合成器: ['synth', 'synthesizer'],
  鼓: ['drum', 'bd', 'sd', 'hh'],
  贝斯: ['bass'],
  钢琴: ['piano'],
  噪声: ['noise', 'white', 'pink'],
  正弦: ['sine'],
  三角: ['triangle', 'tri'],
  方波: ['square', 'sqr'],
  锯齿: ['sawtooth', 'saw'],
  // 音乐概念
  旋律: ['melody', 'note'],
  和弦: ['chord'],
  音阶: ['scale'],
  节奏: ['rhythm', 'beat'],
  拍子: ['beat', 'tempo'],
  速度: ['tempo', 'cpm', 'cps'],
  音量: ['gain', 'volume'],
  声相: ['pan'],
  立体声: ['stereo'],
  频率: ['freq', 'frequency'],
  音高: ['pitch', 'note'],
  音符: ['note'],
  休止: ['rest'],
  反转: ['reverse', 'rev'],
  摇摆: ['swing'],
  慢: ['slow'],
  快: ['fast'],
  循环: ['loop', 'cycle'],
  层: ['layer', 'track'],
  轨道: ['track', 'orbit'],
  效果: ['effect', 'fx'],
  琶音: ['arpeggio', 'arp'],
  欧几里得: ['euclid'],
  多节拍: ['polymeter'],
  堆叠: ['stack'],
  序列: ['sequence', 'seq'],
  并行: ['parallel', 'stack'],
  转调: ['transpose'],
  移调: ['transpose'],
  // 编程
  函数: ['function'],
  方法: ['method'],
  参数: ['parameter', 'param'],
  字符串: ['string'],
  嵌套: ['nested'],
};

// 把提取出的查询关键词用同义词表扩展。
// 例：["混响"] → ["混响", "reverb", "room"]
// 只做单向扩展（中→英），不做英→中，因为文档索引语言是英文。
//
// 匹配策略：
// 1. 精确匹配：提取词 === 同义词 key（如 "混响" → reverb/room）
// 2. 子串匹配：单字中文 key 是提取词的子串（如 key="鼓" 匹配提取词 "鼓组"）
//    这是因为 extractQueryKeywords 只提取中文 2-gram，单字 key 需要子串匹配才能命中。
//    仅对单字 key 做子串匹配，避免多字 key 的误匹配。
export function expandWithSynonyms(keywords) {
  if (keywords.length === 0) return keywords;
  const expanded = new Set(keywords);
  const singleCharKeys = [];
  for (const key of Object.keys(SYNONYMS)) {
    if (key.length === 1) singleCharKeys.push(key);
  }
  for (const kw of keywords) {
    // 精确匹配
    const syns = SYNONYMS[kw];
    if (syns) {
      for (const s of syns) expanded.add(s.toLowerCase());
    }
    // 单字 key 子串匹配（仅对中文提取词）
    if (/[\u4e00-\u9fff]/.test(kw)) {
      for (const key of singleCharKeys) {
        if (kw.includes(key)) {
          for (const s of SYNONYMS[key]) expanded.add(s.toLowerCase());
        }
      }
    }
  }
  return [...expanded];
}

// ─── 默认片段集的预构建索引（模块加载时一次性完成）────────────
// 避免每次 matchDocFragments 调用都重建索引（570 个片段 × 每次构建 = 不必要的开销）。
const defaultKeywordIndex = new Map(); // keyword → Set<fragmentIndex>
const defaultTitleIndex = new Map(); // titleKeyword → Set<fragmentIndex>

defaultFragments.forEach((frag, idx) => {
  for (const kw of frag.keywords || []) {
    const key = kw.toLowerCase();
    if (!defaultKeywordIndex.has(key)) defaultKeywordIndex.set(key, new Set());
    defaultKeywordIndex.get(key).add(idx);
  }
  for (const kw of extractTitleWords(frag.title || '')) {
    const key = kw.toLowerCase();
    if (!defaultTitleIndex.has(key)) defaultTitleIndex.set(key, new Set());
    defaultTitleIndex.get(key).add(idx);
  }
});

// ─── 纯函数：关键词提取（供测试）──────────────────────────────

// 从标题提取词（比 extractQueryKeywords 更宽松，保留短词）
export function extractTitleWords(title) {
  const words = [];
  if (!title) return words;
  // 英文词
  const enMatches = title.matchAll(/[a-zA-Z][a-zA-Z-]*/g);
  for (const m of enMatches) words.push(m[0]);
  // 中文 2-gram
  const cjkMatches = title.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g);
  for (const m of cjkMatches) {
    words.push(m[0]);
    for (let i = 0; i < m[0].length - 1; i++) {
      words.push(m[0].slice(i, i + 2));
    }
  }
  return words;
}

// 从查询文本提取关键词（比构建期的 extractKeywords 更激进，包含短词）
export function extractQueryKeywords(text) {
  if (!text) return [];
  const words = new Set();

  // 1. 反引号 code 标记（API 名称、语法符号）
  const codeMatches = text.matchAll(/`([^`]+)`/g);
  for (const m of codeMatches) {
    const code = m[1].trim();
    if (code && code.length <= 40) {
      const parts = code.split(/[.\s(){}\[\],;:|<>]+/).filter(Boolean);
      for (const p of parts) {
        if (p.length >= 1 && p.length <= 30) words.add(p.toLowerCase());
      }
    }
  }

  // 2. 英文单词（含连字符，长度 >=2）
  const enMatches = text.matchAll(/[a-zA-Z][a-zA-Z-]+/g);
  for (const m of enMatches) {
    const w = m[0].toLowerCase();
    if (w.length >= 2) words.add(w);
  }

  // 3. 中文 2-gram
  const cjkRuns = text.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]{2,}/g);
  for (const m of cjkRuns) {
    const run = m[0];
    for (let i = 0; i < run.length - 1; i++) {
      words.add(run.slice(i, i + 2));
    }
    if (run.length <= 6) words.add(run);
  }

  // 4. .method() 模式（链式调用里的方法名）
  const methodMatches = text.matchAll(/\.(\w+)\s*\(/g);
  for (const m of methodMatches) {
    if (m[1].length >= 2) words.add(m[1].toLowerCase());
  }

  // 5. 函数调用模式 word(
  const funcMatches = text.matchAll(/\b(\w+)\s*\(/g);
  for (const m of funcMatches) {
    if (m[1].length >= 2) words.add(m[1].toLowerCase());
  }

  return [...words];
}

// ─── 纯函数：核心匹配逻辑（供测试）────────────────────────────

/**
 * 在给定的片段集合中检索匹配 queryText 的片段。
 * 纯函数，无副作用，便于单元测试。每次调用重建索引（测试用，性能不敏感）。
 *
 * @param {string} queryText - 查询文本（用户消息 + 最近对话）
 * @param {Array} fragments - 片段数组（每个含 keywords, title, body, tokens）
 * @param {object} options - { budgetTokens, maxCount, maxTokensEach }
 * @returns {Array} 命中的片段数组（按分数降序），已截断到 token 预算
 */
export function matchFragments(queryText, fragments, options = {}) {
  if (!queryText || !queryText.trim() || !fragments || fragments.length === 0) return [];

  const budgetTokens = options.budgetTokens ?? DOC_FRAGMENT_BUDGET_TOKENS;
  const maxCount = options.maxCount ?? DOC_FRAGMENT_MAX_COUNT;
  const maxTokensEach = options.maxTokensEach ?? DOC_FRAGMENT_MAX_TOKENS_EACH;

  const queryKeywords = extractQueryKeywords(queryText);
  if (queryKeywords.length === 0) return [];

  // 构建反向索引：keyword → Set<fragmentIndex>
  const keywordIndex = new Map();
  const titleKeywordIndex = new Map();
  fragments.forEach((frag, idx) => {
    for (const kw of frag.keywords || []) {
      const key = kw.toLowerCase();
      if (!keywordIndex.has(key)) keywordIndex.set(key, new Set());
      keywordIndex.get(key).add(idx);
    }
    for (const kw of extractTitleWords(frag.title || '')) {
      const key = kw.toLowerCase();
      if (!titleKeywordIndex.has(key)) titleKeywordIndex.set(key, new Set());
      titleKeywordIndex.get(key).add(idx);
    }
  });

  return selectByScore(queryKeywords, fragments, keywordIndex, titleKeywordIndex, {
    budgetTokens,
    maxCount,
    maxTokensEach,
  });
}

// 内部：按分数选取片段（共享给 matchFragments 和预构建索引路径）
function selectByScore(queryKeywords, fragments, keywordIndex, titleKeywordIndex, options) {
  const { budgetTokens, maxCount, maxTokensEach } = options;

  // 同义词扩展：中文查询词 → 英文同义词（文档索引语言是英文）
  const expandedKeywords = expandWithSynonyms(queryKeywords);

  // 计算每个片段的命中分数
  const scores = new Map(); // fragmentIndex → score
  for (const kw of expandedKeywords) {
    const key = kw.toLowerCase();
    // 正文关键词命中（权重 1）
    const bodyHits = keywordIndex.get(key);
    if (bodyHits) {
      for (const idx of bodyHits) {
        scores.set(idx, (scores.get(idx) || 0) + 1);
      }
    }
    // 标题关键词命中（权重 3，标题匹配更相关）
    const titleHits = titleKeywordIndex.get(key);
    if (titleHits) {
      for (const idx of titleHits) {
        scores.set(idx, (scores.get(idx) || 0) + 3);
      }
    }
  }

  // 按分数降序排列
  const ranked = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  // 按预算选取
  const selected = [];
  let totalTokens = 0;
  for (const [idx, score] of ranked) {
    if (selected.length >= maxCount) break;
    const frag = fragments[idx];
    if (!frag) continue;

    // 单片段 token 上限：超长则截断
    let body = frag.body;
    let tokens = estimateTextTokens(body);
    if (tokens > maxTokensEach) {
      // 按 token 比例估算字符截断长度。estimateTextTokens 对 ASCII 是 4 字符/token，
      // CJK 是 1 字符/token，所以 ratio = maxTokensEach / tokens 能正确换算回字符数。
      // 留 10% 余量给 "[...truncated]" 后缀，避免加后缀后又超限。
      const ratio = (maxTokensEach * 0.9) / tokens;
      const cutLen = Math.max(50, Math.floor(body.length * ratio));
      body = body.slice(0, cutLen) + '\n[...truncated]';
      tokens = estimateTextTokens(body);
    }

    if (totalTokens + tokens > budgetTokens) {
      // 预算不够就跳过这个片段（不截断到剩余预算，避免碎片化）
      continue;
    }

    selected.push({ ...frag, body, tokens, score });
    totalTokens += tokens;
  }

  return selected;
}

// ─── 格式化输出 ────────────────────────────────────────────────

/**
 * 把命中的片段格式化为 system prompt 片段。
 *
 * @param {Array} selected - matchFragments 的返回值
 * @returns {string} 拼接好的 prompt 片段（空数组返回空字符串）
 */
export function buildDocKnowledgeSection(selected) {
  if (!selected || selected.length === 0) return '';

  const blocks = selected.map((f) => {
    const header = `### ${f.title}\n(Source: ${f.source})`;
    return `${header}\n\n${f.body}`;
  });

  return `

## DOCUMENTATION EXCERPTS (from local Strudel docs)
The following excerpts from the Strudel documentation may be relevant to the user's request. Use them to write accurate, up-to-date code that matches the real API. If an excerpt contradicts your prior knowledge, trust the excerpt.

${blocks.join('\n\n')}`;
}

// ─── 便捷函数：用默认片段集匹配 ────────────────────────────────

/**
 * 用预拼接的查询文本匹配默认文档片段集。
 * ContextManager 直接调用这个函数（它已有 _collectRecentText 拼接逻辑）。
 * 使用模块加载时预构建的索引，避免每次调用重建。
 *
 * @param {string} queryText - 查询文本（用户消息 + 最近对话拼接）
 * @returns {Array} 命中的片段数组（按分数降序），已截断到 token 预算
 */
export function matchDocFragmentsByText(queryText) {
  if (!queryText || !queryText.trim()) return [];
  const queryKeywords = extractQueryKeywords(queryText);
  if (queryKeywords.length === 0) return [];
  return selectByScore(queryKeywords, defaultFragments, defaultKeywordIndex, defaultTitleIndex, {
    budgetTokens: DOC_FRAGMENT_BUDGET_TOKENS,
    maxCount: DOC_FRAGMENT_MAX_COUNT,
    maxTokensEach: DOC_FRAGMENT_MAX_TOKENS_EACH,
  });
}

/**
 * 从用户消息 + 最近对话文本中提取查询关键词，匹配默认的文档片段集。
 * 便捷函数：内部拼接 userMessage + recentTexts 后调用 matchDocFragmentsByText。
 *
 * @param {string} userMessage - 当前用户消息
 * @param {string[]} recentTexts - 最近几轮对话文本（可选）
 * @returns {Array} 命中的片段数组（按分数降序），已截断到 token 预算
 */
export function matchDocFragments(userMessage, recentTexts = []) {
  const queryText = [userMessage, ...recentTexts].filter(Boolean).join('\n');
  return matchDocFragmentsByText(queryText);
}

// ─── 供调试使用的导出 ───────────────────────────────────────────
export function getFragmentCount() {
  return defaultFragments.length;
}

export function getDefaultFragments() {
  return defaultFragments;
}
