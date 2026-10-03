import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// `text-ui` and `text-micro` are our own font sizes (--text-ui and
// --text-micro in index.css). tailwind-merge only knows the stock scale, so
// it filed them under text colours: in a class list like `text-ui …
// text-muted-foreground` the colour won every time and the size silently
// fell back to 16px (and a key cap's `text-micro` to its row's 13px).
// Teaching the merger the utilities keeps the size and the colour as the
// two separate things they are.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": ["text-ui", "text-micro"] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
