# benny intent

## what i want to run

i want two headless pi jobs that work together in one slack issue channel.

### run 1: triage issue reports

- trigger: when someone posts a new top-level report in my configured source slack channel, i want this run to start on that report and keep its original thread coordinates.
- behavior: i want it to read the thread and attachments, classify the report as a bug or performance issue, feature request, question or feedback, or reroute, and trace the likely owning layer before routing.
- tracker: i want it to search my configured tracker for duplicates, update a confident duplicate, and create a ticket only for a clear net-new bug.
- tools: slack thread read and reply access through the configured slack cli, my configured tracker adapter, and my optional routing map.
- outcome: i want exactly one reply in the source thread with a short verdict and `[benny:bug]`, `[benny:performance]`, or `[benny:other]`. a bug or performance marker may include the tracker url.
- boundary: i never want this run to post a root message in the source channel.

### run 2: reproduce and fix confirmed bugs

- trigger: i want this run to start from the same new top-level report, a scheduled sweep for a report whose trusted triage marker has no repro reply yet, or a manual dispatch.
- gates: i want it to stop when someone clearly owns the fix. if an existing pull request or merged commit may fix the report, i want verification instead of a competing change.
- behavior: i want it to use my configured verification skill and feature map, reproduce the exact symptom twice through the real ui, and capture screenshots, video, and a read-only state cross-check.
- fix: i want it to verify existing pull requests without authoring over them. after a confirmed repro, it may attempt one bounded root-cause fix, use tdd when the test is cheap, smoke the blast radius, and open a draft pull request only when before-and-after proof passes.
- tools: slack thread read and reply access through the configured slack cli, repository and history access, draft pull request creation, my configured tracker adapter, and my verification skill.
- outcome: i want evidence and a verified result in the source or optional operations threads, plus an optional draft pull request. updates should be concise.
- boundary: i never want this run to post a root message in the source channel.

### shared rules

- i want the source channel and root thread coordinates to stay immutable for the whole run.
- i treat utility and debug bots as evidence, not delegation or fix ownership.
- i allow subagents to help, but they run read-only and cannot post to slack or receive slack credentials.
- i want this entire pack committed at `.pi/automations/benny/` in the target repository. its `SKILL.md` files are direct run instructions, not registered package skills.
- i want pi-pstack installed through the target repository's committed `.pi/settings.json` only for shared dependencies such as `how`, `why`, `tdd`, `unslop`, and the required principle skills.
- i want each run prompt to read its committed operational file directly. i do not want package cache paths, copied excerpts, or slash-skill discovery.
- i keep user-owned configuration, feature maps, routing maps, and secrets outside `.pi/automations/benny/` so pack refreshes cannot overwrite them.
- i want both runs to fail closed when channel coordinates, the slack cli, the tracker adapter, the verification skill, or the feature map are missing or uncertain.
- i want draft pull requests only. do not merge or deploy.

### my configuration

- source slack channel: `<channel>`
- optional operations channel: `<channel or none>`
- repository and default branch: `<repo>`, `<branch>`
- tracker: `<type, adapter command, team, project, labels, intake status>`
- routing map: `<path or none>`
- triage identity: `<slack user id>`
- slack cli: `<command>`
- verification skill: `<configured skill>`
- feature map: `<committed same-repo path outside the copied pack, or behavior to paraphrase>`
- models: `<triage, reproduce, code, media review>` as pi model ids from `pi --list-models`
- status emoji strings: `<seen, reproducing, reproduced, blocked, fixing, failed, pull request opened>`
- budgets: `<polling, verdict wait, follow-up, repro, rejection, fix>`
- optional bot token capability: `<none, file download, or editable operations status>`

start from [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md). copy and fill them outside this pack, for example under `.pi/benny/`. keep secret values in a secret manager or environment.

## for the agent

the human enters setup by pointing pi at this file. do not look for or invoke a discovered benny skill.

1. ask which repository will run the runs.
2. treat the directory containing this `FOR_AGENTS.md` as the source pack.
3. merge the entire source pack into `<target-repository>/.pi/automations/benny/`.
4. preserve every destination-only file. never delete unrelated files or overwrite user-owned configuration, feature maps, or routing maps.
5. when an existing destination file at a source-managed path differs, review the diff and merge without discarding local edits. if ownership is ambiguous, stop and ask before replacing it.
6. verify that the copied `FOR_AGENTS.md` and `skills/setup-benny/SKILL.md` exist in the target repository.
7. read and follow `.pi/automations/benny/skills/setup-benny/SKILL.md` directly from the target repository.

i want pi-pstack added to the target repository's project settings:

```bash
pi install -l git:github.com/gh0stwin/pi-pstack
```

preserve every unrelated setting and package. do not hand-edit json when a `pi install` call can make the addition.

pi has no automation editor and no hosted automation product. i want the two runs wired as headless jobs:

- copy `templates/benny-triage.yml` and `templates/benny-reproduce.yml` to `.github/workflows/`, or run `runner/benny-run.ts` directly.
- keep the provider key and the slack token in repository secrets.

i want verification from a fresh session rooted in the target repository. confirm that pi-pstack's `how`, `why`, `tdd`, `unslop`, and the principle skills used by benny resolve in project scope. do not count skills loaded from the current session or a user-scoped install.

if project-scoped packages are unavailable or any shared dependency does not resolve, stop and explain what failed. do not add `.pi/automations/benny/skills/` to the package manifest or expect its files to appear in the slash-skill list.

tell me that `.pi/settings.json`, `.pi/automations/benny/`, and any referenced secret-free configuration must be committed before either run is enabled. do not enable a run until i explicitly ask.

paraphrase this intent and the finished configuration into each run prompt. the triage prompt must read and follow `.pi/automations/benny/skills/triage-issue-reports/SKILL.md`. the reproduce prompt must read and follow `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`. use these repo-relative paths only after setup confirms they are committed in the repository where the run will execute.

for an existing run, validate the configuration, then use the field checklist in the copied setup file so i can edit the workflow directly. do not create duplicates.
