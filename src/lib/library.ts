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
 */
export function packNames(
  meta: PackMeta[],
  snippets: Snippet[],
  opts: { extra?: string; always?: boolean } = {}
): string[] {
  const names = new Set([...meta.map((p) => p.name), ...snippets.map((s) => s.pack || DEFAULT_PACK)])
  if (opts.extra) names.add(opts.extra)
  if (opts.always) names.add(DEFAULT_PACK)
  return [...names].sort((a, b) => a.localeCompare(b))
}

export function isLockedIn(meta: PackMeta[], name: string): boolean {
  return !!meta.find((p) => p.name === name)?.locked
}

/** The pack a new prompt lands in when nothing chose one explicitly */
export function defaultPackFor(meta: PackMeta[], snippets: Snippet[]): string {
  const names = packNames(meta, snippets, { always: true })
  return C.defaultPackFor(localStorage.getItem("lastPack"), names, (n) => isLockedIn(meta, n), DEFAULT_PACK)
}
