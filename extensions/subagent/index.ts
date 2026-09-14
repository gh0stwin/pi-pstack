/**
 * pstack subagent extension for pi.
 *
 * pi intentionally ships without a subagent primitive, so this extension
 * supplies the one the pstack skills rely on. It spawns a separate `pi`
 * process per task with an isolated context window, an agent definition from
 * `agents/`, and a model resolved from the pstack role configuration.
 *
 * Modes:
 *   - single:   { agent, task }
 *   - parallel: { tasks: [{ agent, task }, ...] }   (max 8 tasks, 4 at a time)
 *   - chain:    { chain: [{ agent, task: "... {previous} ..." }, ...] }
 *
 * Model resolution order: `model` parameter, then `role` parameter against
 * `pstack-models.json`, then the agent definition's `model`, then the parent
 * session model. `inherit-parent` and `auto` role values select that parent
 * model and pass it to the child explicitly.
 *
 * Child pi resolution order: the `PI_PSTACK_PI_BIN` override, the installed pi
 * CLI entry from this extension's own import chain, then `pi` on PATH. Never
 * `process.argv[1]`: under the pi CLI that is pi, but when the SDK embeds this
 * extension in-process it is the host program, and spawning it re-executes the
 * host recursively.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentConfig, discoverAgents } from "./agents.ts";
import {
  DEFAULT_ROLES,
  INHERIT_VALUES,
  loadRoleConfig,
  type RoleConfig,
  resolveRoleModel,
} from "./config.ts";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

const READONLY_TOOLS = "read,grep,find,ls";

type ThinkingName = ThinkingLevel;

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

/** One tool call a child made, parsed from its `--mode json` event stream. */
interface ToolCallRecord {
  /** The call id pi assigned; matches the `tool_execution_end` event. */
  toolCallId?: string;
  tool: string;
  args: Record<string, unknown>;
  /** True once the matching `tool_execution_end` was observed. */
  executed: boolean;
  /** The end event's error flag; only meaningful when `executed` is true. */
  isError: boolean;
}

export interface SpawnRequest {
  readonly agent: string;
  readonly task: string;
  readonly role?: string;
  readonly model?: string;
  readonly thinking?: ThinkingName;
  readonly readonly?: boolean;
  readonly tools?: string;
  readonly cwd?: string;
}

interface SingleResult {
  agent: string;
  agentSource: AgentConfig["source"] | "unknown";
  task: string;
  model?: string;
  exitCode: number;
  output: string;
  stderr: string;
  usage: UsageStats;
  toolCalls: ToolCallRecord[];
  stopReason?: string;
  errorMessage?: string;
}

interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  results: SingleResult[];
}

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_ENTRY_ENV = "PI_PSTACK_PI_BIN";

/**
 * Resolve the installed pi CLI entry from this extension's own import chain.
 * pi loads extensions in-process, so the `@earendil-works/pi-coding-agent`
 * package this file resolves is the pi that loaded it, and its `bin.pi` names
 * the CLI script. Returns undefined when the package or entry is unavailable
 * so the caller can fall back to `pi` on PATH.
 */
function resolvePiEntryFromImportChain(): string | undefined {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.resolve(PI_PACKAGE)));
    for (;;) {
      const manifestPath = path.join(dir, "package.json");
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
          name?: string;
          bin?: string | Record<string, string>;
        };
        if (manifest.name === PI_PACKAGE) {
          const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.pi;
          if (typeof bin !== "string") return undefined;
          const entry = path.resolve(dir, bin);
          return fs.existsSync(entry) ? entry : undefined;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  } catch {
    return undefined;
  }
}

/** The node or bun runtime running this extension, when `process.execPath` is one. */
function scriptRuntime(): string | undefined {
  const execName = path.basename(process.execPath).toLowerCase();
  return /^(node|bun)(\.exe)?$/.test(execName) ? process.execPath : undefined;
}

/**
 * True when `candidate` is the script this process is already running, which
 * would re-execute the host program instead of starting a pi subagent.
 */
function isCurrentScript(candidate: string): boolean {
  const current = process.argv[1];
  if (current === undefined || current.length === 0) return false;
  try {
    return fs.realpathSync(candidate) === fs.realpathSync(current);
  } catch {
    return path.resolve(candidate) === path.resolve(current);
  }
}

function invocationForEntry(entry: string, args: string[]): { command: string; args: string[] } {
  const runtime = scriptRuntime();
  if (runtime !== undefined && /\.(?:c|m)?js$/i.test(entry)) {
    return { command: runtime, args: [entry, ...args] };
  }
  return { command: entry, args };
}

/**
 * Resolve the child pi command. `process.argv[1]` is never spawned: under the
 * pi CLI it is pi, but when the SDK embeds this extension in-process it is the
 * host program, and spawning it forks the host recursively. An explicit
 * `PI_PSTACK_PI_BIN` override that names the current script is refused for the
 * same reason and resolution continues with the import chain.
 */
export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  // A compiled pi binary is its own entry point; pi's CLI marks itself with
  // PI_CODING_AGENT. A script runtime means this is the node/bun CLI instead.
  if (scriptRuntime() === undefined && process.env.PI_CODING_AGENT === "true") {
    return { command: process.execPath, args };
  }

  const override = process.env[PI_ENTRY_ENV]?.trim();
  if (override !== undefined && override.length > 0 && !isCurrentScript(override)) {
    return invocationForEntry(override, args);
  }

  const resolved = resolvePiEntryFromImportChain();
  if (resolved !== undefined) return invocationForEntry(resolved, args);

  return { command: "pi", args };
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatUsage(usage: UsageStats, model: string | undefined): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function isFailed(result: SingleResult): boolean {
  return result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
}

function capOutput(output: string): string {
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes <= PER_TASK_OUTPUT_CAP) return output;
  let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
  while (Buffer.byteLength(truncated, "utf8") > PER_TASK_OUTPUT_CAP) truncated = truncated.slice(0, -1);
  return `${truncated}\n\n[Output truncated: ${bytes - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

const TOOL_ARG_STRING_CAP = 400;
const SUMMARY_PATH_LIMIT = 12;

const FILE_READ_TOOLS: ReadonlySet<string> = new Set(["read"]);
const FILE_WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when the call's end event was observed and did not report an error, so
 * the call actually ran. Calls pi failed before executing (the output-token-
 * limit path emits a start plus an error end saying "was not executed") and
 * calls that errored are not attributed as work the child performed.
 */
function executedOk(call: ToolCallRecord): boolean {
  return call.executed && !call.isError;
}

/**
 * Keep a tool call's arguments inspectable without letting a large `write`
 * payload bloat the parent session: long top-level strings are truncated.
 */
function compactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > TOOL_ARG_STRING_CAP) {
      compact[key] = `${value.slice(0, TOOL_ARG_STRING_CAP)}...[${value.length - TOOL_ARG_STRING_CAP} chars omitted]`;
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

function collectPaths(calls: readonly ToolCallRecord[], tools: ReadonlySet<string>): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    if (!executedOk(call) || !tools.has(call.tool)) continue;
    const value = call.args.path;
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    paths.push(value);
  }
  return paths;
}

function renderPathLine(label: string, paths: readonly string[]): string | undefined {
  if (paths.length === 0) return undefined;
  const shown = paths.slice(0, SUMMARY_PATH_LIMIT);
  const omitted = paths.length - shown.length;
  return `${label}: ${shown.join(", ")}${omitted > 0 ? ` (+${omitted} more)` : ""}`;
}

/**
 * One compact line per category so the parent can grade chain-following
 * without pulling every tool call into its context window. The full per-call
 * list stays on the structured result.
 */
function summarizeToolCalls(calls: readonly ToolCallRecord[]): string {
  if (calls.length === 0) return "";
  const lines = [
    renderPathLine("files read", collectPaths(calls, FILE_READ_TOOLS)),
    renderPathLine("files modified", collectPaths(calls, FILE_WRITE_TOOLS)),
  ].filter((line): line is string => line !== undefined);
  const other = new Map<string, number>();
  for (const call of calls) {
    if (!executedOk(call) || FILE_READ_TOOLS.has(call.tool) || FILE_WRITE_TOOLS.has(call.tool)) continue;
    other.set(call.tool, (other.get(call.tool) ?? 0) + 1);
  }
  if (other.size > 0) {
    lines.push(`other tool calls: ${[...other.entries()].map(([tool, count]) => `${tool}×${count}`).join(", ")}`);
  }
  return lines.join("\n");
}

async function writePromptFile(agentName: string, prompt: string): Promise<{ dir: string; file: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-pstack-subagent-"));
  try {
    const file = path.join(dir, `prompt-${agentName.replace(/[^\w.-]+/g, "_")}.md`);
    await fs.promises.writeFile(file, prompt, { encoding: "utf8", mode: 0o600 });
    return { dir, file };
  } catch (error) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

interface ResolvedModel {
  readonly model?: string;
  readonly inheritsParent: boolean;
}

function resolveModel(request: SpawnRequest, agent: AgentConfig, roles: RoleConfig): ResolvedModel {
  const explicit = request.model ?? (request.role !== undefined ? resolveRoleModel(roles, request.role) : undefined);
  const chosen = explicit ?? agent.model;
  if (chosen === undefined || INHERIT_VALUES.has(chosen)) return { inheritsParent: true };
  return { model: chosen, inheritsParent: false };
}

interface RunContext {
  readonly agents: readonly AgentConfig[];
  readonly roles: RoleConfig;
  readonly defaultCwd: string;
  readonly parentModel?: string;
  readonly parentThinking?: ThinkingName;
  readonly signal?: AbortSignal;
}

async function runSingle(
  context: RunContext,
  request: SpawnRequest,
  onUpdate?: (result: SingleResult) => void,
): Promise<SingleResult> {
  const agent = context.agents.find((candidate) => candidate.name === request.agent);
  const base: SingleResult = {
    agent: request.agent,
    agentSource: agent?.source ?? "unknown",
    task: request.task,
    exitCode: 1,
    output: "",
    stderr: "",
    usage: emptyUsage(),
    toolCalls: [],
  };
  if (agent === undefined) {
    const available = context.agents.map((candidate) => candidate.name).join(", ") || "none";
    base.stderr = `Unknown agent: "${request.agent}". Available agents: ${available}.`;
    return base;
  }

  const resolved = resolveModel(request, agent, context.roles);
  const model = resolved.model ?? context.parentModel;
  const thinking = request.thinking ?? (resolved.inheritsParent ? context.parentThinking : undefined);
  const tools = request.readonly === true ? READONLY_TOOLS : (request.tools ?? agent.tools?.join(","));

  const args = ["--mode", "json", "-p", "--no-session"];
  if (model !== undefined) args.push("--model", model);
  if (thinking !== undefined) args.push("--thinking", thinking);
  if (tools !== undefined && tools.length > 0) args.push("--tools", tools);

  let promptDir: string | null = null;
  const current: SingleResult = { ...base, model };
  const emit = () => onUpdate?.({ ...current, toolCalls: [...current.toolCalls] });

  try {
    if (agent.systemPrompt.trim().length > 0) {
      const promptFile = await writePromptFile(agent.name, agent.systemPrompt);
      promptDir = promptFile.dir;
      args.push("--append-system-prompt", promptFile.file);
    }
    args.push(`Task: ${request.task}`);

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const child = spawn(invocation.command, invocation.args, {
        cwd: request.cwd ?? context.defaultCwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        signal: context.signal,
      });
      let buffer = "";
      let settled = false;
      const settle = (code: number) => {
        if (settled) return;
        settled = true;
        resolve(code);
      };

      const processLine = (line: string) => {
        if (line.trim().length === 0) return;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        const record = event as {
          type?: string;
          message?: Message;
          toolName?: string;
          args?: unknown;
          toolCallId?: string;
          isError?: boolean;
        };
        if (record.type === "tool_execution_start") {
          if (typeof record.toolName === "string") {
            current.toolCalls.push({
              toolCallId: typeof record.toolCallId === "string" ? record.toolCallId : undefined,
              tool: record.toolName,
              args: isPlainObject(record.args) ? compactToolArgs(record.args) : {},
              executed: false,
              isError: false,
            });
          }
          return;
        }
        if (record.type === "tool_execution_end") {
          const id = record.toolCallId;
          if (typeof id === "string") {
            for (let index = current.toolCalls.length - 1; index >= 0; index -= 1) {
              const call = current.toolCalls[index];
              if (call.toolCallId === id && !call.executed) {
                call.executed = true;
                call.isError = record.isError === true;
                break;
              }
            }
          }
          return;
        }
        if (record.type === "message_end" && record.message !== undefined) {
          const message = record.message;
          if (message.role === "assistant") {
            current.usage.turns += 1;
            const usage = message.usage;
            if (usage) {
              current.usage.input += usage.input || 0;
              current.usage.output += usage.output || 0;
              current.usage.cacheRead += usage.cacheRead || 0;
              current.usage.cacheWrite += usage.cacheWrite || 0;
              current.usage.cost += usage.cost?.total || 0;
              current.usage.contextTokens = usage.totalTokens || 0;
            }
            for (const part of message.content) {
              if (part.type === "text") current.output = part.text;
            }
            if (message.model) current.model = message.model;
            if (message.stopReason) current.stopReason = message.stopReason;
            if (message.errorMessage) current.errorMessage = message.errorMessage;
            emit();
          }
        }
      };

      child.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });
      child.stderr.on("data", (data: Buffer) => {
        current.stderr += data.toString();
      });
      child.on("error", (error) => {
        current.stderr += `${error.message}\n`;
        settle(1);
      });
      child.on("close", (code) => {
        if (buffer.trim().length > 0) processLine(buffer);
        settle(code ?? 1);
      });
    });
    current.exitCode = exitCode;
    return current;
  } catch (error) {
    // An infrastructure failure (for example an unwritable prompt file) is a
    // failed task, not a rejected batch: throwing here would make parallel
    // mode abandon its in-flight siblings and drop their results.
    current.stderr += `${error instanceof Error ? error.message : String(error)}\n`;
    current.exitCode = 1;
    return current;
  } finally {
    if (promptDir !== null) {
      await fs.promises.rm(promptDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results: TOut[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function describeResult(result: SingleResult): string {
  const label = result.model ? `${result.agent} (${result.model})` : result.agent;
  const usage = formatUsage(result.usage, undefined);
  const trail = summarizeToolCalls(result.toolCalls);
  const trailSuffix = trail.length > 0 ? `\n${trail}` : "";
  if (isFailed(result)) {
    const reason = result.errorMessage ?? result.stderr.trim() ?? result.output.trim() ?? "(no output)";
    return `✗ ${label} failed: ${reason}${trailSuffix}`;
  }
  return `✓ ${label}${usage ? ` ${usage}` : ""}${trailSuffix}\n${capOutput(result.output.trim() || "(no output)")}`;
}

const SpawnItem = Type.Object({
  agent: Type.String({ description: "Agent definition name, for example worker, poteto-agent, or comment-sicko" }),
  task: Type.String({ description: "Task prompt for the subagent" }),
  role: Type.Optional(Type.String({ description: "pstack role label used to resolve the model, for example bug-fix" })),
  model: Type.Optional(Type.String({ description: "Explicit pi model id, for example provider/model" })),
  thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)),
  readonly: Type.Optional(Type.Boolean({ description: "Run with read, grep, find, and ls only" })),
  tools: Type.Optional(Type.String({ description: "Comma-separated tool allowlist" })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagent" })),
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Agent definition name for a single task" })),
  task: Type.Optional(Type.String({ description: "Task prompt for a single subagent" })),
  role: Type.Optional(Type.String({ description: "pstack role label used to resolve the model" })),
  model: Type.Optional(Type.String({ description: "Explicit pi model id" })),
  thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const)),
  readonly: Type.Optional(Type.Boolean({ description: "Run with read, grep, find, and ls only" })),
  tools: Type.Optional(Type.String({ description: "Comma-separated tool allowlist" })),
  cwd: Type.Optional(Type.String({ description: "Working directory for the subagent" })),
  tasks: Type.Optional(Type.Array(SpawnItem, { description: "Parallel tasks; each runs in its own subagent" })),
  chain: Type.Optional(
    Type.Array(SpawnItem, { description: "Sequential tasks; use {previous} in a task to inject the prior output" }),
  ),
});

function toRequest(item: {
  agent: string;
  task: string;
  role?: string;
  model?: string;
  thinking?: ThinkingName;
  readonly?: boolean;
  tools?: string;
  cwd?: string;
}): SpawnRequest {
  return {
    agent: item.agent,
    task: item.task,
    role: item.role,
    model: item.model,
    thinking: item.thinking,
    readonly: item.readonly,
    tools: item.tools,
    cwd: item.cwd,
  };
}

function roleSummary(roles: RoleConfig, sources: readonly string[]): string {
  const lines = Object.entries(roles).map(([role, value]) => {
    const rendered = typeof value === "string" ? value : value.join(", ");
    return `${role}: ${rendered}`;
  });
  const header =
    sources.length > 0
      ? `pstack model roles (config: ${sources.join(", ")}; defaults fill the rest)`
      : "pstack model roles (built-in defaults; run /skill:setup-pstack to configure)";
  return `${header}\n${lines.join("\n")}`;
}

export default function pstackSubagent(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a task to an isolated subagent process with its own context window. Supports single, parallel, and chained modes, pstack role-based model routing, and agent definitions from the pi-pstack package (worker, poteto-agent, comment-sicko).",
    promptSnippet: "Delegate tasks to isolated subagents (single, parallel, or chain) with role-routed models",
    promptGuidelines: [
      "Use subagent to delegate work that should run in an isolated context window, and spawn parallel subagent calls in one message to fan out.",
      "Use subagent with the role parameter (for example role: \"bug-fix\") so the model follows the pstack role configuration written by /skill:setup-pstack.",
      "Use subagent with agent: \"poteto-agent\" for pstack-style code delegates and agent: \"comment-sicko\" for read-only comment review.",
    ],
    parameters: SubagentParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const { roles } = loadRoleConfig(ctx.cwd, ctx.isProjectTrusted());
      const agents = discoverAgents(ctx.cwd, { projectTrusted: ctx.isProjectTrusted() });
      const parentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
      const context: RunContext = {
        agents,
        roles,
        defaultCwd: ctx.cwd,
        parentModel,
        parentThinking: ctx.thinkingLevel,
        signal,
      };

      const makeDetails = (mode: SubagentDetails["mode"], results: SingleResult[]): SubagentDetails => ({
        mode,
        results,
      });

      const emitProgress = (mode: SubagentDetails["mode"], results: SingleResult[]) => {
        onUpdate?.({
          content: [{ type: "text", text: results.map(describeResult).join("\n\n") || "(running...)" }],
          details: makeDetails(mode, results),
        });
      };

      if (params.chain !== undefined && params.chain.length > 0) {
        const results: SingleResult[] = [];
        let previous = "";
        for (const item of params.chain) {
          const task = item.task.split("{previous}").join(previous);
          const result = await runSingle(context, toRequest({ ...item, task }), () =>
            emitProgress("chain", results),
          );
          results.push(result);
          emitProgress("chain", results);
          if (isFailed(result)) break;
          previous = result.output;
        }
        const content = results.map((result, index) => `Step ${index + 1}\n${describeResult(result)}`).join("\n\n");
        return {
          content: [{ type: "text", text: content || "(no output)" }],
          details: makeDetails("chain", results),
          isError: results.some(isFailed),
        };
      }

      if (params.tasks !== undefined && params.tasks.length > 0) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [{ type: "text", text: `Too many parallel tasks: ${params.tasks.length} (max ${MAX_PARALLEL_TASKS}).` }],
            details: makeDetails("parallel", []),
            isError: true,
          };
        }
        const settled: SingleResult[] = new Array(params.tasks.length);
        const results = await mapWithConcurrency(params.tasks, MAX_CONCURRENCY, async (item, index) => {
          const result = await runSingle(context, toRequest(item), () => emitProgress("parallel", settled));
          settled[index] = result;
          emitProgress("parallel", settled.filter(Boolean));
          return result;
        });
        const content = results.map((result, index) => `Task ${index + 1}\n${describeResult(result)}`).join("\n\n");
        return {
          content: [{ type: "text", text: content || "(no output)" }],
          details: makeDetails("parallel", results),
          isError: results.some(isFailed),
        };
      }

      if (params.agent === undefined || params.task === undefined) {
        const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
        return {
          content: [
            {
              type: "text",
              text: `Provide agent and task, or tasks, or chain. Available agents: ${available}.`,
            },
          ],
          details: makeDetails("single", []),
          isError: true,
        };
      }

      const result = await runSingle(
        context,
        toRequest({
          agent: params.agent,
          task: params.task,
          role: params.role,
          model: params.model,
          thinking: params.thinking,
          readonly: params.readonly,
          tools: params.tools,
          cwd: params.cwd,
        }),
      );
      return {
        content: [{ type: "text", text: describeResult(result) }],
        details: makeDetails("single", [result]),
        isError: isFailed(result),
      };
    },
  });

  pi.registerTool({
    name: "pstack_roles",
    label: "pstack Roles",
    description:
      "Return the effective pstack role-to-model map used by the subagent tool, including config file sources and built-in defaults.",
    promptSnippet: "Show the effective pstack role-to-model configuration",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
      const { roles, sources } = loadRoleConfig(ctx.cwd, ctx.isProjectTrusted());
      return {
        content: [{ type: "text", text: roleSummary(roles, sources) }],
        details: { roles, sources, defaults: DEFAULT_ROLES },
      };
    },
  });

  pi.registerCommand("pstack-models", {
    description: "Show the effective pstack role-to-model configuration",
    handler: async (_args, ctx) => {
      const { roles, sources } = loadRoleConfig(ctx.cwd, ctx.isProjectTrusted());
      ctx.ui.notify(roleSummary(roles, sources), "info");
    },
  });
}
