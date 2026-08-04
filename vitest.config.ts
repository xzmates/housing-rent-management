import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // 测试共享微信云开发内存模拟器，文件并行会造成跨用例数据竞争。
    fileParallelism: false,
    include: ['__tests__/**/*.test.cjs'],
    setupFiles: ['__tests__/setup.cjs'],
    server: {
      deps: {
        interopDefault: true
      }
    }
  }
});
