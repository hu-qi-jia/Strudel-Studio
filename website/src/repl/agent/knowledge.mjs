// knowledge.mjs — agent 的「音乐知识语料库」
//
// 这里集中存放从社区曲目（awesome-strudel / eefano/strudel-songs-collection 等）
// 与 Strudel 引擎源码（packages/core, packages/tonal, packages/superdough）中
// 提炼出的编排技法与采样音色知识。与 ContextManager 的「prompt 装配逻辑」解耦——
// ContextManager 只负责按需注入，知识内容统一维护在本文件，便于持续「学习」扩充。
//
// 每个常量都是一段 System Prompt 片段。所有提到的 API 均已对照引擎源码核实存在：
//   setcps/setcpm/cpm   → packages/core/repl.mjs (setcps: setCps, setCpm, cpm 控件)
//   samples()           → packages/superdough/sampler.mjs:229 (async)
//   .bank/.chord/.anchor/.voicing/.struct/.apply → packages/core/controls.mjs / tonal/voicings.mjs
//   drum-machine / GM 命名 → 来自实测曲目（RolandTR909 / gm_oboe 等）

// ─── 知识版本 ───────────────────────────────────────────────────
// 每次修改 knowledge 内容时递增。用于：
// - 调试时确认 agent 用的是哪个版本的知识（console.debug 打印）
// - 未来可用于缓存失效（知识变了 → 清 prompt cache）
// - 变更追踪：版本号对应 git commit，便于回溯某版本知识的具体内容
// 版本规则：major.minor — major 改变表示知识段增删，minor 改变表示内容修正
export const KNOWLEDGE_VERSION = '1.0';

// ─── 乐器可靠性（常驻注入：杜绝「静音层」）─────────────────────────────
// 受限网络（如中国大陆无 VPN）下，gm_* 音色 / 鼓机 .bank() / 默认 bd-sd-hh 采样会 403，
// 静默无输出——这是「效果很不好」的头号原因（远多于编排本身的问题）。死掉的层不报错，
// agent 以为成功。这一段把「哪些音色永远能响 / 哪些必须先验证」钉死成硬规则，并提供
// 一套任何网络都能响的合成鼓配方兜底。
export const INSTRUMENT_RELIABILITY = `

## INSTRUMENT RELIABILITY — silent layers are the #1 cause of "sounds bad"

A layer whose sample didn't load plays NOTHING — no error, just silence. On a restricted network (e.g. mainland China without VPN) this kills most drum samples and GM soundfonts, and you will NOT be told. A "complete" arrangement that is half-silent is worse than a simple one that fully plays. Guard against this BEFORE you worry about sophistication.

### ALWAYS loads — use freely on any network
- Synth oscillators: \`sine\`, \`triangle\`/\`tri\`, \`square\`/\`sqr\`, \`sawtooth\`/\`saw\`, \`supersaw\`, \`pulse\`, \`sbd\` (synth kick), \`bytebeat\`
- Noise: \`white\`, \`pink\`, \`brown\`, \`crackle\`
- ZZFX: \`z_sine\`, \`z_sawtooth\`, \`z_triangle\`, \`z_square\`, \`z_tan\`, \`z_noise\`
- Multi-sampled built-ins: \`.s("piano")\`, \`.s("vcsl")\`

### VERIFY FIRST — network-dependent, may 403 silently
- GM soundfonts: all \`gm_*\` names
- Drum-machine kits: any \`.bank("...")\` (RolandTR909, BossDR110, …) and the bare default drums \`bd\` \`sd\` \`hh\` \`oh\` \`cp\` \`rim\`
- Custom sample packs loaded via \`samples()\`

### HARD RULE
Before you build a track on a VERIFY-FIRST sound, write a short pattern with \`write_code\` using it (the tool plays + validates). If it is silent, call \`undo\` and swap to an ALWAYS-LOADS voice. NEVER ship a track whose drums, bass, or lead are silently dead — that is a failed task even if the code "plays". When in doubt, default to synth voices.

### Reliable synth-drum kit (loads anywhere — use when kits fail)
\`\`\`
setcpm(120/4)
$: note("<c1 ~ ~ ~>").s("sine").decay(0.3).gain(0.9)            // kick (sine thump)
$: s("~ white ~ ~").decay(0.12).gain(0.18).hpf(4000)            // snare (noise burst)
$: s("white*8").decay(0.04).gain(0.1).hpf(7000).pan("<0.3 0.7>")// hats
$: note("<c2 ~ c2 ~ ~ g1 ~ bb1>").s("sine").decay(0.4).lpf(200)// sub bass
\`\`\`
These never 403. Layer reverb (\`.room\`/\`.size\`) and stereo (\`.jux\`/\`.pan\`) on top for width.`;

// ─── 编排工具箱（始终注入：多声部、和声、段落是「完整作品」的基础）─────────
export const ARRANGEMENT_TOOLKIT = `

## ARRANGEMENT TOOLKIT — BUILDING A COMPLETE TRACK

A real piece is not one flat loop. It has layers, harmony, and form. These idioms are all verified to exist in this engine — use them.

### Tempo — always set it from BPM
One cycle = one bar in 4/4, so divide BPM by 4. \`setcps\`, \`setcpm\` and \`.cpm()\` are ALL valid (don't let anyone tell you setcps is banned — only the bare form is wrong).
- Top of file:        \`setcpm(124/4)\`                         // = 124 BPM
- After a stack:      \`stack(...).cpm(124/4)\`
- Equivalent (cps):   \`setcps(124/60/4)\`
NEVER write \`setcps(124)\` — that is 124 cycles/second (absurdly fast). Always keep the \`/60/4\` conversion. When the user gives a tempo, set it.

### Multi-track — one stack() is the cleanest, validator-safe form
Put every simultaneous part inside a single \`stack(...)\`. Apply shared effects to the whole stack.
\`\`\`
stack(
  s("bd*4").gain("1 0.9 0.95 0.9"),                   // kick
  s("hh*8").swing(0.16).gain("<0.4 0.7 0.5 0.7>"),    // hats
  s("~ cp ~ cp").jux(x => x.late(0.01)),              // clap, stereo-wide
  note("<c2 eb2 g2 bb2>").s("sawtooth").lpf(400),     // bass
).cpm(124/4).room(0.3)
\`\`\`
Two other valid multi-track forms:
- **Anonymous tracks**: prefix each with \`$:\`. (The engine plays only the LAST bare top-level pattern, so every simultaneous track needs a prefix or a stack.)
- **Named top-level patterns** (good for big arrangements):  \`drums: s("bd sd")\`  then  \`bass: n("0 7").s("triangle")\`

### Harmony — chord progressions voiced automatically
Voice a progression around an anchor note (this is how covers/pads are built):
\`\`\`
n("0 1 2 3").chord("<Dm Am F G>").voicing().s("sawtooth")     // moving lines over chords
chord("<C^7 Am Dm G7>").anchor("c4").voicing().s("piano")     // sustained chord pad
\`\`\`
- \`.chord("<...>")\` sets the chord context; \`.anchor("c4")\` pins the top note (default c5); \`.voicing()\` spreads the voices with smooth voice-leading.
- Put \`setDefaultVoicings('legacy')\` at the top of the file to use the classic voice-leading dictionary.
- Turn a progression into a bass line: \`"<C^7 Am Dm G7>".rootNotes(2).note()\` (octave 2). Works on a pattern whose values are chord symbols.
- \`.struct("x*4")\` overlays a rhythm onto pitched/sustained content — essential for pads and bass.

### Chord symbol notation — iReal jazz symbols (NOT "maj7"!)
The voicing dictionary uses iReal jazz notation. A symbol it does NOT recognize makes \`.voicing()\` **silently return silence** — no error, the layer just plays nothing. This is a top cause of "my pad/keys are dead". Use these forms:
| meaning | symbol | alias | example |
|---------|--------|-------|---------|
| major (triad) | \`^\` | \`M\` / (none) | \`C^\`, \`CM\`, \`C\` |
| minor (triad) | \`-\` | \`m\` | \`D-\`, \`Dm\` |
| major 7 | \`^7\` | \`M7\` | \`C^7\`, \`CM7\` |
| minor 7 | \`-7\` | \`m7\` | \`A-7\`, \`Am7\` |
| dominant 7/9/11/13 | \`7\` \`9\` \`11\` \`13\` | — | \`G7\`, \`G9\`, \`G11\` |
| maj9 / min9 | \`^9\` / \`-9\` | \`M9\` / \`m9\` | \`C^9\`, \`Am9\` |
| diminished / half-diminished | \`o\` / \`h\` (or \`h7\`) | — | \`Bo\`, \`Fh7\` |
| sus / add9 / 6 / 69 | \`sus\` \`add9\` \`6\` \`69\` | — | \`Gsus\`, \`C69\` |
WRONG (silently dead): \`Cmaj7\`, \`Dmin7\`, \`Fmaj9\`, bare \`maj\`/\`min\`/\`dim\`. RIGHT: \`C^7\`/\`CM7\`, \`Dm7\`/\`D-7\`, \`F^9\`.

### Reliability — prefer explicit note arrays for sustained pads
For pads and sustained layers where you want a specific voicing, write the notes explicitly. This NEVER silently fails (no symbol lookup, no dictionary): \`note("<[c3,e3,g3,b3] [a2,c3,e3,g3]>").s("supersaw").room(0.8)\`. Use \`chord(...).voicing()\` when you want AUTOMATED voice-leading over a jazz progression (with the correct symbols above). For ambient / dreamcore / pop pads, explicit note arrays are usually both more reliable and more appropriate than voicing().

### Scale with octave — separate registers for bass vs melody
Format: \`"root+octave:name"\`.
- melody high:   \`n("<0 2 4 7>").scale("c5:minor").s("sawtooth")\`
- bass low:      \`n("<0 0 7 0>").scale("c2:minor").s("triangle")\`
- pentatonic:    \`.scale("c:minor:pentatonic")\`. Modes: minor, major, dorian, phrygian, mixolydian.

### DO NOT mix .scale() with notes — the #1 tonal error
\`.scale()\` converts \`n()\` **integer degrees** (0,2,4,7) into note names. Misusing it throws \`[tonal] invalid scale step "undefined"\`:
- ✅ \`n("0 2 4").scale("c:minor")\` — degrees → notes. This is the ONLY correct use.
- ❌ \`note("c2 e3 g3").scale("c:minor")\` — \`note()\` already gives notes; the scale does nothing (and confuses). Just write \`note("c2 e3 g3")\` with NO \`.scale()\`.
- ❌ \`… .voicing().scale(…)\` / \`… .chord(…).scale(…)\` — \`.voicing()\` and \`.chord()\` emit note objects that have no scale-degree field, so \`.scale()\` reads \`undefined\` and errors. NEVER chain \`.scale()\` after \`.voicing()\` or \`.chord()\`.
Rule of thumb: \`.scale()\` goes right after \`n(...)\` and nowhere else. If you wrote the pitches as letter-names (\`note(...)\`) or voiced them (\`.voicing()\`), you are done — do not add \`.scale()\`.

### Separate notes from timbre with .apply() and .layer()
Define an instrument (notes -> sound + fx) once, reuse it on different note patterns:
\`\`\`
const bass = x => x.scale("c2:minor").s("triangle").gain(0.8).lpf(400)
n("<0 0 7 0>").apply(bass)
\`\`\`
\`.layer(fn1, fn2)\` plays the SAME notes through two instruments at once — e.g. a wide stereo pair:
\`n("c3 e3 g3").layer(x => x.s("sawtooth").pan(0.3), x => x.s("sawtooth").pan(0.7).late(0.01))\`

### Form / sections — evolve over MINUTES, never loop one bar forever
A real track has an intro, verse, chorus, break, outro. Build macro form with these (in rising power):
- \`@N\` holds a value for N steps — the macro-structure primitive: \`"<intro@8 verse@8 chorus@8>"\` holds each token for that many cycles. This is how you pace a whole song, not just a bar.
- \`cat(intro, verse, chorus)\` — literal ordered sections (each takes one cycle).
- Alternate/fill at the bar level: \`"<bd ~ ~ bd ~ | bd ~ ~ ~>"\`, \`s("hh*4").every(4, x => x.fast(2))\`.
- **Section variants via \`pickRestart([...])\`** — an array of patterns; a driver selects which plays each span. \`"<0@4 1@4>".pickRestart([verseA, verseB])\` plays verseA for 4 cycles then verseB for 4.
- **Named section map** — \`"<intro@4 verse@8 chorus@8>".pickRestart({ intro, verse, chorus })\` where each value is a pattern. Combined with \`.pickOut({bd:..., sd:...})\` to resolve per-voice tokens, this drives a WHOLE-SONG form (verses, choruses, fills).
- **Shared driver for coherence** — define ONE driver and feed chords/bass/melody each through \`.pickRestart([...])\` indexed by it, so every part changes section together instead of drifting: \`const form = "<0@8 1@8>"; chords.pickRestart([...]); bass.pickRestart([...])\`.
- **Named top-level tracks** for big arrangements: \`drums: ...\` \`bass: ...\` \`keys: ...\` — the engine plays every named track in parallel (no \`$:\` needed), and each is independently editable.
- \`.mask("<~@3 1@6 ~@3>/12")\` — gate a whole part in/out over time (\`1\` = audible, \`~\` = silent). Automates "drop the drums for 6 bars then bring them back".
- Sparse vs busy contrast: swap densities with \`<>\` and drop parts with \`~\`.

### Depth & width — stereo, doubling, multi-kit drums
A mono, dead-center mix sounds flat. Give layers their own space and double them for weight:
- \`.layer(fnA, fnB)\` plays the SAME notes through two instruments at once. Stereo pair: \`n("c3 e3 g3").layer(x => x.s("sawtooth").pan(0.3), x => x.s("sawtooth").pan(0.7).late(0.01))\`.
- \`.superimpose(x => x.detune(0.5))\` layers a detuned copy on top — instant chorus/thickening (great on supersaw pads and leads).
- \`.jux(fn)\` applies fn to one channel and mirrors it to the other → wide stereo. \`.jux(x => x.late(0.01))\` on hats/claps.
- **Multi-kit drums via \`.pickOut({})\`** — assign a different kit per voice for character: \`"<bd sd>".pickOut({ bd: s('bd').bank('Linn9000'), sd: s('sd').bank('RolandMT32') })\`. Don't force one kit when mixing voices sounds better.
- \`.all(fn)\` applies an effect to every top-level track at once (alternative to putting one effect on a \`stack()\`).
- \`.color("red")\` tags a track so the arrangement reads by role in the editor (drums yellow, bass green, etc.).`;

// ─── 信号自动化（常驻注入：破解「死板 loop」，让声部随时间起伏）───────────────
// 直接回应「层次分明」——把力度/滤波/声像/空间交给一条会移动的信号曲线，而不是写死一个数。
// 提炼自 cadenza（cosine 力度曲线）/ strangerthings（perlin 滤波扫动）/ satiesfaction（母带 tremolo）。
export const LIVING_PATTERNS = `

## LIVING PATTERNS — automate parameters so the track breathes

A static loop (one gain, one filter value, forever) sounds dead. Drive \`.gain()\` / \`.lpf()\` / \`.hpf()\` / \`.pan()\` / \`.room()\` with a SIGNAL PATTERN — a shape that moves over time. This is the single biggest difference between "sounds like a demo" and "sounds produced".

### Signal sources and shaping
Sources: \`sine\`, \`tri\`/\`triangle\`, \`saw\`, \`square\`, \`rand\`, \`perlin\`, \`cosine\`.
Shape them: \`.range(min, max)\` sets the swing, \`.segment(n)\` chops into n steps per cycle, \`.slow(n)\` stretches the whole thing.
\`\`\`
sine.range(0.5, 1).slow(4)                 // a gain that swells over 4 cycles
perlin.slow(2).range(100, 2000)            // organic, never-repeating filter cutoff
cosine.segment(16).range(0.5, 1).slow(8)   // 16-step ease curve, 8 cycles per wave
\`\`\`

### Apply directly to a control — never quote a signal
\`\`\`
s("bd*4").gain(cosine.segment(16).range(0.5, 1).slow(8))                 // velocity swell
note("<c2 eb2 g2 bb2>").s("sawtooth").lpf(perlin.slow(2).range(100, 2000)) // filter sweep
s("hh*8").pan(sine.range(0.2, 0.8).slow(4))                              // panning drift
\`\`\`
RULE: signals are PATTERNS, not numbers. Pass them bare to the control — \`.gain(sine.range(0,1).slow(2))\` — never wrap in quotes (\`.gain("0.5")\` is a static value, defeats the point).

### Whole-arrangement movement
- Master tremolo / slow swell on the entire stack: \`.postgain(sine.mul(0.3).add(1.2).segment(48).slow(48*7))\`.
- Automate density (a fill or a drop): \`.mask("<~ 1>*4".slow(4))\`, or sweep a filter open over a section then close it.

Aim for at least ONE moving parameter per track that sustains (pad/bass/lead) — even a slow filter sweep on one layer makes the whole piece feel alive.`;

// ─── 曲式脚手架（常驻注入：把「单 loop」升级为「完整作品」，完整度的主力）─────────
// ARRANGEMENT_TOOLKIT 讲了曲式原语（@N/cat/pickRestart/mask），这里给「可直接改编」的
// 多段落骨架。所有原语均已对照引擎源码核实：@N 保持、<> 交替（mini-notation）、
// .mask/.every（pattern.mjs）、cat/slowcat/timeCat（pattern.mjs）、chord/anchor/voicing
// （controls.mjs / tonal）、信号（core signals）。每个骨架都用 stack/$: 多声部 + 段落变化 +
// 至少一处自动化，跑通即「完整度」达标。
export const FORM_TEMPLATES = `

## FORM TEMPLATES — whole-song skeletons (adapt notes/sounds/tempo, keep the FORM)

A loop is not a track. The skeletons below each pace a multi-CYCLE arc (intro/verse/chorus, build/drop, or slow evolution) so the piece changes over time. Pick the one that fits the request, swap the sounds/notes to taste, and KEEP the form mechanics. Verify your result with analyze_arrangement — "form" must pass.

### A. Pop / EDM arc — chord progression paced by @N + drum break via .mask
@N holds a value for N cycles. Pacing chords with @N turns one bar into a 32-cycle progression; .mask gates a part in/out so the drums drop for a break.
\`\`\`
setcpm(124/4)
// 32-cycle harmony: each chord held 8 cycles = a real progression, not one chord forever
$: chord("<C^7@8 Am@8 F^7@8 G@8>").anchor("c4").voicing().s("piano").room(0.4)
$: note("<c2 a1 f2 g1>").s("sawtooth").lpf(300).release(0.2)            // bass follows the roots
$: s("bd*4").gain("1 0.9 0.95 0.9")
$: s("hh*8").swing(0.16).gain("<0.4 0.7 0.5 0.7>")
$: s("~ cp ~ cp").jux(x => x.late(0.01))
// drum break every 16 cycles: 12 on, 4 off (drop the kick & hats for tension)
$: s("bd*4").mask("<1@12 ~@4>")
$: s("hh*8").mask("<1@12 ~@4>")
\`\`\`

### B. Build / drop — density rises via .every + a filter that opens over the section
.one section stays sparse, then .every(...) adds a fill and a signal sweeps a filter open into the drop.
\`\`\`
setcpm(128/4)
$: s("bd ~ ~ ~ | bd ~ ~ ~").gain(0.9)
$: s("hh*4").every(4, x => x.fast(2)).gain("<0.4 0.6>")                  // fill every 4 cycles
$: s("~ cp ~ cp").jux(x => x.late(0.01))
$: note("<c2 eb2 g2 bb2>").s("sawtooth").lpf(perlin.slow(16).range(200, 4000))  // filter opens over 16 cycles into the drop
$: note("<[c4,e4,g4] [eb4,g4,bb4]>").s("gm_pad_2_warm").room(0.5).gain(0.35)
\`\`\`

### C. Minimal / process — slow evolution: one pad whose timbre moves, sparse pulse
Ambient/minimal pieces breathe over minutes: a sustained layer driven by a slow signal, a barely-there pulse. Almost no notes change — the MOTION is the point.
\`\`\`
setcpm(60/4)
$: chord("<C^7@16 Am9@16>").anchor("c4").voicing().s("gm_string_ensemble_1").room(0.9).size(0.9).attack(2).release(6)
  .lpf(cosine.segment(32).range(300, 2500).slow(32))                     // filter breathes over 32 cycles
$: note("<c2 a1>").s("gm_acoustic_bass").gain(0.4)
$: s("hh?").slow(2).gain(0.05).pan("<0.3 0.7>")
\`\`\`

### D. Two contrasting sections (AB) via cat() of two multi-track stacks
cat(a, b) plays each pattern for a full cycle in turn. Wrap each SECTION in its own stack and cat them for a clear AB form (verse/chorus). Use slowcat if you want longer holds.
\`\`\`
setcpm(100/4)
const verse = stack(
  s("bd ~ ~ bd ~ sd ~ ~").bank("BossDR110").swing(0.18),
  n("<0 2 3 2>").scale("c3:dorian").s("gm_electric_piano"),
)
const chorus = stack(
  s("bd*4 cp"),                                                          // busier, lifted
  note("<[c4,e4,g4] [f4,a4,c5]>").s("gm_pad_2_warm").room(0.5),
  n("<0 2 4 2>").scale("c5:major").s("gm_flute"),
)
$: cat(verse, verse, chorus, chorus)                                     // A A B B
\`\`\`

### How to choose
- User wants a "song"/"complete track"/"full piece"/cover → A (most genres) or D (clear verse/chorus).
- User wants energy/build/drop/dance → B.
- User wants ambient/calm/meditative/process → C.
Always: set tempo, layer 3+ tracks with distinct roles, vary velocity, separate in stereo, and pace at least one change over many cycles. Confirm "form" passes in analyze_arrangement before you stop.`;

// ─── 采样音色识别与运用（按需注入：命中音色关键词或短消息时）─────────────────
// 直接回应「准确识别和运用各类采样音色」——鼓机、GM 音色、自定义采样包三大来源。
export const SAMPLES_GUIDE = `

## SOUNDS — DRUM MACHINES, GM SOUNDFONTS & CUSTOM SAMPLES

### Drum machine banks — pick a kit that fits the genre
Play drum names (\`bd sd hh oh cp rim rs lt mt cr rd ch sn cg\`), then choose a kit with \`.bank()\`:
- house / techno / dance:  \`s("bd sd hh oh").bank("RolandTR909")\`
- trap / hip-hop / 808:    \`s("bd sd hh").bank("RolandTR808")\`
- classic / lo-fi / indie: \`s("bd sd").bank("RolandTR707")\`  or  \`.bank("BossDR110")\`
- alt / indie:             \`.bank("AlesisHR16")\`
- other kits present: \`AkaiLinn\`, \`KorgDDM110\`, \`Linn9000\`, \`RolandMT32\`, \`RolandTR606\`
Kit names are case-sensitive (CamelCase). Different kits expose different drum voices — call \`list_sounds({category:"Drum Machines"})\` to confirm a kit exists and which voices it has.

### GM Soundfonts — General MIDI instruments (the \`gm_\` family)
Naming pattern: \`gm_<instrument>\`, all lowercase, underscores. Pick by family:
- Keys:    \`gm_acoustic_grand_piano\`, \`gm_electric_piano\`, \`gm_harpsichord\`, \`gm_clavinet\`, \`gm_celesta\`
- Organs:  \`gm_drawbar_organ\`, \`gm_percussive_organ\`, \`gm_rock_organ\`
- Guitars: \`gm_acoustic_guitar_steel\`, \`gm_acoustic_guitar_nylon\`, \`gm_electric_guitar_clean\`, \`gm_overdriven_guitar\`
- Bass:    \`gm_acoustic_bass\`, \`gm_electric_bass_finger\`, \`gm_electric_bass_pick\`, \`gm_synth_bass_1\`
- Strings: \`gm_string_ensemble_1\`, \`gm_string_ensemble_2\`, \`gm_pizzicato_strings\`, \`gm_violin\`, \`gm_cello\`
- Brass:   \`gm_trumpet\`, \`gm_trombone\`, \`gm_french_horn\`, \`gm_tuba\`, \`gm_brass_section\`
- Winds:   \`gm_flute\`, \`gm_oboe\`, \`gm_clarinet\`, \`gm_piccolo\`, \`gm_pan_flute\`, \`gm_recorder\`, \`gm_harmonica\`
- Vox:     \`gm_choir_aahs\`, \`gm_voice_oohs\`
- Synth lead: \`gm_lead_1_square\`, \`gm_lead_2_sawtooth\`, \`gm_lead_5_charang\`, \`gm_lead_8_bass_lead\`
- Synth pad:  \`gm_pad_2_warm\`, \`gm_pad_3_polysynth\`, \`gm_pad_8_sweep\`
Use with \`note()\`/\`n()\`/\`.scale()\`:  \`note("<c4 eb4 g4>").s("gm_oboe")\`. Append \`:N\` for a variant if listed (\`gm_acoustic_guitar_steel:1\`).
RULE: a wrong \`gm_\` name errors at play time. When unsure, run \`list_sounds({category:"GM Soundfonts", search:"bass"})\` — never guess a name you have not seen in the results.

### Custom sample packs from GitHub (the community banks)
\`samples()\` is async — load any public sample folder, then reference the aliases you defined:
\`\`\`
await samples({ pluck: 'pluck/c5.wav', kick: 'kick/k1.wav' }, 'github:USER/REPO/BRANCH/')
$: s("kick ~ pluck pluck").room(0.3)
\`\`\`
The \`await samples(...)\` call MUST sit at the top level, before any pattern uses the alias. If a path doesn't resolve, the sound fails at play time — confirm the exact \`.wav\` path first.

### Built-in synths & multi-samples (no loading needed)
- Oscillators: \`sine\`, \`triangle\`(\`tri\`), \`square\`(\`sqr\`), \`sawtooth\`(\`saw\`), \`supersaw\`, \`pulse\`
- Noise: \`white\`, \`pink\`, \`brown\`, \`crackle\`
- Piano: \`.s("piano")\` (multi-sampled A0-C8) or \`.piano()\` shortcut
- ZZFX: \`z_sine\`, \`z_sawtooth\`, \`z_triangle\`, \`z_square\`, \`z_tan\`, \`z_noise\`
- Built-in sample sets (browse with \`list_sounds({category:"Samples"})\`): \`piano\`, \`casio\`, \`jazz\`, \`amen\`, \`tabla\`, \`vcsl\`, \`birds\`, \`fx\` …

### Reachability — verify before you rely on a sample (IMPORTANT)
Sample sources are network-dependent, and you do NOT know the user's current network state. On a restricted network (e.g. mainland China without a VPN) \`raw.githubusercontent.com\` and \`*.github.io\` are blocked, and even the jsDelivr mirror 403s repos **>50MB** — which kills \`tidalcycles/Dirt-Samples\`, \`tidalcycles/tidal-drum-machines\`, the default \`bd\`/\`sd\`/\`hh\`, and GM soundfonts (\`gm_*\`). A VPN restores all of them. What loads on ANY network: synth oscillators (\`sine\` \`triangle\` \`square\` \`sawtooth\` \`supersaw\` \`pulse\`), ZZFX (\`z_*\`), \`.s("piano")\`, \`.s("vcsl")\`, and the built-in \`dough-samples\` sets listed above.
Discipline: ALWAYS test a GM name or drum-machine \`.bank()\` with a quick \`write_code\` BEFORE building a track on it (then \`undo\`). If it plays silently (the sample didn't load), fall back to a synth voice — \`s("bd")\` often works where a named kit doesn't, and a sine-kick + noise-hat kit works everywhere. Never ship a track whose drums or bass are silently dead. Confirm exact names with \`list_sounds\`, never guess.`;

// ─── 音色特征与选音指南（与 SAMPLES_GUIDE 同条件注入）──────────────────────────
// 回答「这个音色听起来什么样」「什么时候该用什么音色」——按角色和流派组织，
// 让 agent 像有经验的制作人一样选音色，而非随机挑名字。
export const SOUND_CHARACTER_GUIDE = `

## SOUND CHARACTER GUIDE — What each sound sounds like & when to use it

### Drum machine character by kit
| Kit | Character | Best for |
|-----|-----------|----------|
| RolandTR909 | Punchy, warm, classic house/techno. Tight kick, crisp snare, bright hats. | House, techno, trance, EDM, any 4-on-the-floor |
| RolandTR808 | Deep booming sub-bass kick, snappy snare, metallic cowbell. | Trap, hip-hop, 808 bass, Southern rap |
| RolandTR707 | Thin, retro, lo-fi digital. Dry and punchy. | Lo-fi hip-hop, vintage, indie |
| BossDR110 | Cheap, gritty, lo-fi analog. Muffled kick, tinny hats. | Lo-fi, indie, punk, bedroom pop |
| AlesisHR16 | Clean, punchy 16-bit digital. Versatile. | Indie rock, alternative, pop |
| LinnDrum / Linn9000 | Warm, natural, 80s pop/rock. Tight and articulate. | 80s pop, synthwave, rock, funk |
| AkaiLinn | Similar to LinnDrum, slightly warmer. | 80s boogie, funk, R&B |
| KorgDDM110 | Punchy analog, slightly metallic. | Industrial, EBM, retro electronic |
| RolandMT32 | Thin, digital, FM-ish. Clean and bright. | Video game music, chiptune-adjacent |
| YamahaRX5 | Crisp 12-bit digital. Bright and punchy. | Pop, rock, 80s |

### GM Soundfont character by family
**Keys (always reliable if loaded):**
- \`gm_piano\` / \`gm_epiano1\` (Rhodes) / \`gm_epiano2\` (FM EP) — warm, versatile. Use for jazz, neo-soul, lo-fi, ballads.
- \`gm_harpsichord\` — plucked, bright, baroque. Use for classical, folk, quirky accents.
- \`gm_clavinet\` — funky, percussive. Use for funk, R&B, Stevie Wonder vibes.

**Bass (critical for groove):**
- \`gm_acoustic_bass\` — upright double bass. Jazz, acoustic, walking bass lines.
- \`gm_electric_bass_finger\` — warm, round P-bass. Rock, pop, funk, versatile default.
- \`gm_electric_bass_pick\` — brighter, more attack. Rock, punk, driving.
- \`gm_synth_bass_1\` — analog sub-bass. Electronic, house, techno, 808-style.
- \`gm_synth_bass_2\` — TB-303 acid squelch. Acid, techno, psytrance.

**Strings & pads (for harmony layers):**
- \`gm_string_ensemble_1\` — lush orchestral strings. Cinematic, emotional, pads.
- \`gm_string_ensemble_2\` — warmer, softer strings. Ambient, background.
- \`gm_pizzicato_strings\` — plucked strings, staccato. Pop, classical, playful.
- \`gm_pad_2_warm\` — warm analog pad. Ambient, chillout, background harmony.
- \`gm_pad_3_polysynth\` — bright synth pad. Synthwave, retro, uplifting.
- \`gm_pad_metallic\` — bell-like metallic pad. Stranger Things, sci-fi, eerie.
- \`gm_choir_aahs\` — vocal choir "aah". Ethereal, cinematic, epic.
- \`gm_synth_choir\` — synthetic choir. Ambient, new age.

**Lead & melody (for hooks):**
- \`gm_lead_1_square\` — chiptune square wave. 8-bit, retro game, playful.
- \`gm_lead_2_sawtooth\` — classic analog saw lead. Synthwave, trance, energetic.
- \`gm_lead_5_charang\` — guitar-like lead. Rock, fusion, expressive.
- \`gm_oboe\` — reedy, nasal, expressive woodwind. Folk, emotional, exotic.
- \`gm_flute\` — breathy, airy, gentle. Classical, ambient, peaceful.
- \`gm_trumpet\` — bright, brassy, punchy. Jazz, fanfare, Latin.
- \`gm_soprano_sax\` / \`gm_alto_sax\` / \`gm_tenor_sax\` — smooth, warm, jazzy. Jazz, R&B, pop.
- \`gm_pan_flute\` — breathy, ethnic, haunting. World music, ambient.
- \`gm_ocarina\` — soft, pure, ancient. Zelda-like, folk, gentle melodies.

**Guitars (for rhythm/lead):**
- \`gm_acoustic_guitar_steel\` — bright, strummy. Folk, pop, country.
- \`gm_acoustic_guitar_nylon\` — warm, soft, classical. Bossa nova, classical, gentle.
- \`gm_electric_guitar_clean\` — crisp, versatile. Pop, rock, funk.
- \`gm_overdriven_guitar\` — gritty, rock. Rock, blues, power chords.
- \`gm_distortion_guitar\` — heavy, aggressive. Metal, punk, hard rock.

### Synth oscillator character (ALWAYS loads — use as fallback)
- \`sine\` — pure, clean, soft. Sub-bass, pads, FM carrier, meditation.
- \`triangle\` — soft with harmonics, mellow. Bass, leads, lo-fi, gentle.
- \`square\` — buzzy, rich harmonics, chiptune. 8-bit, retro, aggressive leads.
- \`sawtooth\` — bright, rich, cutting. Synth leads, pads, supersaw, EDM.
- \`supersaw\` — detuned unison saw, huge. Trance, EDM, anthemic leads/pads.
- \`pulse\` — PWM-capable, nasal. Bass, retro leads, synthwave.
- \`sbd\` — synth bass drum. 808-style kick replacement when samples fail.
- \`white\` — hiss, harsh. Hi-hats, snare noise, risers.
- \`pink\` — softer hiss, natural. Pads texture, rain, ambient.
- \`brown\` — deep rumble. Sub-bass enhancement, thunder, kicks.

### ZZFX synths (ALWAYS loads — retro game sounds)
- \`z_sine\` — clean retro tone. 8-bit melodies, UI sounds.
- \`z_sawtooth\` — buzzy retro lead. Chiptune, 8-bit boss battles.
- \`z_square\` — classic NES sound. 8-bit melodies, retro bass.
- \`z_triangle\` — soft retro. Game Boy-style melodies.
- \`z_noise\` — retro explosion/hit. Sound effects, percussion.

### Sound selection by genre — quick reference
| Genre | Drums | Bass | Harmony | Melody/Lead |
|-------|-------|------|---------|-------------|
| House/Techno | TR909 | gm_synth_bass_1 / sawtooth | gm_pad_2_warm / supersaw | gm_lead_2_sawtooth / sawtooth |
| Lo-fi hip-hop | BossDR110 / TR707 | gm_electric_bass_finger / triangle | gm_epiano1 / gm_piano | gm_flute / triangle |
| Trap/Hip-hop | TR808 | gm_synth_bass_1 / sine | gm_pad_3_polysynth | gm_lead_1_square / sine |
| Ambient | — | sine / triangle | gm_pad_2_warm / gm_string_ensemble_1 | gm_flute / gm_pad_sweep |
| Synthwave | LinnDrum / TR707 | gm_synth_bass_1 / sawtooth | gm_pad_3_polysynth / supersaw | gm_lead_2_sawtooth / supersaw |
| Jazz | AlesisHR16 / brush kits | gm_acoustic_bass | gm_piano / gm_epiano1 | gm_soprano_sax / gm_trumpet |
| Cinematic | — | gm_acoustic_bass / sine | gm_string_ensemble_1 / gm_choir_aahs | gm_oboe / gm_flute / gm_pan_flute |
| 8-bit/Chiptune | z_noise / square | z_square / z_sawtooth | z_triangle / z_square | z_sine / z_square |
| Rock | AlesisHR16 / LinnDrum | gm_electric_bass_pick | gm_overdriven_guitar | gm_distortion_guitar / gm_electric_guitar_clean |
| Folk/Acoustic | — | gm_acoustic_bass | gm_acoustic_guitar_steel | gm_harmonica / gm_flute / gm_ocarina |

### Sound pairing rules
1. **Contrast timbres across layers** — don't stack two sawtooth leads; pair a bright lead (sawtooth) with a warm pad (gm_pad_2_warm).
2. **Frequency separation** — bass (low), pads/harmony (mid), lead/melody (high). Use \`.lpf()\`/\`.hpf()\` to carve space.
3. **One featured sound per section** — the listener's ear follows ONE lead. Other layers support, not compete.
4. **Test before building** — always \`write_code\` a 1-line test of any GM/drum sound, then \`undo\`. Dead layers are worse than no layers.`;

// ─── 流派编排骨架（按需注入：命中曲风/风格关键词时）────────────────────────
// 每个模板都是「完整作品」起点：设速度 + 多声部分层 + 力度/律动/空间分工 + 段落变化。
// 用最稳的原语（显式音符/和弦 + scale），chord()/voicing() 进阶技法见 ARRANGEMENT TOOLKIT。
export const GENRE_COOKBOOK = `

## GENRE COOKBOOK — full-track starting points (adapt, don't copy verbatim)

Each template sets tempo, layers 3-5 tracks with distinct roles, and varies velocity/groove/space. Swap sounds and notes to taste; keep the LAYERING discipline.

### Four-on-the-floor house (≈124 BPM)
\`\`\`
setcpm(124/4)
$: s("bd*4").gain("1 0.9 0.95 0.9").bank("RolandTR909")
$: s("~ oh").gain(0.4).bank("RolandTR909")          // off-beat open hat
$: s("hh*8").swing(0.16).gain("<0.4 0.7 0.5 0.7>")
$: s("~ cp ~ cp").jux(x => x.late(0.01))
$: note("<c2 eb2 g2 bb2>").s("sawtooth").lpf(400).release(0.2)
$: note("<[c4,e4,g4] [eb4,g4,bb4]>").s("gm_pad_2_warm").room(0.5).gain(0.35)
\`\`\`

### Lo-fi hip-hop (≈78 BPM) — full arrangement with proper groove
\`\`\`
setcpm(78/4)

// Chord progression: Dm9 - G7 - Cmaj7 - Am7 (ii-V-I-vi in C, 1 chord per 2 beats)
const prog = "<Dm9 G7 C^7 Am7>"
const chrds = chord(prog).slow(2).anchor("c4").voicing()

// Chords — Rhodes EP with slow filter movement
$: chrds.s("gm_epiano1").room(0.4).attack(0.02).release(0.8).gain(0.4)
  .lpf(sine.slow(4).range(800, 2500))

// Bass — follows chord roots, syncs with kick, walks between roots
$: n("<0 ~ 0 7 ~ 5 0 3>").scale("c2:minor").s("triangle")
  .gain(0.7).lpf(250).release(0.15).room(0.1)

// Drums — proper boom-bap: kick with variation, ghost snare, swung hats
$: s("bd ~ ~ bd ~ ~ bd ~").bank("BossDR110").swing(0.2)
  .gain("<1 0.8 0.9 0.85 0.95 0.8 0.9 0.8>")
$: s("~ sd ~ ~ ~ sd ~ <~ sd>").bank("BossDR110").swing(0.2)
  .gain("<0.9 0.7 0.5 0.8 0.9 0.7 0.5 0.6>")
$: s("hh*8").bank("BossDR110").swing(0.2)
  .gain("<0.3 0.5 0.35 0.55 0.3 0.5 0.35 0.6>")
  .sometimes(x => x.gain(0.2))  // ghost hat

// Melody — call & response over 2 bars, pentatonic for safe notes
$: n("<~ ~ 3 5 ~ 3 2 ~  ~ ~ 5 7 ~ 5 3 ~>").scale("c5:minor_pentatonic")
  .s("gm_flute").room(0.6).gain(0.3).delay("0.2:0.18:0.3").late(0.02)

// Arrangement — 4 sections with mute/unmute for dynamics
$: chrds.mask("<1 1 1 1  1 1 1 1  0 0 1 1  1 1 1 1>").s("gm_epiano1")
  .room(0.4).attack(0.02).release(0.8).gain(0.4)
\`\`\`
KEY LESSONS from this template:
- Bass follows CHORD ROOTS (0=root, 7=5th, 5=4th), not random scale runs
- Drums have per-step velocity variation (not flat gain)
- Ghost notes on snare/hat add human feel
- Melody has CALL & RESPONSE (2-bar phrase: statement + answer)
- Chords change every 2 beats, not every 4 cycles
- Reverb is per-layer (drums=0.1, melody=0.6), NOT global \`all(x => x.room())\`

### Trap (≈140 BPM half-time)
\`\`\`
setcpm(140/4)
$: s("bd ~ ~ ~ ~ ~ ~ bd").bank("RolandTR808").gain(1)
$: s("~ ~ sd ~ ~ ~ sd ~").bank("RolandTR808").gain(0.8)
$: s("hh*4").sometimes(x => x.fast(2)).gain("<0.4 0.6>")
$: note("<c2 ~ c2 ~ ~ g1 ~ bb1>").s("sine").release(0.4).gain(0.9)  // 808 sub
\`\`\`

### Ambient pad (slow, ≈60 BPM)
\`\`\`
setcpm(60/4)
$: note("<[c3,e3,g3,b3] [a2,c3,e3,g3]>").s("gm_string_ensemble_1").room(0.9).size(0.9).attack(2).release(4).gain(0.5)
$: note("<c2 a1>").s("gm_acoustic_bass").gain(0.4)
$: s("hh?").slow(2).gain(0.05)
\`\`\`

### Melody + harmony cover (generic, ≈100 BPM)
\`\`\`
setDefaultVoicings('legacy')
setcpm(100/4)
const chrds = "<C^7 Am Dm G7>".slow(4)
$: chord(chrds).anchor("c4").voicing().s("piano").gain(0.5)
$: n("<0 2 4 2>").scale("c5:major").s("gm_flute").room(0.3)
$: note("<c2 a1 d2 g1>").s("gm_acoustic_bass").gain(0.7)
$: s("bd ~ sd ~, hh*4").bank("AlesisHR16").gain(0.5)
\`\`\`
NOTE: the \`gm_\` sounds and drum-machine banks above are the "ideal" instrumentation — they load on a normal/VPN'd network. On a restricted network (mainland China without VPN) they 403 and play SILENTLY. Always test a GM name or \`.bank()\` with a quick \`write_code\` (+ \`undo\`) before building on it; if silent, fall back to a synth (\`sine\`/\`triangle\`/\`sawtooth\`/\`supersaw\`) or the synth-drum kit (see INSTRUMENT RELIABILITY).

When the user names a song/artist, recall its genre, typical tempo, instrumentation and groove from training, then adapt the closest template — do not just play a metronome.`;

// ─── 音乐反模式清单（与 GENRE_COOKBOOK 同条件注入）──────────────────────────
// 防止 agent 生成「技术正确但难听」的代码。每条都是实际观察到的 agent 错误。
export const MUSICAL_ANTI_PATTERNS = `

## MUSICAL ANTI-PATTERNS — mistakes that make output sound bad

### RHYTHM — drum mistakes
- **FLAT VELOCITY**: \`s("bd ~ sd ~").gain(0.8)\` — every hit same volume. Sounds robotic.
  FIX: \`gain("<1 0.85 0.9 0.8>")\` — vary per step.
- **SPARSE KICK**: \`s("bd ~ ~ ~ ~ sd ~ ~")\` — only 2 kicks per 8 steps. No groove.
  FIX: \`s("bd ~ ~ bd ~ ~ bd ~")\` or \`s("bd ~ bd ~ ~ bd ~ ~")\` — 3 kicks with syncopation.
- **NO GHOST NOTES**: clean snare on 2 and 4 only. No human feel.
  FIX: \`s("~ sd ~ ~ ~ sd ~ <~ sd>")\` — occasional ghost snare.
- **NO SWING**: straight 8th/16th hats. Sounds like a metronome.
  FIX: \`.swing(0.18)\` for hip-hop, \`.swing(0.16)\` for house.

### BASS — bassline mistakes
- **SCALE RUNS**: \`n("<0 2 3 5 7 5 3 0>")\` — just running up/down the scale. No harmonic connection.
  FIX: Bass follows CHORD ROOTS. Use \`0\` (root), \`7\` (5th), \`5\` (4th), \`3\` (3rd) as primary notes.
- **NOT SYNCED WITH KICK**: bass plays on different beats than kick. Sounds disconnected.
  FIX: Bass hits ON or NEAR kick drum hits. Use rests \`~\` between kicks.
- **TOO BUSY**: continuous 8th notes with no rests. Mud.
  FIX: \`n("<0 ~ 0 7 ~ 5 0 3>")\` — rests create pocket.

### HARMONY — chord mistakes
- **CHORDS TOO SLOW**: \`"<Dm7@4 G7@4>"\` — 4 cycles per chord. Listener falls asleep.
  FIX: 1-2 beats per chord for movement, or 1 bar for ballads. Use \`.slow(2)\` not \`.slow(4)\`.
- **CHORDS TOO FAST**: changing every half-beat. No time to breathe.
  FIX: 1-2 beats minimum per chord.
- **NO VOICING**: \`note("<[c3,e3,g3] [f3,a3,c4]>")\` — root position triads. Sounds like a beginner.
  FIX: \`chord(prog).anchor("c4").voicing()\` — proper voice leading.

### MELODY — melody mistakes
- **RANDOM WANDERING**: \`n("<0 3 5 3 0 5 7 3>")\` — no shape, no phrasing. Sounds like scales.
  FIX: Melody needs STRUCTURE: statement (4 steps) + response (4 steps). Use rests for breathing.
  GOOD: \`n("<~ ~ 3 5 ~ 3 2 ~  ~ ~ 5 7 ~ 5 3 ~>")\` — call & response with rests.
- **NO RESTS**: continuous notes. Exhausting to listen to.
  FIX: 30-50% of steps should be rests \`~\`.
- **WRONG SCALE**: major melody over minor chords (or vice versa). Clashes.
  FIX: Match melody scale to chord scale. Use pentatonic for safe notes.

### ARRANGEMENT — structure mistakes
- **FLAT LOOP**: one pattern repeated forever. No dynamics, no story.
  FIX: Use \`arrange()\` or \`mask()\` to create sections (intro → verse → chorus → outro).
- **ALL LAYERS ALL THE TIME**: every track plays from beat 1. No build.
  FIX: Start with 2 layers, add more in later sections. Use \`mask()\` to mute/unmute.
- **NO DYNAMICS**: every section same energy. Boring.
  FIX: Verse = fewer layers, lower gain. Chorus = full layers, higher gain.

### MIX — effect mistakes
- **GLOBAL REVERB**: \`all(x => x.room(0.4))\` — everything drenched. Mud.
  FIX: Per-layer reverb. Drums=0.1, bass=0.1, chords=0.3-0.5, melody=0.5-0.7.
- **BASS WITH REVERB**: \`note(...).s("triangle").room(0.5)\` — muddy low end.
  FIX: Bass reverb ≤ 0.15, or no reverb at all. Use \`.lpf()\` to keep it focused.
- **TOO MANY EFFECTS**: stacking delay + reverb + chorus + phaser on everything. Chaos.
  FIX: Pick 1-2 effects per layer. Drums: minimal. Melody: delay OR reverb (not both heavy).`;

// ─── 自检清单（与 GENRE_COOKBOOK 同条件注入）────────────────────────────────
// write_code 前必须逐条检查。任何一条不通过 → 修改代码后再写入。
export const SELF_CRITIQUE_CHECKLIST = `

## SELF-CRITIQUE CHECKLIST — verify BEFORE calling write_code

Before you call \`write_code\`, scan your code against this checklist. If ANY item fails, fix it first.

### Rhythm
- [ ] Drum velocity varies per step (not a single flat \`gain(0.8)\`)
- [ ] Kick has at least 3 hits per 8-step pattern (not just 1+1)
- [ ] Hi-hats have swing (0.16-0.22) for groove genres
- [ ] Ghost notes present (occasional quiet snare/hat)

### Bass
- [ ] Bass notes follow chord roots (0=root, 7=5th, 5=4th), NOT random scale runs
- [ ] Bass has rests (~) — not continuous 8th notes
- [ ] Bass reverb ≤ 0.15 (low end must stay dry/focused)

### Harmony
- [ ] Chords change at a reasonable rate (1-2 beats, not 4 cycles)
- [ ] Chords use voicing() or proper inversions, not root-position triads
- [ ] Chord progression makes harmonic sense (ii-V-I, I-vi-IV-V, etc.)

### Melody
- [ ] Melody has SHAPE — statement + response, not random wandering
- [ ] 30-50% of melody steps are rests (~)
- [ ] Melody scale matches chord scale (minor melody over minor chords)

### Arrangement
- [ ] At least 2 distinct sections (not a flat loop)
- [ ] Layers build over time (not all playing from beat 1)
- [ ] Dynamics vary between sections (verse quieter, chorus louder)

### Mix
- [ ] NO global \`all(x => x.room())\` — reverb is per-layer
- [ ] Drums have minimal reverb (≤0.2)
- [ ] Each layer has 0-2 effects, not 4+ stacked

### Sound reliability
- [ ] Every \`gm_\` name and \`.bank()\` has been tested (or fallback synth ready)
- [ ] At least one layer uses a synth oscillator (sine/triangle/saw) as guaranteed-audible anchor

If you cannot pass all checks, revise the code. A shorter track that passes all checks is better than a long track that fails them.`;

// ─── 和声架构（按需注入：命中 chord/voicing/arp/progression/cover/翻唱/和声 时）──
// 提炼自 pyramidsong（和弦形状字典 + pickOut）/ whydoesmybrain（和弦+琶音模块化）/
// cadenza（voicing+struct）/ satiesfaction（调式漂移）。把「形状」与「进行」解耦，便于复用与变化。
export const HARMONY_ARCHITECTURE = `

## HARMONY ARCHITECTURE — modular chord & arp composition

For covers and harmony-rich pieces, separate the SHAPES (a chord voicing, an arp contour) from the PROGRESSION (which chord when). Then you can reuse and vary each independently — this is how community covers stay clean and editable.

### Chord-shape dictionary + named tokens
Define voicings once as a map, then drive them with a token pattern and resolve with \`.pickOut()\`:
\`\`\`
const chr = { X: "f#2,c#3,a#3,c#4", Y: "g2,d3,b3,d4", Z: "a2,e3,a3,c#4" }
$: "<X X Y Z>".pickOut(chr).note().s("piano").room(0.5)   // whole-section chord map
\`\`\`

### Progression with holds, voiced three ways
\`\`\`
const prog = "<G@3 Bm E@3 G#m>"                          // @N = hold chord N steps
$: chord(prog).anchor("c4").voicing().struct("x").s("piano")              // voiced pad/keys (.struct gives rhythm)
$: chord(prog).anchor("c5").voicing().s("gm_drawbar_organ")               // same harmony, different timbre
$: chord(prog).rootNotes(2).note().s("gm_electric_bass_finger")           // same harmony → bass line (octave 2)
\`\`\`
One progression, three layers — pad, keys, bass all move together because they read the same \`prog\`.

### Arp dictionary over scale degrees
\`\`\`
const arps = { u: "0,1,2,3", a: "-@2 0 1 2 3@3", b: "-@2 0@2 [1,2,3]@4" }
$: n("<a3 e3 g3 d3>").add("<0 0 0 0>".pick({0:"0,7,12,15"})).arp("<u a u b>".pick(arps)).s("piano")
\`\`\`

### Scale that morphs over time (modal interchange)
The scale itself can be a pattern — shift mode every few cycles for color:
\`\`\`
$: n("<0 2 4 7>").scale("<b3:lydian c#4:locrian>/48").s("piano")
\`\`\`

### Interval ops on degrees
\`.add("<0 1 0 1 -2>")\` / \`.sub(7)\` / \`.transpose(12)\` — nudge scale degrees without rewriting notes (great for counter-lines and bass from chord degrees).`;

// 注：社区采样包索引（SAMPLE_BANKS）已移除——注入的是受限网络下 403 的死仓库
// （tidalcycles/Dirt-Samples、tidal-drum-machines 等），纯浪费 token 且会误导 agent
// 加载打不开的采样包。需要社区采样时让 agent 引导用户自行确认路径。

// ─── 社区曲目知识库（按需注入：命中"完整曲目/做首歌/cover/案例/教程"等关键词时）──────────────
// 从 awesome-strudel（terryds）和 strudel-songs-collection（eefano）两个社区仓库中
// 提炼的编排技法、结构模板和高级用法。agent 可通过 fetch_song 工具直接读取曲目完整代码
// （song-library 插件有本地 catalog，比 browse_repo+fetch_example 更快）。
// browse_repo / fetch_example 留给非 song-library 的仓库（如读 README、教程、采样包索引）。
export const COMMUNITY_TRACKS = `

## COMMUNITY TRACKS — Quality benchmark & learning resources

### Your quality benchmark
When the user asks for a "song", "complete track", "cover", or "full piece", your output should match the structural quality of real community tracks. These are NOT simple loops — they have:
- 3-6 layered tracks (drums, bass, harmony, melody, pads, leads)
- Section-based arrangement (intro → verse → chorus → bridge → outro) using \`arrange()\` or \`cat()\`
- Velocity variation, stereo separation, reverb/delay space
- At least one parameter change over time (filter sweep, tempo change, mute/unmute)

A flat single-track loop with no sections is NOT an acceptable finished track. If your first draft is a loop, add form before you stop.

### Proactive learning — use fetch_song before generating
Two curated GitHub repos contain 80+ real Strudel songs:
- **eefano/strudel-songs-collection** — 80+ full song covers (Stranger Things, Pyramid Song, Pump Up The Jam, Waltz #2, Enjoy The Silence, Bug From Heaven, etc.)
- **terryds/awesome-strudel** — curated index of featured tracks, tutorials, and sample banks

**When making a complete track or cover, proactively call \`fetch_song\` (no args to browse by genre, or with a name) to pull 1-2 relevant songs for structural inspiration.** This is faster than \`browse_repo\`+\`fetch_example\` because the song-library has a local catalog with genre/name metadata. Reserve \`browse_repo\`+\`fetch_example\` for repos NOT in the song-library (e.g. reading READMEs, tutorials, or sample bank indexes from \`terryds/awesome-strudel\`). Adapt the techniques — change notes, swap to locally-loadable sounds, adjust tempo. Do NOT copy verbatim unless the user asks for that exact song.

### Key patterns from community tracks

**1. Song structure with arrange()** — section-based arrangement:
\`\`\`
let intro = stack(drums, bass)
let verse = stack(drums, bass, melody, chords)
let chorus = stack(drums, bass, lead, pads, vocals)
arrange([8, intro], [16, verse], [8, chorus], [16, verse], [8, chorus]).cpm(cpm)
\`\`\`

**2. Multi-layer drum programming** — layer kick + snare + clap + hihat + shaker:
\`\`\`
let drums = stack(
  sound("<bd>*4").bank("RolandTR909"),
  sound("<- sd>*4").bank("RolandTR909"),
  sound("<- cp:3>*4").bank("RolandTR909"),
  sound("<- hh>*8").bank("LinnDrum").gain(.2),
  sound("<sh>*8").bank("RolandTR808").gain(.25)
)
\`\`\`

**3. Bass with filter envelope** — classic synth bass with LPF modulation:
\`\`\`
let bass = cat("<c2>*4","<g1>*4","<eb1>*4","<f1>*4").note()
  .n(3).sound("gm_synth_bass_1")
  .lpf(200).lpenv(5).lpa(.5).lps(.8).lpd(.1)
\`\`\`

**4. Arpeggio with delay + reverb** — ambient synth layers:
\`\`\`
let arp = cat("<c3 c4 eb5 c3 c4 d5 c3 bb4>*8").note()
  .n(1).sound("gm_pad_poly").decay(.95)
  .lpf(5000).lpenv(-3).lpa(.2)
  .delay(".3:.225:.45").room(.8).rsize(2)
\`\`\`

**5. Custom vocal samples** — load and slice vocal phrases:
\`\`\`
samples({ vox: 'vox_chorus.wav' }, 'https://raw.githubusercontent.com/user/repo/main/samples/')
let vocals01 = s("vox").begin(0).end(.25).attack(.25).delay(".25:.45:.4").room(.2)
let vocals02 = s("vox").begin(.25).end(.5).attack(.25).delay(".25:.45:.4").room(.2)
\`\`\`

**6. Chord progression with voicing()** — from eefano's covers:
\`\`\`
const chrds = "F@3 C@6 F@6 Bb@3 F@2 C F@3".slow(8)
chord(chrds).anchor("G4").struct("x*3").voicing().piano()
n("2 ~ ~ 2 1 ~").chord(chrds).anchor(chrds.rootNotes(2)).voicing().s("gm_electric_bass_finger")
\`\`\`

**7. Guitar strumming simulation** — from Bug From Heaven cover:
\`\`\`
const fingering = { A:"0:0:2:2:2:0", Am:"0:0:2:2:1:0", D:"x:0:0:2:3:2", E:"0:2:2:1:0:0" }
const gString = register('gString', (n, pat) =>
  pat.fmap((v) => { if(v[n]=='x') return note(0).velocity(0); return note(v[n]+standardtuning[n]); }).innerJoin())
\`\`\`

**8. Markov chain patterns** — generative drum variation:
\`\`\`
let markovtables = { drums: [[0,.2,.8],[.3,0,.7],[.9,.1,0]] }
const markov = register('markov', (id, pat) => pat.withHap((hap) => { /* state machine */ }))
$: s(rand.segment(1).markov('drums').pick(["bd","sd","hh"])).fast(8)
\`\`\`

**9. Keyboard-triggered mute groups** — live performance toggles:
\`\`\`
const keystatus = {}
window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key>='1'&&e.key<='9') keystatus['Ctrl'+e.key] = !keystatus['Ctrl'+e.key] })
register('mykeys', (key, pat) => pat.withValue(() => keystatus[key] ? 0 : 1))
$: s("bd:2(4,8)").mask("1".mykeys("Ctrl1"))
\`\`\`

**10. Tempo changes via cps pattern** — from Waltz #2:
\`\`\`
tempochanges: cps(sine.segment(32).slow(16).mul(30).add(160).div(60*3)).gain(0)
\`\`\`

### Available sample banks (from awesome-strudel README)
Community sample repos loadable via \`samples('github:USER/REPO')\`:
- tidalcycles/Dirt-Samples (classic TidalCycles sample set)
- TodePond/samples, EloMorelo/samples, emrexdeger/strudelSamples
- yaxu/clean-breaks, Bubobubobubobubo/Dough-Amen, Bubobubobubobubo/Dough-Juj
Full list: browse_repo("terryds/awesome-strudel") and read the README.`;