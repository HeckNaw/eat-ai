/**
 * Generate the home-screen icons.
 *
 * Written by hand rather than pulled from a library because the icon is three
 * shapes and a PNG encoder is thirty lines of zlib — adding sharp or canvas to
 * get a flat circle would be the larger cost. Run once; the output is committed.
 *
 *   node scripts/make-icons.mjs
 *
 * Geometry matches the inline SVG favicon in index.html, so the tab icon and
 * the home-screen icon are the same mark. No alpha channel and no rounded
 * corners: both iOS and Android apply their own mask, and a pre-rounded square
 * gets rounded twice.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUB = join(dirname(dirname(fileURLToPath(import.meta.url))), "public");

const BG = [0x14, 0x10, 0x0e];    // warm charcoal
const RING = [0xff, 0x5c, 0x3c];  // coral
const DOT = [0x4f, 0xe0, 0xa8];   // mint

// In the SVG's 100-unit space: ring r=22 stroke 9 (so 17.5..26.5), dot r=5.
const RING_IN = 17.5;
const RING_OUT = 26.5;
const DOT_R = 5;
const SS = 4; // supersampling factor per axis — 16 samples/pixel

function colourAt(u, v) {
  const r = Math.hypot(u - 50, v - 50);
  if (r <= DOT_R) return DOT;
  if (r >= RING_IN && r <= RING_OUT) return RING;
  return BG;
}

/** RGB pixel rows, antialiased by averaging SS×SS samples. */
function render(size) {
  const rows = [];
  const unit = 100 / size;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 3);
    for (let x = 0; x < size; x++) {
      let rs = 0, gs = 0, bs = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colourAt((x + (sx + 0.5) / SS) * unit, (y + (sy + 0.5) / SS) * unit);
          rs += c[0]; gs += c[1]; bs += c[2];
        }
      }
      const n = SS * SS;
      row[x * 3] = Math.round(rs / n);
      row[x * 3 + 1] = Math.round(gs / n);
      row[x * 3 + 2] = Math.round(bs / n);
    }
    rows.push(row);
  }
  return rows;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type 2 = truecolour RGB, no alpha
  // 10..12 = compression, filter, interlace — all 0

  // Filter type 0 (None) per scanline. The image is mostly flat colour, so
  // deflate handles it well without a smarter filter.
  const raw = Buffer.concat(render(size).flatMap((row) => [Buffer.from([0]), row]));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [180, 192, 512]) {
  const out = png(size);
  writeFileSync(join(PUB, `icon-${size}.png`), out);
  console.log(`public/icon-${size}.png  ${(out.length / 1024).toFixed(1)}KB`);
}
