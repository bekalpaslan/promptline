import type { ComponentType } from "react"
import { Button } from "@/components/ui/button"

// One empty state for every empty surface: an icon, one line, and the
// action that fills it — never a dead end.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  actions = [],
}: {
  icon?: ComponentType<{ className?: string }>
  title: string
  hint?: string
  /** `menu`: the action opens a menu at the button (aria-haspopup) rather than acting outright */
  actions?: { label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; primary?: boolean; menu?: boolean }[]
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {Icon && <Icon className="size-8 opacity-40" />}
      <div>
        <div className="font-semibold text-foreground">{title}</div>
        {hint && <div className="mt-1 text-ui leading-relaxed">{hint}</div>}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.primary ? "default" : "secondary"}
              aria-haspopup={a.menu ? "menu" : undefined}
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
