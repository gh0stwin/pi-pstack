# Triage run prompt

> Reference for the headless run. The runner (`../runner/benny-run.ts`) builds
> this prompt; the GitHub Actions workflow (`benny-triage.yml`) calls it.

Read and follow `.pi/automations/benny/skills/triage-issue-reports/SKILL.md` for this run.

Configuration source. Use this repository-relative path when it is committed in the same repository. Otherwise paraphrase the configured values. Never use a package source or cache path:

```text
{{BENNY_CONFIG_PATH}}
```

Event:

```json
{
	"channel": "{{SLACK_CHANNEL_ID}}",
	"ts": "{{SLACK_MESSAGE_TS}}",
	"thread_ts": "{{SLACK_THREAD_TS_OR_EMPTY}}"
}
```

The event describes a new top-level report in the configured source Slack channel. `ts` is the report; `thread_ts` is present only when the report is already a reply.

Treat the source channel and root thread timestamp as immutable. If either is missing or does not match configuration, stop without posting or writing to the issue tracker.

The operational file owns classification, attachment review, cause tracing, routing, dedupe, tracker writes, and the final verdict. Post no progress messages. Never post a root message in the source channel.

The coordinator is the only Slack poster. Any delegated subagent must run read-only (`readonly: true`), return findings only, and receive an explicit ban on every Slack write action.

End the single verdict with exactly one configured marker:

```text
[benny:bug]
[benny:performance]
[benny:other]
```

A bug or performance marker may add `tracker=<URL>`.
