---
name: setup-benny
description: Configure Benny and prepare its triage and reproduce runs on pi. Use when installing Benny or changing its Slack CLI, tracker, repository, routing, verification, model, or budget settings.
---

# Set up Benny

The human enters setup by pointing pi at the pack's `FOR_AGENTS.md`, or by running `/skill:setup-benny` from a session rooted in the target repository. Either way this file is the checklist. The destination is `<target-repository>/.pi/automations/benny/`.

Benny needs external configuration, a Slack CLI, and two headless pi runs. pi has no hosted automations, so the runs are GitHub Actions workflows (`templates/benny-triage.yml`, `templates/benny-reproduce.yml`) or the local runner (`runner/benny-run.ts`). Both invoke `pi -p`.

Do this before asking for Benny configuration.

## 1. Choose the target repository

Ask which repository will run Benny. Treat the directory containing `FOR_AGENTS.md` as the source pack.

## 2. Merge the pack

1. Merge the entire source pack into `<target-repository>/.pi/automations/benny/`.
2. Preserve every destination-only file. Never delete unrelated files or overwrite user-owned configuration, feature maps, or routing maps.
3. When an existing destination file at a source-managed path differs, review the diff and merge without discarding local edits. If ownership is ambiguous, stop and ask before replacing it.
4. Verify that the copied `FOR_AGENTS.md` and `skills/setup-benny/SKILL.md` exist in the target repository.

## 3. Install pi-pstack for the target repository

Add pi-pstack to the target repository's project settings so a fresh checkout resolves the shared skills Benny uses (`how`, `why`, `tdd`, `unslop`, and the principle skills):

```bash
pi install -l git:github.com/gh0stwin/pi-pstack
```

That writes `.pi/settings.json`. If the file already exists, preserve every unrelated setting and package. Do not hand-edit JSON: rerun `pi install -l` for the addition and leave the rest alone.

Then run `pi list -l` and confirm `pi-pstack` resolves in project scope.

## 4. Ask for the configuration

Ask for each value below and record it in a user-owned configuration file outside this pack, for example `.pi/benny/configuration.yaml`. Start from [`../templates/configuration.example.yaml`](../templates/configuration.example.yaml).

Required:

- Source Slack channel id
- Triage identity (the Slack user id Benny posts as)
- Repository URL and default branch
- Tracker adapter and its target fields
- Slack CLI command name
- Verification skill name and completed feature-map path
- Models per role, as pi model ids from `pi --list-models`
- Status emoji strings
- Budgets

Optional:

- Operations channel id
- Routing map path
- `BENNY_SLACK_BOT_TOKEN` for the narrow capabilities the CLI exposes

Use only model ids that `pi --list-models` reports, or `inherit-parent` / `auto`. Do not guess an id and do not carry over a private default.

The source channel, triage identity, repository, tracker adapter, verification skill, and feature map must be explicit. Fail setup if any required value stays ambiguous.

## 5. Provide the Slack CLI

pi has no Slack integration, so Benny reads and posts through a CLI the repository provides. Set its name in `slack.cli`. It must implement:

```text
<cli> thread <channel> <ts>              # JSON: root message and replies
<cli> permalink <channel> <ts>           # permalink URL
<cli> post <channel> <ts> <text>         # reply in the thread, prints the new ts
<cli> react <channel> <ts> <emoji>       # add a reaction
<cli> edit <channel> <ts> <text>         # edit a message the identity owns
<cli> download <file-id> <dest>          # write an attachment to dest
```

The CLI owns the token. Keep the token in a secret manager or the environment, never in YAML, never in the repository, and never in a worker's environment.

If the repository has no such CLI, stop and tell the user Benny cannot post. Do not substitute a browser session or a personal token.

## 6. Prepare the tracker adapter

The tracker is an adapter, not a required vendor. `gh issue` is the reference adapter for GitHub Issues; a Linear, Jira, or other adapter may implement the same contract. Record the adapter command in `tracker.adapter`.

The adapter must be able to search, read, create, update, and link issues, and to cancel an issue this run created when the Slack handoff fails.

## 7. Verify the verification skill

Read [`../skills/reproduce-and-fix-issues/references/verification-adapter.md`](../skills/reproduce-and-fix-issues/references/verification-adapter.md) and the user's completed feature map.

The verification skill named in `verification.skill_name` must provide all seven capabilities: bring up, navigate, drive the real UI, inspect state read-only, capture screenshots, record video, and clean up. If the project has no such skill, offer once to generate one with `/skill:create-verification-skill`.

Copy and fill [`../skills/reproduce-and-fix-issues/references/feature-map.example.md`](../skills/reproduce-and-fix-issues/references/feature-map.example.md) to `verification.feature_map_path`. Pack refreshes must not overwrite it.

## 8. Prepare the routing map

1. Copy [`../skills/triage-issue-reports/references/routing.example.md`](../skills/triage-issue-reports/references/routing.example.md) to `routing.map_path`.
2. Fill in the destinations and the owner ping policy.
3. Delete the example file from the pack copy. Keep only the filled map.

## 9. Wire the runs

pi has no automation editor. Benny runs as headless jobs:

1. Copy [`../templates/benny-triage.yml`](../templates/benny-triage.yml) and [`../templates/benny-reproduce.yml`](../templates/benny-reproduce.yml) to `.github/workflows/`.
2. Add the repository secrets each workflow names (`PI_PROVIDER_KEY` or the provider keys pi needs, plus `BENNY_SLACK_BOT_TOKEN` when the CLI uses it).
3. Confirm the workflow checks out the repository at `repository.default_branch` and that the operational files are committed there.
4. For a local run, use [`../runner/benny-run.ts`](../runner/benny-run.ts):

```bash
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"channel":"C0123","ts":"1700000000.000100"}'
```

Each run's prompt must read and follow its exact committed operational file:

- Triage: `.pi/automations/benny/skills/triage-issue-reports/SKILL.md`
- Reproduce and fix: `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`

## 10. Verify before enabling

Confirm that `.pi/settings.json`, `.pi/automations/benny/`, and every referenced secret-free configuration file are committed on the branch the workflow checks out.

Then verify from a fresh session rooted in the target repository:

1. `pi list -l` shows `pi-pstack`.
2. The shared skills resolve in project scope. Do not count skills loaded from the current session or a user-scoped install.
3. `<cli> thread <source channel> <a known ts>` returns the root and its replies.
4. The tracker adapter can read one known issue.
5. The verification skill brings the app up and takes one screenshot.

If any check fails, stop. Tell the user Benny cannot be enabled yet and name the failing check.

## 11. Send a harmless test report

Send a test report in the source channel and confirm:

- Exactly one verdict reply lands under the original thread.
- The verdict carries exactly one marker.
- No root message is posted in the source channel.
- The reproduce workflow either waits for the marker or stops cleanly on `[benny:other]`.

Do not enable either run before the test passes.
