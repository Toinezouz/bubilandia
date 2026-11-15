// Generates the PNG app icons into public/ with no dependency (node:zlib only).
// Design: dark background + coral dumbbell, kept inside the maskable safe zone.
// Run: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [0x0f, 0x11, 0x15];
const FG = [0xf9, 0x73, 0x62];
const SS = 4; // supersampling for anti-aliasing

// Dumbbell in a 0..1 unit square: [x, y, w, h, cornerRadius]. Fits within the central 60%.
const SHAPES = [
  [0.2, 0.47, 0.6, 0.06, 0.02], // bar
  [0.26, 0.32, 0.08, 0.36, 0.03], // inner plates
  [0.66, 0.32, 0.08, 0.36, 0.03],
  [0.2, 0.37, 0.05, 0.26, 0.02], // outer plates
  [0.75, 0.37, 0.05, 0.26, 0.02],
];

function insideRoundRect(px, py, [x, y, w, h, r]) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function render(size, scale) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte + RGB
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Map pixel to unit square, scaled around the centre.
          const u = 0.5 + (((x + (sx + 0.5) / SS) / size) - 0.5) / scale;
          const v = 0.5 + (((y + (sy + 0.5) / SS) / size) - 0.5) / scale;
          if (SHAPES.some((s) => insideRoundRect(u, v, s))) hits++;
        }
      }
      const a = hits / (SS * SS);
      for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
    rows.push(row);
  }
  return encodePng(size, Buffer.concat(rows));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['apple-touch-icon.png', 180, 1.15], // iOS rounds the corners itself
  ['pwa-192.png', 192, 1.15],
  ['pwa-512.png', 512, 1.15],
  ['pwa-512-maskable.png', 512, 1.0], // stays inside the 80% safe zone
  ['favicon.png', 64, 1.3],
];
for (const [name, size, scale] of targets) {
  writeFileSync(join(OUT, name), render(size, scale));
  console.log(`✓ public/${name} (${size}×${size})`);
}
