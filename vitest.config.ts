import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.test.cjs'],
    setupFiles: ['__tests__/setup.cjs'],
    server: {
      deps: {
        interopDefault: true
      }
    }
  }
});
