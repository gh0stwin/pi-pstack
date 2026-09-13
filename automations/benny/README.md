# benny

benny gives you two headless pi runs for issue reports. one triages each report. the other reproduces confirmed bugs and may prepare a small draft fix.

the files in this directory are dormant setup and run sources. they do not appear as package skills, and installing pi-pstack does not enable benny. run `skills/setup-benny/SKILL.md` to merge the pack into a target repository, or skip it and benny stays absent.

## intakes

benny takes reports from one of four intakes, chosen in the configuration as `intake.source`:

| intake | report arrives as | verdict lands as | needs slack |
| --- | --- | --- | --- |
| `slack` | a message in the configured source channel | one thread reply through the repository's slack CLI | yes |
| `github` | a github issue, or a `benny-run.ts --event` invocation | one comment on the issue through the tracker adapter | no |
| `gitlab` | a gitlab issue, or a `benny-run.ts --event` invocation | one comment on the issue through the tracker adapter | no |
| `webhook` | any source that runs `benny-run.ts` with a binding payload | one reply or comment through the adapter the payload names | no |

slack is opt-in. a user who does not use slack sets `intake.source: github`, `intake.source: gitlab`, or `intake.source: webhook`, deletes the whole `slack:` section, and installs nothing slack-related. the runner infers the github path from a `repository:` section, the gitlab path from a `gitlab:` section, and fails closed when no intake is configured, when both gitlab and repository sections are configured, or when a slack section is missing its cli or source channel. the webhook intake takes its whole binding from the event and needs no configuration section.

## the intake binding

every run gets one intake binding. it names four things, and the two operational files assume nothing else:

| binding name | what it is |
| --- | --- |
| source item | the report being triaged: one message, issue, email, or webhook item |
| source thread | the conversation around it; every source read happens here |
| verdict location | the single place the run posts its one verdict; always on the source item |
| adapter | the thing that reads the source thread and posts at the verdict location |

the runner also names the trusted verdict identity and the operations location when the intake has them. it builds the binding from the configuration and the event, validates it before it starts `pi`, and passes it in the prompt.

the operational files are intake-neutral. `skills/triage-issue-reports/SKILL.md` and `skills/reproduce-and-fix-issues/SKILL.md` state the safety rules once, generically (exactly one verdict, never a new top-level post, immutable source coordinates, fail closed), and [`references/intake-binding.md`](./references/intake-binding.md) holds the contract and the per-intake adapter notes. adding an intake is a runner and documentation change, not a rewrite of the workflow.

the webhook intake is the generic one: any source that can hand the runner a source item, a verdict location, and an adapter uses it. post the binding as a `repository_dispatch` payload, or pass it to the runner directly:

```bash
node .pi/automations/benny/runner/benny-run.ts \
  --mode triage \
  --config .pi/benny/configuration.yaml \
  --event '{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"read":"support-cli thread SUP-1234","post":"support-cli reply SUP-1234"}}'
```

the runner fails closed on a malformed payload, a missing field, or a verdict location that names a different item than the source item.

### future intakes

recorded here so adding one needs no archaeology. trackers: github issues (done), gitlab issues (done), linear, jira. chat: discord, microsoft teams, self-hosted mattermost / zulip / rocket.chat. support channels: a plain email inbox, zendesk / intercom / freshdesk, sentry-style error trackers where the bug is already structured. the generic webhook/cli intake covers any later integration as configuration rather than code. `PORTING.md` records the port history and the substitute survey behind this choice.

## how it runs on pi

benny needs a trigger, a report source, a tracker client, and a way to drive the app. pi ships none of those as built-ins, so this pack wires them explicitly:

| capability | here |
| --- | --- |
| trigger | github actions workflows that run `pi -p`, or `runner/benny-run.ts` locally |
| slack intake | a slack cli the repository provides, named in `slack.cli` |
| github intake | the issue named in the run event, plus the tracker adapter for the verdict comment |
| gitlab intake | the issue named in the run event, plus the GitLab tracker adapter for the verdict comment |
| webhook intake | the binding in the run event, plus the adapter commands it names |
| models | pi model ids from `pi --list-models`, or `inherit-parent` |
| app driving | a verification skill from `/skill:create-verification-skill` |
| shared skills | `.pi/settings.json` via `pi install -l git:github.com/gh0stwin/pi-pstack` |

slack access is the one capability with no pi equivalent. pi ships no MCP client and no slack integration, so the slack intake calls a cli instead. see `skills/setup-benny/SKILL.md` for the contract that cli must satisfy. the github, gitlab, and webhook intakes need no such cli.

the full upstream-to-here mapping and the capability losses are in the repository's `PORTING.md`.

## why the runner stays in-repo

the package-substitute survey suggested `pi-reactor` for triggers, queue, and sink, `@estebanforge/pi-slack-me` for slack read and reply, and `pi-background-tasks` for attested headless runs. the port keeps `runner/benny-run.ts` and the slack cli contract instead: each suggested package adds a daemon or a runtime dependency, and putting one on the no-slack path would make the optional install heavier than the slack one. the runner is dependency-free, the cli contract is one command the user already owns, and the survey itself rated the substitutes a partial fit. revisit the choice if a durable queue or a hosted daemon becomes a requirement.

## set it up

1. point pi at [`FOR_AGENTS.md`](./FOR_AGENTS.md) and name the target repository.
2. let setup merge this whole directory into the target at `.pi/automations/benny/`. it must preserve destination-only files and review conflicts instead of overwriting local edits.
3. let setup add pi-pstack to the target repository's project settings for shared dependencies:

```bash
pi install -l git:github.com/gh0stwin/pi-pstack
```

4. choose the intake. for slack, provide a cli that implements the contract in `skills/setup-benny/SKILL.md` and set its name in `slack.cli`. for github, set `intake.source: github` and provide no slack values. for gitlab, set `intake.source: gitlab` and provide the project path and the token environment variable name. for a source that can build the binding itself, set `intake.source: webhook` and provide no slack values.
5. keep user-owned configuration outside the copied pack, for example in `.pi/benny/`. adapt [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md).
6. copy the matching workflow pair to `.github/workflows/` (`benny-triage.yml`/`benny-reproduce.yml` for slack, `benny-github-triage.yml`/`benny-github-reproduce.yml` for github, `benny-gitlab-triage.yml`/`benny-gitlab-reproduce.yml` for gitlab, `benny-webhook-triage.yml`/`benny-webhook-reproduce.yml` for webhook), or run [`runner/benny-run.ts`](./runner/benny-run.ts) directly.
7. commit `.pi/settings.json`, `.pi/automations/benny/`, and any secret-free configuration before enabling either run.
8. send a harmless test report and verify the verdict lands once, at the binding's verdict location.
