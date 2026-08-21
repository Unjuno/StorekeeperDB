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
    rejects(fn: () => Promise<unknown>, error?: RegExp, message?: string): Promise<void>;
  };
  export default assert;
}

declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:fs" {
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:os" {
  export function tmpdir(): string;
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
  exit(code?: number): never;
};

declare module "node:perf_hooks" {
  export const performance: { now(): number };
}

declare function setTimeout(handler: () => void, timeout?: number): unknown;
