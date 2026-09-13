import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "../../../skills/poteto-mode/scripts/testing/expect.ts";
import {
  BINDING_REFERENCE,
  OPERATIONAL_FILES,
  buildBinding,
  buildPiArgs,
  buildPrompt,
  namesSameItem,
  parseArgs,
  readConfigValue,
  resolveIntake,
  resolveModel,
  run,
  validateEvent,
  validateIntake,
  type IntakeBinding,
  type Mode,
  type RunnerOptions,
} from "./benny-run.ts";

const slackConfig = `schema_version: 1
slack:
  cli: "benny-slack"
  source_channel_id: "C0123"
  operations_channel_id: "C0999"
  triage_identity_user_id: "U0123"
models:
  triage: "inherit-parent"
  reproduce: "deepinfra/zai-org/GLM-5.3-Flash"
budgets:
  poll_seconds: 45
`;

const githubConfig = `schema_version: 1
intake:
  source: "github"
repository:
  url: "https://github.com/example-org/example-repo"
tracker:
  adapter: "gh issue"
models:
  triage: "inherit-parent"
  reproduce: "inherit-parent"
`;

const webhookConfig = `schema_version: 1
intake:
  source: "webhook"
models:
  triage: "inherit-parent"
  reproduce: "inherit-parent"
`;

const slackEvent = '{"channel":"C0123","ts":"1700000000.000100"}';
const githubEvent = '{"issue":123,"url":"https://github.com/example-org/example-repo/issues/123"}';
const webhookEvent = JSON.stringify({
  source_item: "SUP-1234",
  source_thread: "SUP-1234",
  verdict_location: "SUP-1234#reply",
  adapter: { read: "support-cli thread SUP-1234", post: "support-cli reply SUP-1234" },
  verdict_identity: "support-agent",
});

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

function bindingOf(configText: string, event: string, mode: Mode = "triage"): IntakeBinding {
  const intake = resolveIntake(configText);
  if ("error" in intake) throw new Error(intake.error);
  const binding = buildBinding(intake, event, mode);
  if ("error" in binding) throw new Error(binding.error);
  return binding;
}

function eventError(configText: string, event: string, mode: Mode = "triage"): string | undefined {
  const intake = resolveIntake(configText);
  if ("error" in intake) throw new Error(intake.error);
  return validateEvent(event, mode, intake);
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
  expect(slack.slackOperationsChannelId).toBe("C0999");
  expect(slack.slackTriageIdentity).toBe("U0123");

  const github = resolveIntake(githubConfig);
  if ("error" in github) throw new Error("expected github intake");
  expect(github.source).toBe("github");
  expect(github.repositoryUrl).toBe("https://github.com/example-org/example-repo");
  expect(github.trackerAdapter).toBe("gh issue");

  const declared = resolveIntake(`intake:\n  source: "github"\nslack:\n  cli: "benny-slack"\n`);
  if ("error" in declared) throw new Error("expected declared intake");
  expect(declared.source).toBe("github");

  const inferredGithub = resolveIntake(`repository:\n  url: "https://github.com/example-org/example-repo"\n`);
  if ("error" in inferredGithub) throw new Error("expected inferred github intake");
  expect(inferredGithub.source).toBe("github");

  const webhook = resolveIntake(webhookConfig);
  if ("error" in webhook) throw new Error("expected webhook intake");
  expect(webhook.source).toBe("webhook");
  expect(validateIntake(webhook)).toEqual([]);
});

it("fails closed when no intake source is configured or the value is invalid", () => {
  const none = resolveIntake("models:\n  triage: inherit-parent\n");
  expect("error" in none).toBe(true);

  const invalid = resolveIntake(`intake:\n  source: "email"\n`);
  if (!("error" in invalid)) throw new Error("expected an error");
  expect(invalid.error).toContain("slack");
  expect(invalid.error).toContain("github");
  expect(invalid.error).toContain("webhook");
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

it("requires the repository URL and the tracker adapter for the GitHub intake", () => {
  const missing = resolveIntake(`intake:\n  source: "github"\n`);
  if ("error" in missing) throw new Error("expected github intake");
  expect(validateIntake(missing)).toContain("repository.url is required for the GitHub intake");
  expect(validateIntake(missing)).toContain("tracker.adapter is required for the GitHub intake");

  const complete = resolveIntake(githubConfig);
  if ("error" in complete) throw new Error("expected github intake");
  expect(validateIntake(complete)).toEqual([]);
});

it("validates the Slack event coordinates", () => {
  expect(eventError(slackConfig, slackEvent)).toBeUndefined();
  expect(eventError(slackConfig, '{"channel":"C0123","ts":"1.2","thread_ts":"1.0"}')).toBeUndefined();
  expect(eventError(slackConfig, "{}")).toContain("event.channel");
  expect(eventError(slackConfig, '{"channel":"C0123"}')).toContain("event.ts");
  expect(eventError(slackConfig, '{"channel":"C0123","ts":"1.2","thread_ts":7}')).toContain("thread_ts");
  expect(eventError(slackConfig, '{"sweep":true}', "reproduce")).toBeUndefined();
});

it("fails closed when the Slack event channel differs from the configured source channel", () => {
  expect(eventError(slackConfig, '{"channel":"C9999","ts":"1.2"}')).toContain("must match");
  expect(eventError(slackConfig, '{"channel":"C0123","ts":"1.2"}')).toBeUndefined();
});

it("validates the GitHub event coordinates", () => {
  expect(eventError(githubConfig, githubEvent)).toBeUndefined();
  expect(eventError(githubConfig, '{"issue":"123"}')).toBeUndefined();
  expect(eventError(githubConfig, '{"url":"https://github.com/example-org/example-repo/issues/123"}')).toBeUndefined();
  expect(eventError(githubConfig, '{"sweep":true}', "reproduce")).toBeUndefined();
  expect(eventError(githubConfig, "{}")).toContain("event.issue");
  expect(eventError(githubConfig, '{"issue":0}')).toContain("event.issue");
  expect(eventError(githubConfig, '{"issue":123,"url":"https://github.com/example-org/example-repo/issues/124"}')).toContain(
    "same issue",
  );
  expect(eventError(githubConfig, "not-json")).toContain("valid JSON");
  expect(eventError(githubConfig, "[]")).toContain("JSON object");
});

it("names the source item, source thread, verdict location, and adapter for the Slack intake", () => {
  const binding = bindingOf(slackConfig, slackEvent);
  expect(binding.source).toBe("slack");
  expect(binding.sourceItem).toContain("channel C0123");
  expect(binding.sourceItem).toContain("ts 1700000000.000100");
  expect(binding.sourceThread).toContain("thread_ts 1700000000.000100");
  expect(binding.verdictLocation).toContain("exactly one reply in that thread");
  expect(binding.verdictLocation).toContain("thread_ts 1700000000.000100");
  expect(binding.adapter.name).toBe("Slack CLI benny-slack");
  expect(binding.adapter.read).toBe("benny-slack thread C0123 1700000000.000100");
  expect(binding.adapter.post).toBe("benny-slack post C0123 1700000000.000100 <text>");
  expect(binding.verdictIdentity).toBe("U0123");
  expect(binding.operationsLocation).toContain("C0999");

  const reply = bindingOf(slackConfig, '{"channel":"C0123","ts":"1.2","thread_ts":"1.0"}');
  expect(reply.sourceThread).toContain("thread_ts 1.0");
  expect(reply.adapter.read).toBe("benny-slack thread C0123 1.0");
  expect(reply.adapter.post).toBe("benny-slack post C0123 1.0 <text>");
});

it("names the source item, source thread, verdict location, and adapter for the GitHub intake", () => {
  const binding = bindingOf(githubConfig, githubEvent);
  expect(binding.source).toBe("github");
  expect(binding.sourceItem).toContain("GitHub issue #123");
  expect(binding.sourceItem).toContain("https://github.com/example-org/example-repo/issues/123");
  expect(binding.sourceThread).toContain("issue and its comments");
  expect(binding.verdictLocation).toBe("exactly one comment on that issue");
  expect(binding.adapter.name).toContain("gh issue");
  expect(binding.adapter.read).toContain("tracker adapter");
  expect(binding.adapter.post).toContain("exactly one comment");
  expect(binding.verdictIdentity).toContain("tracker identity");
  expect(binding.operationsLocation).toBe("the run output");
});

it("builds the webhook binding from the event and defaults the thread and the identity", () => {
  const binding = bindingOf(webhookConfig, webhookEvent);
  expect(binding.source).toBe("webhook");
  expect(binding.sourceItem).toBe("SUP-1234");
  expect(binding.sourceThread).toBe("SUP-1234");
  expect(binding.verdictLocation).toBe("SUP-1234#reply");
  expect(binding.adapter.read).toBe("support-cli thread SUP-1234");
  expect(binding.adapter.post).toBe("support-cli reply SUP-1234");
  expect(binding.verdictIdentity).toBe("support-agent");
  expect(binding.operationsLocation).toBe("the run output");

  const minimal = bindingOf(
    webhookConfig,
    '{"source_item":"SUP-1","verdict_location":"SUP-1/reply","adapter":{"read":"r","post":"p"}}',
  );
  expect(minimal.sourceThread).toBe("SUP-1");
  expect(minimal.verdictIdentity).toBe("the identity the adapter posts as");
});

it("validates the webhook payload fail-closed", () => {
  expect(eventError(webhookConfig, webhookEvent)).toBeUndefined();

  const cases: Array<[string, string]> = [
    ['{"verdict_location":"SUP-1234#reply","adapter":{"read":"r","post":"p"}}', "source_item"],
    ['{"source_item":"","verdict_location":"SUP-1234#reply","adapter":{"read":"r","post":"p"}}', "source_item"],
    ['{"source_item":"SUP-1234","adapter":{"read":"r","post":"p"}}', "verdict_location"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply"}', "adapter"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":"support-cli"}', "adapter"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"post":"p"}}', "adapter.read"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"read":"r"}}', "adapter.post"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-9999#reply","adapter":{"read":"r","post":"p"}}', "same item"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"read":"r","post":"p"},"source_thread":7}', "source_thread"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"read":"r","post":"p"},"verdict_identity":""}', "verdict_identity"],
    ['{"source_item":"SUP-1234","verdict_location":"SUP-1234#reply","adapter":{"read":"r\\nrm -rf /","post":"p"}}', "single line"],
    ["not-json", "valid JSON"],
    ["[]", "JSON object"],
  ];
  for (const [event, message] of cases) {
    const error = eventError(webhookConfig, event);
    expect(error).toBeDefined();
    expect(error ?? "").toContain(message);
  }
});

it("matches the verdict location to the source item as a whole token", () => {
  expect(namesSameItem("SUP-1234#reply", "SUP-1234")).toBe(true);
  expect(namesSameItem("https://example.com/reports/123#comment", "https://example.com/reports/123")).toBe(true);
  expect(namesSameItem("report-123", "123")).toBe(true);
  expect(namesSameItem("SUP-12345#reply", "SUP-1234")).toBe(false);
  expect(namesSameItem("report-1234", "123")).toBe(false);
  expect(namesSameItem("", "123")).toBe(false);
});

it("rejects a sweep for the webhook intake and keeps the sweep binding for the configured intakes", () => {
  expect(eventError(webhookConfig, '{"sweep":true}', "reproduce")).toContain("cannot sweep");
  expect(eventError(slackConfig, '{"sweep":true}', "reproduce")).toBeUndefined();
  expect(eventError(githubConfig, '{"sweep":true}', "reproduce")).toBeUndefined();

  const slackSweep = bindingOf(slackConfig, '{"sweep":true}', "reproduce");
  expect(slackSweep.sourceItem).toContain("oldest report");
  expect(slackSweep.sourceItem).toContain("C0123");
  expect(slackSweep.adapter.name).toBe("Slack CLI benny-slack");

  const githubSweep = bindingOf(githubConfig, '{"sweep":true}', "reproduce");
  expect(githubSweep.sourceItem).toContain("oldest issue");
  expect(githubSweep.verdictLocation).toBe("exactly one comment on the chosen issue");
  expect(githubSweep.adapter.name).toContain("gh issue");
});

it("builds a prompt that names the operational file, the event, and the binding", () => {
  const options: RunnerOptions = {
    mode: "reproduce",
    configPath: ".pi/benny/configuration.yaml",
    event: slackEvent,
    repo: "/repo",
    dryRun: true,
  };
  const prompt = buildPrompt(options, bindingOf(slackConfig, slackEvent, "reproduce"));
  expect(prompt).toContain(join("/repo", OPERATIONAL_FILES.reproduce));
  expect(prompt).toContain(join("/repo", BINDING_REFERENCE));
  expect(prompt).toContain("Configuration: .pi/benny/configuration.yaml");
  expect(prompt).toContain(`Event: ${slackEvent}`);
  expect(prompt).toContain("- intake: slack");
  expect(prompt).toContain("- source item: the Slack report message in channel C0123");
  expect(prompt).toContain("- verdict location: exactly one reply in that thread");
  expect(prompt).toContain("- adapter read: benny-slack thread C0123 1700000000.000100");
  expect(prompt).toContain("- adapter post: benny-slack post C0123 1700000000.000100 <text>");
  expect(prompt).toContain("Never open a new top-level post");
  expect(prompt).toContain("Fail closed");
});

it("builds a GitHub prompt that names the tracker adapter and never mentions Slack", () => {
  const options: RunnerOptions = {
    mode: "triage",
    configPath: ".pi/benny/configuration.yaml",
    event: githubEvent,
    repo: "/repo",
    dryRun: true,
  };
  const prompt = buildPrompt(options, bindingOf(githubConfig, githubEvent));
  expect(prompt).toContain(join("/repo", OPERATIONAL_FILES.triage));
  expect(prompt).toContain("- intake: github");
  expect(prompt).toContain("- source item: GitHub issue #123");
  expect(prompt).toContain('- adapter: the tracker adapter "gh issue"');
  expect(prompt).toContain("- verdict location: exactly one comment on that issue");
  expect(prompt).not.toContain("Slack");
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
  expect(stdout).toContain("- intake: slack");
  expect(stdout).not.toContain("--model");
});

it("runs the GitHub path with no Slack configured and prints a usable command", () => {
  const configPath = tempConfig(githubConfig);
  const { code, stdout, stderr } = captureOutput(() =>
    run({ mode: "triage", configPath, event: githubEvent, repo: dirname(configPath), dryRun: true }),
  );

  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain('pi "-p" "--no-session"');
  expect(stdout).toContain(OPERATIONAL_FILES.triage);
  expect(stdout).toContain("- intake: github");
  expect(stdout).toContain("- adapter: the tracker adapter");
  expect(stdout).toContain("gh issue");
  expect(stdout).not.toContain("Slack");
  expect(stdout).not.toContain("--model");
});

it("runs the webhook path in dry-run mode from the event binding", () => {
  const configPath = tempConfig(webhookConfig);
  const { code, stdout, stderr } = captureOutput(() =>
    run({ mode: "triage", configPath, event: webhookEvent, repo: dirname(configPath), dryRun: true }),
  );

  expect(stderr).toBe("");
  expect(code).toBe(0);
  expect(stdout).toContain("Intake binding:");
  expect(stdout).toContain("- intake: webhook");
  expect(stdout).toContain("- source item: SUP-1234");
  expect(stdout).toContain("- verdict location: SUP-1234#reply");
  expect(stdout).toContain("support-cli thread SUP-1234");
  expect(stdout).toContain("support-cli reply SUP-1234");
  expect(stdout).not.toContain("--model");
});

it("fails closed through the runner for the webhook intake", () => {
  const configPath = tempConfig(webhookConfig);

  const mismatch = captureOutput(() =>
    run({
      mode: "triage",
      configPath,
      event: '{"source_item":"SUP-1","verdict_location":"SUP-2#reply","adapter":{"read":"r","post":"p"}}',
      repo: "/tmp",
      dryRun: true,
    }),
  );
  expect(mismatch.code).toBe(2);
  expect(mismatch.stderr).toContain("same item");

  const noAdapter = captureOutput(() =>
    run({
      mode: "triage",
      configPath,
      event: '{"source_item":"SUP-1","verdict_location":"SUP-1#reply","adapter":{"post":"p"}}',
      repo: "/tmp",
      dryRun: true,
    }),
  );
  expect(noAdapter.code).toBe(2);
  expect(noAdapter.stderr).toContain("adapter.read");

  const sweep = captureOutput(() =>
    run({ mode: "reproduce", configPath, event: '{"sweep":true}', repo: "/tmp", dryRun: true }),
  );
  expect(sweep.code).toBe(2);
  expect(sweep.stderr).toContain("cannot sweep");
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

  const noTracker = captureOutput(() =>
    run({
      mode: "triage",
      configPath: tempConfig(`intake:\n  source: "github"\nrepository:\n  url: "https://github.com/example-org/example-repo"\n`),
      event: githubEvent,
      repo: "/tmp",
      dryRun: true,
    }),
  );
  expect(noTracker.code).toBe(2);
  expect(noTracker.stderr).toContain("tracker.adapter is required");

  const badEvent = captureOutput(() =>
    run({ mode: "triage", configPath: tempConfig(slackConfig), event: "{}", repo: "/tmp", dryRun: true }),
  );
  expect(badEvent.code).toBe(2);
  expect(badEvent.stderr).toContain("event.channel");

  const wrongChannel = captureOutput(() =>
    run({
      mode: "triage",
      configPath: tempConfig(slackConfig),
      event: '{"channel":"C9999","ts":"1.2"}',
      repo: "/tmp",
      dryRun: true,
    }),
  );
  expect(wrongChannel.code).toBe(2);
  expect(wrongChannel.stderr).toContain("must match");
});

it("ships an example configuration that validates for the Slack path", () => {
  const examplePath = join(packRoot, "templates", "configuration.example.yaml");
  const text = readFileSync(examplePath, "utf8");
  const intake = resolveIntake(text);
  if ("error" in intake) throw new Error(intake.error);
  expect(intake.source).toBe("slack");
  expect(validateIntake(intake)).toEqual([]);
  expect(eventError(text, '{"channel":"SOURCE_CHANNEL_ID","ts":"1700000000.000100"}')).toBeUndefined();
});

it("builds the pi argument list in a stable order", () => {
  const options: RunnerOptions = {
    mode: "triage",
    configPath: "configuration.yaml",
    event: githubEvent,
    repo: "/repo",
    dryRun: true,
  };
  const args = buildPiArgs(options, bindingOf(githubConfig, githubEvent), "provider/model");
  expect(args[0]).toBe("-p");
  expect(args[1]).toBe("--no-session");
  expect(args[2]).toBe("--model");
  expect(args[3]).toBe("provider/model");
  expect(args).toHaveLength(5);
});

it("emits identical safety rules for every intake and per-intake binding lines", () => {
  const options: RunnerOptions = {
    mode: "triage",
    configPath: ".pi/benny/configuration.yaml",
    event: slackEvent,
    repo: "/repo",
    dryRun: true,
  };
  const prompts = [
    buildPrompt(options, bindingOf(slackConfig, slackEvent)),
    buildPrompt(options, bindingOf(githubConfig, githubEvent)),
    buildPrompt(options, bindingOf(webhookConfig, webhookEvent)),
  ];

  const safetyLines = (prompt: string): string[] => prompt.split("\n").slice(-4);
  const [slackSafety, githubSafety, webhookSafety] = prompts.map(safetyLines);
  expect(slackSafety).toEqual(githubSafety);
  expect(githubSafety).toEqual(webhookSafety);

  const bindingLines = (prompt: string): string[] => prompt.split("\n").filter((line) => line.startsWith("- "));
  const [slack, github, webhook] = prompts.map(bindingLines);
  expect(slack).not.toEqual(github);
  expect(github).not.toEqual(webhook);
  expect(slack).not.toEqual(webhook);
});
