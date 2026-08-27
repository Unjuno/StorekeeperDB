import { DatabaseSync, StatementSync } from "node:sqlite";
import type {
  DerivationSnapshot,
  Dict,
  ExplainSnapshot,
  InspectSnapshot,
  JsonScalar,
  JsonValue,
  MagicLogRow,
  Signal,
  Snapshot,
  StatusSnapshot,
  StorekeeperOptions,
} from "./types.js";
import { cloneJson, expectJsonObject, isArrayIndex, isObjectRecord, isScalar, pathGet, valueType } from "./utils.js";

type ItemRow = { id: string; value_json: string };
type LoadedState = { key: string; list: Dict[]; proxy: Dict[]; generation: number };
type SnapshotEntry = { key: string; rows: Dict[]; generation: number };
type MutationContext = { key: string; id: string; root: Dict; generation: number; ownerProxy: Dict };

const MUTATING_ARRAY_METHODS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse"]);

export class StorekeeperDB {
  private readonly db: DatabaseSync;
  private readonly magic: boolean;
  private readonly statements = new Map<string, StatementSync>();
  private readonly states = new Map<string, LoadedState>();
  private readonly ids = new WeakMap<object, string>();
  private readonly versions = new Map<string, number>();
  private readonly subscribers = new Map<string, Set<() => void>>();
  private readonly derivationCache = new Map<string, DerivationSnapshot[]>();
  private nextId = 1;
  private transactionDepth = 0;
  private pendingNotifications = new Set<string>();

  constructor(path: string, options: StorekeeperOptions = {}) {
    this.db = new DatabaseSync(path);
    this.magic = options.magic ?? true;
    this.init();
  }

  close(): void {
    this.statements.clear();
    this.derivationCache.clear();
    this.db.close();
  }

  batch<T>(fn: () => T): T {
    if (this.transactionDepth > 0) return fn();
    const snapshot = this.memorySnapshot();
    const pendingBefore = new Set(this.pendingNotifications);
    this.transactionDepth++;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      this.transactionDepth--;
      this.flushNotifications();
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.derivationCache.clear();
      this.restoreMemory(snapshot);
      this.pendingNotifications = pendingBefore;
      this.transactionDepth--;
      throw error;
    }
  }

  state<T extends object[]>(key: string, initial: T): T {
    const existing = this.states.get(key);
    if (existing) return existing.proxy as T;

    const rows = this.prepare("SELECT id,value_json FROM __sk_items WHERE state_key=? ORDER BY pos").all(key) as ItemRow[];
    const list: Dict[] = [];
    const loaded: LoadedState = { key, list, proxy: [] as Dict[], generation: 0 };
    this.states.set(key, loaded);

    if (rows.length) {
      rows.forEach((row) => list.push(this.wrapItem(key, JSON.parse(row.value_json) as Dict, row.id, loaded.generation)));
    } else {
      initial.forEach((item, index) => {
        const objectItem = expectJsonObject(item);
        const wrapped = this.wrapItem(key, cloneJson(objectItem as Dict), this.newId(), loaded.generation);
        list.push(wrapped);
        this.saveItem(key, this.idOf(wrapped), index, wrapped);
      });
    }

    loaded.proxy = this.wrapList(key, list);
    return loaded.proxy as T;
  }

  signal<T extends object[]>(key: string, initial: T): Signal<T> {
    const value = this.state<T>(key, initial);
    let version = this.version(key);
    let snapshot: Snapshot<T> = { value, version };
    return {
      value,
      getSnapshot: () => {
        const current = this.version(key);
        if (current !== version) {
          version = current;
          snapshot = { value, version };
        }
        return snapshot;
      },
      subscribe: (fn) => this.subscribe(key, fn),
    };
  }

  find<T extends Dict>(key: string, where: Partial<Record<keyof T & string, JsonScalar>>): T[] {
    const pairs = Object.entries(where) as [string, JsonScalar][];
    const list = this.state<Dict[]>(key, [] as Dict[]);
    if (pairs.length === 0) return list.slice() as T[];

    if (this.magic) for (const [path] of pairs) this.project(key, path, "find");
    const [firstPath, firstValue] = pairs[0]!;
    const candidateIds = this.isProjected(key, firstPath)
      ? new Set(
          (this.prepare("SELECT item_id FROM __sk_projection WHERE state_key=? AND path=? AND value_json=?").all(
            key,
            firstPath,
            JSON.stringify(firstValue),
          ) as { item_id: string }[]).map((row) => row.item_id),
        )
      : null;

    return list.filter((item) => {
      if (candidateIds && !candidateIds.has(this.idOf(item))) return false;
      return pairs.every(([path, expected]) => pathGet(item, path) === expected);
    }) as T[];
  }

  liveFind<T extends Dict>(key: string, where: Partial<Record<keyof T & string, JsonScalar>>) {
    const snapshotFind = () => this.find<T>(key, where).map((item) => cloneJson(item));
    let version = 0;
    let value = snapshotFind();
    let snapshot: Snapshot<T[]> = { value, version };
    const listeners = new Set<() => void>();
    let stopUpstream: (() => void) | null = null;

    const recompute = () => {
      const next = snapshotFind();
      if (JSON.stringify(next) !== JSON.stringify(value)) {
        value = next;
        version++;
        snapshot = { value, version };
        listeners.forEach((listener) => listener());
      }
    };

    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        if (!stopUpstream) stopUpstream = this.subscribe(key, recompute);
        return () => {
          listeners.delete(listener);
          if (!listeners.size && stopUpstream) {
            stopUpstream();
            stopUpstream = null;
          }
        };
      },
    };
  }

  promote(key: string, paths: string[]): void {
    paths.forEach((path) => this.project(key, path, "manual", true));
  }

  harden(key: string, paths: string[]): void {
    this.promote(key, paths);
  }

  status(): StatusSnapshot {
    return {
      states: Number((this.one("SELECT COUNT(DISTINCT state_key) n FROM __sk_items") as { n: number }).n),
      items: Number((this.one("SELECT COUNT(*) n FROM __sk_items") as { n: number }).n),
      projectionCells: Number((this.one("SELECT COUNT(*) n FROM __sk_projection") as { n: number }).n),
      magic: this.magic,
    };
  }

  inspect(key: string): InspectSnapshot {
    const derivations = this.derivations(key);
    return {
      stateKey: key,
      itemCount: Number((this.one("SELECT COUNT(*) n FROM __sk_items WHERE state_key=?", key) as { n: number }).n),
      derivations,
      hardenedPaths: derivations.map((row) => row.path),
    };
  }

  explain(key: string, path: string): ExplainSnapshot {
    const row = this.prepare("SELECT observed_type,read_count,write_count FROM __sk_paths WHERE state_key=? AND path=?").get(
      key,
      path,
    ) as { observed_type: string; read_count: number; write_count: number } | undefined;
    const projected = this.isProjected(key, path);
    return {
      stateKey: key,
      path,
      observed: Boolean(row),
      observedType: row?.observed_type ?? null,
      readCount: row?.read_count ?? 0,
      writeCount: row?.write_count ?? 0,
      storage: projected ? "projection" : "json_only",
      queryStrategyIfFiltered: projected ? "projection" : "json_scan",
    };
  }

  debug() {
    return {
      recentMagic: (limit = 20): MagicLogRow[] =>
        this.prepare("SELECT * FROM __sk_magic_log ORDER BY id DESC LIMIT ?").all(limit) as MagicLogRow[],
      derivations: (key?: string): DerivationSnapshot[] => this.derivations(key),
      evict: (key: string, paths: string[]): void => paths.forEach((path) => this.evict(key, path, "debug_evict")),
      rebuild: (key: string, paths: string[]): void => paths.forEach((path) => this.project(key, path, "debug_rebuild", true)),
      compactMetadata: (limit = 100): { magicLogsDeleted: number } => this.compactMagicLog(limit),
    };
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS __sk_items(state_key TEXT NOT NULL,id TEXT NOT NULL,pos INTEGER NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(state_key,id));
      CREATE INDEX IF NOT EXISTS __sk_items_order ON __sk_items(state_key,pos);
      CREATE TABLE IF NOT EXISTS __sk_paths(state_key TEXT NOT NULL,path TEXT NOT NULL,observed_type TEXT,read_count INTEGER NOT NULL DEFAULT 0,write_count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(state_key,path));
      CREATE TABLE IF NOT EXISTS __sk_projection(state_key TEXT NOT NULL,path TEXT NOT NULL,item_id TEXT NOT NULL,value_json TEXT NOT NULL,PRIMARY KEY(state_key,path,item_id));
      CREATE INDEX IF NOT EXISTS __sk_projection_lookup ON __sk_projection(state_key,path,value_json);
      CREATE TABLE IF NOT EXISTS __sk_derivations(state_key TEXT NOT NULL,path TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,use_count INTEGER NOT NULL DEFAULT 0,storage_cost INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(state_key,path,kind));
      CREATE TABLE IF NOT EXISTS __sk_magic_log(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,state_key TEXT NOT NULL,path TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    `);
  }

  private wrapList(key: string, list: Dict[]): Dict[] {
    const persistAll = () => this.batch(() => {
      this.rewriteState(key);
      this.bump(key);
    });

    return new Proxy(list, {
      get: (target, property, receiver) => {
        if (property === "push") return (...items: Dict[]) => {
          const result = this.batch(() => {
            const loaded = this.loaded(key);
            for (const item of items) {
              const objectItem = expectJsonObject(item);
              const wrapped = this.wrapItem(key, cloneJson(objectItem as Dict), this.newId(), loaded.generation);
              target.push(wrapped);
              this.saveItem(key, this.idOf(wrapped), target.length - 1, wrapped);
            }
            return target.length;
          });
          this.bump(key);
          return result;
        };

        if (property === "pop") return () => {
          if (!target.length) return undefined;
          const removed = target.pop();
          if (removed) this.deleteItem(key, this.idOf(removed));
          persistAll();
          return removed;
        };

        if (property === "shift") return () => {
          if (!target.length) return undefined;
          const removed = target.shift();
          if (removed) this.deleteItem(key, this.idOf(removed));
          persistAll();
          return removed;
        };

        if (property === "unshift") return (...items: Dict[]) => {
          const loaded = this.loaded(key);
          const wrapped = items.map((item) => {
            const objectItem = expectJsonObject(item);
            return this.wrapItem(key, cloneJson(objectItem as Dict), this.newId(), loaded.generation);
          });
          const result = target.unshift(...wrapped);
          persistAll();
          return result;
        };

        if (property === "splice") return (start: number, deleteCount?: number, ...items: Dict[]) => {
          const loaded = this.loaded(key);
          const wrapped = items.map((item) => {
            const objectItem = expectJsonObject(item);
            return this.wrapItem(key, cloneJson(objectItem as Dict), this.newId(), loaded.generation);
          });
          const removed = target.splice(start, deleteCount ?? target.length - start, ...wrapped);
          removed.forEach((item) => this.deleteItem(key, this.idOf(item)));
          persistAll();
          return removed;
        };

        if (property === "sort") return (compare?: (a: Dict, b: Dict) => number) => {
          target.sort(compare);
          persistAll();
          return receiver;
        };

        if (property === "reverse") return () => {
          target.reverse();
          persistAll();
          return receiver;
        };

        if (property === "fill" || property === "copyWithin") return () => {
          throw new Error(`${String(property)} is not supported on persistent arrays; use splice or direct replacement.`);
        };

        return Reflect.get(target, property, receiver);
      },
      set: (target, property, value) => {
        if (property === "length") {
          const nextLength = Number(value);
          if (!Number.isInteger(nextLength) || nextLength < 0) return false;
          if (nextLength > target.length) throw new Error("Growing persistent arrays by setting length is not supported.");
          const removed = target.splice(nextLength);
          removed.forEach((item) => this.deleteItem(key, this.idOf(item)));
          persistAll();
          return true;
        }

        if (isArrayIndex(property)) {
          const index = Number(property);
          if (index > target.length) throw new Error("Sparse array assignment is not supported.");
          const objectValue = expectJsonObject(value);
          const loaded = this.loaded(key);
          const id = index < target.length ? this.idOf(target[index]!) : this.newId();
          const wrapped = this.wrapItem(key, cloneJson(objectValue as Dict), id, loaded.generation);
          target[index] = wrapped;
          this.saveItem(key, id, index, wrapped);
          this.bump(key);
          return true;
        }

        return Reflect.set(target, property, value);
      },
      deleteProperty: () => {
        throw new Error("delete on persistent arrays is not supported; use splice/pop/shift.");
      },
    });
  }

  private wrapItem(key: string, item: Dict, id: string, generation: number): Dict {
    let proxy: Dict;
    const commitRoot = (path: string, value: unknown) => {
      this.assertWritableProxy(key, generation, id, proxy);
      this.observe(key, path, value, "write");
      this.saveItem(key, id, this.positionOf(key, proxy), item);
      this.bump(key);
    };

    proxy = new Proxy(item, {
      get: (target, property, receiver) => {
        this.assertActiveProxy(key, generation);
        const value = Reflect.get(target, property, receiver);
        if (typeof property === "string") this.observe(key, property, value, "read");
        if ((isObjectRecord(value) || Array.isArray(value)) && typeof property === "string") {
          const context: MutationContext = { key, id, root: item, generation, ownerProxy: proxy };
          return this.wrapNested(context, value as JsonValue, property);
        }
        return value;
      },
      set: (target, property, value) => {
        this.assertWritableProxy(key, generation, id, proxy);
        if (typeof property !== "string") return false;
        Reflect.set(target, property, value);
        commitRoot(property, value);
        return true;
      },
      deleteProperty: (target, property) => {
        this.assertWritableProxy(key, generation, id, proxy);
        if (typeof property !== "string") return false;
        Reflect.deleteProperty(target, property);
        commitRoot(property, undefined);
        return true;
      },
    }) as Dict;
    this.ids.set(proxy, id);
    return proxy;
  }

  private wrapNested(context: MutationContext, value: JsonValue, basePath: string): JsonValue {
    if (!isObjectRecord(value) && !Array.isArray(value)) return value;

    const assertWritable = () =>
      this.assertWritableProxy(context.key, context.generation, context.id, context.ownerProxy);
    const commitNested = (path: string, observedValue: unknown) => {
      assertWritable();
      this.observe(context.key, path, observedValue, "write");
      const rootProxy = this.findProxyById(context.key, context.id);
      this.saveItem(context.key, context.id, this.positionOf(context.key, rootProxy ?? context.root), context.root);
      this.bump(context.key);
    };

    return new Proxy(value as Record<string, JsonValue>, {
      get: (target, property, receiver) => {
        this.assertActiveProxy(context.key, context.generation);
        const current = Reflect.get(target, property, receiver) as JsonValue;
        const propertyName = String(property);
        if (typeof property === "string" && !MUTATING_ARRAY_METHODS.has(propertyName)) {
          this.observe(context.key, `${basePath}.${propertyName}`, current, "read");
        }

        if (Array.isArray(target) && property === "push") return (...items: JsonValue[]) => {
          assertWritable();
          const result = (target as JsonValue[]).push(...items);
          commitNested(basePath, target);
          return result;
        };
        if (Array.isArray(target) && property === "pop") return () => {
          assertWritable();
          const result = (target as JsonValue[]).pop();
          commitNested(basePath, target);
          return result;
        };
        if (Array.isArray(target) && property === "shift") return () => {
          assertWritable();
          const result = (target as JsonValue[]).shift();
          commitNested(basePath, target);
          return result;
        };
        if (Array.isArray(target) && property === "unshift") return (...items: JsonValue[]) => {
          assertWritable();
          const result = (target as JsonValue[]).unshift(...items);
          commitNested(basePath, target);
          return result;
        };
        if (Array.isArray(target) && property === "splice") return (start: number, deleteCount?: number, ...items: JsonValue[]) => {
          assertWritable();
          const result = (target as JsonValue[]).splice(start, deleteCount ?? (target as JsonValue[]).length - start, ...items);
          commitNested(basePath, target);
          return result;
        };
        if (Array.isArray(target) && property === "sort") return (compare?: (a: JsonValue, b: JsonValue) => number) => {
          assertWritable();
          (target as JsonValue[]).sort(compare);
          commitNested(basePath, target);
          return receiver;
        };
        if (Array.isArray(target) && property === "reverse") return () => {
          assertWritable();
          (target as JsonValue[]).reverse();
          commitNested(basePath, target);
          return receiver;
        };

        if ((isObjectRecord(current) || Array.isArray(current)) && typeof property === "string") {
          return this.wrapNested(context, current, `${basePath}.${property}`);
        }
        return current;
      },
      set: (target, property, nextValue) => {
        assertWritable();
        if (typeof property !== "string") return false;
        Reflect.set(target, property, nextValue);
        commitNested(`${basePath}.${property}`, nextValue);
        return true;
      },
      deleteProperty: (target, property) => {
        assertWritable();
        if (typeof property !== "string") return false;
        Reflect.deleteProperty(target, property);
        commitNested(`${basePath}.${property}`, undefined);
        return true;
      },
    }) as JsonValue;
  }

  private saveItem(key: string, id: string, pos: number, item: Dict): void {
    this.prepare(
      "INSERT INTO __sk_items(state_key,id,pos,value_json) VALUES(?,?,?,?) ON CONFLICT(state_key,id) DO UPDATE SET pos=excluded.pos,value_json=excluded.value_json",
    ).run(key, id, pos, JSON.stringify(item));
    this.syncProjectionCellsForItem(key, id, item);
  }

  private deleteItem(key: string, id: string): void {
    this.prepare("DELETE FROM __sk_items WHERE state_key=? AND id=?").run(key, id);
    this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND item_id=?").run(key, id);
    this.derivationCache.delete(key);
  }

  private rewriteState(key: string): void {
    const loaded = this.loaded(key);
    this.prepare("DELETE FROM __sk_items WHERE state_key=?").run(key);
    this.prepare("DELETE FROM __sk_projection WHERE state_key=?").run(key);
    loaded.list.forEach((item, index) => this.saveItem(key, this.idOf(item), index, item));
    this.derivationCache.delete(key);
  }

  private syncProjectionCellsForItem(key: string, id: string, item: Dict): void {
    const derivations = this.derivations(key);
    if (!derivations.length) return;
    for (const derivation of derivations) {
      this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=? AND item_id=?").run(key, derivation.path, id);
      const value = pathGet(item, derivation.path);
      if (isScalar(value)) this.writeProjection(key, derivation.path, id, value);
    }
  }

  private project(key: string, path: string, reason: string, force = false): void {
    if (!force && this.isProjected(key, path)) {
      this.prepare("UPDATE __sk_derivations SET use_count=use_count+1,state='hot' WHERE state_key=? AND path=? AND kind='projection'").run(
        key,
        path,
      );
      this.logMagic("project_touch", key, path, reason);
      this.derivationCache.delete(key);
      return;
    }

    const list = this.state<Dict[]>(key, [] as Dict[]);
    const values = list.map((item) => pathGet(item, path));
    if (!values.every((value) => value === undefined || isScalar(value))) return;

    this.batch(() => {
      this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=?").run(key, path);
      list.forEach((item) => {
        const value = pathGet(item, path);
        if (isScalar(value)) this.writeProjection(key, path, this.idOf(item), value);
      });
      this.prepare(
        "INSERT INTO __sk_derivations(state_key,path,kind,state,use_count,storage_cost) VALUES(?,?, 'projection','hot',1,?) ON CONFLICT(state_key,path,kind) DO UPDATE SET use_count=use_count+1,state='hot',storage_cost=excluded.storage_cost",
      ).run(key, path, values.length);
      this.logMagic(force ? "project_rebuild" : "project_create", key, path, reason);
    });
    this.derivationCache.delete(key);
    this.bump(key);
  }

  private evict(key: string, path: string, reason: string): void {
    this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=?").run(key, path);
    this.prepare("DELETE FROM __sk_derivations WHERE state_key=? AND path=? AND kind='projection'").run(key, path);
    this.logMagic("project_evict", key, path, reason);
    this.derivationCache.delete(key);
  }

  private writeProjection(key: string, path: string, id: string, value: JsonScalar): void {
    this.prepare(
      "INSERT INTO __sk_projection(state_key,path,item_id,value_json) VALUES(?,?,?,?) ON CONFLICT(state_key,path,item_id) DO UPDATE SET value_json=excluded.value_json",
    ).run(key, path, id, JSON.stringify(value));
  }

  private isProjected(key: string, path: string): boolean {
    return Boolean(this.prepare("SELECT 1 FROM __sk_derivations WHERE state_key=? AND path=? AND kind='projection'").get(key, path));
  }

  private derivations(key?: string): DerivationSnapshot[] {
    if (key && this.derivationCache.has(key)) return cloneJson(this.derivationCache.get(key)!);
    const rows = key
      ? (this.prepare("SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations WHERE state_key=? ORDER BY path").all(key) as DerivationSnapshot[])
      : (this.prepare("SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations ORDER BY state_key,path").all() as DerivationSnapshot[]);
    if (key) this.derivationCache.set(key, cloneJson(rows));
    return rows;
  }

  private observe(key: string, path: string, value: unknown, mode: "read" | "write"): void {
    const column = mode === "read" ? "read_count" : "write_count";
    this.prepare(
      `INSERT INTO __sk_paths(state_key,path,observed_type,${column}) VALUES(?,?,?,1) ON CONFLICT(state_key,path) DO UPDATE SET observed_type=excluded.observed_type,${column}=${column}+1`,
    ).run(key, path, valueType(value));
  }

  private compactMagicLog(limit: number): { magicLogsDeleted: number } {
    const row = this.prepare("SELECT id FROM __sk_magic_log ORDER BY id DESC LIMIT 1 OFFSET ?").get(limit - 1) as { id: number } | undefined;
    if (!row) return { magicLogsDeleted: 0 };
    const before = Number((this.one("SELECT COUNT(*) n FROM __sk_magic_log") as { n: number }).n);
    this.prepare("DELETE FROM __sk_magic_log WHERE id < ?").run(row.id);
    const after = Number((this.one("SELECT COUNT(*) n FROM __sk_magic_log") as { n: number }).n);
    return { magicLogsDeleted: before - after };
  }

  private logMagic(action: string, key: string, path: string | null, reason: string): void {
    this.prepare("INSERT INTO __sk_magic_log(action,state_key,path,reason) VALUES(?,?,?,?)").run(action, key, path, reason);
  }

  private memorySnapshot(): SnapshotEntry[] {
    return [...this.states.entries()].map(([key, loaded]) => ({
      key,
      rows: loaded.list.map((item) => cloneJson(item)),
      generation: loaded.generation,
    }));
  }

  private restoreMemory(snapshot: SnapshotEntry[]): void {
    for (const entry of snapshot) {
      const loaded = this.states.get(entry.key);
      if (!loaded) continue;
      loaded.generation = entry.generation + 1;
      loaded.list.length = 0;
      entry.rows.forEach((row) => loaded.list.push(this.wrapItem(entry.key, cloneJson(row), this.newId(), loaded.generation)));
      const dbRows = this.prepare("SELECT id,value_json FROM __sk_items WHERE state_key=? ORDER BY pos").all(entry.key) as ItemRow[];
      if (dbRows.length === entry.rows.length) {
        loaded.list.length = 0;
        dbRows.forEach((row) => loaded.list.push(this.wrapItem(entry.key, JSON.parse(row.value_json) as Dict, row.id, loaded.generation)));
      }
      this.derivationCache.delete(entry.key);
    }
  }

  private assertActiveProxy(key: string, generation: number): void {
    const loaded = this.states.get(key);
    if (!loaded) return;
    if (loaded.generation !== generation) {
      throw new Error("Stale Storekeeper proxy after rollback; re-read the item from its state list.");
    }
  }

  private assertWritableProxy(key: string, generation: number, id: string, sourceProxy: Dict): void {
    this.assertActiveProxy(key, generation);
    const currentProxy = this.findProxyById(key, id);
    if (!currentProxy) {
      throw new Error("Stale Storekeeper proxy after removal; re-read the item from its state list.");
    }
    if (currentProxy !== sourceProxy) {
      throw new Error("Stale Storekeeper proxy after replacement; re-read the item from its state list.");
    }
  }

  private loaded(key: string): LoadedState {
    const loaded = this.states.get(key);
    if (!loaded) throw new Error(`State ${key} is not loaded.`);
    return loaded;
  }

  private positionOf(key: string, item: object): number {
    const loaded = this.states.get(key);
    if (!loaded) return 0;
    const id = this.ids.get(item);
    if (!id) return loaded.list.indexOf(item as Dict);
    return loaded.list.findIndex((candidate) => this.ids.get(candidate) === id);
  }

  private findProxyById(key: string, id: string): Dict | undefined {
    return this.states.get(key)?.list.find((item) => this.ids.get(item) === id);
  }

  private idOf(item: object): string {
    const id = this.ids.get(item);
    if (!id) throw new Error("Storekeeper item is missing an internal id.");
    return id;
  }

  private subscribe(key: string, fn: () => void): () => void {
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.subscribers.delete(key);
    };
  }

  private bump(key: string): void {
    if (this.transactionDepth > 0) {
      this.pendingNotifications.add(key);
      return;
    }
    this.versions.set(key, this.version(key) + 1);
    this.subscribers.get(key)?.forEach((listener) => listener());
  }

  private flushNotifications(): void {
    const keys = [...this.pendingNotifications];
    this.pendingNotifications.clear();
    keys.forEach((key) => {
      this.versions.set(key, this.version(key) + 1);
      this.subscribers.get(key)?.forEach((listener) => listener());
    });
  }

  private version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  private one(sql: string, ...args: unknown[]): unknown {
    return this.prepare(sql).get(...args);
  }

  private prepare(sql: string): StatementSync {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const statement = this.db.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  private newId(): string {
    return `sk_${Date.now().toString(36)}_${this.nextId++}`;
  }
}
