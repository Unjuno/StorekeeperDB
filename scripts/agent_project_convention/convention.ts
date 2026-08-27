import { StorekeeperDB, type Dict, type JsonScalar } from "@storekeeper/db"; // @framework-internal:runtime-ownership

export type ListState<T extends object> = {
  kind: "list";
  initial: T[];
};

export type ObjectState<T extends object> = {
  kind: "object";
  initial: T;
};

type StateDescriptor = ListState<object> | ObjectState<object>;
type ProjectShape = Record<string, StateDescriptor>;

type ValueOf<D> =
  D extends ListState<infer T> ? T[] :
  D extends ObjectState<infer T> ? T :
  never;

type StateOf<S extends ProjectShape> = {
  [K in keyof S]: ValueOf<S[K]>;
};

type ScalarWhere<T extends Dict> = Partial<Record<keyof T & string, JsonScalar>>;

// The agent-facing convention introduces one shape-description concept: list vs object.
export const list = <T extends object>(initial: T[]): ListState<T> => ({
  kind: "list",
  initial,
}); // @framework-public:shape-descriptor

export const object = <T extends object>(initial: T): ObjectState<T> => ({
  kind: "object",
  initial,
}); // @framework-public:shape-descriptor

export type AgentProjectStore<S extends ProjectShape> = {
  state: StateOf<S>;
  keys: Array<keyof S & string>;
  find<T extends Dict>(state: T[], where: ScalarWhere<T>): T[];
  close(): void;
};

// The second agent-facing concept is one project-scoped durable runtime/declaration.
export function openProjectStore<S extends ProjectShape>(path: string, shape: S): AgentProjectStore<S> { // @framework-public:project-store
  const sk = new StorekeeperDB(path); // @framework-internal:runtime-ownership
  const loaded: Partial<StateOf<S>> = {};
  const keyByList = new WeakMap<object, string>();
  const keys = Object.keys(shape) as Array<keyof S & string>; // @framework-internal:derived-state-keys

  for (const key of keys) {
    const descriptor = shape[key]!;
    if (descriptor.kind === "list") {
      const state = sk.state(key, descriptor.initial as object[]);
      (loaded as Record<string, unknown>)[key] = state;
      keyByList.set(state, key);
      continue;
    }

    const holder = sk.state(key, [descriptor.initial]); // @framework-internal:singleton-adaptation
    if (holder.length !== 1) {
      sk.close();
      throw new Error(`Project object state ${key} expected exactly one durable item, found ${holder.length}.`);
    }
    (loaded as Record<string, unknown>)[key] = holder[0]!;
  }

  return {
    state: loaded as StateOf<S>,
    keys,
    find<T extends Dict>(state: T[], where: ScalarWhere<T>): T[] {
      const key = keyByList.get(state);
      if (!key) throw new Error("Project query requires a list state owned by this project store.");
      return sk.find<T>(key, where); // @framework-internal:state-reference-query
    },
    close: () => sk.close(),
  };
}
