/* The smallest PNG reader that can read a Playwright screenshot.
 *
 * The contrast audit measures *pixels* (tests/contrast.mjs), and the only pixels it can get are
 * the ones the browser painted. Decoding them needs no new dependency: a Chromium screenshot is
 * an 8-bit, non-interlaced, truecolour PNG, which is zlib (built in) plus the five scanline
 * filters the format defines. Anything else — 16-bit, palette, interlaced — is refused loudly
 * rather than mis-read, because a mis-read pixel is a contrast number that is quietly wrong.
 */
import zlib from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('PNG has no IHDR');
  if (ihdr.bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${ihdr.bitDepth}`);
  if (ihdr.interlace) throw new Error('interlaced PNGs are not supported');
  if (ihdr.colorType !== 6 && ihdr.colorType !== 2) throw new Error(`unsupported PNG colour type ${ihdr.colorType}`);
  const channels = ihdr.colorType === 6 ? 4 : 3;

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const w = ihdr.width, h = ihdr.height;
  const stride = w * channels;
  const out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[o++];
    for (let x = 0; x < stride; x++) cur[x] = raw[o + x];
    unfilter(filter, cur, prev, channels);
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = cur[x * channels];
      out[(y * w + x) * 4 + 1] = cur[x * channels + 1];
      out[(y * w + x) * 4 + 2] = cur[x * channels + 2];
      out[(y * w + x) * 4 + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    prev.set(cur);
    o += stride;
  }
  return { width: w, height: h, data: out };
}

/* The five filters, applied in place on one scanline. `a` = left, `b` = up, `c` = up-left. */
function unfilter(filter, cur, prev, channels) {
  switch (filter) {
    case 0: return;
    case 1:
      for (let i = channels; i < cur.length; i++) cur[i] = (cur[i] + cur[i - channels]) & 255;
      return;
    case 2:
      for (let i = 0; i < cur.length; i++) cur[i] = (cur[i] + prev[i]) & 255;
      return;
    case 3:
      for (let i = 0; i < cur.length; i++) {
        const a = i >= channels ? cur[i - channels] : 0;
        cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 255;
      }
      return;
    case 4: {
      for (let i = 0; i < cur.length; i++) {
        const a = i >= channels ? cur[i - channels] : 0;
        const c = i >= channels ? prev[i - channels] : 0;
        const p = a + prev[i] - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - prev[i]), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? prev[i] : c;
        cur[i] = (cur[i] + pred) & 255;
      }
      return;
    }
    default: throw new Error(`unknown PNG filter ${filter}`);
  }
}
