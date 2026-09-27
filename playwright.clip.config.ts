import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.config"

// `npm run clip`: e2e/clip.spec.ts captures the launch clip's frames against
// the same fake-backend server as the UI suite, at 720x540 CSS px and 2x
// (1440x1080 frames), into test-results/clip-frames/<theme>/; then
// scripts/clip-encode.mjs writes docs/clip/. Kept out of `npm run test:e2e`.
export default defineConfig({
  ...base,
  testMatch: "clip.spec.ts",
  testIgnore: [],
  retries: 0,
  timeout: 180_000,
  projects: [{ name: "clip", use: { ...devices["Desktop Chrome"], viewport: { width: 720, height: 540 }, deviceScaleFactor: 2 } }],
})
