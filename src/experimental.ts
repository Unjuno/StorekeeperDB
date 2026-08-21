export type AsyncDurabilityStatus = "clean" | "dirty" | "flushing" | "failed";

export class ExperimentalAsyncBoundaryUnsupportedError extends Error {
  constructor() {
    super("Async browser-style write-behind storage is experimental and is not implemented in the alpha runtime.");
  }
}
