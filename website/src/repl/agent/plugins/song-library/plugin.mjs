// plugin.mjs — song-library 插件：按需从 eefano/strudel-songs-collection 取真实曲目。
//
// 设计取舍（为什么这样做）：
// - knowledge.mjs 教的是「抽象技法」，但用户要翻唱某曲 / 某风格时，agent 拉一首真实的
//   完整作品进来当对标，再改编（改音符/音色/速度），比凭空生成稳得多。
// - catalog（曲目索引）是离线的：浏览「有什么、什么风格」不联网；只在选定某首后才
//   联网拉代码。省 token、省请求。
// - 走 jsDelivr raw（https://cdn.jsdelivr.net/gh/USER/REPO@BRANCH/file.js）：浏览器 CORS
//   友好（access-control-allow-origin: *），单文件 <3KB 稳通。GitHub raw 在部分网络
//   （如 CN）常被阻断，故不直接用。
// - 内置受信插件（同 web-research）：直接用浏览器全局 fetch，只打 jsDelivr 这一个公开端点。
// - 产物是「曲目代码 + 元数据」回灌给 LLM，由它改编后调 write_code 落地（单一写入口）。

import { jsonSchema } from 'ai';
import { CATALOG, REPO, BRANCH, GENRES } from './catalog.mjs';
import { SONG_LIBRARY_MAX_CODE_CHARS as MAX_CODE_CHARS } from '../../config.mjs';

const JSDELIVR_BASE = `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/`;

// ── catalog 查询（离线）──────────────────────────────────────────────
function findMeta(name) {
  return CATALOG.find((s) => s.name === name) || null;
}

function formatRow(s) {
  return `- ${s.name} [${s.genre}] ${s.tempo ? s.tempo + ' BPM  ' : ''}${s.instruments ? s.instruments + '  ' : ''}— ${s.note}`;
}

function catalogForGenre(genre) {
  const g = String(genre || '').trim().toLowerCase();
  // 容错：pop-rock 也接受 pop / rock；classical 接受 ambient/piano
  const match = (s) =>
    g === '' ||
    s.genre === g ||
    (g === 'pop' && s.genre === 'pop-rock') ||
    (g === 'rock' && s.genre === 'pop-rock') ||
    (g === 'ambient' && (s.genre === 'classical' || s.genre === 'minimal')) ||
    (g === 'piano' && (s.genre === 'classical' || s.genre === 'minimal'));
  const rows = CATALOG.filter(match).map(formatRow);
  return rows.length
    ? `Songs in genre "${genre}" (${rows.length}):\n${rows.join('\n')}\n\nCall fetch_song again with the chosen "name" to pull its full code.`
    : `No songs match genre "${genre}". Known genres: ${GENRES.join(', ')}.`;
}

function fullCatalog() {
  const byGenre = {};
  for (const g of GENRES) byGenre[g] = [];
  for (const s of CATALOG) (byGenre[s.genre] ||= []).push(s.name);
  const body = GENRES.map((g) => `  ${g}: ${(byGenre[g] || []).join(', ')}`).join('\n');
  return `Song library — ${CATALOG.length} curated Strudel songs (${REPO}). By genre:\n${body}\n\nCall fetch_song with a "name" to pull full code, or with a "genre" to list that genre only.`;
}

// ── 取代码（联网）─────────────────────────────────────────────────────
async function fetchCode(name) {
  const url = `${JSDELIVR_BASE}${name}.js`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return {
      err: `fetch_song: network error fetching ${name} (${e?.message || e}). jsDelivr may be unreachable; fall back to the distilled ARRANGEMENT/LIVING PATTERNS knowledge and write from scratch.`,
    };
  }
  if (!res.ok) {
    const sample = CATALOG.slice(0, 12).map((s) => s.name).join(', ');
    return {
      err: `fetch_song: ${name} not found (HTTP ${res.status}). Check the name against the catalog; e.g. ${sample}. Call fetch_song with no args to browse.`,
    };
  }
  let code;
  try {
    code = await res.text();
  } catch (e) {
    return { err: `fetch_song: failed reading body for ${name} (${e?.message || e}).` };
  }
  const truncated = code.length > MAX_CODE_CHARS;
  return { code: code.slice(0, MAX_CODE_CHARS) + (truncated ? '\n// [...truncated]' : '') };
}

async function fetchSong(input) {
  const name = typeof input?.name === 'string' ? input.name.trim().toLowerCase() : '';
  const genre = typeof input?.genre === 'string' ? input.genre.trim() : '';

  // 模式 1：给 name → 拉代码
  if (name) {
    const { code, err } = await fetchCode(name);
    if (err) return err;
    const meta = findMeta(name);
    const head = meta
      ? `"${name}" — ${meta.genre}${meta.tempo ? `, ${meta.tempo} BPM` : ''}${meta.instruments ? `, ${meta.instruments}` : ''}. ${meta.note}`
      : `"${name}" (not in catalog metadata; fetched raw).`;
    return (
      `${head}\n\nSource: ${JSDELIVR_BASE}${name}.js\n\n` +
      `ADAPT, DO NOT COPY VERBATIM: treat this as a reference for structure/technique. ` +
      `Change notes, swap sounds for ones that load locally (synths / piano / vcsl), adjust tempo, and make it your own. ` +
      `Then call write_code.\n\n\`\`\`js\n${code}\n\`\`\``
    );
  }

  // 模式 2：给 genre → 返回该流派曲目（不联网）
  if (genre) return catalogForGenre(genre);

  // 模式 3：都不给 → 精简全目录
  return fullCatalog();
}

const plugin = {
  id: 'song-library',
  version: '0.1.0',
  description:
    'Browse and fetch real production Strudel songs from the curated eefano/strudel-songs-collection (68 songs). Lets the agent pull a complete reference track to adapt when the user wants a specific style or cover. Catalog is offline-browseable; only fetching a song hits the network (jsDelivr).',

  tools: [
    {
      name: 'fetch_song',
      description:
        'Pull a real, complete Strudel song from the curated song-library to use as a structural/technique reference. Three modes: (1) fetch_song({ name }) — get the FULL CODE of a named song + its metadata (genre/tempo/instruments); (2) fetch_song({ genre }) — list the songs in a genre ("electronic","pop-rock","classical","folk","jazz","minimal") without fetching code; (3) fetch_song() with no args — show the whole catalog grouped by genre. Use mode (2) or (3) first if you do not know an exact name. Always ADAPT the fetched song (change notes, swap sounds for locally-loadable ones, retune tempo) — never paste it verbatim. After reading, call write_code to commit your adapted version.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Exact song file name (without .js), e.g. "pumpupthejam", "cadenza", "tarantella". Call with genre/no-args first if unsure.',
          },
          genre: {
            type: 'string',
            description:
              'One of: electronic, pop-rock, classical, folk, jazz, minimal. Returns the song list for that genre (no code fetched).',
          },
        },
      }),
      execute: async (input) => fetchSong(input),
    },
  ],
};

export default plugin;
