import { invoke } from "@tauri-apps/api/core"
import { C } from "@/lib/core"
import { say, sayErr } from "./status"

// What the popup's copy would put on the clipboard, minus its fill-in
// form: the clipboard and saved config values in, {date} and {time}
// expanded, fill-in fields left as typed for the user to fill in by hand
// (core's expandForCopy). The clipboard is read at the click, not taken
// from a preview's last read, so a prompt copied twice doesn't wrap a
// stale one. The toast counts the fields left to fill. One copy for the
// overview's cards and the editor, so the two never differ.
export async function copyPrompt(p: { title: string; text: string; configValues?: Record<string, string> }): Promise<boolean> {
  try {
    const clip = await invoke<string>("get_clipboard_text").catch(() => "")
    await invoke("set_clipboard_text", { text: C.expandForCopy(p.text, p.configValues || {}, clip) })
    const asks = C.requiredInputs({ text: p.text, configValues: p.configValues || {} }).length
    const title = p.title.trim() ? `"${p.title.trim()}"` : "the prompt"
    say(asks ? `Copied ${title}; fill in ${C.plural(asks, "field")} where you paste it` : `Copied ${title}`)
    return true
  } catch (e) {
    sayErr(`Couldn't copy: ${e}`)
    return false
  }
}
