import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/client/index.tsx'],
  outDir: '.tsdown-output',
  format: 'cjs',
  platform: 'browser',
  unbundle: false,
  splitting: false,
  deps: {
    onlyBundle: false,
    neverBundle: ['react', 'react-dom'],
    alwaysBundle: ['@xterm/xterm', '@xterm/xterm/css/xterm.css', '@xterm/addon-fit'],
  },
})
