import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/**
 * Render's free plan allows 5 GB a month of data sent out. Vehicle lists are plain JSON that shrinks
 * about tenfold when compressed, and every browser and the iPhone app accept it, so everything worth
 * shrinking is sent compressed.
 */
export type Encoding = 'br' | 'gzip';

/** Smaller than this, compressing saves less than the headers it adds. */
const MIN_BYTES = 1024;

/** Types that are already compressed (images, fonts) gain nothing from it. */
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/(svg|x-icon))/;

/** The best encoding this request accepts, if any. */
export function pickEncoding(acceptEncoding: string | string[] | undefined): Encoding | null {
  const accepted = new Map<string, number>();
  for (const part of String(acceptEncoding ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepted.set(name.trim(), q ? Number(q.slice(2)) : 1);
  }
  const ok = (name: string) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : null;
}

export function shouldCompress(contentType: string, bytes: number): boolean {
  return bytes >= MIN_BYTES && COMPRESSIBLE.test(contentType);
}

/** Live data is compressed on every request, so a quick setting: a few milliseconds for a whole city. */
export function compress(body: Buffer, encoding: Encoding): Buffer {
  if (encoding === 'gzip') return gzipSync(body, { level: 5 });
  return brotliCompressSync(body, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 5,
      [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    },
  });
}

/** Compressed copies of files that never change, by file and encoding. */
const cache = new Map<string, Buffer>();

/**
 * A file's compressed copy: the one the web build wrote beside it (`app.js.br`), or else one made
 * quickly the first time it is asked for. Squeezing hard here would hold up every other request.
 */
export async function compressFile(file: string, body: Buffer, encoding: Encoding): Promise<Buffer> {
  const id = `${encoding}:${file}`;
  let out = cache.get(id);
  if (!out) {
    out = (await readFile(`${file}.${encoding === 'br' ? 'br' : 'gz'}`).catch(() => null)) ?? compress(body, encoding);
    cache.set(id, out);
  }
  return out;
}
