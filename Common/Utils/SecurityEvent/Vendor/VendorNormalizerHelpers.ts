import { JSONObject, JSONValue } from "../../../Types/JSON";
import { readNumber, readString, readValue } from "../NormalizerHelpers";

const IPV4_PATTERN: RegExp = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN: RegExp = /^[0-9a-f:]+$/i;

export function readFirstString(
  payload: JSONObject,
  paths: Array<string>,
): string {
  for (const path of paths) {
    const value: string = readString(payload, path).trim();

    if (value) {
      return value;
    }
  }

  return "";
}

export function readFirstNumber(
  payload: JSONObject,
  paths: Array<string>,
): number | null {
  for (const path of paths) {
    const value: number | null = readNumber(payload, path);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function readObject(
  payload: JSONObject,
  path: string,
): JSONObject | null {
  const value: JSONValue = readValue(payload, path);

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return null;
}

export function readObjects(
  payload: JSONObject,
  path: string,
): Array<JSONObject> {
  const value: JSONValue = readValue(payload, path);

  if (!Array.isArray(value)) {
    return [];
  }

  const result: Array<JSONObject> = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      result.push(entry as JSONObject);
    }
  }
  return result;
}

export function readAllStrings(
  payload: JSONObject,
  path: string,
): Array<string> {
  const value: JSONValue = readValue(payload, path);

  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry: JSONValue): boolean => {
        return (
          entry !== null && entry !== undefined && typeof entry !== "object"
        );
      })
      .map((entry: JSONValue): string => {
        return String(entry).trim();
      })
      .filter((entry: string): boolean => {
        return Boolean(entry);
      });
  }

  if (typeof value === "object") {
    return [];
  }

  const text: string = String(value).trim();
  return text ? [text] : [];
}

export function collectScalarStrings(
  value: JSONValue,
  maxDepth: number = 8,
): Array<string> {
  const values: Array<string> = [];

  const visit: (candidate: JSONValue, depth: number) => void = (
    candidate: JSONValue,
    depth: number,
  ): void => {
    if (candidate === null || candidate === undefined || depth > maxDepth) {
      return;
    }

    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        visit(entry, depth + 1);
      }
      return;
    }

    if (typeof candidate === "object") {
      for (const entry of Object.values(candidate as JSONObject)) {
        visit(entry, depth + 1);
      }
      return;
    }

    const text: string = String(candidate).trim();
    if (text) {
      values.push(text);
    }
  };

  visit(value, 0);
  return values;
}

export function uniqueStrings(values: Array<string>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const result: Array<string> = [];

  for (const value of values) {
    const trimmed: string = value.trim();

    if (!trimmed) {
      continue;
    }

    const canonical: string = trimmed.toLowerCase();
    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    result.push(trimmed);
  }

  return result;
}

export function prettifyToken(value: string): string {
  return value
    .trim()
    .split(/[._\-\s]+/)
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .map((part: string): string => {
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

export function lastPathSegment(value: string): string {
  const segments: Array<string> = value.split("/").filter(Boolean);
  return segments.length > 0
    ? (segments[segments.length - 1] as string)
    : value;
}

export function isIpAddress(value: string): boolean {
  const trimmed: string = value.trim();

  if (IPV4_PATTERN.test(trimmed)) {
    return trimmed.split(".").every((part: string): boolean => {
      const octet: number = Number(part);
      return octet >= 0 && octet <= 255;
    });
  }

  return trimmed.includes(":") && IPV6_PATTERN.test(trimmed);
}

export interface MitreReferences {
  tactics: Array<string>;
  techniques: Array<string>;
}

export function extractMitreReferences(values: Array<string>): MitreReferences {
  const tactics: Array<string> = [];
  const techniques: Array<string> = [];

  for (const value of values) {
    const matches: Array<string> =
      value.toUpperCase().match(/TA\d{4}|T\d{4}(?:\.\d{3})?/g) || [];

    for (const match of matches) {
      if (match.startsWith("TA")) {
        tactics.push(match);
      } else {
        techniques.push(match);
      }
    }
  }

  return {
    tactics: uniqueStrings(tactics),
    techniques: uniqueStrings(techniques),
  };
}
