import { JSONObject } from "Common/Types/JSON";

/*
 * ------------------------------------------------------------------
 *                            SpecDiff
 * ------------------------------------------------------------------
 *
 * Small pure utility that computes a compact, human-readable diff
 * between two Kubernetes resource specs (oldSpec/newSpec JSON blobs
 * captured by KubernetesResourceChangeEvent). Used by the cluster
 * Timeline page to summarize "what changed" without shipping full
 * YAML diffs to the table.
 *
 * The walk is recursive over objects and arrays (arrays compared
 * index-wise, e.g. "containers[0].image") and stops after
 * MAX_DIFF_PATHS changed leaf paths to keep row summaries bounded.
 *
 * ------------------------------------------------------------------
 */

export interface SpecDiffEntry {
  path: string;
  oldValue: string;
  newValue: string;
}

export const MAX_DIFF_PATHS: number = 10;

const MAX_VALUE_LENGTH: number = 80;

type JSONLike = unknown;

function isPlainObject(value: JSONLike): value is JSONObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function formatValue(value: JSONLike): string {
  let formatted: string;
  if (value === undefined) {
    formatted = "(none)";
  } else if (value === null) {
    formatted = "null";
  } else if (typeof value === "string") {
    formatted = value;
  } else {
    try {
      formatted = JSON.stringify(value);
    } catch {
      formatted = String(value);
    }
  }
  if (formatted.length > MAX_VALUE_LENGTH) {
    formatted = `${formatted.substring(0, MAX_VALUE_LENGTH)}…`;
  }
  return formatted;
}

function joinPath(parentPath: string, key: string): string {
  return parentPath ? `${parentPath}.${key}` : key;
}

function walk(
  oldValue: JSONLike,
  newValue: JSONLike,
  path: string,
  entries: Array<SpecDiffEntry>,
  maxPaths: number,
): void {
  if (entries.length >= maxPaths) {
    return;
  }

  // Both plain objects — recurse over the union of keys.
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const keys: Array<string> = Array.from(
      new Set([...Object.keys(oldValue), ...Object.keys(newValue)]),
    ).sort();
    for (const key of keys) {
      if (entries.length >= maxPaths) {
        return;
      }
      walk(
        (oldValue as JSONObject)[key],
        (newValue as JSONObject)[key],
        joinPath(path, key),
        entries,
        maxPaths,
      );
    }
    return;
  }

  // Both arrays — compare index-wise.
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const maxLength: number = Math.max(oldValue.length, newValue.length);
    for (let i: number = 0; i < maxLength; i++) {
      if (entries.length >= maxPaths) {
        return;
      }
      walk(oldValue[i], newValue[i], `${path}[${i}]`, entries, maxPaths);
    }
    return;
  }

  // Leaf (or type mismatch) — record when values differ.
  if (oldValue === undefined && newValue === undefined) {
    return;
  }

  let isEqual: boolean = oldValue === newValue;
  if (!isEqual) {
    try {
      isEqual = JSON.stringify(oldValue) === JSON.stringify(newValue);
    } catch {
      isEqual = false;
    }
  }

  if (!isEqual) {
    entries.push({
      path: path || "(root)",
      oldValue: formatValue(oldValue),
      newValue: formatValue(newValue),
    });
  }
}

/**
 * Compute the changed leaf paths between two specs. Returns at most
 * `maxPaths` entries (default 10), each with a dotted path and the
 * stringified old/new values.
 */
export function diffSpecs(
  oldSpec: JSONObject | null | undefined,
  newSpec: JSONObject | null | undefined,
  maxPaths: number = MAX_DIFF_PATHS,
): Array<SpecDiffEntry> {
  const entries: Array<SpecDiffEntry> = [];
  walk(oldSpec ?? undefined, newSpec ?? undefined, "", entries, maxPaths);
  return entries;
}

/**
 * Render one diff entry as a compact "path: old -> new" string.
 */
export function formatDiffEntry(entry: SpecDiffEntry): string {
  return `${entry.path}: ${entry.oldValue} -> ${entry.newValue}`;
}
