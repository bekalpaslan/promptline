import { RiSettings3Line } from "@remixicon/react"
import { C } from "@/lib/core"
import { cn } from "@/lib/utils"
import { footClass } from "@/components/foot"
import { useManager } from "./state"

// The foot: the Settings gear at the right (it stood alone in the
// bar above the pane until 2026-10-10; that bar is the crumb line's
// now), in the style the popup's hint bar shares (foot.tsx).
export function SidebarFoot() {
  const m = useManager()
  return (
    <div className={cn(footClass, "gap-x-3")}>
      <button
        type="button"
        aria-label="Settings"
        aria-pressed={m.settingsOpen}
        title={m.hotkey ? `Settings — popup hotkey: ${C.fmtHotkey(m.hotkey)}` : "Settings"}
        className={cn(
          "ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-hover hover:text-foreground focus-ring",
          m.settingsOpen && "bg-secondary text-foreground"
        )}
        onClick={() => m.showSettings(!m.settingsOpen)}
      >
        <RiSettings3Line className="size-4" />
      </button>
    </div>
  )
}
