import { useCallback, useMemo, useState } from "react"
import { C } from "./core"

// The library tree's folds, for both windows. The manager's sidebar and
// the popup's list draw the same tree (tree.tsx), and each window keeps
// its own folds in localStorage under its own pair of keys, as a list of
// pack names and a list of groupKeys. What a fold is, how it is toggled
// and how it is stored is written once here; the windows differ only in
// their keys. The manager holds its folds in App.tsx rather than the
// sidebar, since a rename from the overview has to carry them and a prompt
// created from the overview has to unfold the pack it lands in, so every
// surface's actions go through one owner. The popup layers its own extras
// on the hook: folds made under a filter, kept per filter and never
// stored, and where the selection lands once the list has been rebuilt.

/** The localStorage keys one window keeps its folds under */
export interface FoldKeys {
  packs: string
  groups: string
}
export const MANAGER_FOLD_KEYS: FoldKeys = { packs: "collapsedPacks", groups: "collapsedGroups" }
export const POPUP_FOLD_KEYS: FoldKeys = { packs: "popupCollapsedPacks", groups: "popupCollapsedGroups" }

function load(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || "[]") as string[])
  } catch {
    return new Set()
  }
}
const store = (key: string, set: ReadonlySet<string>) => localStorage.setItem(key, JSON.stringify([...set]))

/** The set with `key` folded if it was open, open if it was folded */
export function toggleIn(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

type Rekey = (k: string) => string
const rekey = (set: ReadonlySet<string>, map: Rekey) => new Set([...set].map(map))

// The other window reads its stored folds when it next loads, so a rename
// carries them over in storage, without that window running
function rekeyStored(key: string, map: Rekey) {
  try {
    const cur = JSON.parse(localStorage.getItem(key) || "[]") as string[]
    localStorage.setItem(key, JSON.stringify(cur.map(map)))
  } catch {
    /* unreadable: nothing to carry */
  }
}

/** How a pack rename moves fold keys: the pack's name, and the pack half of its groups' keys */
function packRename(from: string, to: string): { packs: Rekey; groups: Rekey } {
  const prefix = C.groupKey(from, "")
  return {
    packs: (k) => (k === from ? to : k),
    groups: (k) => (k.startsWith(prefix) ? C.groupKey(to, k.slice(prefix.length)) : k),
  }
}
/** How a group rename moves a fold key: that one groupKey */
function groupRename(pack: string, from: string, to: string): Rekey {
  return (k) => (k === C.groupKey(pack, from) ? C.groupKey(pack, to) : k)
}

/**
 * One window's folds: the sets, held in state and mirrored to `keys` in
 * localStorage. `alsoCarry` is the other window's keys, whose stored folds
 * a rename carries along too (the manager passes the popup's).
 */
export function useFolds(keys: FoldKeys, alsoCarry?: FoldKeys) {
  const [packs, setPacksState] = useState(() => load(keys.packs))
  const [groups, setGroupsState] = useState(() => load(keys.groups))
  const setPacks = useCallback(
    (next: Set<string>) => {
      setPacksState(next)
      store(keys.packs, next)
    },
    [keys.packs]
  )
  const setGroups = useCallback(
    (next: Set<string>) => {
      setGroupsState(next)
      store(keys.groups, next)
    },
    [keys.groups]
  )

  const togglePackFold = useCallback((name: string) => setPacks(toggleIn(packs, name)), [packs, setPacks])
  const toggleGroupFold = useCallback((key: string) => setGroups(toggleIn(groups, key)), [groups, setGroups])
  const setAll = useCallback(
    (nextPacks: Set<string>, nextGroups: Set<string>) => {
      setPacks(nextPacks)
      setGroups(nextGroups)
    },
    [setPacks, setGroups]
  )
  // Something is about to land inside: open the pack, and the group in it
  const unfold = useCallback(
    (pack: string, group?: string) => {
      if (packs.has(pack)) setPacks(toggleIn(packs, pack))
      if (group && groups.has(C.groupKey(pack, group))) setGroups(toggleIn(groups, C.groupKey(pack, group)))
    },
    [packs, groups, setPacks, setGroups]
  )
  const carryPackFolds = useCallback(
    (from: string, to: string) => {
      const map = packRename(from, to)
      setPacks(rekey(packs, map.packs))
      setGroups(rekey(groups, map.groups))
      if (alsoCarry) {
        rekeyStored(alsoCarry.packs, map.packs)
        rekeyStored(alsoCarry.groups, map.groups)
      }
    },
    [packs, groups, setPacks, setGroups, alsoCarry]
  )
  const carryGroupFold = useCallback(
    (pack: string, from: string, to: string) => {
      const map = groupRename(pack, from, to)
      setGroups(rekey(groups, map))
      if (alsoCarry) rekeyStored(alsoCarry.groups, map)
    },
    [groups, setGroups, alsoCarry]
  )

  return useMemo(
    () => ({ folds: { packs, groups }, togglePackFold, toggleGroupFold, setAll, unfold, carryPackFolds, carryGroupFold }),
    [packs, groups, togglePackFold, toggleGroupFold, setAll, unfold, carryPackFolds, carryGroupFold]
  )
}
