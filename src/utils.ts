import type { JsonScalar } from "./types.js";

export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isScalar = (value: unknown): value is JsonScalar =>
  value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const pathGet = (value: unknown, path: string): unknown =>
  path.split(".").reduce((acc: unknown, key) => {
    if (isObjectRecord(acc) || Array.isArray(acc)) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);

export const valueType = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

export const isArrayIndex = (property: string | symbol): boolean => {
  if (typeof property !== "string") return false;
  if (property === "") return false;
  const n = Number(property);
  return Number.isInteger(n) && n >= 0 && String(n) === property;
};

export const expectJsonObject = (value: unknown): Record<string, unknown> => {
  if (!isObjectRecord(value)) throw new Error("StorekeeperDB persistent lists only support object items.");
  return value;
};
