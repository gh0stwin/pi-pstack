# Set up pstack

In this page you install the package, pick which models pstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the package

In a terminal, run:

```text
pi install git:github.com/gh0stwin/pi-pstack
```

pi confirms the package is installed and loads its skills, extension, and prompts on the next start.

To try it without installing:

```text
pi -e git:github.com/gh0stwin/pi-pstack
```

## Pick your models

Start pi and run:

```text
/skill:setup-pstack
```

[`/skill:setup-pstack`](../../skills/setup-pstack/SKILL.md) detects the models you have access to, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.pi/agent/pstack-models.json`, the role config the `subagent` tool reads.

You only override what you care about. A role with no key in the config keeps the built-in default. To restore a default later, delete that role's line, or just run `/skill:setup-pstack` again.

You might be wondering what happens if you let pi pick the model. Set a role to `inherit-parent` or `auto` and pstack omits the subagent `--model` flag, so the subagent inherits your parent session model. Both values mean the same thing, and neither is a model id. For a panel role the value is a list, and one subagent runs per entry, so the list length sets the panel size. Setup also configures `swarm workers`, the default model for every `/skill:swarm` worker unless a race names a model for each arm.

Run `/pstack-models` (or call the `pstack_roles` tool) any time to see the effective map and which config files supplied it.

## Accept the verification offer, or don't

At the end of setup, `/skill:setup-pstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `.pi/skills/verify-<app>/`, a project-local skill that teaches agents to drive your app the way a user does. It proves the skill works once before handing it over. Say no and setup moves on. You can run `/skill:create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers when it earns its place.

The model config is read at every subagent spawn, so a new choice applies to the next subagent without a restart.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/skill:poteto-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the plan. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/skill:poteto-mode` skips a step, the step stays visible with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/skill:poteto-mode` is sticky. It stays on for the conversation until you opt out by saying so.

Next: [Route work through `/skill:poteto-mode`](./02-poteto-mode.md).
