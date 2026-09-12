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

it("ships a no-Slack setup path and the GitHub workflow templates", () => {
  const setup = readFileSync(join(packageRoot, "automations", "benny", "skills", "setup-benny", "SKILL.md"), "utf8");
  expect(setup).toContain("intake.source");
  expect(setup).toContain("benny-github-triage.yml");
  expect(setup).toContain("benny-github-reproduce.yml");

  for (const file of ["benny-github-triage.yml", "benny-github-reproduce.yml"]) {
    const text = readFileSync(join(packageRoot, "automations", "benny", "templates", file), "utf8");
    expect(text).toContain("benny-run.ts");
    expect(text).toContain("--mode");
    expect(text).toContain("--event");
    expect(text).not.toContain("BENNY_SLACK_BOT_TOKEN");
  }
});
