import { cn } from "@/lib/utils"

// `name`: the text is the user's (a prompt title), shown as typed; uppercase
// is for the app's own labels only
export function SectionHeader({ children, name }: { children: React.ReactNode; name?: boolean }) {
  return (
    <div className={cn(name ? "name-label truncate" : "section-label", "px-2 pb-0.5 pt-1.5")}>
      {children}
    </div>
  )
}
