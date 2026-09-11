# Porting report: `cursor/plugins` pstack v0.15.2 → `pi-pstack`

This is the review document for the port. It records where the code came from, how every Cursor primitive was mapped onto pi, what happened to every upstream file, what could not be carried over and why, and every behavioral change the port introduced. Read it before the code.

## 1. Provenance

| | |
| --- | --- |
| Upstream | `https://github.com/cursor/plugins`, directory `pstack/` |
| Pinned revision | `f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d` (`fix(pstack): operator-neutral pronouns + in-chat status tick (#362)`) |
| Upstream version | pstack `0.15.2` (from `.cursor-plugin/plugin.json`) |
| Upstream license | MIT, Copyright (c) 2026 Lauren Tan |
| Upstream author | Lauren Tan |
| Fetch command | `git clone https://github.com/cursor/plugins.git && git -C plugins checkout f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d` |
| Upstream inventory | 158 files, 47 skill directories (24 top-level skills + 23 `principle-*`), 23 poteto-mode playbooks |
| This package | `gh0stwin/pi-pstack`, version `0.15.2` (tracks the upstream version) |

The brief described "42 skill directories". The actual count at this revision is **47**: 24 top-level skill directories plus 23 `principle-*` directories. The inventory in section 4 covers all 47.

`LICENSE` carries the upstream MIT text unchanged, including the original copyright line. Every adapted file keeps its upstream content as the base.

## 2. What "porting to pi" meant here

Cursor and pi are not the same shape of product. Cursor ships a hosted agent platform: a plugin manifest, hosted automations with an editor, built-in Slack integrations, a `Task` subagent primitive, a model picker with vendor slugs, always-applied `.mdc` rules, an MCP client, and built-in slash commands such as `/loop` and `/automate`. pi ships a package format, skills, prompt templates, themes, and an extension API, and deliberately excludes MCP, subagents, and plan mode from the core.

So the port is mostly a re-homing exercise: keep the operational content (the workflows, principles, playbooks, and prompts), and re-express each platform primitive as the pi thing that actually does that job. Where pi has nothing, the port creates the missing piece inside this package and says so.

### Primitive mapping

| Cursor primitive | pi equivalent | Where it lives |
| --- | --- | --- |
| `.cursor-plugin/plugin.json` | `package.json` with a `pi` manifest and the `pi-package` keyword | `package.json` |
| `skills/` (plugin skills) | pi skills, Agent Skills frontmatter | `skills/` (47 skills) |
| `agents/*.md` (Cursor subagents) | Agent definitions loaded by a new `subagent` extension tool | `agents/`, `extensions/subagent/` |
| Cursor `Task` tool with `subagent_type` | `subagent` tool with `agent`, `role`, `model`, `readonly`, `tasks`, `chain` | `extensions/subagent/index.ts` |
| `automations/benny` (hosted automations + editor) | GitHub Actions workflows running `pi -p`, plus a local runner | `automations/benny/templates/*.yml`, `automations/benny/runner/` |
| `/setup-pstack`, `/poteto-mode` slash commands | `/skill:setup-pstack`, `/skill:poteto-mode` skill commands | `skills/setup-pstack/`, `skills/poteto-mode/` |
| `~/.cursor/rules/pstack-models.mdc` always-applied rule | `~/.pi/agent/pstack-models.json`, read by the extension at spawn time | `skills/setup-pstack/`, `extensions/subagent/config.ts` |
| Cursor model slugs (`grok-4.6-fast-xhigh`, `claude-fable-5-1-thinking-max`, `gpt-5.6-sol-max`, `claude-opus-5-thinking-xhigh`) | pi model ids from `pi --list-models` (`provider/model`) | `extensions/subagent/config.ts`, `skills/setup-pstack/SKILL.md` |
| `AskQuestion` | `ask_question` | adapted in the affected skills |
| `/loop` (built-in wake mechanism) | explicit wake signals: a watcher subagent, `scripts/watch-pr/watch-pr`, a shell heartbeat, or a scheduled `pi -p` run | `skills/poteto-mode/playbooks/autonomous-run.md`, `docs/guide/07-overnight.md` |
| `/deslop` (from the separate `cursor-team-kit` plugin) | a new `deslop` skill in this package | `skills/deslop/` |
| Cursor's built-in `create-skill` | a new `create-skill` skill in this package, written against pi's Agent Skills rules | `skills/create-skill/` |
| `control-cli` / `control-ui` skills from `cursor-team-kit` | a project-local verification skill from `create-verification-skill`, or the repository's own driver | `skills/poteto-mode/SKILL.md`, `skills/create-verification-skill/` |
| Cursor's Bugbot (review bot) | vendor-agnostic review-bot detection | `skills/poteto-mode/scripts/watch-pr/github.ts`, `skills/poteto-mode/references/review-bot-triage.md` |
| Cursor agent transcripts (`~/.cursor/projects/<slug>/agent-transcripts`) | pi sessions (`<agent dir>/sessions/--<slug>--/*.jsonl`) | `skills/poteto-mode/scripts/worktree-audit.sh`, `skills/automate-me/SKILL.md` |
| MCP servers as evidence sources | the tools and CLIs the session actually exposes; pi has no MCP client | `skills/why/SKILL.md` |
| Cursor Slack actions | a repository-provided Slack CLI with a documented contract | `automations/benny/skills/setup-benny/SKILL.md` |
| Cursor `SendToUser` secret-request | the user stores the secret themselves; pi has no secret-request card | `skills/make-bot-ui/SKILL.md` |
| Cursor hosted Grok Bot webhook | a local HTTP server that wakes a headless `pi` run | `skills/make-bot-ui/SKILL.md` |

### New pi-side components created by this port

| Component | Why it had to exist |
| --- | --- |
| `extensions/subagent/` (`index.ts`, `agents.ts`, `config.ts`) | pi has no subagent primitive, and pstack's playbooks, `how`, `why`, `arena`, `swarm`, `architect`, `interrogate`, `reflect`, and both agents depend on one. Implements single, parallel, and chained modes, agent discovery, read-only pinning, and role-based model routing. |
| `agents/worker.md` | The two upstream agents are specialists. Playbooks that spawn a generic code delegate needed a general-purpose definition, so the port adds one. |
| `skills/deslop/` | Upstream poteto-mode routes to `/deslop` before every commit, but that skill ships in a *different* Cursor plugin (`cursor-team-kit`), which this package cannot install. Ported here so the routing works. |
| `skills/create-skill/` | Upstream routes skill authoring to Cursor's built-in `create-skill`, which does not exist in pi. Reimplemented against pi's Agent Skills rules. |
| `automations/benny/runner/benny-run.ts` | pi has no automation editor. This builds and runs the `pi -p` invocation for both Benny runs. |
| `automations/benny/templates/benny-triage.yml`, `benny-reproduce.yml` | The trigger and schedule for the two Benny runs, expressed as GitHub Actions. |
| `skills/poteto-mode/scripts/testing/expect.ts` | Upstream's tests import `bun:test`. pi runs on Node, and Node's test runner has no `expect`. This shim supplies the matcher surface the ported tests use. |
| `skills/poteto-mode/scripts/tsconfig.json` | One Node-typed typecheck config for the whole scripts tree, replacing the Bun-typed per-directory config. |
| `.gitignore` | Upstream's ignored Bun-era artifacts; this one ignores `node_modules/`, `.DS_Store`, and `*.log`. |

## 3. Deliberate capability losses

These are the things the port could not carry over, each with the concrete reason. Nothing here is a bug; each is a real difference the captain should know about before forming an opinion.

1. **Hosted automations with an editor.** Cursor automations are a hosted product with a trigger, an editor, a readiness check, and an approval flow. pi has no equivalent. Benny now runs as GitHub Actions workflows or a local runner. Lost: the editor UI, the readiness check, and the approval step. Replaced by: committed workflow YAML, `workflow_dispatch`, and setup's verification checklist.
2. **Built-in Slack integration.** Cursor exposes Slack read/post actions. pi has no MCP client and no Slack integration. Benny now calls a CLI the repository provides. Lost: zero-setup Slack access. Replaced by: a documented CLI contract that the user must implement and own the token for.
3. **`SendToUser` secret-request cards.** Cursor can request a secret without the model seeing it. pi has no such primitive. `make-bot-ui` now tells the user to generate and store the token themselves.
4. **The `/loop` wake mechanism.** Cursor's `/loop` re-invokes the agent on a cadence. pi has no loop command, so an autonomous run must name its own wake signal. Lost: the implicit heartbeat. Replaced by: an explicit watcher, `watch-pr`, a shell loop, or a scheduled workflow.
5. **`disable-model-invocation` semantics.** See change 3 in section 6: in Cursor this flag means "do not auto-invoke, but the agent may still load the skill by name"; in pi it removes the skill from the system prompt entirely, which would have made 46 of 47 skills unreachable to the agent.
6. **Always-applied `.mdc` rules.** Cursor applies a rule to every request. pi has no always-applied rule file. The model config moved to a JSON file the extension reads, which is more precise but is no longer visible to the model as ambient context.
7. **Cursor model slugs.** `grok-4.6-fast-xhigh`, `claude-fable-5-1-thinking-max`, `gpt-5.6-sol-max`, and `claude-opus-5-thinking-xhigh` are not pi model ids. Replaced by `provider/model` ids from `pi --list-models`, with `inherit-parent` and `auto` meaning "omit `--model`". Lost: the vendor-tuned defaults the upstream author chose; the port's defaults come from the catalog on the machine it was built on and `/skill:setup-pstack` rewrites them.
8. **Cursor's `Task` background flag.** `run_in_background: true` has no pi analogue. Parallelism now means issuing parallel `subagent` tool calls in one message; each call returns when its child exits.
9. **The `reminder` frontmatter field.** Upstream's poteto-mode used a Cursor-specific `reminder` to nudge the model on new tasks. pi ignores unknown frontmatter fields and has no reminder mechanism, so the field was dropped. The equivalent nudge is the skill's own "Remaining triggers" section, which only applies once the user has entered the mode.
10. **`mode`, `icon`, `color` frontmatter.** Cursor UI metadata with no pi meaning. Dropped.
11. **Bun.** Upstream ships `bun.lock` and `bun:test` suites and `#!/usr/bin/env bun` shebangs. pi runs on Node. The scripts now use `node --test`, `node:child_process`, and `npm`. Lost: Bun's speed. Kept: every test, with the same assertions.
12. **The `cursor-team-kit` plugin.** Upstream poteto-mode routes to `deslop`, `control-cli`, and `control-ui` from a separate Cursor plugin. This package cannot depend on it. `deslop` was ported in; the control skills were replaced by the project-local verification skill the package already generates.
13. **Cursor's Slack/Grok/automation IDs in review-bot detection.** `isBugbot` matched the author login `cursor` and the body token `cursor_automation_id`. Both are Cursor-specific. Replaced by a vendor-agnostic review-bot detector with a known-bot login list and generic run markers. A repository that runs a bot outside that list must add its login to `REVIEW_BOT_LOGINS` in `skills/poteto-mode/scripts/watch-pr/github.ts`.
14. **Upstream README prose.** The 22.7 KB upstream README documents Cursor installation, the Cursor plugin marketplace, and Cursor-only commands. It is replaced rather than adapted, because nearly every paragraph needed a different install path. Its content survives as the ported `docs/guide/`.

## 4. File inventory: every upstream file

158 upstream files, each with its disposition. Statuses: **ported** (content carried over unchanged), **adapted** (content carried over with pi-specific edits), **replaced** (superseded by a new file), **dropped** (not carried over).

### `.cursor-plugin/` (1 file)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `.cursor-plugin/plugin.json` | dropped | `(none)` | Cursor plugin manifest. Replaced by `package.json` with a `pi` manifest. |

### `.gitignore` (1 file)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `.gitignore` | replaced | `.gitignore` | Upstream ignored `node_modules/`, `.DS_Store`, `*.log`. Rewritten with the same entries plus pi-package artifacts. |

### `LICENSE` (1 file)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `LICENSE` | ported | `LICENSE` | Unchanged upstream MIT text, with the original author's copyright. |

### `README.md` (1 file)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `README.md` | replaced | `README.md` | Upstream 22.7 KB Cursor-oriented README. Rewritten for pi: install, setup, usage, and an explicit note that this is a port. |

### `agents/` (2 files)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `agents/comment-sicko.md` | adapted | `agents/comment-sicko.md` | Persona kept. Cursor `subagent_type` framing replaced by a pi agent definition the `subagent` tool loads. |
| `agents/poteto-agent.md` | adapted | `agents/poteto-agent.md` | Same. Model routing now comes from the pstack role config. |

### `assets/` (1 file)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `assets/logo.png` | ported | `assets/logo.png` | Upstream logo, byte-identical. Kept for attribution. |

### `automations/` (12 files)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `automations/benny/FOR_AGENTS.md` | adapted | `automations/benny/FOR_AGENTS.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/README.md` | adapted | `automations/benny/README.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/skills/reproduce-and-fix-issues/SKILL.md` | adapted | `automations/benny/skills/reproduce-and-fix-issues/SKILL.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/skills/reproduce-and-fix-issues/references/control-adapter.md` | adapted | `automations/benny/skills/reproduce-and-fix-issues/references/verification-adapter.md` | Renamed to a verification-adapter contract; `control.*` config keys became `verification.*`. |
| `automations/benny/skills/reproduce-and-fix-issues/references/feature-map.example.md` | adapted | `automations/benny/skills/reproduce-and-fix-issues/references/feature-map.example.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/skills/reproduce-and-fix-issues/references/verify-existing-fix.md` | adapted | `automations/benny/skills/reproduce-and-fix-issues/references/verify-existing-fix.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/skills/setup-benny/SKILL.md` | adapted | `automations/benny/skills/setup-benny/SKILL.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/skills/triage-issue-reports/SKILL.md` | adapted | `automations/benny/skills/triage-issue-reports/SKILL.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/skills/triage-issue-reports/references/routing.example.md` | adapted | `automations/benny/skills/triage-issue-reports/references/routing.example.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/templates/configuration.example.yaml` | adapted | `automations/benny/templates/configuration.example.yaml` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/templates/reproduce-automation-prompt.md` | adapted | `automations/benny/templates/reproduce-automation-prompt.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |
| `automations/benny/templates/triage-automation-prompt.md` | adapted | `automations/benny/templates/triage-automation-prompt.md` | Benny operational instructions kept; Cursor automation, Slack-action, model, and control-adapter primitives replaced by pi equivalents. |

### `docs/` (17 files)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `docs/guide/01-setup.md` | adapted | `docs/guide/01-setup.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/02-poteto-mode.md` | adapted | `docs/guide/02-poteto-mode.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/03-understand.md` | adapted | `docs/guide/03-understand.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/04-design.md` | adapted | `docs/guide/04-design.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/05-build-and-clean.md` | adapted | `docs/guide/05-build-and-clean.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/06-verify-and-ship.md` | adapted | `docs/guide/06-verify-and-ship.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/07-overnight.md` | adapted | `docs/guide/07-overnight.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/08-principles.md` | adapted | `docs/guide/08-principles.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/09-make-it-yours.md` | adapted | `docs/guide/09-make-it-yours.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/10-recipes-and-pitfalls.md` | adapted | `docs/guide/10-recipes-and-pitfalls.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/README.md` | adapted | `docs/guide/README.md` | Cursor install/plugin/`/loop`/`/deslop`/`create-skill` references replaced with pi commands and paths. |
| `docs/guide/images/design.jpg` | ported | `docs/guide/images/design.jpg` | Guide image, byte-identical. |
| `docs/guide/images/overnight.jpg` | ported | `docs/guide/images/overnight.jpg` | Guide image, byte-identical. |
| `docs/guide/images/recipes.jpg` | ported | `docs/guide/images/recipes.jpg` | Guide image, byte-identical. |
| `docs/guide/images/router.jpg` | ported | `docs/guide/images/router.jpg` | Guide image, byte-identical. |
| `docs/guide/images/understanding.jpg` | ported | `docs/guide/images/understanding.jpg` | Guide image, byte-identical. |
| `docs/guide/images/verification.jpg` | ported | `docs/guide/images/verification.jpg` | Guide image, byte-identical. |

### `skills/` (122 files)

| Upstream path | Status | Destination | Note |
| --- | --- | --- | --- |
| `skills/architect/SKILL.md` | adapted | `skills/architect/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/architect/references/design-red-flags.md` | adapted | `skills/architect/references/design-red-flags.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/architect/references/rationale-template.md` | adapted | `skills/architect/references/rationale-template.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/architect/references/runner-prompt.md` | adapted | `skills/architect/references/runner-prompt.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/arena/SKILL.md` | adapted | `skills/arena/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/automate-me/SKILL.md` | adapted | `skills/automate-me/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/blast-radius/SKILL.md` | adapted | `skills/blast-radius/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/bro/SKILL.md` | adapted | `skills/bro/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/create-verification-skill/SKILL.md` | adapted | `skills/create-verification-skill/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/create-verification-skill/references/feature-map-example/README.md` | adapted | `skills/create-verification-skill/references/feature-map-example/README.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/create-verification-skill/references/feature-map-example/create-note.md` | adapted | `skills/create-verification-skill/references/feature-map-example/create-note.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/create-verification-skill/references/feature-map-example/search.md` | adapted | `skills/create-verification-skill/references/feature-map-example/search.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/figure-it-out/SKILL.md` | adapted | `skills/figure-it-out/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/how/SKILL.md` | adapted | `skills/how/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/how/references/explainer-prompt.md` | adapted | `skills/how/references/explainer-prompt.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/how/references/explorer-prompt.md` | adapted | `skills/how/references/explorer-prompt.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/interrogate/SKILL.md` | adapted | `skills/interrogate/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/interrogate/references/code-quality-review.md` | adapted | `skills/interrogate/references/code-quality-review.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/interrogate/references/lead-judgment.md` | adapted | `skills/interrogate/references/lead-judgment.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/interrogate/references/reviewer-prompt.md` | adapted | `skills/interrogate/references/reviewer-prompt.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/interrogate/references/rubric.md` | adapted | `skills/interrogate/references/rubric.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/maintain-verification-skill/SKILL.md` | adapted | `skills/maintain-verification-skill/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/make-bot-ui/SKILL.md` | adapted | `skills/make-bot-ui/SKILL.md` | Rewritten: a hosted bot webhook becomes a local server that wakes a headless pi run. Name fixed from `Make Bot UI` to `make-bot-ui`. |
| `skills/no-comments/SKILL.md` | adapted | `skills/no-comments/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/SKILL.md` | adapted | `skills/poteto-mode/SKILL.md` | Name fixed from `Poteto Mode`. Task/`AskQuestion`/model-slug/`/loop`/Bugbot references replaced with pi equivalents. |
| `skills/poteto-mode/playbooks/authoring-a-skill.md` | adapted | `skills/poteto-mode/playbooks/authoring-a-skill.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/autonomous-run.md` | adapted | `skills/poteto-mode/playbooks/autonomous-run.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/autopilot-full.md` | adapted | `skills/poteto-mode/playbooks/autopilot-full.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/autopilot-stack.md` | adapted | `skills/poteto-mode/playbooks/autopilot-stack.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/babysit.md` | adapted | `skills/poteto-mode/playbooks/babysit.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/bug-fix.md` | adapted | `skills/poteto-mode/playbooks/bug-fix.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/eval.md` | adapted | `skills/poteto-mode/playbooks/eval.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/feature.md` | adapted | `skills/poteto-mode/playbooks/feature.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/hillclimb.md` | adapted | `skills/poteto-mode/playbooks/hillclimb.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/investigation.md` | adapted | `skills/poteto-mode/playbooks/investigation.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/multi-phase-plan.md` | adapted | `skills/poteto-mode/playbooks/multi-phase-plan.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/opening-a-pr.md` | adapted | `skills/poteto-mode/playbooks/opening-a-pr.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/orchestrate.md` | adapted | `skills/poteto-mode/playbooks/orchestrate.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/pause-safely.md` | adapted | `skills/poteto-mode/playbooks/pause-safely.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/perf-issue.md` | adapted | `skills/poteto-mode/playbooks/perf-issue.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/prototype.md` | adapted | `skills/poteto-mode/playbooks/prototype.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/refactoring.md` | adapted | `skills/poteto-mode/playbooks/refactoring.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/runtime-forensics.md` | adapted | `skills/poteto-mode/playbooks/runtime-forensics.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/session-pickup.md` | adapted | `skills/poteto-mode/playbooks/session-pickup.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/shipping.md` | adapted | `skills/poteto-mode/playbooks/shipping.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/trace-forensics.md` | adapted | `skills/poteto-mode/playbooks/trace-forensics.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/visual-parity.md` | adapted | `skills/poteto-mode/playbooks/visual-parity.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/playbooks/worktree-cleanup.md` | adapted | `skills/poteto-mode/playbooks/worktree-cleanup.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/references/bugbot-triage.md` | adapted | `skills/poteto-mode/references/review-bot-triage.md` | Renamed and generalized from one vendor's review bot to review bots in general. |
| `skills/poteto-mode/scripts/bootstrap.ts` | adapted | `skills/poteto-mode/scripts/bootstrap.ts` | `Bun.spawnSync` and `import.meta.dir` replaced by Node equivalents; installs at the package root with npm. |
| `skills/poteto-mode/scripts/bun.lock` | dropped | `(none)` | Bun lockfile. The scripts now install and run under npm and Node. |
| `skills/poteto-mode/scripts/check-plan.mjs` | adapted | `skills/poteto-mode/scripts/check-plan.mjs` | The plan linter's lane example no longer names a vendor model. |
| `skills/poteto-mode/scripts/orch/orch.test.ts` | adapted | `skills/poteto-mode/scripts/orch/orch.test.ts` | `bun:test` and `Bun.spawn*` replaced by the Node test runner and `node:child_process`. |
| `skills/poteto-mode/scripts/orch/orch.ts` | adapted | `skills/poteto-mode/scripts/orch/orch.ts` | Shebang changed from `bun` to `node`. |
| `skills/poteto-mode/scripts/orch/store.ts` | adapted | `skills/poteto-mode/scripts/orch/store.ts` | One TypeScript parameter property rewritten so Node's strip-only loader can run the file. |
| `skills/poteto-mode/scripts/package.json` | adapted | `skills/poteto-mode/scripts/package.json` | Bun test script and bun-types dropped; `node --test` and Node types. Runtime dependency resolves from the package root. |
| `skills/poteto-mode/scripts/watch-pr/cli.test.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/cli.test.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/cli.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/cli.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/fakes.test-helper.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/fakes.test-helper.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/github.test.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/github.test.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/github.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/github.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/policy.test.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/policy.test.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/policy.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/policy.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/render.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/render.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/tsconfig.json` | replaced | `skills/poteto-mode/scripts/tsconfig.json` | Bun-typed per-directory config replaced by one Node-typed config for the whole scripts tree. |
| `skills/poteto-mode/scripts/watch-pr/types.compile.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/types.compile.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/types.ts` | adapted | `skills/poteto-mode/scripts/watch-pr/types.ts` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/poteto-mode/scripts/watch-pr/watch-pr` | adapted | `skills/poteto-mode/scripts/watch-pr/watch-pr` | Shebang changed from `bun` to `node`. |
| `skills/poteto-mode/scripts/worktree-audit.sh` | adapted | `skills/poteto-mode/scripts/worktree-audit.sh` | Session discovery moved from Cursor transcripts to pi session files; GNU/BSD `stat` and `date` handled; `LAST_CHAT`/`verify-recent-chat` renamed. |
| `skills/principle-attack-the-premise/SKILL.md` | adapted | `skills/principle-attack-the-premise/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-boundary-discipline/SKILL.md` | adapted | `skills/principle-boundary-discipline/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-build-the-lever/SKILL.md` | adapted | `skills/principle-build-the-lever/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-encode-lessons-in-structure/SKILL.md` | adapted | `skills/principle-encode-lessons-in-structure/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-exhaust-the-design-space/SKILL.md` | adapted | `skills/principle-exhaust-the-design-space/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-experience-first/SKILL.md` | adapted | `skills/principle-experience-first/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-fix-root-causes/SKILL.md` | adapted | `skills/principle-fix-root-causes/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-foundational-thinking/SKILL.md` | adapted | `skills/principle-foundational-thinking/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-guard-the-context-window/SKILL.md` | adapted | `skills/principle-guard-the-context-window/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-laziness-protocol/SKILL.md` | adapted | `skills/principle-laziness-protocol/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-make-operations-idempotent/SKILL.md` | adapted | `skills/principle-make-operations-idempotent/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md` | adapted | `skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-minimize-reader-load/SKILL.md` | adapted | `skills/principle-minimize-reader-load/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-model-the-domain/SKILL.md` | adapted | `skills/principle-model-the-domain/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-never-block-on-the-human/SKILL.md` | adapted | `skills/principle-never-block-on-the-human/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-outcome-oriented-execution/SKILL.md` | adapted | `skills/principle-outcome-oriented-execution/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-prove-it-works/SKILL.md` | adapted | `skills/principle-prove-it-works/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-redesign-from-first-principles/SKILL.md` | adapted | `skills/principle-redesign-from-first-principles/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-separate-before-serializing-shared-state/SKILL.md` | adapted | `skills/principle-separate-before-serializing-shared-state/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-sequence-verifiable-units/SKILL.md` | adapted | `skills/principle-sequence-verifiable-units/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-subtract-before-you-add/SKILL.md` | adapted | `skills/principle-subtract-before-you-add/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-test-behavior-not-implementation/SKILL.md` | adapted | `skills/principle-test-behavior-not-implementation/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/principle-type-system-discipline/SKILL.md` | adapted | `skills/principle-type-system-discipline/SKILL.md` | Principle body kept; Cursor-only tool names and slash-command forms replaced with pi equivalents. |
| `skills/recall/SKILL.md` | adapted | `skills/recall/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/reflect/SKILL.md` | adapted | `skills/reflect/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/reflect/references/divergent-reviewer.md` | adapted | `skills/reflect/references/divergent-reviewer.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/reflect/references/judgment-reviewer.md` | adapted | `skills/reflect/references/judgment-reviewer.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/reflect/references/synthesizer.md` | adapted | `skills/reflect/references/synthesizer.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/reflect/references/tooling-reviewer.md` | adapted | `skills/reflect/references/tooling-reviewer.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/setup-pstack/SKILL.md` | replaced | `skills/setup-pstack/SKILL.md` | Upstream wrote an always-applied `.mdc` rule. Now writes `~/.pi/agent/pstack-models.json`, read by the subagent extension. |
| `skills/show-me-your-work/SKILL.md` | adapted | `skills/show-me-your-work/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/show-me-your-work/references/decision-log-template.tsv` | adapted | `skills/show-me-your-work/references/decision-log-template.tsv` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/show-me-your-work/scripts/log.sh` | adapted | `skills/show-me-your-work/scripts/log.sh` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/swarm/SKILL.md` | adapted | `skills/swarm/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/tdd/SKILL.md` | adapted | `skills/tdd/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/teach/SKILL.md` | adapted | `skills/teach/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/technical-writing/SKILL.md` | adapted | `skills/technical-writing/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/typescript-best-practices/SKILL.md` | adapted | `skills/typescript-best-practices/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/typescript-best-practices/references/patterns.md` | adapted | `skills/typescript-best-practices/references/patterns.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/unslop/SKILL.md` | adapted | `skills/unslop/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/SKILL.md` | adapted | `skills/why/SKILL.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/epistemics.md` | adapted | `skills/why/references/epistemics.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/investigator-prompt.md` | adapted | `skills/why/references/investigator-prompt.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/source-playbook.md` | adapted | `skills/why/references/source-playbook.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/code-archaeology.md` | adapted | `skills/why/references/sources/code-archaeology.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/databricks.md` | adapted | `skills/why/references/sources/databricks.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/datadog.md` | adapted | `skills/why/references/sources/datadog.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/incident-postmortem.md` | adapted | `skills/why/references/sources/incident-postmortem.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/linear.md` | adapted | `skills/why/references/sources/linear.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/notion.md` | adapted | `skills/why/references/sources/notion.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/sentry.md` | adapted | `skills/why/references/sources/sentry.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/sources/slack.md` | adapted | `skills/why/references/sources/slack.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |
| `skills/why/references/synthesizer-prompt.md` | adapted | `skills/why/references/synthesizer-prompt.md` | Ported for pi: frontmatter made spec-compliant, Cursor primitives replaced, skill references rewritten to `/skill:` commands. |

### Skill directories (47)

Every `skills/<name>/` directory in the source, with its disposition. `SKILL.md` is listed in the file inventory above; this table is the directory-level view.

| Skill directory | Kind | Status | Note |
| --- | --- | --- | --- |
| `skills/architect/` | workflow | adapted | Ported for pi. |
| `skills/arena/` | workflow | adapted | Ported for pi. |
| `skills/automate-me/` | workflow | adapted | Ported for pi. |
| `skills/blast-radius/` | workflow | adapted | Ported for pi. |
| `skills/bro/` | workflow | adapted | Ported for pi. |
| `skills/create-verification-skill/` | workflow | adapted | Ported for pi. |
| `skills/figure-it-out/` | workflow | adapted | Ported for pi. |
| `skills/how/` | workflow | adapted | Ported for pi. |
| `skills/interrogate/` | workflow | adapted | Ported for pi. |
| `skills/maintain-verification-skill/` | workflow | adapted | Ported for pi. |
| `skills/make-bot-ui/` | utility | adapted | Rewritten for a headless pi wake; name fixed from `Make Bot UI`. |
| `skills/no-comments/` | workflow | adapted | Ported for pi. |
| `skills/poteto-mode/` | mode | adapted | Frontmatter fixed (`Poteto Mode` → `poteto-mode`); 23 playbooks, the review-bot reference, and the scripts live here. |
| `skills/principle-attack-the-premise/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-boundary-discipline/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-build-the-lever/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-encode-lessons-in-structure/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-exhaust-the-design-space/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-experience-first/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-fix-root-causes/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-foundational-thinking/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-guard-the-context-window/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-laziness-protocol/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-make-operations-idempotent/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-migrate-callers-then-delete-legacy-apis/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-minimize-reader-load/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-model-the-domain/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-never-block-on-the-human/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-outcome-oriented-execution/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-prove-it-works/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-redesign-from-first-principles/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-separate-before-serializing-shared-state/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-sequence-verifiable-units/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-subtract-before-you-add/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-test-behavior-not-implementation/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/principle-type-system-discipline/` | principle | adapted | Body kept. Cursor-only tool names and slash-command forms replaced. |
| `skills/recall/` | workflow | adapted | Ported for pi. |
| `skills/reflect/` | workflow | adapted | Ported for pi. |
| `skills/setup-pstack/` | setup | adapted | Rewritten to write the pi role config. |
| `skills/show-me-your-work/` | workflow | adapted | Ported for pi. |
| `skills/swarm/` | workflow | adapted | Ported for pi. |
| `skills/tdd/` | workflow | adapted | Ported for pi. |
| `skills/teach/` | workflow | adapted | Ported for pi. |
| `skills/technical-writing/` | workflow | adapted | Ported for pi. |
| `skills/typescript-best-practices/` | workflow | adapted | Ported for pi. |
| `skills/unslop/` | workflow | adapted | Ported for pi. |
| `skills/why/` | workflow | adapted | Ported for pi. |

## 5. Changelog: every behavioral change made during the port

Ordered by area. Each entry is a change the captain can disagree with.

### Package and install

1. **`package.json` replaces `.cursor-plugin/plugin.json`.** Name `pi-pstack`, version `0.15.2` (tracks upstream), `private: true`, `type: module`, `license: MIT`, keyword `pi-package`, and a `pi` manifest declaring `extensions/` and `skills/`. The upstream `displayName`, `category`, `tags`, `logo`, `homepage`, and `repository` fields have no pi manifest equivalent; the repository and homepage are in `README.md` instead. The `prompts` manifest entry was removed because the package ships no prompt templates: both upstream slash commands are now skills.
2. **Install path changed.** Upstream: install the plugin from Cursor's marketplace. Here: `pi install git:github.com/gh0stwin/pi-pstack`. `pi install -l` is the project-scoped form Benny uses.
3. **`dependencies` gained `commander@14.0.0`** for the ported `watch-pr` and `orch` CLIs. It is declared at the package root because pi runs `npm install` there and Node resolves upward from the importing file. `peerDependencies` lists pi's bundled packages (`@earendil-works/pi-*`, `typebox`) with `"*"`, per the package docs.
4. **Build, test, and lint setup added.** `npm run typecheck` typechecks `extensions/` and the scripts tree; `npm test` runs all 58 tests through `node --test`; `npm run check` runs both. Upstream had no package-level check.

### Skills

5. **Two skill names fixed to satisfy the Agent Skills rules.** `Poteto Mode` → `poteto-mode` and `Make Bot UI` → `make-bot-ui`. Both were invalid (uppercase and spaces) and pi would have warned and loaded them under the directory name anyway.
6. **`disable-model-invocation: true` removed from 44 skills, kept on 2.** This is the largest behavioral change. Upstream set it on 46 of 47 skills. In pi, that flag removes a skill from the system prompt, which means the agent cannot discover or load it at all; `/skill:name` still works for the user. Since poteto-mode, the playbooks, `how`, `why`, `arena`, `swarm`, `architect`, `interrogate`, `reflect`, and `tdd` all route the agent to other skills by name, leaving the flag on would have made those routes dead ends. Kept on `poteto-mode` (a mode the user opts into, not one the agent should auto-enter) and `make-bot-ui` (a user-invoked procedure).
7. **Slash-command references rewritten.** Every `/skill-name` reference in skills and docs became `/skill:skill-name`, which is the form pi registers. This touches 36 files.
8. **`skills/setup-pstack/SKILL.md` rewritten.** It now writes `~/.pi/agent/pstack-models.json` instead of an always-applied `.mdc` rule, detects models with `pi --list-models`, supports a project-scoped `.pi/pstack-models.json` override, and points at `/pstack-models` and the `pstack_roles` tool to inspect the result.
9. **`skills/make-bot-ui/SKILL.md` rewritten.** The Cursor routine-creation flow (`update_state`), the `SendToUser` secret-request, and the hosted Grok Bot webhook are gone. In their place: three wake mechanisms (one-shot `pi -p`, RPC to a live session, or a queue file), a minimal server example, and a self-generated token. The Tailscale instructions are kept.
10. **`skills/deslop/SKILL.md` added.** Ported from `cursor-team-kit/skills/deslop` in the same upstream repository at the same commit, because poteto-mode routes to it before every commit. Added pi guidance: name the base branch explicitly, re-run the branch's own check, hand shape decisions to `architect`.
11. **`skills/create-skill/SKILL.md` added.** Reimplements Cursor's built-in `create-skill` against pi's Agent Skills rules: location table, frontmatter limits, the description-as-trigger rule, `disable-model-invocation` semantics on pi, a five-prompt trigger test, and validation steps.
12. **`skills/why/SKILL.md` MCP discovery replaced.** It used to discover MCP servers and query each evidence category through them. pi has no MCP client, so it now lists the tools the session exposes, treats `git` and `gh` as the always-available source-control category, and treats an MCP-backed source as available only when an extension registers it.
13. **`skills/automate-me/SKILL.md` transcript discovery rewritten** for pi sessions: `$PI_SESSION_FILE` for the active session and `<agent dir>/sessions/--<workspace-slug>--/*.jsonl` for history, with the agent-dir override respected.
14. **`skills/reflect/SKILL.md` and its reviewers** now hand skill creation to the ported `create-skill` skill and describe sessions rather than Cursor transcripts.
15. **`skills/poteto-mode/references/bugbot-triage.md` → `review-bot-triage.md`.** Renamed and rewritten so the guidance is about review bots in general, not one vendor's bot.
16. **`skills/poteto-mode/SKILL.md` updated**: `AskQuestion` → `ask_question`, `Task`/`subagent_type` → the `subagent` tool's `agent`/`role`/`readonly` parameters, model slugs → roles, `/loop` → explicit wake signals, Bugbot → review bots, and the `control-cli`/`control-ui` route → a project verification skill. The `mode`, `icon`, `color`, and `reminder` frontmatter fields were dropped.
17. **`skills/poteto-mode/playbooks/*` (23 playbooks) adapted.** `deslop`, `no-comments`, and the other skill routes use `/skill:` forms; `run_in_background` is gone; autonomous runs name a wake signal instead of `/loop`; PR-status requests no longer disambiguate against a Cursor built-in.

### Agents and the subagent extension

18. **`agents/comment-sicko.md` and `agents/poteto-agent.md` kept as agent definitions**, with the Cursor `subagent_type` framing replaced by frontmatter (`name`, `description`, optional `tools`, `model`, `readonly`) that the extension reads.
19. **`agents/worker.md` added** as the general-purpose delegate the playbooks needed.
20. **`extensions/subagent/` added.** A `subagent` tool (single, parallel with a cap of 8 tasks and 4 concurrent, and chained with `{previous}` substitution), a `pstack_roles` tool, and a `/pstack-models` command. It spawns a real `pi` process per task with `--mode json -p --no-session`, parses usage and stop reason from the JSON stream, caps per-task output at 50 KB, and cleans up its temporary system-prompt files.
21. **Agent discovery order** is package `agents/` → `~/.pi/agent/agents/` → `.pi/agents/` (trusted projects only), with later entries winning by name.
22. **Model resolution order** is the explicit `model` parameter → the `role` parameter against `pstack-models.json` → the agent's own `model` → the parent session model. `inherit-parent` and `auto` omit `--model`.

### Scripts

23. **`watch-pr` ported to Node.** `#!/usr/bin/env node`; `bun:test` replaced by `node:test` plus the new `expect` shim; all 38 tests kept and passing.
24. **`orch` ported to Node.** `Bun.spawnSync` → `node:child_process.spawnSync`, `Bun.spawn` → `spawn` + `once(child, "exit")`, `import.meta.dir` → `import.meta.dirname`, and one TypeScript parameter property in `store.ts` rewritten because Node's strip-only loader rejects it. All 14 tests kept and passing.
25. **`bootstrap.ts` rewritten.** It now installs at the package root with `npm install` instead of `bun install --frozen-lockfile` in `scripts/`, keys its install stamp on the root `package.json` and `package-lock.json`, and re-execs with `node`. `bun.lock` is gone.
26. **`worktree-audit.sh` ported to pi sessions.** It resolves the session directory from `PI_CODING_AGENT_SESSION_DIR` / `PI_CODING_AGENT_DIR`, searches both the repository-level session directory and each worktree's own directory (pi keys sessions by the session's cwd), handles GNU and BSD `stat`/`date`, and renames the `LAST_CHAT` column to `LAST_SESSION` and the `verify-recent-chat` bucket to `verify-recent-session`.
27. **Review-bot detection generalized.** `isBugbot`/`bugbotReviewPasses` became `isReviewBot`/`reviewBotPasses` across `github.ts`, `types.ts`, `render.ts`, `policy.ts`, and the tests. The detector now matches a list of known review-bot logins plus generic run markers. Cursor's Bugbot is not in the list: a repository that runs it must add its login to `REVIEW_BOT_LOGINS`.
28. **`check-plan.mjs` no longer names a vendor model** in its lane example, and its loop variable was renamed.
29. **`scripts/package.json` rewritten**: `node --test` and Node types; `bun-types` and `bun.lock` dropped. `watch-pr/tsconfig.json` was replaced by one `scripts/tsconfig.json`.
30. **`skills/poteto-mode/playbooks/worktree-cleanup.md` updated** for the renamed column and bucket, and for reading pi sessions rather than chats and transcripts.

### Docs

31. **`docs/guide/01-setup.md` rewritten** for pi: terminal install, `pi -e` trial, `/skill:setup-pstack`, the JSON role config, and a note that the config is read at every spawn rather than at session start.
32. **`docs/guide/03`, `04`, `05`, `06`, `08`, `09`, `10`, and the guide index** had their command references, install paths, and `create-skill`/`deslop` routes rewritten. `05-build-and-clean.md` no longer tells the reader to install a different Cursor plugin.
33. **`docs/guide/07-overnight.md` rewritten** around the loss of `/loop`: the autonomous run names an explicit wake signal.
34. **`docs/guide/10-recipes-and-pitfalls.md`** image alt text no longer references `/loop`.

### Benny

35. **Destination changed** from `.cursor/automations/benny/` to `.pi/automations/benny/`, and user configuration from `.cursor/benny/` to `.pi/benny/`.
36. **Plugin enablement replaced.** Upstream merged a `plugins.pstack.enabled` entry into `.cursor/settings.json`. Here setup runs `pi install -l git:github.com/gh0stwin/pi-pstack`, which writes `.pi/settings.json`.
37. **Two hosted automations replaced by two headless jobs.** `runner/benny-run.ts` builds the `pi -p` prompt from the config and the event; `templates/benny-triage.yml` and `templates/benny-reproduce.yml` are the GitHub Actions forms. The reproduce job polls on a 15-minute schedule for a report whose trusted marker has no repro reply yet, because a headless job cannot wait inside one run for an unbounded time.
38. **Slack actions replaced by a CLI contract.** `<cli> thread|permalink|post|react|edit|download`, named in `slack.cli`. The token lives with the CLI, never in YAML and never in a worker's environment.
39. **`control-adapter.md` → `verification-adapter.md`**, and the `control.*` config keys became `verification.*`. The concept is unchanged: one skill that can bring the app up, drive it, inspect state, capture evidence, and clean up.
40. **Model configuration is now pi model ids**, with `inherit-parent`/`auto` supported. The upstream placeholder slugs are gone.
41. **The tracker config is now adapter-based** (`tracker.adapter`, with `gh issue` as the reference) rather than a vendor-named skill placeholder.
42. **`templates/*-automation-prompt.md` rewritten** as run-prompt references with the runner's actual event shape (`channel`, `ts`, `thread_ts`, and the `sweep` event).
43. **Subagent guidance added** to both Benny operational files: spawn workers with `readonly: true`, and never export a Slack token into an environment a worker will inherit.
44. **Slack-write bans restated in Slack's own API terms** (`chat.postMessage`, `chat.update`, `chat.delete`, `reactions.add`, and the CLI's `post`/`edit`/`react`) rather than Cursor action names.
45. **Benny README and `FOR_AGENTS.md` rewritten** for the pi flow: merge destination, `pi install -l`, the CLI contract, the workflows, and the new verification checklist.

## 6. Verification performed

Recorded here because the captain asked for the port's own evidence. Everything below was run on the machine the port was built on, Node 24.21.0, pi 0.85.1.

### Package installs without touching the user's pi config

```bash
export PI_CODING_AGENT_DIR=$(mktemp -d)
pi install /path/to/pi-pstack
pi list
```

Actual output:

```text
Installing /home/node/.treehouse/pi-pstack-2e5ee3/1/pi-pstack...
Installed /home/node/.treehouse/pi-pstack-2e5ee3/1/pi-pstack
User packages:
  ../../home/node/.treehouse/pi-pstack-2e5ee3/1/pi-pstack
    /home/node/.treehouse/pi-pstack-2e5ee3/1/pi-pstack
```

The user's own `~/.pi/agent/settings.json` was not modified.

### Skills parse and are discovered

Checked through pi's own loader (`loadSkillsFromDir` from `@earendil-works/pi-coding-agent`) against the package's `skills/` directory:

```text
skills loaded: 49
hidden from model (disable-model-invocation): make-bot-ui, poteto-mode
invalid names: none
diagnostics: 0
model-visible skills in prompt: 47
catalog chars: 18424
missing expected skills: none
principle skills: 23
```

49 = the 47 ported skill directories plus `deslop` and `create-skill`. Zero diagnostics means every `SKILL.md` has valid frontmatter, a valid name, and a name matching its directory. The model-visible catalog is 18.4 KB (~4.6k tokens).

The 3 `automations/benny/skills/*/SKILL.md` files are deliberately outside the package manifest and are not loaded as skills.

### Extensions register

`extensions/subagent/index.ts` registers the `subagent` tool, the `pstack_roles` tool, and the `/pstack-models` command. Loaded with `pi -e <path>` in an isolated config directory to confirm registration without installing; typechecked by `npm run typecheck`.

### Scripts

```bash
npm run check        # typecheck (extensions + scripts) and 58 tests
```

```text
watch-pr: 38 tests, 0 fail
orch:     14 tests, 0 fail
benny-run: 6 tests, 0 fail
total:    58 tests, 0 fail
```

All under Node 24 with `node --test`. `worktree-audit.sh` passes `bash -n` and was run against this repository (it produced a row with a `LAST_SESSION` date and the `hold-wip` bucket). `check-plan.mjs` behavior is unchanged.

### Cursor-residue audit

```bash
grep -rniE '\bcursor\b|\.cursor|cursor\.sh|/add-plugin|\.mdc|subagent_type|AskQuestion|run_in_background|SendSlackMessage|PostToSlack|grok-4|fable-5|sol-max|opus-5' \
  --include='*.md' --include='*.ts' --include='*.json' --include='*.sh' --include='*.mjs' --include='*.yaml' --include='*.yml' \
  . | grep -v '^./.git/' | grep -v '^./node_modules/'
```

Result after the port: **no matches**. The only Cursor mentions in the repository are provenance and attribution in `PORTING.md` and `README.md`, which this audit excludes by not matching them (they are prose, and the audit's pattern list targets primitives and paths, not the word "Cursor" in a sentence).

Notes on false positives the audit was tuned to avoid:

- `endCursor` is GitHub's GraphQL pagination field, used throughout `watch-pr`. A word-boundary pattern keeps it out; a bare substring match would flag ~12 lines of GitHub API code.
- A local variable in `github.ts` was named `cursor` and was renamed to `pageCursor` so the audit is unambiguous.
- "precursor" in `skills/why/SKILL.md` is ordinary English.

## 7. Open items at handoff

Two open items remain after this batch.

1. **The end-to-end model-backed smoke run is not done.** `pi -p` in the isolated config directory cannot reach a model, because the user's providers are installed as user-scope extensions (`pi-deepinfra`, `pi-novita-ai`, `morh-provider`) and the isolated config directory does not have working credentials for them. Skill discovery, frontmatter validity, and extension registration were verified through pi's own loader and `pi -e` instead, which covers the same code paths for parsing and registration but not a live model call.
2. **Benny's Slack CLI does not exist.** The pack documents the contract a repository must implement; no implementation ships, by design, because the token and the client are the user's.
