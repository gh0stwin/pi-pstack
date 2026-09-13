import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "../../../skills/poteto-mode/scripts/testing/expect.ts";
import {
  OPERATIONAL_FILES,
  buildPiArgs,
  buildPrompt,
  parseArgs,
  readConfigValue,
  resolveIntake,
  resolveModel,
  run,
  validateEvent,
  validateIntake,
  type RunnerOptions,
} from "./benny-run.ts";

const slackConfig = `schema_version: 1
slack:
  cli: "benny-slack"
  source_channel_id: "C0123"
models:
  triage: "inherit-parent"
  reproduce: "deepinfra/zai-org/GLM-5.3-Flash"
budgets:
  poll_seconds: 45
`;

const noSlackConfig = `schema_version: 1
intake:
  source: "github"
repository:
  url: "https://github.com/example-org/example-repo"
models:
  triage: "inherit-parent"
  reproduce: "inherit-parent"
`;

const slackEvent = '{"channel":"C0123","ts":"1700000000.000100"}';
const githubEvent = '{"issue":123,"url":"https://github.com/example-org/example-repo/issues/123"}';

function tempConfig(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), "benny-runner-"));
  const path = join(directory, "configuration.yaml");
  writeFileSync(path, text);
  return path;
}

function captureOutput(fn: () => number): { code: number; stdout: string; stderr: string } {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: fn(), stdout, stderr };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

it("reads a two-level config value by indentation", () => {
  expect(readConfigValue(slackConfig, "models.reproduce")).toBe("deepinfra/zai-org/GLM-5.3-Flash");
  expect(readConfigValue(slackConfig, "slack.cli")).toBe("benny-slack");
  expect(readConfigValue(slackConfig, "models.triage")).toBe("inherit-parent");
  expect(readConfigValue(slackConfig, "slack.missing")).toBeUndefined();
  expect(readConfigValue(slackConfig, "missing.key")).toBeUndefined();
});

it("ignores commented keys and blank values", () => {
  const text = "slack:\n  cli: \"benny-slack\" # inline\n  token:\n";
  expect(readConfigValue(text, "slack.cli")).toBe("benny-slack");
  expect(readConfigValue(text, "slack.token")).toBeUndefined();
});

it("parses a valid invocation", () => {
  const parsed = parseArgs([
    "--mode",
    "triage",
    "--config",
    ".pi/benny/configuration.yaml",
    "--event",
    slackEvent,
    "--dry-run",
  ]);
  if ("error" in parsed || "help" in parsed) throw new Error("expected options");
  expect(parsed.mode).toBe("triage");
  expect(parsed.configPath).toBe(".pi/benny/configuration.yaml");
  expect(parsed.dryRun).toBe(true);
});

it("rejects a missing mode, a missing config, and invalid event JSON", () => {
  const noMode = parseArgs(["--config", "c.yaml"]);
  expect("error" in noMode).toBe(true);
  const noConfig = parseArgs(["--mode", "triage"]);
  expect("error" in noConfig).toBe(true);
  const badEvent = parseArgs(["--mode", "triage", "--config", "c.yaml", "--event", "not-json"]);
  expect("error" in badEvent).toBe(true);
});

it("resolves the intake from the declared source or the configured section", () => {
  const slack = resolveIntake(slackConfig);
  if ("error" in slack) throw new Error("expected slack intake");
  expect(slack.source).toBe("slack");
  expect(slack.slackCli).toBe("benny-slack");
  expect(slack.slackSourceChannelId).toBe("C0123");

  const github = resolveIntake(noSlackConfig);
  if ("error" in github) throw new Error("expected github intake");
  expect(github.source).toBe("github");
  expect(github.repositoryUrl).toBe("https://github.com/example-org/example-repo");

  const declared = resolveIntake(`intake:\n  source: "github"\nslack:\n  cli: "benny-slack"\n`);
  if ("error" in declared) throw new Error("expected declared intake");
  expect(declared.source).toBe("github");

  const inferredGithub = resolveIntake(`repository:\n  url: "https://github.com/example-org/example-repo"\n`);
  if ("error" in inferredGithub) throw new Error("expected inferred github intake");
  expect(inferredGithub.source).toBe("github");
});

it("fails closed when no intake source is configured or the value is invalid", () => {
  const none = resolveIntake("models:\n  triage: inherit-parent\n");
  expect("error" in none).toBe(true);

  const invalid = resolveIntake(`intake:\n  source: "email"\n`);
  if (!("error" in invalid)) throw new Error("expected an error");
  expect(invalid.error).toContain("slack");
  expect(invalid.error).toContain("github");
});

it("requires the Slack CLI and source channel for the Slack intake", () => {
  const missingCli = resolveIntake(`slack:\n  source_channel_id: "C0123"\n`);
  if ("error" in missingCli) throw new Error("expected slack intake");
  expect(validateIntake(missingCli)).toContain("slack.cli is required for the Slack intake");

  const missingChannel = resolveIntake(`slack:\n  cli: "benny-slack"\n`);
  if ("error" in missingChannel) throw new Error("expected slack intake");
  expect(validateIntake(missingChannel)).toContain("slack.source_channel_id is required for the Slack intake");

  const complete = resolveIntake(slackConfig);
  if ("error" in complete) throw new Error("expected slack intake");
  expect(validateIntake(complete)).toEqual([]);
});

it("requires the repository URL for the GitHub intake", () => {
  const missing = resolveIntake(`intake:\n  source: "github"\n`);
  if ("error" in missing) throw new Error("expected github intake");
  expect(validateIntake(missing)).toContain("repository.url is required for the GitHub intake");
});

it("validates the Slack event coordinates", () => {
  expect(validateEvent(slackEvent, "triage", "slack")).toBeUndefined();
  expect(validateEvent('{"channel":"C0123","ts":"1.2","thread_ts":"1.0"}', "triage", "slack")).toBeUndefined();
  expect(validateEvent("{}", "triage", "slack")).toContain("event.channel");
  expect(validateEvent('{"channel":"C0123"}', "triage", "slack")).toContain("event.ts");
  expect(validateEvent('{"channel":"C0123","ts":"1.2","thread_ts":7}', "triage", "slack")).toContain("thread_ts");
  expect(validateEvent('{"sweep":true}', "reproduce", "slack")).toBeUndefined();
});

it("validates the GitHub event coordinates", () => {
  expect(validateEvent(githubEvent, "triage", "github")).toBeUndefined();
  expect(validateEvent('{"issue":"123"}', "triage", "github")).toBeUndefined();
  expect(validateEvent('{"url":"https://github.com/example-org/example-repo/issues/123"}', "triage", "github")).toBeUndefined();
  expect(validateEvent('{"sweep":true}', "reproduce", "github")).toBeUndefined();
  expect(validateEvent("{}", "triage", "github")).toContain("event.issue");
  expect(validateEvent('{"issue":0}', "triage", "github")).toContain("event.issue");
  expect(validateEvent('{"issue":123,"url":"https://github.com/example-org/example-repo/issues/124"}', "triage", "github")).toContain(
    "same issue",
  );
  expect(validateEvent("not-json", "triage", "github")).toContain("valid JSON");
  expect(validateEvent("[]", "triage", "github")).toContain("JSON object");
});

it("builds a prompt that names the operational file and the event", () => {
  const options: RunnerOptions = {
    mode: "reproduce",
    configPath: ".pi/benny/configuration.yaml",
    event: slackEvent,
    repo: "/repo",
    dryRun: true,
  };
  const prompt = buildPrompt(options, { source: "slack", slackCli: "benny-slack", slackSourceChannelId: "C0123" });
  expect(prompt).toContain(join("/repo", OPERATIONAL_FILES.reproduce));
  expect(prompt).toContain("Configuration: .pi/benny/configuration.yaml");
  expect(prompt).toContain(`Event: ${slackEvent}`);
  expect(prompt).toContain("Intake: Slack");
  expect(prompt).toContain("Slack CLI: benny-slack");
  expect(prompt).toContain("post the single verdict only as a reply");
  expect(prompt).toContain("fail closed");
});

it("builds a GitHub prompt that forbids Slack when no Slack CLI is configured", () => {
  const options: RunnerOptions = {
    mode: "triage",
    configPath: ".pi/benny/configuration.yaml",
    event: githubEvent,
    repo: "/repo",
    dryRun: true,
  };
  const prompt = buildPrompt(options, { source: "github", repositoryUrl: "https://github.com/example-org/example-repo" });
  expect(prompt).toContain(join("/repo", OPERATIONAL_FILES.triage));
  expect(prompt).toContain("Intake: GitHub issues");
  expect(prompt).toContain("No Slack CLI is configured");
  expect(prompt).toContain("Do not call Slack or any Slack API");
  expect(prompt).toContain("comment");
  expect(prompt).not.toContain("Slack CLI:");
});

it("prints the pi command in dry-run mode without starting pi", () => {
  const configPath = tempConfig(slackConfig);
  const { code, stdout } = captureOutput(() =>
    run({ mode: "triage", configPath, event: slackEvent, repo: dirname(configPath), dryRun: true }),
  );

  expect(code).toBe(0);
  expect(stdout).toContain("pi ");
  expect(stdout).toContain("--no-session");
  expect(stdout).toContain(OPERATIONAL_FILES.triage);
  expect(stdout).not.toContain("--model");
});

it("runs the optional path with no Slack configured and prints a usable command", () => {
  const configPath = tempConfig(noSlackConfig);
  const { code, stdout, stderr } = captureOutput(() =>
    run({ mode: "triage", configPath, event: githubEvent, repo: dirname(configPath), dryRun: true }),
  );

  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain('pi "-p" "--no-session"');
  expect(stdout).toContain(OPERATIONAL_FILES.triage);
  expect(stdout).toContain("Intake: GitHub issues");
  expect(stdout).toContain("Do not call Slack or any Slack API");
  expect(stdout).not.toContain("--model");
});

it("uses the configured model and the CLI override", () => {
  const configPath = tempConfig(slackConfig);
  const configured = captureOutput(() =>
    run({ mode: "reproduce", configPath, event: slackEvent, repo: dirname(configPath), dryRun: true }),
  );
  expect(configured.code).toBe(0);
  expect(configured.stdout).toContain('"deepinfra/zai-org/GLM-5.3-Flash"');

  const overridden = captureOutput(() =>
    run({ mode: "reproduce", configPath, event: slackEvent, model: "provider/override", repo: dirname(configPath), dryRun: true }),
  );
  expect(overridden.code).toBe(0);
  expect(overridden.stdout).toContain('"provider/override"');
  expect(overridden.stdout).not.toContain("GLM-5.3-Flash");

  const options: RunnerOptions = {
    mode: "reproduce",
    configPath,
    event: slackEvent,
    repo: dirname(configPath),
    dryRun: true,
  };
  expect(resolveModel(options, slackConfig)).toBe("deepinfra/zai-org/GLM-5.3-Flash");
  expect(resolveModel({ ...options, model: "provider/override" }, slackConfig)).toBe("provider/override");
  expect(resolveModel({ ...options, mode: "triage" }, slackConfig)).toBeUndefined();
});

it("fails closed when the config is missing, incomplete, or the event is malformed", () => {
  const missing = captureOutput(() =>
    run({ mode: "triage", configPath: "/nonexistent/configuration.yaml", event: slackEvent, repo: "/tmp", dryRun: true }),
  );
  expect(missing.code).toBe(2);
  expect(missing.stderr).toContain("config not found");

  const noCli = captureOutput(() =>
    run({ mode: "triage", configPath: tempConfig(`slack:\n  source_channel_id: "C0123"\n`), event: slackEvent, repo: "/tmp", dryRun: true }),
  );
  expect(noCli.code).toBe(2);
  expect(noCli.stderr).toContain("slack.cli is required");

  const noChannel = captureOutput(() =>
    run({ mode: "triage", configPath: tempConfig(`slack:\n  cli: "benny-slack"\n`), event: slackEvent, repo: "/tmp", dryRun: true }),
  );
  expect(noChannel.code).toBe(2);
  expect(noChannel.stderr).toContain("slack.source_channel_id is required");

  const badEvent = captureOutput(() =>
    run({ mode: "triage", configPath: tempConfig(slackConfig), event: "{}", repo: "/tmp", dryRun: true }),
  );
  expect(badEvent.code).toBe(2);
  expect(badEvent.stderr).toContain("event.channel");
});

it("ships an example configuration that validates for the Slack path", () => {
  const examplePath = join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "configuration.example.yaml");
  const text = readFileSync(examplePath, "utf8");
  const intake = resolveIntake(text);
  if ("error" in intake) throw new Error(intake.error);
  expect(intake.source).toBe("slack");
  expect(validateIntake(intake)).toEqual([]);
  expect(validateEvent(slackEvent, "triage", intake.source)).toBeUndefined();
});

it("builds the pi argument list in a stable order", () => {
  const options: RunnerOptions = {
    mode: "triage",
    configPath: "configuration.yaml",
    event: githubEvent,
    repo: "/repo",
    dryRun: true,
  };
  const args = buildPiArgs(options, { source: "github", repositoryUrl: "https://github.com/example-org/example-repo" }, "provider/model");
  expect(args[0]).toBe("-p");
  expect(args[1]).toBe("--no-session");
  expect(args[2]).toBe("--model");
  expect(args[3]).toBe("provider/model");
  expect(args).toHaveLength(5);
});
