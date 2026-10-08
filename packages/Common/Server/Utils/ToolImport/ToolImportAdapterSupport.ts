import Dictionary from "../../../Types/Dictionary";
import {
  getToolImportSourceDefinition,
  isToolImportAddressGiven,
  resolveToolImportRegion,
  ToolImportRegion,
  ToolImportSourceDefinition,
} from "../../../Types/ToolImport/ToolImportCatalog";
import {
  readToolImportApiUrl,
  ToolImportApiAddress,
} from "../../../Types/ToolImport/ToolImportCredentials";
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
import { ImportedPerson } from "../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportHttpClient, {
  ToolImportHttpError,
  ToolImportHttpErrorKind,
  ToolImportQuery,
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
 * The client an adapter reads through: https://<the region's host> (or the
 * address the person gave, for a tool they also run themselves), the key -
 * and its ID, where the tool pairs one with it - in the tool's own headers,
 * the tool's pace, and the read's request and time budget.
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

  let baseUrl: string = `https://${region.host}`;
  let basePath: string = "";
  let allowedHosts: Array<string> = definition.hosts;
  let allowHttp: boolean = false;

  if (isToolImportAddressGiven(definition)) {
    const address: ToolImportApiAddress | null = readToolImportApiUrl(
      data.settings.apiUrl,
    );

    if (!address) {
      throw new ToolImportReadError(`Paste your ${definition.title} API URL.`);
    }

    baseUrl = address.origin;
    basePath = address.basePath;
    allowedHosts = [address.hostname];
    // The transport decides whether plain http may go out at all.
    allowHttp = !address.isHttps;
  }

  const apiKey: string = (data.settings.apiKey || "").trim();

  if (!apiKey) {
    throw new ToolImportReadError(`Paste your ${definition.title} API key.`);
  }

  const headers: Dictionary<string> = {};
  const secrets: Array<string> = [apiKey];

  switch (definition.authorizationScheme) {
    case "GenieKey":
      headers["Authorization"] = `GenieKey ${apiKey}`;
      break;
    case "TokenToken":
      headers["Authorization"] = `Token token=${apiKey}`;
      break;
    case "Plain":
      headers["Authorization"] = apiKey;
      break;
    case "ApiIdAndKey": {
      const apiKeyId: string = (data.settings.apiKeyId || "").trim();

      if (!apiKeyId) {
        throw new ToolImportReadError(`Paste your ${definition.title} API ID.`);
      }

      headers["X-VO-Api-Id"] = apiKeyId;
      headers["X-VO-Api-Key"] = apiKey;
      secrets.push(apiKeyId);
      break;
    }
    case "Bearer":
    default:
      headers["Authorization"] = `Bearer ${apiKey}`;
      break;
  }

  if (headers["Authorization"]) {
    secrets.push(headers["Authorization"]);
  }

  return new ToolImportHttpClient({
    toolName: definition.title,
    baseUrl: baseUrl,
    basePath: basePath,
    allowHttp: allowHttp,
    allowedHosts: allowedHosts,
    headers: { ...(definition.headers || {}), ...headers },
    secrets: secrets,
    transport: data.context.transport,
    sleep: data.context.sleep,
    now: data.context.now,
    maxRequests: data.context.maxRequests,
    deadlineAt: data.context.deadlineAt,
    requestTimeoutInMs: data.context.requestTimeoutInMs,
    minRequestIntervalMs: definition.minRequestIntervalMs,
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

  return email && email.length <= 100 && EMAIL_SHAPE.test(email) ? email : null;
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
 * Whether a tool's answer says this account cannot have the list at all:
 * the key may not read it (403), the tool does not have it for this
 * account (404), or the account's plan does not include it (402, as
 * PagerDuty answers for teams on a plan without them).
 */
export function isListNotAvailable(error: unknown): boolean {
  return (
    error instanceof ToolImportHttpError &&
    (error.kind === ToolImportHttpErrorKind.Forbidden ||
      error.kind === ToolImportHttpErrorKind.NotFound ||
      error.statusCode === 402)
  );
}

/*
 * A list the key may not read, or that the tool does not have for this
 * account (a 402, 403 or 404), is not a failed read: the snapshot says so
 * with a CouldNotRead note naming the kind, and the import brings over the
 * rest. Anything else - the key refused, the tool down - stops the read.
 */
export async function readOptionalList<T>(data: {
  kind: ToolImportResourceKind;
  notes: Array<ToolImportNote>;
  read: () => Promise<Array<T>>;
}): Promise<Array<T>> {
  try {
    return await data.read();
  } catch (error) {
    if (isListNotAvailable(error)) {
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
  if (data.records.length > TOOL_IMPORT_MAX_RECORDS_PER_KIND || data.hasMore) {
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
 * The people a read found, by the tool's id for them, and by email for the
 * places that name a person only by it. An id or email of nobody read is
 * null: a schedule or a policy never names someone the preview does not
 * list.
 */
export class ToolImportPeopleIndex {
  private ids: Set<string> = new Set<string>();
  private byEmail: Map<string, string> = new Map<string, string>();

  public constructor(people: Array<ImportedPerson>) {
    for (const person of people) {
      this.ids.add(person.sourceId);

      if (person.email) {
        this.byEmail.set(person.email, person.sourceId);
      }
    }
  }

  public find(data: { id?: string; email?: string }): string | null {
    if (data.id && this.ids.has(data.id)) {
      return data.id;
    }

    const email: string | null = cleanEmail(data.email || "");

    return email ? this.byEmail.get(email) || null : null;
  }
}

/*
 * Every record of an offset-paged list (PagerDuty's: `limit` and `offset`
 * in, `more` out), `field` of each page, until a page says there is no
 * more, comes back short, or repeats itself. At most
 * TOOL_IMPORT_MAX_RECORDS_PER_KIND records; `hasMore` says when there were
 * more.
 */
export async function readOffsetPaged(data: {
  client: ToolImportHttpClient;
  path: string;
  field: string;
  pageSize: number;
  query?: ToolImportQuery | undefined;
  limit?: number | undefined;
}): Promise<{ records: Array<unknown>; hasMore: boolean }> {
  const records: Array<unknown> = [];
  const limit: number = data.limit ?? TOOL_IMPORT_MAX_RECORDS_PER_KIND;
  let offset: number = 0;

  for (;;) {
    const body: Record<string, unknown> = asRecord(
      await data.client.getJson(data.path, {
        ...(data.query || {}),
        limit: data.pageSize,
        offset: offset,
      }),
    );

    const page: Array<unknown> = asArray(body[data.field]);
    records.push(...page);
    offset += page.length;

    const more: boolean = asBoolean(body["more"], false);

    if (!more || page.length === 0) {
      return { records: records, hasMore: false };
    }

    if (records.length >= limit) {
      return { records: records, hasMore: true };
    }
  }
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
