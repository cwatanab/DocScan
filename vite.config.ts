import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true,
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    watch: {
      ignored: ['**/SCAN_*', '**/*.pdf', '**/*.png', '**/*.jpeg', '**/*.jpg']
    }
  },
  plugins: [
    react(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'DocScan',
        short_name: 'DocScan',
        description: 'iPhone用の高速・クライアントサイド完結型ドキュメントスキャナー',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // OpenCV.js (10MB) キャッシュのため
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        globIgnores: ['**/opencv.js', '**/ort-wasm*.wasm', '**/ort-wasm*.mjs'],
        runtimeCaching: [
          {
            urlPattern: /opencv\.js(\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'opencv-cache',
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /ort-wasm-.*\.(wasm|mjs)(\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ort-wasm-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
})
