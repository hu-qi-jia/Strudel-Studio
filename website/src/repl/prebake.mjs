import { Pattern, noteToMidi, valueToMidi } from '@strudel/core';
import { aliasBank, registerSynthSounds, registerZZFXSounds, samples, registerSamplesPrefix } from '@strudel/webaudio';
import { registerSamplesFromDB } from './idbutils.mjs';
import './piano.mjs';
import './files.mjs';

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

// ─── 本地采样库 ──────────────────────────────────────────────
// dirt-samples / tidal-drum-machines / uzu-drumkit / mridangam 的原始 GitHub
// 仓库过大（>50MB），jsDelivr 返回 403 "Package size exceeded"；
// raw.githubusercontent.com 在国内不可达。因此用脚本预下载到
// public/samples/<lib>/ 下，manifest 的 _base 指向本地路径，零外部依赖。
// 下载脚本：scripts/download-samples.mjs, scripts/download-extra-samples.mjs
registerSamplesPrefix('github:tidalcycles/dirt-samples', async () => {
  return samples(`${baseNoTrailing}/dirt-samples.json`);
});

export async function prebake() {
  await Promise.all([
    // ── 合成器音色（内置，无外部依赖）──
    registerSynthSounds(),
    registerZZFXSounds(),
    registerSamplesFromDB(),
    import('@strudel/soundfonts').then(({ registerSoundfonts }) => registerSoundfonts()),

    // ── 本地采样库（已预下载到 public/samples/，零外部依赖）──
    // piano: Salamander Grand Piano V3, CC-by, Alexander Holm
    samples(`${baseNoTrailing}/piano.json`, undefined, { prebake: true }),
    // tidal-drum-machines: 72 鼓机, 2595 WAV（ritchse/tidal-drum-machines）
    samples(`${baseNoTrailing}/tidal-drum-machines.json`, undefined, {
      prebake: true,
      tag: 'drum-machines',
    }),
    // uzu-drumkit: 16 bank, 41 WAV（tidalcycles/uzu-drumkit）
    samples(`${baseNoTrailing}/uzu-drumkit.json`, undefined, {
      prebake: true,
      tag: 'drum-machines',
    }),
    // mridangam: 13 bank, 131 WAV（yaxu/mrid）
    samples(`${baseNoTrailing}/mridangam.json`, undefined, { prebake: true, tag: 'drum-machines' }),
    // dirt-samples: 35 bank, 230 WAV（tidalcycles/Dirt-Samples 核心子集）
    samples(`${baseNoTrailing}/dirt-samples.json`, undefined, { prebake: true }),

    // ── CDN 采样库（通过 jsDelivr 加载，仓库较小不会 403）──
    // VCSL: 128 bank, 868 文件（sgossner/VCSL, CC0）
    samples(`${baseNoTrailing}/vcsl.json`, 'github:sgossner/VCSL/master/', { prebake: true }),
  ]);

  aliasBank(`${baseNoTrailing}/tidal-drum-machines-alias.json`);
}

const maxPan = noteToMidi('C8');
const panwidth = (pan, width) => pan * width + (1 - width) / 2;

Pattern.prototype.piano = function () {
  return this.fmap((v) => ({ ...v, clip: v.clip ?? 1 })) // set clip if not already set..
    .s('piano')
    .release(0.1)
    .fmap((value) => {
      const midi = valueToMidi(value);
      // pan by pitch
      const pan = panwidth(Math.min(Math.round(midi) / maxPan, 1), 0.5);
      return { ...value, pan: (value.pan || 1) * pan };
    });
};
