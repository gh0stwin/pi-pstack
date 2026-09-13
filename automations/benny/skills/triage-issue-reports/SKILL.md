---
name: triage-issue-reports
description: Triage one report through its intake binding with a single verdict, evidence review, cause-aware routing, tracker dedupe, and fail-closed ticket creation. Use only from the configured Benny triage run.
disable-model-invocation: true
---

# Triage issue reports

Classify one report and post a single verdict at the binding's verdict location. Create a tracker issue only for a clear, new bug. Do not reproduce or fix it here.

The run prompt carries the intake binding: the source item, the source thread, the verdict location, and the adapter that reads and posts. Read the binding contract and the adapter notes in [`../../references/intake-binding.md`](../../references/intake-binding.md) before the first source read or post.

Load the external Benny configuration supplied by the run. If the config is missing, malformed, or incomplete, or the binding does not name the source item, the source thread, the verdict location, and the adapter, stop without posting or writing to the tracker.

## Hard safety rules

- Exactly one verdict per run, posted at the binding's verdict location through the binding's adapter.
- Never open a new top-level post for the report.
- The binding's source coordinates are immutable.
- Preflight the source item before any tracker write and immediately before the verdict post.
- If the source item or source thread is missing, deleted, inaccessible, or uncertain, stop with no writes.
- Post one substantive verdict. Do not narrate progress.
- The coordinator is the only adapter poster.
- Delegated workers return findings only. They must be read-only and receive no adapter credentials or write actions. Every child prompt must forbid every adapter write, naming the concrete actions from the adapter contract.
- If worker isolation cannot enforce those limits, do the work in the coordinator.
- Never create an issue that cannot link back to the source item.
- Prefer no ticket over a guessed or duplicate ticket.
- Fail closed when the binding, the config, or the tracker adapter is missing or uncertain.
- Apply pstack's `principle-separate-before-serializing-shared-state` to source coordinates.
- Apply pstack's `principle-minimize-reader-load` and `unslop` skills to the final verdict.

## Subagents on pi

Spawn delegated workers with pi-pstack's `subagent` tool and `readonly: true`, which pins `read`, `grep`, `find`, and `ls`. A subagent is a separate pi process that inherits the parent environment, so never export an adapter credential into an environment a worker will run in. Keep the coordinator as the only poster.

## 1. Freeze the binding

The run prompt carries the binding and the event. Before making a work list or delegating:

1. Read the source item, source thread, and verdict location from the binding.
2. Require all three to be nonempty and consistent with the event.
3. Store them as SOURCE_ITEM, SOURCE_THREAD, and VERDICT_LOCATION, fixed for the run.
4. Read the source thread through the binding's adapter and verify that its root is the source item.
5. Fetch a stable source permalink through the adapter.

Every later source read and post must use those stored values and the binding's adapter. Never replace them with a reply, status, or operations coordinate.

## 2. Read the whole report

Read the source item and its source thread through the adapter before deciding.

Capture:

- Reporter wording
- Product version, app build, environment, and platform when present
- Expected behavior
- Observed behavior
- Frequency and trigger
- Error text or stack signature
- Existing issue, commit, or pull request links
- Any explicit statement that someone is already fixing it

Inspect every relevant attachment through the adapter.

- Read screenshots at full useful resolution.
- Review video for the state transition that separates correct and broken behavior.
- Read logs, traces, and crash text for concrete signatures.
- If media needs specialist review, use a read-only media worker and ask a narrow question. The worker returns findings only.
- If an attachment cannot be read, say so in the verdict. Do not invent what it shows.

Use evidence already in the source thread before asking the reporter for more.

## 3. Trace cause before routing

Do a bounded source and history pass before choosing an owner or destination. Use pstack's `how` skill to trace the path from the reported action to the observed result. Use `why` when the report looks like a regression or touches defensive code.

1. Identify the likely code path from the reported action to the observed result.
2. Check whether the visible symptom belongs to that code path or a dependency below it.
3. Check recent changes when the report looks like a regression.
4. Check whether a merged commit or open pull request already addresses the same symptom.
5. Separate confirmed facts from hypotheses.

This pass does not need a complete root cause. It must be strong enough to avoid routing a visible symptom to the wrong owner.

If the repository cannot be read, do not guess a code owner. Continue with a conservative classification and say that cause tracing was unavailable.

## 4. Classify

Choose one category.

### Bug

Something violates intended behavior. Examples include wrong output, broken state, an error, a crash, a hang, a silent no-op, or a regression.

### Performance

The report describes measurable slowness, excess memory, battery drain, jank, or another resource problem. Treat it as a bug, but preserve measurements and profiles.

### Feature request

The current behavior appears intentional and the reporter wants a different behavior or affordance.

### Question or feedback

The report asks how something works, expresses a preference without a concrete defect, or gives general feedback.

### Reroute

Cause tracing shows that another configured destination owns the issue.

When the bug versus feature line is unclear, do not file. The one verdict may ask one focused question and use the `other` marker.

## 5. Apply configured routing

Read the optional routing map from `routing.map_path`.

- Match on confirmed product area, code path, or error signature.
- A visible symptom alone is not enough when cause tracing points elsewhere.
- If no route matches, say the owner is unclear. Do not guess.
- Do not cross-post. Tell the reporter where to take the issue at the verdict location.

Owner pings are off by default. A ping is allowed only when all of these hold:

1. The routing map explicitly names the owner.
2. The config allows that ping type.
3. The item is a feature request that needs owner input, or recent history identifies a likely regression author with strong evidence.
4. The owner is not a broad on-call group.

No other case gets a ping.

## 6. Use the issue-tracker adapter

The tracker is an adapter, not a required vendor. A Linear adapter is one valid example. A GitHub Issues adapter or another tracker may implement the same contract.

The configured adapter must provide:

- Search issues by text, state, label, source URL, and date range
- Read one issue and its links
- Create an issue with title, body, status, labels, and source URL
- Update an existing issue without replacing unrelated fields
- Add a source link and recurrence note
- Cancel, close, or delete an issue created by this run if the source handoff fails

If a required operation is unavailable, do not perform that write.

Resolve configured team, project, status, and labels at runtime. Do not invent IDs, create labels, assign owners, or set priority unless the config explicitly requires it.

## 7. Dedupe

Always check whether this source permalink is already linked to a tracker issue or a prior triage verdict. If so, do not post or create a duplicate.

For bugs and performance reports, search the tracker using:

- Exact error or crash signature
- Product area
- Trigger
- Symptom
- Version or date window
- Suspected regression commit
- Source permalink

Choose one outcome:

- Confident duplicate: same signature, or the same area, trigger, and symptom, or a confirmed shared cause.
- Possibly related: a shared cause is plausible but not proven.
- Weak resemblance: similarity is superficial.
- No match.

For a confident duplicate, update the existing issue with the source permalink and one short recurrence note. Do not reopen, relabel, or reassign it unless the config says to.

For a possible match, link it in the verdict as uncertain and create nothing.

A long-closed issue is a regression lead, not automatically a live duplicate.

## 8. Decide whether to create

Create only when all of these are true:

1. The classification is bug or performance.
2. The behavior is clearly broken.
3. The issue is still live or not known to be fixed.
4. Dedupe found no confident or plausible live match.
5. The source item and permalink passed preflight.
6. The tracker target fields resolved.
7. The adapter can compensate if the verdict post fails.

Never create for a feature request, question, feedback item, reroute, possible duplicate, confident duplicate, or already-fixed issue.

The new issue must be self-contained:

- Plain title that names the area and symptom
- Reporter quote
- Expected and observed behavior
- Version and environment, or `unknown`
- Trigger and frequency
- Source item permalink
- Short cause-tracing findings with hypotheses labeled as hypotheses
- Inline screenshot or representative video frame when supported
- Links to remaining artifacts
- Configured intake status and labels

Do not put a guessed root cause in the title.

## 9. Post one verdict

Run a fresh source preflight. Then post the verdict at the binding's verdict location through the binding's adapter. The verdict is a reply or comment on the source item; it is never a new top-level post.

Keep the reply short:

- Lead with the outcome.
- Link the existing or new tracker issue when there is one.
- Mention a reroute or one missing fact when needed.
- Include at most one allowed owner ping.
- End with exactly one marker line.

Marker contract:

```text
[benny:bug]
[benny:bug] tracker=https://tracker.example/issue/123
[benny:performance]
[benny:performance] tracker=https://tracker.example/issue/123
[benny:other]
```

Use only the configured marker strings. The reproduce run trusts the marker only when it comes from the binding's trusted verdict identity in this source thread.

After posting, read the source thread through the adapter and verify the verdict appears at the verdict location. If it does not, never retry at the source root.

If this run created a tracker issue and the verdict did not land, use the adapter's compensation action. Verify that the issue is canceled, closed, or deleted. If compensation cannot be verified, report the failure only in the run output.

## 10. Watch one follow-up window

Watch the source thread through the adapter for the configured follow-up window, then stop.

- Answer only a direct question to the trusted verdict identity.
- Apply a concrete correction to the tracker issue when safe.
- Do not emit a second marker in the same run.
- Stay out of human coordination and side chatter.
- Stop early if someone asks Benny to stop.

Do not extend the window more than once. A new report should start a new run.
