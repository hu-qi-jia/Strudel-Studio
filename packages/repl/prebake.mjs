import { noteToMidi, valueToMidi, Pattern, evalScope } from '@strudel/core';
import { aliasBank, registerSynthSounds, registerZZFXSounds, samples } from '@strudel/webaudio';
import * as core from '@strudel/core';

export async function prebake() {
  const modulesLoading = evalScope(
    // import('@strudel/core'),
    core,
    import('@strudel/draw'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
    import('@strudel/webaudio'),
    import('@strudel/codemirror'),
    import('@strudel/hydra'),
    import('@strudel/soundfonts'),
    import('@strudel/midi'),
    // import('@strudel/xen'),
    // import('@strudel/serial'),
    // import('@strudel/csound'),
    // import('@strudel/osc'),
  );
  // load samples
  // jsDelivr CDN mirror of the same GitHub repos. raw.githubusercontent.com is
  // origin-only and slow/throttled on many networks (esp. mainland China); jsDelivr
  // edge-caches the manifests + .wav buffers for much faster startup & first-play.
  const ds = 'https://cdn.jsdelivr.net/gh/felixroos/dough-samples@main/';

  // TODO: move this onto the strudel repo
  const ts = 'https://cdn.jsdelivr.net/gh/todepond/samples@main/';
  await Promise.all([
    modulesLoading,
    registerSynthSounds(),
    registerZZFXSounds(),
    //registerSoundfonts(),
    // need dynamic import here, because importing @strudel/soundfonts fails on server:
    // => getting "window is not defined", as soon as "@strudel/soundfonts" is imported statically
    // seems to be a problem with soundfont2
    import('@strudel/soundfonts').then(({ registerSoundfonts }) => registerSoundfonts()),
    samples(`${ds}/tidal-drum-machines.json`),
    samples(`${ds}/piano.json`),
    samples(`${ds}/Dirt-Samples.json`),
    samples(`${ds}/uzu-drumkit.json`),
    samples(`${ds}/vcsl.json`),
    samples(`${ds}/mridangam.json`),
  ]);

  aliasBank(`${ts}/tidal-drum-machines-alias.json`);
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
