import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/',
  test: {
    include: ['src/**/*.test.ts'],
    // Keep CSS (and `?raw` CSS imports) real, so tests can read the design tokens.
    css: true,
  },
})
