# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- `npm install && npm run check` is the gate. It typechecks `extensions/**/*.ts` and `automations/**/*.ts`, then runs every `*.test.ts` through `node --test` (`package.json`). Tests run as plain TypeScript via Node type stripping; the shared matcher shim is `skills/poteto-mode/scripts/testing/expect.ts`.
- This repository is a port of Cursor pstack. `PORTING.md` is the authoritative record of every platform mapping, capability loss, and deliberate behavior change; read it before changing ported behavior.
- `automations/benny/` is deliberately outside the `pi` manifest: installing the package must not load or enable benny. `automations/benny/installation.test.ts` pins that. Benny setup copies the pack into a target repo and reads `runner/benny-run.ts` plus the operational `SKILL.md` files directly.
- Benny's intake is opt-in through `intake.source` (`slack` or `github`) in the user's configuration; a config with no Slack section (or `intake.source: github`) resolves to the GitHub path and needs no Slack, while a Slack section missing `slack.cli` or `slack.source_channel_id` still fails closed. `automations/benny/runner/benny-run.ts` owns config/event validation and the `pi -p` prompt; extend its test file when the runner contract changes.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
