"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

// An on/off toggle: a pill track with a sliding thumb. On the page's own
// ground the track is the secondary ink at half off (the input edge was
// near invisible on a dark card) and the primary on; a
// caller on a coloured band passes its own track and thumb colours.
function Switch({
  className,
  thumbClassName,
  ...props
}: SwitchPrimitive.Root.Props & { thumbClassName?: string }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 bg-muted-foreground/50 data-checked:bg-primary",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-3 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-3 data-checked:bg-primary-foreground dark:not-data-checked:bg-foreground",
          thumbClassName
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
