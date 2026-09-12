/**
 * Role to model configuration for pstack subagents.
 *
 * Replaces the upstream always-applied role rule with a pi-native JSON file
 * read by the subagent extension at spawn time:
 *
 *   ~/.pi/agent/pstack-models.json   user scope
 *   .pi/pstack-models.json           project scope (overrides user keys)
 *
 * Shape: role label -> model id, or role label -> list of model ids for panel
 * roles. Labels may group several roles with commas, exactly like upstream
 * ("feature, refactoring").
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

export type RoleValue = string | readonly string[];
export type RoleConfig = Record<string, RoleValue>;

/**
 * Defaults chosen from `pi --list-models` on the machine this port was built on.
 * `/skill:setup-pstack` rewrites these for the models a user actually has.
 */
export const DEFAULT_ROLES: RoleConfig = {
  "feature, refactoring": "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
  "bug-fix": "deepinfra/zai-org/GLM-5.3-Flash",
  "perf-issue": "deepinfra/zai-org/GLM-5.3-Flash",
  hillclimb: "deepinfra/zai-org/GLM-5.3-Flash",
  "judgment and prose": "deepinfra/zai-org/GLM-5.3-Flash",
  "hardest tasks": "deepinfra/zai-org/GLM-5.3-Flash",
  "how explorer": "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
  "how explainer": "deepinfra/zai-org/GLM-5.3-Flash",
  "why investigators": "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
  "why synthesizer": "deepinfra/zai-org/GLM-5.3-Flash",
  "reflect tooling": "deepinfra/google/gemini-3.1-pro",
  "reflect judgment, reflect divergent, reflect synthesizer": "deepinfra/zai-org/GLM-5.3-Flash",
  "arena runners": [
    "deepinfra/zai-org/GLM-5.3-Flash",
    "deepinfra/google/gemini-3.1-pro",
    "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
    "deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507",
  ],
  "arena cross-judge pool": [
    "deepinfra/zai-org/GLM-5.3-Flash",
    "deepinfra/google/gemini-3.1-pro",
    "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
    "deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507",
  ],
  "swarm workers": "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
  "architect runners": [
    "deepinfra/zai-org/GLM-5.3-Flash",
    "deepinfra/google/gemini-3.1-pro",
    "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
    "deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507",
  ],
  "interrogate reviewers": [
    "deepinfra/zai-org/GLM-5.3-Flash",
    "deepinfra/google/gemini-3.1-pro",
    "deepinfra/deepseek-ai/DeepSeek-V4-Flash-0731",
    "deepinfra/Qwen/Qwen3-235B-A22B-Thinking-2507",
  ],
};

/** `inherit-parent` and `auto` mean: run on the parent session model. */
export const INHERIT_VALUES = new Set(["inherit-parent", "auto"]);

export interface RoleConfigResult {
  readonly roles: RoleConfig;
  readonly sources: readonly string[];
}

function isRoleValue(value: unknown): value is RoleValue {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function readRoleFile(path: string): RoleConfig | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const roles: RoleConfig = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRoleValue(value)) roles[key] = value;
    }
    return roles;
  } catch {
    return null;
  }
}

/**
 * Load the effective role map. Defaults first, then user scope, then project
 * scope (when the project is trusted) so project entries win key by key.
 */
export function loadRoleConfig(cwd: string, projectTrusted: boolean): RoleConfigResult {
  const roles: RoleConfig = { ...DEFAULT_ROLES };
  const sources: string[] = [];
  const candidates = [
    join(getAgentDir(), "pstack-models.json"),
    ...(projectTrusted ? [join(cwd, CONFIG_DIR_NAME, "pstack-models.json")] : []),
  ];
  for (const path of candidates) {
    const fileRoles = readRoleFile(path);
    if (fileRoles === null) continue;
    sources.push(path);
    for (const [key, value] of Object.entries(fileRoles)) roles[key] = value;
  }
  return { roles, sources };
}

/**
 * Resolve a role label to one model id. A label matches itself, any
 * comma-separated member of a grouped label, or a case-insensitive spelling.
 * A panel role (list value) resolves to its first entry here; callers that
 * want the whole panel read the config file, which `/skill:setup-pstack` and
 * `pstack_roles` expose.
 */
export function resolveRoleModel(roles: RoleConfig, role: string): string | undefined {
  const wanted = role.trim().toLowerCase();
  const direct = Object.keys(roles).find((key) => key.toLowerCase() === wanted);
  const grouped =
    direct ??
    Object.keys(roles).find((key) =>
      key
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .includes(wanted),
    );
  if (grouped === undefined) return undefined;
  const value = roles[grouped];
  if (typeof value === "string") return value;
  return value[0];
}

/** Panel entries for a role label. Returns [] when the role is unknown. */
export function resolveRoleModels(roles: RoleConfig, role: string): readonly string[] {
  const wanted = role.trim().toLowerCase();
  const direct = Object.keys(roles).find((key) => key.toLowerCase() === wanted);
  const grouped =
    direct ??
    Object.keys(roles).find((key) =>
      key
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .includes(wanted),
    );
  if (grouped === undefined) return [];
  const value = roles[grouped];
  return typeof value === "string" ? [value] : value;
}
