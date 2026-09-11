# pi-pstack

Rigorous agent workflows for pi: poteto-mode, 23 principles, 23 playbooks, role-routed subagents, and two specialist agents.

This is a **port of the Cursor plugin [`pstack`](https://github.com/cursor/plugins/tree/main/pstack) v0.15.2** by Lauren Tan, adapted to run on pi. It is not the upstream project, and it is not affiliated with Cursor. Every change made during the port, every upstream file's disposition, and every capability that could not be carried over is recorded in [PORTING.md](./PORTING.md). Read that before trusting a workflow to behave exactly as the upstream documentation describes.

> **Port status.** The port is landing in reviewable batches. Batch 1 landed the package skeleton and documentation; a later batch landed `poteto-mode` and the writing skills (`deslop`, `no-comments`, `technical-writing`, `unslop`); the next landed the investigation cluster (`how`, `why`, `reflect`, `automate-me`, `recall`, `show-me-your-work`, `teach`). This batch lands the verification and review cluster: `setup-pstack`, `create-verification-skill`, `maintain-verification-skill`, `architect`, `arena`, and `interrogate`. `extensions/`, `agents/`, and `automations/` are not in the tree yet, so an install at this revision contributes those skills but no extension or agents, and links from this README and `docs/guide/` into the not-yet-landed directories still do not resolve. The sections below describe the completed package; the remaining content batches follow.

## Install

```bash
pi install git:github.com/gh0stwin/pi-pstack
```

To try it without installing:

```bash
pi -e git:github.com/gh0stwin/pi-pstack
```

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

- Roles: `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb`, `judgment and prose`, `hardest tasks`, `how explorer`, `how explainer`, `why investigators`, `why synthesizer`, `reflect tooling`, `reflect judgment, divergent, synthesizer`, `swarm workers`, plus the panel roles `arena runners`, `arena cross-judge pool`, `architect runners`, and `interrogate reviewers`.
- `inherit-parent` and `auto` mean "omit `--model` and use the parent session model".
- A project can add `.pi/pstack-models.json`; project keys override user keys for subagents spawned in that project.
- Run `/pstack-models` or call the `pstack_roles` tool to see the effective map and which files supplied it.

At the end, setup offers once to generate a project-local verification skill with `/skill:create-verification-skill`. That skill is how pstack proves UI, CLI, or service behavior against the real app instead of a proxy.

## Use poteto-mode

`poteto-mode` is the front door. You give it a goal; it matches one of 23 playbooks, follows that playbook's steps, and calls the other skills as the steps need them.

```text
/skill:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

`/skill:poteto-mode` is sticky for the conversation. Say "opt out" to leave it. To start a fresh match mid-conversation, say "new task". Other skills are available directly:

```text
/skill:how do we dedupe notifications? is there an n+1 when we look up subscribers?
/skill:why was the retry limit set to five? does the reason still hold?
/skill:arena this, 5 candidates. the cache key format is expensive to change later.
/skill:tdd implement
/skill:unslop the readme changes
```

The full walkthrough is in [docs/guide/](./docs/guide/README.md).

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

`automations/benny/` is a port of the upstream Benny pack: two headless runs that triage Slack issue reports and reproduce confirmed bugs. It is dormant unless you set it up, and it needs a Slack CLI you provide, because pi ships no Slack integration. See [automations/benny/README.md](./automations/benny/README.md) and [PORTING.md section 3](./PORTING.md#3-deliberate-capability-losses) for what changed.

## Requirements

- pi with at least one configured provider (`/login`), so `/skill:setup-pstack` has models to offer.
- Node 24 or newer for the ported `watch-pr` and `orch` scripts. They run on `node --test` and `node:child_process`; Bun is no longer required.
- `gh` and `jq` for `skills/poteto-mode/scripts/watch-pr/watch-pr` and `worktree-audit.sh`.

## Development

```bash
npm install
npm run check     # runs the ported skills' tests; root typecheck is a placeholder until extensions/ land
```

The ported `poteto-mode` scripts under `skills/poteto-mode/scripts/` are typechecked (`npm run typecheck`) and tested (`npm test`) from that directory, and `npm run check` runs those tests through `node --test`. The root `typecheck` script is still a placeholder until `extensions/` lands; it becomes the full check again — `extensions/` and all skills scripts typechecked — once that directory exists.

## License

MIT. The upstream pstack plugin is MIT-licensed, Copyright (c) 2026 Lauren Tan. The upstream license text is kept in [LICENSE](./LICENSE). See [PORTING.md](./PORTING.md) for provenance.
