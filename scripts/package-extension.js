/**
 * AI Context Monitor - Packaging Script
 * 
 * Creates a clean release zip archive for Chrome Web Store distribution,
 * adhering to store guidelines (omitting git, tests, scratch files).
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

console.log('[Packager] Preparing release bundle for AI Context Monitor...');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Essential production files, read from the manifest so a newly declared script can never be left out
// (config/*.json is inlined into content-script.js by the build, so it is not needed at runtime)
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8'));
const filesToInclude = [...new Set([
  'manifest.json',
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap(cs => cs.js || []),
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.web_accessible_resources || []).flatMap(w => w.resources),
  ...(manifest.side_panel ? [manifest.side_panel.default_path, path.posix.join(path.posix.dirname(manifest.side_panel.default_path), 'sidepanel.js')] : [])
])];

// Verify all files exist
let totalBytes = 0;
for (const relPath of filesToInclude) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Missing essential file: ${relPath}`);
    process.exit(1);
  }
  const stat = fs.statSync(fullPath);
  totalBytes += stat.size;
  console.log(`  + ${relPath} (${(stat.size / 1024).toFixed(1)} KB)`);
}

console.log(`\n✅ Verified ${filesToInclude.length} production files totaling ${(totalBytes / 1024).toFixed(1)} KB.`);

/**
 * Minimal zip writer (deflate, no zip64): enough for a few-MB extension, with no dependency.
 * ponytail: no zip64; files and archive must stay under 4 GB.
 * @param {Array<{ name: string, data: Buffer }>} entries
 * @returns {Buffer}
 */
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  // Fixed timestamp (1980-01-01) so the same sources always give the same archive
  const DOS_TIME = 0;
  const DOS_DATE = (1 << 5) | 1;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12); dir.writeUInt16LE(DOS_DATE, 14); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuf, end]);
}

const zipPath = path.join(distDir, `ai-context-monitor-${manifest.version}.zip`);
fs.writeFileSync(zipPath, zip(filesToInclude.map(rel => ({ name: rel, data: fs.readFileSync(path.join(rootDir, rel)) }))));
console.log(`📦 Store upload: ${path.relative(rootDir, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)\n`);
