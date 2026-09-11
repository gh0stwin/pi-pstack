/**
 * A small jest/bun-style `expect` for `node:test`.
 *
 * The upstream pstack scripts shipped their tests against `bun:test`. pi runs
 * on Node, and Node's built-in test runner has no `expect`, so this module
 * re-exports the runner's `describe` / `it` / `afterEach` and adds the matcher
 * surface the ported tests use. Keep the matcher list to what the tests need.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

export { afterEach, describe, it };

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

function fail(message: string): never {
  throw new AssertionError(message);
}

function format(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Structural subset comparison used by `toMatchObject` and `toEqual`. */
function deepEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
  if (actual instanceof Error && expected instanceof Error) {
    return actual.name === expected.name && actual.message === expected.message;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
    if (actual.length !== expected.length) return false;
    return actual.every((entry, index) => deepEqual(entry, expected[index]));
  }
  if (typeof actual === "object" && actual !== null && typeof expected === "object" && expected !== null) {
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const actualKeys = Object.keys(actualRecord).filter((key) => actualRecord[key] !== undefined);
    const expectedKeys = Object.keys(expectedRecord).filter((key) => expectedRecord[key] !== undefined);
    if (actualKeys.length !== expectedKeys.length) return false;
    return expectedKeys.every((key) => deepEqual(actualRecord[key], expectedRecord[key]));
  }
  return false;
}

function matchesObject(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((entry, index) => matchesObject(actual[index], entry));
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null) return false;
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    return Object.keys(expectedRecord).every((key) => matchesObject(actualRecord[key], expectedRecord[key]));
  }
  return false;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function throwsWith(error: unknown, expected: unknown): boolean {
  if (typeof expected === "string") return error instanceof Error && error.message.includes(expected);
  if (expected instanceof RegExp) return error instanceof Error && expected.test(error.message);
  if (typeof expected === "function") return error instanceof expected;
  return true;
}

class Matchers {
  protected readonly actual: unknown;
  protected readonly negated: boolean;

  constructor(actual: unknown, negated: boolean) {
    this.actual = actual;
    this.negated = negated;
  }

  protected check(passed: boolean, message: string): void {
    if (this.negated ? passed : !passed) {
      fail(this.negated ? `expected ${format(this.actual)} not to ${message}` : `expected ${format(this.actual)} to ${message}`);
    }
  }

  toBe(expected: unknown): void {
    this.check(Object.is(this.actual, expected), `be ${format(expected)}`);
  }

  toEqual(expected: unknown): void {
    this.check(deepEqual(this.actual, expected), `equal ${format(expected)}`);
  }

  toMatchObject(expected: unknown): void {
    this.check(matchesObject(this.actual, expected), `match ${format(expected)}`);
  }

  toContain(expected: unknown): void {
    const passed =
      typeof this.actual === "string"
        ? this.actual.includes(String(expected))
        : Array.isArray(this.actual) && this.actual.some((entry) => deepEqual(entry, expected));
    this.check(passed, `contain ${format(expected)}`);
  }

  toHaveLength(expected: number): void {
    const length = (this.actual as { length?: number } | null)?.length;
    this.check(length === expected, `have length ${expected} (got ${String(length)})`);
  }

  toBeInstanceOf(expected: new (...args: never[]) => unknown): void {
    this.check(this.actual instanceof expected, `be an instance of ${expected.name}`);
  }

  toBeNull(): void {
    this.check(this.actual === null, "be null");
  }

  toBeUndefined(): void {
    this.check(this.actual === undefined, "be undefined");
  }

  toBeDefined(): void {
    this.check(this.actual !== undefined, "be defined");
  }

  toEndWith(expected: string): void {
    this.check(typeof this.actual === "string" && this.actual.endsWith(expected), `end with ${format(expected)}`);
  }

  toThrow(expected?: unknown): void {
    if (typeof this.actual !== "function") fail(`expected ${format(this.actual)} to be a function`);
    let caught: unknown;
    try {
      (this.actual as () => unknown)();
    } catch (error) {
      caught = error;
    }
    this.check(caught !== undefined && throwsWith(caught, expected), `throw ${format(expected ?? "")}`);
  }
}

class RejectsMatchers {
  private readonly received: unknown;

  constructor(received: unknown) {
    this.received = received;
  }

  private async capture(): Promise<unknown> {
    const source = typeof this.received === "function" ? (this.received as () => unknown)() : this.received;
    if (!isPromiseLike(source)) fail(`expected ${format(this.received)} to be a promise or a function returning one`);
    try {
      await source;
    } catch (error) {
      return error;
    }
    return fail("expected promise to reject, but it resolved");
  }

  async toThrow(expected?: unknown): Promise<void> {
    const error = await this.capture();
    assert.ok(throwsWith(error, expected), `expected rejection ${format(error)} to match ${format(expected ?? "")}`);
  }

  async toBeInstanceOf(expected: new (...args: never[]) => unknown): Promise<void> {
    const error = await this.capture();
    assert.ok(error instanceof expected, `expected rejection ${format(error)} to be an instance of ${expected.name}`);
  }
}

export class Expectation extends Matchers {
  constructor(actual: unknown) {
    super(actual, false);
  }

  get not(): Matchers {
    return new Matchers(this.actual, true);
  }

  get rejects(): RejectsMatchers {
    return new RejectsMatchers(this.actual);
  }
}

export function expect(actual: unknown): Expectation {
  return new Expectation(actual);
}
