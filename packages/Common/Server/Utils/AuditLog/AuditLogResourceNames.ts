import { buildExceptionLabel } from "../AI/SRE/Insights/Detectors/ExceptionIdentity";
import ToolResultSerializer from "../AI/Toolbox/Serializer";
import { sanitizeExceptionMessage } from "../Telemetry/ExceptionSanitizer";

/*
 * THE NAME AN AUDIT LOG ENTRY GIVES A ROW THAT HAS NONE OF ITS OWN
 * (issue #6287).
 *
 * The recorder names an entry from the row's name, title or displayName.
 * A row with none of them - an exception, a runbook run, a template - named
 * by other columns (EnableAuditLogOn.resourceNameColumns, set by the audit
 * defaults) gets its name here, from those columns' values:
 *
 *   - an exception: its type and the start of its message, the label
 *     OneUptime AI's insights give the same exception (buildExceptionLabel),
 *     made safe as everywhere an exception's message leaves the platform -
 *     ids, addresses, emails and timestamps normalized, secrets redacted
 *     (sanitizeExceptionMessage). The audit log is read by people who may
 *     not read exceptions, and exported out of OneUptime;
 *   - anything else: its texts joined, the first line of each.
 *
 * Every name is cut to AUDIT_LOG_RESOURCE_NAME_LIMIT characters, and has
 * whatever still looks like a secret redacted (ToolResultSerializer). A
 * value can be megabytes of telemetry, so each is cut to its first line
 * within MAX_VALUE_READ characters - by indexOf, never a regular expression
 * over the whole value - before anything reads it.
 */

// The longest name an entry carries.
export const AUDIT_LOG_RESOURCE_NAME_LIMIT: number = 120;

// How much of a value is read for a name; past it, nothing is.
const MAX_VALUE_READ: number = 2000;

// How much of an exception's message its name keeps.
const EXCEPTION_MESSAGE_LIMIT: number = 80;

// A value's first line, within the first MAX_VALUE_READ characters.
export const firstLineOf: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  const text: string = (
    typeof value === "string" ? value : String(value)
  ).slice(0, MAX_VALUE_READ);
  let end: number = text.length;

  for (const breakCharacter of ["\n", "\r"]) {
    const at: number = text.indexOf(breakCharacter);

    if (at >= 0 && at < end) {
      end = at;
    }
  }

  return text.slice(0, end).trim();
};

// A text cut to the limit, by code point, ending in "…" when it was longer.
const bound: (text: string, limit: number) => string = (
  text: string,
  limit: number,
): string => {
  const characters: Array<string> = Array.from(text);

  return characters.length <= limit
    ? text
    : `${characters.slice(0, Math.max(1, limit - 1)).join("")}…`;
};

const redacted: (text: string) => string = (text: string): string => {
  return ToolResultSerializer.redact(text).text;
};

const exceptionName: (values: Record<string, unknown>) => string | null = (
  values: Record<string, unknown>,
): string | null => {
  const type: string = redacted(firstLineOf(values["exceptionType"]));
  const message: string = sanitizeExceptionMessage(
    firstLineOf(values["message"]),
  ).trim();

  if (!type && !message) {
    return null;
  }

  return buildExceptionLabel(type, message, EXCEPTION_MESSAGE_LIMIT);
};

// By table name: a name built otherwise than by joining its texts.
const NAMERS: Readonly<
  Record<string, (values: Record<string, unknown>) => string | null>
> = {
  TelemetryException: exceptionName,
};

/*
 * The entry's name from the values of the row's name columns, in their
 * order; null when they hold nothing to name it by.
 */
export const getAuditLogResourceName: (data: {
  tableName: string | null | undefined;
  columns: ReadonlyArray<string>;
  values: Record<string, unknown>;
}) => string | null = (data: {
  tableName: string | null | undefined;
  columns: ReadonlyArray<string>;
  values: Record<string, unknown>;
}): string | null => {
  const namer:
    | ((values: Record<string, unknown>) => string | null)
    | undefined =
    data.tableName &&
    Object.prototype.hasOwnProperty.call(NAMERS, data.tableName)
      ? NAMERS[data.tableName]
      : undefined;

  const name: string | null = namer
    ? namer(data.values)
    : data.columns
        .map((column: string): string => {
          return firstLineOf(data.values[column]);
        })
        .filter((text: string): boolean => {
          return text.length > 0;
        })
        .join(": ") || null;

  if (!name) {
    return null;
  }

  const safe: string = redacted(name).trim();

  return safe ? bound(safe, AUDIT_LOG_RESOURCE_NAME_LIMIT) : null;
};
