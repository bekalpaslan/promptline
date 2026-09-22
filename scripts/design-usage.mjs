// Which artifact token reaches which component, read from the component
// sources rather than kept by hand: every Tailwind utility that names a
// theme colour (`bg-accent`, `text-muted-foreground`), a custom property
// (`text-(--warn)`, `shadow-(--shadow-pop)`), a radius (`rounded-md`) or a
// face (`font-mono`) resolves through scripts/tokens.mjs MAP back to the
// artifact token it comes from. design-pack.mjs appends the result to each
// card's README and writes the token → component table as a brand-book
// section, so a person editing a token on the page can see what moves.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MAP } from "./tokens.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Card → the source functions that draw it: [file, exported name] */
export const SOURCES = {
  Row: [
    ["src/popup/Row.tsx", "Row"],
    ["src/components/prompt-bits.tsx", "HighlightedTitle"],
    ["src/components/prompt-bits.tsx", "TagList"],
    ["src/components/prompt-bits.tsx", "InputsBadge"],
    ["src/components/prompt-bits.tsx", "chipVariants"],
  ],
  Button: [["src/components/ui/button.tsx", "buttonVariants"]],
  Kbd: [["src/components/prompt-bits.tsx", "Kbd"], ["src/components/ui/kbd.tsx", "Kbd"]],
  TagPill: [["src/components/prompt-bits.tsx", "TagPill"], ["src/components/prompt-bits.tsx", "chipVariants"]],
  Chip: [["src/components/prompt-bits.tsx", "chipVariants"], ["src/components/prompt-bits.tsx", "Chip"]],
}

/** CSS variable → artifact tokens (MAP inverted), plus the few the app
 *  derives rather than maps one-to-one. */
const VAR_TO_TOKEN = {}
for (const [token, vars] of Object.entries(MAP)) for (const v of vars) (VAR_TO_TOKEN[v] ??= []).push(token)
VAR_TO_TOKEN.radius = ["radius-2"]
VAR_TO_TOKEN["app-font"] = ["sans"]
VAR_TO_TOKEN["font-mono"] = ["mono"]
VAR_TO_TOKEN["module-border"] = ["heading"]

const THEME_COLORS = "background|foreground|card-foreground|card|popover-foreground|popover|primary-foreground|primary|secondary-foreground|secondary|muted-foreground|muted|accent-foreground|accent|destructive|border|input|ring|sidebar|hover"
const UTILITY = new RegExp(
  String.raw`(?:^|[\s"'\`(])((?:[a-z-]+:)*)(?:(?:bg|text|border|ring|outline|fill|stroke|decoration|from|to)-(${THEME_COLORS})(?=[\s"'\`)/]|$)|(?:bg|text|border|ring|outline|shadow|fill|stroke)-\(--([a-z0-9-]+)\)|(rounded)(?:-(?:xs|sm|md|lg|xl|2xl|3xl|full))?(?=[\s"'\`)]|$)|font-(mono|sans|heading)(?=[\s"'\`)]|$)|(focus-ring)(?=[\s"'\`)]|$))`,
  "g",
)

/** The text of one top-level declaration (function, const, memo(function …)) */
export function sourceOf(file, name) {
  const text = fs.readFileSync(path.join(root, file), "utf8")
  const start = text.search(new RegExp(String.raw`^(?:export )?(?:const ${name}\b|function ${name}\b)`, "m"))
  if (start < 0) throw new Error(`${file}: no top-level ${name}`)
  const rest = text.slice(start)
  const next = rest.slice(1).search(/^(?:export |const |function |type |interface |\/\/|\/\*)/m)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

/** { token: Set<"Card" | "Card (hover)"> } and { card: Map<token, Set<variant>> } */
export function usage() {
  const byToken = {}
  const byCard = {}
  for (const [card, sources] of Object.entries(SOURCES)) {
    const tokens = (byCard[card] = new Map())
    for (const [file, name] of sources) {
      const src = sourceOf(file, name)
      for (const m of src.matchAll(UTILITY)) {
        const variant = m[1].replace(/:$/, "").split(":").filter((v) => v && v !== "dark").join(" ")
        const key = m[2] ?? m[3] ?? (m[4] ? "radius" : m[5] ? (m[5] === "mono" ? "font-mono" : "app-font") : m[6] ? "focus" : null)
        if (!key) continue
        for (const token of VAR_TO_TOKEN[key] ?? []) {
          if (!tokens.has(token)) tokens.set(token, new Set())
          tokens.get(token).add(variant) // "" = the resting state
          ;(byToken[token] ??= new Set()).add(card)
        }
      }
    }
  }
  return { byToken, byCard }
}

/** Markdown appendix for one card's README */
export function cardAppendix(card, tokens) {
  // A token painted at rest needs no note; one only reached through a variant names it
  const lines = [...tokens].sort(([a], [b]) => a.localeCompare(b)).map(([t, variants]) =>
    `- \`${t}\`${variants.has("") ? "" : ` (${[...variants].sort().join(", ")})`}`)
  return `\n\n## Tokens\n\nWhat moves when a token changes, read from the source at build time. A note in parentheses is the state the token paints (hover, focus-visible, disabled).\n\n${lines.join("\n")}\n`
}

/** The brand-book section: token → cards, with the CSS variable the app reads */
export function tokenMapSection(byToken, tokens) {
  const names = [...tokens.color.tokens, ...tokens.shadow.tokens, ...tokens.radius.tokens].map((t) => t.name)
  const families = Object.keys(tokens.type.families)
  const rows = [...names, ...families].map((t) => {
    const cards = [...(byToken[t] ?? [])].sort().map((c) => `[${c}](components/${c})`).join(", ")
    const vars = (MAP[t] ?? []).concat(t === "radius-2" ? ["radius"] : t === "sans" ? ["app-font"] : t === "mono" ? ["font-mono"] : []).map((v) => `\`--${v}\``).join(", ")
    return `| \`${t}\` | ${vars || "documentation only"} | ${cards || (MAP[t] || t === "radius-2" || families.includes(t) ? "app surfaces not yet in a card" : "none: not wired to the app")} |`
  })
  return `# Where each token is used

Generated by \`npm run design:build\` from the component sources. The second column is the CSS variable the app reads (shadcn's names); the third is every card that paints with it. A token marked documentation only is described in the brand book but nothing in the app reads it yet. The type styles (body, row-title, micro, …) are documentation only today: the app sizes text with Tailwind utilities, and only the two families reach it.

| Token | App variable | Cards |
|---|---|---|
${rows.join("\n")}
`
}
