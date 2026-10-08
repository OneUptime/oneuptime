import Dictionary from "../../../Types/Dictionary";
import {
  getToolImportSourceDefinition,
  resolveToolImportRegion,
  ToolImportRegion,
  ToolImportSourceDefinition,
} from "../../../Types/ToolImport/ToolImportCatalog";
import {
  TOOL_IMPORT_MAX_DESCRIPTION_LENGTH,
  TOOL_IMPORT_MAX_NAME_LENGTH,
  TOOL_IMPORT_MAX_RECORDS_PER_KIND,
} from "../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportHttpClient, {
  ToolImportHttpError,
  ToolImportHttpErrorKind,
} from "./ToolImportHttpClient";
import {
  ToolImportReadContext,
  ToolImportReadError,
  ToolImportReadSettings,
} from "./Types";

/*
 * What every adapter needs and none should write twice: a client that can
 * only call the tool's own hosts with the key in the tool's header, readers
 * that take a JSON value apart without trusting its shape, and the rule for
 * a list the key may not read (a note, not a failure).
 */

/*
 * The client an adapter reads through: https://<the region's host>, the key
 * in the tool's header, and the read's request and time budget.
 */
export function createToolImportClient(data: {
  settings: ToolImportReadSettings;
  context: ToolImportReadContext;
}): ToolImportHttpClient {
  const definition: ToolImportSourceDefinition = getToolImportSourceDefinition(
    data.settings.source,
  );
  const region: ToolImportRegion | null = resolveToolImportRegion(
    data.settings.source,
    data.settings.region,
  );

  if (!region) {
    throw new ToolImportReadError(
      `Choose one of ${definition.title}'s regions.`,
    );
  }

  const apiKey: string = (data.settings.apiKey || "").trim();

  if (!apiKey) {
    throw new ToolImportReadError(`Paste your ${definition.title} API key.`);
  }

  const authorization: string =
    definition.authorizationScheme === "GenieKey"
      ? `GenieKey ${apiKey}`
      : `Bearer ${apiKey}`;

  const headers: Dictionary<string> = {
    Authorization: authorization,
  };

  return new ToolImportHttpClient({
    toolName: definition.title,
    baseUrl: `https://${region.host}`,
    allowedHosts: definition.hosts,
    headers: headers,
    secrets: [apiKey, authorization],
    transport: data.context.transport,
    sleep: data.context.sleep,
    now: data.context.now,
    maxRequests: data.context.maxRequests,
    deadlineAt: data.context.deadlineAt,
    requestTimeoutInMs: data.context.requestTimeoutInMs,
  });
}

// ---- Reading JSON without trusting its shape.

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

export function asNumber(value: unknown): number | null {
  const number: number =
    typeof value === "string" ? Number(value.trim()) : Number(value);

  return typeof value !== "boolean" &&
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(number)
    ? number
    : null;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

// A name as OneUptime stores it: trimmed, one line, cut to the column.
export function cleanName(value: unknown, fallback: string): string {
  const name: string = asString(value).replace(LINE_BREAKS, " ").trim();
  const chosen: string = name || fallback;

  return chosen.length > TOOL_IMPORT_MAX_NAME_LENGTH
    ? chosen.slice(0, TOOL_IMPORT_MAX_NAME_LENGTH).trim()
    : chosen;
}

const LINE_BREAKS: RegExp = /[\r\n\t]+/g;
const EMAIL_SHAPE: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A description cut to the column, or undefined when there is none.
export function cleanDescription(value: unknown): string | undefined {
  const description: string = asString(value);

  if (!description) {
    return undefined;
  }

  return description.length > TOOL_IMPORT_MAX_DESCRIPTION_LENGTH
    ? `${description.slice(0, TOOL_IMPORT_MAX_DESCRIPTION_LENGTH - 1).trim()}…`
    : description;
}

// An email address, lowercase, or null when the value is not one.
export function cleanEmail(value: unknown): string | null {
  const email: string = asString(value).toLowerCase();

  return email && email.length <= 100 && EMAIL_SHAPE.test(email)
    ? email
    : null;
}

// An ISO 8601 time, or null when the value is not a time.
export function cleanTime(value: unknown): string | null {
  const text: string = asString(value);

  if (!text) {
    return null;
  }

  const time: number = Date.parse(text);

  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function uniqueStrings(values: Array<string>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const unique: Array<string> = [];

  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }

  return unique;
}

/*
 * A list the key may not read, or that the tool does not have for this
 * account (a 403 or a 404), is not a failed read: the snapshot says so with
 * a CouldNotRead note naming the kind, and the import brings over the rest.
 * Anything else - the key refused, the tool down - stops the read.
 */
export async function readOptionalList<T>(data: {
  kind: ToolImportResourceKind;
  notes: Array<ToolImportNote>;
  read: () => Promise<Array<T>>;
}): Promise<Array<T>> {
  try {
    return await data.read();
  } catch (error) {
    if (
      error instanceof ToolImportHttpError &&
      (error.kind === ToolImportHttpErrorKind.Forbidden ||
        error.kind === ToolImportHttpErrorKind.NotFound)
    ) {
      data.notes.push(
        makeToolImportNote(ToolImportNoteCode.CouldNotRead, {
          kind: data.kind,
        }),
      );
      return [];
    }

    throw error;
  }
}

/*
 * Keeps at most TOOL_IMPORT_MAX_RECORDS_PER_KIND records of a kind, with a
 * ReadLimitReached note when there were more.
 */
export function capRecords<T>(data: {
  kind: ToolImportResourceKind;
  records: Array<T>;
  notes: Array<ToolImportNote>;
  hasMore?: boolean | undefined;
}): Array<T> {
  if (
    data.records.length > TOOL_IMPORT_MAX_RECORDS_PER_KIND ||
    data.hasMore
  ) {
    data.notes.push(
      makeToolImportNote(ToolImportNoteCode.ReadLimitReached, {
        kind: data.kind,
        limit: TOOL_IMPORT_MAX_RECORDS_PER_KIND,
      }),
    );
  }

  return data.records.slice(0, TOOL_IMPORT_MAX_RECORDS_PER_KIND);
}

/*
 * The key was refused, or could read nothing at all: a read error the
 * person can act on. Other failures pass through unchanged.
 */
export function toFatalReadError(data: {
  error: unknown;
  toolName: string;
  keyAdvice: string;
}): unknown {
  if (
    data.error instanceof ToolImportHttpError &&
    data.error.kind === ToolImportHttpErrorKind.Unauthorized
  ) {
    return new ToolImportReadError(
      `${data.toolName} did not accept the API key. ${data.keyAdvice}`,
    );
  }

  return data.error;
}
