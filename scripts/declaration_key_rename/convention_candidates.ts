import { StorekeeperDB } from "@storekeeper/db";

export type StateKind = "list" | "object";

type ListDescriptor<T extends object> = {
  kind: "list";
  initial: T[];
  from?: string;
  id?: string;
};

type ObjectDescriptor<T extends object> = {
  kind: "object";
  initial: T;
  from?: string;
  id?: string;
};

type StateDescriptor = ListDescriptor<object> | ObjectDescriptor<object>;
type ProjectShape = Record<string, StateDescriptor>;

type ValueOf<D> =
  D extends ListDescriptor<infer T> ? T[] :
  D extends ObjectDescriptor<infer T> ? T :
  never;

type StateOf<S extends ProjectShape> = {
  [K in keyof S]: ValueOf<S[K]>;
};

type DurableBinding = {
  physicalKey: string;
  kind: StateKind;
};

type IdentityManifest = {
  id: "project-identity-manifest";
  bindings: Record<string, DurableBinding>;
};

export const renameList = <T extends object>(initial: T[], options: { from?: string; id?: string } = {}): ListDescriptor<T> => ({
  kind: "list",
  initial,
  ...options,
});

export const renameObject = <T extends object>(initial: T, options: { from?: string; id?: string } = {}): ObjectDescriptor<T> => ({
  kind: "object",
  initial,
  ...options,
});

export type RenameProjectStore<S extends ProjectShape> = {
  state: StateOf<S>;
  close(): void;
};

const loadState = <S extends ProjectShape>(
  sk: StorekeeperDB,
  shape: S,
  physicalKeys: Record<string, string>,
): StateOf<S> => {
  const loaded: Partial<StateOf<S>> = {};
  for (const logicalKey of Object.keys(shape) as Array<keyof S & string>) {
    const descriptor = shape[logicalKey]!;
    const physicalKey = physicalKeys[logicalKey]!;
    if (descriptor.kind === "list") {
      (loaded as Record<string, unknown>)[logicalKey] = sk.state(physicalKey, descriptor.initial as object[]);
      continue;
    }

    const holder = sk.state(physicalKey, [descriptor.initial]);
    if (holder.length !== 1) {
      sk.close();
      throw new Error(`Project object state ${logicalKey} expected exactly one durable item, found ${holder.length}.`);
    }
    (loaded as Record<string, unknown>)[logicalKey] = holder[0]!;
  }
  return loaded as StateOf<S>;
};

const declarationKinds = (shape: ProjectShape): Record<string, StateKind> =>
  Object.fromEntries(Object.entries(shape).map(([key, descriptor]) => [key, descriptor.kind])) as Record<string, StateKind>;

const openManifest = (sk: StorekeeperDB): IdentityManifest => {
  const holder = sk.state<IdentityManifest[]>("__project_identity", [{
    id: "project-identity-manifest",
    bindings: {},
  }]); // @candidate-b-framework-internal:identity-manifest @candidate-c-framework-internal:identity-manifest
  if (holder.length !== 1) throw new Error("Identity manifest expected exactly one durable row.");
  return holder[0]!;
};

export function openStrictRenameProjectStore<S extends ProjectShape>(path: string, shape: S): RenameProjectStore<S> {
  const sk = new StorekeeperDB(path);
  const manifest = openManifest(sk); // @candidate-b-framework-public:strict-declaration-identity
  const kinds = declarationKinds(shape);
  const declared = Object.keys(shape).sort();
  const existing = Object.keys(manifest.bindings).sort();

  if (existing.length === 0) {
    manifest.bindings = Object.fromEntries(declared.map((key) => [key, { physicalKey: key, kind: kinds[key]! }]));
  } else {
    const sameNames = JSON.stringify(existing) === JSON.stringify(declared);
    const sameKinds = sameNames && declared.every((key) => manifest.bindings[key]?.kind === kinds[key]);
    if (!sameNames || !sameKinds) {
      sk.close();
      throw new Error(`Unexplained durable declaration identity change: ${existing.join(",")} -> ${declared.join(",")}`);
    }
  }

  const physicalKeys = Object.fromEntries(declared.map((key) => [key, manifest.bindings[key]!.physicalKey]));
  return { state: loadState(sk, shape, physicalKeys), close: () => sk.close() };
}

export function openAliasRenameProjectStore<S extends ProjectShape>(path: string, shape: S): RenameProjectStore<S> {
  const sk = new StorekeeperDB(path);
  const manifest = openManifest(sk); // @candidate-c-framework-internal:logical-physical-binding
  const kinds = declarationKinds(shape);
  const declared = Object.keys(shape).sort();
  const existingBindings = JSON.parse(JSON.stringify(manifest.bindings)) as Record<string, DurableBinding>;

  if (Object.keys(existingBindings).length === 0) {
    manifest.bindings = Object.fromEntries(declared.map((key) => [key, { physicalKey: key, kind: kinds[key]! }]));
  } else {
    const nextBindings = { ...existingBindings };
    const consumedOldNames = new Set<string>();

    for (const logicalKey of declared) {
      const descriptor = shape[logicalKey]!;
      const existing = nextBindings[logicalKey];
      if (existing) {
        if (existing.kind !== descriptor.kind) {
          sk.close();
          throw new Error(`Durable state kind changed for ${logicalKey}.`);
        }
        continue;
      }

      if (descriptor.from) { // @candidate-c-framework-public:rename-alias @candidate-c-framework-internal:rename-resolution
        const prior = existingBindings[descriptor.from];
        if (!prior) {
          sk.close();
          throw new Error(`Rename source ${descriptor.from} does not exist.`);
        }
        if (prior.kind !== descriptor.kind) {
          sk.close();
          throw new Error(`Rename source kind mismatch for ${descriptor.from} -> ${logicalKey}.`);
        }
        nextBindings[logicalKey] = prior;
        delete nextBindings[descriptor.from];
        consumedOldNames.add(descriptor.from);
        continue;
      }

      const removedOldNames = Object.keys(existingBindings).filter((oldName) => !declared.includes(oldName) && !consumedOldNames.has(oldName));
      if (removedOldNames.length > 0) {
        sk.close();
        throw new Error(`New durable declaration ${logicalKey} is ambiguous with removed state ${removedOldNames.join(",")}; provide an explicit rename alias.`);
      }
      nextBindings[logicalKey] = { physicalKey: logicalKey, kind: descriptor.kind };
    }

    const unexplainedRemoved = Object.keys(existingBindings).filter((oldName) => !declared.includes(oldName) && !consumedOldNames.has(oldName));
    if (unexplainedRemoved.length > 0) {
      sk.close();
      throw new Error(`Removed durable declaration requires explicit migration: ${unexplainedRemoved.join(",")}`);
    }

    manifest.bindings = nextBindings;
  }

  const physicalKeys = Object.fromEntries(declared.map((key) => [key, manifest.bindings[key]!.physicalKey]));
  return { state: loadState(sk, shape, physicalKeys), close: () => sk.close() };
}

export function openStableIdProjectStore<S extends ProjectShape>(path: string, shape: S): RenameProjectStore<S> {
  const sk = new StorekeeperDB(path);
  const declared = Object.keys(shape) as Array<keyof S & string>;
  const physicalKeys = Object.fromEntries(declared.map((logicalKey) => {
    const descriptor = shape[logicalKey]!;
    return [logicalKey, descriptor.id ?? logicalKey]; // @candidate-d-framework-public:stable-durable-id @candidate-d-framework-internal:stable-id-binding
  }));
  return { state: loadState(sk, shape, physicalKeys), close: () => sk.close() };
}
