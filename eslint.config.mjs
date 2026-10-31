// Minimal, honest lint: the rules the codebase already annotates for
// (react-hooks) plus TypeScript's recommended set, type-checked where the
// app lives. `npm run lint`.
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

export default tseslint.config(
  // The last four are plugin installs and Playwright output, gitignored and
  // never the product; eslint walks the whole tree and ignores nothing by itself
  { ignores: ["dist/", "design/dist/", "node_modules/", "src-tauri/", "ui/core.js", "tests/", ".claude/", ".github/", "test-results/", "playwright-report/", ".playwright-mcp/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["scripts/**/*.mjs", "design/vite.config.ts"], languageOptions: { globals: { ...globals.node } } },
  {
    // The app alone is linted with type information (release audit L13):
    // the typed rules need a tsconfig behind every file, which `src/` has in
    // tsconfig.app.json; scripts, e2e and design stay on the untyped set
    files: ["src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Stale closures are the H1 class of bug; keep this loud but not fatal
      "react-hooks/exhaustive-deps": "warn",
      // The React Compiler's ref rule forbids the "latest value" ref idiom
      // (`ref.current = value` during render) that the manager and popup use
      // on purpose for callbacks that outlive a render (mRef, snippetsRef,
      // selRef). The app does not use the compiler; the idiom stays.
      "react-hooks/refs": "off",
      // Same family: effects that set state on purpose (reset a dialog when it
      // opens, return focus when a mode ends) are the intended design here
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // The fake backend rejects the way Tauri does: a Rust command's `Err(String)`
    // arrives as a bare string and a refused write as the plain `StoreError`
    // object (core.ts), and the UI's `String(e)` and `isStoreError(e)` read
    // exactly that. An Error object would show as "Error: …" in every toast
    // the mock stages, so the mock throws what the real backend sends.
    files: ["src/lib/dev-mock.ts"],
    rules: { "@typescript-eslint/only-throw-error": "off" },
  }
)
