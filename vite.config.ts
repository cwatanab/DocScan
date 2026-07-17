import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { readFileSync, promises as fs } from 'fs'
import { join } from 'path'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const ORT_VERSION = pkg.dependencies['onnxruntime-web'].replace(/[^0-9.]/g, '')

// CDNで読み込むため、ビルド成果物から不要になったWASMファイルを削除するプラグイン
const removeWasmPlugin = () => {
  return {
    name: 'remove-wasm',
    async closeBundle() {
      const distDir = join(process.cwd(), 'dist', 'assets')
      try {
        const files = await fs.readdir(distDir)
        for (const file of files) {
          if (file.startsWith('ort-wasm-') && file.endsWith('.wasm')) {
            await fs.unlink(join(distDir, file))
            console.log(`[RemoveWasm] Removed CDN-delegated WASM asset: ${file}`)
          }
        }
      } catch (err) {
        console.warn('[RemoveWasm] Error removing wasm assets:', err)
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      'onnxruntime-web': join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist', 'ort.wasm.min.mjs')
    }
  },
  define: {
    __ORT_VERSION__: JSON.stringify(ORT_VERSION)
  },
  server: {
    host: true,
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    watch: {
      ignored: [
        '**/SCAN_*',
        '**/*.pdf',
        '**/*.png',
        '**/*.jpeg',
        '**/*.jpg',
        '**/*.onnx',
        '**/*.ort',
        '**/*.wasm',
        '**/*.mjs',
        '**/public/models/**',
        '**/public/ort-wasm-simd-threaded.*'
      ]
    }
  },
  plugins: [
    react(),
    basicSsl(),
    removeWasmPlugin(),
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
          },
          {
            urlPattern: /\/models\/.*\.(onnx|txt)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'models-cache',
              expiration: {
                maxEntries: 10,
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
