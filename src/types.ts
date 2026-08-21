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

export type StorekeeperOptions = {
  /** Prototype-first magic mode. When enabled, supported scalar lookups auto-create projections. */
  magic?: boolean;
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
  derivations: unknown[];
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
