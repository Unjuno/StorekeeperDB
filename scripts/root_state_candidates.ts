import { StorekeeperDB } from "../src/index.js";
import type { Signal, Snapshot } from "../src/types.js";

export function singletonObjectState<T extends object>(sk: StorekeeperDB, key: string, initial: T): T {
  const list = sk.state<T[]>(key, [initial]);
  if (list.length !== 1) {
    throw new Error(`Singleton state ${key} expected exactly one item, found ${list.length}.`);
  }
  return list[0]!;
}

export function singletonObjectSignal<T extends object>(sk: StorekeeperDB, key: string, initial: T): Signal<T> {
  const listSignal = sk.signal<T[]>(key, [initial]);
  let version = listSignal.getSnapshot().version;
  let snapshot: Snapshot<T> = { value: listSignal.value[0]!, version };

  return {
    get value() {
      const current = listSignal.value[0];
      if (!current) throw new Error(`Singleton state ${key} is empty.`);
      return current;
    },
    getSnapshot: () => {
      const upstream = listSignal.getSnapshot();
      if (upstream.version !== version) {
        version = upstream.version;
        const current = listSignal.value[0];
        if (!current) throw new Error(`Singleton state ${key} is empty.`);
        snapshot = { value: current, version };
      }
      return snapshot;
    },
    subscribe: (fn) => listSignal.subscribe(fn),
  };
}

export type RootCell<T> = { value: T };

export function rootCell<T>(sk: StorekeeperDB, key: string, initial: T): RootCell<T> {
  const list = sk.state<RootCell<T>[]>(key, [{ value: initial }]);
  if (list.length !== 1) {
    throw new Error(`Root cell ${key} expected exactly one holder, found ${list.length}.`);
  }
  return list[0]!;
}

export function rootCellSignal<T>(sk: StorekeeperDB, key: string, initial: T): Signal<T> {
  const holderSignal = sk.signal<RootCell<T>[]>(key, [{ value: initial }]);
  let version = holderSignal.getSnapshot().version;
  let snapshot: Snapshot<T> = { value: holderSignal.value[0]!.value, version };

  return {
    get value() {
      const holder = holderSignal.value[0];
      if (!holder) throw new Error(`Root cell ${key} is empty.`);
      return holder.value;
    },
    getSnapshot: () => {
      const upstream = holderSignal.getSnapshot();
      if (upstream.version !== version) {
        version = upstream.version;
        const holder = holderSignal.value[0];
        if (!holder) throw new Error(`Root cell ${key} is empty.`);
        snapshot = { value: holder.value, version };
      }
      return snapshot;
    },
    subscribe: (fn) => holderSignal.subscribe(fn),
  };
}
