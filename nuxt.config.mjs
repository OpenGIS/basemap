import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseURL = '/basemap/'
const rootDir = dirname(fileURLToPath(import.meta.url))

export default defineNuxtConfig({
  ssr: false,

  buildId: 'basemap-site',

  app: {
    baseURL,
    buildAssetsDir: '/nuxt-assets/',
    head: {
      htmlAttrs: {
        lang: 'en-GB',
        'data-theme': 'dark'
      },
      title: 'Basemap — Open GIS',
      meta: [
        {
          name: 'description',
          content:
            'Self-hosted MapLibre GL basemap with a live palette inspector for Open GIS.'
        },
        {
          name: 'color-scheme',
          content: 'dark light'
        }
      ],
      link: [
        {
          rel: 'icon',
          type: 'image/png',
          href: `${baseURL}branding/logo-green.png`
        }
      ]
    }
  },

  devServer: {
    host: '127.0.0.1'
  },

  devtools: {
    enabled: false
  },

  compatibilityDate: '2026-11-02',

  vite: {
    optimizeDeps: {
      exclude: ['maplibre-gl']
    },

    plugins: [
      {
        name: 'basemap-root-style',
        apply: 'serve',
        configureServer(server) {
          const styleFiles = {
            '/basemap/style.json': 'style.json',
            '/basemap/style-light.json': 'style-light.json'
          }

          server.middlewares.use(async (req, res, next) => {
            const path = (req.url || '').split('?')[0]
            const styleFile = styleFiles[path]
            if (!styleFile) {
              return next()
            }

            try {
              const body = await readFile(resolve(rootDir, styleFile))
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.setHeader('Cache-Control', 'no-store')
              res.end(body)
            } catch (error) {
              next(error)
            }
          })
        }
      }
    ]
  }
})
