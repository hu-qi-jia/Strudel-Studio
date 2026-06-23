// docKnowledge.test.mjs — 文档片段检索的纯逻辑测试
//
// 覆盖：extractQueryKeywords / extractTitleWords / matchFragments / buildDocKnowledgeSection。
// 这些是 docKnowledge.mjs 的核心纯函数，不依赖 React / superdough / 实际 docFragments.json。
// matchFragments 接受任意片段数组，用 mock 数据测，避免对实际文档内容的脆弱依赖。

import { describe, it, expect } from 'vitest';
import {
  extractQueryKeywords,
  extractTitleWords,
  matchFragments,
  buildDocKnowledgeSection,
  expandWithSynonyms,
} from './docKnowledge.mjs';

// ─── 测试用 mock 片段数据 ──────────────────────────────────────
const mockFragments = [
  {
    id: 'learn/mini-notation#multiplication',
    source: 'learn/mini-notation',
    title: 'Multiplication',
    keywords: ['multiplication', 'speed', 'fast', 'asterisk', 'multiply', '*'],
    body: 'A sequence can be sped up by multiplying it by a number using the asterisk symbol (*).',
    tokens: 20,
  },
  {
    id: 'learn/effects#reverb',
    source: 'learn/effects',
    title: 'Reverb',
    keywords: ['reverb', 'room', 'size', 'effect', 'space'],
    body: 'Reverb adds space to the sound. Use .room(0.7) and .size(0.8) for a large hall effect.',
    tokens: 25,
  },
  {
    id: 'ref/room',
    source: 'reference/control',
    title: 'room (reverb)',
    keywords: ['room', 'reverb', 'space', 'hall'],
    body: 'Sets reverb amount. .room(0.7) gives a medium reverb. Range 0-1.',
    tokens: 15,
  },
  {
    id: 'learn/tonal#scale',
    source: 'learn/tonal',
    title: 'Scale',
    keywords: ['scale', 'tonal', 'note', 'degree', 'minor', 'major'],
    body: 'Use .scale("c:minor") to constrain notes to a scale. Pass note numbers (n) not note names.',
    tokens: 22,
  },
  {
    id: 'learn/sounds#drum-machines',
    source: 'learn/sounds',
    title: 'Drum Machines',
    keywords: ['drum', 'machine', 'bank', 'roland', 'tr909', 'bd', 'sd', 'hh'],
    body: 'Play drum names then choose a kit with .bank(). s("bd sd hh").bank("RolandTR909")',
    tokens: 18,
  },
];

// ─── extractQueryKeywords ──────────────────────────────────────
describe('extractQueryKeywords', () => {
  it('提取英文单词', () => {
    const kws = extractQueryKeywords('how to use reverb?');
    expect(kws).toContain('how');
    expect(kws).toContain('to');
    expect(kws).toContain('use');
    expect(kws).toContain('reverb');
  });

  it('提取反引号 code 标记', () => {
    const kws = extractQueryKeywords('how does `.room()` work?');
    expect(kws).toContain('room');
  });

  it('提取 .method() 模式', () => {
    const kws = extractQueryKeywords('add .room(0.7) to the piano');
    expect(kws).toContain('room');
  });

  it('提取函数调用模式', () => {
    const kws = extractQueryKeywords('use note("c3 e3") for melody');
    expect(kws).toContain('note');
  });

  it('提取中文 2-gram', () => {
    const kws = extractQueryKeywords('怎么用混响');
    expect(kws).toContain('怎么');
    expect(kws).toContain('么用');
    expect(kws).toContain('用混');
    expect(kws).toContain('混响');
  });

  it('空输入返回空数组', () => {
    expect(extractQueryKeywords('')).toEqual([]);
    expect(extractQueryKeywords(null)).toEqual([]);
    expect(extractQueryKeywords(undefined)).toEqual([]);
  });

  it('关键词转小写', () => {
    const kws = extractQueryKeywords('Reverb Room SIZE');
    for (const k of kws) {
      expect(k).toBe(k.toLowerCase());
    }
  });
});

// ─── extractTitleWords ─────────────────────────────────────────
describe('extractTitleWords', () => {
  it('提取英文标题词', () => {
    const words = extractTitleWords('Drum Machines');
    expect(words).toContain('Drum');
    expect(words).toContain('Machines');
  });

  it('提取中文标题 2-gram', () => {
    const words = extractTitleWords('混响效果');
    expect(words).toContain('混响');
    expect(words).toContain('响效');
    expect(words).toContain('效果');
  });

  it('空标题返回空数组', () => {
    expect(extractTitleWords('')).toEqual([]);
    expect(extractTitleWords(null)).toEqual([]);
  });
});

// ─── matchFragments ────────────────────────────────────────────
describe('matchFragments', () => {
  it('空查询返回空数组', () => {
    expect(matchFragments('', mockFragments)).toEqual([]);
    expect(matchFragments('   ', mockFragments)).toEqual([]);
    expect(matchFragments(null, mockFragments)).toEqual([]);
  });

  it('空片段集返回空数组', () => {
    expect(matchFragments('reverb', [])).toEqual([]);
    expect(matchFragments('reverb', null)).toEqual([]);
  });

  it('无匹配返回空数组', () => {
    expect(matchFragments('xyzabc', mockFragments)).toEqual([]);
  });

  it('按关键词命中返回片段', () => {
    const result = matchFragments('how to use reverb?', mockFragments);
    expect(result.length).toBeGreaterThan(0);
    // reverb 命中了 effects#reverb 和 ref/room
    const titles = result.map((f) => f.title);
    expect(titles).toContain('Reverb');
    expect(titles).toContain('room (reverb)');
  });

  it('标题命中权重高于正文命中', () => {
    // "room" 同时在 ref/room 的标题和 learn/effects#reverb 的正文
    const result = matchFragments('room', mockFragments);
    expect(result.length).toBeGreaterThan(0);
    // ref/room 的标题含 "room"，应该排第一
    expect(result[0].title).toBe('room (reverb)');
  });

  it('按分数降序排列', () => {
    const result = matchFragments('reverb room', mockFragments);
    expect(result.length).toBeGreaterThan(1);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it('遵守 maxCount 限制', () => {
    const result = matchFragments('reverb room scale drum', mockFragments, { maxCount: 2 });
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('遵守 budgetTokens 限制', () => {
    // 设很小的预算，只能装下 1 个片段
    const result = matchFragments('reverb room', mockFragments, { budgetTokens: 20 });
    expect(result.length).toBeLessThanOrEqual(1);
    const totalTokens = result.reduce((s, f) => s + f.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(20);
  });

  it('超长片段被截断到 maxTokensEach', () => {
    const longFrag = {
      id: 'test/long',
      source: 'test',
      title: 'Long Fragment',
      keywords: ['long', 'test'],
      body: 'A '.repeat(1000), // ~250 tokens
      tokens: 250,
    };
    const result = matchFragments('long test', [longFrag], { maxTokensEach: 50 });
    expect(result.length).toBe(1);
    expect(result[0].tokens).toBeLessThanOrEqual(60); // 截断后 + "[...truncated]"
    expect(result[0].body).toContain('[...truncated]');
  });

  it('中文查询能匹配中文关键词', () => {
    const cnFrag = {
      id: 'test/cn',
      source: 'test',
      title: '混响',
      keywords: ['混响', '效果'],
      body: '混响效果让声音有空间感。',
      tokens: 10,
    };
    const result = matchFragments('怎么加混响', [cnFrag]);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('混响');
  });

  it('返回的片段含 score 字段', () => {
    const result = matchFragments('reverb', mockFragments);
    for (const f of result) {
      expect(f.score).toBeGreaterThan(0);
      expect(typeof f.score).toBe('number');
    }
  });

  it('中文查询通过同义词扩展匹配英文关键词片段', () => {
    // "混响" 不在 mockFragments 的 keywords 里，但同义词 reverb/room 在
    const result = matchFragments('怎么加混响', mockFragments);
    expect(result.length).toBeGreaterThan(0);
    const titles = result.map((f) => f.title);
    expect(titles).toContain('Reverb');
    expect(titles).toContain('room (reverb)');
  });

  it('中文"延迟"通过同义词匹配 delay 相关片段', () => {
    const delayFrag = {
      id: 'learn/effects#delay',
      source: 'learn/effects',
      title: 'Delay',
      keywords: ['delay', 'echo', 'feedback'],
      body: 'Use .delay(0.5).delaytime(0.25) for echo.',
      tokens: 15,
    };
    const result = matchFragments('加延迟效果', [delayFrag, ...mockFragments]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].title).toBe('Delay');
  });

  it('中文"鼓"通过同义词匹配 drum 相关片段', () => {
    const result = matchFragments('来一段鼓组', mockFragments);
    expect(result.length).toBeGreaterThan(0);
    const titles = result.map((f) => f.title);
    expect(titles).toContain('Drum Machines');
  });
});

// ─── expandWithSynonyms ────────────────────────────────────────
describe('expandWithSynonyms', () => {
  it('中文词扩展出英文同义词', () => {
    const result = expandWithSynonyms(['混响']);
    expect(result).toContain('混响');
    expect(result).toContain('reverb');
    expect(result).toContain('room');
  });

  it('英文词不扩展（单向中→英）', () => {
    const result = expandWithSynonyms(['reverb']);
    expect(result).toEqual(['reverb']);
  });

  it('空数组返回空数组', () => {
    expect(expandWithSynonyms([])).toEqual([]);
  });

  it('无同义词的词原样返回', () => {
    const result = expandWithSynonyms(['xyzabc']);
    expect(result).toEqual(['xyzabc']);
  });

  it('多词混合扩展', () => {
    const result = expandWithSynonyms(['混响', '钢琴', 'reverb']);
    expect(result).toContain('混响');
    expect(result).toContain('reverb');
    expect(result).toContain('room');
    expect(result).toContain('钢琴');
    expect(result).toContain('piano');
  });

  it('扩展词转小写', () => {
    const result = expandWithSynonyms(['振荡器']);
    // 同义词应是小写
    for (const w of result) {
      if (w !== '振荡器') {
        expect(w).toBe(w.toLowerCase());
      }
    }
  });
});

// ─── buildDocKnowledgeSection ──────────────────────────────────
describe('buildDocKnowledgeSection', () => {
  it('空数组返回空字符串', () => {
    expect(buildDocKnowledgeSection([])).toBe('');
    expect(buildDocKnowledgeSection(null)).toBe('');
    expect(buildDocKnowledgeSection(undefined)).toBe('');
  });

  it('含 DOCUMENTATION EXCERPTS 标题', () => {
    const selected = [{ title: 'Test', source: 'test', body: 'Test body' }];
    const result = buildDocKnowledgeSection(selected);
    expect(result).toContain('DOCUMENTATION EXCERPTS');
    expect(result).toContain('from local Strudel docs');
  });

  it('包含每个片段的标题和正文', () => {
    const selected = [
      { title: 'Reverb', source: 'learn/effects', body: 'Use .room(0.7)' },
      { title: 'room', source: 'reference', body: 'Sets reverb amount' },
    ];
    const result = buildDocKnowledgeSection(selected);
    expect(result).toContain('### Reverb');
    expect(result).toContain('Use .room(0.7)');
    expect(result).toContain('### room');
    expect(result).toContain('Sets reverb amount');
  });

  it('包含 Source 标注', () => {
    const selected = [{ title: 'Test', source: 'learn/test', body: 'body' }];
    const result = buildDocKnowledgeSection(selected);
    expect(result).toContain('Source: learn/test');
  });
});
