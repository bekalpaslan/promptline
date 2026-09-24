// Library facts both windows need and used to each keep a copy of: the
// default pack, the pin limit, how pack names are derived, lock state, where
// a new prompt goes, and the shape of config.json as the frontend reads it.
import { C, type PackMeta, type Snippet } from "./core"

export const DEFAULT_PACK = "My prompts"
export const MAX_PINS = 5

/** config.json as `get_config` returns it (see `Config` in lib.rs) */
export interface Config {
  hotkey: string
  packs?: PackMeta[]
  /** The user has arranged the packs: `packs` is in their order (C.orderPacks) */
  packsArranged?: boolean
  theme?: string
  density?: string
  scale?: string
  font?: string
  popupSeen?: boolean
}

/**
 * A pack is just a name: the union of declared metadata and every pack a
 * prompt references (BEHAVIOR.md). `extra` adds one more (an editor's
 * in-progress choice); `always` includes the default pack even when empty.
 * The list is in the order both windows show packs: A–Z, or the user's
 * arrangement once `arranged` (config.json's `packsArranged`).
 */
export function packNames(
  meta: PackMeta[],
  snippets: Snippet[],
  opts: { extra?: string; always?: boolean; arranged?: boolean } = {}
): string[] {
  const names = new Set([...meta.map((p) => p.name), ...snippets.map((s) => s.pack || DEFAULT_PACK)])
  if (opts.extra) names.add(opts.extra)
  if (opts.always) names.add(DEFAULT_PACK)
  return C.orderPacks([...names], opts.arranged ? meta.map((p) => p.name) : null)
}

export function isLockedIn(meta: PackMeta[], name: string): boolean {
  return !!meta.find((p) => p.name === name)?.locked
}

/**
 * The pack a new prompt lands in when nothing chose one explicitly. Only
 * packs that exist are candidates; the default pack is not added to the
 * list here, or a library without it would keep conjuring it (finding 4 of
 * the 2026-09-22 audit).
 */
export function defaultPackFor(meta: PackMeta[], snippets: Snippet[]): string {
  const names = packNames(meta, snippets)
  return C.defaultPackFor(localStorage.getItem("lastPack"), names, (n) => isLockedIn(meta, n), DEFAULT_PACK)
}
