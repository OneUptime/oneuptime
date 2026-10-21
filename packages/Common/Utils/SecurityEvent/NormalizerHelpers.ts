import { JSONObject, JSONValue } from "../../Types/JSON";
import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import Crypto from "../Crypto";

/*
 * Shared helpers for the security-event normalizers (OCSF, UDM, SecOps
 * alert, generic). Pure and isomorphic — no server imports — so the same
 * code is unit-testable and usable from the UI if ever needed.
 */

/*
 * Flatten a nested payload into dot-notation keys with scalar values, the
 * shape the SecurityEvent `attributes` Map(String,String) column stores.
 *
 * Arrays of scalars collapse to a comma-joined string (queryable with a
 * "contains" filter); arrays of objects recurse with the index in the key.
 * Depth is capped so a hostile payload cannot recurse unboundedly.
 */
export function flattenPayload(
  payload: JSONObject,
  maxDepth: number = 10,
): JSONObject {
  const result: JSONObject = {};

  const visit: (value: JSONValue, prefix: string, depth: number) => void = (
    value: JSONValue,
    prefix: string,
    depth: number,
  ): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      const scalars: Array<JSONValue> = value.filter(
        (item: JSONValue): boolean => {
          return typeof item !== "object" || item === null;
        },
      );

      if (scalars.length === value.length) {
        if (value.length > 0) {
          result[prefix] = value
            .map((item: JSONValue): string => {
              return String(item);
            })
            .join(",");
        }
        return;
      }

      value.forEach((item: JSONValue, index: number): void => {
        visit(item, `${prefix}.${index}`, depth + 1);
      });

      return;
    }

    if (typeof value === "object") {
      if (depth >= maxDepth) {
        result[prefix] = JSON.stringify(value);
        return;
      }

      for (const key of Object.keys(value as JSONObject)) {
        const child: JSONValue = (value as JSONObject)[key];
        visit(child, prefix ? `${prefix}.${key}` : key, depth + 1);
      }

      return;
    }

    result[prefix] = String(value);
  };

  visit(payload, "", 0);

  return result;
}

/*
 * Read a string off a nested payload by dot path, tolerating arrays along
 * the way (first element wins). Returns '' when the path is absent or not
 * scalar — normalizers treat empty string as "source did not say".
 */
export function readString(payload: JSONObject, path: string): string {
  const value: JSONValue = readValue(payload, path);

  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    const first: JSONValue = value.find((item: JSONValue): boolean => {
      return item !== null && item !== undefined && typeof item !== "object";
    });
    return first === undefined ? "" : String(first);
  }

  if (typeof value === "object") {
    return "";
  }

  return String(value);
}

export function readNumber(payload: JSONObject, path: string): number | null {
  const value: JSONValue = readValue(payload, path);

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function readStringArray(
  payload: JSONObject,
  path: string,
): Array<string> {
  const value: JSONValue = readValue(payload, path);

  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((item: JSONValue): boolean => {
        return item !== null && item !== undefined && typeof item !== "object";
      })
      .map((item: JSONValue): string => {
        return String(item);
      });
  }

  if (typeof value === "object") {
    return [];
  }

  return [String(value)];
}

export function readValue(payload: JSONObject, path: string): JSONValue {
  const parts: Array<string> = path.split(".");
  let current: JSONValue = payload;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return null;
    }

    if (Array.isArray(current)) {
      current = current[0] as JSONValue;
    }

    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return null;
    }

    current = (current as JSONObject)[part] as JSONValue;
  }

  return current === undefined ? null : current;
}

/*
 * Parse the timestamps security payloads actually carry: RFC3339 strings,
 * epoch seconds, epoch millis, and epoch micros/nanos (which UDM and OCSF
 * both use in places). Returns null rather than guessing when the value is
 * unparseable — the caller decides the fallback.
 */
export function parseEventTime(value: JSONValue): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numeric: number = Number(value);

    if (!Number.isFinite(numeric)) {
      const parsed: Date = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return parseEventTime(numeric);
  }

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Epoch scale by magnitude: seconds < 1e11 < millis < 1e14 < micros < 1e17 < nanos.
    let millis: number = value;

    if (value >= 1e17) {
      millis = value / 1e6;
    } else if (value >= 1e14) {
      millis = value / 1e3;
    } else if (value < 1e11) {
      millis = value * 1000;
    }

    const parsed: Date = new Date(Math.trunc(millis));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/*
 * Build the deduplicated observables array from the entity fields a
 * normalizer extracted. Order is stable (users, hosts, ips, then extras)
 * so tests and content hashing are deterministic.
 */
export function buildObservables(
  values: Array<string | undefined>,
): Array<string> {
  const seen: Set<string> = new Set<string>();
  const observables: Array<string> = [];

  for (const value of values) {
    const trimmed: string = (value || "").trim();

    if (!trimmed) {
      continue;
    }

    const canonical: string = trimmed.toLowerCase();

    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    observables.push(trimmed);
  }

  return observables;
}

/*
 * One process as a source describes it: any of its file name, the full
 * path of its executable and its command line.
 */
export interface ProcessReading {
  name?: string | undefined;
  path?: string | undefined;
  commandLine?: string | undefined;
}

export type ProcessFields = Pick<
  NormalizedSecurityEvent,
  | "processName"
  | "processPath"
  | "processCommandLine"
  | "parentProcessName"
  | "parentProcessPath"
  | "parentProcessCommandLine"
>;

function isPathSeparator(character: string | undefined): boolean {
  return character === "/" || character === "\\";
}

/*
 * The last segment of a path, on either separator: "powershell.exe" of
 * "C:\Windows\...\powershell.exe", "cat" of "/usr/bin/cat". A loop, not a
 * regular expression: a path is source text of any length.
 */
export function fileNameOfPath(path: string): string {
  const trimmed: string = (path || "").trim();
  let end: number = trimmed.length;

  while (end > 0 && isPathSeparator(trimmed[end - 1])) {
    end--;
  }

  let start: number = end;

  while (start > 0 && !isPathSeparator(trimmed[start - 1])) {
    start--;
  }

  return trimmed.slice(start, end);
}

/*
 * A folder and a file name as one path, joined with the folder's own
 * separator (a backslash for a Windows folder). Sources such as Microsoft
 * Graph name a file by its folder and its name; a folder that already ends
 * in the name is the path already.
 */
export function joinPath(folder: string, name: string): string {
  const trimmedFolder: string = (folder || "").trim();
  const trimmedName: string = (name || "").trim();

  if (!trimmedFolder || !trimmedName) {
    return "";
  }

  if (
    fileNameOfPath(trimmedFolder).toLowerCase() === trimmedName.toLowerCase()
  ) {
    return trimmedFolder;
  }

  const separator: string =
    trimmedFolder.includes("\\") || trimmedFolder.includes(":") ? "\\" : "/";

  return isPathSeparator(trimmedFolder[trimmedFolder.length - 1])
    ? `${trimmedFolder}${trimmedName}`
    : `${trimmedFolder}${separator}${trimmedName}`;
}

// Whether a source said anything about a process at all.
export function namesProcess(reading: ProcessReading | undefined): boolean {
  return Boolean(
    (reading?.name || "").trim() ||
      (reading?.path || "").trim() ||
      (reading?.commandLine || "").trim(),
  );
}

/*
 * The six process fields of an event from the process it is about and that
 * process's parent. A source that gives a path but no name gets the path's
 * file name, so the name is there to group and filter by either way.
 */
export function buildProcessFields(data: {
  process?: ProcessReading | undefined;
  parent?: ProcessReading | undefined;
}): ProcessFields {
  const processPath: string = (data.process?.path || "").trim();
  const parentProcessPath: string = (data.parent?.path || "").trim();

  return {
    processName:
      (data.process?.name || "").trim() || fileNameOfPath(processPath),
    processPath,
    processCommandLine: (data.process?.commandLine || "").trim(),
    parentProcessName:
      (data.parent?.name || "").trim() || fileNameOfPath(parentProcessPath),
    parentProcessPath,
    parentProcessCommandLine: (data.parent?.commandLine || "").trim(),
  };
}

/*
 * Stable content hash used as eventUid when the source payload carries no
 * id of its own. Repeated deliveries of the same payload produce the same
 * uid, so downstream consumers can dedupe.
 */
export function contentHashEventUid(payload: JSONObject): string {
  const flattened: JSONObject = flattenPayload(payload);
  const canonical: string = JSON.stringify(
    flattened,
    Object.keys(flattened).sort(),
  );

  return `sha256:${Crypto.getSha256Hash(canonical)}`;
}
