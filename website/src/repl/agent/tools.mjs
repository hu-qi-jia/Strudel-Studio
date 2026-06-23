import { tool, jsonSchema } from 'ai';
import { undo as cmUndo } from '@codemirror/commands';
import { renderPatternToBuffer, initAudio } from '@strudel/webaudio';
import { settingsMap } from '../../settings.mjs';
import { soundRegistry } from './SoundRegistry.mjs';
// 代码静态护栏（危险 API 黑名单 + emoji 剥离 + 语法检查）已抽到纯模块 codeGuard.mjs，
// 独立于 editor / AI SDK / audio 图，便于用普通 node 单测覆盖各类绕过手法。详见 codeGuard.mjs。
import { validateCode, stripEmojis } from './codeGuard.mjs';
// 自我评估回路（agent 的「耳朵」）：编排静态打分 + 渲染后 DSP，均纯模块、可 node 单测。
import { analyzeArrangement } from './arrangementCheck.mjs';
import { analyzeRenderedAudio } from './audioAnalysis.mjs';
// 工具超时配置 + withTimeout 包装器：网络/CPU 密集型工具卡住时返回错误消息而非中断流。
import { TOOL_TIMEOUTS } from './config.mjs';
import { withTimeout } from './utils.mjs';

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
 * - 编辑类工具（write_code/edit_lines）写入后自动播放并用引擎真实反馈校验，
 *   失败则返回错误让模型自纠正，而非依赖正则黑名单。
 * - 这些工具返回结构化对象 { ok, playing, message }：useAgent 取 message 作为给模型/UI
 *   展示的字符串，取 playing 作为护栏（Guardrail.turnProducedPlayingCode）判定「本轮是否
 *   产出可播放代码」的依据——不依赖英文措辞，改文案不会让护栏失效。
 * - 单一写入口：只有 write_code / edit_lines 会改动编辑器代码。试听某个音色？
 *   直接 write_code（自动播放校验），undo 回退——不再有「预览覆盖用户代码」的
 *   save/restore 状态机（那是为擦自己屁股而生的补丁）。
 */
export function createTools(editorRef, opts = {}) {
  const getEditor = () => editorRef.current;
  // 确认回调（human-in-the-loop）：write_code 全量替换 / analyze_pattern_audio 中断播放前，
  // 若 opts.requestApproval 存在则 await 用户批准。返回 true 继续，false 取消。
  // useAgent 提供实现：设置 pendingApproval state，AgentSidebar 渲染 diff 预览 + 批准/拒绝。
  const requestApproval = opts.requestApproval;

  // 读取当前真实代码（供 read_code / analyze_arrangement 用）
  const readCurrentCode = () => {
    const editor = getEditor();
    if (!editor) return '';
    return editor.editor.state.doc.toString();
  };

  // analyze_pattern_audio 渲染后恢复实时音频路径：镜像 handleExport 的 finally —— 离线渲染把全局
  // context 换成了 OfflineAudioContext，worklet 缓存还指向它；必须重新 initAudio 武装回
  // live context，否则后续播放静音。再停调度器待命（与 handleExport 收尾一致）。
  const restoreLiveAudio = async (settings) => {
    try {
      await initAudio({
        maxPolyphony: settings.maxPolyphony,
        audioDeviceName: settings.audioDeviceName,
        multiChannelOrbits: settings.multiChannelOrbits,
      });
    } catch (e) {
      console.warn('[analyze_pattern_audio] failed to restore live audio context:', e);
    }
    try {
      getEditor()?.repl?.scheduler?.stop();
    } catch {
      /* best-effort：调度器停止失败不阻断恢复流程 */
    }
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
        'Replace ALL code in the editor with new code, then automatically play it and validate against the real engine. This is the PRIMARY tool for creating or fully rewriting a pattern. Returns engine errors if the code fails (the previous pattern keeps playing in that case). To preview an unfamiliar sound, just write_code a short pattern with it and call undo to revert — there is no separate preview tool. Only use valid Strudel methods — never .reverb() (use .room().size()), .echo() (use .delay()), .chorus(), .flanger(), .limiter(), .wah(), .eq(). Always use mini notation strings, never arrays.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { code: codeParam },
        required: ['code'],
      }),
      execute: async ({ code: rawCode }) => {
        const code = stripEmojis(rawCode);
        const warnings = validateCode(code);
        if (warnings.length > 0) {
          // 结构化返回：ok=false, playing=false。护栏据此判定「这轮没产出可播放代码」。
          return { ok: false, playing: false, message: `Code validation failed (not written):\n${warnings.join('\n')}\n\nFix these and retry.` };
        }
        const editor = getEditor();
        if (!editor) return { ok: false, playing: false, message: 'Editor not available' };
        // p2 human-in-the-loop：全量替换前让用户预览 diff 并确认。
        // 避免用户 30 分钟调的 pattern 被 agent 一句"加 reverb"全量重写丢失。
        if (requestApproval) {
          const oldCode = readCurrentCode();
          const approved = await requestApproval({
            tool: 'write_code',
            oldCode,
            newCode: code,
            summary: 'Replace ALL code in the editor',
          });
          if (!approved) {
            return { ok: false, playing: false, message: 'User declined the full code replacement. Ask the user how they would like to proceed, or use edit_lines for a targeted change instead.' };
          }
        }
        editor.setCode(code);
        try {
          await editor.evaluate(); // 写入后立即播放
        } catch {
          // evaluate 内部已捕获并写入 state，这里兜底
        }
        const err = readEngineError(editor);
        if (err) {
          return { ok: false, playing: false, message: `Code was written but produced an error and was NOT played (the previous pattern continues):\n${err.message || err}\n\nFix the code and call write_code again.` };
        }
        return { ok: true, playing: true, message: 'Code applied successfully and is now playing. Briefly tell the user what you changed.' };
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
          return { ok: false, playing: false, message: 'Error: start_line and end_line must be positive integers with end_line >= start_line.' };
        }
        const code = stripEmojis(new_code);
        const warnings = validateCode(code);
        if (warnings.length > 0) {
          return { ok: false, playing: false, message: `Code validation failed (not applied):\n${warnings.join('\n')}` };
        }
        const editor = getEditor();
        if (!editor) return { ok: false, playing: false, message: 'Editor not available' };
        const doc = editor.editor.state.doc;
        const total = doc.lines;
        if (start_line > total) {
          return { ok: false, playing: false, message: `Error: start_line ${start_line} is beyond the end of the file (file has ${total} lines). Call read_code to see current line numbers.` };
        }
        const safeEnd = Math.min(end_line, total);
        const fromLine = doc.line(start_line);
        const toLine = doc.line(safeEnd);
        const oldText = doc.sliceString(fromLine.from, toLine.to);
        editor.editor.dispatch({
          changes: { from: fromLine.from, to: toLine.to, insert: code },
        });
        try {
          await editor.evaluate();
        } catch {
          /* ignored: evaluate 内部已捕获错误并写入 repl.state */
        }
        const err = readEngineError(editor);
        const before = oldText.split('\n').map((l) => `- ${l}`).join('\n');
        const after = (code || '(deleted)').split('\n').map((l) => `+ ${l}`).join('\n');
        if (err) {
          return { ok: false, playing: false, message: `Lines ${start_line}-${safeEnd} edited but produced an error (NOT played):\n${err.message || err}\n\nChanged:\n${before}\n${after}\n\nCall undo to revert, or fix and edit again.` };
        }
        return { ok: true, playing: true, message: `Edited lines ${start_line}-${safeEnd} (now playing):\n${before}\n${after}` };
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
      description: 'Undo the last code modification in the editor. Use when a change was incorrect, the user wants to revert, or after previewing a sound with write_code.',
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
          return { totalCount: 0, shownCount: 0, hasMore: false, message: 'No sounds found matching the criteria. Try a different search/category/tag, or call list_sounds without filters to see all.' };
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
        const hasMore = total > MAX;
        const header = hasMore
          ? `Found ${total} sounds (showing first ${MAX} — narrow with category/type/tag/search for the rest):\n`
          : `Found ${total} sounds:\n`;
        // 记住：list_sounds 只是「查询」，查询后必须接着 write_code 写出可播放的 pattern。
        // 结构化返回 totalCount/hasMore 让模型能判断是否需要细化过滤再查一次。
        return {
          totalCount: total,
          shownCount: shown.length,
          hasMore,
          message: `${header}${lines.join('\n')}\n\n(Discovery only — remember to follow up with write_code to actually make sound.)`,
        };
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

    // ─── 自我评估工具（agent 的「听觉反馈回路」）─────────────────
    // 直接回应「让 agent 能评判自己作品的好坏」。两层互补：
    //  analyze_arrangement —— 静态分析编排结构（零成本零风险，默认质量自检）
    //  analyze_pattern_audio       —— 离线渲染 + DSP 测量（听物理问题，较重，编排合格后再用）
    // 两者均返回 message（给模型/UI 的可读摘要）+ 结构化字段（findings 等）。
    // 产物是「诊断」，不是代码；模型据此调 write_code/edit_lines 改进（单一写入口不变）。

    analyze_arrangement: tool({
      description:
        'Score the CURRENT editor code on arrangement quality (0-100) across 7 dimensions: layers (multi-track), velocity variation, stereo separation, space/reverb, MACRO FORM (sections over time — the biggest factor in a track feeling complete), parameter automation, and tempo. Returns which dimensions pass/fail with concrete Strudel fixes. This is an instant static code check — no audio is rendered, nothing is disturbed. Call it right after write_code and BEFORE you declare the track done; if the score is low or "form"/"layers" fail, improve the code using the suggestions and re-check. A flat single-track loop with no sections will score low and is NOT an acceptable finished track.',
      inputSchema: noParams,
      execute: async () => {
        const code = readCurrentCode();
        if (!code || !code.trim()) {
          return {
            ok: false,
            score: 0,
            message: 'Editor is empty — write some code first, then analyze_arrangement.',
            findings: [],
          };
        }
        const result = analyzeArrangement(code);
        return { ok: true, message: result.summary, ...result };
      },
    }),

    analyze_pattern_audio: tool({
      description:
        'Render the CURRENT pattern offline for a few cycles and run DSP analysis on the audio: clipping, loudness (peak/RMS), dynamics (crest factor), 3-band spectral balance (muddy low end / dull highs / honky mids), stereo width, and silence detection. This is your "ear" — it hears physical problems that static code analysis cannot: a dead sample that renders silent, a muddy boomy low end, or digital clipping. NOTE: it briefly interrupts live playback to render (a second or two), so use it AFTER the arrangement is solid (analyze_arrangement passes), not on every edit. Returns measurements + findings with fixes. If it reports SILENCE or CLIPPING, you MUST fix those before finishing.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          cycles: {
            type: 'number',
            description: 'How many cycles to render (default 4). More = slower but more representative. Keep 2-8.',
          },
        },
      }),
      execute: async ({ cycles } = {}) => {
        const editor = getEditor();
        if (!editor) return { ok: false, message: 'Editor not available.' };
        const repl = editor.repl;
        if (!repl || !repl.scheduler) return { ok: false, message: 'Audio engine not ready.' };
        const cy = Math.max(1, Math.min(16, Math.round(cycles) || 4));
        const settings = settingsMap.get();

        // p6 知情确认：analyze_pattern_audio 会中断实时播放 1-2 秒做离线渲染。
        // live-coding 场景里中断播放是反用户体验，让用户知情同意。
        if (requestApproval) {
          const approved = await requestApproval({
            tool: 'analyze_pattern_audio',
            message: 'Audio analysis will briefly interrupt playback (1-2s) to render offline. Continue?',
          });
          if (!approved) {
            return { ok: false, message: 'User declined audio analysis (would interrupt playback). Skip analyze_pattern_audio and proceed with the arrangement check only.' };
          }
        }

        // 镜像 handleExport 的安全编排：渲染期间绝不让实时调度器触发 getTrigger（会与
        // context 临时切换竞态 → "Failed to fetch"）。先停调度器，再用 autostart=false 刷新 pattern。
        // 渲染 + DSP 包在 withTimeout 里——离线渲染复杂 pattern 可能很慢，超时返回错误让模型自纠正。
        return withTimeout(
          async () => {
            try {
              repl.scheduler.stop();
            } catch {
              /* best-effort：渲染前停调度器，失败不阻断 */
            }
            let pattern;
            try {
              await repl.evaluate(editor.code, false); // evaluate() 无参会 autostart，重引入竞态
              repl.scheduler.stop();
              pattern = repl.state && repl.state.pattern;
            } catch (e) {
              await restoreLiveAudio(settings);
              return { ok: false, message: `Could not evaluate pattern: ${e?.message || e}` };
            }
            if (!pattern) {
              await restoreLiveAudio(settings);
              return { ok: false, message: 'No pattern to analyze — write/play some code first.' };
            }
            const cps = repl.scheduler.cps;
            if (!cps || !isFinite(cps) || cps <= 0) {
              await restoreLiveAudio(settings);
              return { ok: false, message: 'Could not determine a valid cps.' };
            }

            // 离线渲染（renderPatternToBuffer 内部安全 swap+恢复全局 context；lower SR = 更快）
            const sampleRate = 22050;
            let buffer;
            try {
              buffer = await renderPatternToBuffer(
                pattern,
                cps,
                0,
                cy,
                sampleRate,
                settings.maxPolyphony || 1024,
                settings.multiChannelOrbits === true,
              );
            } catch (e) {
              await restoreLiveAudio(settings);
              return {
                ok: false,
                message: `Audio render failed: ${e?.message || e}. A sound may have failed to load — check the sounds with write_code + undo.`,
              };
            }
            // 恢复实时音频路径（重武装 live context 的 worklet 缓存）
            await restoreLiveAudio(settings);

            // 取声道 → DSP
            const channels = [];
            for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
            const analysis = analyzeRenderedAudio(channels, buffer.sampleRate);

            // 分析期间停掉了调度器；分析完恢复播放，避免把用户留在静音状态。
            // editor.evaluate() 内部 repl.evaluate(this.code) 默认 autostart → 重新起播。
            try {
              await editor.evaluate();
            } catch {
              /* 恢复播放：evaluate 内部已捕获错误，此处忽略 */
            }

            return { ok: true, cyclesRendered: cy, message: analysis.summary, ...analysis };
          },
          TOOL_TIMEOUTS.analyze_pattern_audio,
          { ok: false, message: `Audio analysis timed out after ${TOOL_TIMEOUTS.analyze_pattern_audio / 1000}s. The pattern may be too complex — try fewer cycles or simplify the pattern.` },
        );
      },
    }),
    // ─── 社区曲目工具 ─────────────────────────────────────────

    browse_repo: tool({
      description:
        'Browse a GitHub repository to discover Strudel example songs and patterns. Lists files in the repo (focused on .js files). Use this to find example tracks from repos like "terryds/awesome-strudel" or "eefano/strudel-songs-collection", then call fetch_example to read a specific file. Returns file names, paths, and sizes.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'GitHub repo in "owner/repo" format (e.g. "eefano/strudel-songs-collection") or full URL.',
          },
          branch: {
            type: 'string',
            description: 'Branch name (defaults to "main")',
          },
          path: {
            type: 'string',
            description: 'Optional subdirectory path to list (e.g. "functions" or "tinkering")',
          },
        },
        required: ['repo'],
      }),
      execute: async ({ repo, branch = 'main', path = '' }) => {
        return withTimeout(
          async () => {
            // Normalize repo input: accept "owner/repo", full URL, or "github:owner/repo"
            let ownerRepo = repo.replace(/^https?:\/\/github\.com\//, '').replace(/^github:/, '').replace(/\.git$/, '').replace(/\/$/, '');
            const apiUrl = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;
            try {
              const resp = await fetch(apiUrl);
              if (!resp.ok) {
                // Try 'master' branch as fallback
                if (branch === 'main') {
                  const fallback = await fetch(`https://api.github.com/repos/${ownerRepo}/git/trees/master?recursive=1`);
                  if (fallback.ok) {
                    const data = await fallback.json();
                    return formatRepoTree(data, ownerRepo, path);
                  }
                }
                return `Failed to browse repo "${ownerRepo}" (HTTP ${resp.status}). Check the repo name and branch. Use the format "owner/repo".`;
              }
              const data = await resp.json();
              return formatRepoTree(data, ownerRepo, path);
            } catch (e) {
              return `Network error browsing "${ownerRepo}": ${e.message}. The GitHub API may be rate-limited or blocked. Try again later or ask the user to check network connectivity.`;
            }
          },
          TOOL_TIMEOUTS.browse_repo,
          `Timed out browsing repo "${repo}" after ${TOOL_TIMEOUTS.browse_repo / 1000}s. The GitHub API may be slow or blocked. Try again or ask the user to check network connectivity.`,
        );
      },
    }),

    fetch_example: tool({
      description:
        'Fetch the content of a specific file from a GitHub repository. Use after browse_repo to read a song\'s code. The file content can then be adapted and loaded into the editor with write_code. Supports .js, .mjs, .md, and .json files.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'GitHub repo in "owner/repo" format (e.g. "eefano/strudel-songs-collection")',
          },
          path: {
            type: 'string',
            description: 'File path within the repo (e.g. "strangerthings.js" or "functions/markovchain.js")',
          },
          branch: {
            type: 'string',
            description: 'Branch name (defaults to "main")',
          },
        },
        required: ['repo', 'path'],
      }),
      execute: async ({ repo, path: filePath, branch = 'main' }) => {
        return withTimeout(
          async () => {
            let ownerRepo = repo.replace(/^https?:\/\/github\.com\//, '').replace(/^github:/, '').replace(/\.git$/, '').replace(/\/$/, '');
            // Try main, then master as fallback
            const urls = [
              `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${filePath}`,
            ];
            if (branch === 'main') {
              urls.push(`https://raw.githubusercontent.com/${ownerRepo}/master/${filePath}`);
            }
            for (const url of urls) {
              try {
                const resp = await fetch(url);
                if (resp.ok) {
                  const text = await resp.text();
                  // Truncate very long files to avoid context overflow
                  const MAX = 8000;
                  if (text.length > MAX) {
                    return `${text.slice(0, MAX)}\n\n// ... (truncated, file has ${text.length} chars total)`;
                  }
                  return text;
                }
              } catch {
                // try next URL
              }
            }
            return `Could not fetch "${filePath}" from "${ownerRepo}" (tried ${branch} and master branches). Use browse_repo to verify the file path exists.`;
          },
          TOOL_TIMEOUTS.fetch_example,
          `Timed out fetching "${filePath}" from "${repo}" after ${TOOL_TIMEOUTS.fetch_example / 1000}s. Try again or use browse_repo to verify the file path.`,
        );
      },
    }),
  };
}

// Format GitHub API tree response into a concise file listing
function formatRepoTree(data, ownerRepo, filterPath) {
  if (!data.tree || !Array.isArray(data.tree)) {
    return `No files found in "${ownerRepo}".`;
  }
  // Filter: only .js/.mjs/.md/.json files, optionally by subdirectory
  let files = data.tree.filter((item) => {
    if (item.type !== 'blob') return false;
    const ext = item.path.split('.').pop();
    if (!['js', 'mjs', 'md', 'json'].includes(ext)) return false;
    if (filterPath && !item.path.startsWith(filterPath + '/') && !item.path.startsWith(filterPath)) return false;
    return true;
  });
  if (files.length === 0) {
    return `No matching files found in "${ownerRepo}"${filterPath ? ` under "${filterPath}"` : ''}.`;
  }
  // Sort: .js first (most relevant), then by name
  files.sort((a, b) => {
    const aJs = a.path.endsWith('.js');
    const bJs = b.path.endsWith('.js');
    if (aJs !== bJs) return aJs ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  const MAX = 80;
  const total = files.length;
  const shown = files.slice(0, MAX);
  const lines = shown.map((f) => {
    const size = f.size ? ` (${Math.round(f.size / 1024 * 10) / 10}KB)` : '';
    return `  ${f.path}${size}`;
  });
  const header = total > MAX
    ? `Repository: ${ownerRepo} — ${total} files (showing first ${MAX}):\n`
    : `Repository: ${ownerRepo} — ${total} files:\n`;
  const footer = total > MAX
    ? `\n(showing first ${MAX} of ${total} — use the "path" parameter to filter by subdirectory)`
    : '';
  return `${header}${lines.join('\n')}${footer}\n\nUse fetch_example to read any file above, then adapt it with write_code.`;
}
