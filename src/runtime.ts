import { DatabaseSync, StatementSync } from "node:sqlite";
import type { Dict, ExplainSnapshot, InspectSnapshot, JsonScalar, JsonValue, Signal, Snapshot, StatusSnapshot, StorekeeperOptions } from "./types.js";
import { cloneJson, isArrayIndex, isObjectRecord, isScalar, pathGet, valueType } from "./utils.js";

type ItemRow = { id: string; value_json: string };
type MagicRow = { id: number; action: string; state_key: string; path: string | null; reason: string; created_at: string };
type DerivationRow = { state_key: string; path: string; state: string; use_count: number; storage_cost: number };
type LoadedState = { list: Dict[]; proxy: Dict[] };
type SnapshotEntry = { key: string; rows: Dict[] };

export class StorekeeperDB {
  private readonly db: DatabaseSync;
  private readonly magic: boolean;
  private readonly statements = new Map<string, StatementSync>();
  private readonly states = new Map<string, LoadedState>();
  private readonly ids = new WeakMap<object, string>();
  private readonly versions = new Map<string, number>();
  private readonly subscribers = new Map<string, Set<() => void>>();
  private readonly derivationCache = new Map<string, DerivationRow[]>();
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
    const loaded: LoadedState = { list, proxy: [] as Dict[] };
    this.states.set(key, loaded);
    if (rows.length) {
      rows.forEach((row) => list.push(this.wrapItem(key, JSON.parse(row.value_json) as Dict, row.id)));
    } else {
      initial.forEach((item, index) => {
        const wrapped = this.wrapItem(key, cloneJson(item as Dict), this.newId());
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
    if (pairs.length === 0) return list.map(cloneJson) as T[];
    if (this.magic) for (const [path] of pairs) this.project(key, path, "find");
    const [firstPath, firstValue] = pairs[0]!;
    const candidateIds = this.isProjected(key, firstPath)
      ? new Set((this.prepare("SELECT item_id FROM __sk_projection WHERE state_key=? AND path=? AND value_json=?").all(key, firstPath, JSON.stringify(firstValue)) as { item_id: string }[]).map((row) => row.item_id))
      : null;
    return list
      .filter((item) => {
        if (candidateIds && !candidateIds.has(this.idOf(item))) return false;
        return pairs.every(([path, expected]) => pathGet(item, path) === expected);
      })
      .map(cloneJson) as T[];
  }

  liveFind<T extends Dict>(key: string, where: Partial<Record<keyof T & string, JsonScalar>>) {
    let version = 0;
    let value = this.find<T>(key, where);
    const listeners = new Set<() => void>();
    let stopUpstream: (() => void) | null = null;
    const recompute = () => {
      const next = this.find<T>(key, where);
      if (JSON.stringify(next) !== JSON.stringify(value)) {
        value = next;
        version++;
        listeners.forEach((listener) => listener());
      }
    };
    return {
      getSnapshot: () => ({ value, version }),
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

  promote(key: string, paths: string[]): void { paths.forEach((path) => this.project(key, path, "manual", true)); }
  harden(key: string, paths: string[]): void { this.promote(key, paths); }

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
    return { stateKey: key, itemCount: Number((this.one("SELECT COUNT(*) n FROM __sk_items WHERE state_key=?", key) as { n: number }).n), derivations, hardenedPaths: derivations.map((row) => row.path) };
  }

  explain(key: string, path: string): ExplainSnapshot {
    const row = this.prepare("SELECT observed_type,read_count,write_count FROM __sk_paths WHERE state_key=? AND path=?").get(key, path) as { observed_type: string; read_count: number; write_count: number } | undefined;
    const projected = this.isProjected(key, path);
    return { stateKey: key, path, observed: Boolean(row), observedType: row?.observed_type ?? null, readCount: row?.read_count ?? 0, writeCount: row?.write_count ?? 0, storage: projected ? "projection" : "json_only", queryStrategyIfFiltered: projected ? "projection" : "json_scan" };
  }

  debug() {
    return {
      recentMagic: (limit = 20): MagicRow[] => this.prepare("SELECT * FROM __sk_magic_log ORDER BY id DESC LIMIT ?").all(limit) as MagicRow[],
      derivations: (key?: string): DerivationRow[] => this.derivations(key),
      evict: (key: string, paths: string[]): void => paths.forEach((path) => this.evict(key, path, "debug")),
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
    const persistAll = () => { list.forEach((item, index) => this.saveItem(key, this.idOf(item), index, item)); this.bump(key); };
    return new Proxy(list, {
      get: (target, property, receiver) => {
        if (property === "push") return (...items: Dict[]) => { const result = this.batch(() => { for (const item of items) { const wrapped = this.wrapItem(key, cloneJson(item), this.newId()); target.push(wrapped); this.saveItem(key, this.idOf(wrapped), target.length - 1, wrapped); } return target.length; }); this.bump(key); return result; };
        if (property === "pop") return () => { if (!target.length) return undefined; const removed = target.pop(); if (removed) this.deleteItem(key, this.idOf(removed)); persistAll(); return removed; };
        if (property === "shift") return () => { if (!target.length) return undefined; const removed = target.shift(); if (removed) this.deleteItem(key, this.idOf(removed)); persistAll(); return removed; };
        if (property === "unshift") return (...items: Dict[]) => { const wrapped = items.map((item) => this.wrapItem(key, cloneJson(item), this.newId())); const result = target.unshift(...wrapped); persistAll(); return result; };
        if (property === "splice") return (start: number, deleteCount?: number, ...items: Dict[]) => { const wrapped = items.map((item) => this.wrapItem(key, cloneJson(item), this.newId())); const removed = target.splice(start, deleteCount ?? target.length - start, ...wrapped); removed.forEach((item) => this.deleteItem(key, this.idOf(item))); persistAll(); return removed; };
        if (property === "sort") return (compare?: (a: Dict, b: Dict) => number) => { target.sort(compare); persistAll(); return receiver; };
        if (property === "reverse") return () => { target.reverse(); persistAll(); return receiver; };
        if (property === "fill" || property === "copyWithin") return () => { throw new Error(`${String(property)} is not supported on persistent arrays; use splice or direct replacement.`); };
        return Reflect.get(target, property, receiver);
      },
      set: (target, property, value) => {
        if (property === "length") { const nextLength = Number(value); if (!Number.isInteger(nextLength) || nextLength < 0) return false; if (nextLength > target.length) throw new Error("Growing persistent arrays by setting length is not supported."); const removed = target.splice(nextLength); removed.forEach((item) => this.deleteItem(key, this.idOf(item))); persistAll(); return true; }
        if (isArrayIndex(property)) { const index = Number(property); if (index > target.length) throw new Error("Sparse array assignment is not supported."); const wrapped = this.wrapItem(key, cloneJson(value as Dict), index < target.length ? this.idOf(target[index]!) : this.newId()); target[index] = wrapped; this.saveItem(key, this.idOf(wrapped), index, wrapped); this.bump(key); return true; }
        return Reflect.set(target, property, value);
      },
      deleteProperty: () => { throw new Error("delete on persistent arrays is not supported; use splice/pop/shift."); },
    });
  }

  private wrapItem(key: string, item: Dict, id: string): Dict {
    let proxy: Dict;
    const commit = (path: string, value: unknown) => { this.observe(key, path, value, "write"); this.saveItem(key, id, this.positionOf(key, proxy), item); this.bump(key); };
    proxy = new Proxy(item, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver);
        if (typeof property === "string") this.observe(key, property, value, "read");
        if ((isObjectRecord(value) || Array.isArray(value)) && typeof property === "string") return this.wrapNested(key, id, item, value as JsonValue, property, () => commit(property, value));
        return value;
      },
      set: (target, property, value) => { if (typeof property !== "string") return false; Reflect.set(target, property, value); commit(property, value); return true; },
      deleteProperty: (target, property) => { if (typeof property !== "string") return false; Reflect.deleteProperty(target, property); commit(property, undefined); return true; },
    }) as Dict;
    this.ids.set(proxy, id);
    return proxy;
  }

  private wrapNested(key: string, rootId: string, root: Dict, value: JsonValue, basePath: string, commit: () => void): JsonValue {
    if (!isObjectRecord(value) && !Array.isArray(value)) return value;
    const nestedCommit = (path: string, observedValue: unknown) => { this.observe(key, path, observedValue, "write"); this.saveItem(key, rootId, this.positionOf(key, this.findProxyById(key, rootId) ?? root), root); this.bump(key); };
    return new Proxy(value as Record<string, JsonValue>, {
      get: (target, property, receiver) => {
        const current = Reflect.get(target, property, receiver) as JsonValue;
        if (typeof property === "string" && !["push", "pop", "splice", "shift", "unshift", "sort", "reverse"].includes(property)) this.observe(key, `${basePath}.${property}`, current, "read");
        if (Array.isArray(target) && property === "push") return (...items: JsonValue[]) => { const result = (target as JsonValue[]).push(...items); nestedCommit(basePath, target); commit(); return result; };
        if (Array.isArray(target) && ["pop", "shift", "reverse", "sort"].includes(String(property))) return (...args: unknown[]) => { const result = ((Array.prototype as unknown) as Record<string, (...a: unknown[]) => unknown>)[String(property)]!.apply(target, args); nestedCommit(basePath, target); commit(); return result; };
        if ((isObjectRecord(current) || Array.isArray(current)) && typeof property === "string") return this.wrapNested(key, rootId, root, current, `${basePath}.${property}`, commit);
        return current;
      },
      set: (target, property, nextValue) => { if (typeof property !== "string") return false; Reflect.set(target, property, nextValue); nestedCommit(`${basePath}.${property}`, nextValue); commit(); return true; },
      deleteProperty: (target, property) => { if (typeof property !== "string") return false; Reflect.deleteProperty(target, property); nestedCommit(`${basePath}.${property}`, undefined); commit(); return true; },
    }) as JsonValue;
  }

  private saveItem(key: string, id: string, pos: number, item: Dict): void {
    this.prepare("INSERT INTO __sk_items(state_key,id,pos,value_json) VALUES(?,?,?,?) ON CONFLICT(state_key,id) DO UPDATE SET pos=excluded.pos,value_json=excluded.value_json").run(key, id, pos, JSON.stringify(item));
    this.derivations(key).forEach((derivation) => this.syncProjectionCell(key, derivation.path, id, pathGet(item, derivation.path)));
  }

  private deleteItem(key: string, id: string): void { this.prepare("DELETE FROM __sk_items WHERE state_key=? AND id=?").run(key, id); this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND item_id=?").run(key, id); }

  private project(key: string, path: string, reason: string, force = false): void {
    if (!force && this.isProjected(key, path)) { this.prepare("UPDATE __sk_derivations SET use_count=use_count+1,state='hot' WHERE state_key=? AND path=? AND kind='projection'").run(key, path); return; }
    const items = this.state<Dict[]>(key, [] as Dict[]);
    const values = items.map((item) => pathGet(item, path));
    if (!values.every((value) => value === undefined || isScalar(value))) return;
    this.batch(() => { this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=?").run(key, path); items.forEach((item) => this.syncProjectionCell(key, path, this.idOf(item), pathGet(item, path))); });
    this.prepare("INSERT INTO __sk_derivations(state_key,path,kind,state,use_count,storage_cost) VALUES(?,?, 'projection','hot',1,?) ON CONFLICT(state_key,path,kind) DO UPDATE SET use_count=use_count+1,state='hot',storage_cost=excluded.storage_cost").run(key, path, values.length);
    this.derivationCache.delete(key);
    this.logMagic("auto_promote", key, path, reason);
    this.bump(key);
  }

  private evict(key: string, path: string, reason: string): void { this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=?").run(key, path); this.prepare("DELETE FROM __sk_derivations WHERE state_key=? AND path=? AND kind='projection'").run(key, path); this.derivationCache.delete(key); this.logMagic("evict_projection", key, path, reason); this.bump(key); }
  private syncProjectionCell(key: string, path: string, id: string, value: unknown): void { if (isScalar(value)) { this.prepare("INSERT INTO __sk_projection(state_key,path,item_id,value_json) VALUES(?,?,?,?) ON CONFLICT(state_key,path,item_id) DO UPDATE SET value_json=excluded.value_json").run(key, path, id, JSON.stringify(value)); return; } this.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=? AND item_id=?").run(key, path, id); }
  private isProjected(key: string, path: string): boolean { return Boolean(this.prepare("SELECT 1 FROM __sk_derivations WHERE state_key=? AND path=? AND kind='projection'").get(key, path)); }
  private derivations(key?: string): DerivationRow[] { if (key) { const cached = this.derivationCache.get(key); if (cached) return cached; const rows = this.prepare("SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations WHERE state_key=? ORDER BY path").all(key) as DerivationRow[]; this.derivationCache.set(key, rows); return rows; } return this.prepare("SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations ORDER BY state_key,path").all() as DerivationRow[]; }
  private compactMagicLog(limit: number): { magicLogsDeleted: number } { const row = this.prepare("SELECT id FROM __sk_magic_log ORDER BY id DESC LIMIT 1 OFFSET ?").get(limit - 1) as { id: number } | undefined; if (!row) return { magicLogsDeleted: 0 }; const before = Number((this.one("SELECT COUNT(*) n FROM __sk_magic_log") as { n: number }).n); this.prepare("DELETE FROM __sk_magic_log WHERE id < ?").run(row.id); const after = Number((this.one("SELECT COUNT(*) n FROM __sk_magic_log") as { n: number }).n); return { magicLogsDeleted: before - after }; }
  private observe(key: string, path: string, value: unknown, mode: "read" | "write"): void { if (mode === "read") return; this.prepare("INSERT INTO __sk_paths(state_key,path,observed_type,write_count) VALUES(?,?,?,1) ON CONFLICT(state_key,path) DO UPDATE SET observed_type=excluded.observed_type,write_count=write_count+1").run(key, path, valueType(value)); }
  private subscribe(key: string, listener: () => void): () => void { let set = this.subscribers.get(key); if (!set) { set = new Set(); this.subscribers.set(key, set); } set.add(listener); return () => { set!.delete(listener); if (!set!.size) this.subscribers.delete(key); }; }
  private bump(key: string): void { if (this.transactionDepth > 0) { this.pendingNotifications.add(key); return; } this.versions.set(key, this.version(key) + 1); this.subscribers.get(key)?.forEach((listener) => listener()); }
  private flushNotifications(): void { const keys = [...this.pendingNotifications]; this.pendingNotifications.clear(); for (const key of keys) { this.versions.set(key, this.version(key) + 1); this.subscribers.get(key)?.forEach((listener) => listener()); } }
  private version(key: string): number { return this.versions.get(key) ?? 0; }
  private prepare(sql: string): StatementSync { let statement = this.statements.get(sql); if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); } return statement; }
  private one(sql: string, ...args: unknown[]): unknown { return this.prepare(sql).get(...args); }
  private idOf(item: Dict): string { const id = this.ids.get(item); if (!id) throw new Error("Persistent item identity is missing."); return id; }
  private positionOf(key: string, proxy: Dict): number { return this.states.get(key)?.list.indexOf(proxy) ?? 0; }
  private findProxyById(key: string, id: string): Dict | undefined { return this.states.get(key)?.list.find((item) => this.ids.get(item) === id); }
  private newId(): string { return `sk_${Date.now().toString(36)}_${this.nextId++}`; }
  private logMagic(action: string, key: string, path: string | null, reason: string): void { this.prepare("INSERT INTO __sk_magic_log(action,state_key,path,reason) VALUES(?,?,?,?)").run(action, key, path, reason); }
  private memorySnapshot(): SnapshotEntry[] { return [...this.states.entries()].map(([key, state]) => ({ key, rows: cloneJson(state.list) })); }
  private restoreMemory(snapshot: SnapshotEntry[]): void { for (const { key, rows } of snapshot) { const state = this.states.get(key); if (!state) continue; state.list.splice(0, state.list.length); rows.forEach((row) => { const wrapped = this.wrapItem(key, cloneJson(row), this.newId()); state.list.push(wrapped); }); } }
}
