import type { Dict, JsonScalar, Signal } from "./types.js";
import { StorekeeperDB } from "./runtime.js";

export function live<T, U>(signal: Signal<T>, selector: (value: T) => U) {
  let version = 0;
  let value = selector(signal.getSnapshot().value);
  const listeners = new Set<() => void>();
  let stopUpstream: (() => void) | null = null;

  const recompute = () => {
    const next = selector(signal.getSnapshot().value);
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
      if (!stopUpstream) stopUpstream = signal.subscribe(recompute);
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

export function liveFind<T extends Dict>(sk: StorekeeperDB, stateKey: string, where: Partial<Record<keyof T & string, JsonScalar>>) {
  return sk.liveFind<T>(stateKey, where);
}
