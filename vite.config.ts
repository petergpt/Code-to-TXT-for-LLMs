
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8080,
    allowedHosts: [
      'all',
      '4b967e9b-42be-494b-bce4-301e24529d48-00-2anfgnzym2tuf.janeway.replit.dev'
    ]
  }
})
