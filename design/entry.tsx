// The design-system bundle: the app's real components on one global, for
// the previews in the Design System artifact (components/<Name>/preview.html).
// Built by `npm run design:build` into design/dist/bundle.js + bundle.css as
// ONE classic script that carries React itself, so a preview needs nothing
// but this file. A preview mounts with `Promptline.mount(el, "Row", props)`.
import "./entry.css"
import { createElement, type ComponentType, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { Button } from "@/components/ui/button"
import { Kbd as UiKbd } from "@/components/ui/kbd"
import { Row, derive, type Entry } from "@/popup/Row"
import { Chip, HighlightedTitle, InputsBadge, Kbd, PromptTokens, TagList, TagPill } from "@/components/prompt-bits"
import type { Snippet } from "@/lib/core"

const components = { Button, UiKbd, Kbd, Chip, TagPill, TagList, InputsBadge, HighlightedTitle, PromptTokens, Row } as const
export type Name = keyof typeof components

/** A complete snippet from the few fields a preview cares about */
export function snippet(partial: Partial<Snippet> & Pick<Snippet, "id" | "title" | "text">): Snippet {
  return { tags: [], pack: "Starter", group: "", uses: 0, pinned: false, pinnedAt: 0, fieldValues: {}, configValues: {}, ...partial }
}

/** The props a popup row needs beyond its snippet, with inert handlers */
export function rowProps(s: Snippet, extra: Partial<Parameters<typeof Row>[0]> = {}) {
  const entry: Entry = { s, indices: null }
  return {
    entry, index: 0, selected: false, picked: false, compact: false, derived: derive(s),
    onPick: () => {}, onMove: () => {}, onLeave: () => {}, onTag: () => {},
    activeTags: [] as string[], previewed: false, clipEmpty: false,
    ...extra,
  }
}

/** Render one component (or a tree via `h`) into an element. */
export function mount(el: Element, node: ReactNode) {
  createRoot(el).render(node)
}

export function h(name: Name | ComponentType<never> | string, props: Record<string, unknown> | null = null, ...children: ReactNode[]) {
  const type = typeof name === "string" && name in components ? components[name as Name] : name
  return createElement(type as ComponentType<Record<string, unknown>>, props, ...children)
}

/** Mirror the artifact's data-theme onto the class Tailwind's `dark:` variant reads */
export function syncTheme() {
  const root = document.documentElement
  const apply = () => root.classList.toggle("dark", root.dataset.theme === "dark")
  apply()
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] })
}

declare global {
  interface Window { Promptline: typeof api }
}
const api = { ...components, snippet, rowProps, mount, h, syncTheme }
window.Promptline = api
