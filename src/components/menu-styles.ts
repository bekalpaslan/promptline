// One look for every menu in both windows: the manager's context menus and
// the popup's action panel. Grey on hover, the bar only on the item the
// keyboard is on (the bar means "selected", never "under the pointer").
export const MENU_PANEL = "rounded-xl border border-border bg-popover p-2 shadow-(--shadow-pop)"
export const MENU_ITEM =
  "flex h-[30px] w-full cursor-pointer select-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-left text-ui text-foreground outline-none disabled:cursor-default disabled:opacity-50"
// The keyboard's mark in both windows, on the selected row, the shown pack
// or group, a menu's focused item and the action panel's highlighted one:
// a 2 px Focus bar at the left edge, and no fill. It sat over the
// Selection tint until 2026-10-10; the tint alone, a dark blue-teal in
// dark mode, had read as a stray green row, and with the bar the tint
// said the same thing twice.
export const SELECTED_BAR = "shadow-[inset_2px_0_0_var(--focus)]"
// The same bar for an item that is focused rather than selected
export const FOCUS_BAR = "focus-visible:shadow-[inset_2px_0_0_var(--focus)]"
