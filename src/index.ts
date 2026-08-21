import { DatabaseSync } from "node:sqlite";
export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
export type Dict = Record<string, JsonValue>;
export type Snapshot<T> = { value: T; version: number };
export type Signal<T> = { value: T; getSnapshot(): Snapshot<T>; subscribe(fn: () => void): () => void };
export type StorekeeperOptions = { magic?: boolean };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is JsonScalar => v === null || ["string", "number", "boolean"].includes(typeof v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const pathGet = (v: unknown, p: string): unknown => p.split(".").reduce((a: unknown, k) => (isObj(a) || Array.isArray(a)) ? (a as Record<string, unknown>)[k] : undefined, v);
const typeOf = (v: unknown) => v === null ? "null" : typeof v;
type ItemRow = { id: string; value_json: string };
type MagicRow = { id: number; action: string; state_key: string; path: string | null; reason: string; created_at: string };

export class StorekeeperDB {
  private db: DatabaseSync;
  private magic: boolean;
  private mem = new Map<string, Dict[]>();
  private ids = new WeakMap<object, string>();
  private vers = new Map<string, number>();
  private subs = new Map<string, Set<() => void>>();
  private next = 1;

  constructor(path: string, options: StorekeeperOptions = {}) {
    this.db = new DatabaseSync(path); this.magic = options.magic ?? true; this.init();
  }
  close() { this.db.close(); }
  batch<T>(fn: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; } }

  state<T extends object[]>(key: string, initial: T): T {
    if (!this.mem.has(key)) {
      const rows = this.db.prepare("SELECT id,value_json FROM __sk_items WHERE state_key=? ORDER BY pos").all(key) as ItemRow[];
      const list: Dict[] = []; this.mem.set(key, list);
      const source = rows.length ? rows.map(r => this.wrapItem(key, JSON.parse(r.value_json), r.id)) : initial.map(x => this.wrapItem(key, clone(x as Dict), this.newId()));
      source.forEach((x, i) => { list.push(x); if (!rows.length) this.save(key, this.ids.get(x)!, i, x); });
    }
    return this.wrapList(key, this.mem.get(key)!) as T;
  }

  signal<T extends object[]>(key: string, initial: T): Signal<T> {
    const value = this.state<T>(key, initial); let ver = this.version(key); let snap = { value, version: ver };
    return { value, getSnapshot: () => { const v = this.version(key); if (v !== ver) { ver = v; snap = { value, version: v }; } return snap; }, subscribe: f => this.subscribe(key, f) };
  }

  find<T extends Dict>(key: string, where: Partial<Record<keyof T & string, JsonScalar>>): T[] {
    const pairs = Object.entries(where) as [string, JsonScalar][];
    if (pairs.length === 0) return this.state<Dict[]>(key, [] as Dict[]).map(clone) as T[];
    if (this.magic) for (const [p] of pairs) this.project(key, p, "find");
    const [p0, v0] = pairs[0];
    const ids = this.projected(key, p0) ? new Set((this.db.prepare("SELECT item_id FROM __sk_projection WHERE state_key=? AND path=? AND value_json=?").all(key, p0, JSON.stringify(v0)) as { item_id: string }[]).map(r => r.item_id)) : null;
    return this.state<Dict[]>(key, [] as Dict[]).filter(x => (!ids || ids.has(this.ids.get(x)!)) && pairs.every(([p, v]) => pathGet(x, p) === v)).map(clone) as T[];
  }

  liveFind<T extends Dict>(key: string, where: Partial<Record<keyof T & string, JsonScalar>>) {
    let version = 0, value = this.find<T>(key, where); const listeners = new Set<() => void>();
    const stop = this.subscribe(key, () => { const n = this.find<T>(key, where); if (JSON.stringify(n) !== JSON.stringify(value)) { value = n; version++; listeners.forEach(f => f()); } });
    return { getSnapshot: () => ({ value, version }), subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); if (!listeners.size) stop(); }; } };
  }
  promote(key: string, paths: string[]) { paths.forEach(p => this.project(key, p, "manual", true)); }
  harden(key: string, paths: string[]) { this.promote(key, paths); }
  status() { return { states: (this.one("SELECT COUNT(DISTINCT state_key) n FROM __sk_items") as any).n, items: (this.one("SELECT COUNT(*) n FROM __sk_items") as any).n, projectionCells: (this.one("SELECT COUNT(*) n FROM __sk_projection") as any).n, magic: this.magic }; }
  inspect(key: string) { return { stateKey: key, itemCount: (this.one("SELECT COUNT(*) n FROM __sk_items WHERE state_key=?", key) as any).n, derivations: this.derivations(key), hardenedPaths: this.derivations(key).map((d: any) => d.path) }; }
  explain(key: string, path: string) { const r = this.db.prepare("SELECT observed_type,read_count,write_count FROM __sk_paths WHERE state_key=? AND path=?").get(key, path) as any; const projected = this.projected(key, path); return { stateKey: key, path, observed: !!r, observedType: r?.observed_type ?? null, readCount: r?.read_count ?? 0, writeCount: r?.write_count ?? 0, storage: projected ? "projection" : "json_only", queryStrategyIfFiltered: projected ? "projection" : "json_scan" }; }
  debug() { return { recentMagic: (limit = 20) => this.db.prepare("SELECT * FROM __sk_magic_log ORDER BY id DESC LIMIT ?").all(limit) as MagicRow[], derivations: (key?: string) => this.derivations(key), evict: (key: string, paths: string[]) => paths.forEach(p => this.evict(key, p)), rebuild: (key: string, paths: string[]) => paths.forEach(p => this.project(key, p, "debug_rebuild", true)), compactMetadata: (limit = 100) => { const row = this.db.prepare("SELECT id FROM __sk_magic_log ORDER BY id DESC LIMIT 1 OFFSET ?").get(limit - 1) as any; if (!row) return { magicLogsDeleted: 0 }; const before = (this.one("SELECT COUNT(*) n FROM __sk_magic_log") as any).n; this.db.prepare("DELETE FROM __sk_magic_log WHERE id < ?").run(row.id); return { magicLogsDeleted: before - (this.one("SELECT COUNT(*) n FROM __sk_magic_log") as any).n }; } }; }

  private init() { this.db.exec(`CREATE TABLE IF NOT EXISTS __sk_items(state_key TEXT,id TEXT,pos INTEGER,value_json TEXT,PRIMARY KEY(state_key,id));CREATE INDEX IF NOT EXISTS __sk_items_order ON __sk_items(state_key,pos);CREATE TABLE IF NOT EXISTS __sk_paths(state_key TEXT,path TEXT,observed_type TEXT,read_count INTEGER DEFAULT 0,write_count INTEGER DEFAULT 0,PRIMARY KEY(state_key,path));CREATE TABLE IF NOT EXISTS __sk_projection(state_key TEXT,path TEXT,item_id TEXT,value_json TEXT,PRIMARY KEY(state_key,path,item_id));CREATE INDEX IF NOT EXISTS __sk_projection_lookup ON __sk_projection(state_key,path,value_json);CREATE TABLE IF NOT EXISTS __sk_derivations(state_key TEXT,path TEXT,kind TEXT,state TEXT,use_count INTEGER DEFAULT 0,storage_cost INTEGER DEFAULT 0,PRIMARY KEY(state_key,path,kind));CREATE TABLE IF NOT EXISTS __sk_magic_log(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT,state_key TEXT,path TEXT,reason TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`); }
  private wrapList(key: string, list: Dict[]): Dict[] { return new Proxy(list, { get: (o, p, r) => p === "push" ? (...xs: Dict[]) => { xs.forEach(x => { const item = this.wrapItem(key, clone(x), this.newId()); o.push(item); this.save(key, this.ids.get(item)!, o.length - 1, item); }); this.bump(key); return o.length; } : Reflect.get(o, p, r), set: (_o, p) => { if (String(Number(p)) === String(p)) throw new Error("Sparse or direct index assignment is not supported; use push/splice."); return false; }, deleteProperty: () => { throw new Error("delete on persistent arrays is not supported; use splice/pop."); } }); }
  private wrapItem(key: string, item: Dict, id: string): Dict { const proxy = new Proxy(item, { get: (o, p, r) => { const v = Reflect.get(o, p, r); if (typeof p === "string") this.observe(key, p, v, "read"); return v; }, set: (o, p, v) => { if (typeof p !== "string") return false; Reflect.set(o, p, v); this.observe(key, p, v, "write"); this.save(key, id, this.mem.get(key)?.indexOf(proxy) ?? 0, o as Dict); if (this.projected(key, p) && isScalar(v)) this.writeProjection(key, p, id, v); this.bump(key); return true; } }) as Dict; this.ids.set(proxy, id); return proxy; }
  private save(key: string, id: string, pos: number, item: Dict) { this.db.prepare("INSERT INTO __sk_items(state_key,id,pos,value_json) VALUES(?,?,?,?) ON CONFLICT(state_key,id) DO UPDATE SET pos=excluded.pos,value_json=excluded.value_json").run(key, id, pos, JSON.stringify(item)); this.derivations(key).forEach((d: any) => { const v = pathGet(item, d.path); if (isScalar(v)) this.writeProjection(key, d.path, id, v); }); }
  private project(key: string, path: string, reason: string, force = false) { if (!force && this.projected(key, path)) { this.db.prepare("UPDATE __sk_derivations SET use_count=use_count+1,state='hot' WHERE state_key=? AND path=?").run(key, path); return; } const items = this.state<Dict[]>(key, [] as Dict[]); const vals = items.map(x => pathGet(x, path)); if (!vals.every(v => v === undefined || isScalar(v))) return; this.batch(() => { this.db.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=?").run(key, path); items.forEach(x => { const v = pathGet(x, path); if (isScalar(v)) this.writeProjection(key, path, this.ids.get(x)!, v); }); }); this.db.prepare("INSERT INTO __sk_derivations(state_key,path,kind,state,use_count,storage_cost) VALUES(?,?, 'projection','hot',1,?) ON CONFLICT(state_key,path,kind) DO UPDATE SET use_count=use_count+1,state='hot',storage_cost=excluded.storage_cost").run(key, path, vals.length); this.db.prepare("INSERT INTO __sk_magic_log(action,state_key,path,reason) VALUES('auto_promote',?,?,?)").run(key, path, reason); this.bump(key); }
  private evict(key: string, path: string) { this.db.prepare("DELETE FROM __sk_projection WHERE state_key=? AND path=?").run(key, path); this.db.prepare("DELETE FROM __sk_derivations WHERE state_key=? AND path=?").run(key, path); this.db.prepare("INSERT INTO __sk_magic_log(action,state_key,path,reason) VALUES('evict_projection',?,?,?)").run(key, path, "debug"); }
  private writeProjection(key: string, path: string, id: string, v: JsonScalar) { this.db.prepare("INSERT INTO __sk_projection(state_key,path,item_id,value_json) VALUES(?,?,?,?) ON CONFLICT(state_key,path,item_id) DO UPDATE SET value_json=excluded.value_json").run(key, path, id, JSON.stringify(v)); }
  private projected(key: string, path: string) { return !!this.db.prepare("SELECT 1 FROM __sk_derivations WHERE state_key=? AND path=?").get(key, path); }
  private derivations(key?: string) { return key ? this.db.prepare("SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations WHERE state_key=? ORDER BY path").all(key) : this.db.prepare("SELECT state_key,path,state,use_count,storage_cost FROM __sk_derivations ORDER BY state_key,path").all(); }
  private observe(key: string, path: string, v: unknown, mode: "read" | "write") { const col = mode === "read" ? "read_count" : "write_count"; this.db.prepare(`INSERT INTO __sk_paths(state_key,path,observed_type,${col}) VALUES(?,?,?,1) ON CONFLICT(state_key,path) DO UPDATE SET observed_type=excluded.observed_type,${col}=${col}+1`).run(key, path, typeOf(v)); }
  private subscribe(key: string, fn: () => void) { let s = this.subs.get(key); if (!s) this.subs.set(key, s = new Set()); s.add(fn); return () => { s!.delete(fn); if (!s!.size) this.subs.delete(key); }; }
  private bump(key: string) { this.vers.set(key, this.version(key) + 1); this.subs.get(key)?.forEach(f => f()); }
  private version(key: string) { return this.vers.get(key) ?? 0; }
  private one(sql: string, ...args: unknown[]) { return this.db.prepare(sql).get(...args); }
  private newId() { return `sk_${Date.now().toString(36)}_${this.next++}`; }
}
export function live<T, U>(signal: Signal<T>, selector: (value: T) => U) { let version = 0, value = selector(signal.getSnapshot().value); const subs = new Set<() => void>(); const stop = signal.subscribe(() => { const next = selector(signal.getSnapshot().value); if (JSON.stringify(next) !== JSON.stringify(value)) { value = next; version++; subs.forEach(f => f()); } }); return { getSnapshot: () => ({ value, version }), subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); if (!subs.size) stop(); }; } }; }
export function liveFind<T extends Dict>(sk: StorekeeperDB, stateKey: string, where: Partial<Record<keyof T & string, JsonScalar>>) { return sk.liveFind<T>(stateKey, where); }
