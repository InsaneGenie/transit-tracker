// Writes a .br and .gz copy beside each built text file, so the server can send them compressed
// without spending its small CPU allowance squeezing a megabyte of JavaScript on the first visit.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = path.resolve(import.meta.dirname, '../dist');
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.webmanifest', '.ico']);

let before = 0;
let after = 0;
for (const entry of await readdir(dist, { recursive: true, withFileTypes: true })) {
  const file = path.join(entry.parentPath, entry.name);
  if (!entry.isFile() || !COMPRESSIBLE.has(path.extname(file))) continue;
  const data = await readFile(file);
  if (data.length < 1024) continue;
  const br = brotliCompressSync(data, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
  });
  await writeFile(`${file}.br`, br);
  await writeFile(`${file}.gz`, gzipSync(data, { level: 9 }));
  before += data.length;
  after += br.length;
}
console.log(`precompressed: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB with brotli`);
