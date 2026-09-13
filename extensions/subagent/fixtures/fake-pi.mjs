#!/usr/bin/env node
/**
 * Deterministic stand-in for the `pi` CLI used by the subagent extension tests.
 *
 * The extension spawns a real child process per subagent; these tests keep that
 * spawn path real but replace the model run with this script. It records the
 * argv, cwd, and appended system prompt the extension built, then emits the
 * same newline-delimited `message_end` event a live `pi --mode json` run emits.
 *
 * Task markers steer failure behavior:
 *   [[sleep:<ms>]]    pause before emitting, so tests can observe concurrency
 *   [[fail]]          exit non-zero with stderr, like a crashed child
 *   [[model-error]]   emit an assistant error message for a rejected model
 */
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const logPath = process.env.FAKE_PI_LOG;

function flag(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const taskArg = argv.find((arg) => arg.startsWith("Task: "));
const task = taskArg === undefined ? "" : taskArg.slice("Task: ".length);
const model = flag("--model");
const tools = flag("--tools");
const thinking = flag("--thinking");
const promptPath = flag("--append-system-prompt");
const agentDir = process.env.PI_CODING_AGENT_DIR ?? null;
let systemPrompt = null;
try {
  systemPrompt = promptPath === undefined ? null : readFileSync(promptPath, "utf8");
} catch {
  systemPrompt = "<unreadable>";
}

function record(event) {
  if (!logPath) return;
  appendFileSync(
    logPath,
    `${JSON.stringify({
      event,
      at: Date.now(),
      pid: process.pid,
      cwd: process.cwd(),
      argv,
      model,
      tools,
      thinking,
      task,
      systemPrompt,
      agentDir,
    })}\n`,
  );
}

function emit(message) {
  process.stdout.write(`${JSON.stringify({ type: "message_end", message })}\n`);
}

record("start");

const sleep = /\[\[sleep:(\d+)\]\]/.exec(task);
if (sleep) await new Promise((resolve) => setTimeout(resolve, Number(sleep[1])));

const usage = { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, cost: { total: 0.001 }, totalTokens: 18 };
let exitCode = 0;

if (task.includes("[[model-error]]")) {
  emit({
    role: "assistant",
    content: [{ type: "text", text: "the child rejected the model" }],
    usage,
    model: model ?? "fake/default",
    stopReason: "error",
    errorMessage: `Model not found: ${model ?? "(none)"}`,
  });
  exitCode = 1;
} else if (task.includes("[[fail]]")) {
  process.stderr.write("fake pi: the child rejected this request\n");
  exitCode = 3;
} else {
  emit({
    role: "assistant",
    content: [{ type: "text", text: `result:${task}` }],
    usage,
    model: model ?? "fake/default",
    stopReason: "stop",
  });
}

record("end");
process.exit(exitCode);
