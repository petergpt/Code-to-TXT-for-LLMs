import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import fs from "fs"
import path from "path"

function serveExtensionJson() {
  // This plugin serves `extension.json` directly from the root in dev
  return {
    name: "serve-extension-json",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/extension.json") {
          const filePath = path.resolve(__dirname, "extension.json")
          if (!fs.existsSync(filePath)) {
            next()
            return
          }
          const content = fs.readFileSync(filePath, "utf8")
          res.setHeader("Content-Type", "application/json")
          res.end(content)
        } else {
          next()
        }
      })
    }
  }
}

function copyExtensionJson() {
  // This plugin copies `extension.json` into `dist/` at build time
  return {
    name: "copy-extension-json",
    closeBundle() {
      const src = path.resolve(__dirname, "extension.json")
      const dest = path.resolve(__dirname, "dist", "extension.json")
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest)
      }
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    serveExtensionJson(),
    copyExtensionJson()
  ],
  server: {
    host: true,
    port: 8080,
    strictPort: true,
    // IMPORTANT: allow your ephemeral Replit domain
    // or simply use "all" to permit any domain in dev.
    allowHosts: "all",
    hmr: {
      clientPort: 443,
      host: "0.0.0.0"
    },
    watch: {
      usePolling: true
    },
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true
    }
  }
})
