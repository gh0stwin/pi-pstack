/**
 * Behavior tests for the bundled agent definitions and their discovery order.
 *
 * The skills name `worker`, `poteto-agent`, and `comment-sicko` directly and
 * rely on `readonly: true` meaning the four read tools, so these tests load the
 * real `agents/` directory and the real discovery code.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "../../skills/poteto-mode/scripts/testing/expect.ts";
import { type AgentConfig, discoverAgents, packageAgentsDir } from "./agents.ts";
import { cleanupTempDirs, TestEnv, withAgentDir } from "./test-harness.ts";

afterEach(cleanupTempDirs);

function agentFile(
  name: string,
  options: { description?: string; tools?: string; readonly?: boolean; model?: string } = {},
  body = `${name} body`,
): string {
  const lines = ["---", `name: ${name}`, `description: ${options.description ?? `${name} agent`}`];
  if (options.tools !== undefined) lines.push(`tools: ${options.tools}`);
  if (options.readonly === true) lines.push("readonly: true");
  if (options.model !== undefined) lines.push(`model: ${options.model}`);
  lines.push("---", body, "");
  return lines.join("\n");
}

function agentNamed(agents: readonly AgentConfig[], name: string): AgentConfig {
  const agent = agents.find((candidate) => candidate.name === name);
  if (agent === undefined) throw new Error(`missing agent: ${name}`);
  return agent;
}

async function discover(env: TestEnv, cwd: string, trusted: boolean): Promise<AgentConfig[]> {
  return withAgentDir(env.agentDir, async () => discoverAgents(cwd, { projectTrusted: trusted }));
}

it("discovers the three bundled agents", async () => {
  const env = new TestEnv();
  const agents = await discover(env, env.projectDir, false);
  expect(agents.map((agent) => agent.name)).toEqual(["comment-sicko", "poteto-agent", "worker"]);

  const worker = agentNamed(agents, "worker");
  expect(worker.source).toBe("package");
  expect(worker.filePath.startsWith(packageAgentsDir())).toBe(true);
  expect(worker.readonly).toBe(false);
  expect(worker.tools).toBeUndefined();
  expect(worker.description.length > 0).toBe(true);
  expect(worker.systemPrompt.length > 0).toBe(true);

  const sicko = agentNamed(agents, "comment-sicko");
  expect(sicko.source).toBe("package");
  expect(sicko.readonly).toBe(true);
  expect(sicko.tools).toEqual(["read", "grep", "find", "ls"]);
  expect(sicko.systemPrompt.length > 0).toBe(true);

  const poteto = agentNamed(agents, "poteto-agent");
  expect(poteto.source).toBe("package");
  expect(poteto.systemPrompt.length > 0).toBe(true);
});

it("pins readonly agents to the four read tools even when frontmatter lists write tools", async () => {
  const env = new TestEnv();
  env.writeUserAgent("locked.md", agentFile("locked", { readonly: true, tools: "read, bash, edit, write" }));
  const agents = await discover(env, env.projectDir, false);
  const locked = agentNamed(agents, "locked");
  expect(locked.readonly).toBe(true);
  expect(locked.tools).toEqual(["read", "grep", "find", "ls"]);
});

it("reads tools and model frontmatter as a string or a list", async () => {
  const env = new TestEnv();
  env.writeUserAgent("comma.md", agentFile("comma", { tools: "read, bash" }));
  env.writeUserAgent(
    "listed.md",
    "---\nname: listed\ndescription: listed agent\ntools:\n  - read\n  - grep\nmodel: agent/model\n---\nbody\n",
  );
  const agents = await discover(env, env.projectDir, false);
  expect(agentNamed(agents, "comma").tools).toEqual(["read", "bash"]);
  expect(agentNamed(agents, "listed").tools).toEqual(["read", "grep"]);
  expect(agentNamed(agents, "listed").model).toBe("agent/model");
});

it("lets user agents override package agents and project agents override user agents", async () => {
  const env = new TestEnv();
  env.writeUserAgent("worker.md", agentFile("worker", { description: "user worker" }, "user body"));
  env.writeProjectAgent("worker.md", agentFile("worker", { description: "project worker" }, "project body"));

  const untrusted = await discover(env, env.projectDir, false);
  const userWorker = agentNamed(untrusted, "worker");
  expect(userWorker.source).toBe("user");
  expect(userWorker.description).toBe("user worker");
  expect(userWorker.systemPrompt).toBe("user body");

  const trusted = await discover(env, env.projectDir, true);
  const projectWorker = agentNamed(trusted, "worker");
  expect(projectWorker.source).toBe("project");
  expect(projectWorker.description).toBe("project worker");
  expect(projectWorker.systemPrompt).toBe("project body");
});

it("finds the nearest project agents directory from a nested cwd", async () => {
  const env = new TestEnv();
  env.writeProjectAgent("nested.md", agentFile("nested"));
  const nestedCwd = join(env.projectDir, "packages", "app");
  mkdirSync(nestedCwd, { recursive: true });
  const agents = await discover(env, nestedCwd, true);
  const nested = agentNamed(agents, "nested");
  expect(nested.source).toBe("project");
  expect(nested.filePath).toBe(join(env.projectDir, ".pi", "agents", "nested.md"));
});

it("skips markdown without name and description and non-markdown files", async () => {
  const env = new TestEnv();
  env.writeUserAgent("no-name.md", "---\ndescription: no name here\n---\nbody\n");
  env.writeUserAgent("ok.md", agentFile("ok"));
  writeFileSync(join(env.agentDir, "agents", "notes.txt"), "not an agent", "utf8");
  const agents = await discover(env, env.projectDir, false);
  expect(agents.map((agent) => agent.name)).toContain("ok");
  expect(agents.some((agent) => agent.name === "no-name")).toBe(false);
  expect(agents.every((agent) => agent.filePath.endsWith(".md"))).toBe(true);
});
