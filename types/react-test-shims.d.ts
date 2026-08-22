declare module "react" {
  export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
}

declare module "react-test-renderer" {
  export type TestRendererJSON = {
    type: string;
    props: Record<string, unknown>;
    children: Array<string | TestRendererJSON> | null;
  };

  export type ReactTestRenderer = {
    toJSON(): TestRendererJSON | TestRendererJSON[] | null;
    unmount(): void;
  };

  export function create(element: unknown): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): void | Promise<void>;
}
