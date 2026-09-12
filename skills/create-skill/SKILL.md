---
name: create-skill
description: Author, revise, or validate a pi skill (a SKILL.md folder) against the Agent Skills standard. Use for "create a skill", "write a skill for X", "turn this workflow into a skill", "fix this skill's frontmatter", or "tune this skill's description" so it triggers when it should. Also use when a reflect or automate-me proposal asks for a new or edited skill.
---

# Create a skill

A skill is a directory with a `SKILL.md`: YAML frontmatter plus instructions the agent loads on demand. This skill covers where it goes, how the frontmatter must read, how to write the body, and how to test that it triggers.

## 1. Decide it should be a skill

A skill earns its place when the workflow recurs, is longer than a paragraph, and would waste context if it always sat in the prompt. Do not create one for a one-off task, a fact better kept in the repository's own docs, or a preference that belongs in `AGENTS.md`.

Existing-skill-first: extend a skill that already owns the topic rather than adding a near-duplicate. Search the loaded skills and the package's `skills/` before writing.

## 2. Choose the location

| Location | Scope | Use when |
| --- | --- | --- |
| `<package>/skills/<name>/` | whoever installs the package | shipping the skill with a pi package |
| `~/.pi/agent/skills/<name>/` | every project for this user | a personal workflow |
| `.pi/skills/<name>/` | this repository | a project-local workflow; trust-gated |
| `~/.agents/skills/<name>/` | every project, shared across harnesses | a portable skill |

Project skills only load after the project is trusted. A package declares its skills with `pi.skills` in `package.json` or a conventional `skills/` directory.

## 3. Write the frontmatter

```markdown
---
name: kebab-case-name
description: What the skill does and when to load it. Be specific about the trigger words a user would say.
---
```

Rules pi enforces, with the Agent Skills standard:

- `name`: required, 1-64 characters, lowercase `a-z`, `0-9`, and hyphens only. No leading or trailing hyphen, no `--`. Keep it equal to the directory name; pi tolerates a mismatch but warns, and shared skill directories read better when they match.
- `description`: required, at most 1024 characters. It is the only part always in context, so it is the trigger. Say what the skill does and when to use it, in the user's words.
- Optional: `license`, `compatibility` (max 500 chars), `metadata`, `allowed-tools`, `disable-model-invocation`.

`disable-model-invocation: true` hides the skill from the system prompt. The user can still run `/skill:<name>`, but the agent cannot discover or load the skill on its own. Use it only for an entry point the user opts into, never for a skill another skill routes to.

The description is the whole trigger. Weak: "Helps with PDFs." Strong: "Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction."

## 4. Write the body

- Lead with the workflow, not with motivation. Steps in the order they run.
- Use relative paths from the skill directory (`references/rubric.md`, `scripts/run.sh`) and say that is what they are.
- Push detail into `references/` and load it by pointer, so the main file stays small. Keep the main file to the decisions and the order.
- Add `scripts/` only for logic that must be deterministic. Scripts need a shebang, a `README`-style usage line, and a test where one is cheap.
- Write in the imperative to the agent. State the failure mode a step prevents.
- Apply the **unslop** skill. Agent-facing prose has a higher bar than human prose: an unhelpful sentence becomes an instruction some future agent follows.
- Do not restate the repository's own conventions; point at them.

## 5. Validate

1. Frontmatter: name and description present, name matches the rules above, description under 1024 characters.
2. Links: every relative link resolves from the skill directory.
3. Scripts: run each one with `--help` or its narrowest case, and run its test.
4. Load: start a session with the package or skill directory available and confirm the skill appears (or, for a hidden skill, that `/skill:<name>` resolves).
5. Grep the body for stale references to files, skills, or commands that no longer exist.

## 6. Test that it triggers

A skill that does not trigger is not shipped. Test the description against realistic prompts:

1. Write five prompts that should load the skill and five that should not.
2. In a fresh session, ask the first set without naming the skill and see whether the agent reads it.
3. If a should-load prompt misses, add the user's actual phrasing to the description. If a should-not-load prompt fires, add the boundary ("Skip when ...") to the description.
4. Re-run after each edit. Two or three rounds is usually enough.

For a large edit to an existing skill, hand the change to the **reflect** skill so its reviewers see the diff.

## 7. Ship it

Route the change through the **opening-a-pr** playbook in `skills/poteto-mode/playbooks/opening-a-pr.md`: run the **deslop** skill over the diff, write the commit and PR body with the **technical-writing** skill, and apply the **unslop** skill to the prose.
