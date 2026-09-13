#!/usr/bin/env node
/**
 * Local runner for the Benny automations.
 *
 * Benny is two headless pi jobs: one triages a report, one reproduces and
 * optionally fixes a confirmed bug. This runner resolves the config, the model,
 * the intake, and the event, builds the intake binding, and either prints or
 * executes the `pi` invocation. The operational instructions live in the pack's
 * SKILL.md files; this file only resolves and validates the run inputs.
 *
 * An intake binding names the source item, the source thread, the single
 * verdict location, and the adapter that reads and posts. The runner passes the
 * binding in the prompt, so the operational files never assume a source.
 *
 * The intake is opt-in. `intake.source` selects it; when unset, a Slack section
 * infers the Slack intake, a GitLab section infers GitLab, and a repository
 * section infers GitHub. A config with both GitLab and repository sections is
 * ambiguous and fails closed until `intake.source` names one. The webhook
 * intake takes the whole binding from the event and needs no configuration
 * section.
 *
 * Usage:
 *   node benny-run.ts --mode triage --config .pi/benny/configuration.yaml \
 *     --event '{"channel":"C0123","ts":"1700000000.000100"}'
 *   node benny-run.ts --mode triage --config .pi/benny/configuration.yaml \
 *     --event '{"issue":123,"url":"https://github.com/org/repo/issues/123"}'
 *   node benny-run.ts --mode triage --config .pi/benny/configuration.yaml \
 *     --event '{"iid":42,"url":"https://gitlab.com/group/project/-/issues/42"}'
 *   node benny-run.ts --mode triage --config .pi/benny/configuration.yaml \
 *     --event '{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply",\
 *       "adapter":{"read":"support-cli thread SUP-1234","post":"support-cli reply SUP-1234"}}'
 *
 * Options:
 *   --mode <triage|reproduce>  which operational file to run (required)
 *   --config <path>            Benny configuration (required)
 *   --event <json>             trigger payload (default: {})
 *   --model <id>               override the configured model for this mode
 *   --repo <dir>               repository root (default: cwd)
 *   --dry-run                  print the command instead of running it
 *   --help                     show this text
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Mode = "triage" | "reproduce";

/** Where a run gets its report from. Slack is one option, not the default install. */
export type IntakeSource = "slack" | "github" | "gitlab" | "webhook";

export const OPERATIONAL_FILES: Readonly<Record<Mode, string>> = {
  triage: ".pi/automations/benny/skills/triage-issue-reports/SKILL.md",
  reproduce: ".pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md",
};

/** The binding contract both operational files read. */
export const BINDING_REFERENCE = ".pi/automations/benny/references/intake-binding.md";

export interface RunnerOptions {
  readonly mode: Mode;
  readonly configPath: string;
  readonly event: string;
  readonly model?: string;
  readonly repo: string;
  readonly dryRun: boolean;
}

export interface IntakeConfig {
  readonly source: IntakeSource;
  readonly slackCli?: string;
  readonly slackSourceChannelId?: string;
  readonly slackOperationsChannelId?: string;
  readonly slackTriageIdentity?: string;
  readonly repositoryUrl?: string;
  readonly gitlabProject?: string;
  readonly gitlabTokenEnv?: string;
  readonly trackerAdapter?: string;
}

/** The adapter that reads the source thread and posts at the verdict location. */
export interface IntakeAdapter {
  readonly name: string;
  readonly read: string;
  readonly post: string;
}

/**
 * The four names every intake supplies, plus the two run locations the
 * operational files use when the intake has them.
 */
export interface IntakeBinding {
  readonly source: IntakeSource;
  readonly sourceItem: string;
  readonly sourceThread: string;
  readonly verdictLocation: string;
  readonly adapter: IntakeAdapter;
  readonly verdictIdentity: string;
  readonly operationsLocation: string;
}

export interface RunnerError {
  readonly error: string;
}

/**
 * Read `section.key` from a small YAML file by indentation. Benny's config is a
 * flat two-level map, so a full YAML parser is not worth the dependency. Quoted
 * and unquoted scalars both work; nested lists are not read.
 */
export function readConfigValue(text: string, path: string): string | undefined {
  const [section, key] = path.split(".");
  let inSection = section === undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line.trim());
    if (match === null) continue;
    if (indent === 0) {
      inSection = key === undefined || match[1] === section;
      continue;
    }
    if (!inSection || match[1] !== key) continue;
    const value = (match[2] ?? "").trim().replace(/^["']|["']$/g, "");
    return value === "" ? undefined : value;
  }
  return undefined;
}

/** True when a top-level `section:` line exists, even with no readable key. */
export function hasConfigSection(text: string, section: string): boolean {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent !== 0) continue;
    if (line.trim() === `${section}:` || line.trim().startsWith(`${section}: `)) return true;
  }
  return false;
}

/**
 * Resolve the intake source. `intake.source` wins when present; otherwise a
 * Slack section infers the Slack intake, a GitLab section infers GitLab, and a
 * repository section infers GitHub, so existing Slack and GitHub configs keep
 * working without a declared source. A config with both GitLab and repository
 * sections is genuinely ambiguous and fails closed until `intake.source` names
 * one. The webhook intake is explicit: it has no section and takes its binding
 * from the event.
 */
export function resolveIntake(text: string): IntakeConfig | RunnerError {
  const declared = readConfigValue(text, "intake.source");
  const slackCli = readConfigValue(text, "slack.cli");
  const slackSourceChannelId = readConfigValue(text, "slack.source_channel_id");
  const slackOperationsChannelId = readConfigValue(text, "slack.operations_channel_id");
  const slackTriageIdentity = readConfigValue(text, "slack.triage_identity_user_id");
  const repositoryUrl = readConfigValue(text, "repository.url");
  const gitlabProject = readConfigValue(text, "gitlab.project");
  const gitlabTokenEnv = readConfigValue(text, "gitlab.token_env");
  const trackerAdapter = readConfigValue(text, "tracker.adapter");
  const slackSection = hasConfigSection(text, "slack");
  const repositorySection = hasConfigSection(text, "repository");
  const gitlabSection = hasConfigSection(text, "gitlab");

  if (declared !== undefined && declared !== "slack" && declared !== "github" && declared !== "gitlab" && declared !== "webhook") {
    return { error: `intake.source must be "slack", "github", "gitlab", or "webhook", got "${declared}"` };
  }
  if (
    declared === undefined &&
    slackCli === undefined &&
    repositoryUrl === undefined &&
    gitlabProject === undefined &&
    !slackSection &&
    !repositorySection &&
    !gitlabSection
  ) {
    return {
      error:
        "no intake source: set intake.source, or configure slack.cli (Slack), repository.url (GitHub), or gitlab.project (GitLab)",
    };
  }

  let source: IntakeSource;
  if (declared !== undefined) {
    source = declared;
  } else if (slackCli !== undefined || slackSection) {
    source = "slack";
  } else if (
    (gitlabProject !== undefined || gitlabSection) &&
    (repositoryUrl !== undefined || repositorySection)
  ) {
    return {
      error:
        "ambiguous intake: both a repository section (GitHub) and a gitlab section (GitLab) are configured; set intake.source to choose",
    };
  } else if (gitlabProject !== undefined || gitlabSection) {
    source = "gitlab";
  } else {
    source = "github";
  }
  return {
    source,
    slackCli,
    slackSourceChannelId,
    slackOperationsChannelId,
    slackTriageIdentity,
    repositoryUrl,
    gitlabProject,
    gitlabTokenEnv,
    trackerAdapter,
  };
}

/**
 * Fail-closed checks for the config values each intake needs to name its
 * binding. The webhook intake needs none: its event carries the whole binding.
 */
export function validateIntake(intake: IntakeConfig): string[] {
  if (intake.source === "slack") {
    const errors: string[] = [];
    if (intake.slackCli === undefined) errors.push("slack.cli is required for the Slack intake");
    if (intake.slackSourceChannelId === undefined) errors.push("slack.source_channel_id is required for the Slack intake");
    return errors;
  }
  if (intake.source === "github") {
    const errors: string[] = [];
    if (intake.repositoryUrl === undefined) errors.push("repository.url is required for the GitHub intake");
    if (intake.trackerAdapter === undefined) errors.push("tracker.adapter is required for the GitHub intake");
    return errors;
  }
  if (intake.source === "gitlab") {
    const errors: string[] = [];
    if (intake.gitlabProject === undefined) errors.push("gitlab.project is required for the GitLab intake");
    if (intake.gitlabTokenEnv === undefined) errors.push("gitlab.token_env is required for the GitLab intake");
    if (intake.trackerAdapter === undefined) errors.push("tracker.adapter is required for the GitLab intake");
    return errors;
  }
  return [];
}

/** Parse the event payload, failing closed on malformed JSON or a non-object. */
export function parseEvent(eventText: string): { readonly event: Record<string, unknown> } | RunnerError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(eventText);
  } catch {
    return { error: "--event must be valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "--event must be a JSON object" };
  }
  return { event: parsed as Record<string, unknown> };
}

function eventString(event: Record<string, unknown>, key: string): string | undefined {
  const value = event[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optionalEventString(event: Record<string, unknown>, key: string): { readonly value?: string } | RunnerError {
  if (event[key] === undefined) return {};
  const value = eventString(event, key);
  if (value === undefined) return { error: `event.${key} must be a non-empty string when present` };
  return { value };
}

function githubIssueNumber(event: Record<string, unknown>): number | undefined {
  const issue = event.issue;
  if (typeof issue === "number" && Number.isInteger(issue) && issue > 0) return issue;
  if (typeof issue === "string" && /^\d+$/.test(issue)) return Number(issue);
  const url = eventString(event, "url");
  const match = url === undefined ? null : /\/issues\/(\d+)$/.exec(url);
  return match === null ? undefined : Number(match[1]);
}

function gitlabIssueIid(event: Record<string, unknown>): number | undefined {
  const iid = event.iid;
  if (typeof iid === "number" && Number.isInteger(iid) && iid > 0) return iid;
  if (typeof iid === "string" && /^\d+$/.test(iid)) return Number(iid);
  return undefined;
}

/** Parse a GitLab issue URL into its project path and iid. */
function gitlabIssueUrl(url: string): { readonly project: string; readonly iid: number } | undefined {
  const match = /^https?:\/\/[^/]+\/(.+)\/-\/issues\/(\d+)$/.exec(url);
  if (match === null) return undefined;
  return { project: match[1], iid: Number(match[2]) };
}

/** True when `location` names `item` as a whole token, not a fragment of a longer id. */
export function namesSameItem(location: string, item: string): boolean {
  const isIdentifier = (char: string | undefined): boolean => char !== undefined && /[A-Za-z0-9]/.test(char);
  let index = location.indexOf(item);
  while (index !== -1) {
    const before = index === 0 ? undefined : location[index - 1];
    const after = index + item.length >= location.length ? undefined : location[index + item.length];
    if (!isIdentifier(before) && !isIdentifier(after)) return true;
    index = location.indexOf(item, index + 1);
  }
  return false;
}

/**
 * Validate the webhook payload and build its binding. Fail closed on a missing
 * field, a non-string value, a multi-line adapter command, or a verdict
 * location that names a different item than the source item.
 */
export function webhookBinding(event: Record<string, unknown>): IntakeBinding | RunnerError {
  const sourceItem = eventString(event, "source_item");
  if (sourceItem === undefined) return { error: "event.source_item is required for the webhook intake" };
  const verdictLocation = eventString(event, "verdict_location");
  if (verdictLocation === undefined) return { error: "event.verdict_location is required for the webhook intake" };
  if (!namesSameItem(verdictLocation, sourceItem)) {
    return { error: "event.verdict_location must name the same item as event.source_item" };
  }

  const adapter = event.adapter;
  if (typeof adapter !== "object" || adapter === null || Array.isArray(adapter)) {
    return { error: "event.adapter with read and post commands is required for the webhook intake" };
  }
  const adapterRecord = adapter as Record<string, unknown>;
  const adapterRead = eventString(adapterRecord, "read");
  if (adapterRead === undefined) return { error: "event.adapter.read is required for the webhook intake" };
  const adapterPost = eventString(adapterRecord, "post");
  if (adapterPost === undefined) return { error: "event.adapter.post is required for the webhook intake" };
  if (/[\r\n]/.test(adapterRead)) return { error: "event.adapter.read must be a single line" };
  if (/[\r\n]/.test(adapterPost)) return { error: "event.adapter.post must be a single line" };

  const sourceThread = optionalEventString(event, "source_thread");
  if ("error" in sourceThread) return sourceThread;
  const verdictIdentity = optionalEventString(event, "verdict_identity");
  if ("error" in verdictIdentity) return verdictIdentity;

  return {
    source: "webhook",
    sourceItem,
    sourceThread: sourceThread.value ?? sourceItem,
    verdictLocation,
    adapter: { name: "the adapter named by the event", read: adapterRead, post: adapterPost },
    verdictIdentity: verdictIdentity.value ?? "the identity the adapter posts as",
    operationsLocation: "the run output",
  };
}

/** Check the trigger payload against the mode and the configured intake. */
export function validateEvent(eventText: string, mode: Mode, intake: IntakeConfig): string | undefined {
  const parsed = parseEvent(eventText);
  if ("error" in parsed) return parsed.error;
  const event = parsed.event;
  const source = intake.source;

  if (mode === "reproduce" && event.sweep === true) {
    return source === "webhook" ? "the webhook intake cannot sweep: send an explicit binding" : undefined;
  }

  if (source === "slack") {
    const channel = eventString(event, "channel");
    if (channel === undefined) return "event.channel is required for the Slack intake";
    if (eventString(event, "ts") === undefined) return "event.ts is required for the Slack intake";
    if (event.thread_ts !== undefined && typeof event.thread_ts !== "string") {
      return "event.thread_ts must be a string when present";
    }
    if (intake.slackSourceChannelId !== undefined && channel !== intake.slackSourceChannelId) {
      return "event.channel must match slack.source_channel_id";
    }
    return undefined;
  }

  if (source === "github") {
    const issue = event.issue;
    const issueNumber =
      typeof issue === "number" && Number.isInteger(issue) && issue > 0
        ? issue
        : typeof issue === "string" && /^\d+$/.test(issue)
          ? Number(issue)
          : undefined;
    const url = event.url;
    const urlMatch = typeof url === "string" ? /\/issues\/(\d+)$/.exec(url) : null;
    if (issueNumber === undefined && urlMatch === null) {
      return "event.issue (positive integer) or event.url (/issues/<number>) is required for the GitHub intake";
    }
    if (issueNumber !== undefined && urlMatch !== null && Number(urlMatch[1]) !== issueNumber) {
      return "event.issue and event.url must name the same issue";
    }
    return undefined;
  }

  if (source === "gitlab") {
    const iid = gitlabIssueIid(event);
    if (iid === undefined) {
      return "event.iid (positive integer) is required for the GitLab intake";
    }
    const url = optionalEventString(event, "url");
    if ("error" in url) return url.error;
    if (url.value !== undefined) {
      const parsed = gitlabIssueUrl(url.value);
      if (parsed === undefined) return "event.url must be a GitLab issue URL (/-/issues/<iid>)";
      if (parsed.iid !== iid) return "event.iid and event.url must name the same issue";
      if (intake.gitlabProject !== undefined && parsed.project.toLowerCase() !== intake.gitlabProject.toLowerCase()) {
        return `event.url must name the configured GitLab project "${intake.gitlabProject}"`;
      }
    }
    return undefined;
  }

  const binding = webhookBinding(event);
  return "error" in binding ? binding.error : undefined;
}

function slackBinding(intake: IntakeConfig, event: Record<string, unknown>, sweep: boolean): IntakeBinding {
  const cli = intake.slackCli ?? "the configured slack.cli";
  const operationsLocation =
    intake.slackOperationsChannelId !== undefined
      ? `one status thread in the configured operations channel ${intake.slackOperationsChannelId}`
      : "the run output";
  const verdictIdentity = intake.slackTriageIdentity ?? "the configured Slack triage identity";

  if (sweep) {
    const channel = intake.slackSourceChannelId ?? "the configured source channel";
    return {
      source: "slack",
      sourceItem: `the source collection: the configured source channel ${channel} (pick the oldest report with a trusted triage marker and no repro reply yet)`,
      sourceThread: `the chosen report's source thread in channel ${channel}`,
      verdictLocation: "exactly one reply in the chosen report's source thread",
      adapter: {
        name: `Slack CLI ${cli}`,
        read: `${cli} thread <channel> <thread_ts>`,
        post: `${cli} post <channel> <thread_ts> <text>`,
      },
      verdictIdentity,
      operationsLocation,
    };
  }

  const channel = eventString(event, "channel") ?? intake.slackSourceChannelId ?? "the configured source channel";
  const ts = eventString(event, "ts") ?? "<report ts>";
  const threadTs = eventString(event, "thread_ts") ?? ts;
  return {
    source: "slack",
    sourceItem: `the Slack report message in channel ${channel} at ts ${ts}`,
    sourceThread: `the thread rooted at thread_ts ${threadTs} in channel ${channel}`,
    verdictLocation: `exactly one reply in that thread (channel ${channel}, thread_ts ${threadTs})`,
    adapter: {
      name: `Slack CLI ${cli}`,
      read: `${cli} thread ${channel} ${threadTs}`,
      post: `${cli} post ${channel} ${threadTs} <text>`,
    },
    verdictIdentity,
    operationsLocation,
  };
}

function githubBinding(intake: IntakeConfig, event: Record<string, unknown>, sweep: boolean): IntakeBinding {
  const adapterName = intake.trackerAdapter ?? "the configured tracker adapter";
  const repository = intake.repositoryUrl ?? "the configured repository";
  const adapter: IntakeAdapter = {
    name: `the tracker adapter "${adapterName}"`,
    read: "read the source issue and its comments through the tracker adapter",
    post: "post exactly one comment on the source issue through the tracker adapter",
  };
  const verdictIdentity = "the tracker identity that posts the verdict";

  if (sweep) {
    return {
      source: "github",
      sourceItem: `the source collection: the issues in ${repository} (pick the oldest issue with a trusted triage marker and no repro reply yet)`,
      sourceThread: "the chosen issue and its comments",
      verdictLocation: "exactly one comment on the chosen issue",
      adapter,
      verdictIdentity,
      operationsLocation: "the run output",
    };
  }

  const issueNumber = githubIssueNumber(event);
  const url = eventString(event, "url");
  const item =
    issueNumber === undefined
      ? `the GitHub issue named by the event${url === undefined ? "" : ` (${url})`}`
      : `GitHub issue #${issueNumber}${url === undefined ? ` in ${repository}` : ` (${url})`}`;
  return {
    source: "github",
    sourceItem: item,
    sourceThread: "that issue and its comments",
    verdictLocation: "exactly one comment on that issue",
    adapter,
    verdictIdentity,
    operationsLocation: "the run output",
  };
}

function gitlabBinding(intake: IntakeConfig, event: Record<string, unknown>, sweep: boolean): IntakeBinding {
  const adapterName = intake.trackerAdapter ?? "the configured tracker adapter";
  const project = intake.gitlabProject ?? "the configured GitLab project";
  const tokenEnv = intake.gitlabTokenEnv ?? "the configured GitLab token environment variable";
  const adapter: IntakeAdapter = {
    name: `the tracker adapter "${adapterName}" (GitLab token from ${tokenEnv})`,
    read: "read the source issue and its notes through the tracker adapter",
    post: "post exactly one comment on the source issue through the tracker adapter",
  };
  const verdictIdentity = "the tracker identity that posts the verdict";

  if (sweep) {
    return {
      source: "gitlab",
      sourceItem: `the source collection: the issues in ${project} (pick the oldest issue with a trusted triage marker and no repro reply yet)`,
      sourceThread: "the chosen issue and its notes",
      verdictLocation: "exactly one comment on the chosen issue",
      adapter,
      verdictIdentity,
      operationsLocation: "the run output",
    };
  }

  const iid = gitlabIssueIid(event);
  const url = eventString(event, "url");
  const item =
    iid === undefined
      ? `the GitLab issue named by the event${url === undefined ? "" : ` (${url})`}`
      : `GitLab issue ${project}#${iid}${url === undefined ? "" : ` (${url})`}`;
  return {
    source: "gitlab",
    sourceItem: item,
    sourceThread: "that issue and its notes",
    verdictLocation: "exactly one comment on that issue",
    adapter,
    verdictIdentity,
    operationsLocation: "the run output",
  };
}

/** Build the binding the operational file will follow for this run. */
export function buildBinding(intake: IntakeConfig, eventText: string, mode: Mode): IntakeBinding | RunnerError {
  const parsed = parseEvent(eventText);
  if ("error" in parsed) return parsed;
  const event = parsed.event;
  if (intake.source === "webhook") return webhookBinding(event);
  const sweep = mode === "reproduce" && event.sweep === true;
  if (intake.source === "slack") return slackBinding(intake, event, sweep);
  if (intake.source === "github") return githubBinding(intake, event, sweep);
  return gitlabBinding(intake, event, sweep);
}

export function resolveModel(options: RunnerOptions, configText: string): string | undefined {
  const configured = readConfigValue(configText, `models.${options.mode}`);
  if (options.model !== undefined) return options.model;
  return configured === "inherit-parent" || configured === "auto" ? undefined : configured;
}

export function buildPrompt(options: RunnerOptions, binding: IntakeBinding): string {
  const operational = join(options.repo, OPERATIONAL_FILES[options.mode]);
  const reference = join(options.repo, BINDING_REFERENCE);
  return [
    `Read and follow ${operational} for this run.`,
    `Configuration: ${options.configPath}`,
    `Event: ${options.event}`,
    `Intake binding contract: ${reference}`,
    "",
    "Intake binding:",
    `- intake: ${binding.source}`,
    `- source item: ${binding.sourceItem}`,
    `- source thread: ${binding.sourceThread}`,
    `- verdict location: ${binding.verdictLocation}`,
    `- adapter: ${binding.adapter.name}`,
    `- adapter read: ${binding.adapter.read}`,
    `- adapter post: ${binding.adapter.post}`,
    `- trusted verdict identity: ${binding.verdictIdentity}`,
    `- operations location: ${binding.operationsLocation}`,
    "",
    "Freeze the binding's source coordinates before any work. Post exactly one verdict,",
    "only at the verdict location, through the adapter. Never open a new top-level post",
    "for the report. Keep the source coordinates immutable. Fail closed when the binding,",
    "the adapter, the tracker adapter, or the verification skill is missing.",
  ].join("\n");
}

export function buildPiArgs(options: RunnerOptions, binding: IntakeBinding, model?: string): string[] {
  const args = ["-p", "--no-session"];
  if (model !== undefined) args.push("--model", model);
  args.push(buildPrompt(options, binding));
  return args;
}

export function parseArgs(argv: readonly string[]): RunnerOptions | { readonly help: true } | RunnerError {
  let mode: string | undefined;
  let configPath: string | undefined;
  let event = "{}";
  let model: string | undefined;
  let repo = process.cwd();
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    switch (arg) {
      case "--help":
      case "-h":
        return { help: true };
      case "--mode":
        mode = next();
        break;
      case "--config":
        configPath = next();
        break;
      case "--event":
        event = next() ?? "{}";
        break;
      case "--model":
        model = next();
        break;
      case "--repo":
        repo = next() ?? process.cwd();
        break;
      case "--dry-run":
        dryRun = true;
        break;
      default:
        return { error: `Unknown argument: ${String(arg)}` };
    }
  }

  if (mode !== "triage" && mode !== "reproduce") return { error: "--mode must be triage or reproduce" };
  if (configPath === undefined) return { error: "--config is required" };
  try {
    JSON.parse(event);
  } catch {
    return { error: "--event must be valid JSON" };
  }
  return { mode, configPath, event, model, repo: resolve(repo), dryRun };
}

function usage(): string {
  return "Usage: node benny-run.ts --mode <triage|reproduce> --config <path> [--event <json>] [--model <id>] [--repo <dir>] [--dry-run]";
}

export function run(options: RunnerOptions): number {
  if (!existsSync(options.configPath)) {
    process.stderr.write(`benny: config not found: ${options.configPath}\n`);
    return 2;
  }
  const config = readFileSync(options.configPath, "utf8");
  const intake = resolveIntake(config);
  if ("error" in intake) {
    process.stderr.write(`benny: ${intake.error}\n`);
    return 2;
  }

  const errors = validateIntake(intake);
  const eventError = validateEvent(options.event, options.mode, intake);
  if (eventError !== undefined) errors.push(eventError);
  if (errors.length > 0) {
    process.stderr.write(`benny: ${errors.join("; ")}\n`);
    return 2;
  }

  const binding = buildBinding(intake, options.event, options.mode);
  if ("error" in binding) {
    process.stderr.write(`benny: ${binding.error}\n`);
    return 2;
  }

  const args = buildPiArgs(options, binding, resolveModel(options, config));

  if (options.dryRun) {
    process.stdout.write(`pi ${args.map((value) => JSON.stringify(value)).join(" ")}\n`);
    return 0;
  }

  const result = spawnSync("pi", args, { cwd: options.repo, stdio: "inherit" });
  if (result.error !== undefined) {
    process.stderr.write(`benny: failed to start pi: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if ("error" in parsed) {
    process.stderr.write(`benny: ${parsed.error}\n${usage()}\n`);
    process.exit(2);
  }
  process.exit(run(parsed));
}
