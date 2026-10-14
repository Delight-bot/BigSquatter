/**
 * Downloads the Pose Landmarker model into `public/models` so inference needs no
 * network at runtime. Safe to re-run: it skips an already-present model.
 *
 * If this is never run, `poseEngine.ts` falls back to Google's CDN.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'models');
const dest = join(dir, 'pose_landmarker_lite.task');

const existing = await stat(dest).catch(() => null);
if (existing && existing.size > 1_000_000) {
  console.log(`[model] already present (${(existing.size / 1e6).toFixed(1)} MB) — skipping`);
  process.exit(0);
}

console.log('[model] downloading pose_landmarker_lite.task ...');
const res = await fetch(MODEL_URL);
if (!res.ok) {
  console.error(`[model] download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
await mkdir(dir, { recursive: true });
await writeFile(dest, Buffer.from(await res.arrayBuffer()));
const { size } = await stat(dest);
console.log(`[model] saved public/models/pose_landmarker_lite.task (${(size / 1e6).toFixed(1)} MB)`);
