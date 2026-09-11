import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Install the scripts' runtime dependency (`commander`) on first use.
 *
 * pi installs a git package with `npm install` at the package root, so this is
 * a fallback for running the scripts straight from a clone. It resolves
 * `commander` from the package root, not from `scripts/`, because Node walks
 * up from the importing file and the root is where pi installs dependencies.
 */
const scriptsDirectory = import.meta.dirname;
const packageRoot = resolve(scriptsDirectory, "..", "..", "..");
const commanderPackagePath = join(packageRoot, "node_modules", "commander", "package.json");
const installKeyPath = join(packageRoot, "node_modules", ".pi-pstack-install-key");

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function currentInstallKey(): string {
  return createHash("sha256")
    .update(readIfPresent(join(packageRoot, "package.json")))
    .update("\0")
    .update(readIfPresent(join(packageRoot, "package-lock.json")))
    .digest("hex");
}

export function ensureDependenciesInstalled(): void {
  const installKey = currentInstallKey();
  if (
    existsSync(commanderPackagePath) &&
    existsSync(installKeyPath) &&
    readFileSync(installKeyPath, "utf8").trim() === installKey
  ) {
    return;
  }

  const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`npm install exited with status ${String(result.status)}`);
  }
  if (!existsSync(commanderPackagePath)) {
    throw new Error("npm install completed without installing commander");
  }

  writeFileSync(installKeyPath, `${installKey}\n`);

  const restarted = spawnSync(process.execPath, process.argv.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  process.exit(restarted.status ?? 1);
}
