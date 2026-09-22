import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { applyPrefs } from "@/lib/prefs"
import { App } from "./App"

const render = () => {
  applyPrefs()
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

// `?mock` in a dev server swaps in a fake backend (src/lib/dev-mock.ts);
// a build drops the branch and the module with it
const mock = import.meta.env.DEV ? new URLSearchParams(location.search).get("mock") : null
if (mock !== null) void import("@/lib/dev-mock").then((m) => m.installMock(mock)).then(render)
else render()
