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

// ─── iOS launch screens ─────────────────────────────────────────────────────────
// iOS shows a blank screen while an installed web app starts unless it finds an
// apple-touch-startup-image of exactly the device's pixel size. One portrait image per
// iPhone screen size: dark background, dumbbell in the centre.
// [CSS width, CSS height, device pixel ratio]
export const SPLASH_SCREENS = [
  [440, 956, 3], // 16 / 17 Pro Max
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [420, 912, 3], // Air
  [430, 932, 3], // 14 Pro Max, 15 / 16 Plus, 15 Pro Max
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12 / 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14 (and Pro)
  [375, 812, 3], // X, XS, 11 Pro, 12 / 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [414, 736, 3], // 8 Plus
  [375, 667, 2], // SE (2nd / 3rd gen), 8
];

function renderSplash(width, height) {
  const icon = Math.round(width * 0.34); // dumbbell box, centred
  const left = Math.round((width - icon) / 2);
  const top = Math.round((height - icon) / 2);
  const background = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) background.set(BG, 1 + x * 3);

  const rows = [];
  for (let y = 0; y < height; y++) {
    if (y < top || y >= top + icon) {
      rows.push(background); // plain background row, shared
      continue;
    }
    const row = Buffer.from(background);
    for (let x = left; x < left + icon; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x - left + (sx + 0.5) / SS) / icon;
          const v = (y - top + (sy + 0.5) / SS) / icon;
          if (SHAPES.some((shape) => insideRoundRect(u, v, shape))) hits++;
        }
      }
      if (hits === 0) continue;
      const a = hits / (SS * SS);
      for (let c = 0; c < 3; c++) row[1 + x * 3 + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
    rows.push(row);
  }
  return encodePngRect(width, height, Buffer.concat(rows));
}

function encodePngRect(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(OUT, 'splash'), { recursive: true });
for (const [w, h, dpr] of SPLASH_SCREENS) {
  const name = `splash/${w * dpr}x${h * dpr}.png`;
  const png = renderSplash(w * dpr, h * dpr);
  writeFileSync(join(OUT, name), png);
  console.log(`✓ public/${name} (${Math.round(png.length / 1024)} kB)`);
}
