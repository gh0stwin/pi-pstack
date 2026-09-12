/**
 * Behavior tests for the subagent extension's registered tools, driven through
 * the real extension entry point and a real child-process spawn.
 *
 * Child `pi` runs are replaced by `fixtures/fake-pi.mjs`, which records the
 * argv/cwd/system prompt the extension built and emits the `--mode json`
 * `message_end` event a live model run emits. The extension's spawn path,
 * argument construction, concurrency, chain substitution, and result parsing
 * all run unchanged, so these tests pin what the skills actually call.
 */
import { join } from "node:path";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "../../skills/poteto-mode/scripts/testing/expect.ts";
import { DEFAULT_ROLES } from "./config.ts";
import {
  cleanupTempDirs,
  ExtensionHarness,
  firstStart,
  maxConcurrentChildren,
  subagentDetails,
  textOf,
} from "./test-harness.ts";

afterEach(cleanupTempDirs);

function agentFile(name: string, options: { model?: string; description?: string } = {}): string {
  const lines = ["---", `name: ${name}`, `description: ${options.description ?? `${name} agent`}`];
  if (options.model !== undefined) lines.push(`model: ${options.model}`);
  lines.push("---", `${name} body`, "");
  return lines.join("\n");
}

it("registers the subagent and pstack_roles tools and the /pstack-models command", () => {
  const harness = new ExtensionHarness();
  expect([...harness.tools.keys()].sort()).toEqual(["pstack_roles", "subagent"]);
  expect([...harness.commands.keys()]).toEqual(["pstack-models"]);

  const subagent = harness.tool("subagent");
  expect(subagent.label).toBe("Subagent");
  expect(subagent.description).toContain("worker");
  expect(subagent.description).toContain("poteto-agent");
  expect(subagent.description).toContain("comment-sicko");
  expect(subagent.promptGuidelines?.some((line) => line.includes("role"))).toBe(true);
  const properties = Object.keys((subagent.parameters as { properties?: Record<string, unknown> }).properties ?? {});
  for (const name of ["agent", "task", "role", "model", "thinking", "readonly", "tools", "cwd", "tasks", "chain"]) {
    expect(properties).toContain(name);
  }

  expect(harness.tool("pstack_roles").description).toContain("role-to-model");
  expect(harness.commands.get("pstack-models")?.description).toContain("role-to-model");
});

it("spawns one isolated child with the agent prompt, task, and parent model", async () => {
  const harness = new ExtensionHarness();
  const result = await harness.runTool("subagent", { agent: "worker", task: "summarize the diff" });
  const entry = firstStart(harness);

  expect(entry.cwd).toBe(harness.env.projectDir);
  expect(entry.task).toBe("summarize the diff");
  expect(entry.model).toBe("parent/model");
  expect(entry.tools).toBeUndefined();
  expect(entry.thinking).toBeUndefined();
  expect(entry.systemPrompt).toContain("concise report");
  expect(entry.argv).toContain("--no-session");
  expect(entry.argv).toContain("-p");

  expect(result.isError).toBe(false);
  const details = subagentDetails(result);
  expect(details.mode).toBe("single");
  expect(details.results).toHaveLength(1);
  expect(details.results[0].agent).toBe("worker");
  expect(details.results[0].agentSource).toBe("package");
  expect(textOf(result)).toContain("✓ worker (parent/model)");
  expect(textOf(result)).toContain("result:summarize the diff");
});

it("prefers the per-call model over the role and the agent model", async () => {
  const harness = new ExtensionHarness();
  harness.env.writeUserAgent("modelled.md", agentFile("modelled", { model: "agent/model" }));
  harness.env.writeProjectRoles({ feature: "role/model" });
  await harness.runTool(
    "subagent",
    { agent: "modelled", task: "work", role: "feature", model: "explicit/model" },
    { trusted: true },
  );
  expect(firstStart(harness).model).toBe("explicit/model");
});

it("prefers the role model over the agent model", async () => {
  const harness = new ExtensionHarness();
  harness.env.writeUserAgent("modelled.md", agentFile("modelled", { model: "agent/model" }));
  harness.env.writeProjectRoles({ feature: "role/model" });
  await harness.runTool("subagent", { agent: "modelled", task: "work", role: "feature" }, { trusted: true });
  expect(firstStart(harness).model).toBe("role/model");
});

it("uses the agent model when no role or model is given", async () => {
  const harness = new ExtensionHarness();
  harness.env.writeUserAgent("modelled.md", agentFile("modelled", { model: "agent/model" }));
  await harness.runTool("subagent", { agent: "modelled", task: "work" });
  expect(firstStart(harness).model).toBe("agent/model");
});

it("falls back to the agent model when the role is unknown", async () => {
  const harness = new ExtensionHarness();
  harness.env.writeUserAgent("modelled.md", agentFile("modelled", { model: "agent/model" }));
  const result = await harness.runTool("subagent", { agent: "modelled", task: "work", role: "no-such-role" });
  expect(firstStart(harness).model).toBe("agent/model");
  expect(result.isError).toBe(false);
});

it("runs inherit-parent and auto roles on the parent model and thinking level", async () => {
  const harness = new ExtensionHarness();
  harness.env.writeProjectRoles({ fast: "inherit-parent", smart: "auto" });
  const first = await harness.runTool(
    "subagent",
    { agent: "worker", task: "one", role: "fast" },
    { trusted: true, thinkingLevel: "high" },
  );
  expect(firstStart(harness).model).toBe("parent/model");
  expect(firstStart(harness).thinking).toBe("high");
  expect(first.isError).toBe(false);

  harness.env.clearLog();
  await harness.runTool(
    "subagent",
    { agent: "worker", task: "two", role: "smart" },
    { trusted: true, thinkingLevel: "high" },
  );
  expect(firstStart(harness).model).toBe("parent/model");
});

it("omits --model when an inherited role has no parent model", async () => {
  const harness = new ExtensionHarness();
  harness.env.writeProjectRoles({ fast: "inherit-parent" });
  await harness.runTool("subagent", { agent: "worker", task: "one", role: "fast" }, { trusted: true, model: null });
  expect(firstStart(harness).model).toBeUndefined();
});

it("pins read,grep,find,ls for a readonly call and overrides a tools allowlist", async () => {
  const harness = new ExtensionHarness();
  await harness.runTool("subagent", {
    agent: "worker",
    task: "audit",
    readonly: true,
    tools: "bash, edit, write",
  });
  expect(firstStart(harness).tools).toBe("read,grep,find,ls");
});

it("passes a per-call tools allowlist through when readonly is not set", async () => {
  const harness = new ExtensionHarness();
  await harness.runTool("subagent", { agent: "worker", task: "audit", tools: "read, bash" });
  expect(firstStart(harness).tools).toBe("read, bash");
});

it("applies the bundled comment-sicko agent's readonly frontmatter", async () => {
  const harness = new ExtensionHarness();
  await harness.runTool("subagent", { agent: "comment-sicko", task: "review the diff" });
  const entry = firstStart(harness);
  expect(entry.tools).toBe("read,grep,find,ls");
  expect(entry.systemPrompt).toContain("I hate comments.");
});

it("fails an unknown agent with the available agent list and spawns nothing", async () => {
  const harness = new ExtensionHarness();
  const result = await harness.runTool("subagent", { agent: "ghost", task: "work" });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('Unknown agent: "ghost"');
  expect(textOf(result)).toContain("worker");
  expect(subagentDetails(result).results[0].stderr).toContain("Available agents");
  expect(harness.env.starts()).toHaveLength(0);
});

it("surfaces a child model rejection as a failed result", async () => {
  const harness = new ExtensionHarness();
  const result = await harness.runTool("subagent", {
    agent: "worker",
    task: "run on the model [[model-error]]",
    model: "nope/nope",
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain("Model not found: nope/nope");
  expect(subagentDetails(result).results[0].stopReason).toBe("error");
});

it("runs every parallel task and keeps their order", async () => {
  const harness = new ExtensionHarness();
  const result = await harness.runTool("subagent", {
    tasks: [
      { agent: "worker", task: "alpha" },
      { agent: "worker", task: "beta" },
    ],
  });
  const details = subagentDetails(result);
  expect(details.mode).toBe("parallel");
  expect(details.results.map((entry) => entry.task)).toEqual(["alpha", "beta"]);
  expect(textOf(result)).toContain("Task 1");
  expect(textOf(result)).toContain("Task 2");
  expect(result.isError).toBe(false);
});

it("rejects more than 8 parallel tasks before spawning anything", async () => {
  const harness = new ExtensionHarness();
  const tasks = Array.from({ length: 9 }, (_unused, index) => ({ agent: "worker", task: `task ${index}` }));
  const result = await harness.runTool("subagent", { tasks });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain("Too many parallel tasks: 9 (max 8)");
  expect(harness.env.starts()).toHaveLength(0);
});

it("runs at most four parallel children at a time", async () => {
  const harness = new ExtensionHarness();
  const tasks = Array.from({ length: 8 }, (_unused, index) => ({
    agent: "worker",
    task: `sleep [[sleep:250]] ${index}`,
  }));
  const result = await harness.runTool("subagent", { tasks });
  expect(result.isError).toBe(false);
  expect(subagentDetails(result).results).toHaveLength(8);
  expect(maxConcurrentChildren(harness.env)).toBe(4);
});

it("injects {previous} output into the next chain step", async () => {
  const harness = new ExtensionHarness();
  const result = await harness.runTool("subagent", {
    chain: [
      { agent: "worker", task: "first" },
      { agent: "worker", task: "second sees {previous}" },
    ],
  });
  const starts = harness.env.starts();
  expect(starts).toHaveLength(2);
  expect(starts[0].task).toBe("first");
  expect(starts[1].task).toBe("second sees result:first");
  expect(subagentDetails(result).mode).toBe("chain");
  expect(textOf(result)).toContain("Step 1");
  expect(textOf(result)).toContain("Step 2");
  expect(result.isError).toBe(false);
});

it("stops a chain after a failed step", async () => {
  const harness = new ExtensionHarness();
  const result = await harness.runTool("subagent", {
    chain: [
      { agent: "worker", task: "first" },
      { agent: "worker", task: "boom [[fail]]" },
      { agent: "worker", task: "never runs" },
    ],
  });
  expect(harness.env.starts()).toHaveLength(2);
  expect(subagentDetails(result).results).toHaveLength(2);
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain("fake pi: the child rejected this request");
});

it("asks for agent and task when no mode is given", async () => {
  const harness = new ExtensionHarness();
  const result = await harness.runTool("subagent", {});
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain("Provide agent and task, or tasks, or chain.");
  expect(textOf(result)).toContain("worker (package)");
  expect(harness.env.starts()).toHaveLength(0);
});

it("pstack_roles reports the effective map and the file that supplied it", async () => {
  const harness = new ExtensionHarness();
  harness.env.writeProjectRoles({ "bug-fix": "project/fix" });
  const result = await harness.runTool("pstack_roles", {}, { trusted: true });
  expect(textOf(result)).toContain("bug-fix: project/fix");
  expect(textOf(result)).toContain("config:");
  const details = result.details as {
    roles: Record<string, unknown>;
    sources: string[];
    defaults: Record<string, unknown>;
  };
  expect(details.roles["bug-fix"]).toBe("project/fix");
  expect(details.sources).toEqual([join(harness.env.projectDir, ".pi", "pstack-models.json")]);
  expect(details.defaults["bug-fix"]).toBe(DEFAULT_ROLES["bug-fix"]);
});

it("the /pstack-models command notifies the effective role map", async () => {
  const harness = new ExtensionHarness();
  const notifications = await harness.runCommand("pstack-models");
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toContain("bug-fix:");
  expect(notifications[0]).toContain("built-in defaults");
});

it("rejects an unsupported thinking level and a non-boolean readonly", () => {
  const tool = new ExtensionHarness().tool("subagent");
  const call = (args: Record<string, unknown>) => ({ type: "toolCall" as const, id: "call-1", name: "subagent", arguments: args });
  expect(() => validateToolArguments(tool, call({ agent: "worker", task: "x", thinking: "gigantic" }))).toThrow(
    "thinking",
  );
  expect(() => validateToolArguments(tool, call({ agent: "worker", task: "x", readonly: "yes" }))).toThrow(
    "readonly",
  );
  const validated = validateToolArguments(
    tool,
    call({
      agent: "worker",
      task: "x",
      role: "bug-fix",
      model: "some/model",
      thinking: "high",
      readonly: true,
      tools: "read, bash",
      cwd: "/tmp",
    }),
  ) as Record<string, unknown>;
  expect(validated.thinking).toBe("high");
  expect(validated.readonly).toBe(true);
});
