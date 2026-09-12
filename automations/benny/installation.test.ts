import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

it("ships GitHub-intake workflows that drive the runner with the no-Slack event, guard, and env", () => {
  const cases = [
    { file: "benny-github-triage.yml", mode: "triage", intakeLabel: "triage", types: ["opened", "reopened", "labeled"] },
    { file: "benny-github-reproduce.yml", mode: "reproduce", intakeLabel: "needs-repro", types: ["labeled"] },
  ];

  for (const { file, mode, intakeLabel, types } of cases) {
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
