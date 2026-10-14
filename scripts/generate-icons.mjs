/**
 * Renders the app icons from a vector description, with no image dependency.
 *
 * An installable PWA needs real PNG icons (Chrome ignores SVG for install
 * prompts), so rather than pulling in a rasteriser this walks the pixel grid,
 * evaluates a few signed-distance shapes and deflates the result into a PNG by
 * hand. Deterministic, dependency-free, and re-runnable in CI.
 *
 * Mark: a descending chevron over a floor line — the squat, in two strokes.
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BG = [0x0a, 0x0c, 0x10];
const ACCENT = [0xb6, 0xff, 0x3c];

/** Distance from p to segment ab, all in normalised units. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Signed distance to a rounded rectangle centred on (0.5, 0.5). */
function distToRoundedRect(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px - 0.5) - (halfW - radius);
  const qy = Math.abs(py - 0.5) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * @param size pixel dimension
 * @param maskable true pads the mark into the safe area Android crops to
 */
function renderRGBA(size, maskable) {
  const px = new Uint8Array(size * size * 4);
  // Antialias band of roughly one pixel, expressed in normalised units.
  const aa = 1.2 / size;
  // Maskable icons get cropped to a circle of ~80%; shrink the mark to fit.
  const scale = maskable ? 0.76 : 1;
  const at = (v) => 0.5 + (v - 0.5) * scale;
  const stroke = 0.075 * scale;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;

      // Background plate: full bleed when maskable, rounded square otherwise.
      const plate = maskable ? -1 : distToRoundedRect(nx, ny, 0.5, 0.5, 0.22);
      const plateAlpha = smoothstep(aa, -aa, plate);

      // Mark: chevron down, plus a floor line beneath it.
      const chevron = Math.min(
        distToSegment(nx, ny, at(0.235), at(0.4), at(0.5), at(0.615)),
        distToSegment(nx, ny, at(0.5), at(0.615), at(0.765), at(0.4)),
      );
      const floor = distToSegment(nx, ny, at(0.29), at(0.775), at(0.71), at(0.775));
      const mark = Math.min(chevron, floor) - stroke / 2;
      const markAlpha = smoothstep(aa, -aa, mark);

      const rgb = mix(BG, ACCENT, markAlpha);
      const i = (y * size + x) * 4;
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = Math.round(255 * plateAlpha);
    }
  }
  return px;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---- Minimal PNG writer (RGBA, 8-bit, no interlace) ----

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12: deflate / adaptive filtering / no interlace, all zero.

  // Each scanline is prefixed with its filter type; 0 = none.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0a0c10"/>
  <g fill="none" stroke="#b6ff3c" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 25.6 32 39.4 49 25.6"/>
    <path d="M18.6 49.6h26.8"/>
  </g>
</svg>
`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public');
await mkdir(outDir, { recursive: true });

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: true },
];

for (const { name, size, maskable } of targets) {
  await writeFile(join(outDir, name), encodePng(size, renderRGBA(size, maskable)));
  console.log(`[icons] ${name} (${size}×${size})`);
}
await writeFile(join(outDir, 'favicon.svg'), SVG);
console.log('[icons] favicon.svg');
