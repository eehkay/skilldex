import path from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = import.meta.dirname

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: path.resolve(root, 'electron/main/index.ts'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: path.resolve(root, 'electron/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: '.',
    // Opt-in remote access to the dev server (e.g. over Tailscale):
    // SKILLDEX_DEV_HOST=0.0.0.0 npm run dev
    server: process.env.SKILLDEX_DEV_HOST ? { host: process.env.SKILLDEX_DEV_HOST } : undefined,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(root, './src'),
      },
    },
    build: {
      rollupOptions: {
        input: path.resolve(root, 'index.html'),
      },
    },
  },
})
