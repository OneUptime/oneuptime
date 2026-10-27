import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { readClickhouseDate } from "../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";

/*
 * Reading the rows of "Your OneUptime data"'s queries: ClickHouse's JSON
 * answers a 64-bit integer as a quoted string, a missing value as null, a
 * tuple as an array and a map as an object. Every reader here turns what
 * it cannot read into the empty value of its type, never throws.
 */

export function readRowText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : String(value);
}

export function readRowNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : 0;
}

export function readRowBoolean(value: JSONValue | undefined): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function readRowDate(value: JSONValue | undefined): Date | null {
  return readClickhouseDate(value);
}

export function readRowTextArray(value: JSONValue | undefined): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: JSONValue): string => {
      return readRowText(item);
    })
    .filter(Boolean);
}

export function readRowNumberArray(
  value: JSONValue | undefined,
): Array<number> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: JSONValue): number => {
      return readRowNumber(item);
    })
    .filter((item: number): boolean => {
      return item > 0;
    });
}

export function readRowMap(value: JSONValue | undefined): Record<string, string> {
  const map: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }

  for (const [key, entry] of Object.entries(value as JSONObject)) {
    if (entry !== null && entry !== undefined) {
      map[key] = typeof entry === "string" ? entry : String(entry);
    }
  }

  return map;
}
