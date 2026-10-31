import { Label } from "@/components/ui/label"

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="module w-full max-w-160 self-center text-card-foreground">
      <h2 className="mb-2 section-title">{title}</h2>
      {children}
    </div>
  )
}

// `htmlFor` ties the caption to the row's control, so it is announced as its
// label; rows whose control brings its own <label> leave it out
export function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-3 last:mb-0">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="min-w-28 font-normal text-muted-foreground">
          {label}
        </Label>
      ) : (
        <span className="min-w-28 text-xs text-muted-foreground">{label}</span>
      )}
      {children}
    </div>
  )
}
