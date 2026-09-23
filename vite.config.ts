import { readFileSync } from "fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The release bump sets the version in package.json and tauri.conf.json
// together, so either is the app's version; this one needs no IPC
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"))

// Two entry points — one per Tauri window (main = manager, popup = quick popup)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        popup: path.resolve(__dirname, "popup.html"),
      },
    },
  },
  // Tauri expects a fixed dev port and handles its own screen clearing
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
})
