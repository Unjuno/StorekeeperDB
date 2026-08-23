import { StorekeeperDB } from "./runtime.js";
import type {
  DerivationSnapshot,
  MagicLogRow,
  StorekeeperDebugAPI,
  StorekeeperGarbageCollectionOptions,
  StorekeeperGarbageCollectionResult,
  StorekeeperMetadataCompactionOptions,
  StorekeeperMetadataCompactionResult,
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
  recentMagic(limit?: number): MagicLogRow[];
  derivations(stateKey?: string): DerivationSnapshot[];
  evict(stateKey: string, paths: string[]): void;
  rebuild(stateKey: string, paths: string[]): void;
  compactMetadata(limit?: number): { magicLogsDeleted: number };
};

type PatchablePrototype = typeof StorekeeperDB.prototype & {
  __storekeeperDerivedLifecyclePatchApplied?: boolean;
};

type NormalizedMetadataCompactionOptions = Required<Omit<StorekeeperMetadataCompactionOptions, "stateKey">> & {
  stateKey?: string;
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

    const protectedKey = (stateKey: string, path: string): string => `${stateKey}\u0000${path}`;

    const protectedSet = (options: StorekeeperGarbageCollectionOptions): Set<string> => {
      const paths = options.protectedPaths ?? [];
      if (!options.stateKey || paths.length === 0) return new Set();
      return new Set(paths.map((path) => protectedKey(options.stateKey!, path)));
    };

    const numberFromFirstRow = (sql: string, ...args: unknown[]): number => {
      const rows = runtime.prepare(sql).all(...args) as Array<Record<string, unknown>>;
      return Number(rows[0]?.n ?? 0);
    };

    const changed = (result: unknown): number => Number((result as { changes?: number }).changes ?? 0);

    const normalizeMetadataOptions = (
      options: number | StorekeeperMetadataCompactionOptions = {},
    ): NormalizedMetadataCompactionOptions => {
      const objectOptions = typeof options === "number" ? { maxMagicLogEntries: options } : options;
      return {
        maxMagicLogEntries: objectOptions.maxMagicLogEntries ?? 100,
        pathCountDecayFactor: objectOptions.pathCountDecayFactor ?? 1,
        dropPathStatsBelow: objectOptions.dropPathStatsBelow ?? -1,
        stateKey: objectOptions.stateKey,
      };
    };

    const compactMetadata = (
      input: number | StorekeeperMetadataCompactionOptions = {},
    ): StorekeeperMetadataCompactionResult => {
      const options = normalizeMetadataOptions(input);

      const magicBefore = numberFromFirstRow("SELECT COUNT(*) AS n FROM __sk_magic_log");
      if (Number.isFinite(options.maxMagicLogEntries) && options.maxMagicLogEntries >= 0) {
        runtime
          .prepare(
            "DELETE FROM __sk_magic_log WHERE id IN (SELECT id FROM __sk_magic_log ORDER BY id DESC LIMIT -1 OFFSET ?)",
          )
          .run(Math.max(0, Math.floor(options.maxMagicLogEntries)));
      }
      const magicAfter = numberFromFirstRow("SELECT COUNT(*) AS n FROM __sk_magic_log");

      let pathsDecayed = 0;
      if (options.pathCountDecayFactor >= 0 && options.pathCountDecayFactor < 1) {
        const sql = options.stateKey
          ? "UPDATE __sk_paths SET read_count=CAST(read_count * ? AS INTEGER), write_count=CAST(write_count * ? AS INTEGER) WHERE state_key=?"
          : "UPDATE __sk_paths SET read_count=CAST(read_count * ? AS INTEGER), write_count=CAST(write_count * ? AS INTEGER)";
        const result = options.stateKey
          ? runtime.prepare(sql).run(options.pathCountDecayFactor, options.pathCountDecayFactor, options.stateKey)
          : runtime.prepare(sql).run(options.pathCountDecayFactor, options.pathCountDecayFactor);
        pathsDecayed = changed(result);
      }

      let pathsDeleted = 0;
      if (options.dropPathStatsBelow >= 0) {
        const sql = options.stateKey
          ? `DELETE FROM __sk_paths
             WHERE state_key=?
               AND read_count <= ?
               AND write_count <= ?
               AND NOT EXISTS (
                 SELECT 1 FROM __sk_derivations d
                 WHERE d.state_key=__sk_paths.state_key
                   AND d.path=__sk_paths.path
                   AND d.kind='projection'
               )`
          : `DELETE FROM __sk_paths
             WHERE read_count <= ?
               AND write_count <= ?
               AND NOT EXISTS (
                 SELECT 1 FROM __sk_derivations d
                 WHERE d.state_key=__sk_paths.state_key
                   AND d.path=__sk_paths.path
                   AND d.kind='projection'
               )`;
        const result = options.stateKey
          ? runtime.prepare(sql).run(options.stateKey, options.dropPathStatsBelow, options.dropPathStatsBelow)
          : runtime.prepare(sql).run(options.dropPathStatsBelow, options.dropPathStatsBelow);
        pathsDeleted = changed(result);
      }

      return {
        magicLogsDeleted: magicBefore - magicAfter,
        pathsDecayed,
        pathsDeleted,
      };
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
      const keep = protectedSet(options);
      const initialRows = selectDerivations(options.stateKey);

      const timeCandidates = (options.force ? initialRows : initialRows.filter((row) => row.state === "cold")).filter(
        (row) => !keep.has(protectedKey(row.state_key, row.path)),
      );
      for (const row of timeCandidates) {
        evictOne(row, options.force ? "debug forced derived garbage collection" : "cold derived projection garbage collection");
        seen.add(protectedKey(row.state_key, row.path));
        evicted++;
      }

      if (typeof options.maxDerivations === "number" && Number.isFinite(options.maxDerivations)) {
        const remaining = selectDerivations(options.stateKey).filter((row) => !seen.has(protectedKey(row.state_key, row.path)));
        const evictable = remaining
          .filter((row) => !keep.has(protectedKey(row.state_key, row.path)))
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
        for (const row of evictable.slice(0, over)) {
          evictOne(row, `derived projection budget exceeded: maxDerivations=${options.maxDerivations}`);
          seen.add(protectedKey(row.state_key, row.path));
          evicted++;
        }
      }

      if (options.markCold && !options.force) {
        const rows = selectDerivations(options.stateKey).filter((row) => !seen.has(protectedKey(row.state_key, row.path)));
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
      compactMetadata,
    };
  };

  prototype.__storekeeperDerivedLifecyclePatchApplied = true;
}
