import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/test/**/*.test.ts'],
    coverage: {
      include: ['src/main/services/**/*.ts'],
    },
  },
});
