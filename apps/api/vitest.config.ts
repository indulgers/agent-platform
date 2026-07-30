import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    globals: false,
    // Loads apps/api/.env so integration tests can reach the local Postgres.
    setupFiles: ['dotenv/config'],
  },
})
