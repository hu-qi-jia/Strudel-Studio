import { noteToMidi, valueToMidi, getSoundIndex } from './util.mjs';
import { getAudioContext, registerSound } from './index.mjs';
import { getADSRValues, getParamADSR, getPitchEnvelope, getVibratoOscillator } from './helpers.mjs';
import { logger } from './logger.mjs';

const bufferCache = {}; // string: Promise<ArrayBuffer>
const loadCache = {}; // string: Promise<ArrayBuffer>

export const getCachedBuffer = (url) => bufferCache[url];

// 清除采样缓存（导出后 AudioContext 变化时需要重新解码）
export const resetSampleCache = () => {
  Object.keys(bufferCache).forEach((k) => delete bufferCache[k]);
  Object.keys(loadCache).forEach((k) => delete loadCache[k]);
};

function humanFileSize(bytes, si) {
  var thresh = si ? 1000 : 1024;
  if (bytes < thresh) return bytes + ' B';
  var units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  var u = -1;
  do {
    bytes /= thresh;
    ++u;
  } while (bytes >= thresh);
  return bytes.toFixed(1) + ' ' + units[u];
}

// deduces relevant info for sample loading from hap.value and sample definition
// it encapsulates the core sampler logic into a pure and synchronous function
// hapValue: Hap.value, bank: sample bank definition for sound "s" (values in strudel.json format)
export function getSampleInfo(hapValue, bank) {
  const { s, n = 0, speed = 1.0 } = hapValue;
  let midi = valueToMidi(hapValue, 36);
  let transpose = midi - 36; // C3 is middle C;
  let sampleUrl;
  let index = 0;
  if (Array.isArray(bank)) {
    index = getSoundIndex(n, bank.length);
    sampleUrl = bank[index];
  } else {
    const midiDiff = (noteA) => noteToMidi(noteA) - midi;
    // object format will expect keys as notes
    const closest = Object.keys(bank)
      .filter((k) => !k.startsWith('_'))
      .reduce(
        (closest, key, j) => (!closest || Math.abs(midiDiff(key)) < Math.abs(midiDiff(closest)) ? key : closest),
        null,
      );
    transpose = -midiDiff(closest); // semitones to repitch
    index = getSoundIndex(n, bank[closest].length);
    sampleUrl = bank[closest][index];
  }
  const label = `${s}:${index}`;
  let playbackRate = Math.abs(speed) * Math.pow(2, transpose / 12);
  return { transpose, sampleUrl, index, midi, label, playbackRate };
}

// takes hapValue and returns buffer + playbackRate.
export const getSampleBuffer = async (hapValue, bank, resolveUrl) => {
  let { sampleUrl, label, playbackRate } = getSampleInfo(hapValue, bank);
  if (resolveUrl) {
    sampleUrl = await resolveUrl(sampleUrl);
  }
  const ac = getAudioContext();
  const buffer = await loadBuffer(sampleUrl, ac, label);

  if (hapValue.unit === 'c') {
    playbackRate = playbackRate * buffer.duration;
  }
  return { buffer, playbackRate };
};

// creates playback ready AudioBufferSourceNode from hapValue
export const getSampleBufferSource = async (hapValue, bank, resolveUrl) => {
  let { buffer, playbackRate } = await getSampleBuffer(hapValue, bank, resolveUrl);
  if (hapValue.speed < 0) {
    // should this be cached?
    buffer = reverseBuffer(buffer);
  }
  const ac = getAudioContext();
  const bufferSource = ac.createBufferSource();
  bufferSource.buffer = buffer;
  bufferSource.playbackRate.value = playbackRate;

  const { s, loopBegin = 0, loopEnd = 1, begin = 0, end = 1 } = hapValue;

  // "The computation of the offset into the sound is performed using the sound buffer's natural sample rate,
  // rather than the current playback rate, so even if the sound is playing at twice its normal speed,
  // the midway point through a 10-second audio buffer is still 5."
  const offset = begin * bufferSource.buffer.duration;

  const loop = s.startsWith('wt_') ? 1 : hapValue.loop;
  if (loop) {
    bufferSource.loop = true;
    bufferSource.loopStart = loopBegin * bufferSource.buffer.duration - offset;
    bufferSource.loopEnd = loopEnd * bufferSource.buffer.duration - offset;
  }
  const bufferDuration = bufferSource.buffer.duration / bufferSource.playbackRate.value;
  const sliceDuration = (end - begin) * bufferDuration;
  return { bufferSource, offset, bufferDuration, sliceDuration };
};

// Rewrite raw.githubusercontent.com URLs to the jsDelivr CDN mirror.
// Why: sample manifests (e.g. tidal-drum-machines.json) hardcode a `_base` that
// points their .wav buffers back at raw.githubusercontent.com, which is origin-only
// (no CDN) and throttled/unreachable on many networks (notably mainland China).
// jsDelivr edge-caches the same public GitHub files and is far faster.
// Format: raw.githubusercontent.com/USER/REPO/REF/path -> cdn.jsdelivr.net/gh/USER/REPO@REF/path
function toCdnUrl(url) {
  const m = url.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/,
  );
  return m ? `https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}/${m[4]}` : url;
}

// 是否为"永久性"加载错误——重试也不会变好的那种（4xx，但排除 408 超时 / 429 限流）。
// 典型例子：jsDelivr 对 >50MB 的仓库（如 ritchse/tidal-drum-machines、tidalcycles/Dirt-Samples）
// 一律返回 403 "Package size exceeded"。这类错误每 cycle 重试毫无意义，只会刷日志、浪费请求。
// 网络中断（TypeError: Failed to fetch）/ 5xx / 408 / 429 则是暂时性的，应当允许立即重试。
function isPermanentError(err) {
  const m = err && err.message && err.message.match(/^HTTP (\d{3}) /);
  if (!m) return false; // 非 HTTP 错误（网络层）→ 视为暂时，允许重试
  const status = Number(m[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export const loadBuffer = (url, ac, s, n = 0) => {
  const label = s ? `sound "${s}:${n}"` : 'sample';
  url = url.replace('#', '%23');
  // 永久性错误最多每隔这段时间重试一次，期间直接复用已缓存的失败结果，
  // 避免每个调度 cycle 都重新 fetch（刷屏 + 拖慢播放 + 可能加剧 CDN 限流）。
  const PERMANENT_FAIL_TTL = 60_000;
  const cached = loadCache[url];
  if (cached && (!cached.permanentFailAt || Date.now() - cached.permanentFailAt < PERMANENT_FAIL_TTL)) {
    // 命中缓存：成功的加载，或尚未过期的永久性失败，都直接复用。
    return cached.promise;
  }
  // 否则（未缓存，或永久性失败已过 TTL）→ 重新 fetch。
  logger(`[sampler] load ${label}..`, 'load-sample', { url });
  const timestamp = Date.now();
  // Try the CDN mirror first; fall back to the original URL if it fails
  // (network error / 404 / jsDelivr not yet indexed) so loading never breaks.
  const cdnUrl = toCdnUrl(url);
  const fetchArrayBuffer = (u) =>
    fetch(u).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${u}`);
      return res.arrayBuffer();
    });
  const attempt = cdnUrl === url ? fetchArrayBuffer(url) : fetchArrayBuffer(cdnUrl).catch(() => fetchArrayBuffer(url));
  const entry = { promise: undefined, permanentFailAt: null };
  entry.promise = attempt
    .then(async (res) => {
      const took = Date.now() - timestamp;
      const size = humanFileSize(res.byteLength);
      // const downSpeed = humanFileSize(res.byteLength / took);
      logger(`[sampler] load ${label}... done! loaded ${size} in ${took}ms`, 'loaded-sample', { url });
      const decoded = await ac.decodeAudioData(res);
      bufferCache[url] = decoded;
      return decoded;
    })
    .catch((err) => {
      if (isPermanentError(err)) {
        // 永久性错误：保留缓存条目并打上时间戳，TTL 内不再重复 fetch（但仍会向上抛出，
        // 配合 errorLogger 的去重，日志里同一条错误只出现一次）。
        entry.permanentFailAt = Date.now();
      } else {
        // 暂时性错误：清除缓存，让下一个触发立即重试（可能网络已恢复）。
        delete loadCache[url];
      }
      throw err;
    });
  loadCache[url] = entry;
  return entry.promise;
};

export function reverseBuffer(buffer) {
  const ac = getAudioContext();
  const reversed = ac.createBuffer(buffer.numberOfChannels, buffer.length, ac.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    reversed.copyToChannel(buffer.getChannelData(channel).slice().reverse(), channel, channel);
  }
  return reversed;
}

export const getLoadedBuffer = (url) => {
  return bufferCache[url];
};

function resolveSpecialPaths(base) {
  if (base.startsWith('bubo:')) {
    const [_, repo] = base.split(':');
    base = `github:Bubobubobubobubo/dough-${repo}`;
  }
  return base;
}

function githubPath(base, subpath = '') {
  if (!base.startsWith('github:')) {
    throw new Error('expected "github:" at the start of pseudoUrl');
  }
  let [_, path] = base.split('github:');
  path = path.endsWith('/') ? path.slice(0, -1) : path;
  const parts = path.split('/');
  let user, repo, ref;
  if (parts.length === 2) {
    // assume main as default branch if none set
    [user, repo] = parts;
    ref = 'main';
  } else {
    [user, repo, ref] = parts;
  }
  // Route through the jsDelivr CDN mirror instead of raw.githubusercontent.com.
  // raw.* is origin-only (no CDN) and is throttled / frequently unreachable on
  // many networks (notably mainland China), which made every sample manifest and
  // .wav buffer load slowly. jsDelivr edge-caches the same GitHub files and is
  // far faster + more reachable. Format: cdn.jsdelivr.net/gh/user/repo@ref/path
  return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${ref}/${subpath}`;
}

export const processSampleMap = (sampleMap, fn, baseUrl = sampleMap._base || '') => {
  return Object.entries(sampleMap).forEach(([key, value]) => {
    if (typeof value === 'string') {
      value = [value];
    }
    if (typeof value !== 'object') {
      throw new Error('wrong sample map format for ' + key);
    }
    baseUrl = value._base || baseUrl;
    baseUrl = resolveSpecialPaths(baseUrl);
    if (baseUrl.startsWith('github:')) {
      baseUrl = githubPath(baseUrl, '');
    }
    const fullUrl = (v) => baseUrl + v;
    if (Array.isArray(value)) {
      //return [key, value.map(replaceUrl)];
      value = value.map(fullUrl);
    } else {
      // must be object
      value = Object.fromEntries(
        Object.entries(value).map(([note, samples]) => {
          return [note, (typeof samples === 'string' ? [samples] : samples).map(fullUrl)];
        }),
      );
    }
    fn(key, value);
  });
};

// allows adding a custom url prefix handler
// for example, it is used by the desktop app to load samples starting with '~/music'
let resourcePrefixHandlers = {};
export function registerSamplesPrefix(prefix, resolve) {
  resourcePrefixHandlers[prefix] = resolve;
}
// finds a prefix handler for the given url (if any)
function getSamplesPrefixHandler(url) {
  const handler = Object.entries(resourcePrefixHandlers).find(([key]) => url.startsWith(key));
  if (handler) {
    return handler[1];
  }
  return;
}

/**
 * Loads a collection of samples to use with `s`
 * @example
 * samples('github:tidalcycles/dirt-samples');
 * s("[bd ~]*2, [~ hh]*2, ~ sd")
 * @example
 * samples({
 *  bd: '808bd/BD0000.WAV',
 *  sd: '808sd/SD0010.WAV'
 *  }, 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/');
 * s("[bd ~]*2, [~ hh]*2, ~ sd")
 * @example
 * samples('shabda:noise,chimp:2')
 * s("noise <chimp:0*2 chimp:1>")
 * @example
 * samples('shabda/speech/fr-FR/f:chocolat')
 * s("chocolat*4")
 */

export const samples = async (sampleMap, baseUrl = sampleMap._base || '', options = {}) => {
  if (typeof sampleMap === 'string') {
    // check if custom prefix handler
    const handler = getSamplesPrefixHandler(sampleMap);
    if (handler) {
      return handler(sampleMap);
    }
    sampleMap = resolveSpecialPaths(sampleMap);
    if (sampleMap.startsWith('github:')) {
      sampleMap = githubPath(sampleMap, 'strudel.json');
    }
    if (sampleMap.startsWith('local:')) {
      sampleMap = `http://localhost:5432`;
    }
    if (sampleMap.startsWith('shabda:')) {
      let [_, path] = sampleMap.split('shabda:');
      sampleMap = `https://shabda.ndre.gr/${path}.json?strudel=1`;
    }
    if (sampleMap.startsWith('shabda/speech')) {
      let [_, path] = sampleMap.split('shabda/speech');
      path = path.startsWith('/') ? path.substring(1) : path;
      let [params, words] = path.split(':');
      let gender = 'f';
      let language = 'en-GB';
      if (params) {
        [language, gender] = params.split('/');
      }
      sampleMap = `https://shabda.ndre.gr/speech/${words}.json?gender=${gender}&language=${language}&strudel=1'`;
    }
    if (typeof fetch !== 'function') {
      // not a browser
      return;
    }
    const base = sampleMap.split('/').slice(0, -1).join('/');
    if (typeof fetch === 'undefined') {
      // skip fetch when in node / testing
      return;
    }
    return fetch(sampleMap)
      .then((res) => res.json())
      .then((json) => samples(json, baseUrl || json._base || base, options))
      .catch((error) => {
        console.error(error);
        throw new Error(`error loading "${sampleMap}"`);
      });
  }
  const { prebake, tag } = options;
  processSampleMap(
    sampleMap,
    (key, bank) =>
      registerSound(key, (t, hapValue, onended) => onTriggerSample(t, hapValue, onended, bank), {
        type: 'sample',
        samples: bank,
        baseUrl,
        prebake,
        tag,
      }),
    baseUrl,
  );
};

const cutGroups = [];

export async function onTriggerSample(t, value, onended, bank, resolveUrl) {
  let {
    s,
    nudge = 0, // TODO: is this in seconds?
    cut,
    loop,
    clip = undefined, // if set, samples will be cut off when the hap ends
    n = 0,
    speed = 1, // sample playback speed
    duration,
  } = value;

  // load sample
  if (speed === 0) {
    // no playback
    return;
  }
  const ac = getAudioContext();

  // destructure adsr here, because the default should be different for synths and samples
  let [attack, decay, sustain, release] = getADSRValues([value.attack, value.decay, value.sustain, value.release]);

  const { bufferSource, sliceDuration, offset } = await getSampleBufferSource(value, bank, resolveUrl);

  // asny stuff above took too long?
  if (ac.currentTime > t) {
    logger(`[sampler] still loading sound "${s}:${n}"`, 'highlight');
    // console.warn('sample still loading:', s, n);
    return;
  }
  if (!bufferSource) {
    logger(`[sampler] could not load "${s}:${n}"`, 'error');
    return;
  }

  // vibrato
  let vibratoOscillator = getVibratoOscillator(bufferSource.detune, value, t);

  const time = t + nudge;
  bufferSource.start(time, offset);

  const envGain = ac.createGain();
  const node = bufferSource.connect(envGain);

  // if none of these controls is set, the duration of the sound will be set to the duration of the sample slice
  if (clip == null && loop == null && value.release == null) {
    duration = sliceDuration;
  }
  let holdEnd = t + duration;

  getParamADSR(node.gain, attack, decay, sustain, release, 0, 1, t, holdEnd, 'linear');

  // pitch envelope
  getPitchEnvelope(bufferSource.detune, value, t, holdEnd);

  const out = ac.createGain(); // we need a separate gain for the cutgroups because firefox...
  node.connect(out);
  bufferSource.onended = function () {
    bufferSource.disconnect();
    vibratoOscillator?.stop();
    node.disconnect();
    out.disconnect();
    onended();
  };
  let envEnd = holdEnd + release + 0.01;
  bufferSource.stop(envEnd);
  const stop = (endTime) => {
    bufferSource.stop(endTime);
  };
  const handle = { node: out, bufferSource, stop };

  // cut groups
  if (cut !== undefined) {
    const prev = cutGroups[cut];
    if (prev) {
      prev.node.gain.setValueAtTime(1, time);
      prev.node.gain.linearRampToValueAtTime(0, time + 0.01);
    }
    cutGroups[cut] = handle;
  }

  return handle;
}
