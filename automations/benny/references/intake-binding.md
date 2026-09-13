# Intake binding contract

Every Benny run receives one intake binding in its prompt. The binding names four things, and the operational files assume nothing beyond them:

| name | what it is |
| --- | --- |
| source item | the report being triaged: one message, one issue, one email, or one webhook item |
| source thread | the conversation around that item; every source read happens here |
| verdict location | the single place the run posts its one verdict; always a reply or comment on the source item |
| adapter | the thing that reads the source thread and posts at the verdict location |

The runner also names two locations when the intake has them:

- trusted verdict identity: the author whose triage marker the reproduce run trusts
- operations location: where detailed status goes; the run output when the intake has no separate location

The runner builds the binding from the configuration and the event, validates it before it starts `pi`, and passes it in the prompt. Adding an intake is a runner and documentation change; the operational files stay as they are.

## How the runner passes the binding

The prompt names every binding field on its own line:

```text
Intake binding:
- intake: slack
- source item: the Slack report message in channel C0123 at ts 1700000000.000100
- source thread: the thread rooted at thread_ts 1700000000.000100 in channel C0123
- verdict location: exactly one reply in that thread (channel C0123, thread_ts 1700000000.000100)
- adapter: Slack CLI benny-slack
- adapter read: benny-slack thread C0123 1700000000.000100
- adapter post: benny-slack post C0123 1700000000.000100 <text>
- trusted verdict identity: U0123
- operations location: one status thread in the configured operations channel C0999
```

The operational file reads the binding instead of hardcoding source terms. On a sweep the binding names the source collection instead of one item, and the run freezes the chosen item's coordinates before it reads or posts.

## Adapter contract

An adapter must:

- read the source thread, including its root and replies;
- post at the verdict location as a reply or comment on the source item, never as a new item;
- keep its write actions unavailable to delegated workers;
- report a missing capability instead of guessing.

The coordinator is the only adapter poster. Delegated workers are read-only, receive no adapter credentials, and their prompts forbid every adapter write.

### Slack CLI adapter

The Slack intake sets `slack.cli` to a command the repository provides. It must implement:

```text
<cli> thread <channel> <ts>              # JSON: root message and replies
<cli> permalink <channel> <ts>           # permalink URL
<cli> post <channel> <ts> <text>         # reply in the thread, prints the new ts
<cli> react <channel> <ts> <emoji>       # add a reaction
<cli> edit <channel> <ts> <text>         # edit a message the identity owns
<cli> download <file-id> <dest>          # write an attachment to dest
```

Its binding is:

- source item: the report message, named by channel and ts
- source thread: the thread rooted at `thread_ts`, or at `ts` when the report is not already a reply
- verdict location: one reply in that thread
- adapter: the Slack CLI; the trusted verdict identity is `slack.triage_identity_user_id`, and the operations location is `slack.operations_channel_id` when it is configured

A Slack adapter write is any `post`, `edit`, `react`, or `delete` call and any `chat.postMessage`, `chat.update`, `chat.delete`, or `reactions.add` API call. No worker receives a Slack token. `BENNY_SLACK_BOT_TOKEN` is available only to the CLI, and only for a narrow missing capability such as editing one operations status message.

### Tracker adapter

The tracker is an adapter, not a required vendor: `gh issue` is the reference implementation for GitHub Issues, and a Linear, Jira, or other adapter may implement the same search/read/create/update/link/compensate contract.

The GitHub intake reuses the tracker adapter as its intake adapter. Its binding is:

- source item: the issue named by the event, as `issue`/`url` or a `/issues/<number>` URL
- source thread: that issue and its comments
- verdict location: exactly one comment on that issue
- adapter: `tracker.adapter`; the trusted verdict identity is the tracker identity that posts the verdict, and the operations location is the run output

### Webhook/CLI adapter

Any source that can hand the runner a source item, a verdict location, and an adapter uses the webhook intake. The event payload is the binding:

```json
{
  "source_item": "SUP-1234",
  "source_thread": "SUP-1234",
  "verdict_location": "SUP-1234#reply",
  "adapter": {
    "read": "support-cli thread SUP-1234",
    "post": "support-cli reply SUP-1234"
  },
  "verdict_identity": "support-agent"
}
```

The runner fails closed before it starts `pi` when the payload is not a JSON object, when `source_item`, `verdict_location`, `adapter.read`, or `adapter.post` is missing or empty, when an optional field has the wrong type, when an adapter command spans more than one line, or when `verdict_location` does not name the same item as `source_item`. `source_thread` defaults to the source item and `verdict_identity` defaults to the identity the adapter posts as.

The adapter owns its credentials; the run only invokes the commands the binding names. The webhook intake has no configured source collection, so it cannot run a sweep. Treat the event as trusted input: the runner passes the adapter commands to the model, so only a source you trust should be able to dispatch this intake.

## Adding an intake

1. Add the source value and its config keys to `resolveIntake` and `validateIntake`.
2. Validate its event in `validateEvent` and build its binding in `buildBinding`.
3. Ship its trigger template or CLI invocation and document the binding in `README.md` and `skills/setup-benny/SKILL.md`.
4. Leave both operational files and the safety rules untouched.

The intake candidate list and the design note live in [`../README.md`](../README.md).
