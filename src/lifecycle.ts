import { StorekeeperDB } from "./runtime.js";
import type {
  DerivationSnapshot,
  StorekeeperDebugAPI,
  StorekeeperGarbageCollectionOptions,
  StorekeeperGarbageCollectionResult,
} from "./types.js";

type StatementLike = {
  run(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
};

type RuntimeInternals = {
  prepare(sql: string): StatementLike;
  derivationCache: Map<string, unknown>;
};

type BaseDebugAPI = {
  recentMagic(limit?: number): unknown[];
  derivations(stateKey?: string): DerivationSnapshot[];
  evict(stateKey: string, paths: string[]): void;
  rebuild(stateKey: string, paths: string[]): void;
  compactMetadata(limit?: number): { magicLogsDeleted: number };
};

type PatchablePrototype = typeof StorekeeperDB.prototype & {
  __storekeeperDerivedLifecyclePatchApplied?: boolean;
};

const prototype = StorekeeperDB.prototype as PatchablePrototype;

if (!prototype.__storekeeperDerivedLifecyclePatchApplied) {
  const originalDebug = StorekeeperDB.prototype.debug;

  StorekeeperDB.prototype.debug = function patchedDebug(): StorekeeperDebugAPI {
    const base = originalDebug.call(this) as BaseDebugAPI;
    const runtime = this as unknown as RuntimeInternals;

    const logMagic = (action: string, stateKey: string, path: string, reason: string): void => {
      runtime.prepare("INSERT INTO __sk_magic_log(action,state_key,path,reason) VALUES(?,?,?,?)").run(action, stateKey, path, reason);
    };

    const clearCache = (stateKey?: string): void => {
      if (stateKey) runtime.derivationCache.delete(stateKey);
      else runtime.derivationCache.clear();
    };

    const markCold = (stateKey: string, paths: string[], reason = "debug mark cold"): void => {
      for (const path of paths) {
        runtime
          .prepare("UPDATE __sk_derivations SET state='cold' WHERE state_key=? AND path=? AND kind='projection'")
          .run(stateKey, path);
        logMagic("project_mark_cold", stateKey, path, reason);
      }
      clearCache(stateKey);
    };

    const selectDerivations = (stateKey?: string): DerivationSnapshot[] => {
      const sql = stateKey
        ? "SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations WHERE kind='projection' AND state_key=? ORDER BY state_key,path"
        : "SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations WHERE kind='projection' ORDER BY state_key,path";
      return (stateKey ? runtime.prepare(sql).all(stateKey) : runtime.prepare(sql).all()) as DerivationSnapshot[];
    };

    const evictOne = (row: DerivationSnapshot, reason: string): void => {
      base.evict(row.state_key, [row.path]);
      logMagic("project_gc_evict", row.state_key, row.path, reason);
    };

    const collectGarbage = (options: StorekeeperGarbageCollectionOptions = {}): StorekeeperGarbageCollectionResult => {
      let evicted = 0;
      let cold = 0;
      const seen = new Set<string>();
      const initialRows = selectDerivations(options.stateKey);

      const timeCandidates = options.force ? initialRows : initialRows.filter((row) => row.state === "cold");
      for (const row of timeCandidates) {
        evictOne(row, options.force ? "debug forced derived garbage collection" : "cold derived projection garbage collection");
        seen.add(`${row.state_key}\u0000${row.path}`);
        evicted++;
      }

      if (typeof options.maxDerivations === "number" && Number.isFinite(options.maxDerivations)) {
        const remaining = selectDerivations(options.stateKey)
          .filter((row) => !seen.has(`${row.state_key}\u0000${row.path}`))
          .sort((a, b) => {
            const stateRank = (state: string) => (state === "cold" ? 0 : state === "hot" ? 2 : 1);
            return (
              stateRank(a.state) - stateRank(b.state) ||
              a.use_count - b.use_count ||
              b.storage_cost - a.storage_cost ||
              a.path.localeCompare(b.path)
            );
          });
        const over = Math.max(0, remaining.length - Math.max(0, Math.floor(options.maxDerivations)));
        for (const row of remaining.slice(0, over)) {
          evictOne(row, `derived projection budget exceeded: maxDerivations=${options.maxDerivations}`);
          seen.add(`${row.state_key}\u0000${row.path}`);
          evicted++;
        }
      }

      if (options.markCold && !options.force) {
        const rows = selectDerivations(options.stateKey).filter((row) => !seen.has(`${row.state_key}\u0000${row.path}`));
        for (const row of rows) {
          if (row.state !== "cold") {
            markCold(row.state_key, [row.path], "derived garbage collection marked projection cold");
            cold++;
          }
        }
      }

      clearCache(options.stateKey);
      return { cold, evicted };
    };

    return {
      ...base,
      markCold,
      collectGarbage,
    };
  };

  prototype.__storekeeperDerivedLifecyclePatchApplied = true;
}
