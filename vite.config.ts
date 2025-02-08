
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    hmr: {
      host: '0.0.0.0',
    },
    cors: {
      origin: ['*.replit.dev', 'https://*.replit.dev'],
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
      credentials: true
    }
  }
})
