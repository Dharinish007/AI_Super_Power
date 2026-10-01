/**
 * Builds assets/gemma4-tokenizer.bin from Gemma 4's tokenizer.json, the tokenizer Google's own SDK uses
 * for current Gemini models (googleapis/python-genai _local_tokenizer_loader.py: gemini-3.5-flash,
 * gemini-3.1-pro -> "gemma4" -> google/gemma-4-E4B-it, Apache-2.0).
 *
 * Only what counting needs ships: the BPE merges as vocab ids [left, right, result] in rank order, the
 * single-character vocab and the byte-fallback ids. Token strings are never needed at runtime.
 *
 * Layout (little-endian uint32 unless noted):
 *   magic "GEM4" | mergeCount | merges (3 x mergeCount) | byteIds (256) | jsonLength | JSON (utf-8):
 *   { chars: { char: id }, added: [string] }
 *
 * Run: node scripts/build-gemma-tokenizer.js  (downloads vendor/gemma4-tokenizer.json when missing)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(rootDir, 'vendor', 'gemma4-tokenizer.json');
const OUT = path.join(rootDir, 'assets', 'gemma4-tokenizer.bin');
const URL = 'https://huggingface.co/google/gemma-4-E4B-it/resolve/main/tokenizer.json';
// Hugging Face LFS sha256 of tokenizer.json (checked 2026-10-01)
const SHA256 = 'cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f';

if (!fs.existsSync(SOURCE)) {
  console.log(`[Gemma] Downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`[Gemma] Download failed: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(SOURCE), { recursive: true });
  fs.writeFileSync(SOURCE, Buffer.from(await res.arrayBuffer()));
}
const raw = fs.readFileSync(SOURCE);
const hash = crypto.createHash('sha256').update(raw).digest('hex');
if (hash !== SHA256) throw new Error(`[Gemma] tokenizer.json sha256 ${hash} does not match the pinned ${SHA256}`);

const tok = JSON.parse(raw.toString('utf8'));
const { model } = tok;
// The counter implements exactly this pipeline; anything else is a new tokenizer that needs new code
const expect = (ok, what) => { if (!ok) throw new Error(`[Gemma] Unexpected tokenizer.json: ${what}`); };
expect(model.type === 'BPE' && model.byte_fallback === true && !model.ignore_merges && !model.dropout, 'model is not plain byte-fallback BPE');
expect(!model.continuing_subword_prefix && !model.end_of_word_suffix, 'subword prefix/suffix');
expect(JSON.stringify(tok.normalizer) === JSON.stringify({ type: 'Replace', pattern: { String: ' ' }, content: '▁' }), 'normalizer');
expect(tok.pre_tokenizer?.type === 'Split' && tok.pre_tokenizer.pattern?.String === ' ', 'pre_tokenizer');
expect(!tok.post_processor?.single?.some(s => s.SpecialToken), 'post_processor adds special tokens');

const vocab = model.vocab;
const merges = model.merges.map(m => (Array.isArray(m) ? m : m.split(' ')));
const buf = new Uint32Array(merges.length * 3);
merges.forEach(([a, b], i) => {
  const ids = [vocab[a], vocab[b], vocab[a + b]];
  expect(ids.every(Number.isInteger), `merge ${i} has a token outside the vocab`);
  buf.set(ids, i * 3);
});
const chars = {};
for (const [t, id] of Object.entries(vocab)) if ([...t].length === 1) chars[t] = id;
const byteIds = new Uint32Array(256);
for (let b = 0; b < 256; b++) {
  const id = vocab[`<0x${b.toString(16).toUpperCase().padStart(2, '0')}>`];
  expect(Number.isInteger(id), `byte token ${b}`);
  byteIds[b] = id;
}
const json = Buffer.from(JSON.stringify({ chars, added: tok.added_tokens.map(t => t.content) }), 'utf8');

const header = Buffer.alloc(8);
header.write('GEM4', 0, 'ascii');
header.writeUInt32LE(merges.length, 4);
const len = Buffer.alloc(4);
len.writeUInt32LE(json.length, 0);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, Buffer.from(buf.buffer), Buffer.from(byteIds.buffer), len, json]));
console.log(`[Gemma] Wrote ${path.relative(rootDir, OUT)}: ${merges.length} merges, ${Object.keys(chars).length} chars, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
