import { defineConfig, devices } from "@playwright/test"

// The UI suite runs both windows in a real Chromium against the fake
// backend (`src/lib/dev-mock.ts`, `?mock`): what the manager and the popup
// decide on their own, not what Rust does. `npm run test:e2e`; the specs
// are in e2e/. The port is the suite's own so a `vite --port 5175` left
// running by a manual session is never mistaken for it.
const PORT = 5179

export default defineConfig({
  testDir: "./e2e",
  // The screenshots have their own run (`npm run shots`, playwright.shots.config.ts)
  testIgnore: "shots.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/popup.html?mock`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
