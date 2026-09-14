import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "../../skills/poteto-mode/scripts/testing/expect.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PiManifest {
  readonly pi?: {
    readonly extensions?: readonly string[];
    readonly skills?: readonly string[];
  };
}

it("keeps benny out of the pi manifest so a package install does not enable it", () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as PiManifest;
  const resources = [...(manifest.pi?.extensions ?? []), ...(manifest.pi?.skills ?? [])];
  expect(resources.some((entry) => entry.includes("automations"))).toBe(false);

  // The pack still ships: setup copies it, it just never loads as a package skill.
  expect(existsSync(join(packageRoot, "automations", "benny", "skills", "setup-benny", "SKILL.md"))).toBe(true);
  expect(existsSync(join(packageRoot, "automations", "benny", "runner", "benny-run.ts"))).toBe(true);
});

type YamlValue = string | boolean | number | YamlValue[] | { [key: string]: YamlValue };

interface ParseCursor {
  readonly lines: readonly string[];
  index: number;
}

function indentationOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isIgnorableLine(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function stripYamlComment(line: string): string {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function findKeyColon(text: string): number {
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ":") {
      return i;
    }
  }
  return -1;
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseInlineValue(text: string): YamlValue {
  const value = text.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((part) => unquote(part.trim()))
      .filter((part) => part !== "");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return unquote(value);
}

function nextContentIndent(cursor: ParseCursor): number | undefined {
  let scan = cursor.index;
  while (scan < cursor.lines.length) {
    const raw = cursor.lines[scan];
    if (isIgnorableLine(raw)) {
      scan++;
      continue;
    }
    return indentationOf(raw);
  }
  return undefined;
}

function parseBlockScalar(cursor: ParseCursor, parentIndent: number): string {
  const collected: string[] = [];
  while (cursor.index < cursor.lines.length) {
    const raw = cursor.lines[cursor.index];
    if (raw.trim() === "") {
      collected.push("");
      cursor.index++;
      continue;
    }
    if (indentationOf(raw) <= parentIndent) break;
    collected.push(raw);
    cursor.index++;
  }
  const minIndent = collected.reduce<number>((minimum, line) => {
    if (line.trim() === "") return minimum;
    return Math.min(minimum, indentationOf(line));
  }, Number.POSITIVE_INFINITY);
  const blockIndent = Number.isFinite(minIndent) ? minIndent : parentIndent + 1;
  return collected.map((line) => (line.trim() === "" ? "" : line.slice(blockIndent))).join("\n");
}

function parseValue(cursor: ParseCursor, parentIndent: number, rest: string): YamlValue {
  if (rest === "|" || rest === ">") {
    return parseBlockScalar(cursor, parentIndent);
  }
  if (rest === "") {
    const childIndent = nextContentIndent(cursor);
    return childIndent === undefined ? {} : parseBlock(cursor, childIndent);
  }
  return parseInlineValue(rest);
}

function parseMapping(cursor: ParseCursor, indent: number): Record<string, YamlValue> {
  const map: Record<string, YamlValue> = {};
  while (cursor.index < cursor.lines.length) {
    const raw = cursor.lines[cursor.index];
    if (isIgnorableLine(raw)) {
      cursor.index++;
      continue;
    }
    const cleaned = stripYamlComment(raw);
    const currentIndent = indentationOf(raw);
    if (currentIndent < indent) break;
    if (currentIndent > indent) {
      throw new Error(`unexpected indentation ${currentIndent} > ${indent} in mapping at line: ${raw}`);
    }
    const text = cleaned.trim();
    if (text.startsWith("- ")) break;
    const colon = findKeyColon(text);
    if (colon < 0) throw new Error(`expected a key: value pair at line: ${raw}`);
    const key = unquote(text.slice(0, colon).trim());
    const rest = text.slice(colon + 1).trim();
    cursor.index++;
    map[key] = parseValue(cursor, indent, rest);
  }
  return map;
}

function parseSequence(cursor: ParseCursor, indent: number): YamlValue[] {
  const list: YamlValue[] = [];
  while (cursor.index < cursor.lines.length) {
    const raw = cursor.lines[cursor.index];
    if (isIgnorableLine(raw)) {
      cursor.index++;
      continue;
    }
    const cleaned = stripYamlComment(raw);
    const currentIndent = indentationOf(raw);
    if (currentIndent < indent) break;
    if (currentIndent > indent) {
      throw new Error(`unexpected indentation ${currentIndent} > ${indent} in sequence at line: ${raw}`);
    }
    const text = cleaned.trim();
    if (!text.startsWith("- ")) break;
    const itemText = text.slice(2).trim();
    cursor.index++;
    list.push(parseSequenceItem(cursor, indent, itemText));
  }
  return list;
}

function parseSequenceItem(cursor: ParseCursor, dashIndent: number, itemText: string): YamlValue {
  const contentIndent = dashIndent + 2;
  if (itemText === "") {
    const childIndent = nextContentIndent(cursor);
    return childIndent === undefined ? {} : parseBlock(cursor, childIndent);
  }
  const colon = findKeyColon(itemText);
  if (colon < 0) return parseInlineValue(itemText);
  const key = unquote(itemText.slice(0, colon).trim());
  const rest = itemText.slice(colon + 1).trim();
  const item: Record<string, YamlValue> = {};
  item[key] = parseValue(cursor, dashIndent, rest);
  return { ...item, ...parseMapping(cursor, contentIndent) };
}

function parseBlock(cursor: ParseCursor, indent: number): YamlValue {
  while (cursor.index < cursor.lines.length) {
    const raw = cursor.lines[cursor.index];
    if (isIgnorableLine(raw)) {
      cursor.index++;
      continue;
    }
    break;
  }
  if (cursor.index >= cursor.lines.length) return {};
  const text = stripYamlComment(cursor.lines[cursor.index]).trim();
  if (text.startsWith("- ")) return parseSequence(cursor, indent);
  return parseMapping(cursor, indent);
}

function parseYaml(text: string): Record<string, YamlValue> {
  const cursor: ParseCursor = { lines: text.split(/\r?\n/), index: 0 };
  return parseMapping(cursor, 0);
}

function shellTokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let inToken = false;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === '"' && char === "\\" && i + 1 < command.length) {
      current += char + command[i + 1];
      i++;
      inToken = true;
    } else if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
    } else {
      current += char;
      inToken = true;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

function runnerInvocation(run: string): string[] | undefined {
  const lines = run.split("\n");
  let current = "";
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.endsWith("\\")) {
      current += `${trimmed.slice(0, -1)} `;
      continue;
    }
    current += trimmed;
    if (current.includes("benny-run.ts")) return shellTokenize(current);
    current = "";
  }
  return undefined;
}

function asRecord(value: YamlValue, key: string): Record<string, YamlValue> {
  const nested = (value as Record<string, YamlValue>)[key];
  if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
    throw new Error(`expected "${key}" to be a YAML mapping`);
  }
  return nested as Record<string, YamlValue>;
}

/** The JSON event literals a workflow run step assigns to its `event` shell variable. */
function assignedEventLiterals(run: string): string[] {
  const literals: string[] = [];
  for (const line of run.split("\n")) {
    const direct = /^\s*event=(?:"(.*)"|'(.*)')\s*$/.exec(line);
    if (direct !== null) {
      literals.push(direct[1] ?? direct[2] ?? "");
      continue;
    }
    const printed = /^\s*event=\$\(printf '(.*)' "\$iid" "\$url"\)\s*$/.exec(line);
    if (printed !== null) {
      literals.push(printed[1]);
    }
  }
  return literals;
}

/**
 * Resolve a shell-quoted event literal into the JSON the workflow builds:
 * unescape the quotes and stand in for the iid/url variables or expressions.
 * Returns undefined when the result is not a JSON object.
 */
function resolvedEventLiteral(literal: string): Record<string, unknown> | undefined {
  const substituted = literal
    .replace(/\\"/g, '"')
    .replace(/\$\{\{[^}]*\}\}/g, "1")
    .replace(/\$iid\b/g, "1")
    .replace(/\$url\b/g, "https://gitlab.com/group/project/-/issues/1")
    .replace("%s", "1")
    .replace("%s", "https://gitlab.com/group/project/-/issues/1");
  let parsed: unknown;
  try {
    parsed = JSON.parse(substituted);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

it("ships webhook-intake workflows that pass the event binding and carry no Slack values", () => {
  const cases = [
    { file: "benny-webhook-triage.yml", mode: "triage", types: ["benny-report"] },
    { file: "benny-webhook-reproduce.yml", mode: "reproduce", types: ["benny-report"] },
  ];

  for (const { file, mode, types } of cases) {
    const workflow = parseYaml(readFileSync(join(packageRoot, "automations", "benny", "templates", file), "utf8"));

    const dispatch = asRecord(asRecord(workflow, "on"), "repository_dispatch");
    expect(dispatch.types).toEqual(types);

    const job = asRecord(workflow, "jobs");
    const jobName = Object.keys(job)[0];
    const body = asRecord(job, jobName);

    const steps = body.steps;
    expect(Array.isArray(steps)).toBe(true);
    const step = (steps as YamlValue[]).find((entry) => {
      const run = (entry as Record<string, YamlValue>).run;
      return typeof run === "string" && runnerInvocation(run) !== undefined;
    });
    const runRecord = step as Record<string, YamlValue>;

    const env = runRecord.env as Record<string, YamlValue>;
    expect(env.PI_PROVIDER_KEY).toBeDefined();
    expect(env.BENNY_BINDING).toBeDefined();
    expect(env.BENNY_SLACK_BOT_TOKEN).toBeUndefined();

    const tokens = runnerInvocation(String(runRecord.run));
    expect(tokens).toBeDefined();
    const invocation = tokens as string[];
    expect(invocation).toContain(".pi/automations/benny/runner/benny-run.ts");
    const modeIndex = invocation.indexOf("--mode");
    expect(modeIndex >= 0).toBe(true);
    expect(invocation[modeIndex + 1]).toBe(mode);
    expect(invocation).toContain("--event");
  }
});

/** `tracker.labels` from the example configuration, as plain strings. */
function exampleTrackerLabels(): Record<string, string> {
  const config = parseYaml(
    readFileSync(join(packageRoot, "automations", "benny", "templates", "configuration.example.yaml"), "utf8"),
  );
  const labels = asRecord(asRecord(config, "tracker"), "labels");
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) result[key] = String(value);
  return result;
}

/**
 * `gitlab.token_env` from the example configuration. The GitLab section is
 * commented out because Slack is the example's live default, so read the
 * documented block the GitLab template comments point at.
 */
function exampleGitlabTokenEnv(): string {
  const lines = readFileSync(
    join(packageRoot, "automations", "benny", "templates", "configuration.example.yaml"),
    "utf8",
  ).split(/\r?\n/);
  const start = lines.findIndex((line) => /^#\s*gitlab:\s*$/.test(line));
  if (start < 0) throw new Error("the example configuration documents no gitlab section");
  const block: string[] = [];
  for (let index = start; index < lines.length; index++) {
    const match = /^#\s?(.*)$/.exec(lines[index]);
    if (match === null) break;
    block.push(match[1]);
  }
  const gitlab = asRecord(parseYaml(block.join("\n")), "gitlab");
  return String(gitlab.token_env);
}

/** `verification.artifact_directory` from the example configuration. */
function exampleArtifactDirectory(): string {
  const config = parseYaml(
    readFileSync(join(packageRoot, "automations", "benny", "templates", "configuration.example.yaml"), "utf8"),
  );
  return String(asRecord(config, "verification").artifact_directory);
}

it("resolves the example artifact directory per run so concurrent benny runs cannot share proof artifacts", () => {
  const configured = exampleArtifactDirectory();
  const base = mkdtempSync(join(tmpdir(), "benny-artifacts-"));
  try {
    // Two overlapping runs each resolve the configured directory for themselves
    // and write the same proof filenames the operational file asks for. A fixed
    // configured path makes the second run overwrite the first run's proof, and
    // a finishing run's cleanup then removes the other run's evidence.
    const runDir = (runId: string) => join(base, configured.replaceAll("$RUN_ID", runId).replace(/^\/+/, ""));
    const first = runDir("1001");
    const second = runDir("1002");
    expect(first === second).toBe(false);

    for (const [dir, proof] of [[first, "run 1001"], [second, "run 1002"]] as const) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "screenshot.png"), proof);
    }
    expect(readFileSync(join(first, "screenshot.png"), "utf8")).toBe("run 1001");
    expect(readFileSync(join(second, "screenshot.png"), "utf8")).toBe("run 1002");

    // Cleanup belongs to the run that finished, never to its neighbor.
    rmSync(second, { recursive: true, force: true });
    expect(existsSync(join(first, "screenshot.png"))).toBe(true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

it("ships GitHub-intake workflows that drive the runner with the no-Slack event, guard, and env", () => {
  const configured = exampleTrackerLabels();
  const cases = [
    { file: "benny-github-triage.yml", mode: "triage", labelKey: "intake", types: ["opened", "reopened", "labeled"] },
    { file: "benny-github-reproduce.yml", mode: "reproduce", labelKey: "needs_repro", types: ["labeled"] },
  ];

  for (const { file, mode, labelKey, types } of cases) {
    // The guard literal must be the configured default label: a drift between
    // tracker.labels.* and the copied workflow silently stops the trigger.
    const intakeLabel = configured[labelKey];
    expect(typeof intakeLabel).toBe("string");
    const workflow = parseYaml(readFileSync(join(packageRoot, "automations", "benny", "templates", file), "utf8"));

    const issueTriggers = asRecord(asRecord(workflow, "on"), "issues");
    expect(issueTriggers.types).toEqual(types);

    const job = asRecord(workflow, "jobs");
    const jobName = Object.keys(job)[0];
    const body = asRecord(job, jobName);

    const guard = String(body.if);
    expect(guard).toContain(`github.event.label.name == '${intakeLabel}'`);
    expect(guard).not.toContain("github.event.issue.labels.*.name");

    const steps = body.steps;
    expect(Array.isArray(steps)).toBe(true);
    const step = (steps as YamlValue[]).find((entry) => {
      const run = (entry as Record<string, YamlValue>).run;
      return typeof run === "string" && runnerInvocation(run) !== undefined;
    });
    const runRecord = step as Record<string, YamlValue>;

    const env = runRecord.env as Record<string, YamlValue>;
    expect(env.PI_PROVIDER_KEY).toBeDefined();
    expect(env.GH_TOKEN).toBeDefined();
    expect(env.BENNY_SLACK_BOT_TOKEN).toBeUndefined();

    const tokens = runnerInvocation(String(runRecord.run));
    expect(tokens).toBeDefined();
    const invocation = tokens as string[];
    expect(invocation).toContain(".pi/automations/benny/runner/benny-run.ts");
    expect(invocation).toContain("--mode");
    expect(invocation).toContain("--config");
    expect(invocation).toContain("--event");
    const modeIndex = invocation.indexOf("--mode");
    expect(modeIndex >= 0).toBe(true);
    expect(invocation[modeIndex + 1]).toBe(mode);
  }
});

it("ships GitLab-intake workflows that drive the runner with the GitLab event, newly-added-label guard, and env", () => {
  const configured = exampleTrackerLabels();
  const tokenEnv = exampleGitlabTokenEnv();
  const cases = [
    {
      file: "benny-gitlab-triage.yml",
      mode: "triage",
      labelKey: "intake",
      manualBypass: "github.event_name == 'workflow_dispatch'",
      allowedActions: ["opened", "reopened"],
      sweeps: false,
    },
    {
      file: "benny-gitlab-reproduce.yml",
      mode: "reproduce",
      labelKey: "needs_repro",
      manualBypass: "github.event_name != 'repository_dispatch'",
      allowedActions: [],
      sweeps: true,
    },
  ];

  for (const { file, mode, labelKey, manualBypass, allowedActions, sweeps } of cases) {
    // The guard literal must be the configured default label: a drift between
    // tracker.labels.* and the copied workflow silently stops the trigger.
    const intakeLabel = configured[labelKey];
    expect(typeof intakeLabel).toBe("string");
    const workflow = parseYaml(readFileSync(join(packageRoot, "automations", "benny", "templates", file), "utf8"));

    const triggers = asRecord(workflow, "on");
    const dispatch = asRecord(triggers, "repository_dispatch");
    expect(dispatch.types).toEqual(["benny-gitlab-report"]);

    const manual = asRecord(triggers, "workflow_dispatch");
    const inputs = asRecord(manual, "inputs");
    expect(inputs.iid).toBeDefined();
    expect(inputs.url).toBeDefined();
    expect(triggers.schedule !== undefined).toBe(sweeps);

    const job = asRecord(workflow, "jobs");
    const jobName = Object.keys(job)[0];
    const body = asRecord(job, jobName);

    // The guard must fire on the event's newly added label, never on the issue's
    // label list, so a later label change cannot re-trigger the run. Actions
    // other than the explicit allowlist are ignored, never treated as triage.
    const guard = String(body.if);
    expect(guard).toContain(manualBypass);
    expect(guard).toContain(`github.event.client_payload.label.name == '${intakeLabel}'`);
    for (const action of allowedActions) {
      expect(guard).toContain(`github.event.client_payload.action == '${action}'`);
    }
    expect(guard).not.toContain("github.event.client_payload.action !=");
    expect(guard).not.toContain("client_payload.issue.labels");
    expect(guard).not.toContain("github.event.issue.labels.*.name");

    const steps = body.steps;
    expect(Array.isArray(steps)).toBe(true);
    const step = (steps as YamlValue[]).find((entry) => {
      const run = (entry as Record<string, YamlValue>).run;
      return typeof run === "string" && runnerInvocation(run) !== undefined;
    });
    const runRecord = step as Record<string, YamlValue>;

    const env = runRecord.env as Record<string, YamlValue>;
    expect(env.PI_PROVIDER_KEY).toBeDefined();
    // The env key is a second declaration of gitlab.token_env: the runner
    // tells the adapter to read that name, so a drift fails at verdict time.
    expect(env[tokenEnv]).toBe(`\${{ secrets.${tokenEnv} }}`);
    expect(env.BENNY_SLACK_BOT_TOKEN).toBeUndefined();

    const tokens = runnerInvocation(String(runRecord.run));
    expect(tokens).toBeDefined();
    const invocation = tokens as string[];
    expect(invocation).toContain(".pi/automations/benny/runner/benny-run.ts");
    expect(invocation).toContain("--config");
    expect(invocation).toContain("--event");
    const modeIndex = invocation.indexOf("--mode");
    expect(modeIndex >= 0).toBe(true);
    expect(invocation[modeIndex + 1]).toBe(mode);

    // The run step builds the JSON runner event from the GitLab iid and URL
    // with printf over quoted variables, and the reproduce step keeps the
    // scheduled sweep. Parse every constructed literal so a wrong field name
    // fails the test.
    const assignedEvents = assignedEventLiterals(String(runRecord.run)).map(resolvedEventLiteral);
    expect(assignedEvents.some((event) => event?.iid !== undefined && event?.url !== undefined)).toBe(true);
    if (mode === "reproduce") {
      expect(assignedEvents.some((event) => event?.sweep === true)).toBe(true);
    }
  }
});

interface WorkflowRunStep {
  readonly run: string;
  readonly env: Readonly<Record<string, string>>;
}

/** The benny runner step of a workflow template, with its env resolved to plain strings. */
function workflowRunStep(file: string): WorkflowRunStep {
  const workflow = parseYaml(readFileSync(join(packageRoot, "automations", "benny", "templates", file), "utf8"));
  const job = asRecord(workflow, "jobs");
  const jobName = Object.keys(job)[0];
  const body = asRecord(job, jobName);
  const steps = body.steps;
  expect(Array.isArray(steps)).toBe(true);
  const step = (steps as YamlValue[]).find((entry) => {
    const run = (entry as Record<string, YamlValue>).run;
    return typeof run === "string" && runnerInvocation(run) !== undefined;
  });
  if (step === undefined) throw new Error(`no benny runner step in ${file}`);
  const record = step as Record<string, YamlValue>;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries((record.env ?? {}) as Record<string, YamlValue>)) {
    env[key] = String(value);
  }
  return { run: String(record.run), env };
}

function substituteWorkflowExpressions(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_match, expression: string) => {
    const value = values[expression.trim()];
    if (value === undefined) throw new Error(`the simulation has no value for workflow expression: ${expression.trim()}`);
    return value;
  });
}

interface TemplateScenario {
  readonly eventName: string;
  readonly dispatch: string;
  readonly channel?: string;
  readonly ts?: string;
  readonly issue?: string;
  readonly issueNumber?: string;
  readonly issueUrl?: string;
  readonly iid?: string;
  readonly url?: string;
  readonly dispatchIid?: string;
  readonly dispatchUrl?: string;
}

interface TemplateRun {
  readonly status: number | null;
  readonly marker: boolean;
  readonly events: readonly string[];
}

/**
 * Run a workflow's runner step the way Actions would: substitute every
 * `${{ … }}` in the script and env, then execute the script with a stub `node`
 * on PATH that records its arguments. Attacker-controlled expressions carry
 * hostile shell text; the assertions are that the injected command never runs
 * and that the runner still receives the hostile value as JSON data.
 */
function simulateTemplateRun(file: string, scenario: TemplateScenario): TemplateRun {
  const step = workflowRunStep(file);
  const values: Record<string, string> = {
    "secrets.PI_PROVIDER_KEY": "provider-key",
    "secrets.BENNY_SLACK_BOT_TOKEN": "slack-token",
    "secrets.GITHUB_TOKEN": "gh-token",
    "secrets.GITLAB_TOKEN": "gitlab-token",
    "toJSON(github.event.client_payload)": scenario.dispatch,
    "inputs.channel": scenario.channel ?? "",
    "inputs.ts": scenario.ts ?? "",
    "inputs.issue": scenario.issue ?? "",
    "inputs.iid": scenario.iid ?? "",
    "inputs.url": scenario.url ?? "",
    "github.event_name": scenario.eventName,
    "github.repository": "acme/widgets",
    "github.event.issue.number": scenario.issueNumber ?? "42",
    "github.event.issue.html_url": scenario.issueUrl ?? "https://github.com/acme/widgets/issues/42",
    "github.event.client_payload.issue.iid": scenario.dispatchIid ?? "42",
    "github.event.client_payload.issue.url": scenario.dispatchUrl ?? "https://gitlab.com/acme/widgets/-/issues/42",
  };
  const script = substituteWorkflowExpressions(step.run, values);
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(step.env)) {
    environment[key] = substituteWorkflowExpressions(value, values);
  }
  environment.GITHUB_EVENT_NAME = scenario.eventName;
  environment.GITHUB_REPOSITORY = "acme/widgets";

  const dir = mkdtempSync(join(tmpdir(), "benny-template-"));
  try {
    const stubDir = join(dir, "stub-bin");
    mkdirSync(stubDir);
    const argsFile = join(dir, "node-args");
    writeFileSync(
      join(stubDir, "node"),
      '#!/bin/sh\n: > "$BENNY_ARGS_FILE"\nfor arg in "$@"; do printf \'%s\\0\' "$arg" >> "$BENNY_ARGS_FILE"; done\n',
      { mode: 0o755 },
    );
    environment.PATH = `${stubDir}:${process.env.PATH ?? ""}`;
    environment.BENNY_ARGS_FILE = argsFile;
    const scriptPath = join(dir, "step.sh");
    writeFileSync(scriptPath, script);
    const result = spawnSync("bash", [scriptPath], { cwd: dir, env: environment, encoding: "utf8" });
    const events = existsSync(argsFile) ? readFileSync(argsFile, "utf8").split("\0").filter((arg) => arg !== "") : [];
    return { status: result.status, marker: existsSync(join(dir, "pwned-marker")), events };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function eventArgument(run: TemplateRun): string | undefined {
  const index = run.events.indexOf("--event");
  return index < 0 ? undefined : run.events[index + 1];
}

const HOSTILE_SHELL = "x'; touch pwned-marker; #";

it("does not execute hostile Slack payloads or manual inputs interpolated into the workflow step", () => {
  for (const file of ["benny-triage.yml", "benny-reproduce.yml"]) {
    const dispatched = simulateTemplateRun(file, {
      eventName: "repository_dispatch",
      dispatch: JSON.stringify({ channel: "C0123", ts: "1700000000.000100", payload: HOSTILE_SHELL }),
    });
    expect(dispatched.marker).toBe(false);
    expect(dispatched.status).toBe(0);
    const dispatchedEvent = JSON.parse(eventArgument(dispatched) ?? "null") as Record<string, unknown>;
    expect(dispatchedEvent.channel).toBe("C0123");
    expect(dispatchedEvent.ts).toBe("1700000000.000100");
    expect(dispatchedEvent.payload).toBe(HOSTILE_SHELL);

    const hostileChannel = "C0123'; touch pwned-marker; : '";
    const manual = simulateTemplateRun(file, {
      eventName: "workflow_dispatch",
      dispatch: "{}",
      channel: hostileChannel,
      ts: "1700000000.000100",
    });
    expect(manual.marker).toBe(false);
    expect(manual.status).toBe(0);
    const manualEvent = JSON.parse(eventArgument(manual) ?? "null") as Record<string, unknown>;
    expect(manualEvent.channel).toBe(hostileChannel);
    expect(manualEvent.ts).toBe("1700000000.000100");
  }
});

it("keeps the Slack reproduce workflow's scheduled sweep", () => {
  const swept = simulateTemplateRun("benny-reproduce.yml", { eventName: "schedule", dispatch: "{}" });
  expect(swept.marker).toBe(false);
  expect(swept.status).toBe(0);
  expect(JSON.parse(eventArgument(swept) ?? "null")).toEqual({ sweep: true });
});

it("does not execute hostile GitHub issue inputs or event URLs", () => {
  for (const file of ["benny-github-triage.yml", "benny-github-reproduce.yml"]) {
    const hostileManual = simulateTemplateRun(file, {
      eventName: "workflow_dispatch",
      dispatch: "{}",
      issue: "1'; touch pwned-marker; #",
    });
    expect(hostileManual.marker).toBe(false);
    expect(hostileManual.status).not.toBe(0);
    expect(eventArgument(hostileManual)).toBeUndefined();

    const manual = simulateTemplateRun(file, {
      eventName: "workflow_dispatch",
      dispatch: "{}",
      issue: "7",
    });
    expect(manual.marker).toBe(false);
    expect(manual.status).toBe(0);
    expect(JSON.parse(eventArgument(manual) ?? "null")).toEqual({
      issue: 7,
      url: "https://github.com/acme/widgets/issues/7",
    });

    const hostileUrl = "https://github.com/acme/widgets/issues/42'; touch pwned-marker; $(touch pwned-marker); #";
    const hostileIssue = simulateTemplateRun(file, {
      eventName: "issues",
      dispatch: "{}",
      issueNumber: "42",
      issueUrl: hostileUrl,
    });
    expect(hostileIssue.marker).toBe(false);
    expect(hostileIssue.status).toBe(0);
    const issueEvent = JSON.parse(eventArgument(hostileIssue) ?? "null") as Record<string, unknown>;
    expect(issueEvent.issue).toBe(42);
    expect(issueEvent.url).toBe(hostileUrl);
  }
});

it("does not execute hostile GitLab issue iids or URLs", () => {
  const hostileIid = "1'; touch pwned-marker; #";
  const hostileUrl = "https://gitlab.com/acme/widgets/-/issues/1'; touch pwned-marker; $(touch pwned-marker); #";
  for (const file of ["benny-gitlab-triage.yml", "benny-gitlab-reproduce.yml"]) {
    const manual = simulateTemplateRun(file, {
      eventName: "workflow_dispatch",
      dispatch: "{}",
      iid: hostileIid,
      url: hostileUrl,
    });
    expect(manual.marker).toBe(false);
    expect(manual.status).not.toBe(0);
    expect(eventArgument(manual)).toBeUndefined();

    const manualUrl = simulateTemplateRun(file, {
      eventName: "workflow_dispatch",
      dispatch: "{}",
      iid: "7",
      url: hostileUrl,
    });
    expect(manualUrl.marker).toBe(false);
    expect(manualUrl.status).toBe(0);
    expect(JSON.parse(eventArgument(manualUrl) ?? "null")).toEqual({ iid: 7, url: hostileUrl });

    const relay = simulateTemplateRun(file, {
      eventName: "repository_dispatch",
      dispatch: "{}",
      dispatchIid: hostileIid,
      dispatchUrl: hostileUrl,
    });
    expect(relay.marker).toBe(false);
    expect(relay.status).not.toBe(0);
    expect(eventArgument(relay)).toBeUndefined();

    const relayUrl = simulateTemplateRun(file, {
      eventName: "repository_dispatch",
      dispatch: "{}",
      dispatchIid: "42",
      dispatchUrl: hostileUrl,
    });
    expect(relayUrl.marker).toBe(false);
    expect(relayUrl.status).toBe(0);
    expect(JSON.parse(eventArgument(relayUrl) ?? "null")).toEqual({ iid: 42, url: hostileUrl });
  }
});

it("keeps the GitLab reproduce workflow's scheduled sweep", () => {
  const swept = simulateTemplateRun("benny-gitlab-reproduce.yml", { eventName: "schedule", dispatch: "{}" });
  expect(swept.marker).toBe(false);
  expect(swept.status).toBe(0);
  expect(JSON.parse(eventArgument(swept) ?? "null")).toEqual({ sweep: true });
});
