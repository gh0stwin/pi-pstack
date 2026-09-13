---
name: reproduce-and-fix-issues
description: Reproduce triaged bugs through a configured app-verification adapter, verify existing fixes, and open a bounded draft pull request only after before-and-after proof. Use only from the configured Benny reproduce run.
disable-model-invocation: true
---

# Reproduce and fix issues

The run prompt carries the intake binding: the source item, the source thread, the verdict location, and the adapter that reads and posts. Read the binding contract and the adapter notes in [`../../references/intake-binding.md`](../../references/intake-binding.md) before the first source read or post.

The event either names one report through the binding or asks for a sweep (`{"sweep": true}`). On a sweep, the binding names the source collection and the adapter; scan it for the oldest report that carries a trusted triage marker from the binding's trusted verdict identity, has no repro reply yet, and is still inside the configured verdict budget. Run that one report. Stop cleanly when there is none; a sweep that finds nothing is not a failure.

Wait for a trusted triage marker in the source thread. Reproduce the exact symptom through the target app's real UI. Verify an existing fix when one exists. Attempt a bounded fix only after a confirmed repro.

Load the external Benny configuration supplied by the run. If the config, the binding, the adapter, the verification skill, or the completed feature map is missing, stop without posting or writing to the source.

## Hard safety rules

- Exactly one verdict per run, posted at the binding's verdict location through the binding's adapter.
- Never open a new top-level post for the report.
- The binding's source coordinates are immutable.
- Preflight the source item before every source-thread post.
- The coordinator is the only adapter poster.
- Delegated analysis workers are read-only and return findings or media notes.
- A fix-phase code worker may edit only when its environment provably excludes adapter credentials and every adapter write action. Otherwise the coordinator edits.
- Every child prompt must forbid every adapter write, naming the concrete actions from the adapter contract.
- Never give a child adapter credentials, posting instructions, source coordinates for posting, or permission to report externally.
- If a child needs adapter write access to run, do not launch it.
- Utility bots are evidence sources. They do not own the fix unless a person explicitly delegated the fix to them.
- The exact discriminating symptom must appear twice through real UI interaction.
- State inspection may confirm an observation. It must not inject or force the symptom.
- No confirmed repro means no authored fix.
- Existing pull requests or commits switch the run to verify mode. Do not author over them.
- Use `github.com` pull request links.
- Keep captures, recordings, logs, and tokens out of source control.
- Fail closed when the binding, the adapter, the verification skill, or the completed feature map is missing or uncertain.
- Use pstack's `principle-guard-the-context-window` for delegated analysis.
- Apply pstack's `principle-sequence-verifiable-units`, `principle-fix-root-causes`, and `principle-prove-it-works` through repro, fix, and verification.

## Subagents on pi

Spawn delegated workers with pi-pstack's `subagent` tool and `readonly: true`, which pins `read`, `grep`, `find`, and `ls`. A subagent is a separate pi process that inherits the parent environment, so never export an adapter credential into an environment a worker will run in. Keep the coordinator as the only poster.

## 1. Freeze the binding

Before making a work list or delegating:

1. Read the source item, source thread, and verdict location from the binding.
2. Require all three to be nonempty and consistent with the event or the sweep result.
3. Store them as SOURCE_ITEM, SOURCE_THREAD, and VERDICT_LOCATION, fixed for the run.
4. Read the source thread through the binding's adapter and verify that its root is the source item.
5. Fetch the source permalink through the adapter.

Never replace these values with a reply, operations, or status-message coordinate.

Before every source post:

1. Read the source thread by the fixed coordinates through the adapter.
2. Confirm the source item exists, is not deleted, and still belongs to the source thread.
3. Post only through the binding's adapter, at the verdict location.
4. Read the source thread again and verify the new message is at the verdict location.

If any check fails, post nothing. Never retry at the source root or in a fallback location.

## 2. Wait for the triage contract

Watch the source thread through the adapter for the configured verdict budget. Stay silent while waiting.

Accept a verdict only when:

- Its author matches the binding's trusted verdict identity.
- It is at the verdict location under the source thread.
- It contains exactly one configured marker.

Public marker forms:

```text
[benny:bug]
[benny:bug] tracker=https://tracker.example/issue/123
[benny:performance]
[benny:performance] tracker=https://tracker.example/issue/123
[benny:other]
```

Proceed only for `bug` or `performance`. Capture the optional tracker URL. Stop silently for `other`, a missing verdict, an untrusted author, conflicting markers, or a timeout.

This marker replaces private bot identities and free-form verdict matching.

## 3. Apply ownership and fix-artifact gates

Re-read the source thread through the adapter immediately before starting work.

### Someone is explicitly fixing it

Stop when a person clearly claims the fix, gives a concrete implementation plan, or asks another agent to implement, patch, fix, or open a pull request.

Do not treat these as fix ownership:

- A bot summarizes evidence.
- A tool looks up logs or tickets.
- Someone asks a bot to diagnose, explain, inspect, or reproduce.
- A bot posts a cause hypothesis without agreeing to implement it.

Judge the requested action, not the presence of a bot.

### A fix artifact already exists

If an open pull request or merged commit plausibly fixes this report, switch to `references/verify-existing-fix.md`.

An artifact may come from the source thread, tracker issue, repository history, or pull request search. A claim without a commit or pull request is not a fix artifact.

If a person owns the work but has not produced an artifact, stop. Do not race them.

## 4. Use the optional operations location

When the binding names a separate operations location, such as an operations thread, the coordinator may create one root status message there. This is the only allowed top-level post in the repro workflow. Store its coordinates as OPERATIONS_LOCATION and never confuse them with the source coordinates.

When the binding names the run output, keep detailed status there and post no status message. Never substitute a source-thread root post.

Use the configured plain Unicode status strings. Keep status text short:

- Reproducing
- Could not reproduce
- Blocked
- Reproduced
- Verifying existing fix
- Attempting bounded fix
- Draft pull request opened
- Fix did not land

Use the binding's adapter for every source read, post, and edit. An adapter credential is used only for a narrow missing capability such as editing this one status message. Never expose the credential to a worker.

## 5. Load and check the verification adapter

Read `references/verification-adapter.md` and the completed map at `verification.feature_map_path`, then invoke the skill named by `verification.skill_name`.

Find the feature-map section that matches the reported user path. Read it before driving the app. If no section covers the feature, mark the run blocked instead of inventing a path or selector.

Require all seven capabilities:

1. Bring up the configured target app and test environment.
2. Navigate the mapped feature and exercise its documented states.
3. Drive the real UI with clicks, typing, keys, scrolling, drag, resize, or navigation.
4. Inspect state without mutating it.
5. Capture screenshots.
6. Start and stop a screen recording.
7. Clean up processes, sessions, profiles, and temporary data.

If the adapter is absent or any required capability is missing, mark the operations status as blocked and stop. Do not pretend a screenshot, unit test, state mutation, or source reading is a UI repro.

## 6. Study the report

Read the full source thread and tracker issue when present.

Collect:

- Exact action path
- Expected behavior
- Observed behavior
- Discriminating state where they diverge
- Frequency
- Version, environment, and platform
- Attachments and error signatures
- Candidate code area

Inspect screenshots and video. Use read-only parallel workers for code history, test ideas, blast-radius mapping, and media review when useful. Each worker gets a narrow question and the adapter-write prohibition.

Use pstack's `how` skill to trace the action through the repository. Use `why` for regression history and defensive code. Form competing cause hypotheses and identify evidence that would separate them.

## 7. Reproduce

Bring up the target app through the verification adapter.

Confirm the correct app, workspace, account, data set, and feature state before acting. Use stable app markers. Do not rely on window order or a familiar title alone.

Drive the reported path through real UI actions.

Before calling it reproduced:

1. Name the correct final state.
2. Name the broken final state.
3. Reach the point where they diverge.
4. Observe the broken state.
5. Reset enough state to make the second attempt independent.
6. Repeat the same path and observe the same broken state again.
7. Cross-check a real state value when possible.

An expected dialog, loading state, or setup step is not the bug. Capture the final state that distinguishes correct from broken behavior.

Use the configured repro budget. If the symptom does not reproduce within it, report a clean `Could not reproduce` outcome. If the environment cannot provide a required capability, report `Blocked` and state what was missing.

## 8. Capture and review evidence

For a successful repro:

- Record the full path through the symptom.
- Capture a screenshot of the broken final state.
- Save a short note with the exact steps and observed state.
- Keep artifacts in the configured temporary artifact directory.

Have a read-only media reviewer answer one question: does the evidence visibly show the discriminating broken state?

If the answer is no or uncertain, the repro is not confirmed. Capture better evidence or use `Could not reproduce`.

Post detailed evidence only in the operations location when configured. Keep the source update concise.

## 9. Report the repro outcome

Update the operations status first.

For `Could not reproduce` or `Blocked`, post nothing in the source thread. The operations location or run output carries the result.

For a confirmed repro, run the source preflight and post at most one unprompted verdict-location update:

- Say the issue reproduced.
- Link the operations evidence location when one exists.
- Include at most three short findings.
- Link the tracker issue when one exists.
- Do not ping an owner by default.

Attach evidence only when the binding's adapter keeps it at the verdict location and the organization's retention policy allows it.

Wait for the configured rejection window. If a person shows that the setup or interpretation was wrong, correct the repro once. Do not start the fix phase until the window closes without a valid rejection.

## 10. Verify an existing fix

When a fix artifact exists, follow `references/verify-existing-fix.md`.

Verification must show the symptom on the baseline and its absence on the patched build. Both paths use the real UI twice.

Do not edit the existing fix, add a competing patch, or open a replacement pull request.

## 11. Qualify a bounded fix

Attempt a fix only when all of these hold:

- The outcome is a plain confirmed repro.
- Media review confirmed the broken final state.
- No existing fix artifact appeared.
- No person claimed the fix during the rejection window.
- Runtime evidence identifies the root cause.
- The likely change fits the configured fix budget and repository scope.
- The verification adapter can run both baseline and patched builds.

If any condition fails, keep the repro report and stop without a pull request.

When the gate passes, update operations status to `Attempting bounded fix`.

## 12. Root-cause and implement

The coordinator owns every source post, the final diff review, commits, and the pull request.

Read-only workers may:

- Trace code and history
- Propose tests
- Map blast radius
- Review a diff
- Review media

They do not edit, run external writes, post status, or own the fix.

A tightly scoped code edit may be delegated during this phase only when tool isolation removes adapter credentials and every adapter write action from that worker. Its prompt must still carry the explicit adapter-write ban. The coordinator reviews the edit and runs or verifies the required tests. If tool isolation is uncertain, keep the edit in the coordinator.

Confirm the mechanism with runtime evidence. Eliminate competing hypotheses before editing.

Fix the root cause with the smallest justified change.

- Invoke pstack's `tdd` skill when there is a cheap local test target, and write the failing test before the fix.
- State why TDD was skipped when the path is expensive, unclear, or integration-heavy.
- Keep unrelated cleanup out.
- Stop if the change grows beyond the configured effort or risk budget.

## 13. Prove the fix

Keep the original baseline evidence.

On the patched build:

1. Run the same real UI path.
2. Repeat it twice.
3. Show that the broken state is gone.
4. Show the expected state in its place.
5. Capture an after recording and screenshot.
6. Cross-check the same real state value used for the baseline.

A compile, unit test, code review, or plausible diff is not after evidence.

Run focused tests, then smoke the blast radius around the changed behavior. Cover nearby states, inputs, permissions, platforms, and failure paths that the change could affect. Stop without a pull request if a regression remains.

## 14. Open a draft pull request

Only after before-and-after proof:

- Review the final diff for unrelated changes and secrets.
- Run the repository's required checks.
- Create small ordered commits when the repository workflow allows it.
- Open a draft pull request. Never merge or deploy from this workflow.
- Link the configured tracker issue using the tracker's supported pull request syntax.
- Use the configured public URL form, normally `https://github.com/{owner}/{repo}/pull/{number}`.
- Include the repro steps, root cause, test result, before and after evidence, and blast-radius checks.
- Run the pull request text and all source updates through pstack's `unslop` skill.

If pull request creation fails, do not claim success. Keep the commit or branch state in the run output and mark operations status `Fix did not land`.

On success, mark operations status `Draft pull request opened` and post one concise reply in the operations location with the linked pull request. Do not create a second source-thread root or unprompted source reply.

## 15. Follow-ups and cleanup

Watch the configured operations location for one follow-up window.

- Answer a direct question from evidence already gathered.
- Apply one concrete correction and rerun the repro once when it invalidates the setup.
- Stay out of human coordination and side chatter.
- Stop when asked.

Always call the verification adapter's cleanup capability. Keep artifacts only as long as the configured retention policy allows.
