---
name: maintenance
description: Run a maintenance pass on Promptline, keeping what exists healthy and true with no features, redesigns or behaviour changes. Use this whenever the user asks for maintenance, upkeep, housekeeping, chores, a tidy-up or cleanup of the repo, or asks to get the project back in shape between releases, even without the word maintenance. It checks the baseline, then runs the dependency and doc skills, prunes the backlog, refreshes the architecture map if it's due, and lists what's left to clean up, all on a chore branch, and reports what changed and what needs the maintainer. For an open-ended review of what to improve, use fresh-eyes instead. It never releases.
argument-hint: '[empty = the whole pass; or a step: baseline, deps, docs, backlog, map, housekeeping]'
---

# Maintenance

A pass that keeps what exists healthy and true: no features, no redesigns,
no behaviour changes. CLAUDE.md is the authority on how this repo works,
and this skill follows it rather than restating it. Work out the current
state yourself, and start from that and `BACKLOG.md`, not from a new audit.

## Scope

`$ARGUMENTS` narrows the pass to one step of the list below. Empty means
all of them, in order, skipping any that is already clean.

## Setup

Check the git state first, and never disturb work in progress: if the
checkout is dirty or on a branch with open work, use a fresh worktree off an
up-to-date `master` (CLAUDE.md → *Working in parallel* has what a new
worktree needs). Do the work on a `chore/maintenance-<date>` branch.

## The pass

1. **Baseline.** Confirm CI is green on `master` and run every check in
   CLAUDE.md → *Checks*. Fix what's red at the cause, without suppressing,
   skipping or loosening anything.
2. **Dependencies.** Run `/dependabot` and follow its standing rules.
3. **Docs.** Run `/doc-audit`, scoped to everything since the latest
   release tag.
4. **Backlog.** Flag entries that are already done or overtaken by a
   decision. Do only small, safe entries that don't change behaviour.
5. **Architecture map.** Refresh it if the rule in CLAUDE.md →
   *Architecture map* applies, in its own commit.
6. **Housekeeping.** List finished worktrees, merged branches, and anything
   with a date coming due, such as the certificates and keys under the
   custody notes. Keep branches that hold shelved work, `theme/*` above all.
   Ask before deleting anything.

## Standards

- Follow the conventions, line-ending rules and lockfile recipes in
  CLAUDE.md. Keep one concern per commit.
- If a fix must change behaviour, update `BEHAVIOR.md` in the same commit
  and add a test named for the behaviour.
- Anything out of scope goes in `BACKLOG.md` rather than widening the
  change.
- Leave generated media alone unless the pass changed what it shows.

## Limits

- Don't release, tag, bump the version, touch the updater feed, or post
  anywhere.
- Don't rewrite history or change signing keys or identifiers.
- Don't merge to `master` or push without the maintainer's go-ahead. That
  holds inside `/dependabot` too.
- Bring decisions that are the maintainer's one at a time, each with a
  recommended default.

## Finish

Run all the checks again from the branch and remove any worktrees you
created. Report what changed by commit, what you skipped and why, what you
added to the backlog, and what needs the maintainer's decision. Show failing
output in full.
