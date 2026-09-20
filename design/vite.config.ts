import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The design-system bundle (see design/entry.tsx): one IIFE with React
// inside, one stylesheet, no hashes, so the artifact's previews load
// components/bundle.js and components/bundle.css by name.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: { entry: path.resolve(__dirname, "entry.tsx"), name: "PromptlineBundle", formats: ["iife"], fileName: () => "bundle.js" },
    rollupOptions: { output: { assetFileNames: (a) => (a.name?.endsWith(".css") ? "bundle.css" : a.name!) } },
  },
})
