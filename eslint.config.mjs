// Minimal, honest lint: the rules the codebase already annotates for
// (react-hooks) plus TypeScript's recommended set. `npm run lint`.
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "src-tauri/", "ui/core.js", "tests/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: { ...globals.browser } },
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
  }
)
