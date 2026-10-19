/**
 * Pure Node.js PNG icon generator for JellyTime.
 * Zero dependencies — uses only built-in `zlib` and `fs`.
 * Outputs: public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png
 */

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// ── CRC32 ──────────────────────────────────────────────────────────────────
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── PNG helpers ────────────────────────────────────────────────────────────
function uint32BE(n) {
  return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = uint32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  return Buffer.concat([lenBuf, typeBytes, data, uint32BE(crc32(crcInput))]);
}

function makePNG(size, drawFn) {
  // Build raw pixel rows (filter byte 0 = None prepended to each row)
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      const [r, g, b] = drawFn(x, y);
      row[1 + x * 3] = r;
      row[1 + x * 3 + 1] = g;
      row[1 + x * 3 + 2] = b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.concat([
    uint32BE(size), uint32BE(size),
    Buffer.from([8, 2, 0, 0, 0]) // bit depth 8, color type 2 (RGB), compression/filter/interlace
  ]);
  const ihdr = chunk('IHDR', ihdrData);
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── Drawing ────────────────────────────────────────────────────────────────
// Colors
const BG   = [0x1a, 0x1a, 0x2e];  // dark navy
const CIRC = [0x7c, 0x3a, 0xed];  // purple
const WHITE = [0xff, 0xff, 0xff];

function draw(size) {
  const cx = size / 2;
  const cy = size / 2;
  const circR = size * 0.40;            // circle radius 40% of width

  // Film strip proportions (relative to circle)
  const stripH = circR * 0.35;          // height of center film bar
  const stripW = circR * 1.55;          // width of film bar (spans circle)
  const holeSize = stripH * 0.70;       // square sprocket holes
  const holeGap = holeSize * 0.55;      // gap between holes

  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > circR) return BG;

    // Film center bar
    const inBarX = Math.abs(dx) <= stripW / 2;
    const inBarY = Math.abs(dy) <= stripH / 2;

    if (inBarX && inBarY) {
      // Sprocket holes on left and right inside the bar
      // Three holes per side, centered vertically, evenly spaced
      for (const side of [-1, 1]) {
        const holeBaseX = side * (circR * 0.62);
        for (let i = -1; i <= 1; i++) {
          const hx = holeBaseX;
          const hy = i * (holeSize + holeGap);
          if (
            Math.abs(dx - hx) <= holeSize / 2 &&
            Math.abs(dy - hy) <= holeSize / 2
          ) {
            return CIRC; // hole punched through shows circle color
          }
        }
      }
      return WHITE;
    }

    return CIRC;
  };
}

// ── Generate ───────────────────────────────────────────────────────────────
mkdirSync(publicDir, { recursive: true });

for (const [filename, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  const png = makePNG(size, draw(size));
  writeFileSync(join(publicDir, filename), png);
  console.log(`Generated ${filename} (${size}x${size})`);
}
