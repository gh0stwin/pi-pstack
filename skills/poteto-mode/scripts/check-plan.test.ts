/**
 * Pins the multi-phase plan template to the linter that reads it.
 *
 * The template's trunk re-read command used to hardcode `origin/main`, and the
 * linter pinned that same literal. A plan copied on a master-trunk repository
 * therefore carried a command that errors. The template now resolves the
 * default branch and uses an `origin/<trunk>` placeholder, and the linter
 * requires a concrete ref plus the no-assumption rule.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "./testing/expect.ts";

const LINTER = join(import.meta.dirname, "check-plan.mjs");
const TEMPLATE = join(import.meta.dirname, "../playbooks/multi-phase-plan.md");

/** The fenced skeleton the multi-phase plan playbook tells the planner to copy. */
function templatePlan(): string {
	const lines = readFileSync(TEMPLATE, "utf8").split("\n");
	const start = lines.indexOf("````markdown");
	const end = lines.indexOf("````", start + 1);
	if (start === -1 || end === -1) throw new Error(`plan template fence not found in ${TEMPLATE}`);
	return lines.slice(start + 1, end).join("\n");
}

function runLinter(plan: string): { readonly status: number; readonly stderr: string } {
	const directory = mkdtempSync(join(tmpdir(), "check-plan-test-"));
	try {
		const file = join(directory, "plan.md");
		writeFileSync(file, plan);
		const result = spawnSync(process.execPath, [LINTER, file], { encoding: "utf8" });
		return { status: result.status ?? -1, stderr: result.stderr };
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe("check-plan.mjs and the plan template", () => {
	it("accepts the template once the trunk placeholder is resolved", () => {
		const { status, stderr } = runLinter(templatePlan().replaceAll("<trunk>", "master"));
		expect(stderr).toBe("");
		expect(status).toBe(0);
	});

	it("rejects a plan that leaves the trunk placeholder unresolved", () => {
		const { status, stderr } = runLinter(templatePlan());
		expect(status).toBe(1);
		expect(stderr).toContain("Program checklist lacks");
	});
});
