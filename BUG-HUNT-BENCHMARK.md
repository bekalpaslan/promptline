# Bug hunt benchmark

## Prompt for the agent

You are working in a clean clone of the Promptline repository at the
benchmark commit (a Tauri 2 desktop app for Windows: Rust backend in
`src-tauri/`, React frontend in `src/`, shared pure logic in `ui/core.js`;
`README.md` and `BEHAVIOR.md` describe what the app is supposed to do).

A human has observed one specific bug in this app at this commit. The bug is
real and confirmed. There is no "no bug" outcome, and it is not a documentation
error. This codebase also contains several other real bugs; the human saw one
specific one, and finding a different real bug earns nothing. Your task is to
describe the bug the human saw so precisely that they confirm it.

**Scoring.** Your score is the number of messages you send to the human before
they confirm. Lower is better. Every message counts as one point, whether it
holds one question or five, whether it is a clarifying question or a final
guess. The confirming message itself counts.

**What the human will do.** The human answers only with one of:

- **Yes**
- **No**
- **Partially**
- **Can't answer as asked** (the question was not answerable with the above)

They will never volunteer information, hint, or correct you beyond those four
words. They will not run anything for you or describe what they see. Design
your questions so that these answers carry maximum information.

**What counts as confirmed.** Your final description must state, in plain
words, (1) the symptom: what the user sees or fails to see, and (2) the
trigger: the action or state that causes it. The human answers **Yes** only if
both match what they observed. Root cause, file, and line are not required and
earn nothing. A description that names a different real bug gets **No**.

**What you may do for free.** Read any file, run the tests, build and run the
app, drive it, take screenshots, read git history. None of this costs points.
Only messages to the human cost.

**Constraints.** Do not modify the repository. Do not ask the human to
perform actions. Do not capture the screen, and do not send keystrokes or
the global hotkey to any window you did not create yourself; if you run the
app, run it in a profile and session of your own. Do not send a message that is not a question or a candidate
description. Do not pad a message with multiple candidate descriptions to hedge:
the human treats a message with more than one candidate as **Can't answer as
asked**, and it still costs a point.

Begin. Investigate as much as you want before your first message.

## Rules for the human

- Pick one bug in advance and write down its symptom and trigger before the
  run. Do not change it mid-run.
- Answer only with Yes, No, Partially, or Can't answer as asked.
- Count every agent message, including the confirming one. That count is X.
- A message with several candidate descriptions: answer Can't answer as asked.
- A question you could answer Yes or No to but that the agent could have
  verified itself from the code: still answer it. It cost them a point.
- Stop the run at confirmation. Optionally also record whether the agent's
  stated root cause, if it offered one, was correct, as a secondary note that
  does not affect X.
- Use the same bug and the same commit for every agent being compared.

## Orchestrator prompt

Give this to the agent that runs the benchmark on the human's behalf. It plays
the human for every contestant, keeps score, and files the report. Fill in the
redacted block before starting; nothing in it may be written to the repository
until the human says the runs are over.

---

You are the orchestrator for the Promptline bug hunt benchmark in this
repository. Read `BUG-HUNT-BENCHMARK.md` for the contestant prompt and the
rules for the human. You will act as the human.

**The target bug** (known only to you and the human; never write it into any
file inside the repository, a worktree, or a message to a contestant until the
human says the runs are over):

> Trigger: A prompt has two or more tags. Open the popup (hotkey) and look at
> that prompt's row in the list, browsing or searching alike.
> Symptom: The row shows a pill for the first tag only. The remaining tags are
> not displayed anywhere on the row, so a multi-tag prompt looks single-tagged
> and its other tags cannot be seen or clicked from the list. The manager's
> editor shows all tags, and search by #tag still matches every tag, so the
> defect is display-only in the popup row.
> Notes for judging "Partially": Yes requires both "only the first tag is
> shown" and "on a popup row for a prompt with several tags". Partially for:
> the tag pill named but the wrong property (colour, label, click target);
> "tags missing from the popup" without the first-one-shows detail; the right
> symptom placed in the manager sidebar instead of the popup. No for: search
> or #tag filtering claims, pill colour or contrast, the manager editor's tag
> list, or any other row element (icon, {n} badge, Ctrl digit, preview card).
> "Browse list only" is narrower than the truth but still Yes.
>
> (This target was used for runs A–C on commit b36d67e and is now fixed on
> branch fix/bug-hunt. Pick a new one for future runs.)

**Setup.**

1. Confirm the working tree is at the agreed commit. Note its hash.
2. Ensure `BUG-HUNT-FINDINGS.md` exists with a header naming that commit and a
   "Candidates reported by agents" section. It may already hold entries from
   earlier runs. It must not mention the target bug.
3. For each contestant model the human names, spawn one agent with the
   contestant prompt from `BUG-HUNT-BENCHMARK.md`, verbatim, plus this
   mechanics paragraph appended:

   > MECHANICS. Each time you want to ask the human something, end your turn
   > with your final output being exactly the message to the human, prefixed
   > with the line "MESSAGE TO HUMAN:". You will then receive the human's
   > answer as a follow-up message, and you continue. Investigate as much as
   > you want before your first message. When the human answers Yes to a
   > candidate description, end with "DONE".

   Give each contestant its own copy of the clean clone, never a worktree of
   the development repository. The template lives at
   `C:/Users/alpas/IdeaProjects/easypaste-bench/template` (see "Clean clone"
   below); copy it to `easypaste-bench/<contestant>` with
   `robocopy template <contestant> /MIR /NFL /NDL /NJH /NJS` and point the
   contestant at that path in its prompt. The copy carries `node_modules`, so
   tests run without `npm ci`. Run contestants in parallel.

   Isolation rules, learned from runs A–C:
   - The clone has one branch and no untracked files, so nothing about the
     target, the findings, or the fix branch is visible in it. Keep it that
     way: never write your transcripts or the findings file inside a
     contestant's copy.
   - Do not rely on agent worktrees. One was auto-removed after the
     contestant's first turn, dropping it into the main checkout where the
     findings file was readable.
   - The human's screen and their running app instance are off limits. A
     contestant that sends the global hotkey and captures the screen can read
     the answer off the human's editor. The contestant prompt forbids it; do
     not leave the target written anywhere on screen regardless.

**Answering.** Every message a contestant sends ends its turn and reaches you
as its result. Reply with exactly one word or phrase, nothing else:

- **Yes** — a yes/no question whose true answer is yes, or a candidate
  description whose symptom and trigger both match the target.
- **No** — a yes/no question whose true answer is no, or a candidate that
  names a different bug, real or not.
- **Partially** — a yes/no question that is true for part of what it asks
  (for example, it names the right UI element but the wrong property), or a
  candidate that gets the symptom or the trigger right but not both.
- **Can't answer as asked** — anything that is not yes/no shaped, a message
  holding more than one candidate description, a request for you to do
  something, or a question you cannot honestly answer with the three above.

Never add words, hints, corrections, or encouragement. Do not answer a
question the contestant did not ask. If a contestant asks something it could
have found in the code, still answer it; it cost them a point.

**Counting.** Each contestant message costs one point, including the first
one and the confirming one. Keep a per-contestant tally as you go and state
it to the human after each answer ("Sonnet is at 6"). When you answer Yes to a
candidate description, the run ends at that count. If the contestant sends
another message after confirmation, do not reply and do not count it, but
note it in the transcript.

**Recording candidates.** Every candidate description a contestant sends,
whether the answer was Yes, No, or Partially, gets checked and filed:

1. Read the code paths it names, or search for them if it names none, and
   decide whether the described behaviour and any stated cause hold up.
2. Append a numbered entry to `BUG-HUNT-FINDINGS.md` with: reporter and
   message number, verdict, trigger, symptom, the contestant's stated cause
   if any, a "Code check" paragraph (confirmed, refuted, or unverified, with
   file and line and a one-sentence fix shape), and "Status: open, not fixed
   (repository frozen for the benchmark)".
3. Do not fix anything. Do not commit.

Candidates that match the target are the one exception: file nothing about
them until the human says the runs are over. Keep their run transcript in
your scratchpad in the meantime.

**Human-reported observations.** If the human mentions a bug of their own
mid-run that is not the target, check it the same way and file it as a
"Related (human-observed, not the target)" note under the nearest candidate
or as its own entry.

**Per-run transcript.** For each contestant keep a table of message number,
condensed message, and your answer, plus two or three sentences on its
strategy (did it split the space, walk features linearly, guess early, hedge).
Keep this in your scratchpad until the runs are over, then append all
transcripts and a score table to `BUG-HUNT-FINDINGS.md` under a "Runs" heading,
together with the now-unredacted target bug and its code check.

**Reporting to the human.** After each answer, one line: which contestant,
what it asked in a few words, what you answered, its tally. When a run ends,
its score and a one-line assessment. When all runs end, a score table and the
strategic difference between contestants in a short paragraph. Do not report
or predict a contestant's result before its message arrives.

---

## Clean clone

Contestants run from a single-branch clone of the benchmark commit, made with
a real transport so that unreachable objects (such as the fix branch's
commits) are not carried over:

```sh
git tag bench-1 b36d67e                       # label the edition
git clone --no-local --single-branch --branch master \
  C:/Users/alpas/IdeaProjects/easypaste \
  C:/Users/alpas/IdeaProjects/easypaste-bench/template
cd C:/Users/alpas/IdeaProjects/easypaste-bench/template
git checkout --detach bench-1
git remote remove origin                      # no fetch path back to the dev repo
npm ci
```

Per contestant: `robocopy template <name> /MIR`. Delete the copies when the
run ends. When the benchmark moves to a new edition, merge the fix branch,
pick a new target from the open list in `BUG-HUNT-FINDINGS.md`, tag the new
commit `bench-2`, and rebuild the template.
