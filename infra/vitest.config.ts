import { defineConfig } from 'vitest/config';

// Own config so Vitest doesn't walk up and use the app's vite.config.ts.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000 },
});
