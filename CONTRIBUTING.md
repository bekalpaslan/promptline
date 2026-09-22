# Contributing

Read [`BEHAVIOR.md`](BEHAVIOR.md) first: it says how each surface behaves
and why the non-obvious parts (the paste pipeline's sleeps, the prompt
staying on the clipboard, pack files retired rather than deleted) are the
way they are, and it is updated in the same commit as any behaviour change.
Branch off `master` (`feat/…`, `fix/…`, `chore/…`); write commit subjects in
sentence case, often prefixed with the surface (`Manager: …`, `Popup: …`),
with a body in prose saying what changed and why. Before opening a pull
request run the four checks — `npx tsc -b --noEmit`, `npm run lint`,
`npm test` and `npm run test:rust` — and keep them green; CI runs the same
set plus the frontend build on every push and pull request. Pure logic goes
in `ui/core.js` with a `node --test` case, not in a component. The
repository's index uses LF line endings while Windows working copies are
mixed, so run `unix2dos` on the files you touch, and only those, before
committing. Node 22 (`.nvmrc`) and a stable Rust toolchain are all you need;
`npm run dev` starts the app with a hot-reloading UI, and
`http://localhost:5173/?mock` serves the manager against a fake backend
when the real one is in the way.
