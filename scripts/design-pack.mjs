// After `vite build --config design/vite.config.ts`: assemble design/dist/
// into the artifact's `project/` layout so one publish (root = design/dist)
// sends the bundle, its stylesheet, the types-as-docs and every component's
// preview and README. Previews and READMEs are versioned under
// design/components/<Name>/; the bundle is not (build output).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readTokens } from "./tokens.mjs"
import { usage, cardAppendix, tokenMapSection } from "./design-usage.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dist = path.join(root, "design", "dist")
const out = path.join(dist, "project", "components")
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

const bundle = fs.readFileSync(path.join(dist, "bundle.js"), "utf8")
for (const bad of ["</script", "<!--"]) {
  if (bundle.includes(bad)) throw new Error(`bundle.js contains "${bad}", which the artifact refuses`)
}
const css = fs.readFileSync(path.join(dist, "bundle.css"), "utf8")
if (/<\/style/i.test(css)) throw new Error("bundle.css contains </style")

const names = fs.readdirSync(path.join(root, "design", "components")).filter((n) => !n.startsWith("."))
const header = `/* @ds-bundle: ${JSON.stringify({ format: 4, namespace: "Promptline", components: names.filter((n) => n !== "Cover").map((name) => ({ name })) })} */\n`
fs.writeFileSync(path.join(out, "bundle.js"), header + bundle)
fs.writeFileSync(path.join(out, "bundle.css"), css)
fs.copyFileSync(path.join(root, "design", "index.d.ts"), path.join(out, "index.d.ts"))
const { byToken, byCard } = usage()
for (const name of names) {
  fs.cpSync(path.join(root, "design", "components", name), path.join(out, name), { recursive: true })
  // The hand-written guidelines, then the tokens this card paints with
  if (byCard[name]) fs.appendFileSync(path.join(out, name, "README.md"), cardAppendix(name, byCard[name]))
}
fs.writeFileSync(path.join(dist, "project", "02-token-map.md"), tokenMapSection(byToken, readTokens()))
const kb = (f) => Math.round(fs.statSync(path.join(out, f)).size / 1024)
console.log(`design/dist/project: 02-token-map.md; components: bundle.js ${kb("bundle.js")} KB, bundle.css ${kb("bundle.css")} KB, ${names.length} cards: ${names.join(", ")}`)
