import yaml from "js-yaml";
import {
  DATA_CHECK_FORMATS,
  DataCheckFormat,
} from "../../../Types/DataObservability/DataCheckFormats";
import {
  DATA_CHECK_ALERT_CONDITIONS,
  DATA_CHECK_TYPES,
  DataCheckAlertCondition,
  DataCheckType,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "../../../Types/DataObservability/DataCheckType";
import { JSONObject } from "../../../Types/JSON";

/*
 * A PROJECT'S CHECKS, WRITTEN DOWN IN ITS REPOSITORY.
 *
 * Checks written by hand drift from the code that changes the tables. Kept in a
 * file, they are reviewed in the same pull request, and applied from CI with
 * `oneuptime data-checks apply`:
 *
 *   checks:
 *     - name: Orders have a total
 *       table: public.orders
 *       type: Null Percent
 *       column: total
 *       every: 60
 *       alert: { when: Above, threshold: 1 }
 *
 * The file comes from outside, so it is read strictly. A key nobody knows is an
 * error, not a check that silently does less than it says.
 */

export const MAX_MANIFEST_LENGTH: number = 1_000_000;
export const MAX_CHECKS_PER_MANIFEST: number = 500;

export interface DataCheckManifestEntry {
  name: string;
  // As the catalog names it: "public.orders".
  table: string;
  // The database's name, when more than one has the table.
  database: string | null;
  checkType: DataCheckType;
  columnName: string | null;
  segmentColumn: string | null;
  acceptedValues: Array<string> | null;
  formatPreset: string | null;
  pattern: string | null;
  referenceTableKey: string | null;
  referenceColumnName: string | null;
  customSql: string | null;
  samplePercent: number | null;
  intervalInMinutes: number;
  alertCondition: DataCheckAlertCondition | null;
  alertThreshold: number | null;
  description: string | null;
  isEnabled: boolean;
}

export interface DataCheckManifest {
  checks: Array<DataCheckManifestEntry>;
  errors: Array<string>;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "name",
  "table",
  "database",
  "type",
  "column",
  "segment",
  "accepted_values",
  "format",
  "pattern",
  "references",
  "query",
  "sample_percent",
  "every",
  "alert",
  "description",
  "enabled",
]);

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readEntry(
  value: unknown,
  label: string,
  errors: Array<string>,
): DataCheckManifestEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} is not a check.`);
    return null;
  }

  const item: JSONObject = value as JSONObject;
  const before: number = errors.length;

  for (const key of Object.keys(item)) {
    if (!KNOWN_KEYS.has(key)) {
      errors.push(`${label}: there is no key named "${key}".`);
    }
  }

  const name: string | null = readText(item["name"]);
  const table: string | null = readText(item["table"]);
  const type: string | null = readText(item["type"]);

  if (!name) {
    errors.push(`${label} needs a name.`);
  }

  if (!table) {
    errors.push(`${name || label} needs a table, such as public.orders.`);
  }

  if (!type || !DATA_CHECK_TYPES.includes(type as DataCheckType)) {
    errors.push(
      `${name || label}: "type" is one of ${DATA_CHECK_TYPES.join(", ")}.`,
    );
  }

  const format: string | null = readText(item["format"]);

  if (format && !DATA_CHECK_FORMATS.includes(format as DataCheckFormat)) {
    errors.push(
      `${name || label}: "format" is one of ${DATA_CHECK_FORMATS.join(", ")}.`,
    );
  }

  const acceptedValues: unknown = item["accepted_values"];

  if (acceptedValues !== undefined && !Array.isArray(acceptedValues)) {
    errors.push(`${name || label}: "accepted_values" is a list.`);
  }

  // "schema.table.column": the last part is the column.
  const references: string | null = readText(item["references"]);
  const referenceDot: number = references ? references.lastIndexOf(".") : -1;

  if (references && referenceDot <= 0) {
    errors.push(
      `${name || label}: "references" is a table and a column, such as public.customers.id.`,
    );
  }

  const alert: JSONObject | null =
    item["alert"] && typeof item["alert"] === "object"
      ? (item["alert"] as JSONObject)
      : null;
  const when: string | null = readText(alert?.["when"]);

  if (
    (item["alert"] !== undefined && !alert) ||
    (alert &&
      (!when ||
        !DATA_CHECK_ALERT_CONDITIONS.includes(when as DataCheckAlertCondition)))
  ) {
    errors.push(
      `${name || label}: "alert" says when, as one of ${DATA_CHECK_ALERT_CONDITIONS.join(", ")}.`,
    );
  }

  const every: number =
    item["every"] === undefined
      ? DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES
      : Number(item["every"]);
  const threshold: number | null =
    alert?.["threshold"] === undefined || alert["threshold"] === null
      ? null
      : Number(alert["threshold"]);
  const samplePercent: number | null =
    item["sample_percent"] === undefined || item["sample_percent"] === null
      ? null
      : Number(item["sample_percent"]);

  if (errors.length > before) {
    return null;
  }

  return {
    name: name!,
    table: table!,
    database: readText(item["database"]),
    checkType: type as DataCheckType,
    columnName: readText(item["column"]),
    segmentColumn: readText(item["segment"]),
    acceptedValues: Array.isArray(acceptedValues)
      ? acceptedValues.map(String)
      : null,
    formatPreset: format,
    pattern: readText(item["pattern"]),
    referenceTableKey: references ? references.slice(0, referenceDot) : null,
    referenceColumnName: references ? references.slice(referenceDot + 1) : null,
    customSql: readText(item["query"]),
    samplePercent,
    intervalInMinutes: every,
    alertCondition: (when as DataCheckAlertCondition | null) || null,
    alertThreshold: threshold,
    description: readText(item["description"]),
    isEnabled: item["enabled"] !== false,
  };
}

export function readDataCheckManifest(text: unknown): DataCheckManifest {
  const manifest: DataCheckManifest = { checks: [], errors: [] };

  if (typeof text !== "string" || !text.trim()) {
    manifest.errors.push("The file is empty.");
    return manifest;
  }

  if (text.length > MAX_MANIFEST_LENGTH) {
    manifest.errors.push("The file is too long.");
    return manifest;
  }

  let parsed: unknown;

  try {
    // JSON's schema only: no tags, so a file can make nothing but plain values.
    parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    manifest.errors.push(
      `The file is not YAML: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`,
    );
    return manifest;
  }

  const checks: unknown = (parsed as JSONObject | null)?.["checks"];

  if (!Array.isArray(checks)) {
    manifest.errors.push('The file needs a list named "checks".');
    return manifest;
  }

  if (checks.length > MAX_CHECKS_PER_MANIFEST) {
    manifest.errors.push(
      `A file holds at most ${MAX_CHECKS_PER_MANIFEST} checks.`,
    );
    return manifest;
  }

  const seen: Set<string> = new Set();

  checks.forEach((value: unknown, index: number) => {
    const entry: DataCheckManifestEntry | null = readEntry(
      value,
      `Check ${index + 1}`,
      manifest.errors,
    );

    if (!entry) {
      return;
    }

    const key: string = getManifestKey(entry);

    if (seen.has(key)) {
      manifest.errors.push(`"${entry.name}" is on ${entry.table} twice.`);
      return;
    }

    seen.add(key);
    manifest.checks.push(entry);
  });

  return manifest;
}

// What says two checks are the same: the same name, on the same table.
export function getManifestKey(entry: {
  table: string;
  name: string;
  database?: string | null | undefined;
}): string {
  return `${entry.database || ""}|${entry.table}|${entry.name}`;
}
