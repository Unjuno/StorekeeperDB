import "./lifecycle.js";
import { StorekeeperDB as BaseStorekeeperDB } from "./runtime.js";
import type {
  Dict,
  JsonScalar,
  StorekeeperDebugAPI,
  StorekeeperDecayOptions,
  StorekeeperOptions,
} from "./types.js";

type NormalizedDecayOptions = Required<StorekeeperDecayOptions>;

const DEFAULT_DECAY_OPTIONS: NormalizedDecayOptions = {
  enabled: false,
  collectEveryFinds: 100,
  markCold: false,
  maxDerivations: Number.POSITIVE_INFINITY,
};

const normalizeDecayOptions = (options: StorekeeperOptions["decay"]): NormalizedDecayOptions => {
  if (options === false || options === undefined) return { ...DEFAULT_DECAY_OPTIONS, enabled: false };
  if (options === true) return { ...DEFAULT_DECAY_OPTIONS, enabled: true };
  return { ...DEFAULT_DECAY_OPTIONS, ...options, enabled: options.enabled ?? true };
};

const normalizePositiveInterval = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_DECAY_OPTIONS.collectEveryFinds;
  return Math.max(1, Math.floor(value));
};

const normalizeMaxDerivations = (value: number): number | undefined => {
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
};

export class StorekeeperDB extends BaseStorekeeperDB {
  private readonly decay: NormalizedDecayOptions;
  private lookupOperationsSinceDecay = 0;

  constructor(path: string, options: StorekeeperOptions = {}) {
    super(path, options);
    this.decay = normalizeDecayOptions(options.decay);
  }

  override debug(): StorekeeperDebugAPI {
    return super.debug() as StorekeeperDebugAPI;
  }

  override find<T extends Dict>(key: string, where: Partial<Record<keyof T & string, JsonScalar>>): T[] {
    const result = super.find<T>(key, where);
    this.maybeCollectDerivedGarbage(key, Object.keys(where));
    return result;
  }

  private maybeCollectDerivedGarbage(stateKey: string, protectedPaths: string[]): void {
    if (!this.decay.enabled) return;

    this.lookupOperationsSinceDecay += 1;
    const interval = normalizePositiveInterval(this.decay.collectEveryFinds);
    if (this.lookupOperationsSinceDecay < interval) return;
    this.lookupOperationsSinceDecay = 0;

    const debug = this.debug();
    debug.collectGarbage({
      stateKey,
      markCold: this.decay.markCold,
      maxDerivations: normalizeMaxDerivations(this.decay.maxDerivations),
      protectedPaths,
    });
  }
}
