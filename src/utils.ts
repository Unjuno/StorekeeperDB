import type { JsonScalar } from "./types.js";

export const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isScalar = (value: unknown): value is JsonScalar =>
  value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const valueType = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

export const pathGet = (value: unknown, path: string): unknown => {
  if (!path) return value;
  return path.split(".").reduce((acc: unknown, key) => {
    if (isObjectRecord(acc) || Array.isArray(acc)) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);
};

export const isArrayIndex = (property: string | symbol): property is string => {
  if (typeof property !== "string") return false;
  if (property.trim() === "") return false;
  const index = Number(property);
  return Number.isInteger(index) && index >= 0 && String(index) === property;
};
