import { useEffect, useState } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { RiCheckboxCircleLine, RiInformationLine, RiErrorWarningLine, RiCloseCircleLine, RiLoaderLine } from "@remixicon/react"

// The app's theme is the `.dark` class on <html> (applyPrefs), not the OS
// setting; following prefers-color-scheme drew dark toasts on a light app.
function useAppTheme(): "light" | "dark" {
  const read = () => (document.documentElement.classList.contains("dark") ? "dark" : "light")
  const [theme, setTheme] = useState<"light" | "dark">(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return theme
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAppTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: (
          <RiCheckboxCircleLine className="size-4" />
        ),
        info: (
          <RiInformationLine className="size-4" />
        ),
        warning: (
          <RiErrorWarningLine className="size-4" />
        ),
        error: (
          <RiCloseCircleLine className="size-4" />
        ),
        loading: (
          <RiLoaderLine className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          // Sonner ships its own font-family; follow the app font pref instead
          fontFamily: "var(--app-font)",
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
