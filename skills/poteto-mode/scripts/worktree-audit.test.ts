/**
 * Regression tests for worktree-audit.sh's session lookup and trunk resolution.
 *
 * The lookup used to pass worktree paths to `rg -e` as regex patterns, so a
 * path containing `.` could match a sibling worktree's session file, and a
 * path containing a regex metacharacter such as `(` produced an invalid
 * pattern whose suppressed error silently dropped the worktree's own recent
 * session. Either way the LAST_SESSION column (and the bucket derived from it)
 * was wrong. These fixtures run the real script against a real git repo whose
 * worktree paths contain regex metacharacters.
 *
 * The merge check used to hardcode `origin/main`, so a master-trunk repo
 * classified every worktree as unmerged and pushed it to the `review` bucket.
 * The trunk tests below pin the derived default and the `--trunk` override.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "./testing/expect.ts";

const SCRIPT = join(import.meta.dirname, "worktree-audit.sh");
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function git(repo: string, args: readonly string[]): void {
	const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

/** Mirrors worktree-audit.sh's `slugify` so the repo-level session dir matches. */
function slugify(path: string): string {
	return path.replace(/^\//, "").replace(/\//g, "-");
}

interface Fixture {
	readonly directory: string;
	readonly main: string;
	readonly sessionDir: string;
	readonly repoSessionDir: string;
}

async function makeFixture(
	worktrees: readonly string[],
	options: { readonly branch?: string } = {}
): Promise<Fixture> {
	const directory = await mkdtemp(join(tmpdir(), "worktree-audit-test-"));
	directories.push(directory);

	const main = join(directory, "main");
	await mkdir(main);
	git(main, ["init", "--quiet", `--initial-branch=${options.branch ?? "main"}`]);
	git(main, ["config", "user.name", "Worktree Audit Test"]);
	git(main, ["config", "user.email", "worktree-audit@example.com"]);
	await writeFile(join(main, "main.txt"), "main\n");
	git(main, ["add", "."]);
	git(main, ["commit", "--quiet", "-m", "main"]);

	for (const relative of worktrees) {
		const worktree = join(directory, relative);
		await mkdir(dirname(worktree), { recursive: true });
		git(main, ["worktree", "add", "--quiet", "--detach", worktree]);
	}

	const sessionDir = join(directory, "sessions");
	const repoSessionDir = join(sessionDir, `--${slugify(main)}--`);
	await mkdir(repoSessionDir, { recursive: true });
	return { directory, main, sessionDir, repoSessionDir };
}

/** Writes a pi-style JSONL session that names `worktree` both bare and in a file path. */
async function writeSession(
	repoSessionDir: string,
	name: string,
	worktree: string,
	mtime: Date
): Promise<void> {
	const path = join(repoSessionDir, name);
	await writeFile(
		path,
		`${JSON.stringify({ type: "session", cwd: worktree, path: join(worktree, "src", "file.ts") })}\n`
	);
	await utimes(path, mtime, mtime);
}

interface AuditRow {
	readonly merged: string;
	readonly last: string;
	readonly bucket: string;
}

function runAudit(fixture: Fixture, args: readonly string[] = []): Map<string, AuditRow> {
	const result = spawnSync("bash", [SCRIPT, ...args, fixture.main], {
		encoding: "utf8",
		env: { ...process.env, PI_CODING_AGENT_SESSION_DIR: fixture.sessionDir },
	});
	if (result.status !== 0) throw new Error(`worktree-audit.sh failed (${result.status}): ${result.stderr}`);
	const rows = new Map<string, AuditRow>();
	for (const line of result.stdout.split("\n").slice(1)) {
		if (line === "") continue;
		const fields = line.split("\t");
		rows.set(fields[8], { merged: fields[2], last: fields[6], bucket: fields[7] });
	}
	return rows;
}

describe("worktree-audit.sh session lookup", () => {
	it("does not attribute a sibling worktree's session to a path whose regex metacharacter matches it", async () => {
		const fixture = await makeFixture(["foo.bar/wt", "fooXbar/wt"]);
		const fooDotBar = join(fixture.directory, "foo.bar/wt");
		const fooXbar = join(fixture.directory, "fooXbar/wt");
		// Only fooXbar/wt has a session; the old date makes any leak into
		// foo.bar/wt (whose `.` regex matches the `X`) obvious.
		await writeSession(fixture.repoSessionDir, "fooXbar.jsonl", fooXbar, new Date("2020-01-02T12:00:00"));

		const rows = runAudit(fixture);
		expect(rows.get(fooXbar)?.last).toBe("2020-01-02");
		expect(rows.get(fooDotBar)?.last).toBe("-");
		expect(rows.get(fooDotBar)?.bucket).toBe("safe");
	});

	it("finds a worktree's own recent session when its path contains a regex metacharacter", async () => {
		const fixture = await makeFixture(["foo(bar/wt", "plain/wt"]);
		const fooParen = join(fixture.directory, "foo(bar/wt");
		const plain = join(fixture.directory, "plain/wt");
		await writeSession(fixture.repoSessionDir, "foo-paren.jsonl", fooParen, new Date());
		await writeSession(fixture.repoSessionDir, "plain.jsonl", plain, new Date());

		const rows = runAudit(fixture);
		for (const worktree of [fooParen, plain]) {
			const row = rows.get(worktree);
			expect(row?.last).not.toBe("-");
			expect(row?.bucket).toBe("verify-recent-session");
		}
	});
});

describe("worktree-audit.sh trunk resolution", () => {
	it("classifies worktrees against a master trunk instead of assuming main", async () => {
		const fixture = await makeFixture(["current/wt", "ahead/wt"], { branch: "master" });
		const current = join(fixture.directory, "current/wt");
		const ahead = join(fixture.directory, "ahead/wt");
		// One worktree carries its own unmerged commit; the other stays current.
		await writeFile(join(ahead, "ahead.txt"), "ahead\n");
		git(ahead, ["add", "."]);
		git(ahead, ["commit", "--quiet", "-m", "ahead"]);
		await writeFile(join(fixture.main, "next.txt"), "next\n");
		git(fixture.main, ["add", "."]);
		git(fixture.main, ["commit", "--quiet", "-m", "next"]);
		git(current, ["merge", "--ff-only", "master"]);

		const rows = runAudit(fixture);
		expect(rows.get(current)?.merged).toBe("YES");
		expect(rows.get(current)?.bucket).toBe("safe");
		expect(rows.get(ahead)?.merged).toBe("no");
		expect(rows.get(ahead)?.bucket).toBe("review");
	});

	it("resolves the trunk from origin's default branch", async () => {
		const fixture = await makeFixture([], { branch: "main" });
		const origin = join(fixture.directory, "origin.git");
		git(fixture.directory, ["init", "--bare", "--quiet", "--initial-branch=trunkline", origin]);
		git(fixture.main, ["remote", "add", "origin", origin]);
		git(fixture.main, ["push", "--quiet", "origin", "main:trunkline", "main:main"]);
		await writeFile(join(fixture.main, "next.txt"), "next\n");
		git(fixture.main, ["add", "."]);
		git(fixture.main, ["commit", "--quiet", "-m", "next"]);
		git(fixture.main, ["push", "--quiet", "origin", "main:trunkline"]);
		const worktree = join(fixture.directory, "wt");
		await mkdir(dirname(worktree), { recursive: true });
		git(fixture.main, ["worktree", "add", "--quiet", "--detach", worktree]);

		// origin's default `trunkline` is current while `origin/main` is stale, so
		// the merge check must follow origin's HEAD rather than the `main` literal.
		const rows = runAudit(fixture);
		expect(rows.get(worktree)?.merged).toBe("YES");
		expect(rows.get(worktree)?.bucket).toBe("safe");
	});

	it("honors an explicit --trunk branch", async () => {
		const fixture = await makeFixture([], { branch: "develop" });
		git(fixture.main, ["branch", "master"]);
		await writeFile(join(fixture.main, "develop.txt"), "develop\n");
		git(fixture.main, ["add", "."]);
		git(fixture.main, ["commit", "--quiet", "-m", "develop"]);
		const worktree = join(fixture.directory, "wt");
		await mkdir(dirname(worktree), { recursive: true });
		git(fixture.main, ["worktree", "add", "--quiet", "--detach", worktree]);

		// The derived default is the main worktree's `develop`; the override names
		// `master`, which does not contain the worktree's develop-tip commit.
		expect(runAudit(fixture).get(worktree)?.merged).toBe("YES");
		expect(runAudit(fixture, ["--trunk", "master"]).get(worktree)?.merged).toBe("no");
	});
});
