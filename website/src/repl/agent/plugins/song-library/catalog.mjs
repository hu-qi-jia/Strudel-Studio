// catalog.mjs — eefano/strudel-songs-collection 的本地曲目索引（song-library 插件用）。
//
// 这是一份「离线可浏览」的元数据：agent 无需联网即可按 name / genre 查到某首曲子
// 是什么风格、什么速度、用了哪些音色与技法，再决定是否调 fetch_song 拉取完整代码。
// 元数据（tempo / kit / instruments）从每首 .js 源码里直接抠出（事实），genre 与 note
// 人工标注（方向性，非精确曲谱考证）。仅收录 jsDelivr 实测可拉的 65 首；少量 test
// 文件（strumtest*/tablaturetest）与 main 上已不可达的条目不收入。
//
// 仓库：github:eefano/strudel-songs-collection  |  raw 走 jsDelivr（见 plugin.mjs）

// genre 取值（粗粒度，便于按流派过滤）：
//   'electronic' 电子/舞曲/合成器  'pop-rock' 流行/摇滚/复刻
//   'classical'  古典/氛围/钢琴    'folk'      民谣/世界音乐
//   'jazz'       爵士/休闲         'minimal'   极简/实验
export const REPO = 'eefano/strudel-songs-collection';
export const BRANCH = 'main';

export const CATALOG = [
  // ── electronic / dance / synth ────────────────────────────────────────
  { name: 'acertainbuzz', genre: 'electronic', tempo: '175', kit: 'tr909', instruments: 'supersaw, triangle', note: '共享 driver 同步和弦/旋律/鼓；pickRestart 段落切换' },
  { name: 'aztecchallenge', genre: 'electronic', tempo: '180', kit: '', instruments: 'gm_lead_2_sawtooth, sawtooth', note: '高速合成器琶音，芯片味' },
  { name: 'bennington', genre: 'electronic', tempo: '135', kit: '', instruments: 'gm_pad_warm, pulse, sawtooth, square', note: '多层合成器 pad 堆叠' },
  { name: 'bonespurs', genre: 'electronic', tempo: '90/3', kit: 'linndrum', instruments: 'sine, square, supersaw, triangle', note: '奇数节拍合成器小品' },
  { name: 'cabinet', genre: 'electronic', tempo: '133/8', kit: '', instruments: 'gm_drawbar_organ, triangle', note: 'organ 律动' },
  { name: 'clubbed', genre: 'electronic', tempo: '162/3', kit: 'RolandTR808', instruments: 'gm_electric_guitar_clean, gm_percussive_organ', note: '上下扫弦引擎 + 双声道 layer；含 strumming/pickOut 技法' },
  { name: 'omalley', genre: 'electronic', tempo: '147/2', kit: 'RolandTR909', instruments: 'gm_lead_1_square, gm_lead_8_bass_lead', note: '合成器 lead + bass lead' },
  { name: 'pumpupthejam', genre: 'electronic', tempo: '124.5', kit: 'RolandTR909', instruments: 'square, z_sawtooth, z_square', note: 'Technotronic 复刻；段落映射 + 立体声双件贝斯' },
  { name: 'rhythmofthenight', genre: 'electronic', tempo: '128', kit: 'RolandTR909', instruments: 'gm synth lead/strings/bass', note: 'Italo-dance 复刻；GM 合成 lead + strings' },
  { name: 'strangerthings', genre: 'electronic', tempo: '0.7 cps', kit: '', instruments: 'supersaw', note: '极简合成器波；perlin 滤波扫动 + detune superimpose' },
  { name: 'strudelwall', genre: 'electronic', tempo: '174', kit: '', instruments: 'gm_acoustic_guitar_steel', note: '快速律动' },
  { name: 'veronicainecstasy', genre: 'electronic', tempo: '120', kit: '', instruments: '', note: '合成器小品' },
  { name: 'veronicazigzag', genre: 'electronic', tempo: '105', kit: '', instruments: '', note: '合成器小品' },
  { name: 'woodeneye', genre: 'electronic', tempo: '', kit: '', instruments: 'gm_synth_bass_1', note: '合成器 bass' },

  // ── pop / rock / 复刻 ────────────────────────────────────────────────
  { name: 'anothersatellite', genre: 'pop-rock', tempo: '119', kit: 'RolandMT32', instruments: 'gm_oboe, gtr, triangle', note: '双簧管 lead 复刻' },
  { name: 'breakfastline', genre: 'pop-rock', tempo: '76/2', kit: 'AkaiLinn', instruments: 'gm_electric_bass_finger, gm_overdriven_guitar, gm_string_ensemble_2', note: '慢速摇滚；吉他 + 弦乐铺垫' },
  { name: 'bustybeez', genre: 'pop-rock', tempo: '182', kit: 'linn9000', instruments: 'gm_brass_section, gm_church_organ, gm_electric_bass_pick, gm_overdriven_guitar', note: '大编制摇滚；铜管 + 失真吉他' },
  { name: 'enjoythesilence', genre: 'pop-rock', tempo: '113', kit: 'AlesisHR16', instruments: 'ocarina, gtr, recorder_bass_sus, triangle', note: 'Depeche Mode 复刻；乐器函数化 layer + Dirt-Samples 加载' },
  { name: 'framartinocoldplayaro', genre: 'pop-rock', tempo: '120', kit: 'linn', instruments: 'gm_electric_bass_finger, gm_recorder', note: '流行；bass + recorder' },
  { name: 'happybirthday', genre: 'pop-rock', tempo: '120', kit: 'KorgDDM110', instruments: 'gm_electric_bass_finger, gm_harmonica', note: '生日歌变奏' },
  { name: 'happybirthdayramones', genre: 'pop-rock', tempo: '200', kit: 'Linn9000', instruments: 'gm_distortion_guitar, gm_electric_bass_finger', note: 'Ramones 朋克风生日歌' },
  { name: 'humanperformance', genre: 'pop-rock', tempo: '110', kit: '', instruments: 'gm_electric_bass_finger, gm_electric_guitar_clean, gm_tenor_sax', note: '吉他 + 萨克斯摇滚' },
  { name: 'jitterbug', genre: 'pop-rock', tempo: '115', kit: 'LinnDrum', instruments: 'gm_lead_1_square, gm_lead_2_sawtooth, gm_pad_choir', note: '合成 lead 复刻' },
  { name: 'jitterbugreverse', genre: 'pop-rock', tempo: '115/183', kit: '', instruments: 'gm_lead_1_square, gm_lead_2_sawtooth, gm_pad_choir, gm_rock_organ', note: 'jitterbug 的倒放变体' },
  { name: 'lovegoeson', genre: 'pop-rock', tempo: '150', kit: '', instruments: 'gm_acoustic_guitar_steel, gm_bassoon', note: '木吉他 + 巴松' },
  { name: 'mouthbreather', genre: 'pop-rock', tempo: '215', kit: '', instruments: 'gm_electric_bass_pick, gm_electric_guitar_clean', note: '高速吉他和贝斯' },
  { name: 'mouthbreathercomplex', genre: 'pop-rock', tempo: '215', kit: 'linn9000', instruments: 'gm_electric_bass_pick, gm_electric_guitar_clean', note: 'mouthbreather 的复杂编排版' },
  { name: 'piazzadegliaffari', genre: 'pop-rock', tempo: '104', kit: 'linndrum', instruments: 'gm_electric_bass_pick, gm_electric_guitar_clean, gm_overdriven_guitar', note: '意大利摇滚；多吉他层' },
  { name: 'pyramidsong', genre: 'pop-rock', tempo: '104', kit: 'Linn9000, RolandMT32', instruments: 'triangle, piano', note: 'Radiohead 复刻；命名段落整曲形式 + 多鼓机 pickOut' },
  { name: 'shedontusejelly', genre: 'pop-rock', tempo: '', kit: '', instruments: 'gm_electric_bass_finger, gm_overdriven_guitar', note: '另类摇滚；失真吉他' },
  { name: 'sparky', genre: 'pop-rock', tempo: '120', kit: 'AlesisHR16', instruments: 'gm_electric_bass_pick, gtr, ocarina, recorder_bass_sus', note: 'bass + Dirt-Samples gtr 律动' },
  { name: 'threefriends', genre: 'pop-rock', tempo: '126', kit: '', instruments: 'gm_choir_aahs, gm_church_organ, gm_drawbar_organ, gm_electric_bass_finger, gm_overdriven_guitar', note: '多键盘 + 吉他编制' },
  { name: 'togooffandthings', genre: 'pop-rock', tempo: '230', kit: '', instruments: 'gm_baritone_sax, gm_distortion_guitar, gm_electric_bass_finger, gm_synth_strings_1', note: '高速；上低音萨克斯 + 失真吉他' },
  { name: 'ventocaldo', genre: 'pop-rock', tempo: '', kit: 'Linn9000', instruments: 'gm_church_organ, gm_distortion_guitar, gm_drawbar_organ, gm_electric_bass_finger, gm_oboe', note: '多键盘 + 吉他 + 双簧管' },
  { name: 'vine', genre: 'pop-rock', tempo: '', kit: '', instruments: 'gm_acoustic_guitar_steel, gm_electric_bass_pick, gm_oboe, gm_overdriven_guitar', note: '木吉他 + 失真吉他' },
  { name: 'warsaw', genre: 'pop-rock', tempo: '160', kit: '', instruments: 'gm_acoustic_guitar_nylon, gm_pad_halo, gm_pad_poly', note: '尼龙吉他 + 合成 pad' },

  // ── classical / ambient / piano ──────────────────────────────────────
  { name: 'ameliewaltz', genre: 'classical', tempo: '64 cpm', kit: '', instruments: 'gm_harmonica', note: '圆舞曲（Amélie 风格）' },
  { name: 'byebyespirit', genre: 'classical', tempo: '140', kit: '', instruments: 'gm_pad_bowed, triangle', note: '氛围 pad' },
  { name: 'cadenza', genre: 'classical', tempo: '120/2', kit: '', instruments: 'gm_drawbar_organ, gm_electric_bass_finger, piano', note: '和弦织体；voicing+struct + cosine 力度自动化' },
  { name: 'heymoon', genre: 'classical', tempo: '88', kit: '', instruments: 'gm_pad_warm, gm_piccolo, supersaw', note: 'pad + piccolo 氛围' },
  { name: 'magicandecstasy', genre: 'classical', tempo: '145', kit: 'linn9000', instruments: 'gm choir/dulcimer/flute/violin/bass + supersaw', note: '大编制 GM 管弦化' },
  { name: 'madeallup', genre: 'classical', tempo: '', kit: 'Linn9000', instruments: 'gm_electric_bass_finger, gm_piano, triangle', note: 'bass + piano' },
  { name: 'mammalschilling', genre: 'classical', tempo: '', kit: '', instruments: 'gm_acoustic_guitar_nylon, gm_marimba, gm_pizzicato_strings, gm_trombone', note: '室内乐；尼龙吉他 + 马林巴 + 拨弦 + 长号' },
  { name: 'satiesfaction', genre: 'minimal', tempo: '185', kit: '', instruments: 'piano', note: '极简钢琴；调式漂移 + sine 母带 tremolo' },
  { name: 'swimmingsnake', genre: 'classical', tempo: '', kit: '', instruments: 'gm_pad_warm, gm_recorder, gm_synth_strings_2, supersaw, triangle', note: '氛围 pad + 竖笛' },
  { name: 'verminmangle', genre: 'classical', tempo: '52', kit: '', instruments: 'gm_accordion, gm_string_ensemble_2, gm_trumpet, gm_tuba, gm_vibraphone', note: '慢速管弦；手风琴 + 铜管 + 颤音琴' },
  { name: 'waltzno2', genre: 'classical', tempo: '', kit: '', instruments: 'gm_oboe', note: '圆舞曲（双簧管）' },

  // ── folk / world ─────────────────────────────────────────────────────
  { name: 'bigship', genre: 'folk', tempo: '120', kit: 'AkaiLinn', instruments: 'gm_drawbar_organ, gm_electric_bass_finger, gm_violin', note: 'organ + bass + 小提琴' },
  { name: 'budsandspawn', genre: 'folk', tempo: '165/4', kit: 'YamahaRY30', instruments: 'recorder_tenor_sus, sax, triangle', note: '竖笛 + 萨克斯民谣' },
  { name: 'bugfromheaven', genre: 'folk', tempo: '108/2', kit: 'BossDR110', instruments: 'gm_acoustic_guitar_steel, gm_pizzicato_strings, gm_string_ensemble_1', note: '叙事民谣；木吉他 + 拨弦' },
  { name: 'cinghiale', genre: 'folk', tempo: '', kit: 'YamahaRY30', instruments: 'sawtooth, triangle', note: '合成民谣律动' },
  { name: 'clandeisiciliani', genre: 'folk', tempo: '120.3', kit: 'AkaiLinn, AlesisHR16', instruments: 'gm_electric_bass_finger, gm_electric_guitar_jazz, gm_oboe, gm_synth_strings_2', note: '西西里民谣；多鼓机' },
  { name: 'elpueblo', genre: 'folk', tempo: '', kit: '', instruments: 'gm_acoustic_guitar_steel, gm_applause, gm_choir_aahs, gm_ocarina', note: '木吉他 + 埙 + 合唱' },
  { name: 'ilredelmondo', genre: 'folk', tempo: '', kit: 'YamahaRY30', instruments: 'recorder_tenor_sus, sax, triangle', note: '竖笛 + 萨克斯' },
  { name: 'oldmacdonald', genre: 'folk', tempo: '140/8', kit: '', instruments: 'gm_bird_tweet', note: '童趣；鸟鸣采样' },
  { name: 'tarantella', genre: 'folk', tempo: '140', kit: '', instruments: 'gm_clarinet, gm_harmonica, gm_tuba', note: '塔兰泰拉；共享随机 driver 驱动三件乐器' },

  // ── jazz / lounge ────────────────────────────────────────────────────
  { name: 'appealingtovenus', genre: 'jazz', tempo: '120', kit: '', instruments: 'gm_bassoon, gm_drawbar_organ, gm_oboe', note: '巴松 + organ + 双簧管' },
  { name: 'edenontheair', genre: 'jazz', tempo: '95/4', kit: '', instruments: 'gm_electric_guitar_jazz, gm_piccolo', note: '爵士吉他 + piccolo' },
  { name: 'eversoclosely', genre: 'jazz', tempo: '', kit: 'Linn9000', instruments: 'gm_church_organ, gm_electric_bass_finger, gm_ocarina, gm_overdriven_guitar, gm_reed_organ, gm_tenor_sax', note: '大编制爵士；萨克斯 + organ + 吉他' },
  { name: 'feeling37', genre: 'jazz', tempo: '185', kit: '', instruments: 'cajon, harmonica_soft, psaltery_pluck', note: '原声；cajon + 口琴 + 索尔特琴' },
  { name: 'oh', genre: 'jazz', tempo: '90', kit: 'AkaiLinn', instruments: 'gm_choir_aahs, gm_electric_bass_finger, gm_oboe, gm_piccolo, gm_string_ensemble_2', note: '合唱 + 双簧管 + 弦乐' },
  { name: 'oddeven', genre: 'jazz', tempo: '120', kit: '', instruments: 'gm_bassoon, gm_electric_guitar_jazz', note: '巴松 + 爵士吉他' },
  { name: 'shanghai', genre: 'jazz', tempo: '81', kit: '9000', instruments: 'gm_electric_bass_finger, triangle', note: 'King Gizzard 风格；psychedelic 律动' },
  { name: 'swimandsleep', genre: 'jazz', tempo: '', kit: 'Linn9000', instruments: 'gm_electric_guitar_jazz, gm_ocarina', note: '爵士吉他 + 埙' },

  // ── 教学/示例（含和声、琶音模块化） ─────────────────────────────────
  { name: 'whydoesmybrain', genre: 'minimal', tempo: '98/4×2', kit: '', instruments: 'piano', note: '和弦/琶音模块化教学；mychords+myarps 字典 + .arp()' },
];

// 流派分组（供 fetch_song({genre}) 精简返回）
export const GENRES = ['electronic', 'pop-rock', 'classical', 'folk', 'jazz', 'minimal'];
