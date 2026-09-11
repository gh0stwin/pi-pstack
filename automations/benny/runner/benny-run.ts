#!/usr/bin/env node
/**
 * Local runner for the Benny automations.
 *
 * Benny is two headless pi jobs: one triages a Slack report, one reproduces and
 * optionally fixes a confirmed bug. This runner builds the same prompt the
 * GitHub Actions workflows build and either prints or executes the `pi`
 * invocation. The operational instructions live in the pack's SKILL.md files;
 * this file only resolves the config, the model, and the event coordinates.
 *
 * Usage:
 *   node benny-run.ts --mode triage --config .pi/benny/configuration.yaml \
 *     --event '{"channel":"C0123","ts":"1700000000.000100"}'
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

export function buildPrompt(options: RunnerOptions): string {
  const operational = join(options.repo, OPERATIONAL_FILES[options.mode]);
  return [
    `Read and follow ${operational} for this run.`,
    `Configuration: ${options.configPath}`,
    `Event: ${options.event}`,
    "",
    "Apply the pack's hard safety rules: never post a root message in the source",
    "channel, keep the source coordinates immutable, and fail closed when the",
    "configuration, Slack CLI, tracker adapter, or verification skill is missing.",
  ].join("\n");
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
  const configured = readConfigValue(config, `models.${options.mode}`);
  const model = options.model ?? (configured === "inherit-parent" || configured === "auto" ? undefined : configured);

  const args = ["-p", "--no-session"];
  if (model !== undefined) args.push("--model", model);
  args.push(buildPrompt(options));

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
