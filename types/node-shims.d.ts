declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
  export class StatementSync {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, error?: RegExp, message?: string): void;
  };
  export default assert;
}

declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:perf_hooks" {
  export const performance: { now(): number };
}

declare module "node:child_process" {
  export function execFileSync(
    command: string,
    args: string[],
    options: { encoding: "utf8"; stdio?: "pipe" },
  ): string;
  export function execFileSync(
    command: string,
    args: string[],
    options?: { stdio?: "inherit" | "pipe" },
  ): unknown;
}

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare const process: {
  hrtime: { bigint(): bigint };
  versions: { node: string };
  platform: string;
  arch: string;
  execPath: string;
  argv: string[];
  exit(code?: number): never;
};
