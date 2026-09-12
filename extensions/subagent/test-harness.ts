/**
 * Shared harness for the subagent extension tests.
 *
 * The tests drive the extension the way pi does: call the default export with a
 * capturing `ExtensionAPI`, then invoke a registered tool's `execute` with an
 * `ExtensionContext`-shaped object. Child `pi` processes are replaced by the
 * deterministic stand-in in `fixtures/fake-pi.mjs`, which records the argv,
 * cwd, and appended system prompt the extension built and emits the same
 * `--mode json` `message_end` event a live model run emits. Nothing here mocks
 * an assertion away: the extension's own spawn path, argument construction, and
 * output parsing run unchanged.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import pstackSubagent from "./index.ts";

export const FAKE_PI_PATH = join(import.meta.dirname, "fixtures", "fake-pi.mjs");

export interface FakePiEntry {
  readonly event: "start" | "end";
  readonly at: number;
  readonly pid: number;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly model?: string;
  readonly tools?: string;
  readonly thinking?: string;
  readonly task: string;
  readonly systemPrompt: string | null;
}

export interface SingleResultLike {
  readonly agent: string;
  readonly agentSource: string;
  readonly task: string;
  readonly model?: string;
  readonly exitCode: number;
  readonly output: string;
  readonly stderr: string;
  readonly stopReason?: string;
  readonly errorMessage?: string;
}

export interface ToolResultLike {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly details?: unknown;
  readonly isError?: boolean;
}

export interface SubagentDetails {
  readonly mode: "single" | "parallel" | "chain";
  readonly results: readonly SingleResultLike[];
}

export function textOf(result: ToolResultLike): string {
  return result.content.map((part) => part.text).join("\n");
}

export function subagentDetails(result: ToolResultLike): SubagentDetails {
  return result.details as SubagentDetails;
}

type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

const tempDirs: string[] = [];

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Isolated user/project config tree plus the fake-pi log path. Every file the
 * extension reads is created under one temporary root; the real
 * `~/.pi/agent` is never touched.
 */
export class TestEnv {
  readonly root: string;
  readonly agentDir: string;
  readonly projectDir: string;
  readonly logPath: string;

  constructor(prefix = "pi-pstack-subagent-test-") {
    this.root = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(this.root);
    this.agentDir = join(this.root, "agent");
    this.projectDir = join(this.root, "project");
    mkdirSync(this.agentDir, { recursive: true });
    mkdirSync(this.projectDir, { recursive: true });
    this.logPath = join(this.root, "fake-pi.log");
  }

  writeUserRoles(roles: unknown): void {
    writeFileSync(join(this.agentDir, "pstack-models.json"), JSON.stringify(roles), "utf8");
  }

  writeProjectRoles(roles: unknown): void {
    mkdirSync(join(this.projectDir, ".pi"), { recursive: true });
    writeFileSync(join(this.projectDir, ".pi", "pstack-models.json"), JSON.stringify(roles), "utf8");
  }

  writeUserAgent(fileName: string, content: string): string {
    const dir = join(this.agentDir, "agents");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, fileName);
    writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  writeProjectAgent(fileName: string, content: string): string {
    const dir = join(this.projectDir, ".pi", "agents");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, fileName);
    writeFileSync(filePath, content, "utf8");
    return filePath;
  }

  entries(): FakePiEntry[] {
    if (!existsSync(this.logPath)) return [];
    return readFileSync(this.logPath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as FakePiEntry);
  }

  starts(): FakePiEntry[] {
    return this.entries().filter((entry) => entry.event === "start");
  }

  clearLog(): void {
    rmSync(this.logPath, { force: true });
  }
}

export interface ContextOptions {
  readonly cwd?: string;
  readonly trusted?: boolean;
  /** `null` runs with no parent model, the way a session without a model would. */
  readonly model?: { readonly provider: string; readonly id: string } | null;
  readonly thinkingLevel?: ExtensionContext["thinkingLevel"];
}

export class ExtensionHarness {
  readonly env: TestEnv;
  readonly tools = new Map<string, ToolDefinition>();
  readonly commands = new Map<string, CommandOptions>();

  constructor(prefix?: string) {
    this.env = new TestEnv(prefix);
    const api = {
      registerTool: (tool: ToolDefinition) => {
        this.tools.set(tool.name, tool);
      },
      registerCommand: (name: string, options: CommandOptions) => {
        this.commands.set(name, options);
      },
    } as unknown as ExtensionAPI;
    pstackSubagent(api);
  }

  tool(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (tool === undefined) throw new Error(`tool not registered: ${name}`);
    return tool;
  }

  makeContext(options: ContextOptions = {}): { ctx: ExtensionContext; notifications: string[] } {
    const notifications: string[] = [];
    const model = options.model === null ? undefined : (options.model ?? { provider: "parent", id: "model" });
    const ctx = {
      cwd: options.cwd ?? this.env.projectDir,
      model,
      thinkingLevel: options.thinkingLevel,
      isProjectTrusted: () => options.trusted ?? false,
      ui: {
        notify: (message: string) => {
          notifications.push(message);
        },
      },
    } as unknown as ExtensionContext;
    return { ctx, notifications };
  }

  /** Invoke a registered tool through the real execute entry point. */
  async runTool(name: string, params: unknown, options: ContextOptions = {}): Promise<ToolResultLike> {
    const tool = this.tool(name);
    const { ctx } = this.makeContext(options);
    return withAgentDir(this.env.agentDir, () =>
      withFakePi(this.env.logPath, async () => {
        const result = await tool.execute("test-call", params as never, undefined, undefined, ctx);
        return result as unknown as ToolResultLike;
      }),
    );
  }

  /** Invoke a registered slash command and return the messages it notified. */
  async runCommand(name: string, args = ""): Promise<string[]> {
    const command = this.commands.get(name);
    if (command === undefined) throw new Error(`command not registered: ${name}`);
    const { ctx, notifications } = this.makeContext();
    await withAgentDir(this.env.agentDir, async () => {
      await command.handler(args, ctx as unknown as ExtensionCommandContext);
    });
    return notifications;
  }
}

/** Run `fn` with `PI_CODING_AGENT_DIR` pointed at an isolated agent directory. */
export async function withAgentDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}

/**
 * Run `fn` with the child-process resolver pointed at the fake pi script.
 *
 * `getPiInvocation` spawns `node <process.argv[1]>` when that path exists,
 * which is exactly how the extension spawns real children under pi; pointing
 * argv[1] at the fixture swaps the model for a deterministic run without
 * changing the extension's spawn path.
 */
export async function withFakePi<T>(logPath: string, fn: () => Promise<T>): Promise<T> {
  const previousArgv1 = process.argv[1];
  const previousLog = process.env.FAKE_PI_LOG;
  process.argv[1] = FAKE_PI_PATH;
  process.env.FAKE_PI_LOG = logPath;
  try {
    return await fn();
  } finally {
    if (previousArgv1 === undefined) process.argv.splice(1, 1);
    else process.argv[1] = previousArgv1;
    if (previousLog === undefined) delete process.env.FAKE_PI_LOG;
    else process.env.FAKE_PI_LOG = previousLog;
  }
}

export function firstStart(harness: ExtensionHarness): FakePiEntry {
  const [entry] = harness.env.starts();
  if (entry === undefined) throw new Error("fake pi was never spawned");
  return entry;
}

/** Highest number of fake pi children alive at the same instant. */
export function maxConcurrentChildren(env: TestEnv): number {
  const events = env
    .entries()
    .map((entry) => ({ at: entry.at, delta: entry.event === "start" ? 1 : -1 }))
    .sort((left, right) => left.at - right.at || left.delta - right.delta);
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.delta;
    max = Math.max(max, current);
  }
  return max;
}
