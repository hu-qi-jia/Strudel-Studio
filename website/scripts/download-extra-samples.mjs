/**
 * 下载 uzu-drumkit 和 mridangam 采样到本地
 * 这两个采样库的 _base 指向 raw.githubusercontent.com，国内不可达。
 * 改用 jsDelivr CDN 下载，然后修改 _base 指向本地路径。
 *
 * 运行：NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/download-extra-samples.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'website', 'public');

// 要本地化的采样库配置
const LIBRARIES = [
  {
    name: 'uzu-drumkit',
    manifestPath: path.join(PUBLIC_DIR, 'uzu-drumkit.json'),
    localDir: path.join(PUBLIC_DIR, 'samples', 'uzu-drumkit'),
    localBase: '/samples/uzu-drumkit/',
    // raw.githubusercontent.com 不可达，改用 jsDelivr
    jsdelivrBase: 'https://cdn.jsdelivr.net/gh/tidalcycles/uzu-drumkit@main/',
  },
  {
    name: 'mridangam',
    manifestPath: path.join(PUBLIC_DIR, 'mridangam.json'),
    localDir: path.join(PUBLIC_DIR, 'samples', 'mridangam'),
    localBase: '/samples/mridangam/',
    jsdelivrBase: 'https://cdn.jsdelivr.net/gh/yaxu/mrid@main/',
  },
];

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

async function processLibrary(lib) {
  console.log(`\n=== ${lib.name} ===`);
  const manifest = JSON.parse(fs.readFileSync(lib.manifestPath, 'utf8'));
  const banks = Object.entries(manifest).filter(([k]) => k !== '_base');
  const allFiles = new Set();
  for (const [key, files] of banks) {
    if (Array.isArray(files)) {
      for (const f of files) allFiles.add(f);
    }
  }
  console.log(`Banks: ${banks.length}, Files: ${allFiles.size}`);

  let ok = 0;
  let fail = 0;
  const failures = [];

  for (const file of allFiles) {
    const url = lib.jsdelivrBase + file;
    const destPath = path.join(lib.localDir, file);
    if (fs.existsSync(destPath)) {
      ok++;
      continue; // 已下载，跳过
    }
    try {
      const size = await downloadFile(url, destPath);
      ok++;
      if (ok % 10 === 0) console.log(`  ${ok}/${allFiles.size}...`);
    } catch (e) {
      fail++;
      failures.push({ file, error: e.message });
    }
  }

  console.log(`Downloaded: ${ok} OK, ${fail} FAIL`);
  if (failures.length > 0) {
    console.log('Failures:', failures.slice(0, 5));
  }

  // 修改 manifest 的 _base 指向本地
  manifest._base = lib.localBase;
  fs.writeFileSync(lib.manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Updated _base to: ${lib.localBase}`);
}

async function main() {
  for (const lib of LIBRARIES) {
    await processLibrary(lib);
  }
  console.log('\n=== Done ===');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
