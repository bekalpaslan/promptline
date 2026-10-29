---
name: dependabot
description: Triage and land Promptline's Dependabot work the maintainer's way. Use this whenever the user mentions Dependabot, dependency PRs, security alerts, "the monthly bumps", an advisory in a crate or npm package, or asks whether a dependency update is safe to merge, even without the word Dependabot. It lists the open grouped PRs and alerts, sorts each by the project's standing decisions (Windows-only binary, one network call, majors by hand, Tauri in step), runs the checks that CI cannot, decides each one with the maintainer one at a time, then merges, closes or dismisses with the reason written down, and reports.
argument-hint: '[empty = triage everything open; a PR number; an alert number; "config" = edit .github/dependabot.yml]'
---

# Dependabot

Dependabot opens up to three grouped PRs a month (npm, cargo,
github-actions; `.github/dependabot.yml`) and raises security alerts
against both lockfiles. This skill is the review they get. The procedure
in CLAUDE.md → Checks and Housekeeping stays the source for how to verify
a change; this skill adds what Promptline's decisions mean for a
dependency, what CI cannot see, and the one-at-a-time rhythm the
maintainer wants for decisions.

## Contents

1. [Standing decisions](#standing-decisions): what the project is, read
   as rules for dependencies.
2. [Triage](#1-triage): one script, one table, before any opinion.
3. [A grouped PR](#2-a-grouped-pr): what to read, what to run, the
   merge or close.
4. [An alert](#3-an-alert): reachable or not, fix in range or not, the
   dismissal reasons.
5. [The config](#4-the-config): when `.github/dependabot.yml` changes.
6. [The report](#5-the-report).
7. [What past rounds taught](#what-past-rounds-taught).

Script in `scripts/`: `triage.cjs` prints the open PRs with their CI
state and the open alerts with whether each crate or package is in the
Windows binary (`node .claude/skills/dependabot/scripts/triage.cjs`).

## Standing decisions

These are CLAUDE.md, BEHAVIOR.md and the 2026-10-29 fresh-eyes calls
read as rules for dependencies. Quote the rule in the PR or alert
comment when it decides the outcome.

- **Windows is the only binary.** `src-tauri/Cargo.lock` carries Linux
  and macOS trees that never compile here. An alert for a crate that
  `cargo tree -i <crate> --target x86_64-pc-windows-msvc` cannot find is
  dismissed `not_used`, with that command in the comment. It is not
  fixed, not ignored, not left open. When the macOS port lands, the
  rule gains a second target.
- **One network call, and it is the updater.** Anything in
  `tauri-plugin-updater`'s tree (`reqwest`, `rustls`, `rustls-webpki`,
  `rustls-platform-verifier`) is the TLS stack of the only request the
  app makes. Its advisories are fixed in the same session they are
  seen, with `cargo update -p <crate>` on a branch, and the release
  that ships them carries its own notes bullet ("the update check's
  TLS library was patched"), per CLAUDE.md → Releasing's rule on
  network changes. Features that pull code the Windows path never runs
  stay off (`zip` is off since 2026-10-29: it unpacks macOS and Linux
  archives).
- **Majors are taken by hand.** The npm and cargo groups ignore
  `version-update:semver-major`. A major is a branch of its own, read
  against its changelog, with the checks it needs (below). Do not lift
  the ignore to let a grouped PR through.
- **Tauri moves as one, and by hand.** The `tauri` crate, `tauri-build`,
  `@tauri-apps/api` and `@tauri-apps/cli` stay at one minor; `npx tauri
  info` must not report a version mismatch. The config ignores their
  minors and majors on both sides, so a grouped PR never moves them; the
  2.12 / wry 0.57 / tao 0.37 jump is deferred to the macOS port branch
  (decided 2026-10-29), where the real-app check it needs is done anyway.
  The `tauri-plugin-*` crates' minors are part of the jump: a plugin
  minor requires Tauri's minor (every plugin minor of 2026-10 needs
  `tauri ^2.12`), so the config ignores their minors too and only their
  patches move in the grouped PR. The ignore governs the direct bump
  Dependabot intends, not what Cargo resolves behind it, so a cargo PR is
  judged by its lock, not its body: the triage script reads the PR's
  `Cargo.lock` and flags a resolved `tauri` minor that differs from
  master's. A plugin patch that owns the hotkey, tray, window or
  autostart (global-shortcut, single-instance, autostart) gets a run of
  the debug build and one hotkey press before merge when CI alone passed.
- **The lock must install.** Node 24 / npm 11 is the floor, and even
  npm 11 can write a lock its own `npm ci` rejects on Windows (the
  nested `@emnapi/*` entries, CLAUDE.md → Housekeeping). A PR that
  touches `package-lock.json` is checked out and `npm ci` is run here
  before anything else; a missing-entry failure is fixed by copying the
  entries back from `HEAD`, as a commit on the PR branch.
- **Playwright and Vite bumps change pixels and ports.** A Playwright
  move needs `npx playwright install chromium` and a full
  `npm run test:e2e`; it never triggers `npm run shots` on its own (the
  screenshots are regenerated once per session of visible UI change,
  CLAUDE.md → site). A Vite major is a major.
- **shadcn is a build-time dependency with a long tail.** Its CLI tree
  carries most npm advisories and none of it ships (Vite bundles the one
  stylesheet). An alert can carry no comment while open, so a low with no
  fix under shadcn is dismissed `tolerable_risk` with the comment that it
  is build-time only, after the maintainer's nod; vendoring the stylesheet
  is the recorded alternative if the tail ever bites.
- **Nothing paid, nothing phoning home.** A dependency that adds a
  network call, telemetry, a paid tier or a license other than MIT,
  Apache-2.0, BSD, ISC, Zlib or MPL-2.0 is refused and the maintainer
  told; `THIRD-PARTY-NOTICES.md` is regenerated when a notice-bearing
  crate or package changes (the release skill lists the command).
- **Every outcome leaves a reason where the next reader looks:** the
  PR comment on a close, the dismissal comment on an alert, the commit
  body on a fix. Nothing is closed or dismissed silently.
- **Decisions are the maintainer's, one at a time**, with a
  recommended default first. A merge of a passing in-range grouped PR
  and a `not_used` dismissal with the `cargo tree` proof are routine
  and need no question; everything else is asked.

## 1. Triage

Run the script first and paste its table into the conversation before
forming a view:

```sh
node .claude/skills/dependabot/scripts/triage.cjs
```

It prints two tables: the open Dependabot PRs (number, group, CI
conclusion, what moved and whether any move is a major or a Tauri
half-step) and the open alerts (number, severity, ecosystem, package,
range, first patched version, and `reachable: yes/no` from `cargo tree`
against the Windows target or the npm tree). It changes nothing and
needs `gh` logged in and a built `src-tauri/target/` (cargo tree only
reads the lock).

Then, in this order: alerts that are reachable and fixable in range
(they are the only urgent thing), the grouped PRs, the unreachable
alerts, the config.

Branches: the merge and close commands below carry `--delete-branch`,
and Dependabot deletes its own branch when it recreates a PR, so no
branch should outlive its PR. The script lists any `dependabot/*` branch
on origin with no open PR (a PR closed in the GitHub UI leaves one);
delete those with `git push origin --delete <branch>`.

## 2. A grouped PR

1. Read the PR body: Dependabot lists every move as `Updates X from A
   to B`. Flag any major (should not exist; the ignore rule catches
   them) and any `tauri`/`@tauri-apps` move.
2. CI red is not a verdict. Open the failed job (`gh run view <id>
   --log-failed`) and name the cause in one line: a peer-range conflict
   (npm), a type error from an API change (cargo), a lock that does not
   install, a flaky e2e. A lock or peer problem on an otherwise in-range
   PR is fixed on the PR branch; an API change means the move is a
   de-facto major and the PR is closed with that reason.
3. Check out the branch (`gh pr checkout <n>`) and run what CI cannot
   or did not: `npm ci` for a lock change; `npx tauri info` for any
   Tauri move; a Playwright bump's e2e with the fresh Chromium; for a
   cargo PR, `cargo tree -d --target x86_64-pc-windows-msvc` to see
   whether the move duplicated a crate. The seven checks run in CI
   already; rerun one only when the local environment differs in a way
   that matters (Windows layout tests, the real app over CDP for a
   tray, window or hotkey crate).
4. Merge with `gh pr merge <n> --squash --delete-branch` once green and
   in range; the squash subject is Dependabot's own ("Bump the cargo-all
   group…"), which the release notes do not mention unless a user-facing
   dependency moved (the updater's TLS, the webview). Close with a
   comment naming the rule when it does not meet one; Dependabot
   recreates the group next month without the offending package only if
   the ignore rule covers it, so add the rule in the same session.
5. Afterwards, from the main checkout: `git pull --ff-only origin
   master`, then `npm ci` here too, so the next session's node_modules
   match the lock.

## 3. An alert

1. Reachability first. Rust: `cargo tree --manifest-path
   src-tauri/Cargo.toml -i <crate> --target x86_64-pc-windows-msvc`.
   Nothing printed means the crate is in another platform's tree:
   dismiss `not_used` with that command in the comment. npm: `npm ls
   <package>`; a package under `shadcn` alone is build-time only.
2. Fix in range (`first_patched_version` inside what the lock's parents
   accept): `cargo update -p <crate> --manifest-path src-tauri/Cargo.toml`
   or `npm update <package>` then `npm ci`, on a branch, with the checks
   that the moved crate needs; the updater's TLS crates always get the
   full Rust set plus a note for the release bullet.
3. Fix only in a major: the parent has to move. For the updater or
   Tauri that is the deferred jump (decided 2026-10-29), so the alert is
   dismissed `tolerable_risk` with the reason and the date the jump is
   expected, or left open if it is high or critical and the maintainer
   wants it visible; ask.
4. No fix published: a reachable one stays open (visible is the point;
   an open alert takes no comment); a build-time-only one under `shadcn`
   is dismissed `tolerable_risk` with the standing decision's wording.
5. Dismissal reasons GitHub accepts: `fix_started`, `inaccurate`,
   `no_bandwidth`, `not_used`, `tolerable_risk`. Use the one that is
   true; `no_bandwidth` is never true here.

```sh
gh api -X PATCH repos/bekalpaslan/promptline/dependabot/alerts/<n> \
  -f state=dismissed -f dismissed_reason=not_used \
  -f dismissed_comment="<the cargo tree command and what it printed>"
```

## 4. The config

`.github/dependabot.yml` is version updates only; alerts are a
repository setting (on since 2026-10-29). Change it when a rule above
changes, never to make a particular PR pass: add a `dependency-name`
ignore for a package whose majors are never wanted (it is already `*`
for majors), move a group's `schedule.interval` only with the maintainer,
and keep `open-pull-requests-limit` small. A changed config makes
Dependabot rerun within minutes, not at the next tick, but a PR built
before the push keeps its old contents: comment `@dependabot recreate`
on it (a PR comment; `@dependabot rebase` only rebases) and it is rebuilt
under the current ignores. Closing it instead also works and a fresh PR
follows within minutes.

## 5. The report

Plain text, in this order: the triage table as it stood; per PR, merged
(squash SHA) or closed (the rule); per alert, fixed (branch and whether
a release bullet is owed), dismissed (reason) or left open (why); the
checks that ran locally with exit codes; what the maintainer still has
to decide; and, when a TLS or webview crate moved, the sentence the next
release notes should carry.

## What past rounds taught

- **2026-10-29, the first round.** Alerts had been off; turning them on
  showed five: three for `zip` (the updater's default feature, unused on
  Windows; turned off, closing all three), one for `glib` (Linux-only,
  dismissed `not_used`), one low for `deepmerge` under `shadcn` (no fix;
  open). Of the three grouped PRs that opened within minutes of the
  config landing, the actions one merged; the npm one had taken
  `typescript` 7 (typescript-eslint's peer range refuses it) and the
  cargo one `windows` 0.62 (six type errors in `platform.rs`), both
  closed and the semver-major ignore added. The deferred Tauri jump
  held: the lock stays at 2.11 on both sides.
- **The lock hole is not Dependabot's.** Dependabot writes its locks on
  Linux, where the `@emnapi/*` entries stay; the hole opens when `npm
  update --package-lock-only` runs on Windows. Run `npm ci` after any
  local lock change before pushing, and copy vanished entries back from
  `HEAD` with a script.
- **A config push does not rewrite an open PR.** The cargo group that was
  open when the Tauri-pair ignore landed kept `tauri-build` 2.7 after a
  close and recreate, because Dependabot had built it under the old
  config; `@dependabot recreate` as a PR comment rebuilt it under the new
  one. Recreation after a close took under two minutes, not the monthly
  tick.
- **2026-10-29, the recreated cargo group (#12).** Its body read as
  eleven in-range moves with `tauri` 2.11.5 → 2.11.6, and CI was green,
  but the lock resolved `tauri` 2.12.5, `tauri-build` 2.7.4, `wry` 0.57.1
  and `tao` 0.37.2: every plugin minor it took requires `tauri ^2.12`.
  The Tauri-pair ignore cannot stop a transitive move, and Dependabot's
  body never mentions one. The config gained the `tauri-plugin-*` minor
  ignore, `@dependabot recreate` closed #12 as "no longer being updated"
  and opened #13 within a minute (five moves, lock still at 2.11), which
  merged. `tauri` 2.11.6 carries GHSA-w28w-mhc8-qvjv (high: a hostile
  webview could drain another webview's channel responses); Promptline
  loads no remote content, so it was a free patch, not an exposure, and
  no alert had been raised for it. The script now compares the PR lock's
  `tauri` with master's.
