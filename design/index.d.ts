// Types as documentation for the Promptline design-system bundle
// (window.Promptline, built by `npm run design:build` from design/entry.tsx).
// Not type-checked by the artifact; the api/ cards read it.
import type { ComponentType, ReactNode } from "react"

export interface Snippet {
  id: string
  title: string
  text: string
  tags: string[]
  pack: string
  group: string
  uses: number
  pinned: boolean
  /** ms since epoch; 0 = not pinned */
  pinnedAt: number
  fieldValues: Record<string, string>
  configValues: Record<string, string>
}

export interface Entry { s: Snippet; indices: number[] | null }

export interface RowProps {
  entry: Entry
  index: number
  /** Ctrl+digit slot (1..5) this row answers to, if any */
  slot?: number
  selected: boolean
  picked: boolean
  compact: boolean
  derived: { inputs: string[]; Icon: ComponentType<{ className?: string }> }
  onPick: (s: Snippet, paste: boolean) => void
  onMove: (i: number, e: unknown) => void
  onLeave: () => void
  onTag: (tag: string) => void
  /** Lower-cased #terms in the query; a matching pill renders filled */
  activeTags: readonly string[]
  previewed: boolean
  clipEmpty: boolean
}

export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
export type ButtonSize = "default" | "xs" | "sm" | "compact" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
export interface ButtonProps { variant?: ButtonVariant; size?: ButtonSize; disabled?: boolean; children?: ReactNode; onClick?: () => void }

export interface TagPillProps { tag: string; active?: boolean; onClick?: (tag: string) => void }

export declare const Button: ComponentType<ButtonProps>
/** The popup's 16px key */
export declare const Kbd: ComponentType<{ children?: ReactNode }>
/** shadcn's kit kbd, for surfaces outside the popup */
export declare const UiKbd: ComponentType<{ className?: string; children?: ReactNode }>
export declare const TagPill: ComponentType<TagPillProps>
export declare const HighlightedTitle: ComponentType<{ title: string; indices: number[] | null }>
export declare const Row: ComponentType<RowProps>

/** A complete snippet from the few fields a preview cares about */
export declare function snippet(partial: Partial<Snippet> & Pick<Snippet, "id" | "title" | "text">): Snippet
/** Row props with inert handlers, from a snippet */
export declare function rowProps(s: Snippet, extra?: Partial<RowProps>): RowProps
export declare function mount(el: Element, node: ReactNode): void
export declare function h(type: string | ComponentType<never>, props?: Record<string, unknown> | null, ...children: ReactNode[]): ReactNode
/** Mirror the artifact's data-theme onto the `dark` class */
export declare function syncTheme(): void
