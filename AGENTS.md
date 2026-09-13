# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- `npm install && npm run check` is the gate. It typechecks `extensions/**/*.ts` and `automations/**/*.ts`, then runs every `*.test.ts` through `node --test` (`package.json`). Tests run as plain TypeScript via Node type stripping; the shared matcher shim is `skills/poteto-mode/scripts/testing/expect.ts`.
- This repository is a port of Cursor pstack. `PORTING.md` is the authoritative record of every platform mapping, capability loss, and deliberate behavior change; read it before changing ported behavior.
- `automations/benny/` is deliberately outside the `pi` manifest: installing the package must not load or enable benny. `automations/benny/installation.test.ts` pins that. Benny setup copies the pack into a target repo and reads `runner/benny-run.ts` plus the operational `SKILL.md` files directly.
- Benny workflow templates keep attacker-influenced values out of `run:` shell text: dispatch payloads and `workflow_dispatch` inputs reach the script through `env:` and are quoted as data (Slack, GitHub, and GitLab pairs). `automations/benny/installation.test.ts` simulates hostile payloads against the real templates to pin that.
- Benny's intake is opt-in through `intake.source` (`slack`, `github`, `gitlab`, or `webhook`) in the user's configuration; when unset, a Slack section infers Slack, a GitLab section infers GitLab, a repository section infers GitHub, and a config with both GitLab and repository sections is ambiguous and fails closed, while a Slack section missing `slack.cli` or `slack.source_channel_id` still fails closed. The GitLab path requires `gitlab.project`, `gitlab.token_env`, and `tracker.adapter`, and its event is `{"iid":...,"url":...}` with the URL agreeing with the project. `automations/benny/runner/benny-run.ts` owns config/event validation, the intake binding, and the `pi -p` prompt; the operational files read the binding and the contract in `automations/benny/references/intake-binding.md`; extend the runner test file when the runner contract changes. The GitHub-intake pair's job-level `if:` guard label is a second declaration of `tracker.labels.intake`/`tracker.labels.needs_repro`; setup-benny step 10 substitutes the configured value and `automations/benny/installation.test.ts` pins template/config/doc agreement.
- The subagent extension resolves its child `pi` from `PI_PSTACK_PI_BIN`, then the installed pi package's `bin.pi` via `import.meta.resolve`, then `pi` on PATH - never `process.argv[1]`, which is the embedding host when the SDK loads the extension in-process (`extensions/subagent/index.ts`). The subagent tests inject `PI_PSTACK_PI_BIN` pointing at `fixtures/fake-pi.mjs` (`extensions/subagent/test-harness.ts`).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
