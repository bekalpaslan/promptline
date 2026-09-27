// Reads a text file whatever shell wrote it. Windows PowerShell 5.1's `>`
// writes UTF-16 LE with a BOM (`gh release view … > notes.md` did, on
// 2026-09-27, and the post came out as the whole notes with NULs between
// the letters); pwsh 7 and most editors write UTF-8, sometimes with a BOM.
// Decodes by the BOM, strips it, and normalises line endings to \n.
import fs from "node:fs"

export function decodeText(bytes) {
  const b = Buffer.from(bytes)
  let text
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) text = b.subarray(2).toString("utf16le")
  else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) text = b.subarray(2).swap16().toString("utf16le")
  else if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) text = b.subarray(3).toString("utf8")
  else text = b.toString("utf8")
  return text.replace(/\r\n?/g, "\n")
}

export function readText(file) {
  return decodeText(fs.readFileSync(file))
}
