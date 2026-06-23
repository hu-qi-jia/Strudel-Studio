// arrangementCheck.mjs — 编排质量的静态分析（纯模块，零依赖，可 node 单测）。
//
// 为什么独立成模块：这是「agent 能不能自我评判其作品编排好坏」的核心逻辑，与
// audioAnalysis.mjs（DSP 耳朵）一起构成「听觉反馈回路」的判定面。抽成纯函数便于
// 用普通 node 跑各种 pattern 覆盖（tools.mjs 因依赖 codemirror/webaudio 在 node 下
// 无法 import）。
//
// 判定维度与 MUSICALITY_SECTION / ARRANGEMENT_TOOLKIT 的质量标准一一对应：
// 分层(layers) · 力度变化(velocity) · 空间分离(pan) · 效果空间(room/delay) ·
// 宏观曲式(form) · 信号自动化(automation) · 速度设定(tempo)。
// 每个维度给出「通过/未通过」+ 具体 Strudel 改进建议，供模型据此迭代。
//
// 注意：这是「锦上添花」的启发式静态扫描，不是安全护栏（那是 codeGuard.mjs 的职责）。
// 误判方向偏好「提醒可改进」而非「硬拦」。直接扫源码（注释里几乎不会出现 .gain( 这类调用形态）。

const SIGNAL_SOURCES = '(?:sine|tri|triangle|cosine|perlin|rand|saw|square)';

// 统计并行声部数（近似）：$:/_$: 前缀行 + stack() 隐含多声部。
function countTracks(src) {
  const matches = src.match(/^\s*_?\$:\s*\S/mg) || [];
  let tracks = matches.length;
  if (tracks === 0 && /\bstack\s*\(/.test(src)) tracks = 2; // 无 $: 但有 stack → 至少 2 声部
  if (tracks === 0 && /\b(?:note|s|n|freq|chord)\s*\(/.test(src)) tracks = 1; // 单 pattern
  return tracks;
}

// 力度是否有变化：.gain("a b")（字符串内含空白或 <>）或 .gain(signalSource)（信号驱动）。
function hasVariedGain(src) {
  const strVar = /\.gain\s*\(\s*"(?:[^"]*\s[^"]*|<[^"]*>[^"]*)"/; // 字符串里含空白或 <>
  const sigVar = new RegExp(`\\.gain\\s*\\(\\s*${SIGNAL_SOURCES}\\b`);
  return strVar.test(src) || sigVar.test(src);
}

// 信号自动化：存在「裸信号源 + .range/.segment 整形」即判定。信号几乎总是被 .range/.segment
// 整形后才用，且常以链式出现（perlin.slow(2).range(...) / cosine.segment(16).range(...)），
// 故分别检测两者同时出现，而非要求 .range 紧跟信号源（会漏判链式调用）。
function hasAutomation(src) {
  const hasSignal = new RegExp(`(?:^|[^\\w.])(?:${SIGNAL_SOURCES})\\b`).test(src);
  const hasShape = /\.range\s*\(|\.segment\s*\(/.test(src);
  return hasSignal && hasShape;
}

// 宏观曲式：@N 保持、cat/slowcat/timeCat、pickRestart、mask、every（随时间变化段落）。
function hasMacroForm(src) {
  return /@\d+|\bcat\s*\(|\bslowcat\s*\(|\btimeCat\s*\(|\.pickRestart\s*\(|\.mask\s*\(|\.every\s*\(/.test(
    src,
  );
}

/**
 * 静态分析一段 Strudel 代码的编排质量。
 * @param {string} code
 * @returns {{ score:number, dimensions:Object, passed:string[], failed:string[],
 *            findings:Array<{severity,area,message,suggestion}>, summary:string }}
 */
export function analyzeArrangement(code) {
  const src = typeof code === 'string' ? code : '';

  const trackCount = countTracks(src);
  const dimensions = {
    layers: trackCount >= 2,
    velocity: hasVariedGain(src),
    spatial: /\.pan\s*\(|\.jux\s*\(|\.bjux\s*\(/.test(src),
    space: /\.room\s*\(|\.size\s*\(|\.delay\s*\(/.test(src),
    form: hasMacroForm(src),
    automation: hasAutomation(src),
    tempo: /setcpm\s*\(|setcps\s*\(|\.cpm\s*\(/.test(src),
  };

  const SUGGEST = {
    layers:
      'Layer 2-4 tracks with distinct roles via stack(...) or $: prefixes — e.g. kick, hats, clap, bass. A single track is thin.',
    velocity:
      'Vary loudness so the groove breathes: .gain("1 0.8 0.9 0.7") or .gain("<0.5 0.9>"). Flat identical-velocity hits sound robotic.',
    spatial:
      'Pan/spread layers apart: .jux(x => x.late(0.01)) on hats/claps, .pan("<0.3 0.7>") on supporting parts. Keep kick/bass centered.',
    space:
      'Add space to supporting layers: .room(0.4).size(0.8) or .delay(0.3).delaytime(0.25). Keep kick/bass relatively dry.',
    form:
      'Build macro form so the track evolves, not one bar looped forever: "<intro@8 verse@8 chorus@8>" (@N holds each section N cycles), or cat(intro, verse, chorus), or drop a part with .mask("<~@4 1@8>").',
    automation:
      'Drive a sustained layer with a moving signal so the track breathes: .lpf(perlin.slow(2).range(100,2000)) or .gain(cosine.range(0.5,1).slow(8)). A dead-constant parameter sounds lifeless.',
    tempo:
      'Set tempo from BPM: setcpm(124/4) (= 124 BPM) at the top, or .cpm(124/4) on a stack. Never write bare setcps(124) (that is cycles/second).',
  };

  const findings = [];
  const highWeight = ['layers', 'form'];
  const order = ['layers', 'velocity', 'spatial', 'space', 'form', 'automation', 'tempo'];
  for (const key of order) {
    if (dimensions[key]) continue;
    findings.push({
      severity: highWeight.includes(key) ? 'high' : 'medium',
      area: key,
      message: AREA_MESSAGE[key] || `${key} missing`,
      suggestion: SUGGEST[key] || '',
    });
  }

  const passed = order.filter((k) => dimensions[k]);
  const failed = order.filter((k) => !dimensions[k]);
  const score = Math.round((passed.length / order.length) * 100);

  const summary = failed.length
    ? `${score}/100 arrangement quality. Missing: ${failed.join(', ')}. Address the findings below and re-run analyze_arrangement before declaring the track done.`
    : `${score}/100 arrangement quality — all core dimensions present (layers, velocity, spatial, space, form, automation, tempo).`;

  return { score, trackCount, dimensions, passed, failed, findings, summary };
}

const AREA_MESSAGE = {
  layers: 'Only one track detected — the piece is thin and monochrome',
  velocity: 'No velocity variation detected — every hit is equally loud',
  spatial: 'No panning/stereo separation — everything is dead-center',
  space: 'No reverb/delay space — the mix is dry and flat',
  form: 'No macro form detected — one bar loops forever with no sections',
  automation: 'No moving parameters — sustained layers hold dead-constant values',
  tempo: 'No explicit tempo — playing at the default speed',
};
