import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5174 },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Keep the bundle small and predictable — landing JS should be <30KB gzipped
        manualChunks: undefined,
      },
    },
  },
})
