# Reproduce-and-fix run prompt

> Reference for the headless run. The runner (`../runner/benny-run.ts`) builds
> this prompt from the configuration, the event, and the resolved intake
> binding. The operational file it names is the run's actual instruction set.

Read and follow `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md` for this run.

Configuration source. Use this repository-relative path when it is committed in the same repository. Otherwise paraphrase the configured values. Never use a package source or cache path:

```text
{{BENNY_CONFIG_PATH}}
```

The runner passes the same binding block as the triage run. The binding contract and the per-intake adapter notes are in [`../references/intake-binding.md`](../references/intake-binding.md).

Event, one report, Slack intake:

```json
{
	"channel": "{{SLACK_CHANNEL_ID}}",
	"ts": "{{SLACK_MESSAGE_TS}}",
	"thread_ts": "{{SLACK_THREAD_TS_OR_EMPTY}}"
}
```

Event, one report, GitHub intake (`intake.source: github`):

```json
{
	"issue": 123,
	"url": "https://github.com/owner/repo/issues/123"
}
```

Event, one report, webhook/CLI intake (`intake.source: webhook`):

```json
{
	"source_item": "SUP-1234",
	"source_thread": "SUP-1234",
	"verdict_location": "SUP-1234#reply",
	"adapter": {
		"read": "support-cli thread SUP-1234",
		"post": "support-cli reply SUP-1234"
	}
}
```

Event, scheduled sweep (Slack and GitHub intakes only):

```json
{ "sweep": true }
```

For a sweep, the binding names the source collection and the adapter; scan it for the oldest report that carries a trusted triage marker from the binding's trusted verdict identity, has no repro reply yet, and is still inside the configured verdict budget. Stop cleanly when there is none. The webhook intake has no configured source collection and cannot sweep.

Accept a triage marker only from the binding's trusted verdict identity at the verdict location. Proceed only for `[benny:bug]` or `[benny:performance]`.

Require the configured verification skill before attempting a repro. Reproduce the exact discriminating symptom twice through the real UI. Verify existing pull requests or commits without authoring over them. Attempt a bounded fix only after a confirmed repro and the operational file's fix gate.

The coordinator is the only poster. Every subagent prompt must run read-only and forbid every adapter write; the adapter contract names the concrete actions. Never open a new top-level post for the report.
