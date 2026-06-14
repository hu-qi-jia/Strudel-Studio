// analyzer.mjs — MP3/音频分析引擎（纯 JS，零外部依赖）。
//
// 设计取舍：原计划用 Spotify Basic Pitch（ONNX 多音轨转写），但其依赖链
// （onnxruntime-web WASM + 模型文件托管）在 Vite/Astro 打包与运行期都有显著回归风险
// （WASM 路径、worker 兼容、~10MB+ 资产）。这里先用纯 Web Audio + 手写 FFT 的
// 轻量引擎，覆盖用户选择的「节奏 + 旋律（加音高）」范围，体积 ~1KB、零新依赖、
// 浏览器全兼容。Basic Pitch 仍可作为「升级引擎」在此接口后替换（见 analyzePCM）。
//
// 线程模型（M2 优化）：重计算（toMono + onset 检测 + FFT + token 组装）跑在 Web Worker，
// 不阻塞主线程——这对与主线程共享的 Strudel 实时音频调度器至关重要（否则 ~100ms 的
// 同步分析会让播放抖动/丢拍）。主线程只做 IO（读附件 + decodeAudioData，后者是浏览器
// 原生异步离线解码）+ 各声道零拷贝 transfer。Worker 不可用/崩溃时 fallback 到主线程
// 同步执行 analyzePCM，结果完全一致——降级而非阻塞。
//
// 管线：
//   ctx.audio.decode(buf) → AudioBuffer（不发声音、不切 context，见 ToolContext）
//   → 各声道 copy 成独立 Float32Array → transfer 给 worker
//   → worker 内：mono mixdown（限前 120s，约束内存/耗时）
//     → 能量包络 + 正向通量 → onset 检测（自适应阈值 + 不应期）
//     → onset 间隔直方图 → 估 BPM
//     → onset 量化到「一小节 16 步」网格 → 鼓点骨架（按位置判 bd/sd/hh）
//     → 等间距 16 窗 × FFT 峰值 → 旋律轮廓（音名）
//     → 组装草稿 Strudel pattern：setcpm + $: 鼓 + $: 旋律
//
// 全程不碰 scheduler、不 setAudioContext（任务一修好的实时 context 零回归）。

const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

// 旋律采样窗口：仅取前 MELODY_SPAN_SEC 秒做音高轮廓（约束耗时 + 避免长曲尾部淡出干扰）。
// 该限制会写进返回的 summary，让用户知道旋律只反映片段。
const MELODY_SPAN_SEC = 8;

// MIDI → 音名，如 60 -> "c4"、69 -> "a4"
function midiToName(m) {
  return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

// ─── 原地迭代 radix-2 Cooley–Tukey FFT ───────────────────────
// re/im 长度必须为 2 的幂；变换结果写回 re/im。
function fft(re, im) {
  const n = re.length;
  // 位反转重排
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  // 蝶形运算
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + half];
        const bIm = im[i + k + half];
        const tRe = bRe * curRe - bIm * curIm;
        const tIm = bRe * curIm + bIm * curRe;
        re[i + k] = aRe + tRe;
        im[i + k] = aIm + tIm;
        re[i + k + half] = aRe - tRe;
        im[i + k + half] = aIm - tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

const LOW_HZ = 70; // C2 附近
const HIGH_HZ = 1600; // G6 附近
const FFT_SIZE = 4096; // ~93ms @44.1k，bin 分辨率 ~11Hz

// 取一帧做 FFT，返回频带内最强频率 + 置信度（峰值占频带总能量的比例）。
// 纯音 → 接近 1；噪声/静音 → 很低。
function dominantPitch(samples, start, sampleRate) {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    const idx = start + i;
    const s = idx >= 0 && idx < samples.length ? samples[idx] : 0;
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)); // Hann
    re[i] = s * win;
  }
  fft(re, im);

  const binHz = sampleRate / FFT_SIZE;
  const minBin = Math.max(1, Math.floor(LOW_HZ / binHz));
  const maxBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil(HIGH_HZ / binHz));

  let peakBin = -1;
  let peakMag = -1;
  let total = 0;
  for (let b = minBin; b <= maxBin; b++) {
    const mag = Math.hypot(re[b], im[b]);
    total += mag;
    if (mag > peakMag) {
      peakMag = mag;
      peakBin = b;
    }
  }
  if (peakBin < 0 || total <= 0) return null;

  // 抛物线插值，把峰值频率精炼到亚 bin 精度
  const left = Math.hypot(re[peakBin - 1] || 0, im[peakBin - 1] || 0);
  const right = Math.hypot(re[peakBin + 1] || 0, im[peakBin + 1] || 0);
  const denom = left - 2 * peakMag + right;
  const offset = denom !== 0 ? (0.5 * (left - right)) / denom : 0;
  const freq = (peakBin + offset) * binHz;
  const confidence = peakMag / total; // 0..1
  return { freq, confidence };
}

// 多声道 → 单声道（前 maxSec 秒，约束内存）。
// 输入 channels 是各声道 PCM（TypedArray，由主线程从 AudioBuffer.getChannelData 拷贝而来）。
function toMonoFromChannels(channels, sampleRate, maxSec = 120) {
  const ch = channels.length;
  const len = Math.min(channels[0].length, Math.floor(maxSec * sampleRate));
  const mono = new Float64Array(len);
  for (let c = 0; c < ch; c++) {
    const data = channels[c];
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  if (ch > 1) for (let i = 0; i < len; i++) mono[i] /= ch;
  return mono;
}

// 能量包络 + 正向通量 → onset 检测。自适应阈值 + 不应期（避免同一击中重复触发）。
function detectOnsets(mono, sampleRate) {
  const frame = Math.max(256, Math.floor(sampleRate * 0.02)); // 20ms 窗
  const hop = Math.max(64, Math.floor(frame / 2)); // 10ms 步进
  const points = [];
  for (let i = 0; i + frame < mono.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < frame; j++) sum += mono[i + j] * mono[i + j];
    points.push({ t: i / sampleRate, rms: Math.sqrt(sum / frame), idx: i });
  }
  // 通量 = RMS 正向差分
  const flux = points.map((p, i) =>
    i === 0 ? 0 : Math.max(0, p.rms - points[i - 1].rms),
  );
  const refractory = Math.max(1, Math.floor(0.06 / (hop / sampleRate))); // 60ms 不应期
  const win = Math.max(3, Math.floor(0.5 / (hop / sampleRate))); // ±0.5s 局部均值
  const onsets = [];
  let lastOnsetIdx = -refractory;
  for (let i = 1; i < flux.length - 1; i++) {
    // 局部背景均值：排除中心点 i 自身——阈值应反映「背景通量水平」，
    // 不应把被判点自身的尖峰计入（虽 ±win 范围大、单个点影响很小，但语义更正确）。
    let mean = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(flux.length - 1, i + win); k++) {
      if (k === i) continue;
      mean += flux[k];
      cnt++;
    }
    if (cnt > 0) mean /= cnt;
    const thr = mean * 1.6 + 1e-9;
    const f = flux[i];
    if (f > thr && f >= flux[i - 1] && f >= flux[i + 1] && i - lastOnsetIdx >= refractory) {
      onsets.push({ t: points[i].t, strength: f });
      lastOnsetIdx = i;
    }
  }
  return onsets;
}

// onset 间隔直方图估 BPM：把每个间隔及其 /2、×2 折叠进 60–180 BPM 桶，取众数。
// 折叠会制造「八度减半」歧义（如 0.5s 间隔同时落在 120 与 60 桶，得票并列）；
// 用 >=（平局取更高 BPM）偏向更快的解释——对 dance/electronic 这类 Strudel 主战场，
// 更快的那档通常是人们「跟着拍」的感知速度。八度歧义是 tempo 估计的固有难点，
// 对密集/半拍素材仍可能估偏，文档已注明 best-effort。
function estimateTempo(onsets) {
  if (onsets.length < 3) return 0;
  const bins = new Array(121).fill(0); // 60..180
  for (let i = 1; i < onsets.length; i++) {
    const dt = onsets[i].t - onsets[i - 1].t;
    if (dt <= 0) continue;
    for (const mult of [0.5, 1, 2]) {
      const beat = dt * mult;
      const bpm = 60 / beat;
      const b = Math.round(bpm);
      if (b >= 60 && b <= 180) bins[b - 60] += 1;
    }
  }
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < bins.length; i++) {
    // bins[i] > 0：所有间隔都折叠到 [60,180] 之外时（极稀疏/极密集 onset），
    // bins 全 0 —— 此时返回 0 让 analyzeCore 的 fallback 接管（120 BPM），
    // 而非被 >= 误判成 180。
    // 平局（>=）取更高 BPM：解决八度减半偏向慢速的问题。
    if (bins[i] > 0 && bins[i] >= bestScore) {
      bestScore = bins[i];
      best = i + 60;
    }
  }
  return best;
}

// onset 折叠进一小节（16 步 = 4 拍），累加每步强度。
function onsetGrid(onsets, barSec, steps = 16) {
  const stepDur = barSec / steps;
  const grid = new Array(steps).fill(0);
  for (const o of onsets) {
    const pos = ((o.t % barSec) + barSec) % barSec;
    // 用 round 而非 floor：onset 检测有几~几十 ms 抖动，floor 会把它系统性偏向「上一格」，
    // 导致鼓点错位（如本该落在 beat 的 bd 被挤到前一格变 hh）。round 把抖动吸到最近格。
    let s = Math.round(pos / stepDur);
    if (s >= steps) s = 0; // 末格附近 round 可能到 steps，折回首格
    grid[s] += o.strength;
  }
  return grid;
}

// 按步位置 + onset 存在性生成鼓点 mini-notation。
// 落点判乐器：m8===0 → bd（1/3 拍，底鼓）；m8===4 → sd（2/4 拍，军鼓）；其余 → hh。
function rhythmTokens(grid, steps = 16) {
  const maxStr = Math.max(1e-9, ...grid);
  const out = [];
  for (let i = 0; i < steps; i++) {
    if (grid[i] / maxStr < 0.08) {
      out.push('~');
      continue;
    }
    const m = i % 8;
    out.push(m === 0 ? 'bd' : m === 4 ? 'sd' : 'hh');
  }
  return out.join(' ');
}

// 在前 spanSec 秒内等间距采 16 窗，FFT 峰值 → 音名，得到旋律轮廓。
function melodyTokens(mono, sampleRate, dur, steps = 16, spanSec = MELODY_SPAN_SEC) {
  const span = Math.min(dur, spanSec);
  const tokens = [];
  let lo = 127;
  let hi = -1;
  for (let i = 0; i < steps; i++) {
    const tCenter = ((i + 0.5) / steps) * span;
    const start = Math.floor(tCenter * sampleRate);
    const p = dominantPitch(mono, start, sampleRate);
    if (!p || p.confidence < 0.2) {
      tokens.push('~');
      continue;
    }
    const midi = Math.round(69 + 12 * Math.log2(p.freq / 440));
    if (midi < 24 || midi > 96) {
      tokens.push('~');
      continue;
    }
    tokens.push(midiToName(midi));
    if (midi < lo) lo = midi;
    if (midi > hi) hi = midi;
  }
  return {
    tokens: tokens.join(' '),
    low: lo <= hi ? midiToName(lo) : null,
    high: lo <= hi ? midiToName(hi) : null,
    count: tokens.filter((t) => t !== '~').length,
    avgConfidence: undefined, // 不逐窗保留，省体积
  };
}

// 组装草稿 Strudel pattern。
// 注意：Strudel 用 setcpm()（cycles per minute），不是 setcps()——后者会被
// tools.mjs 的静态校验拦截。一小节 = 4 拍，cpm = bpm/4。
function composePattern({ bpm, rhythm, melody }) {
  const cpm = (bpm / 4).toFixed(2);
  const lines = [
    `// draft pattern derived from your audio (≈ ${Math.round(bpm)} BPM)`,
    `// rhythm & tempo are reliable; melody is best-effort — tweak freely`,
    `setcpm(${cpm}) // ≈ ${Math.round(bpm)} BPM`,
    `$: s("${rhythm}") // rhythm: 16 steps / bar`,
  ];
  if (melody.count > 0) {
    lines.push(`$: note("${melody.tokens}").s("supersaw").release(0.25) // melody contour`);
  }
  return lines.join('\n');
}

/**
 * 纯计算入口：从 PCM 声道数据推导结构化结果。无副作用、无浏览器 API、不碰 ctx，
 * 可在主线程与 Web Worker 中等价执行（worker 不可用时主线程 fallback 调用它）。
 * @param {object} p
 * @param {TypedArray[]} p.channels —— 各声道 PCM（至少 1 个）
 * @param {number} p.sampleRate
 * @param {number} p.durationSec
 * @returns {object} { ok, summary, tempo, durationSec, onsetCount, pitchRange, melodyNoteCount, confidenceNote, draftPattern }
 */
export function analyzePCM({ channels, sampleRate, durationSec }) {
  if (!Array.isArray(channels) || channels.length === 0 || !channels[0]) {
    throw new Error('no channel data');
  }
  const mono = toMonoFromChannels(channels, sampleRate);
  const onsets = detectOnsets(mono, sampleRate);
  let bpm = estimateTempo(onsets);
  if (!bpm || bpm < 60) bpm = 120; // fallback
  const barSec = (4 * 60) / bpm; // 一小节秒数

  const grid = onsetGrid(onsets, barSec);
  const rhythm = rhythmTokens(grid);
  const melody = melodyTokens(mono, sampleRate, durationSec);

  const draftPattern = composePattern({ bpm, rhythm, melody });

  const pitchRange =
    melody.low && melody.high ? { low: melody.low, high: melody.high } : null;
  const spanSec = Math.min(durationSec, MELODY_SPAN_SEC);
  const confidenceNote =
    melody.count === 0
      ? `No confident melodic pitch detected (sampled first ${spanSec.toFixed(0)}s) — the draft has rhythm only. Try a clearer/melodic source.`
      : `${melody.count} pitched notes captured from the first ${spanSec.toFixed(0)}s; melody is monophonic best-effort and may have octave errors on dense material.`;

  const summary =
    `≈ ${Math.round(bpm)} BPM, analyzed ${durationSec.toFixed(1)}s, ` +
    `${onsets.length} onsets. ${confidenceNote} ` +
    `A draft Strudel pattern is in draftPattern — review tempo (setcpm) and sounds, ` +
    `then use write_code to commit it (it will auto-play and validate).`;

  return {
    ok: true,
    summary,
    tempo: { bpm, cpm: +(bpm / 4).toFixed(2) },
    durationSec: +durationSec.toFixed(2),
    onsetCount: onsets.length,
    pitchRange,
    melodyNoteCount: melody.count,
    confidenceNote,
    draftPattern,
  };
}

// ─── Web Worker 客户端（M2）─────────────────────────────────────
// 单例 worker + 请求 id 配对（即便 agent 当前串行调用，也健壮支持并发）。
// worker 创建失败或运行期崩溃 → 永久降级到主线程同步 analyzePCM（结果完全一致）。
let _worker = null;
let _workerFailed = false;
let _nextReqId = 1;
const _pending = new Map();

function getWorker() {
  if (_workerFailed) return null;
  if (_worker) return _worker;
  try {
    const w = new Worker(new URL('./analyzer.worker.mjs', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const { id, result, error } = e.data || {};
      const res = _pending.get(id);
      if (!res) return;
      _pending.delete(id);
      if (error) res.reject(new Error(error));
      else res.resolve(result);
    };
    w.onerror = (ev) => {
      // worker 崩溃：reject 所有在途请求。analyze() 的 catch 会把错误回灌成字符串。
      const msg = ev?.message || 'analyzer worker error';
      for (const res of _pending.values()) res.reject(new Error(msg));
      _pending.clear();
      _workerFailed = true; // 永久降级：避免反复尝试一个坏 worker
      _worker = null;
    };
    _worker = w;
    return w;
  } catch (e) {
    // 不支持 module worker 等环境：降级到主线程同步执行
    _workerFailed = true;
    return null;
  }
}

async function runInWorker(payload, transferList) {
  const w = getWorker();
  if (!w) {
    // fallback：主线程同步执行（结果与 worker 完全一致，只是会短暂阻塞）
    return analyzePCM(payload);
  }
  const id = _nextReqId++;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    w.postMessage({ id, ...payload }, transferList);
  });
}

// 对外入口：主线程 IO（读附件 + 解码）→ 投递 worker 跑分析 → 返回结构化结果。
// 捕获全链路错误，统一回灌为「错误字符串」（而非抛出）：抛出会被 AI SDK 当 tool error
// 处理，invocation 卡在 call 态；返回字符串则 resultData 为 undefined，ChatMessage 回退
// ToolCallBadge 干净展示，且模型能读到它自纠正。
export async function analyze(handleId, ctx) {
  try {
    if (!ctx?.attachments?.read) throw new Error('attachments:read capability not granted');
    if (!ctx?.audio?.decode) throw new Error('audio:decode capability not granted');

    const buf = await ctx.attachments.read(handleId); // ArrayBuffer
    const audioBuf = await ctx.audio.decode(buf); // AudioBuffer（不发声）
    const sampleRate = audioBuf.sampleRate;
    const durationSec = audioBuf.duration;
    const numChannels = audioBuf.numberOfChannels;

    // 各声道 copy 成独立 Float32Array 再 transfer：AudioBuffer 的多通道在实现上可能共享
    // 同一底层 ArrayBuffer（不同 byteOffset 的 view），直接 transfer 多次同一 buffer 会抛错。
    // copy 后每个通道都是独立 buffer，可安全零拷贝 transfer 给 worker。
    const channels = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(new Float32Array(audioBuf.getChannelData(c)));
    }
    const transferList = channels.map((c) => c.buffer);

    return await runInWorker({ channels, sampleRate, durationSec }, transferList);
  } catch (e) {
    return `analyze_audio failed: ${e?.message || e}`;
  }
}
