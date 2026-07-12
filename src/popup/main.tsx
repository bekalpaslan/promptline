import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@/index.css"
import { applyPrefs } from "@/lib/prefs"
import { App } from "./App"

applyPrefs()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
