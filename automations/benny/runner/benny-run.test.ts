import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "../../../skills/poteto-mode/scripts/testing/expect.ts";
import {
  OPERATIONAL_FILES,
  buildPrompt,
  parseArgs,
  readConfigValue,
  run,
  type RunnerOptions,
} from "./benny-run.ts";

const config = `schema_version: 1
slack:
  cli: "benny-slack"
  source_channel_id: "C0123"
models:
  triage: "inherit-parent"
  reproduce: "deepinfra/zai-org/GLM-5.3-Flash"
budgets:
  poll_seconds: 45
`;

it("reads a two-level config value by indentation", () => {
  expect(readConfigValue(config, "models.reproduce")).toBe("deepinfra/zai-org/GLM-5.3-Flash");
  expect(readConfigValue(config, "slack.cli")).toBe("benny-slack");
  expect(readConfigValue(config, "models.triage")).toBe("inherit-parent");
  expect(readConfigValue(config, "slack.missing")).toBeUndefined();
  expect(readConfigValue(config, "missing.key")).toBeUndefined();
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
    '{"channel":"C0123","ts":"1.2"}',
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

it("builds a prompt that names the operational file and the event", () => {
  const options: RunnerOptions = {
    mode: "reproduce",
    configPath: ".pi/benny/configuration.yaml",
    event: '{"channel":"C0123"}',
    repo: "/repo",
    dryRun: true,
  };
  const prompt = buildPrompt(options);
  expect(prompt).toContain(join("/repo", OPERATIONAL_FILES.reproduce));
  expect(prompt).toContain("Configuration: .pi/benny/configuration.yaml");
  expect(prompt).toContain('Event: {"channel":"C0123"}');
  expect(prompt).toContain("fail closed");
});

it("prints the pi command in dry-run mode without starting pi", () => {
  const directory = mkdtempSync(join(tmpdir(), "benny-runner-"));
  const configPath = join(directory, "configuration.yaml");
  writeFileSync(configPath, config);

  const original = process.stdout.write.bind(process.stdout);
  let printed = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    printed += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  let code: number;
  try {
    code = run({ mode: "triage", configPath, event: "{}", repo: directory, dryRun: true });
  } finally {
    process.stdout.write = original;
  }

  expect(code).toBe(0);
  expect(printed).toContain("pi ");
  expect(printed).toContain(OPERATIONAL_FILES.triage);
  expect(printed).not.toContain("--model");
});
