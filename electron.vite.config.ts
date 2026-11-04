import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * OAuth client ids for an official build, from the release workflow's secrets
 * (see docs/deployment-guide.md). Empty in a build from source, which then
 * reads its own from xrncal.env or .env (src/main/load-credentials.ts).
 */
const oauthDefines = {
  __XRNCAL_GOOGLE_CLIENT_ID__: JSON.stringify(process.env.XRNCAL_GOOGLE_CLIENT_ID ?? ''),
  __XRNCAL_GOOGLE_CLIENT_SECRET__: JSON.stringify(process.env.XRNCAL_GOOGLE_CLIENT_SECRET ?? ''),
  __XRNCAL_MICROSOFT_CLIENT_ID__: JSON.stringify(process.env.XRNCAL_MICROSOFT_CLIENT_ID ?? '')
}

export default defineConfig({
  main: {
    define: oauthDefines,
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': resolve('src/preload'),
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
