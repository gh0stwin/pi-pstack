/**
 * Agent definition discovery for the pstack subagent tool.
 *
 * Agent files are Markdown with YAML frontmatter:
 *
 *   ---
 *   name: worker
 *   description: General-purpose agent with the full tool set.
 *   tools: read, bash, edit, write   # optional; string or list
 *   model: provider/model-id         # optional; pi model id
 *   readonly: false                  # optional; true pins read-only tools
 *   ---
 *   System prompt for the subagent goes here.
 *
 * Search order, later wins: package `agents/`, user `~/.pi/agent/agents/`,
 * project `.pi/agents/` (only for trusted projects).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export interface AgentConfig {
  readonly name: string;
  readonly description: string;
  readonly tools?: readonly string[];
  readonly model?: string;
  readonly readonly?: boolean;
  readonly systemPrompt: string;
  readonly source: "package" | "user" | "project";
  readonly filePath: string;
}

type AgentFrontmatter = {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
  readonly?: unknown;
};

const READONLY_TOOLS = ["read", "grep", "find", "ls"];

function parseToolList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tools = raw
    .filter((tool): tool is string => typeof tool === "string")
    .map((tool) => tool.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

function loadAgentsFromDir(dir: string, source: AgentConfig["source"]): AgentConfig[] {
  if (!fs.existsSync(dir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: AgentConfig[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    let parsed: { frontmatter: AgentFrontmatter; body: string };
    try {
      parsed = parseFrontmatter<AgentFrontmatter>(content);
    } catch {
      // A malformed file is skipped like an unreadable one: one bad agent
      // definition must not take down discovery for every other agent.
      continue;
    }
    const { frontmatter, body } = parsed;
    if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") continue;
    const readonly = frontmatter.readonly === true;
    const tools = readonly ? READONLY_TOOLS : parseToolList(frontmatter.tools);
    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools,
      model: typeof frontmatter.model === "string" && frontmatter.model.length > 0 ? frontmatter.model : undefined,
      readonly,
      systemPrompt: body,
      source,
      filePath,
    });
  }
  return agents;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = cwd;
  for (;;) {
    const candidate = path.join(current, CONFIG_DIR_NAME, "agents");
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function packageAgentsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "agents");
}

export interface DiscoverAgentsOptions {
  readonly projectTrusted: boolean;
}

export function discoverAgents(cwd: string, options: DiscoverAgentsOptions): AgentConfig[] {
  const projectDir = options.projectTrusted ? findNearestProjectAgentsDir(cwd) : null;
  const map = new Map<string, AgentConfig>();
  for (const agent of loadAgentsFromDir(packageAgentsDir(), "package")) map.set(agent.name, agent);
  for (const agent of loadAgentsFromDir(path.join(getAgentDir(), "agents"), "user")) map.set(agent.name, agent);
  if (projectDir !== null) {
    for (const agent of loadAgentsFromDir(projectDir, "project")) map.set(agent.name, agent);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
