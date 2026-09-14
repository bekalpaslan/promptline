import { useEffect, useState } from "react"

// Dev-only readout of the window's logical size and aspect ratio, pinned to
// the top-right corner. For finding a default window size. Mounted only
// behind `import.meta.env.DEV` at both call sites, so production builds
// neither render it nor attach its resize listener.
export function SizeDebug() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  const ratio = (size.w / size.h).toFixed(3)
  return (
    <div className="pointer-events-none fixed right-1 top-1 z-50 rounded-sm bg-black/70 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-white">
      {size.w}×{size.h} · {ratio} · {window.devicePixelRatio}x
    </div>
  )
}
