# pi-pstack

Rigorous agent workflows for pi: poteto-mode, 23 principles, 23 playbooks, role-routed subagents, and two specialist agents.

This is a **port of the Cursor plugin [`pstack`](https://github.com/cursor/plugins/tree/main/pstack) v0.15.2** by Lauren Tan, adapted to run on pi. It is not the upstream project, and it is not affiliated with Cursor. Every change made during the port, every upstream file's disposition, and every capability that could not be carried over is recorded in [PORTING.md](./PORTING.md). Read that before trusting a workflow to behave exactly as the upstream documentation describes.

> **Port status.** The port is landing in reviewable batches. Batch 1 landed the package skeleton and documentation; a later batch landed `poteto-mode` and the writing skills (`deslop`, `no-comments`, `technical-writing`, `unslop`); the next landed the investigation cluster (`how`, `why`, `reflect`, `automate-me`, `recall`, `show-me-your-work`, `teach`); the next landed the verification and review cluster (`setup-pstack`, `create-verification-skill`, `maintain-verification-skill`, `architect`, `arena`, `interrogate`); the next landed the `subagent` extension, the three agent definitions, and the Benny automations; the next landed the remaining workflow skills (`tdd`, `bro`, `blast-radius`, `figure-it-out`, `make-bot-ui`, `typescript-best-practices`, `swarm`, `create-skill`). The next landed the first six principle skills: `boundary-discipline`, `type-system-discipline`, `laziness-protocol`, `minimize-reader-load`, `encode-lessons-in-structure`, and `guard-the-context-window`, of the 23; the next landed five more (`build-the-lever`, `make-operations-idempotent`, `migrate-callers-then-delete-legacy-apis`, `never-block-on-the-human`, and `separate-before-serializing-shared-state`); the next landed six more (`attack-the-premise`, `exhaust-the-design-space`, `experience-first`, `foundational-thinking`, `model-the-domain`, and `redesign-from-first-principles`), bringing the landed principle skills to 17 of the 23; this batch lands the final six principle skills: `outcome-oriented-execution`, `sequence-verifiable-units`, `prove-it-works`, `test-behavior-not-implementation`, `fix-root-causes`, and `subtract-before-you-add`, completing the full set of 23. The sections below describe the completed package.

## Requirements

- pi with at least one configured provider (`/login`), so `/skill:setup-pstack` has models to offer.

## Install

```bash
pi install git:github.com/gh0stwin/pi-pstack
```

To try it without installing:

```bash
pi -e git:github.com/gh0stwin/pi-pstack
```

To install it for one project instead of globally, run this from the project folder that should own the installation:

```bash
pi install -l git:github.com/gh0stwin/pi-pstack
```

`-l` writes `.pi/settings.json` in the current folder instead of the global `~/.pi/agent/settings.json`, so nothing is installed globally. That file is meant to be committed, so a team shares one pinned install.

pi loads project resources only after the project is trusted: the first interactive start asks, `/trust` saves the decision, and non-interactive runs need `--approve`/`-a` or a saved decision. Project scope is the exact folder holding `.pi/`, not its parent, its siblings, or a subdirectory of it, so pi must be started from that folder or nothing loads.

For a pinned or offline setup, install from a local clone:

```bash
pi install -l /absolute/path/to/your/pi-pstack-clone
```

A local-path install stores a reference, not a copy: pi records a path (normalized to relative) in `.pi/settings.json`, so the clone must stay in place with its dependencies installed (`npm install`). Moving either the project or the clone means re-running the install.

The package contributes:

| Resource | Path | What it gives you |
| --- | --- | --- |
| Skills | `skills/` (49) | `poteto-mode`, 23 `principle-*`, 23 playbooks, `how`, `why`, `tdd`, `arena`, `swarm`, `architect`, `interrogate`, `reflect`, `unslop`, `deslop`, `create-skill`, and more |
| Extension | `extensions/subagent/` | The `subagent` tool, the `pstack_roles` tool, and the `/pstack-models` command |
| Agents | `agents/` | `worker`, `poteto-agent`, `comment-sicko` |
| Docs | `docs/guide/` | The upstream user guide, rewritten for pi |

## Set it up

Run:

```text
/skill:setup-pstack
```

It detects the models you have with `pi --list-models`, asks which one each pstack role should use, and writes `~/.pi/agent/pstack-models.json`. The `subagent` tool reads that file at every spawn, so a new choice applies to the next subagent without a restart.

- Roles: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `judgment and prose`, `hardest tasks`, `how explorer`, `how explainer`, `why investigators`, `why synthesizer`, `reflect tooling`, `reflect judgment, reflect divergent, reflect synthesizer`, `swarm workers`, plus the panel roles `arena runners`, `arena cross-judge pool`, `architect runners`, and `interrogate reviewers`.
- Built-in defaults: every role runs on the parent session model (`inherit-parent`), so pstack assumes no provider and works before you configure anything.
- Panels need distinct models: `arena runners`, `arena cross-judge pool`, `architect runners`, and `interrogate reviewers` each default to a single inherited runner, and only give independent perspectives when their entries are distinct models.
- `inherit-parent` and `auto` mean "omit `--model` and use the parent session model".
- A project can add `.pi/pstack-models.json`; project keys override user keys for subagents spawned in that project.
- Run `/pstack-models` or call the `pstack_roles` tool to see the effective map and which files supplied it.

At the end, setup offers once to generate a project-local verification skill with `/skill:create-verification-skill`. That skill is how pstack proves UI, CLI, or service behavior against the real app instead of a proxy.

## Use poteto-mode

`poteto-mode` is the front door. You give it a goal; it matches one of 23 playbooks, follows that playbook's steps, and calls the other skills as the steps need them.

```text
/skill:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

`/skill:poteto-mode` is sticky for the conversation. Its instructions stay in context and keep guiding the work, but a long conversation's automatic compaction can summarize them away. Re-invoke `/skill:poteto-mode` after a big compaction to restore the full rigor. Say "opt out" to leave it. To start a fresh match mid-conversation, say "new task". Other skills are available directly:

```text
/skill:how do we dedupe notifications? is there an n+1 when we look up subscribers?
/skill:why was the retry limit set to five? does the reason still hold?
/skill:arena this, 5 candidates. the cache key format is expensive to change later.
/skill:tdd implement
/skill:unslop the readme changes
```

The full walkthrough is in [docs/guide/](./docs/guide/README.md).

### Script requirements

- Node 24 or newer for the ported `watch-pr` and `orch` scripts. They run on `node --test` and `node:child_process`; Bun is no longer required.
- `npm install` at the package root before using `watch-pr` or `orch` from a clone. pi runs it for npm and git installs.
- `gh` and `jq` for `skills/poteto-mode/scripts/watch-pr/watch-pr` and `worktree-audit.sh`.

## Subagents

pi has no built-in subagent primitive, so this package supplies one. The `subagent` tool runs a real `pi` process per task with its own context window:

```text
subagent { agent: "poteto-agent", role: "feature, refactoring", task: "..." }          # single
subagent { tasks: [{ agent: "worker", task: "..." }, { agent: "worker", task: "..." }] } # parallel, max 8, 4 at a time
subagent { chain: [{ agent: "how", task: "..." }, { agent: "worker", task: "... {previous}" }] } # chained
```

- `readonly: true` pins the child to `read`, `grep`, `find`, and `ls`.
- `role` resolves the model through `pstack-models.json`; `model` overrides it.
- Agents resolve from the package's `agents/`, then `~/.pi/agent/agents/`, then `.pi/agents/` in a trusted project.
- There is no background flag in pi. Issue parallel `subagent` calls in one message; each returns when its child exits.

## Benny (optional)

`automations/benny/` is a port of the upstream Benny pack: two headless runs that triage issue reports and reproduce confirmed bugs. It is dormant unless you set it up. The intake is opt-in: the Slack path needs a Slack CLI you provide, because pi ships no Slack integration, while a no-Slack install uses GitHub or GitLab issues, or any source that can build an intake binding (the generic webhook/CLI intake), and needs no Slack CLI or token. Every run receives one intake binding (source item, source thread, verdict location, adapter), and the operational files are intake-neutral. See [automations/benny/README.md](./automations/benny/README.md) and [PORTING.md section 3](./PORTING.md#3-deliberate-capability-losses) for what changed.

## Development

```bash
npm install
npm run check     # typechecks `extensions/`, `automations/`, and the poteto-mode scripts tree, then runs the tests
```

`npm run typecheck` covers both tsconfigs, and `npm test` runs the extension tests (`extensions/`), the `skills/poteto-mode/scripts/` tests, and the Benny tests (`automations/benny/`) through `node --test`.

## License

MIT. The upstream pstack plugin is MIT-licensed, Copyright (c) 2026 Lauren Tan. The upstream license text is kept in [LICENSE](./LICENSE). See [PORTING.md](./PORTING.md) for provenance.
