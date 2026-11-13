import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { external: ['node:sqlite', 'electron', 'playwright-core'] } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } }
  },
  renderer: {
    resolve: { alias: { '@shared': shared } },
    plugins: [react()]
  }
})
