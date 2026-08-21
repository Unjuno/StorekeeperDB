import type { Signal } from "./types.js";

export function externalStore<T>(signal: Signal<T>) {
  return {
    subscribe: signal.subscribe,
    getSnapshot: signal.getSnapshot,
    getServerSnapshot: signal.getSnapshot,
  };
}
