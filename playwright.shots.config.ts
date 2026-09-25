import { defineConfig, devices } from "@playwright/test"
import base from "./playwright.config"

// `npm run shots`: e2e/shots.spec.ts against the same fake-backend server as
// the UI suite, at 2x, writing docs/screenshots/ and docs/og.png. Kept out
// of `npm run test:e2e`, which would otherwise rewrite the images on every run.
export default defineConfig({
  ...base,
  testMatch: "shots.spec.ts",
  testIgnore: [],
  retries: 0,
  projects: [{ name: "shots", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 2 } }],
})
