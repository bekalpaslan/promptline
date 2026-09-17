import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// `text-ui` is our own font size (--text-ui in index.css). tailwind-merge only
// knows the stock scale, so it filed it under text colours: in a class list
// like `text-ui … text-muted-foreground` the colour won every time and the
// size silently fell back to 16px. Teaching the merger the utility keeps the
// size and the colour as the two separate things they are.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": ["text-ui"] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
