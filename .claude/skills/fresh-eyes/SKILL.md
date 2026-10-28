---
name: fresh-eyes
description: An open-ended improvement review of Promptline in which the agents, not the asker, choose what to look at. Use this whenever the user asks what you would improve, change or do differently in this repo, wants fresh eyes on the project, or wants a review of the project as a whole rather than of one change or one doc, even without the word review. It orchestrates subagents or a workflow (independent discovery, a merge, rounds that look where nobody did, a deep-dive and an independent check per area) and returns one ranked report, with the calls only the maintainer can make in their own section. Read-only; it changes nothing in the repo.
argument-hint: '[empty = orchestrate as you judge best; "script" = run the ready-made workflow as is]'
---

# Fresh eyes

Ask agents what they would improve and give them examples, and the examples
become the list. This review names no areas. The agents find their own from
the evidence, name them in their own words, and are checked against what the
project has already decided before anything reaches the maintainer. It is the
"unless asked" case of CLAUDE.md's *start from the backlog, not from another
audit*.

You orchestrate; you don't do the review. Invoking this skill is the request
for multi-agent work: use subagents or a workflow.

## The pieces

- `references/brief.md`: the brief every agent that looks for or deepens
  areas gets, unchanged. It also works on its own as a prompt for a single
  agent, pasted anywhere.
- `scripts/workflow.js`: one ready-made way to run it (below). It carries
  its own copy of the brief's rules, split by stage, so a change to one is a
  change to both.

## The goal

The review the brief describes: the areas where this repository would gain
most from change, chosen by the agents rather than by you or the user, each
with evidence, a proposal and its cost, checked against what the project has
already decided, and ranked against a yardstick the project states or the
agents make explicit. *The report* below is the shape of your final answer.

## Yours to decide

The number of agents and rounds, what each one does, whether another round
is worth it, which areas to deepen, models and effort, and whether to use
subagents or a workflow. Spend in proportion: stop a round of looking once
it finds nothing new.

## Not yours to trade away

Each of these protects the goal.

1. **Don't split discovery by topic.** Giving one agent the code and another
   the strategy is choosing the areas, which is what this review exists not
   to do. Every agent that looks for areas gets the whole repository and the
   whole brief. Get diversity from their independence, and from later rounds
   that are told where the earlier ones began and asked to begin somewhere
   else. Split by area only once the areas exist.
2. **Don't form a view and brief it.** Don't read the repository to decide
   what matters before discovery has run; anything you add to a brief
   steers. The same goes for checkers: give them the proposal and its
   evidence, not your opinion of it.
3. **Every proposal is checked by an agent that didn't write it**, against
   its evidence and against the record (brief, step 3), before it reaches
   the report. A wrong fact or a repeat of something already decided drops
   it; a doubt about whether it's worth doing goes into the report as a
   doubt.
4. **Merge, don't concatenate.** One entry per underlying point, whatever
   each agent called it, with all its evidence and how many agents found it.
   Reconcile the agents' understandings and yardsticks and report where they
   disagree: that disagreement can be a finding in itself.
5. **Nothing is dropped silently.** If you cap, sample or skip, the report
   says what and why, and a cap never cuts first what only one agent could
   see.
6. **One checkout, shared.** Prepare it once before fanning out (unshallow,
   `npm ci`), keep it unchanged (brief, *Rules*), and give every agent that
   might start a dev server its own port. Keep the orchestration with you;
   don't hand it down to a subagent (workflow agents can't start agents of
   their own anyway).

Before you write the report, ask once what's missing (an angle no agent
took, a claim nobody checked) and run what that finds.

## The ready-made workflow

When `$ARGUMENTS` is `script`, or you have no reason to shape the run
differently, run `scripts/workflow.js` by its absolute path:

```
Workflow({ scriptPath: "<repo>/.claude/skills/fresh-eyes/scripts/workflow.js" })
```

It goes: one agent prepares the checkout (unshallow, `npm ci`, what runs
here); four blind discoverers each choose where to begin; a merge; up to two
gap rounds that begin where nobody did; a deep-dive per area, each source's
best area first, up to the cap; one skeptic per proposal, where evidence and
novelty are gates and worth only advises; then the report. About 32 agents
at the defaults, at the session's model and effort. `args` is optional:
`{ discoverers: 4, gapRounds: 2, maxAreas: 12 }` are the defaults, and
`gapRounds: 0` skips the gap rounds. The workflow returns the report; relay
it, and add what your own *what's missing* pass found.

## The report

In the reply, in Markdown, in RELEASE-AUDIT.md's shape:

1. **Scope**: the commit read, and what could and couldn't run.
2. **The yardstick**: whether the project states what success means for it,
   quoted with sources, or that it doesn't and what the agents assumed
   instead. Then the project in one paragraph, and where the agents
   disagreed.
3. **Do first**: which proposal, and why.
4. **Summary table**: id (P1, P2…), area, status (TODO, or DECISION when it
   waits on the maintainer's call), effort, confidence.
5. **Decisions for you**: each proposal that needs a call, as the question
   to answer, with the options and the agents' pick.
6. **Proposals**, ranked by value against effort: a heading per id, then
   Status / Now (with evidence) / Value / Change and first step / Effort /
   Risk / Record / Confidence, any correction a checker made, *Contested*
   with the reason when the worth test went against it, and *Unverified*
   when a test couldn't be run.
7. **Checked and found fine**, one line each.
8. **Dropped**, one line each with why; then **not deepened**, one line
   each.

It's a list of proposals, not a tracker: don't write it into
`docs/history/` or `BACKLOG.md`. A proposal the maintainer takes up becomes
a backlog item, or an entry in a tracker of RELEASE-AUDIT.md's shape, then
and on their say-so.

## Why it's built this way

Four critics stress-tested the first draft on 2026-10-28. What they found,
kept here so a later edit doesn't undo it:

- **Examples anchor, disguised ones too.** Giving each discoverer an
  assigned starting point brought back the original examples under new
  names, so discoverers now choose where to begin and later rounds begin
  where they didn't.
- **Evidence limited to file and line turns any review into a code
  review.** Evidence can also be a URL opened during the run, or reasoning
  laid out so it can be argued with; the repository is the evidence, not
  the limit of what may be proposed.
- **Reading the record first hands agents its categories.** The record here
  is mostly code and bug audits, so it's checked after discovery, not
  before.
- **A majority vote over different tests lets wrong facts and repeats
  through**, and "refuted unless confirmed" kills anything the repository
  can't prove, which is most proposals about direction. Evidence and
  novelty are gates; worth is advice.
- **Capping by agreement cuts what only one agent could see first**, so
  every source gets its best area in before the rest fill by potential.
- **The yardstick step is the one deliberate steer.** No tracked doc says
  what success means for Promptline (the strategy lives in the local-only
  `docs/MARKETING.md`), and without the step each agent ranks against a
  yardstick it never states. Whether agents notice that gap unprompted is
  untested: to find out, run discovery with step 1 cut to its first
  sentence.
