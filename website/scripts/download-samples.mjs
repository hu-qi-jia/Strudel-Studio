#!/usr/bin/env node
/**
 * Download essential dirt-samples locally so they work without jsDelivr / raw.githubusercontent.com.
 *
 * Why: The tidalcycles/Dirt-Samples repo is >50MB, so jsDelivr returns 403 "Package size
 * exceeded". raw.githubusercontent.com is slow / unreachable on many networks (notably CN).
 * This script downloads the essential drum/percussion banks to website/public/samples/dirt-samples/
 * and writes a local manifest (website/public/dirt-samples.json) that prebake.mjs loads
 * instead of the GitHub URL.
 *
 * Usage:
 *   node website/scripts/download-samples.mjs
 */
import { mkdir, writeFile, access } from 'fs/promises';
import { createWriteStream } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SAMPLES_DIR = join(PROJECT_ROOT, 'public', 'samples', 'dirt-samples');
const MANIFEST_PATH = join(PROJECT_ROOT, 'public', 'dirt-samples.json');

// Essential drum/percussion banks. These are the sounds referenced in the agent's
// CORE_PROMPT ("Common drums: bd sd hh oh cp rim rs lt mt ch") plus a few extras
// (cr/rd/cb/cl/ht/tom/perc) that patterns frequently use.
// For each bank, download up to MAX_PER_BANK samples (most patterns only use :0..:4).
const ESSENTIAL_BANKS = [
  'bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'rs', 'lt', 'mt', 'ht', 'ch',
  'cr', 'rd', 'cb', 'cl', 'tom', 'perc', 'sn', 'kick', 'snare',
];
const MAX_PER_BANK = 6; // first 6 samples per bank is enough for s("bd:0")..s("bd:5")

// Also download these full small banks (they're small and commonly used)
const FULL_BANKS = [
  'casio', 'crow', 'insect', 'wind', 'jazz', 'metal', 'east', 'space',
  'numbers', 'num', 'birds', 'bleep', 'blip', 'bottle', 'can', 'coins',
  'click', 'clak', 'breath', 'bubble', 'circus', 'dork2', 'drum',
];

const STRUDEL_JSON_URL = 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/strudel.json';
const RAW_BASE = 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/';

// jsDelivr mirror — try first for speed, fall back to raw.githubusercontent.com.
// (jsDelivr may 403 the whole repo for >50MB, but individual file requests sometimes
// still work because they're cached at the edge. If not, raw.* is the fallback.)
const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/gh/tidalcycles/Dirt-Samples@master/';

function log(...args) {
  console.log('[download-samples]', ...args);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Download a single file with retry + mirror fallback.
async function downloadFile(relPath, destPath) {
  // Check if already downloaded (skip on re-run)
  try {
    await access(destPath);
    return true; // already exists
  } catch {
    // not exists, proceed
  }

  const urls = [
    JSDELIVR_BASE + relPath,
    RAW_BASE + relPath,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, buf);
      return true;
    } catch {
      // try next mirror
    }
  }
  return false;
}

async function main() {
  log('Fetching strudel.json...');
  const manifest = await fetchJson(STRUDEL_JSON_URL);
  log(`Got ${Object.keys(manifest).length - 1} banks (excluding _base)`);

  const localManifest = { _base: '/samples/dirt-samples/' };
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const failedFiles = [];

  // Process essential banks (first N samples)
  for (const bank of ESSENTIAL_BANKS) {
    const files = manifest[bank];
    if (!files || !Array.isArray(files)) {
      log(`  bank "${bank}" not found in manifest, skipping`);
      continue;
    }
    const toDownload = files.slice(0, MAX_PER_BANK);
    log(`  bank "${bank}": downloading ${toDownload.length}/${files.length} samples`);
    const localFiles = [];
    // Download in parallel batches of 4
    for (let i = 0; i < toDownload.length; i += 4) {
      const batch = toDownload.slice(i, i + 4);
      const results = await Promise.all(
        batch.map(async (relPath) => {
          const destPath = join(SAMPLES_DIR, relPath);
          const ok = await downloadFile(relPath, destPath);
          return { relPath, ok };
        }),
      );
      for (const { relPath, ok } of results) {
        if (ok) {
          localFiles.push(relPath);
          downloaded++;
        } else {
          failed++;
          failedFiles.push(relPath);
        }
      }
    }
    if (localFiles.length > 0) {
      localManifest[bank] = localFiles;
    }
  }

  // Process full banks (all samples)
  for (const bank of FULL_BANKS) {
    const files = manifest[bank];
    if (!files || !Array.isArray(files)) {
      continue;
    }
    log(`  bank "${bank}": downloading all ${files.length} samples`);
    const localFiles = [];
    for (let i = 0; i < files.length; i += 4) {
      const batch = files.slice(i, i + 4);
      const results = await Promise.all(
        batch.map(async (relPath) => {
          const destPath = join(SAMPLES_DIR, relPath);
          const ok = await downloadFile(relPath, destPath);
          return { relPath, ok };
        }),
      );
      for (const { relPath, ok } of results) {
        if (ok) {
          localFiles.push(relPath);
          downloaded++;
        } else {
          failed++;
          failedFiles.push(relPath);
        }
      }
    }
    if (localFiles.length > 0) {
      localManifest[bank] = localFiles;
    }
  }

  // Write local manifest
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(localManifest, null, 2), 'utf8');
  log(`\nDone! Downloaded: ${downloaded}, Failed: ${failed}`);
  log(`Local manifest: ${MANIFEST_PATH}`);
  log(`Samples directory: ${SAMPLES_DIR}`);
  log(`Banks in manifest: ${Object.keys(localManifest).length - 1}`);

  if (failedFiles.length > 0) {
    log(`\nFailed files (${failedFiles.length}):`);
    failedFiles.slice(0, 20).forEach((f) => log(`  ${f}`));
    if (failedFiles.length > 20) log(`  ... and ${failedFiles.length - 20} more`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
