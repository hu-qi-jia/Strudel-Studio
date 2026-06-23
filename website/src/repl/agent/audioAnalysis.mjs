// audioAnalysis.mjs — 渲染后音频的 DSP 分析（纯模块，零依赖，可 node 单测）。
//
// 为什么独立成模块：这是「agent 的本地 DSP 耳朵」。静态分析(arrangementCheck)能看出编排
// 结构好不好，但听不出：是否削波、低频是否糊成一团、是否太闷/太刺、动态是否被压死、
// 是否根本没出声。这些只能从实际渲染波形测。接收集Float32Array[]（每声道一段）+
// sampleRate，不依赖 AudioBuffer（便于 node 单测），由 tools.mjs 的 analyze_pattern_audio 从
// OfflineAudioContext 渲染产物里取声道数据喂进来。
//
// 不做任何主观「好听」判断（那是多模态模型的事），只给可测量的物理特征 + 阈值化建议。

// 迭代式 Cooley-Tukey 基-2 FFT，原地变换 re/im（长度须为 2 的幂）。
function fftRadix2(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * cr - im[i + k + half] * ci;
        const vi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// 三频能量（Hann 窗 FFT，取信号中段代表性片段）：低<250Hz / 中 250-4000 / 高>4000。
function bandEnergies(mono, sampleRate) {
  const cap = 1 << 16; // 65536 点，足够分辨到 ~低频
  let n = Math.min(mono.length, cap);
  let p = 1;
  while ((p << 1) <= n) p <<= 1;
  n = p; // 最大 2 的幂 ≤ 可用长度
  if (n < 16) return { low: 0, mid: 0, high: 0 };
  const start = Math.max(0, Math.floor((mono.length - n) / 2));
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))); // Hann
    re[i] = mono[start + i] * w;
  }
  fftRadix2(re, im);
  let low = 0;
  let mid = 0;
  let high = 0;
  const lowEdge = 250;
  const midEdge = 4000;
  for (let k = 1; k < n >> 1; k++) {
    const f = (k * sampleRate) / n;
    const mag = re[k] * re[k] + im[k] * im[k];
    if (f < lowEdge) low += mag;
    else if (f < midEdge) mid += mag;
    else high += mag;
  }
  return { low, mid, high };
}

// 立体声相关度（-1..1）：两声道相似度。接近 1 = 很 mono/窄；接近 0 = 宽；负 = 反相。
function stereoCorrelation(ch0, ch1) {
  const n = Math.min(ch0.length, ch1.length);
  if (n === 0) return null;
  let sumXY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumXY += ch0[i] * ch1[i];
    sumX2 += ch0[i] * ch0[i];
    sumY2 += ch1[i] * ch1[i];
  }
  const denom = Math.sqrt(sumX2 * sumY2);
  return denom > 1e-12 ? sumXY / denom : null;
}

function mixDown(channels) {
  const n = channels[0].length;
  const out = new Float32Array(n);
  const c = channels.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let ch = 0; ch < c; ch++) s += channels[ch][i];
    out[i] = s / c;
  }
  return out;
}

/**
 * 分析渲染后的音频。
 * @param {Float32Array[]} channels - 每声道一个 Float32Array
 * @param {number} sampleRate
 * @returns {object} 峰值/响度/动态/三频/立体/静音等测量 + findings + summary
 */
export function analyzeRenderedAudio(channels, sampleRate) {
  if (!channels || channels.length === 0 || !channels[0] || channels[0].length === 0) {
    return { ok: false, summary: 'Empty audio buffer — nothing was rendered.', findings: [] };
  }
  const n = channels[0].length;
  const mono = channels.length > 1 ? mixDown(channels) : channels[0];

  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipSamples = 0;
  for (let i = 0; i < n; i++) {
    const s = mono[i];
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
    if (a >= 0.99) clipSamples++;
    sumSq += s * s;
    sum += s;
  }
  const rms = Math.sqrt(sumSq / n);
  const dc = sum / n;
  const crest = rms > 1e-7 ? peak / rms : 0;
  const crestDb = 20 * Math.log10(crest || 1e-7);
  const clipping = peak >= 0.985 || clipSamples > 64;
  const peakDb = 20 * Math.log10(peak || 1e-7);
  const rmsDb = 20 * Math.log10(rms || 1e-7);

  // 响度动态：~300ms 窗 RMS 的 max/min（dB 跨度）。越大越有起伏。
  const win = Math.max(1, Math.floor((sampleRate || 44100) * 0.3));
  let lrMin = Infinity;
  let lrMax = 0;
  for (let i = 0; i + win <= n; i += win) {
    let s2 = 0;
    for (let j = 0; j < win; j++) s2 += mono[i + j] * mono[i + j];
    const r = Math.sqrt(s2 / win);
    if (r > 1e-7) {
      if (r < lrMin) lrMin = r;
      if (r > lrMax) lrMax = r;
    }
  }
  const loudnessRangeDb =
    lrMax > 1e-7 && lrMin < Infinity ? 20 * Math.log10(lrMax / Math.max(lrMin, 1e-7)) : 0;

  // 三频平衡
  const e = bandEnergies(mono, sampleRate || 44100);
  const tot = e.low + e.mid + e.high || 1;
  const ratios = { low: e.low / tot, mid: e.mid / tot, high: e.high / tot };

  // 立体声宽度
  let correlation = null;
  if (channels.length > 1) correlation = stereoCorrelation(channels[0], channels[1]);

  const findings = [];

  if (rms < 1e-4) {
    findings.push({
      severity: 'critical',
      area: 'silence',
      message: 'The rendered audio is essentially silent.',
      suggestion:
        'No audible output. A sound name probably failed to load (dead sample) or a .mask/.gain silenced everything. Swap to a synth voice (.s("sine")) or remove the mute and re-render.',
    });
  } else {
    if (clipping) {
      findings.push({
        severity: 'high',
        area: 'clipping',
        message: `Output clips (peak ${peak.toFixed(3)}, ${clipSamples} samples at full scale).`,
        suggestion:
          'Reduce overall level: lower .gain() on the loudest tracks, or add .compressor(0.5) / a master .gain(0.8). Aim peak < ~0.95.',
      });
    }
    if (rms > 0.01 && crestDb < 6) {
      findings.push({
        severity: 'medium',
        area: 'dynamics',
        message: `Low crest factor (${crestDb.toFixed(1)} dB) — the mix is loud but dynamically squashed.`,
        suggestion:
          'Let it breathe: increase velocity variation (.gain with multiple values), leave more rests (~), and back off compression/overall gain.',
      });
    }
    if (ratios.low > 0.6) {
      findings.push({
        severity: 'medium',
        area: 'lowend',
        message: `Low end dominates (${Math.round(ratios.low * 100)}% of spectral energy) — muddy/boomy.`,
        suggestion:
          'High-pass the non-bass tracks (.hpf(120)) and keep only kick/bass in the lows. Consider .lpf on the bass to tighten it.',
      });
    }
    if (ratios.high < 0.05 && rms > 0.005) {
      findings.push({
        severity: 'low',
        area: 'highend',
        message: `Very little high-frequency energy (${Math.round(ratios.high * 100)}%) — dull, lacks air.`,
        suggestion:
          'Add brighter elements: hats/percussion (s("hh*8")), or open a filter (.lpf(8000)) on leads.',
      });
    }
    if (ratios.mid > 0.78 && rms > 0.005) {
      findings.push({
        severity: 'low',
        area: 'mids',
        message: `Mids dominate heavily (${Math.round(ratios.mid * 100)}%) — can sound honky/nasal.`,
        suggestion:
          'Spread energy: add lows (bass/kick) and highs (hats/air) so the spectrum is more balanced.',
      });
    }
    if (loudnessRangeDb < 1.5 && rms > 0.005) {
      findings.push({
        severity: 'low',
        area: 'loudness',
        message: `Loudness is near-constant (range ${loudnessRangeDb.toFixed(1)} dB) — static, no ebb/flow.`,
        suggestion:
          'Introduce dynamics over time: automate gain (.gain with a signal), or vary density per section so energy rises and falls.',
      });
    }
    if (correlation !== null && correlation > 0.98) {
      findings.push({
        severity: 'low',
        area: 'stereo',
        message: `Channels are near-identical (correlation ${correlation.toFixed(2)}) — very mono/narrow.`,
        suggestion:
          'Widen supporting layers: .jux(x => x.late(0.01)) or .pan("<0.3 0.7>") on hats/pads; keep kick/bass centered.',
      });
    }
  }

  const problems = findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
  let summary;
  if (findings.length === 0) {
    summary = `Audio OK — peak ${peak.toFixed(2)} (${peakDb.toFixed(1)} dB), RMS ${rms.toFixed(3)} (${rmsDb.toFixed(1)} dB), balanced spectrum, no clipping.`;
  } else if (problems > 0) {
    summary = `Audio has ${problems} major issue(s): ${findings
      .filter((f) => f.severity === 'critical' || f.severity === 'high')
      .map((f) => f.area)
      .join(', ')}. Fix before finishing.`;
  } else {
    summary = `Audio is acceptable (peak ${peak.toFixed(2)}, RMS ${rms.toFixed(3)}) with minor notes: ${findings
      .map((f) => f.area)
      .join(', ')}.`;
  }

  return {
    ok: true,
    metrics: {
      peak,
      peakDb,
      rms,
      rmsDb,
      crestDb,
      clipping,
      clipSamples,
      dcOffset: dc,
      loudnessRangeDb,
      bandRatios: ratios,
      stereoCorrelation: correlation,
      samples: n,
      sampleRate,
    },
    findings,
    summary,
  };
}
