---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/skill:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent finds its own transcript file before fanning out. Use `$PI_SESSION_FILE` from the bash tool environment: it is the absolute path to the active session JSONL. If it is unset (an ephemeral session), write a tight digest of the session and pass that instead.

When `$PI_SESSION_FILE` is unavailable but the session was persisted, recover the file from this workspace's history. Sessions live in `<agent dir>/sessions/--<workspace-slug>--/*.jsonl`, where `<agent dir>` is `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}` and the session directory honors `$PI_CODING_AGENT_SESSION_DIR`; the slug is the workspace's absolute path with the leading separator dropped and every slash, backslash, or colon turned into `-`. Scan only this workspace's directory: globbing across workspaces crosses boundaries and reads private chats from unrelated projects.

```bash
session_dir=${PI_CODING_AGENT_SESSION_DIR:-"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/sessions/--$(pwd | sed 's|^/||; s|[/\\:]|-|g')--"}
ls -t "$session_dir"/*.jsonl 2>/dev/null | head -10
```

A pi session file starts with a session header line (`{"type":"session",...}`), not the prompt. For each candidate, find the first `{"type":"message",...}` line whose `message.role` is `"user"` and check that its text contains the conversation's opening user prompt. Take the matching path. If no path resolves, write a tight digest of the session and pass that instead.

### 2. Spawn three reviewers in parallel

One message, three parallel `subagent` calls with `agent: worker` and the role for each lens. Do not set `readonly: true`; reviewers may need context tools (tickets, chat threads, observability traces referenced in the transcript).

| Lens | `role` | Prompt template |
|---|---|---|
| Judgment | `reflect judgment` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `references/tooling-reviewer.md` |
| Divergent | `reflect divergent` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the subagent response body.

### 3. Synthesize

One `subagent` call with `agent: worker` and `role: "reflect synthesizer"`. Do not set `readonly: true`. The synthesizer's quality check includes spot-verifying citations, which can require context tools. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the **create-skill** skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to **create-skill** and run its description-optimization loop.
- `new skill via create-skill: <kebab-name>`: hand creation to **create-skill**. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
