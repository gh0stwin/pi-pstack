# Notes verification map

This directory is the maintained source for verifying the user-facing behavior of Notes. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch Notes with a disposable data directory, on a port chosen for this run. Never assume a port: pick a free one at launch time, or take the one the repo documents in the environment, so two verification runs can run side by side.
- Record the base URL the launch produced as `NOTES_URL` for the rest of the run, the same way the disposable data directory is recorded as `NOTES_DATA_DIR=/tmp/notes-verify-$RUN_ID`. Every precondition, recipe, and doctor check below refers to that recorded `NOTES_URL`; nothing in this map hardcodes a port.
- Seed notes titled `Quarterly plan` and `Grocery list`.
- Put `verify-notes` and the `notes` CLI on `PATH`.
- Run `verify-notes doctor` and require the URL it reports to be this run's recorded `NOTES_URL`, plus the expected data directory and build revision.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Drive the instance at the run's recorded `NOTES_URL`, which the harness reads from the run state; never pass or assume a port.
- Run browser actions through `verify-notes browser`.
- Run terminal actions through `verify-notes cli -- <command>`.
- Restore seeded data after a mutation. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the app identity visible.
- CLI proof includes the command, stdout, stderr, and exit code.
- Mutation proof includes a read-only second view of the stored value.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Create a note](./create-note.md) covers browser and CLI creation, cancellation, persistence, and cleanup.
- [Search notes](./search.md) covers toolbar, keyboard, and CLI search with matching, empty, and clear states.
