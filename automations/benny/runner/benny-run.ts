#!/usr/bin/env node
/**
 * Local runner for the Benny automations.
 *
 * Benny is two headless pi jobs: one triages a report, one reproduces and
 * optionally fixes a confirmed bug. This runner builds the same prompt the
 * GitHub Actions workflows build and either prints or executes the `pi`
 * invocation. The operational instructions live in the pack's SKILL.md files;
 * this file only resolves the config, the model, the intake source, and the
 * event coordinates.
 *
 * The intake is opt-in. A config with `slack.cli` (or `intake.source: slack`)
 * uses the repository's Slack CLI. A config with no Slack section (or
 * `intake.source: github`) uses the GitHub issue or CLI path instead, so a
 * user who does not use Slack can install and run Benny without it.
 *
 * Usage:
 *   node benny-run.ts --mode triage --config .pi/benny/configuration.yaml \
 *     --event '{"channel":"C0123","ts":"1700000000.000100"}'
 *   node benny-run.ts --mode triage --config .pi/benny/configuration.yaml \
 *     --event '{"issue":123,"url":"https://github.com/org/repo/issues/123"}'
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
export type IntakeSource = "slack" | "github";

export const OPERATIONAL_FILES: Readonly<Record<Mode, string>> = {
  triage: ".pi/automations/benny/skills/triage-issue-reports/SKILL.md",
  reproduce: ".pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md",
};

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
  readonly repositoryUrl?: string;
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
 * Resolve the intake source. `intake.source` wins when present; otherwise the
 * configured section decides, so existing Slack configs keep working and a
 * config without `slack.cli` falls through to the GitHub path.
 */
export function resolveIntake(text: string): IntakeConfig | { readonly error: string } {
  const declared = readConfigValue(text, "intake.source");
  const slackCli = readConfigValue(text, "slack.cli");
  const slackSourceChannelId = readConfigValue(text, "slack.source_channel_id");
  const repositoryUrl = readConfigValue(text, "repository.url");
  const slackSection = hasConfigSection(text, "slack");
  const repositorySection = hasConfigSection(text, "repository");

  if (declared !== undefined && declared !== "slack" && declared !== "github") {
    return { error: `intake.source must be "slack" or "github", got "${declared}"` };
  }
  if (declared === undefined && slackCli === undefined && repositoryUrl === undefined && !slackSection && !repositorySection) {
    return { error: "no intake source: set intake.source, or configure slack.cli (Slack) or repository.url (GitHub)" };
  }

  const source: IntakeSource = declared ?? (slackCli !== undefined || slackSection ? "slack" : "github");
  return { source, slackCli, slackSourceChannelId, repositoryUrl };
}

/** Fail-closed checks for the inputs a run needs. Credentials live with the CLI. */
export function validateIntake(intake: IntakeConfig): string[] {
  if (intake.source === "slack") {
    const errors: string[] = [];
    if (intake.slackCli === undefined) errors.push("slack.cli is required for the Slack intake");
    if (intake.slackSourceChannelId === undefined) errors.push("slack.source_channel_id is required for the Slack intake");
    return errors;
  }
  return intake.repositoryUrl === undefined ? ["repository.url is required for the GitHub intake"] : [];
}

/** Check the trigger payload against the mode and the configured intake. */
export function validateEvent(eventText: string, mode: Mode, source: IntakeSource): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(eventText);
  } catch {
    return "--event must be valid JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return "--event must be a JSON object";
  }
  const event = parsed as Record<string, unknown>;
  if (mode === "reproduce" && event.sweep === true) return undefined;

  if (source === "slack") {
    if (typeof event.channel !== "string" || event.channel === "") {
      return "event.channel is required for the Slack intake";
    }
    if (typeof event.ts !== "string" || event.ts === "") {
      return "event.ts is required for the Slack intake";
    }
    if (event.thread_ts !== undefined && typeof event.thread_ts !== "string") {
      return "event.thread_ts must be a string when present";
    }
    return undefined;
  }

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

export function resolveModel(options: RunnerOptions, configText: string): string | undefined {
  const configured = readConfigValue(configText, `models.${options.mode}`);
  if (options.model !== undefined) return options.model;
  return configured === "inherit-parent" || configured === "auto" ? undefined : configured;
}

export function buildPrompt(options: RunnerOptions, intake: IntakeConfig | IntakeSource = "slack"): string {
  const config: IntakeConfig = typeof intake === "string" ? { source: intake } : intake;
  const operational = join(options.repo, OPERATIONAL_FILES[options.mode]);
  const header = [
    `Read and follow ${operational} for this run.`,
    `Configuration: ${options.configPath}`,
    `Event: ${options.event}`,
    `Intake: ${config.source === "slack" ? "Slack" : "GitHub issues"}.`,
  ];
  if (config.source === "slack") {
    return [
      ...header,
      `Slack CLI: ${config.slackCli ?? "the configured slack.cli"}.`,
      "Freeze the source channel and root thread from the event and post the single verdict only as a reply in that thread.",
      "",
      "Apply the pack's hard safety rules: never post a root message in the source",
      "channel, keep the source coordinates immutable, and fail closed when the",
      "configuration, Slack CLI, tracker adapter, or verification skill is missing.",
    ].join("\n");
  }
  return [
    ...header,
    "No Slack CLI is configured. Do not call Slack or any Slack API. Treat the issue",
    "named by the event as the source thread, post the single verdict as a comment on",
    "that issue through the configured tracker adapter, and never open a new issue for it.",
    "Intake adapter: where the operational file names a Slack source channel or thread,",
    "read the GitHub issue and its comments; where it names a thread reply or a Slack",
    "verdict post, post one issue comment; where it names an operations channel or",
    "thread, keep detailed status in the run output. Ignore the Slack CLI fail-closed",
    "check: this intake has no Slack CLI. The tracker identity that posts the verdict",
    "is the trusted triage identity for marker checks.",
    "",
    "Apply the pack's hard safety rules: keep the source issue coordinates immutable",
    "and fail closed when the configuration, tracker adapter, or verification skill is missing.",
  ].join("\n");
}

export function buildPiArgs(options: RunnerOptions, intake: IntakeConfig, model?: string): string[] {
  const args = ["-p", "--no-session"];
  if (model !== undefined) args.push("--model", model);
  args.push(buildPrompt(options, intake));
  return args;
}

export function parseArgs(argv: readonly string[]): RunnerOptions | { readonly help: true } | { readonly error: string } {
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
  const eventError = validateEvent(options.event, options.mode, intake.source);
  if (eventError !== undefined) errors.push(eventError);
  if (errors.length > 0) {
    process.stderr.write(`benny: ${errors.join("; ")}\n`);
    return 2;
  }

  const args = buildPiArgs(options, intake, resolveModel(options, config));

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
