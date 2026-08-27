import { StorekeeperDB } from "../../src/index.js";
import type { Signal, Snapshot } from "../../src/types.js";

const currentSingleton = <T extends object>(value: T[], key: string): T => {
  const current = value[0];
  if (!current || value.length !== 1) {
    throw new Error(`Singleton state ${key} expected exactly one item, found ${value.length}.`);
  }
  return current;
};

export function objectState<T extends object>(sk: StorekeeperDB, key: string, initial: T): T {
  return currentSingleton(sk.state(key, [initial]), key);
}

export function objectSignal<T extends object>(sk: StorekeeperDB, key: string, initial: T): Signal<T> {
  const listSignal = sk.signal(key, [initial]);
  let version = listSignal.getSnapshot().version;
  let snapshot: Snapshot<T> = { value: currentSingleton(listSignal.value, key), version };

  return {
    get value() {
      return currentSingleton(listSignal.value, key);
    },
    getSnapshot: () => {
      const upstream = listSignal.getSnapshot();
      if (upstream.version !== version) {
        version = upstream.version;
        snapshot = { value: currentSingleton(listSignal.value, key), version };
      }
      return snapshot;
    },
    subscribe: (fn) => listSignal.subscribe(fn),
  };
}

export type ObjectHandle<T extends object> = Signal<T>;

export function objectHandle<T extends object>(sk: StorekeeperDB, key: string, initial: T): ObjectHandle<T> {
  return objectSignal(sk, key, initial);
}
