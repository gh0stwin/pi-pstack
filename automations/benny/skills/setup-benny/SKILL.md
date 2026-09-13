---
name: setup-benny
description: Configure Benny and prepare its triage and reproduce runs on pi. Use when installing Benny or changing its intake source, Slack CLI, tracker, repository, routing, verification, model, or budget settings.
---

# Set up Benny

The human enters setup by pointing pi at the pack's `FOR_AGENTS.md`, or by running `/skill:setup-benny` from a session rooted in the target repository. Either way this file is the checklist. The destination is `<target-repository>/.pi/automations/benny/`.

Benny needs external configuration, an intake source, and two headless pi runs. pi has no hosted automations, so the runs are GitHub Actions workflows (`templates/*.yml`) or the local runner (`runner/benny-run.ts`). Both invoke `pi -p`.

Benny takes reports from Slack, GitHub issues / the CLI, GitLab issues, or any source that can build an intake binding (the generic webhook/CLI intake). Slack is one option, not a requirement: a user who does not use Slack sets `intake.source: github`, `intake.source: gitlab`, or `intake.source: webhook` and never provides a Slack CLI or token.

Every run receives one intake binding: the source item, the source thread, the single verdict location, and the adapter that reads and posts. The operational files are written in those terms, and [`../../references/intake-binding.md`](../../references/intake-binding.md) is the contract behind them.

Do this before asking for Benny configuration.

## 1. Choose the intake source

Ask which intake the user wants and record it as `intake.source` in the configuration:

- **Slack** (default): reports arrive as messages in a source channel and Benny replies in the source thread through a repository-provided Slack CLI. Steps 6 and 11's Slack checks apply.
- **GitHub issues / CLI**: reports arrive as issues or as `benny-run.ts --event` invocations. Benny posts the verdict as an issue comment through the tracker adapter. No Slack CLI, no Slack token, and no `slack:` section in the config.
- **GitLab issues / CLI**: reports arrive as GitLab issues or as `benny-run.ts --event` invocations naming the issue `iid` and URL. Benny posts the verdict as exactly one comment on the issue through the GitLab tracker adapter. Set `gitlab.project` and `gitlab.token_env`; no Slack CLI, no Slack token, and no `slack:` section in the config.
- **Webhook / CLI**: reports arrive from any source that can hand the runner a binding: a source item, a source thread, a verdict location, and the adapter read and post commands. The binding travels in the event, so this intake needs no Slack values and no intake section beyond `intake.source: webhook`.

If the user does not use Slack or does not want to incorporate it, choose the GitHub, GitLab, or webhook intake and continue without Slack. Do not block setup on a missing Slack CLI for that choice.

## 2. Choose the target repository

Ask which repository will run Benny. Treat the directory containing `FOR_AGENTS.md` as the source pack.

## 3. Merge the pack

1. Merge the entire source pack into `<target-repository>/.pi/automations/benny/`.
2. Preserve every destination-only file. Never delete unrelated files or overwrite user-owned configuration, feature maps, or routing maps.
3. When an existing destination file at a source-managed path differs, review the diff and merge without discarding local edits. If ownership is ambiguous, stop and ask before replacing it.
4. Verify that the copied `FOR_AGENTS.md` and `skills/setup-benny/SKILL.md` exist in the target repository.

## 4. Install pi-pstack for the target repository

Add pi-pstack to the target repository's project settings so a fresh checkout resolves the shared skills Benny uses (`how`, `why`, `tdd`, `unslop`, and the principle skills):

```bash
pi install -l git:github.com/gh0stwin/pi-pstack
```

That writes `.pi/settings.json`. If the file already exists, preserve every unrelated setting and package. Do not hand-edit JSON: rerun `pi install -l` for the addition and leave the rest alone.

Then run `pi list -l` and confirm `pi-pstack` resolves in project scope.

## 5. Ask for the configuration

Ask for each value below and record it in a user-owned configuration file outside this pack, for example `.pi/benny/configuration.yaml`. Start from [`../../templates/configuration.example.yaml`](../../templates/configuration.example.yaml).

Required for every intake:

- Intake source (`slack`, `github`, `gitlab`, or `webhook`)
- Repository URL and default branch
- Tracker adapter and its target fields
- Verification skill name and completed feature-map path
- Models per role, as pi model ids from `pi --list-models`
- Status emoji strings
- Budgets

Required for the Slack intake only:

- Source Slack channel id
- Triage identity (the Slack user id Benny posts as)
- Slack CLI command name

Required for the webhook intake only:

- The binding each source sends: source item, source thread, verdict location, and the adapter read and post commands. Record the shape in the source's own documentation; the runner validates it per event.

Required for the GitLab intake only:

- GitLab project path (`gitlab.project`), for example `group/project`
- The name of the environment variable that holds the GitLab token (`gitlab.token_env`), for example `GITLAB_TOKEN`. The token itself stays in the environment or a secret manager, never in YAML and never in the repository.

Optional:

- Operations channel id (Slack intake)
- Routing map path
- `BENNY_SLACK_BOT_TOKEN` for the narrow capabilities the Slack CLI exposes (Slack intake only)

Use only model ids that `pi --list-models` reports, or `inherit-parent` / `auto`. Do not guess an id and do not carry over a private default.

For `intake.source: slack`, the source channel, triage identity, Slack CLI, repository, tracker adapter, verification skill, and feature map must be explicit. For `intake.source: github`, the Slack values are not asked for and their absence is not an error; the repository, tracker adapter, verification skill, and feature map must be explicit. For `intake.source: gitlab`, the Slack values are not asked for and their absence is not an error; the GitLab project and token environment, tracker adapter, verification skill, and feature map must be explicit. For `intake.source: webhook`, only the repository, tracker adapter, verification skill, and feature map are asked for; the event carries the rest. Fail setup if a required value stays ambiguous.

## 6. Provide the Slack CLI (Slack intake only)

Skip this step when `intake.source` is `github`, `gitlab`, or `webhook`; a no-Slack install has no CLI contract to satisfy.

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

If the user wants the Slack intake and the repository has no such CLI, stop and tell the user Benny cannot post. Do not substitute a browser session or a personal token. If the user does not use Slack, switch to `intake.source: github`, `intake.source: gitlab`, or `intake.source: webhook` instead of building a CLI.

## 7. Prepare the tracker adapter

The tracker is an adapter, not a required vendor. `gh issue` is the reference adapter for GitHub Issues, `glab issue` for GitLab, and a Linear, Jira, or other adapter may implement the same contract. Record the adapter command in `tracker.adapter`.

The adapter must be able to search, read, create, update, and link issues, and to cancel an issue this run created when the source handoff fails. For the GitHub and GitLab intakes it also carries the verdict: the run posts one issue comment on the source issue instead of a Slack thread reply. `tracker.adapter` is required for those intakes, and the runner fails closed without it.

## 8. Verify the verification skill

Read [`../reproduce-and-fix-issues/references/verification-adapter.md`](../reproduce-and-fix-issues/references/verification-adapter.md) and the user's completed feature map.

The verification skill named in `verification.skill_name` must provide all seven capabilities: bring up, navigate, drive the real UI, inspect state read-only, capture screenshots, record video, and clean up. If the project has no such skill, offer once to generate one with `/skill:create-verification-skill`.

Copy and fill [`../reproduce-and-fix-issues/references/feature-map.example.md`](../reproduce-and-fix-issues/references/feature-map.example.md) to `verification.feature_map_path`. Pack refreshes must not overwrite it.

## 9. Prepare the routing map

1. Copy [`../triage-issue-reports/references/routing.example.md`](../triage-issue-reports/references/routing.example.md) to `routing.map_path`.
2. Fill in the destinations and the owner ping policy.
3. Delete the example file from the pack copy. Keep only the filled map.

## 10. Wire the runs

pi has no automation editor. Benny runs as headless jobs. Pick the template pair that matches `intake.source`:

1. Copy the pair that matches `intake.source` to `.github/workflows/`:
   - Slack: [`../../templates/benny-triage.yml`](../../templates/benny-triage.yml), [`../../templates/benny-reproduce.yml`](../../templates/benny-reproduce.yml)
   - GitHub: [`../../templates/benny-github-triage.yml`](../../templates/benny-github-triage.yml), [`../../templates/benny-github-reproduce.yml`](../../templates/benny-github-reproduce.yml)
   - GitLab: [`../../templates/benny-gitlab-triage.yml`](../../templates/benny-gitlab-triage.yml), [`../../templates/benny-gitlab-reproduce.yml`](../../templates/benny-gitlab-reproduce.yml). The GitLab pair expects a relay that forwards GitLab issue webhooks as a `benny-gitlab-report` repository_dispatch; the template header documents the normalized payload.
   - Webhook: [`../../templates/benny-webhook-triage.yml`](../../templates/benny-webhook-triage.yml), [`../../templates/benny-webhook-reproduce.yml`](../../templates/benny-webhook-reproduce.yml)
2. Add the repository secrets each workflow names (`PI_PROVIDER_KEY` or the provider keys pi needs, plus `BENNY_SLACK_BOT_TOKEN` only for the Slack intake when the CLI uses it). For the GitLab intake, add the token named by `gitlab.token_env` (the templates use `GITLAB_TOKEN`) to the repository secrets; the workflow passes it to the tracker adapter. The webhook adapter owns its own credentials; add them to the workflow step when the adapter commands need them.
3. Confirm the workflow checks out the repository at `repository.default_branch` and that the operational files are committed there.
4. For a local run, use [`../../runner/benny-run.ts`](../../runner/benny-run.ts):

```bash
# Slack intake
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"channel":"C0123","ts":"1700000000.000100"}'

# GitHub intake
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"issue":123,"url":"https://github.com/owner/repo/issues/123"}'

# GitLab intake
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"iid":42,"url":"https://gitlab.com/group/project/-/issues/42"}'

# Webhook/CLI intake
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"read":"support-cli thread SUP-1234","post":"support-cli reply SUP-1234"}}'
```

Each run's prompt must read and follow its exact committed operational file:

- Triage: `.pi/automations/benny/skills/triage-issue-reports/SKILL.md`
- Reproduce and fix: `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`

The runner builds the intake binding and passes it in the prompt. The operational files read the binding and the contract in `.pi/automations/benny/references/intake-binding.md`; do not edit them per intake.

## 11. Verify before enabling

Confirm that `.pi/settings.json`, `.pi/automations/benny/`, and every referenced secret-free configuration file are committed on the branch the workflow checks out.

Then verify from a fresh session rooted in the target repository:

1. `pi list -l` shows `pi-pstack`.
2. The shared skills resolve in project scope. Do not count skills loaded from the current session or a user-scoped install.
3. The tracker adapter can read one known issue.
4. The verification skill brings the app up and takes one screenshot.

Slack intake only, in addition:

5. `<cli> thread <source channel> <a known ts>` returns the root and its replies.

For the GitHub, GitLab, and webhook intakes, also run the runner with `--dry-run` against a real event and confirm it prints the `pi -p` command:

```bash
# GitHub intake
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"issue":123,"url":"https://github.com/owner/repo/issues/123"}' \
  --dry-run

# GitLab intake
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"iid":42,"url":"https://gitlab.com/group/project/-/issues/42"}' \
  --dry-run

# Webhook/CLI intake
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"read":"support-cli thread SUP-1234","post":"support-cli reply SUP-1234"}}' \
  --dry-run
```

Confirm the printed binding names the source item, the source thread, the verdict location, and the adapter.

If any check fails, stop. Tell the user Benny cannot be enabled yet and name the failing check.

## 12. Send a harmless test report

Slack intake: send a test report in the source channel and confirm:

- Exactly one verdict reply lands under the original thread.
- The verdict carries exactly one marker.
- No root message is posted in the source channel.
- The reproduce workflow either waits for the marker or stops cleanly on `[benny:other]`.

GitHub intake: open a test issue and confirm:

- Exactly one verdict comment lands on the issue.
- The verdict carries exactly one marker.
- No new issue is opened for the verdict.
- The reproduce workflow either waits for the marker or stops cleanly on `[benny:other]`.

GitLab intake: open a test issue and confirm:

- Exactly one verdict comment lands on the issue.
- The verdict carries exactly one marker.
- No new issue is opened for the verdict.
- A missing `iid`, an `iid` and URL that disagree, or a URL from another project stops the runner before `pi` starts.
- The reproduce workflow either waits for the marker or stops cleanly on `[benny:other]`.

Webhook intake: send one harmless binding through the source and confirm:

- Exactly one verdict lands at the binding's verdict location.
- The verdict carries exactly one marker.
- No new top-level item is created for the verdict.
- A malformed payload, a missing field, or a verdict location that disagrees with the source item stops the runner before `pi` starts.
- The reproduce workflow either waits for the marker or stops cleanly on `[benny:other]`.

Do not enable either run before the test passes.
