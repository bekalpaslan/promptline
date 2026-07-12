import { createContext, useContext } from "react"
import type { PackMeta, Snippet } from "@/lib/core"

export const DEFAULT_PACK = "My prompts"
export const MAX_PINS = 5

export interface Prefs {
  theme: string // "light" | "dark" (legacy "sand"/"sundown" map to dark)
  density: string
  scale: string
}

export interface ManagerApi {
  snippets: Snippet[]
  packMeta: PackMeta[]
  activeId: string | null
  selection: Set<string>
  hotkey: string
  prefs: Prefs
  isLocked(name: string): boolean
  packNames(extra?: string): string[]
  allTags(): string[]
  /** Replace the snippet list and persist it (save_snippets). */
  persist(next: Snippet[]): Promise<void>
  /** Replace pack metadata and persist it (save_packs). */
  persistPacks(next: PackMeta[]): Promise<void>
  select(id: string | null): void
  setSelection(sel: Set<string>, anchor?: string | null): void
  selectionAnchor: string | null
  newPrompt(): Promise<void>
  addPack(name: string): Promise<void>
  savePrefs(next: Partial<Prefs>): Promise<void>
  setHotkey(hotkey: string): void
  openGenerate(): void
  settingsOpen: boolean
  showSettings(open: boolean): void
}

export const ManagerCtx = createContext<ManagerApi>(null!)
export const useManager = () => useContext(ManagerCtx)
