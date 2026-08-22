export type AsyncDurabilityStatus = "clean" | "dirty" | "flushing" | "failed";

export type AsyncBoundaryStatus = {
  durability: AsyncDurabilityStatus;
  pendingWrites: number;
  flushCount: number;
  lastError: string | null;
};

export type AsyncStateStorage = {
  load<T extends object>(stateKey: string): Promise<T[] | undefined>;
  save<T extends object>(stateKey: string, value: T[]): Promise<void>;
};

type LoadedAsyncState<T extends object> = {
  key: string;
  list: T[];
  proxy: T[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matches<T extends object>(item: T, where: Partial<Record<keyof T & string, unknown>>): boolean {
  return Object.entries(where).every(([key, expected]) => (item as Record<string, unknown>)[key] === expected);
}

export class ExperimentalAsyncBoundaryUnsupportedError extends Error {
  constructor() {
    super("Async browser-style write-behind storage is experimental. Use ExperimentalAsyncWriteBehindRuntime to test the boundary explicitly.");
  }
}

export class AsyncMemoryStorage implements AsyncStateStorage {
  private readonly records = new Map<string, object[]>();
  private failNextMessage: string | null = null;

  async load<T extends object>(stateKey: string): Promise<T[] | undefined> {
    const value = this.records.get(stateKey);
    return value ? clone(value) as T[] : undefined;
  }

  async save<T extends object>(stateKey: string, value: T[]): Promise<void> {
    if (this.failNextMessage) {
      const message = this.failNextMessage;
      this.failNextMessage = null;
      throw new Error(message);
    }
    this.records.set(stateKey, clone(value) as object[]);
  }

  failNextSave(message = "injected async storage failure"): void {
    this.failNextMessage = message;
  }

  readCommitted<T extends object>(stateKey: string): T[] | undefined {
    const value = this.records.get(stateKey);
    return value ? clone(value) as T[] : undefined;
  }
}

export class ExperimentalAsyncWriteBehindRuntime {
  private readonly states = new Map<string, LoadedAsyncState<object>>();
  private readonly pending = new Map<string, object[]>();
  private flushing = false;
  private failure: string | null = null;
  private successfulFlushes = 0;

  constructor(private readonly storage: AsyncStateStorage = new AsyncMemoryStorage()) {}

  async state<T extends object[]>(stateKey: string, initial: T): Promise<T> {
    const existing = this.states.get(stateKey);
    if (existing) return existing.proxy as T;

    const stored = await this.storage.load<object>(stateKey);
    const list = (stored ?? clone(initial as object[])).map((item) => this.wrapItem(stateKey, item));
    const loaded: LoadedAsyncState<object> = { key: stateKey, list, proxy: [] };
    this.states.set(stateKey, loaded);
    loaded.proxy = this.wrapList(stateKey, list);
    return loaded.proxy as T;
  }

  find<T extends object>(stateKey: string, where: Partial<Record<keyof T & string, unknown>>): T[] {
    const loaded = this.states.get(stateKey);
    if (!loaded) return [];
    return loaded.list.filter((item) => matches(item as T, where)).map((item) => clone(item as T));
  }

  status(): AsyncBoundaryStatus {
    return {
      durability: this.flushing ? "flushing" : this.failure ? "failed" : this.pending.size ? "dirty" : "clean",
      pendingWrites: this.pending.size,
      flushCount: this.successfulFlushes,
      lastError: this.failure,
    };
  }

  async flush(): Promise<AsyncBoundaryStatus> {
    if (!this.pending.size) {
      this.failure = null;
      return this.status();
    }

    this.flushing = true;
    this.failure = null;
    const entries = [...this.pending.entries()];

    try {
      for (const [stateKey, rows] of entries) {
        await this.storage.save(stateKey, clone(rows));
        this.pending.delete(stateKey);
      }
      this.successfulFlushes++;
      return this.status();
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.flushing = false;
    }
  }

  private wrapList<T extends object>(stateKey: string, list: T[]): T[] {
    return new Proxy(list, {
      get: (target, property, receiver) => {
        if (property === "push") return (...items: T[]) => {
          const result = target.push(...items.map((item) => this.wrapItem(stateKey, clone(item)) as T));
          this.markDirty(stateKey);
          return result;
        };

        if (property === "pop") return () => {
          const result = target.pop();
          this.markDirty(stateKey);
          return result;
        };

        if (property === "splice") return (start: number, deleteCount?: number, ...items: T[]) => {
          const result = target.splice(start, deleteCount ?? target.length - start, ...items.map((item) => this.wrapItem(stateKey, clone(item)) as T));
          this.markDirty(stateKey);
          return result;
        };

        return Reflect.get(target, property, receiver);
      },
      set: (target, property, value) => {
        if (typeof property === "string" && Number.isInteger(Number(property))) {
          if (!isObjectRecord(value)) throw new Error("Async write-behind list items must be objects.");
          Reflect.set(target, property, this.wrapItem(stateKey, clone(value)));
          this.markDirty(stateKey);
          return true;
        }
        return Reflect.set(target, property, value);
      },
    });
  }

  private wrapItem<T extends object>(stateKey: string, item: T): T {
    return new Proxy(item, {
      set: (target, property, value) => {
        Reflect.set(target, property, value);
        this.markDirty(stateKey);
        return true;
      },
      deleteProperty: (target, property) => {
        Reflect.deleteProperty(target, property);
        this.markDirty(stateKey);
        return true;
      },
    });
  }

  private markDirty(stateKey: string): void {
    const loaded = this.states.get(stateKey);
    if (!loaded) return;
    this.failure = null;
    this.pending.set(stateKey, loaded.list.map((item) => clone(item)));
  }
}
