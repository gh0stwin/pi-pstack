---
name: setup-pstack
description: Configure which pi models pstack uses per role. Detects your available models and writes the role config that the subagent extension reads. Use for /skill:setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Write `~/.pi/agent/pstack-models.json`, the role-to-model config the `subagent` tool reads at spawn time.

## Steps

### 1. Detect available models

Run `pi --list-models` and read the `provider` and `model` columns. That is the dependable source: pi only lists models whose provider has configured auth. Use every `provider/model` pair as a selectable value. If the list is empty, ask the user to configure a provider with `/login` first and stop.

The aliases `inherit-parent` and `auto` are always valid even though they are not detected model ids.

### 2. Load current state

Read `~/.pi/agent/pstack-models.json` if it exists and treat its values as the current choices. Otherwise start from these defaults, chosen from the pi catalog at port time:

```
feature, refactoring: deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731
bug-fix: deepinfra/zai-org/GLM-5.3-Flash
perf-issue: deepinfra/zai-org/GLM-5.3-Flash
hillclimb: deepinfra/zai-org/GLM-5.3-Flash
judgment and prose: deepinfra/zai-org/GLM-5.3-Flash
hardest tasks: deepinfra/zai-org/GLM-5.3-Flash
how explorer: deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731
how explainer: deepinfra/zai-org/GLM-5.3-Flash
why investigators: deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731
why synthesizer: deepinfra/zai-org/GLM-5.3-Flash
reflect tooling: deepinfra/google/gemini-3.1-pro
reflect judgment, divergent, synthesizer: deepinfra/zai-org/GLM-5.3-Flash
arena runners: deepinfra/zai-org/GLM-5.3-Flash, deepinfra/google/gemini-3.1-pro, deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731, deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507
arena cross-judge pool: deepinfra/zai-org/GLM-5.3-Flash, deepinfra/google/gemini-3.1-pro, deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731, deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507
swarm workers: deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731
architect runners: deepinfra/zai-org/GLM-5.3-Flash, deepinfra/google/gemini-3.1-pro, deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731, deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507
interrogate reviewers: deepinfra/zai-org/GLM-5.3-Flash, deepinfra/google/gemini-3.1-pro, deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731, deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507
```

### 3. Map and confirm

Show every role with its current model, marking any model not in the detected set as needing a choice. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean: this role runs on the parent session model, so omitting `--model`). Prefer `ask_question` over free text.

For panel roles (arena runners, arena cross-judge pool, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, so the list length sets the panel size. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every model id written must appear in the detected set. `inherit-parent` and `auto` always pass. If a chosen model is not available, stop and ask again. Never write a model id you have not confirmed is available.

### 5. Write the config

Write `~/.pi/agent/pstack-models.json`, one key per role label, using the same labels poteto-mode uses. Overwrite the whole file so re-runs stay idempotent. Shape:

```json
{
  "feature, refactoring": "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
  "bug-fix": "deepinfra/zai-org/GLM-5.3-Flash",
  "arena runners": [
    "deepinfra/zai-org/GLM-5.3-Flash",
    "deepinfra/google/gemini-3.1-pro",
    "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
    "deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507"
  ]
}
```

Every role keeps a line. Delete a line to fall back to the built-in default for that role. A project can add `.pi/pstack-models.json` with the same shape; project keys override user keys for subagents spawned in that project.

### 6. Confirm

Tell the user the config was written. The `subagent` tool reads it at every spawn, so the new choices apply to the next subagent without a restart. Run `/pstack-models` or the `pstack_roles` tool to show the effective map. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /skill:create-verification-skill." On yes, invoke the **create-verification-skill** skill. On no, move on without pushing.
