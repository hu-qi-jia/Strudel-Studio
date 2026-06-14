import { tool, jsonSchema } from 'ai';
import { undo as cmUndo } from '@codemirror/commands';
import { soundRegistry } from './SoundRegistry.mjs';

// Methods that don't exist in Strudel and cause "is not defined" errors
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
};

// Standalone functions that don't exist in Strudel
const INVALID_FUNCTIONS = {
  func: 'Not a Strudel function',
  play: 'Use execute_code tool to play, or just write the pattern',
  melody: 'Use note("c3 e3 g3") for melody',
  synth: 'Use .s("superpiano"), .s("sawtooth"), .s("supersaw") etc.',
  beat: 'Use s("bd sd hh oh") for drum beats',
  rhythm: 'Use s("bd sd hh oh") for rhythm patterns',
  pattern: 'Use s("bd sd") or note("c3 e3") to start a pattern',
  setcps: 'Use setcpm() instead (cycles per minute)',
};

// 危险 API 黑名单：agent 生成的代码经 editor.evaluate() 在页面 origin 内执行，
// 而 origin 里存着 API key。若不拦截，提示注入可诱导 LLM 产出
// fetch(localStorage.getItem('agent-model-apiKey')) 之类的外泄/执行代码。
// 这些标识符在合法 Strudel pattern 代码中几乎不会出现，故直接拒绝写入。
const DANGEROUS_PATTERNS = [
  { re: /\bfetch\s*\(/, label: 'fetch()' },
  { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, label: 'WebSocket' },
  { re: /\bsendBeacon\b/, label: 'sendBeacon' },
  { re: /\bEventSource\b/, label: 'EventSource' },
  { re: /\bnew\s+Worker\b/, label: 'new Worker()' },
  { re: /\bimportScripts\b/, label: 'importScripts' },
  { re: /\blocalStorage\b/, label: 'localStorage' },
  { re: /\bsessionStorage\b/, label: 'sessionStorage' },
  { re: /\bdocument\.cookie\b/, label: 'document.cookie' },
  { re: /\bindexedDB\b/, label: 'indexedDB' },
  { re: /\beval\s*\(/, label: 'eval()' },
  { re: /\bnew\s+Function\b/, label: 'new Function()' },
  { re: /\bimport\s*\(/, label: 'dynamic import()' },
];

// ─── 代码静态检查辅助：剥离注释与字符串 ──────────────────────

// 只剥离 // 与 /* */ 注释，保留字符串字面量（字符串相关检查需要它们）
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
// 用于方法/函数名黑名单匹配，避免 mini-notation 字符串内容造成误报。
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

function validateCode(code) {
  const warnings = [];

  // 方法/函数黑名单检查：在「无注释、无字符串」的代码上匹配，
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

  // 数组传参与多行字符串检查在「仅去注释」的代码上进行（需要保留字符串结构）
  const noComments = stripComments(code);
  // 危险 API 扫描：在去注释、保留字符串的代码上匹配。注释里的危险词不误报，
  // 但 eval/Function 等执行原语，以及字符串内的外泄调用仍能被捕获。
  for (const { re, label } of DANGEROUS_PATTERNS) {
    if (re.test(noComments)) {
      warnings.push(
        `${label} is blocked in agent-generated code for security (prevents a crafted tool result from exfiltrating data or running arbitrary code). This is a hard rule — rewrite the pattern without it.`,
      );
    }
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

const noParams = jsonSchema({ type: 'object', properties: {}, required: [] });

const codeParam = {
  type: 'string',
  description:
    'The Strudel code. Must use only valid Strudel methods and mini notation strings (e.g. note("c3 e3 g3"), s("bd sd")). Never pass arrays.',
};

// 读取引擎最近一次的错误（eval 优先，回退到聚合 error）
function readEngineError(editor) {
  const state = editor?.repl?.state;
  if (!state) return null;
  return state.evalError || state.schedulerError || state.error || null;
}

/**
 * Create AI SDK tools bound to an editor instance.
 *
 * 设计要点（Cursor/Trae 形态）：
 * - 编辑类工具（write_code/edit_lines/insert_code/replace_code）写入后自动播放并
 *   用引擎真实反馈校验，失败则返回错误让模型自纠正，而非依赖正则黑名单。
 * - preview_sound 不再破坏用户代码：试听前保存原代码，restore_code 或下次写入时自动恢复。
 */
export function createTools(editorRef) {
  // 预览状态：savedCode !== null 表示编辑器当前是试听代码，原代码保存在此
  let savedCode = null;

  const getEditor = () => editorRef.current;

  // 若处于试听态，先静默恢复用户真实代码（不播放），返回是否发生了恢复
  const clearPreviewIfActive = () => {
    if (savedCode !== null) {
      const editor = getEditor();
      if (editor) editor.setCode(savedCode);
      savedCode = null;
      return true;
    }
    return false;
  };

  // 读取当前真实代码（试听态下返回保存的原代码，而非试听代码）
  const readCurrentCode = () => {
    const editor = getEditor();
    if (!editor) return '';
    if (savedCode !== null) return savedCode;
    return editor.editor.state.doc.toString();
  };

  return {
    // ─── 代码工具 ────────────────────────────────────────────

    read_code: tool({
      description:
        'Read the current code in the editor. Use this to refresh your view before a precise edit, or after several edits when the cached snapshot in the system prompt may be stale.',
      inputSchema: noParams,
      execute: async () => {
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        return readCurrentCode();
      },
    }),

    write_code: tool({
      description:
        'Replace ALL code in the editor with new code, then automatically play it and validate against the real engine. This is the PRIMARY tool for creating or fully rewriting a pattern. Returns engine errors if the code fails (the previous pattern keeps playing in that case). Only use valid Strudel methods — never .reverb() (use .room().size()), .echo() (use .delay()), .chorus(), .flanger(), .limiter(), .wah(), .eq(). Always use mini notation strings, never arrays.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { code: codeParam },
        required: ['code'],
      }),
      execute: async ({ code }) => {
        const warnings = validateCode(code);
        if (warnings.length > 0) {
          return `Code validation failed (not written):\n${warnings.join('\n')}\n\nFix these and retry.`;
        }
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        clearPreviewIfActive(); // 试听态下写入：先恢复真实代码再整体替换
        editor.setCode(code);
        try {
          await editor.evaluate(); // 写入后立即播放
        } catch {
          // evaluate 内部已捕获并写入 state，这里兜底
        }
        const err = readEngineError(editor);
        if (err) {
          return `Code was written but produced an error and was NOT played (the previous pattern continues):\n${err.message || err}\n\nFix the code and call write_code again.`;
        }
        return 'Code applied successfully and is now playing. Briefly tell the user what you changed.';
      },
    }),

    edit_lines: tool({
      description:
        'Cursor-style precise edit: replace a contiguous range of lines (1-based, inclusive) with new code, then play and validate. Use this for targeted modifications instead of rewriting the whole file. Returns a before/after diff summary. Count line numbers from the current code shown in the system prompt, or call read_code first if unsure. Pass new_code "" to delete the lines.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          start_line: { type: 'number', description: '1-based number of the first line to replace' },
          end_line: {
            type: 'number',
            description: '1-based number of the last line to replace (inclusive). Same as start_line for a single line.',
          },
          new_code: { type: 'string', description: 'Replacement code for the line range. Empty string deletes the lines.' },
        },
        required: ['start_line', 'end_line', 'new_code'],
      }),
      execute: async ({ start_line, end_line, new_code }) => {
        if (
          !Number.isInteger(start_line) ||
          !Number.isInteger(end_line) ||
          start_line < 1 ||
          end_line < start_line
        ) {
          return 'Error: start_line and end_line must be positive integers with end_line >= start_line.';
        }
        const warnings = validateCode(new_code);
        if (warnings.length > 0) {
          return `Code validation failed (not applied):\n${warnings.join('\n')}`;
        }
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        clearPreviewIfActive();
        const doc = editor.editor.state.doc;
        const total = doc.lines;
        if (start_line > total) {
          return `Error: start_line ${start_line} is beyond the end of the file (file has ${total} lines). Call read_code to see current line numbers.`;
        }
        const safeEnd = Math.min(end_line, total);
        const fromLine = doc.line(start_line);
        const toLine = doc.line(safeEnd);
        const oldText = doc.sliceString(fromLine.from, toLine.to);
        editor.editor.dispatch({
          changes: { from: fromLine.from, to: toLine.to, insert: new_code },
        });
        try {
          await editor.evaluate();
        } catch {
          /* ignored: evaluate 内部已捕获错误并写入 repl.state */
        }
        const err = readEngineError(editor);
        const before = oldText.split('\n').map((l) => `- ${l}`).join('\n');
        const after = (new_code || '(deleted)').split('\n').map((l) => `+ ${l}`).join('\n');
        if (err) {
          return `Lines ${start_line}-${safeEnd} edited but produced an error (NOT played):\n${err.message || err}\n\nChanged:\n${before}\n${after}\n\nCall undo to revert, or fix and edit again.`;
        }
        return `Edited lines ${start_line}-${safeEnd} (now playing):\n${before}\n${after}`;
      },
    }),

    insert_code: tool({
      description:
        'Insert code at a semantic anchor point. Prefer this over raw character offsets. Use after_line / before_line (1-based) or after_text / before_text (exact text match) for precise placement; beginning / end for file edges. Plays and validates after inserting.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          anchor: {
            type: 'string',
            enum: ['beginning', 'end', 'after_line', 'before_line', 'after_text', 'before_text'],
            description: 'Where to insert',
          },
          line: { type: 'number', description: '1-based line number (for after_line / before_line)' },
          text: { type: 'string', description: 'Exact anchor text currently in the editor (for after_text / before_text)' },
          code: codeParam,
        },
        required: ['anchor', 'code'],
      }),
      execute: async ({ anchor, line, text, code }) => {
        const warnings = validateCode(code);
        if (warnings.length > 0) {
          return `Code validation failed (not inserted):\n${warnings.join('\n')}`;
        }
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        clearPreviewIfActive();
        const doc = editor.editor.state.doc;
        const full = doc.toString();
        let pos;
        switch (anchor) {
          case 'beginning':
            pos = 0;
            break;
          case 'end':
            pos = full.length;
            break;
          case 'after_line': {
            if (!Number.isInteger(line) || line < 1 || line > doc.lines) {
              return `Error: line ${line} is out of range (file has ${doc.lines} lines).`;
            }
            pos = doc.line(line).to;
            break;
          }
          case 'before_line': {
            if (!Number.isInteger(line) || line < 1 || line > doc.lines) {
              return `Error: line ${line} is out of range (file has ${doc.lines} lines).`;
            }
            pos = doc.line(line).from;
            break;
          }
          case 'after_text': {
            const idx = full.indexOf(text);
            if (idx === -1) return `Error: anchor text not found. Provide the exact text currently in the editor (call read_code if unsure).`;
            pos = idx + text.length;
            break;
          }
          case 'before_text': {
            const idx = full.indexOf(text);
            if (idx === -1) return `Error: anchor text not found. Provide the exact text currently in the editor (call read_code if unsure).`;
            pos = idx;
            break;
          }
          default:
            return `Error: unknown anchor "${anchor}".`;
        }
        // 自动补换行，保证插入的代码独立成行
        let insert = code;
        if (pos > 0 && full[pos - 1] !== '\n') insert = '\n' + insert;
        if (pos < full.length && full[pos] !== '\n') insert = insert + '\n';
        editor.editor.dispatch({ changes: { from: pos, to: pos, insert } });
        try {
          await editor.evaluate();
        } catch {
          /* ignored: evaluate 内部已捕获错误并写入 repl.state */
        }
        const err = readEngineError(editor);
        if (err) {
          return `Code inserted at ${anchor} but produced an error (NOT played):\n${err.message || err}`;
        }
        return `Code inserted at ${anchor} and is now playing.`;
      },
    }),

    replace_code: tool({
      description:
        'Replace an exact text occurrence with new code, then play and validate. Prefer find_text (reliable) over character offsets. Good for swapping a single token or phrase.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          from: { type: 'number', description: 'Start character position (alternative to find_text)' },
          to: { type: 'number', description: 'End character position (alternative to find_text)' },
          find_text: { type: 'string', description: 'The exact text to find and replace (preferred over from/to)' },
          code: codeParam,
        },
        required: ['code'],
      }),
      execute: async ({ from, to, find_text, code }) => {
        const warnings = validateCode(code);
        if (warnings.length > 0) {
          return `Code validation failed (not applied):\n${warnings.join('\n')}`;
        }
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        clearPreviewIfActive();
        if (find_text) {
          const doc = editor.editor.state.doc.toString();
          const index = doc.indexOf(find_text);
          if (index === -1) {
            return `Error: Could not find the text "${find_text}" in the editor. Provide the exact current text (call read_code if unsure).`;
          }
          editor.editor.dispatch({
            changes: { from: index, to: index + find_text.length, insert: code },
          });
        } else {
          if (from === undefined || to === undefined) {
            return 'Error: Either provide find_text or both from and to parameters.';
          }
          editor.editor.dispatch({ changes: { from, to, insert: code } });
        }
        try {
          await editor.evaluate();
        } catch {
          /* ignored: evaluate 内部已捕获错误并写入 repl.state */
        }
        const err = readEngineError(editor);
        if (err) {
          return `Replace done but produced an error (NOT played):\n${err.message || err}`;
        }
        return 'Code replaced successfully and is now playing.';
      },
    }),

    execute_code: tool({
      description:
        'Play the current code in the editor WITHOUT changing it. Use this to replay after manual edits, or when you only want to hear the current code. (write_code/edit_lines/insert_code/replace_code already play automatically.)',
      inputSchema: noParams,
      execute: async () => {
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        clearPreviewIfActive();
        try {
          await editor.evaluate();
        } catch {
          /* ignored: evaluate 内部已捕获错误并写入 repl.state */
        }
        const err = readEngineError(editor);
        if (err) return `Playback failed: ${err.message || err}`;
        return 'Code is now playing.';
      },
    }),

    stop_playback: tool({
      description: 'Stop the current playback. Use when the user asks to stop or silence the music.',
      inputSchema: noParams,
      execute: async () => {
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        try {
          // repl 没有 setActive；正确方法是 stop()（内部调用 scheduler.stop()）
          editor.repl.stop();
        } catch {
          // ignore
        }
        return 'Playback stopped';
      },
    }),

    restore_code: tool({
      description:
        "Restore the user's original code after a preview_sound call, and play it. Call this when the user is done previewing sounds. (write_code/edit_lines/insert_code/replace_code auto-restore before applying real changes, so you usually do not need this.)",
      inputSchema: noParams,
      execute: async () => {
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        if (savedCode === null) return 'No preview is active — nothing to restore.';
        const code = savedCode;
        savedCode = null;
        editor.setCode(code);
        try {
          await editor.evaluate();
        } catch {
          /* ignored: evaluate 内部已捕获错误并写入 repl.state */
        }
        return 'Original code restored and playing.';
      },
    }),

    // ─── 编辑器工具 ────────────────────────────────────────────

    get_selection: tool({
      description: 'Get the currently selected code. Use when the user refers to "this code" or "selected code".',
      inputSchema: noParams,
      execute: async () => {
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        const selection = editor.editor.state.selection.main;
        if (selection.empty) return 'No code selected. The user needs to select some code first.';
        return editor.editor.state.doc.sliceString(selection.from, selection.to);
      },
    }),

    get_errors: tool({
      description: 'Get errors from the last code execution. Use when code execution fails to understand what went wrong.',
      inputSchema: noParams,
      execute: async () => {
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        const state = editor.repl?.state;
        const { error, evalError, schedulerError } = state || {};
        if (!error && !evalError && !schedulerError) return 'No errors found.';
        const errors = [];
        if (error) errors.push(`Error: ${error.message || error}`);
        if (evalError) errors.push(`Eval Error: ${evalError.message || evalError}`);
        if (schedulerError) errors.push(`Scheduler Error: ${schedulerError.message || schedulerError}`);
        return errors.join('\n');
      },
    }),

    undo: tool({
      description: 'Undo the last code modification in the editor. Use when a change was incorrect or the user wants to revert.',
      inputSchema: noParams,
      execute: async () => {
        const editor = getEditor();
        if (!editor) return 'Editor not available';
        const result = cmUndo(editor.editor);
        return result ? 'Undo successful' : 'Nothing to undo';
      },
    }),

    // ─── 音色工具 ─────────────────────────────────────────────

    list_sounds: tool({
      description:
        'List available sounds/samples. Discover what sounds exist before writing code. Filter by category, type, or tag, or search by name. Categories: "Drum Machines", "GM Soundfonts", "Samples", "Synths", "Special Samples".',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          category: { type: 'string' },
          type: { type: 'string', description: 'Filter by type: "sample", "synth", "soundfont"' },
          tag: { type: 'string', description: 'Filter by tag (e.g. "drum-machines")' },
          search: { type: 'string' },
        },
        required: [],
      }),
      execute: async ({ category, type, tag, search }) => {
        const sounds = soundRegistry.query({ category, type, tag, search });
        if (sounds.length === 0) {
          return 'No sounds found matching the criteria. Try a different search/category/tag, or call list_sounds without filters to see all.';
        }
        // 截断过长的结果：一次返回上百个音色会撑爆上下文，让模型在
        // 「查到音色」后停滞（不再继续生成代码）。先给前若干个 + 总数，
        // 并提示用更细的过滤条件缩小范围。
        const MAX = 50;
        const total = sounds.length;
        const shown = sounds.slice(0, MAX);
        const lines = shown.map((s) => {
          let desc = s.name;
          if (s.sampleCount && s.sampleCount > 1) desc += ` (${s.sampleCount} samples)`;
          return desc;
        });
        const header =
          total > MAX
            ? `Found ${total} sounds (showing first ${MAX} — narrow with category/type/tag/search for the rest):\n`
            : `Found ${total} sounds:\n`;
        // 记住：list_sounds 只是「查询」，查询后必须接着 write_code 写出可播放的 pattern。
        return `${header}${lines.join('\n')}\n\n(Discovery only — remember to follow up with write_code to actually make sound.)`;
      },
    }),

    get_sound_info: tool({
      description:
        'Get detailed info about a specific sound: type, category, tag, sample count, and usage examples. Use before writing code that references an unfamiliar sound.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { soundName: { type: 'string' } },
        required: ['soundName'],
      }),
      execute: async ({ soundName }) => {
        const sound = soundRegistry.getSound(soundName);
        if (!sound) {
          const similar = soundRegistry.query({ search: soundName }).slice(0, 5);
          const hint =
            similar.length > 0
              ? `\n\nDid you mean: ${similar.map((s) => s.name).join(', ')}?`
              : '\n\nUse list_sounds to see available sounds.';
          return `Sound "${soundName}" not found.${hint}`;
        }
        let info = `Sound: ${sound.name}\nCategory: ${sound.category}\nType: ${sound.type}`;
        if (sound.tag) info += `\nTag: ${sound.tag}`;
        if (sound.sampleCount) info += `\nSamples: ${sound.sampleCount}`;
        info += '\n\nUsage examples:';
        if (sound.type === 'sample') {
          if (sound.tag === 'drum-machines') {
            info += `\n  s("bd sd hh oh").bank("${sound.name}")`;
            info += `\n  s("${sound.name}_bd ${sound.name}_sd")`;
          } else if (sound.sampleCount && sound.sampleCount > 1) {
            info += `\n  s("${sound.name}").n("0 1 2 3")  // ${sound.sampleCount} samples, indices 0..${sound.sampleCount - 1}`;
            info += `\n  s("${sound.name}:0 ${sound.name}:1")`;
          } else {
            info += `\n  s("${sound.name}")`;
          }
        } else if (sound.type === 'soundfont' || sound.type === 'synth') {
          info += `\n  note("c3 e3 g3 c4").s("${sound.name}")`;
        }
        return info;
      },
    }),

    preview_sound: tool({
      description:
        "Preview a sound by temporarily playing a short pattern. The user's current code is saved first and is NOT lost — call restore_code to bring it back, or just call write_code/edit_lines next (they auto-restore first). Use this to let the user hear a sound before committing.",
      inputSchema: jsonSchema({
        type: 'object',
        properties: { soundName: { type: 'string' } },
        required: ['soundName'],
      }),
      execute: async ({ soundName }) => {
        const sound = soundRegistry.getSound(soundName);
        if (!sound) {
          return `Sound "${soundName}" not found. Use list_sounds to see available sounds.`;
        }
        const editor = getEditor();
        if (!editor) return 'Editor not available';

        let previewCode;
        if (sound.type === 'sample') {
          if (sound.tag === 'drum-machines') {
            previewCode = `s("bd sd [~ bd] sd,hh*8").bank("${sound.name}")`;
          } else if (sound.sampleCount && sound.sampleCount > 1) {
            previewCode = `s("${soundName}").n("0 1 2 3 4 5 6 7").slow(2)`;
          } else {
            previewCode = `s("${soundName}")`;
          }
        } else if (sound.type === 'soundfont' || sound.type === 'synth') {
          previewCode = `note("c3 e3 g3 c4").s("${soundName}").room(0.3)`;
        } else {
          previewCode = `s("${soundName}")`;
        }

        // 仅在非预览态时保存当前代码（避免连续 preview 丢失原始代码）
        if (savedCode === null) {
          savedCode = editor.editor.state.doc.toString();
        }
        editor.setCode(previewCode);
        try {
          await editor.evaluate();
        } catch {
          /* ignored: evaluate 内部已捕获错误并写入 repl.state */
        }
        return `Previewing: ${soundName}\nCode: ${previewCode}\n\nThe user's previous code is saved. Call restore_code to restore it, or call write_code/edit_lines to apply real changes (they auto-restore first).`;
      },
    }),
  };
}
