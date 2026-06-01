import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['miniprogram/__tests__/**/*.test.js'],
    setupFiles: ['miniprogram/__tests__/setup.js'],
    server: {
      deps: {
        interopDefault: true
      }
    }
  }
});
