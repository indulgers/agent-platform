import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'node:path'

export default defineConfig(({ command }) => ({
  // Dev runs at http://localhost:5173/ (no prefix — cleaner HMR + matches what
  // landing's dev rewriter clicks point to). Production build prefixes assets
  // with /app/ so the SPA can sit behind nginx at /app/* without an extra
  // path-rewrite step. import.meta.env.BASE_URL flows from this into the
  // router basepath in main.tsx, so both dev (/) and prod (/app/) work without
  // any conditionals there.
  base: command === 'build' ? '/app/' : '/',
  plugins: [TanStackRouterVite({ routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts' }), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@agent-platform/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
}))
