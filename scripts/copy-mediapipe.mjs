/**
 * Copies the MediaPipe vision WASM runtime out of node_modules into `public/`
 * so the app serves it from its own origin: no CDN dependency at runtime, and
 * the camera screen still works on a locked-down network or offline.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'public', 'mediapipe', 'wasm');

try {
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true });
  const files = await readdir(to);
  console.log(`[mediapipe] copied ${files.length} runtime files to public/mediapipe/wasm`);
} catch (error) {
  console.error('[mediapipe] copy failed — run `npm install` first.');
  console.error(error.message);
  process.exit(1);
}
