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
 * Built-in defaults. Every role inherits the parent session model, so an
 * unconfigured install assumes no provider and works in any pi setup. Panels
 * are the exception: a panel role is only a panel when its entries are
 * distinct models, so `/skill:setup-pstack` assigns it a list. Each panel
 * default is a one-entry list because the inherited runner is a single model.
 */
export const DEFAULT_ROLES: RoleConfig = {
  "feature, refactoring": "inherit-parent",
  "bug-fix": "inherit-parent",
  "perf-issue": "inherit-parent",
  hillclimb: "inherit-parent",
  "judgment and prose": "inherit-parent",
  "hardest tasks": "inherit-parent",
  "how explorer": "inherit-parent",
  "how explainer": "inherit-parent",
  "why investigators": "inherit-parent",
  "why synthesizer": "inherit-parent",
  "reflect tooling": "inherit-parent",
  "reflect judgment, reflect divergent, reflect synthesizer": "inherit-parent",
  "arena runners": ["inherit-parent"],
  "arena cross-judge pool": ["inherit-parent"],
  "swarm workers": "inherit-parent",
  "architect runners": ["inherit-parent"],
  "interrogate reviewers": ["inherit-parent"],
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
