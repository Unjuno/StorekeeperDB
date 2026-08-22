export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
export type Dict = Record<string, JsonValue>;

export type Snapshot<T> = {
  value: T;
  version: number;
};

export type Signal<T> = {
  value: T;
  getSnapshot(): Snapshot<T>;
  subscribe(fn: () => void): () => void;
};

export type StorekeeperDecayOptions = {
  /** Enables automatic collection of rebuildable derived projections. Defaults to false in the public alpha. */
  enabled?: boolean;
  /** Run derived GC after every N find() calls. Defaults to 100. */
  collectEveryFinds?: number;
  /** Mark remaining projections cold after a collection pass. Defaults to false. */
  markCold?: boolean;
  /** Keep at most this many active projection derivations. Defaults to Infinity. */
  maxDerivations?: number;
};

export type StorekeeperOptions = {
  /** Prototype-first magic mode. When enabled, supported scalar lookups auto-create projections. */
  magic?: boolean;
  /** Optional automatic cleanup policy for rebuildable derived projections. */
  decay?: boolean | StorekeeperDecayOptions;
};

export type DerivationState = "hot" | "cold" | "evicted" | "materialized" | string;

export type DerivationSnapshot = {
  state_key: string;
  path: string;
  state: DerivationState;
  use_count: number;
  storage_cost: number;
};

export type MagicLogRow = {
  id: number;
  action: string;
  state_key: string;
  path: string | null;
  reason: string;
  created_at: string;
};

export type StorekeeperGarbageCollectionOptions = {
  /** Limit lifecycle work to one state key. */
  stateKey?: string;
  /** Evict matching derived projections immediately. Source rows are preserved. */
  force?: boolean;
  /** Mark remaining materialized projections cold after other GC work. */
  markCold?: boolean;
  /** Keep at most this many active projection derivations after collection. */
  maxDerivations?: number;
  /** Paths that must not be evicted in this GC pass, usually the current lookup path. */
  protectedPaths?: string[];
};

export type StorekeeperGarbageCollectionResult = {
  cold: number;
  evicted: number;
};

export type StorekeeperDebugAPI = {
  recentMagic(limit?: number): MagicLogRow[];
  derivations(stateKey?: string): DerivationSnapshot[];
  evict(stateKey: string, paths: string[]): void;
  rebuild(stateKey: string, paths: string[]): void;
  markCold(stateKey: string, paths: string[], reason?: string): void;
  collectGarbage(options?: StorekeeperGarbageCollectionOptions): StorekeeperGarbageCollectionResult;
  compactMetadata(limit?: number): { magicLogsDeleted: number };
};

export type StatusSnapshot = {
  states: number;
  items: number;
  projectionCells: number;
  magic: boolean;
};

export type InspectSnapshot = {
  stateKey: string;
  itemCount: number;
  derivations: DerivationSnapshot[];
  hardenedPaths: string[];
};

export type ExplainSnapshot = {
  stateKey: string;
  path: string;
  observed: boolean;
  observedType: string | null;
  readCount: number;
  writeCount: number;
  storage: "projection" | "json_only";
  queryStrategyIfFiltered: "projection" | "json_scan";
};
