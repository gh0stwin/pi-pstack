# Triage run prompt

> Reference for the headless run. The runner (`../runner/benny-run.ts`) builds
> this prompt from the configuration, the event, and the resolved intake
> binding. The operational file it names is the run's actual instruction set.

Read and follow `.pi/automations/benny/skills/triage-issue-reports/SKILL.md` for this run.

Configuration source. Use this repository-relative path when it is committed in the same repository. Otherwise paraphrase the configured values. Never use a package source or cache path:

```text
{{BENNY_CONFIG_PATH}}
```

The runner passes this binding, one line per field:

```text
Intake binding:
- intake: <slack | github | webhook>
- source item: <the report being triaged>
- source thread: <the conversation around it>
- verdict location: <the single place the one verdict goes>
- adapter: <what reads and posts>
- adapter read: <read command or instruction>
- adapter post: <post command or instruction>
- trusted verdict identity: <the author whose marker the reproduce run trusts>
- operations location: <where detailed status goes, or the run output>
```

The binding contract and the per-intake adapter notes are in [`../references/intake-binding.md`](../references/intake-binding.md).

Event, Slack intake:

```json
{
	"channel": "{{SLACK_CHANNEL_ID}}",
	"ts": "{{SLACK_MESSAGE_TS}}",
	"thread_ts": "{{SLACK_THREAD_TS_OR_EMPTY}}"
}
```

Event, GitHub intake (`intake.source: github`):

```json
{
	"issue": 123,
	"url": "https://github.com/owner/repo/issues/123"
}
```

Event, webhook/CLI intake (`intake.source: webhook`):

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

The runner validates the webhook payload before it starts `pi` and fails closed on a missing field, a malformed value, or a verdict location that does not name the same item as `source_item`.

Treat the binding's source coordinates as immutable. If they are missing or do not match the event, stop without posting or writing to the issue tracker.

The operational file owns classification, attachment review, cause tracing, routing, dedupe, tracker writes, and the final verdict. Post no progress messages, and never open a new top-level post for the report.

The coordinator is the only poster. Any delegated subagent must run read-only (`readonly: true`), return findings only, and receive an explicit ban on every adapter write; the adapter contract names the concrete write actions for each intake.

End the single verdict with exactly one configured marker:

```text
[benny:bug]
[benny:performance]
[benny:other]
```

A bug or performance marker may add `tracker=<URL>`.
