# benny

benny gives you two headless pi runs for slack issue reports. one triages each report. the other reproduces confirmed bugs and may prepare a small draft fix.

the files in this directory are dormant setup and run sources. they do not appear as package skills.

## how it runs on pi

benny needs a trigger, a slack client, a tracker client, and a way to drive the app. pi ships none of those as built-ins, so this pack wires them explicitly:

| capability | here |
| --- | --- |
| trigger | github actions workflows that run `pi -p`, or `runner/benny-run.ts` locally |
| slack | a slack cli the repository provides, named in `slack.cli` |
| models | pi model ids from `pi --list-models`, or `inherit-parent` |
| app driving | a verification skill from `/skill:create-verification-skill` |
| shared skills | `.pi/settings.json` via `pi install -l git:github.com/gh0stwin/pi-pstack` |

slack access is the one capability with no pi equivalent. pi ships no MCP client and no slack integration, so benny calls a cli instead. see `skills/setup-benny/SKILL.md` for the contract that cli must satisfy.

the full upstream-to-here mapping and the capability losses are in the repository's `PORTING.md`.

## set it up

1. point pi at [`FOR_AGENTS.md`](./FOR_AGENTS.md) and name the target repository.
2. let setup merge this whole directory into the target at `.pi/automations/benny/`. it must preserve destination-only files and review conflicts instead of overwriting local edits.
3. let setup add pi-pstack to the target repository's project settings for shared dependencies:

```bash
pi install -l git:github.com/gh0stwin/pi-pstack
```

4. provide a slack cli that implements the contract in `skills/setup-benny/SKILL.md`, and set its name in `slack.cli`.
5. keep user-owned configuration outside the copied pack, for example in `.pi/benny/`. adapt [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md).
6. copy [`templates/benny-triage.yml`](./templates/benny-triage.yml) and [`templates/benny-reproduce.yml`](./templates/benny-reproduce.yml) to `.github/workflows/`, or run [`runner/benny-run.ts`](./runner/benny-run.ts) directly.
7. commit `.pi/settings.json`, `.pi/automations/benny/`, and any secret-free configuration before enabling either run.
8. send a harmless test report and verify every source-channel post stays in the original thread.
