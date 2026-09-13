/**
 * Behavior tests for the role-to-model configuration the skills route through.
 *
 * Every assertion goes through the module's exported entry points, so a change
 * that breaks a role label the skills pass, config precedence, or panel-list
 * handling fails here rather than in a live subagent call.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "../../skills/poteto-mode/scripts/testing/expect.ts";
import { DEFAULT_ROLES, INHERIT_VALUES, loadRoleConfig, resolveRoleModel, resolveRoleModels } from "./config.ts";
import { cleanupTempDirs, TestEnv, withAgentDir } from "./test-harness.ts";

afterEach(cleanupTempDirs);

/** Role labels the skills pass explicitly in `subagent` calls. */
const SKILL_ROLE_CALLS = [
  "bug-fix",
  "feature",
  "refactoring",
  "perf-issue",
  "hillclimb",
  "swarm workers",
  "reflect synthesizer",
  "judgment and prose",
];

/** Panel roles whose config value is a list, one subagent per entry. */
const PANEL_ROLES = ["arena runners", "arena cross-judge pool", "architect runners", "interrogate reviewers"];

it("ships a resolvable default model for every role the skills pass", () => {
  for (const role of [...SKILL_ROLE_CALLS, ...PANEL_ROLES]) {
    const model = resolveRoleModel(DEFAULT_ROLES, role);
    expect(typeof model).toBe("string");
    expect((model ?? "").length > 0).toBe(true);
  }
  expect(Object.keys(DEFAULT_ROLES)).toContain("feature, refactoring");
  expect(resolveRoleModels(DEFAULT_ROLES, "interrogate reviewers")).toHaveLength(4);
});

it("resolves direct labels, comma-grouped members, and case-insensitive spellings", () => {
  const roles = { "feature, refactoring": "fast/model", "bug-fix": "fix/model" };
  expect(resolveRoleModel(roles, "bug-fix")).toBe("fix/model");
  expect(resolveRoleModel(roles, "feature")).toBe("fast/model");
  expect(resolveRoleModel(roles, "refactoring")).toBe("fast/model");
  expect(resolveRoleModel(roles, "BUG-FIX")).toBe("fix/model");
  expect(resolveRoleModel(roles, "  bug-fix  ")).toBe("fix/model");
  expect(resolveRoleModel(roles, "missing")).toBeUndefined();
});

it("resolves a panel role to its full list and to its first entry for a single model", () => {
  const roles = { "interrogate reviewers": ["a/one", "b/two"] };
  expect(resolveRoleModels(roles, "interrogate reviewers")).toEqual(["a/one", "b/two"]);
  expect(resolveRoleModel(roles, "interrogate reviewers")).toBe("a/one");
  expect(resolveRoleModels(roles, "no-such-role")).toEqual([]);
});

it("keeps inherit-parent and auto as parent-model aliases, not model ids", () => {
  expect(INHERIT_VALUES.has("inherit-parent")).toBe(true);
  expect(INHERIT_VALUES.has("auto")).toBe(true);
  expect(INHERIT_VALUES.has("deepinfra/zai-org/GLM-5.3-Flash")).toBe(false);
  expect(resolveRoleModel({ fast: "inherit-parent", smart: "auto" }, "fast")).toBe("inherit-parent");
  expect(resolveRoleModel({ fast: "inherit-parent", smart: "auto" }, "smart")).toBe("auto");
});

it("loads built-in defaults when no config files exist", async () => {
  const env = new TestEnv();
  const result = await withAgentDir(env.agentDir, async () => loadRoleConfig(env.projectDir, true));
  expect(result.sources).toEqual([]);
  expect(result.roles["bug-fix"]).toBe(DEFAULT_ROLES["bug-fix"]);
});

it("overlays user config then trusted project config key by key", async () => {
  const env = new TestEnv();
  env.writeUserRoles({ "bug-fix": "user/fix", custom: "user/custom" });
  env.writeProjectRoles({ "bug-fix": "project/fix" });
  const result = await withAgentDir(env.agentDir, async () => loadRoleConfig(env.projectDir, true));
  expect(result.roles["bug-fix"]).toBe("project/fix");
  expect(result.roles.custom).toBe("user/custom");
  expect(result.roles["feature, refactoring"]).toBe(DEFAULT_ROLES["feature, refactoring"]);
  expect(result.sources).toEqual([
    join(env.agentDir, "pstack-models.json"),
    join(env.projectDir, ".pi", "pstack-models.json"),
  ]);
});

it("ignores the project config when the project is not trusted", async () => {
  const env = new TestEnv();
  env.writeUserRoles({ "bug-fix": "user/fix" });
  env.writeProjectRoles({ "bug-fix": "project/fix" });
  const result = await withAgentDir(env.agentDir, async () => loadRoleConfig(env.projectDir, false));
  expect(result.roles["bug-fix"]).toBe("user/fix");
  expect(result.sources).toEqual([join(env.agentDir, "pstack-models.json")]);
});

it("ignores malformed files and role values that are not strings or string lists", async () => {
  const env = new TestEnv();
  const userConfig = join(env.agentDir, "pstack-models.json");
  writeFileSync(userConfig, "{ not json", "utf8");
  const broken = await withAgentDir(env.agentDir, async () => loadRoleConfig(env.projectDir, true));
  expect(broken.sources).toEqual([]);
  expect(broken.roles["bug-fix"]).toBe(DEFAULT_ROLES["bug-fix"]);

  writeFileSync(
    userConfig,
    JSON.stringify({ good: "good/model", bad: 123, list: ["a/one", "b/two"], mixed: ["a/one", 1] }),
    "utf8",
  );
  const parsed = await withAgentDir(env.agentDir, async () => loadRoleConfig(env.projectDir, true));
  expect(parsed.sources).toEqual([userConfig]);
  expect(parsed.roles.good).toBe("good/model");
  expect(parsed.roles.bad).toBeUndefined();
  expect(parsed.roles.list).toEqual(["a/one", "b/two"]);
  expect(parsed.roles.mixed).toBeUndefined();
});
