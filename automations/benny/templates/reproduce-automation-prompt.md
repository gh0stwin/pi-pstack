# Reproduce-and-fix run prompt

> Reference for the headless run. The runner (`../runner/benny-run.ts`) builds
> this prompt; the GitHub Actions workflow (`benny-reproduce.yml`) calls it.

Read and follow `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md` for this run.

Configuration source. Use this repository-relative path when it is committed in the same repository. Otherwise paraphrase the configured values. Never use a package source or cache path:

```text
{{BENNY_CONFIG_PATH}}
```

Event, one report:

```json
{
	"channel": "{{SLACK_CHANNEL_ID}}",
	"ts": "{{SLACK_MESSAGE_TS}}",
	"thread_ts": "{{SLACK_THREAD_TS_OR_EMPTY}}"
}
```

Event, scheduled sweep:

```json
{ "sweep": true }
```

Event, GitHub intake (`intake.source: github`):

```json
{
	"issue": 123,
	"url": "https://github.com/owner/repo/issues/123"
}
```

For a sweep, scan the configured source for the oldest report that carries a trusted triage marker, has no repro reply yet, and is still inside the configured verdict budget. Stop cleanly when there is none. Otherwise the event names one report. The GitHub intake has no Slack CLI: the source thread is the issue and every source update is a comment posted through the tracker adapter.

Treat the source coordinates as immutable. If they are missing or do not match configuration, stop without posting.

Accept a triage marker only from the configured triage identity in this exact thread. Proceed only for `[benny:bug]` or `[benny:performance]`.

Require the configured verification skill before attempting a repro. Reproduce the exact discriminating symptom twice through the real UI. Verify existing pull requests or commits without authoring over them. Attempt a bounded fix only after a confirmed repro and the operational file's fix gate.

The coordinator is the only poster. Every subagent prompt must run read-only, forbid `chat.postMessage` and every other Slack write, and return findings only. The GitHub intake has no Slack poster at all.

Never post a root message in the source channel.
