import { defineConfig } from 'vitest/config'
import base from './vitest.config'

// `npm run test:caldav`: tests/integration/ against a real Radicale that
// radicale-server.ts starts on a free local port (pip install radicale, or
// XRNCAL_RADICALE=/path/to/radicale). Kept out of `npm run test`, which needs
// no network and nothing but Node. Same aliases (electron stubbed) as the unit tests.
export default defineConfig({
  resolve: base.resolve,
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/radicale-server.ts'],
    testTimeout: 30_000
  }
})
