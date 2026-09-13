# benny intent

## what i want to run

i want two headless pi jobs that work together on one report source. i choose the source once: a slack channel, github or gitlab issues / the cli, or any source that can hand the runner an intake binding (the generic webhook/cli intake). slack is optional; if i do not use slack i do not want to install or configure it.

every run receives one intake binding: the source item, the source thread, the single verdict location, and the adapter that reads and posts. i want the operational files written in those terms, so a new source is configuration rather than a rewrite.

### run 1: triage issue reports

- trigger: when a new top-level report arrives in my configured source (a new message in the slack channel, a new github or gitlab issue / a `benny-run.ts --event` invocation, or a webhook/cli binding), i want this run to start on that report and keep its original coordinates.
- behavior: i want it to read the report and attachments, classify it as a bug or performance issue, feature request, question or feedback, or reroute, and trace the likely owning layer before routing.
- tracker: i want it to search my configured tracker for duplicates, update a confident duplicate, and create a ticket only for a clear net-new bug.
- tools: for the slack intake, slack thread read and reply access through the configured slack cli; for the github and gitlab intakes, the issue named by the event and the tracker adapter; for the webhook intake, the adapter commands in the binding. my configured tracker adapter and my optional routing map in every case.
- outcome: i want exactly one verdict where the report lives: the binding's verdict location. a reply in the source thread for slack, one comment on the source issue for github and gitlab, and a reply or comment through the adapter the webhook binding names. the verdict carries `[benny:bug]`, `[benny:performance]`, or `[benny:other]`. a bug or performance marker may include the tracker url.
- boundary: i never want this run to open a new top-level post for the report: no slack source-channel root message, no new issue, no new email thread.

### run 2: reproduce and fix confirmed bugs

- trigger: i want this run to start from the same new report, a scheduled sweep for a report whose trusted triage marker has no repro reply yet, or a manual dispatch.
- gates: i want it to stop when someone clearly owns the fix. if an existing pull request or merged commit may fix the report, i want verification instead of a competing change.
- behavior: i want it to use my configured verification skill and feature map, reproduce the exact symptom twice through the real ui, and capture screenshots, video, and a read-only state cross-check.
- fix: i want it to verify existing pull requests without authoring over them. after a confirmed repro, it may attempt one bounded root-cause fix, use tdd when the test is cheap, smoke the blast radius, and open a draft pull request only when before-and-after proof passes.
- tools: the source read and reply access of the chosen intake, repository and history access, draft pull request creation, my configured tracker adapter, and my verification skill.
- outcome: i want evidence and a verified result in the source or optional operations threads, plus an optional draft pull request. updates should be concise.
- boundary: the same as run 1: never a new top-level post for the report.

### shared rules

- i want the source coordinates to stay immutable for the whole run.
- i want the safety rules stated once, generically, in the operational files: exactly one verdict, never a new top-level post, immutable source coordinates, fail closed when the binding, the adapter, the verification skill, or the feature map is missing.
- i treat utility and debug bots as evidence, not delegation or fix ownership.
- i allow subagents to help, but they run read-only and cannot post through the adapter or receive adapter credentials.
- i want this entire pack committed at `.pi/automations/benny/` in the target repository. its `SKILL.md` files are direct run instructions, not registered package skills.
- i want pi-pstack installed through the target repository's committed `.pi/settings.json` only for shared dependencies such as `how`, `why`, `tdd`, `unslop`, and the required principle skills.
- i want each run prompt to read its committed operational file directly. i do not want package cache paths, copied excerpts, or slash-skill discovery.
- i keep user-owned configuration, feature maps, routing maps, and secrets outside `.pi/automations/benny/` so pack refreshes cannot overwrite them.
- i want both runs to fail closed when the configured intake's source coordinates, the binding, the tracker adapter, the verification skill, or the feature map are missing or uncertain. for the slack intake that list includes the slack cli.
- i want draft pull requests only. do not merge or deploy.

### my configuration

- intake source: `slack`, `github`, `gitlab`, or `webhook`
- source slack channel: `<channel>` (slack intake only)
- optional operations channel: `<channel or none>` (slack intake only)
- slack cli: `<command>` (slack intake only)
- gitlab project and token environment: `<project path>`, `<token env var>` (gitlab intake only)
- webhook binding: `<source item, source thread, verdict location, adapter read and post commands>` (webhook intake only)
- triage identity: `<slack user id for slack; tracker identity for github and gitlab; adapter identity for webhook>`
- repository and default branch: `<repo>`, `<branch>`
- tracker: `<type, adapter command, team, project, labels, intake status>`
- routing map: `<path or none>`
- verification skill: `<configured skill>`
- feature map: `<committed same-repo path outside the copied pack, or behavior to paraphrase>`
- models: `<triage, reproduce, code, media review>` as pi model ids from `pi --list-models`
- status emoji strings: `<seen, reproducing, reproduced, blocked, fixing, failed, pull request opened>`
- budgets: `<polling, verdict wait, follow-up, repro, rejection, fix>`
- optional bot token capability: `<none, file download, or editable operations status>` (slack intake only)

start from [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md). copy and fill them outside this pack, for example under `.pi/benny/`. keep secret values in a secret manager or environment.

## for the agent

the human enters setup by pointing pi at this file. do not look for or invoke a discovered benny skill.

1. ask which repository will run the runs.
2. ask which intake the human wants: `slack`, `github`, `gitlab`, or `webhook`. a human who does not use slack chooses `github`, `gitlab`, or `webhook` and is never asked for a slack cli or token. a human with a source that can build the binding chooses `webhook` and provides the adapter commands with each event. a human whose reports live in gitlab issues chooses `gitlab` and provides the project path and the token environment variable name.
3. treat the directory containing this `FOR_AGENTS.md` as the source pack.
4. merge the entire source pack into `<target-repository>/.pi/automations/benny/`.
5. preserve every destination-only file. never delete unrelated files or overwrite user-owned configuration, feature maps, or routing maps.
6. when an existing destination file at a source-managed path differs, review the diff and merge without discarding local edits. if ownership is ambiguous, stop and ask before replacing it.
7. verify that the copied `FOR_AGENTS.md` and `skills/setup-benny/SKILL.md` exist in the target repository.
8. read and follow `.pi/automations/benny/skills/setup-benny/SKILL.md` directly from the target repository.

i want pi-pstack added to the target repository's project settings:

```bash
pi install -l git:github.com/gh0stwin/pi-pstack
```

preserve every unrelated setting and package. do not hand-edit json when a `pi install` call can make the addition.

pi has no automation editor and no hosted automation product. i want the two runs wired as headless jobs:

- slack intake: copy `templates/benny-triage.yml` and `templates/benny-reproduce.yml` to `.github/workflows/`.
- github intake: copy `templates/benny-github-triage.yml` and `templates/benny-github-reproduce.yml` to `.github/workflows/`.
- gitlab intake: copy `templates/benny-gitlab-triage.yml` and `templates/benny-gitlab-reproduce.yml` to `.github/workflows/`.
- webhook intake: copy `templates/benny-webhook-triage.yml` and `templates/benny-webhook-reproduce.yml` to `.github/workflows/`.
- or run `runner/benny-run.ts` directly from any trigger.
- keep the provider key in repository secrets, and the slack token there too only when the slack intake uses one.

i want verification from a fresh session rooted in the target repository. confirm that pi-pstack's `how`, `why`, `tdd`, `unslop`, and the principle skills used by benny resolve in project scope. do not count skills loaded from the current session or a user-scoped install.

if project-scoped packages are unavailable or any shared dependency does not resolve, stop and explain what failed. do not add `.pi/automations/benny/skills/` to the package manifest or expect its files to appear in the slash-skill list.

tell me that `.pi/settings.json`, `.pi/automations/benny/`, and any referenced secret-free configuration must be committed before either run is enabled. do not enable a run until i explicitly ask.

paraphrase this intent and the finished configuration into each run prompt. the triage prompt must read and follow `.pi/automations/benny/skills/triage-issue-reports/SKILL.md`. the reproduce prompt must read and follow `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`. use these repo-relative paths only after setup confirms they are committed in the repository where the run will execute.

for an existing run, validate the configuration, then use the field checklist in the copied setup file so i can edit the workflow directly. do not create duplicates.
