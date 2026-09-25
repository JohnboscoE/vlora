import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    // Agent + gasless API (server/local.ts, `npm run agent`)
    proxy: {
      '/api/agent': 'http://localhost:8787',
      '/api/gasless': 'http://localhost:8787',
      '/api/onramp': 'http://localhost:8787',
      // LI.FI swap quotes (mirrors vercel.json)
      '/lifi': { target: 'https://li.quest', changeOrigin: true, rewrite: (p) => p.replace(/^\/lifi/, '/v1') },
      // Same-origin RPC (mirrors the rewrites in vercel.json): ad blockers block *.arc.io
      '/rpc/mainnet': { target: 'https://rpc.mainnet.arc.io', changeOrigin: true, rewrite: () => '/' },
      '/rpc/testnet': { target: 'https://rpc.testnet.arc.io', changeOrigin: true, rewrite: () => '/' },
    },
  },
})
