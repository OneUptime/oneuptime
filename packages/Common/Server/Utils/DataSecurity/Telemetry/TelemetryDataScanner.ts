import { ResponseJSON } from "@clickhouse/client";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import Service from "../../../../Models/DatabaseModels/Service";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  LlmCompletionEventNames,
  LlmCompletionIndexedMessageConventions,
  LlmCompletionJsonAttributeKeys,
  LlmIndexedMessageConvention,
  LlmInferenceDetailsEventName,
  LlmPromptEventNames,
  LlmPromptIndexedMessageConventions,
  LlmPromptJsonAttributeKeys,
  LlmResponseToolCallsAttributeKeys,
  LlmSystemInstructionsAttributeKeys,
  LlmToolCallArgumentsAttributeKeys,
  LlmToolCallResultAttributeKeys,
} from "../../../../Types/Telemetry/LlmConventions";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import BUILT_IN_DETECTORS from "../../../../Utils/DataSecurity/Detectors/Index";
import {
  classifyField,
  FieldClassification,
  FieldClassifierOptions,
} from "../../../../Utils/DataSecurity/FieldClassifier";
import FieldCollector from "../../../../Utils/DataSecurity/FieldCollector";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import ExceptionInstanceService from "../../../Services/ExceptionInstanceService";
import LogService from "../../../Services/LogService";
import RumApplicationService from "../../../Services/RumApplicationService";
import RumSessionService from "../../../Services/RumSessionService";
import ServiceService from "../../../Services/ServiceService";
import SpanService from "../../../Services/SpanService";
import { getClickhouseDatabaseName } from "../../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import LlmConversationPrivacy from "../../LlmObservability/LlmConversationPrivacy";
import logger from "../../Logger";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  LocationFindings,
  MAX_READ_LOG_ENTRIES,
} from "../DataSecurityScanTypes";

/*
 * WHAT A PROJECT'S TELEMETRY HOLDS.
 *
 * Telemetry is whatever a project's code writes: an email in a log line, a
 * card number in a span attribute, a token in a stack trace, a customer's
 * question in a prompt. Each service's logs, traces, exceptions and AI
 * conversations - and each RUM application's sessions - is a store of its
 * own (DataStoreKind), and this reads a sample of each and classifies it
 * the way every other store is classified (FieldCollector, classifyField),
 * returning findings by location and never a value:
 *
 *  - logs: every attribute (attributes.<key>) and the body;
 *  - traces: every span attribute and every span event's attributes
 *    (events.<event>.<key>);
 *  - exceptions: the message, the stack trace and the attributes;
 *  - AI conversations, the AI calls (isLlmSpan): the prompts and answers,
 *    found under the keys the GenAI conventions put them in
 *    (LlmConventions.ts) and named for the key - gen_ai.input.messages,
 *    gen_ai.prompt[].content - and every other attribute;
 *  - session replays, a RUM application's: the attributes of its spans
 *    (spans.attributes.<key>) and logs (logs.attributes.<key>), and its
 *    sessions' attributes, the traits identify() gave its users and the
 *    user reference it was given (sessions.*). Never a recording: a replay
 *    chunk (RumSessionChunkV1.payload) holds the text of the pages people
 *    saw, which takes a permission of its own to watch, and a finding read
 *    out of it would show masked page text to everyone who reads Data
 *    Security.
 *
 * Every read is one project's (projectId is its first condition), of the
 * last hour or so (never more than TELEMETRY_SCAN_MAX_WINDOW_IN_HOURS), of
 * data its retention still keeps, and bounded in every direction: owners
 * per signal, records per owner (LIMIT n BY), records per read, attributes
 * and events per record, and the length of every value - cut in the
 * database, so no megabyte-long value leaves it, and the engine reads at
 * most MAX_FIELD_VALUE_LENGTH of anything (AGENTS.md, "Megabyte-long
 * values"). A sample is two statements: which owners have data in the
 * window, and their newest records - the record keys picked from the light
 * columns first (a GLOBAL IN of the newest LIMIT n BY), so the wide columns
 * are read for the sampled records only. Every value in them is bound as a
 * parameter.
 *
 * A company AI tool's conversations (LlmConversationPrivacy) are read by
 * owners and admins only, and a finding lands where everyone who reads
 * Data Security reads it - so their services are left out of every read
 * of spans, and their AI conversations are reported as not read. When who
 * is restricted cannot be told, no service's spans are read at all.
 */

// The longest window read: an older "since" is cut to its most recent part.
export const TELEMETRY_SCAN_MAX_WINDOW_IN_HOURS: number = 24;

// Owners - services, RUM applications - sampled per signal, the busiest first.
export const TELEMETRY_SCAN_MAX_OWNERS_PER_SIGNAL: number = 200;

// Records sampled per owner, whatever the scan asks for.
export const TELEMETRY_SCAN_MAX_SAMPLE_PER_OWNER: number = 1_000;

/*
 * Records one read returns: shared between the owners of the signal, so a
 * project with many services samples fewer records of each.
 */
export const TELEMETRY_SCAN_MAX_RECORDS_PER_READ: number = 5_000;

// AI calls carry long prompts: fewer of them per read.
export const TELEMETRY_SCAN_MAX_CONVERSATIONS_PER_READ: number = 500;

// The most of a log body, an exception message or a stack trace read.
export const TELEMETRY_SCAN_MAX_TEXT_LENGTH: number = 8_192;

// The most of one attribute value read.
export const TELEMETRY_SCAN_MAX_ATTRIBUTE_VALUE_LENGTH: number = 4_096;

/*
 * The most of one value of an AI call read: a prompt carries the whole chat
 * before the person's newest message. The engine reads no more of a field
 * value than this anyway (MAX_FIELD_VALUE_LENGTH).
 */
export const TELEMETRY_SCAN_MAX_CONVERSATION_VALUE_LENGTH: number = 16_384;

export const TELEMETRY_SCAN_MAX_ATTRIBUTES_PER_RECORD: number = 128;
export const TELEMETRY_SCAN_MAX_CONVERSATION_ATTRIBUTES_PER_RECORD: number = 64;
export const TELEMETRY_SCAN_MAX_KEY_LENGTH: number = 256;
export const TELEMETRY_SCAN_MAX_EVENTS_PER_SPAN: number = 16;
export const TELEMETRY_SCAN_MAX_ATTRIBUTES_PER_EVENT: number = 32;
export const TELEMETRY_SCAN_MAX_EVENT_NAME_LENGTH: number = 128;

// Different locations one store's sample may name.
export const TELEMETRY_SCAN_MAX_LOCATIONS_PER_STORE: number = 500;

// How long one read may run, and how much it may answer.
export const TELEMETRY_SCAN_READ_TIME_LIMIT_IN_SECONDS: number = 30;
export const TELEMETRY_SCAN_MAX_RESULT_BYTES: number = 128 * 1024 * 1024;

// The bytes classified in one scan of a project, when the limits name none.
const DEFAULT_BYTES_PER_SCAN: number = 50 * 1024 * 1024;

// Attributes OneUptime stamps itself (oneuptime.service.id, ...): not the project's data.
const ONEUPTIME_ATTRIBUTE_PREFIX: string = "oneuptime.";

export enum TelemetrySampleSource {
  Logs = "Logs",
  Traces = "Traces",
  Exceptions = "Exceptions",
  AiConversations = "AiConversations",
  RumLogs = "RumLogs",
  RumSpans = "RumSpans",
  RumSessions = "RumSessions",
}

// Who a source's records belong to: a Service, or a RUM application.
type SampleOwner = "service" | "rum" | "rumSession";

interface TelemetryQueryRunner {
  executeQuery: (statement: Statement) => Promise<Results>;
}

interface SourceDefinition {
  source: TelemetrySampleSource;
  kind: DataStoreKind;
  // What the read log calls its records.
  label: string;
  table: AnalyticsTableName;
  timeColumn: string;
  ownerColumn: string;
  owner: SampleOwner;
  // Spans only: the AI calls (true), or every other span (false).
  llmSpans?: boolean | undefined;
  // How the owners' records in the window are counted.
  countExpression: string;
  // Pick the sampled records' keys from the light columns first.
  readsKeysFirst: boolean;
  runner: TelemetryQueryRunner;
}

const SOURCES: Readonly<Record<TelemetrySampleSource, SourceDefinition>> = {
  [TelemetrySampleSource.Logs]: {
    source: TelemetrySampleSource.Logs,
    kind: DataStoreKind.TelemetryLogs,
    label: "logs",
    table: AnalyticsTableName.Log,
    timeColumn: "time",
    ownerColumn: "primaryEntityId",
    owner: "service",
    countExpression: "count()",
    readsKeysFirst: true,
    runner: LogService,
  },
  [TelemetrySampleSource.Traces]: {
    source: TelemetrySampleSource.Traces,
    kind: DataStoreKind.TelemetryTraces,
    label: "spans",
    table: AnalyticsTableName.Span,
    timeColumn: "startTime",
    ownerColumn: "primaryEntityId",
    owner: "service",
    llmSpans: false,
    countExpression: "count()",
    readsKeysFirst: true,
    runner: SpanService,
  },
  [TelemetrySampleSource.Exceptions]: {
    source: TelemetrySampleSource.Exceptions,
    kind: DataStoreKind.TelemetryExceptions,
    label: "exceptions",
    table: AnalyticsTableName.ExceptionInstance,
    timeColumn: "time",
    ownerColumn: "primaryEntityId",
    owner: "service",
    countExpression: "count()",
    readsKeysFirst: true,
    runner: ExceptionInstanceService,
  },
  [TelemetrySampleSource.AiConversations]: {
    source: TelemetrySampleSource.AiConversations,
    kind: DataStoreKind.TelemetryAiConversations,
    label: "AI calls",
    table: AnalyticsTableName.Span,
    timeColumn: "startTime",
    ownerColumn: "primaryEntityId",
    owner: "service",
    llmSpans: true,
    countExpression: "count()",
    readsKeysFirst: true,
    runner: SpanService,
  },
  [TelemetrySampleSource.RumLogs]: {
    source: TelemetrySampleSource.RumLogs,
    kind: DataStoreKind.TelemetrySessionReplays,
    label: "logs",
    table: AnalyticsTableName.Log,
    timeColumn: "time",
    ownerColumn: "primaryEntityId",
    owner: "rum",
    countExpression: "count()",
    readsKeysFirst: true,
    runner: LogService,
  },
  [TelemetrySampleSource.RumSpans]: {
    source: TelemetrySampleSource.RumSpans,
    kind: DataStoreKind.TelemetrySessionReplays,
    label: "spans",
    table: AnalyticsTableName.Span,
    timeColumn: "startTime",
    ownerColumn: "primaryEntityId",
    owner: "rum",
    countExpression: "count()",
    readsKeysFirst: true,
    runner: SpanService,
  },
  [TelemetrySampleSource.RumSessions]: {
    source: TelemetrySampleSource.RumSessions,
    kind: DataStoreKind.TelemetrySessionReplays,
    label: "sessions",
    table: AnalyticsTableName.RumSession,
    timeColumn: "startTime",
    ownerColumn: "rumApplicationId",
    owner: "rumSession",
    // The table keeps every version of a session.
    countExpression: "uniq(sessionId)",
    // A narrow table: its records are read in one pass.
    readsKeysFirst: false,
    runner: RumSessionService,
  },
};

// The order a project's telemetry is read in.
export const TELEMETRY_SAMPLE_SOURCES: ReadonlyArray<TelemetrySampleSource> = [
  TelemetrySampleSource.Logs,
  TelemetrySampleSource.Traces,
  TelemetrySampleSource.Exceptions,
  TelemetrySampleSource.AiConversations,
  TelemetrySampleSource.RumLogs,
  TelemetrySampleSource.RumSpans,
  TelemetrySampleSource.RumSessions,
];

// The sources whose reads must leave the restricted services out.
const SPANS_OF_SERVICES: ReadonlySet<TelemetrySampleSource> = new Set([
  TelemetrySampleSource.Traces,
  TelemetrySampleSource.AiConversations,
]);

export const RESTRICTED_CONVERSATIONS_WARNING: string =
  "Not read: this service holds a company AI tool's conversations, which only project owners and admins may read, and findings are read by everyone with access to Data Security.";

export interface TelemetryReadWindow {
  projectId: ObjectID;
  since: Date;
  until: Date;
}

// How much of a record a read takes.
export interface TelemetrySampleCaps {
  textLength: number;
  attributeValueLength: number;
  attributesPerRecord: number;
  eventsPerSpan: number;
  attributesPerEvent: number;
}

export interface TelemetryStoreScan {
  /*
   * The service the store is the telemetry of - for a session replay
   * store, the RUM application's id (a RumApplication row, not a Service).
   */
  serviceId: string;
  serviceName?: string | undefined;
  kind: DataStoreKind;
  result: ContentScanResult;
}

function tableOf(tableName: AnalyticsTableName): string {
  return `${getClickhouseDatabaseName()}.${tableName}`;
}

function readSettings(): string {
  return getQuerySettings({
    maxExecutionTimeInSeconds: TELEMETRY_SCAN_READ_TIME_LIMIT_IN_SECONDS,
    timeoutOverflowMode: "throw",
    boundScanMemory: true,
    additionalSettings: { max_result_bytes: TELEMETRY_SCAN_MAX_RESULT_BYTES },
  });
}

function whole(value: number, minimum: number): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.trunc(value))
    : minimum;
}

// The project, the window, retention, and whose records they are.
function appendWhere(
  statement: Statement,
  source: SourceDefinition,
  window: TelemetryReadWindow,
): void {
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: window.projectId,
    }} AND `,
  );
  statement.append(source.timeColumn);
  statement.append(
    SQL` >= ${{
      type: TableColumnType.DateTime64,
      value: window.since,
    }} AND `,
  );
  statement.append(source.timeColumn);
  statement.append(
    SQL` <= ${{
      type: TableColumnType.DateTime64,
      value: window.until,
    }} AND retentionDate >= now()`,
  );

  if (source.owner === "service") {
    // An empty type is a row from before the column existed: a Service's.
    statement.append(
      SQL` AND (primaryEntityType = '' OR primaryEntityType = ${{
        type: TableColumnType.Text,
        value: ServiceType.OpenTelemetry,
      }})`,
    );
  } else if (source.owner === "rum") {
    statement.append(
      SQL` AND primaryEntityType = ${{
        type: TableColumnType.Text,
        value: ServiceType.RealUserMonitor,
      }}`,
    );
  }

  if (source.llmSpans === true) {
    statement.append(" AND isLlmSpan = 1");
  } else if (source.llmSpans === false) {
    statement.append(" AND isLlmSpan = 0");
  }
}

function appendOwnersIn(
  statement: Statement,
  source: SourceDefinition,
  ownerIds: Array<string>,
): void {
  statement.append(" AND ");
  statement.append(source.ownerColumn);
  statement.append(
    SQL` IN (${{
      type: TableColumnType.Text,
      value: new Includes(ownerIds),
    }})`,
  );
}

// Newest first, at most `perOwner` records of each owner, `total` in all.
function appendNewestPerOwner(
  statement: Statement,
  source: SourceDefinition,
  perOwner: number,
  total: number,
): void {
  statement.append(" ORDER BY ");
  statement.append(source.timeColumn);
  statement.append(
    SQL` DESC LIMIT ${{
      type: TableColumnType.Number,
      value: whole(perOwner, 1),
    }} BY `,
  );
  statement.append(source.ownerColumn);
  statement.append(
    SQL` LIMIT ${{
      type: TableColumnType.Number,
      value: whole(total, 1),
    }}`,
  );
}

/*
 * A map column as at most `maxPairs` (key, value) pairs, each key and value
 * cut short. The column is this file's own name, appended as text.
 */
function appendPairs(
  statement: Statement,
  column: string,
  alias: string,
  maxPairs: number,
  maxValueLength: number,
): void {
  statement.append(
    SQL`, arrayMap((k, v) -> tuple(substringUTF8(k, 1, ${{
      type: TableColumnType.Number,
      value: TELEMETRY_SCAN_MAX_KEY_LENGTH,
    }}), substringUTF8(v, 1, ${{
      type: TableColumnType.Number,
      value: whole(maxValueLength, 1),
    }})), arraySlice(mapKeys(`,
  );
  statement.append(column);
  statement.append(
    SQL`), 1, ${{
      type: TableColumnType.Number,
      value: whole(maxPairs, 1),
    }}), arraySlice(mapValues(`,
  );
  statement.append(column);
  statement.append(
    SQL`), 1, ${{
      type: TableColumnType.Number,
      value: whole(maxPairs, 1),
    }})) AS `,
  );
  statement.append(alias);
}

/*
 * A span's events (a JSON array kept as text) as at most `eventsPerSpan`
 * (name, attributes) pairs, the attributes' values as raw JSON, cut short:
 * parsed in the database, so a long event never leaves it.
 */
function appendEvents(statement: Statement, caps: TelemetrySampleCaps): void {
  statement.append(
    SQL`, arrayMap(e -> tuple(substringUTF8(JSONExtractString(e, 'name'), 1, ${{
      type: TableColumnType.Number,
      value: TELEMETRY_SCAN_MAX_EVENT_NAME_LENGTH,
    }}), arrayMap(kv -> tuple(substringUTF8(tupleElement(kv, 1), 1, ${{
      type: TableColumnType.Number,
      value: TELEMETRY_SCAN_MAX_KEY_LENGTH,
    }}), substringUTF8(tupleElement(kv, 2), 1, ${{
      type: TableColumnType.Number,
      value: whole(caps.attributeValueLength, 1),
    }})), arraySlice(JSONExtractKeysAndValuesRaw(e, 'attributes'), 1, ${{
      type: TableColumnType.Number,
      value: whole(caps.attributesPerEvent, 1),
    }}))), arraySlice(JSONExtractArrayRaw(events), 1, ${{
      type: TableColumnType.Number,
      value: whole(caps.eventsPerSpan, 1),
    }})) AS readEvents`,
  );
}

function appendText(
  statement: Statement,
  column: string,
  alias: string,
  maxLength: number,
): void {
  statement.append(", substringUTF8(");
  statement.append(column);
  statement.append(
    SQL`, 1, ${{
      type: TableColumnType.Number,
      value: whole(maxLength, 1),
    }}) AS `,
  );
  statement.append(alias);
}

function appendColumnsRead(
  statement: Statement,
  source: SourceDefinition,
  caps: TelemetrySampleCaps,
): void {
  switch (source.source) {
    case TelemetrySampleSource.Logs:
      appendText(statement, "body", "readBody", caps.textLength);
      break;
    case TelemetrySampleSource.Exceptions:
      appendText(statement, "message", "readMessage", caps.textLength);
      appendText(statement, "stackTrace", "readStackTrace", caps.textLength);
      break;
    case TelemetrySampleSource.RumSessions:
      statement.append(", sessionId AS readSessionId");
      appendPairs(
        statement,
        "identifiedUserTraits",
        "readTraits",
        caps.attributesPerRecord,
        caps.attributeValueLength,
      );
      appendText(
        statement,
        "identifiedUserLabel",
        "readLabel",
        caps.attributeValueLength,
      );
      break;
    default:
      break;
  }

  appendPairs(
    statement,
    "attributes",
    "readAttributes",
    caps.attributesPerRecord,
    caps.attributeValueLength,
  );

  if (
    source.source === TelemetrySampleSource.Traces ||
    source.source === TelemetrySampleSource.AiConversations
  ) {
    appendEvents(statement, caps);
  }
}

/*
 * The owners - services, RUM applications - with records of a source in
 * the window, the busiest first, and how many records each has there.
 * Only ids and counts leave the database.
 */
export function buildTelemetryOwnersStatement(
  data: TelemetryReadWindow & {
    source: TelemetrySampleSource;
    // Lower-case owner ids left out of the read.
    excludedOwnerIds: Array<string>;
    limit: number;
  },
): Statement {
  const source: SourceDefinition = SOURCES[data.source];
  const statement: Statement = SQL`SELECT `;
  statement.append(source.ownerColumn);
  statement.append(" AS ownerId, ");
  statement.append(source.countExpression);
  statement.append(" AS records FROM ");
  statement.append(tableOf(source.table));
  appendWhere(statement, source, data);

  if (data.excludedOwnerIds.length > 0) {
    statement.append(" AND lower(");
    statement.append(source.ownerColumn);
    statement.append(
      SQL`) NOT IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.excludedOwnerIds),
      }})`,
    );
  }

  statement.append(" GROUP BY ");
  statement.append(source.ownerColumn);
  statement.append(
    SQL` ORDER BY records DESC, ownerId ASC LIMIT ${{
      type: TableColumnType.Number,
      value: whole(data.limit, 1),
    }}`,
  );
  statement.append(readSettings());

  return statement;
}

/*
 * The newest records of the given owners in the window: at most `perOwner`
 * of each (LIMIT n BY), `total` in all, every value cut short. For the
 * wide tables the records are picked by their keys from the light columns
 * first - (owner, time) GLOBAL IN the newest of them - so the database
 * reads the wide columns of the sampled records' granules only, not of
 * the whole window.
 */
export function buildTelemetrySampleStatement(
  data: TelemetryReadWindow & {
    source: TelemetrySampleSource;
    ownerIds: Array<string>;
    perOwner: number;
    total: number;
    caps: TelemetrySampleCaps;
  },
): Statement {
  const source: SourceDefinition = SOURCES[data.source];
  const statement: Statement = SQL`SELECT `;
  statement.append(source.ownerColumn);
  statement.append(" AS ownerId");
  appendColumnsRead(statement, source, data.caps);
  statement.append(" FROM ");
  statement.append(tableOf(source.table));
  appendWhere(statement, source, data);
  appendOwnersIn(statement, source, data.ownerIds);

  if (source.readsKeysFirst) {
    statement.append(" AND (");
    statement.append(source.ownerColumn);
    statement.append(", ");
    statement.append(source.timeColumn);
    statement.append(") GLOBAL IN (SELECT ");
    statement.append(source.ownerColumn);
    statement.append(", ");
    statement.append(source.timeColumn);
    statement.append(" FROM ");
    statement.append(tableOf(source.table));
    appendWhere(statement, source, data);
    appendOwnersIn(statement, source, data.ownerIds);
    appendNewestPerOwner(statement, source, data.perOwner, data.total);
    statement.append(")");
  }

  appendNewestPerOwner(statement, source, data.perOwner, data.total);
  statement.append(readSettings());

  return statement;
}

// Reading the rows: ClickHouse answers a tuple as an array, a map as an object.

function readText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function readCount(value: unknown): number {
  const count: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

function tupleParts(value: unknown): Array<unknown> {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>);
  }

  return [];
}

function readPairs(value: unknown): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      const parts: Array<unknown> = tupleParts(item);
      const key: string = readText(parts[0]);

      if (key) {
        pairs.push([key, readText(parts[1])]);
      }
    }

    return pairs;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      pairs.push([key, readText(entry)]);
    }
  }

  return pairs;
}

interface ReadEvent {
  name: string;
  attributes: Array<[string, string]>;
}

function readEvents(value: unknown): Array<ReadEvent> {
  if (!Array.isArray(value)) {
    return [];
  }

  const events: Array<ReadEvent> = [];

  for (const item of value) {
    const parts: Array<unknown> = tupleParts(item);

    if (parts.length >= 2) {
      events.push({
        name: readText(parts[0]),
        attributes: readPairs(parts[1]),
      });
    }
  }

  return events;
}

// The most characters of a cut escape sequence (é) given up to read the rest.
const MAX_CUT_ESCAPE_LENGTH: number = 6;

/*
 * An event attribute's value as JSON wrote it: a string in quotes, or a
 * number, a boolean, an array as their text. A string the read cut short
 * has lost its closing quote, and maybe half an escape sequence: it is
 * closed again rather than read with its escapes, so "\nghp_..." does not
 * hide a token behind the letter n.
 */
export function fromRawJsonValue(raw: string): string {
  const text: string = raw.trim();

  if (text === "null") {
    return "";
  }

  if (!text.startsWith('"')) {
    return text;
  }

  for (let cut: number = 0; cut <= MAX_CUT_ESCAPE_LENGTH; cut++) {
    const candidate: string =
      cut === 0 ? text : text.slice(0, text.length - cut + 1) + '"';

    if (candidate.length < 2) {
      break;
    }

    try {
      const parsed: unknown = JSON.parse(candidate);

      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      // Not whole yet: try closing it a character earlier.
    }
  }

  return text.slice(1);
}

function isAllDigits(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

/*
 * An attribute key with its numbered parts folded, as FieldCollector folds
 * array positions: gen_ai.prompt.3.content is gen_ai.prompt[].content, so
 * the twenty messages of a chat are one location, not twenty.
 */
export function foldAttributeKey(key: string): string {
  let folded: string = "";

  for (const part of key.split(".")) {
    if (isAllDigits(part)) {
      folded += "[]";
    } else {
      folded += folded.length > 0 ? "." + part : part;
    }
  }

  return folded;
}

const CONVERSATION_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  ...LlmPromptJsonAttributeKeys,
  ...LlmCompletionJsonAttributeKeys,
  ...LlmSystemInstructionsAttributeKeys,
  ...LlmToolCallArgumentsAttributeKeys,
  ...LlmToolCallResultAttributeKeys,
  ...LlmResponseToolCallsAttributeKeys,
]);

const INDEXED_MESSAGE_CONVENTIONS: ReadonlyArray<LlmIndexedMessageConvention> =
  [
    ...LlmPromptIndexedMessageConventions,
    ...LlmCompletionIndexedMessageConventions,
  ];

const CONVERSATION_EVENT_NAMES: ReadonlySet<string> = new Set([
  ...LlmPromptEventNames,
  ...LlmCompletionEventNames,
  LlmInferenceDetailsEventName,
]);

/*
 * Whether an attribute of an AI call holds what was said: a prompt, an
 * answer, the system instructions, a tool call's arguments or result - in
 * one JSON attribute (gen_ai.input.messages) or a numbered message's parts
 * (gen_ai.prompt.0.content, llm.output_messages.1.message.content), its
 * role aside.
 */
export function isConversationContentKey(key: string): boolean {
  if (CONVERSATION_ATTRIBUTE_KEYS.has(key)) {
    return true;
  }

  for (const convention of INDEXED_MESSAGE_CONVENTIONS) {
    const prefix: string = convention.prefix + ".";

    if (!key.startsWith(prefix)) {
      continue;
    }

    const rest: string = key.slice(prefix.length);
    const dot: number = rest.indexOf(".");

    if (dot > 0 && isAllDigits(rest.slice(0, dot))) {
      return rest.slice(dot + 1) !== convention.roleSuffix;
    }
  }

  return false;
}

export function isConversationEventName(name: string): boolean {
  return CONVERSATION_EVENT_NAMES.has(name);
}

/*
 * Whether a scan's exclusions leave a location out: one named whole, a
 * location under one (attributes.http -> attributes.http.url), or an
 * attribute key named bare (http.url -> attributes.http.url,
 * spans.attributes.http.url).
 */
export function isExcludedLocation(
  location: string,
  exclusions: ReadonlyArray<string>,
): boolean {
  if (exclusions.length === 0) {
    return false;
  }

  const attributesAt: number = location.indexOf("attributes.");
  const key: string =
    attributesAt >= 0
      ? location.slice(attributesAt + "attributes.".length)
      : "";

  for (const raw of exclusions) {
    const exclusion: string = typeof raw === "string" ? raw.trim() : "";

    if (!exclusion) {
      continue;
    }

    for (const candidate of [location, key]) {
      if (
        candidate &&
        (candidate === exclusion ||
          candidate.startsWith(exclusion + ".") ||
          candidate.startsWith(exclusion + "[]"))
      ) {
        return true;
      }
    }
  }

  return false;
}

interface ScanContext {
  window: TelemetryReadWindow;
  options: ContentScanOptions;
  perOwnerLimit: number;
  maxOwners: number;
  bytesLeft: number;
  stores: Map<string, StoreSample>;
}

interface SourceRead {
  label: string;
  recordsInWindow: number;
  recordsRead: number;
}

// What one store's sample holds while it is read.
class StoreSample {
  public readonly ownerId: string;
  public readonly kind: DataStoreKind;
  public readonly isRumApplication: boolean;
  public readonly collector: FieldCollector;
  public readonly locationKinds: Map<string, DataStoreLocationKind> = new Map();
  public readonly valueCounts: Map<string, number> = new Map();
  public readonly seenSessions: Set<string> = new Set();
  public readonly reads: Array<SourceRead> = [];
  public readonly warnings: Array<string> = [];
  public rowsRead: number = 0;
  public bytesRead: number = 0;
  public isComplete: boolean = true;
  public tooManyLocations: boolean = false;
  public outOfBudget: boolean = false;

  private readonly maxValuesPerLocation: number;

  public constructor(data: {
    ownerId: string;
    kind: DataStoreKind;
    isRumApplication: boolean;
    maxValuesPerLocation: number;
  }) {
    this.ownerId = data.ownerId;
    this.kind = data.kind;
    this.isRumApplication = data.isRumApplication;
    this.maxValuesPerLocation = data.maxValuesPerLocation;
    this.collector = new FieldCollector({
      maxFields: TELEMETRY_SCAN_MAX_LOCATIONS_PER_STORE,
      maxValuesPerField: data.maxValuesPerLocation,
      maxValueLength: TELEMETRY_SCAN_MAX_CONVERSATION_VALUE_LENGTH,
    });
  }

  public warn(warning: string): void {
    if (!this.warnings.includes(warning)) {
      this.warnings.push(warning);
    }
  }

  // One value at one location, unless the scan leaves it out or is full.
  public addValue(
    location: string,
    locationKind: DataStoreLocationKind,
    value: string,
    context: ScanContext,
  ): void {
    if (
      !value ||
      isExcludedLocation(location, context.options.exclusions || [])
    ) {
      return;
    }

    if (!this.locationKinds.has(location)) {
      if (this.locationKinds.size >= TELEMETRY_SCAN_MAX_LOCATIONS_PER_STORE) {
        this.tooManyLocations = true;
        return;
      }

      this.locationKinds.set(location, locationKind);
    }

    const count: number = this.valueCounts.get(location) || 0;

    if (count >= this.maxValuesPerLocation) {
      return;
    }

    if (context.bytesLeft < value.length) {
      this.outOfBudget = true;
      // Spent: nothing more is classified, and no other source is read.
      context.bytesLeft = 0;
      return;
    }

    context.bytesLeft -= value.length;
    this.bytesRead += value.length;
    this.valueCounts.set(location, count + 1);
    this.collector.addValue(location, value);
  }
}

function storeKey(kind: DataStoreKind, ownerId: string): string {
  return `${kind}|${ownerId.toLowerCase()}`;
}

function sampleOf(
  context: ScanContext,
  source: SourceDefinition,
  ownerId: string,
): StoreSample {
  const key: string = storeKey(source.kind, ownerId);
  let sample: StoreSample | undefined = context.stores.get(key);

  if (!sample) {
    sample = new StoreSample({
      ownerId,
      kind: source.kind,
      isRumApplication: source.owner !== "service",
      maxValuesPerLocation: context.perOwnerLimit,
    });
    context.stores.set(key, sample);
  }

  return sample;
}

function capsOf(
  source: SourceDefinition,
  options: ContentScanOptions,
): TelemetrySampleCaps {
  const perObject: number =
    options.limits.maxBytesPerObject > 0
      ? options.limits.maxBytesPerObject
      : TELEMETRY_SCAN_MAX_CONVERSATION_VALUE_LENGTH;
  const isConversation: boolean =
    source.source === TelemetrySampleSource.AiConversations;

  return {
    textLength: Math.min(TELEMETRY_SCAN_MAX_TEXT_LENGTH, perObject),
    attributeValueLength: Math.min(
      isConversation
        ? TELEMETRY_SCAN_MAX_CONVERSATION_VALUE_LENGTH
        : TELEMETRY_SCAN_MAX_ATTRIBUTE_VALUE_LENGTH,
      perObject,
    ),
    attributesPerRecord: isConversation
      ? TELEMETRY_SCAN_MAX_CONVERSATION_ATTRIBUTES_PER_RECORD
      : TELEMETRY_SCAN_MAX_ATTRIBUTES_PER_RECORD,
    eventsPerSpan: TELEMETRY_SCAN_MAX_EVENTS_PER_SPAN,
    attributesPerEvent: TELEMETRY_SCAN_MAX_ATTRIBUTES_PER_EVENT,
  };
}

function addAttributes(data: {
  sample: StoreSample;
  context: ScanContext;
  base: string;
  pairs: Array<[string, string]>;
  caps: TelemetrySampleCaps;
  isConversation: boolean;
}): void {
  for (const [key, value] of data.pairs.slice(
    0,
    data.caps.attributesPerRecord,
  )) {
    const boundedKey: string = key.slice(0, TELEMETRY_SCAN_MAX_KEY_LENGTH);

    if (boundedKey.startsWith(ONEUPTIME_ATTRIBUTE_PREFIX)) {
      continue;
    }

    const foldedKey: string = foldAttributeKey(boundedKey);
    const boundedValue: string = value.slice(0, data.caps.attributeValueLength);

    if (data.isConversation && isConversationContentKey(boundedKey)) {
      // What was said to or by the model: named for its key, read as text.
      data.sample.addValue(
        foldedKey,
        DataStoreLocationKind.Body,
        boundedValue,
        data.context,
      );
      continue;
    }

    data.sample.addValue(
      data.base + foldedKey,
      DataStoreLocationKind.Attribute,
      boundedValue,
      data.context,
    );
  }
}

function addEvents(data: {
  sample: StoreSample;
  context: ScanContext;
  events: Array<ReadEvent>;
  caps: TelemetrySampleCaps;
  isConversation: boolean;
}): void {
  for (const event of data.events.slice(0, data.caps.eventsPerSpan)) {
    const eventName: string = event.name.slice(
      0,
      TELEMETRY_SCAN_MAX_EVENT_NAME_LENGTH,
    );
    const location: string =
      "events." + (foldAttributeKey(eventName) || "event");
    const isConversationEvent: boolean =
      data.isConversation && isConversationEventName(eventName);

    for (const [key, raw] of event.attributes.slice(
      0,
      data.caps.attributesPerEvent,
    )) {
      const boundedKey: string = key.slice(0, TELEMETRY_SCAN_MAX_KEY_LENGTH);
      const value: string = fromRawJsonValue(
        raw.slice(0, data.caps.attributeValueLength + 2),
      ).slice(0, data.caps.attributeValueLength);
      const isContent: boolean =
        isConversationEvent ||
        (data.isConversation && isConversationContentKey(boundedKey));

      data.sample.addValue(
        location + "." + foldAttributeKey(boundedKey),
        isContent
          ? DataStoreLocationKind.Body
          : DataStoreLocationKind.Attribute,
        value,
        data.context,
      );
    }
  }
}

// One sampled record into its store's sample; false for one already read.
function addRecord(data: {
  sample: StoreSample;
  source: SourceDefinition;
  row: JSONObject;
  context: ScanContext;
  caps: TelemetrySampleCaps;
}): boolean {
  const { sample, source, row, context, caps } = data;
  const attributes: Array<[string, string]> = readPairs(row["readAttributes"]);

  switch (source.source) {
    case TelemetrySampleSource.Logs:
      sample.addValue(
        "body",
        DataStoreLocationKind.Body,
        readText(row["readBody"]).slice(0, caps.textLength),
        context,
      );
      addAttributes({
        sample,
        context,
        base: "attributes.",
        pairs: attributes,
        caps,
        isConversation: false,
      });
      break;
    case TelemetrySampleSource.Traces:
    case TelemetrySampleSource.AiConversations: {
      const isConversation: boolean =
        source.source === TelemetrySampleSource.AiConversations;

      addAttributes({
        sample,
        context,
        base: "attributes.",
        pairs: attributes,
        caps,
        isConversation,
      });
      addEvents({
        sample,
        context,
        events: readEvents(row["readEvents"]),
        caps,
        isConversation,
      });
      break;
    }
    case TelemetrySampleSource.Exceptions:
      sample.addValue(
        "message",
        DataStoreLocationKind.Body,
        readText(row["readMessage"]).slice(0, caps.textLength),
        context,
      );
      sample.addValue(
        "stackTrace",
        DataStoreLocationKind.Body,
        readText(row["readStackTrace"]).slice(0, caps.textLength),
        context,
      );
      addAttributes({
        sample,
        context,
        base: "attributes.",
        pairs: attributes,
        caps,
        isConversation: false,
      });
      break;
    case TelemetrySampleSource.RumLogs:
    case TelemetrySampleSource.RumSpans:
      // A RUM application's spans and logs: their attributes only.
      addAttributes({
        sample,
        context,
        base:
          source.source === TelemetrySampleSource.RumLogs
            ? "logs.attributes."
            : "spans.attributes.",
        pairs: attributes,
        caps,
        isConversation: false,
      });
      break;
    case TelemetrySampleSource.RumSessions: {
      // The table keeps every version of a session: one is read.
      const sessionId: string = readText(row["readSessionId"]);

      if (sessionId) {
        if (sample.seenSessions.has(sessionId)) {
          return false;
        }

        sample.seenSessions.add(sessionId);
      }

      addAttributes({
        sample,
        context,
        base: "sessions.attributes.",
        pairs: attributes,
        caps,
        isConversation: false,
      });
      addAttributes({
        sample,
        context,
        base: "sessions.identifiedUserTraits.",
        pairs: readPairs(row["readTraits"]),
        caps,
        isConversation: false,
      });
      sample.addValue(
        "sessions.identifiedUserLabel",
        DataStoreLocationKind.Field,
        readText(row["readLabel"]).slice(0, caps.attributeValueLength),
        context,
      );
      break;
    }
    default:
      return false;
  }

  sample.rowsRead++;

  return true;
}

async function runRead(
  source: SourceDefinition,
  statement: Statement,
): Promise<Array<JSONObject>> {
  const result: Results = await source.runner.executeQuery(statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
}

function ownerNoun(source: SourceDefinition): string {
  return source.owner === "service" ? "service" : "RUM application";
}

function isPastDeadline(options: ContentScanOptions): boolean {
  const deadline: Date | undefined = options.limits.deadline;

  return (
    deadline instanceof Date &&
    OneUptimeDate.getCurrentDate().getTime() >= deadline.getTime()
  );
}

async function sampleSource(
  source: SourceDefinition,
  context: ScanContext,
  restrictedServiceIds: ReadonlySet<string>,
): Promise<void> {
  const projectId: string = context.window.projectId.toString();
  let ownerRows: Array<JSONObject>;

  try {
    ownerRows = await runRead(
      source,
      buildTelemetryOwnersStatement({
        ...context.window,
        source: source.source,
        /*
         * Traces leave the restricted services out. Their AI calls are
         * listed, ids and counts only, so their stores say they were not
         * read.
         */
        excludedOwnerIds:
          source.source === TelemetrySampleSource.Traces
            ? Array.from(restrictedServiceIds)
            : [],
        limit: context.maxOwners,
      }),
    );
  } catch (error) {
    logger.warn(
      `DataSecurity: could not list which owners of project ${projectId} have ${source.label} to sample:`,
    );
    logger.warn(error);
    return;
  }

  const readable: Array<{ ownerId: string; records: number }> = [];

  for (const row of ownerRows) {
    const ownerId: string = readText(row["ownerId"]);

    if (!ownerId) {
      continue;
    }

    const sample: StoreSample = sampleOf(context, source, ownerId);

    if (
      SPANS_OF_SERVICES.has(source.source) &&
      restrictedServiceIds.has(ownerId.toLowerCase())
    ) {
      sample.warn(RESTRICTED_CONVERSATIONS_WARNING);
      sample.isComplete = false;
      continue;
    }

    readable.push({ ownerId, records: readCount(row["records"]) });
  }

  if (readable.length === 0) {
    return;
  }

  const maxRecords: number =
    source.source === TelemetrySampleSource.AiConversations
      ? TELEMETRY_SCAN_MAX_CONVERSATIONS_PER_READ
      : TELEMETRY_SCAN_MAX_RECORDS_PER_READ;
  const perOwner: number = Math.max(
    1,
    Math.min(context.perOwnerLimit, Math.floor(maxRecords / readable.length)),
  );
  // Read to the end once every owner has given what it has, up to perOwner.
  const total: number = readable.reduce(
    (sum: number, owner: { ownerId: string; records: number }): number => {
      return sum + Math.min(perOwner, Math.max(1, owner.records));
    },
    0,
  );

  const caps: TelemetrySampleCaps = capsOf(source, context.options);
  let rows: Array<JSONObject>;

  try {
    rows = await runRead(
      source,
      buildTelemetrySampleStatement({
        ...context.window,
        source: source.source,
        ownerIds: readable.map(
          (owner: { ownerId: string; records: number }): string => {
            return owner.ownerId;
          },
        ),
        perOwner,
        total,
        caps,
      }),
    );
  } catch (error) {
    logger.warn(
      `DataSecurity: could not sample the ${source.label} of project ${projectId}:`,
    );
    logger.warn(error);

    for (const owner of readable) {
      const sample: StoreSample = sampleOf(context, source, owner.ownerId);
      sample.warn(
        `Could not read this ${ownerNoun(source)}'s ${source.label} in this scan; the next scan reads them again.`,
      );
      sample.isComplete = false;
    }

    return;
  }

  const asked: Set<string> = new Set(
    readable.map((owner: { ownerId: string; records: number }): string => {
      return owner.ownerId.toLowerCase();
    }),
  );
  const readCounts: Map<string, number> = new Map();

  for (const row of rows) {
    const ownerId: string = readText(row["ownerId"]).toLowerCase();
    const sample: StoreSample | undefined = context.stores.get(
      storeKey(source.kind, ownerId),
    );

    // Only the owners the read was for: never one left out of it.
    if (!sample || !asked.has(ownerId)) {
      continue;
    }

    if (addRecord({ sample, source, row, context, caps })) {
      readCounts.set(ownerId, (readCounts.get(ownerId) || 0) + 1);
    }
  }

  for (const owner of readable) {
    sampleOf(context, source, owner.ownerId).reads.push({
      label: source.label,
      recordsInWindow: owner.records,
      recordsRead: readCounts.get(owner.ownerId.toLowerCase()) || 0,
    });
  }
}

function classifierOptionsOf(
  options: ContentScanOptions,
): FieldClassifierOptions {
  return {
    // Every built-in detector, and the project's own types beside them.
    detectors:
      (options.customDetectors || []).length > 0
        ? [...BUILT_IN_DETECTORS, ...options.customDetectors]
        : undefined,
    extraHints: options.extraHints,
    disabledDataTypeIds: options.disabledDataTypeIds,
    allowedValues: options.allowedValues,
  };
}

interface OwnerNames {
  names: Map<string, string>;
  // Whether the lookups ran: a name missing after one is a deleted owner.
  servicesRead: boolean;
  applicationsRead: boolean;
}

async function readOwnerNames(
  projectId: ObjectID,
  samples: Array<StoreSample>,
): Promise<OwnerNames> {
  const owners: OwnerNames = {
    names: new Map(),
    servicesRead: false,
    applicationsRead: false,
  };
  const names: Map<string, string> = owners.names;
  const serviceIds: Set<string> = new Set();
  const applicationIds: Set<string> = new Set();

  for (const sample of samples) {
    if (ObjectID.isValidUUID(sample.ownerId)) {
      (sample.isRumApplication ? applicationIds : serviceIds).add(
        sample.ownerId.toLowerCase(),
      );
    }
  }

  const toObjectIds: (ids: Set<string>) => Array<ObjectID> = (
    ids: Set<string>,
  ): Array<ObjectID> => {
    return Array.from(ids).map((id: string): ObjectID => {
      return new ObjectID(id);
    });
  };

  if (serviceIds.size > 0) {
    try {
      const services: Array<Service> = await ServiceService.findBy({
        query: { projectId, _id: new Includes(toObjectIds(serviceIds)) },
        select: { _id: true, name: true },
        skip: 0,
        limit: serviceIds.size,
        props: { isRoot: true },
      });

      for (const service of services) {
        if (service.id && service.name) {
          names.set(service.id.toString().toLowerCase(), service.name);
        }
      }

      owners.servicesRead = true;
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read the names of project ${projectId.toString()}'s services:`,
      );
      logger.warn(error);
    }
  }

  if (applicationIds.size > 0) {
    try {
      const applications: Array<RumApplication> =
        await RumApplicationService.findBy({
          query: { projectId, _id: new Includes(toObjectIds(applicationIds)) },
          select: { _id: true, name: true },
          skip: 0,
          limit: applicationIds.size,
          props: { isRoot: true },
        });

      for (const application of applications) {
        if (application.id && application.name) {
          names.set(application.id.toString().toLowerCase(), application.name);
        }
      }

      owners.applicationsRead = true;
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read the names of project ${projectId.toString()}'s RUM applications:`,
      );
      logger.warn(error);
    }
  }

  return owners;
}

function describeOwner(sample: StoreSample, name: string | undefined): string {
  const noun: string = sample.isRumApplication ? "RUM application" : "service";

  return name
    ? `${noun} "${name}" (${sample.ownerId})`
    : `${noun} ${sample.ownerId}`;
}

function toResult(data: {
  sample: StoreSample;
  name: string | undefined;
  // The owner's name was looked for, and it was not there.
  isDeletedOwner: boolean;
  window: TelemetryReadWindow;
  classifierOptions: FieldClassifierOptions;
}): ContentScanResult {
  const sample: StoreSample = data.sample;
  const locations: Array<LocationFindings> = [];

  for (const field of sample.collector.getFields()) {
    let classifications: Array<FieldClassification>;

    try {
      classifications = classifyField(
        field.path,
        field.values,
        data.classifierOptions,
      );
    } catch (error) {
      logger.warn(
        `DataSecurity: could not classify ${field.path} of ${sample.kind} ${sample.ownerId}:`,
      );
      logger.warn(error);
      sample.warn(`Could not classify ${field.path}.`);
      sample.isComplete = false;
      continue;
    }

    if (classifications.length > 0) {
      locations.push({
        location: field.path,
        locationKind:
          sample.locationKinds.get(field.path) ||
          DataStoreLocationKind.Attribute,
        classifications,
      });
    }
  }

  const owner: string = describeOwner(sample, data.name);
  const readLog: Array<string> = sample.reads.map(
    (read: SourceRead): string => {
      return `${owner}: read the ${read.recordsRead} newest ${read.label} of the ${read.recordsInWindow} written between ${data.window.since.toISOString()} and ${data.window.until.toISOString()}.`;
    },
  );

  if (data.isDeletedOwner) {
    sample.warn(
      sample.isRumApplication
        ? "No RUM application with this ID exists any more; its telemetry is kept until its retention ends."
        : "No service with this ID exists any more; its telemetry is kept until its retention ends.",
    );
  }

  if (sample.tooManyLocations) {
    sample.warn(
      `More than ${TELEMETRY_SCAN_MAX_LOCATIONS_PER_STORE} different attributes: the ones after them were not read.`,
    );
  }

  if (sample.outOfBudget) {
    sample.warn(
      "The scan read as much as it may this time: part of this sample was not classified.",
    );
    sample.isComplete = false;
  }

  return {
    locations,
    readLog: readLog.slice(0, MAX_READ_LOG_ENTRIES),
    objectsRead: sample.reads.length,
    rowsRead: sample.rowsRead,
    bytesRead: sample.bytesRead,
    warnings: [...sample.warnings],
    fingerprints: {},
    plaintextPasswordFields: [],
    isComplete: sample.isComplete,
  };
}

/*
 * A sample of every service's logs, traces, exceptions and AI
 * conversations, and of every RUM application's sessions, since `since`
 * (at most TELEMETRY_SCAN_MAX_WINDOW_IN_HOURS before now): one result per
 * store, classified. A read that fails is logged and named in the warnings
 * of the stores it was for; the scan goes on with the next.
 */
export async function scanProjectTelemetry(data: {
  projectId: ObjectID;
  sampleSize: number;
  since: Date;
  options: ContentScanOptions;
}): Promise<Array<TelemetryStoreScan>> {
  const until: Date = OneUptimeDate.getCurrentDate();
  const earliest: Date = OneUptimeDate.addRemoveHours(
    until,
    -TELEMETRY_SCAN_MAX_WINDOW_IN_HOURS,
  );
  const sinceTime: number =
    data.since instanceof Date && Number.isFinite(data.since.getTime())
      ? Math.max(data.since.getTime(), earliest.getTime())
      : earliest.getTime();

  if (sinceTime >= until.getTime()) {
    return [];
  }

  const limits: ContentScanOptions["limits"] = data.options.limits;
  const perOwnerLimit: number = Math.min(
    whole(data.sampleSize, 1),
    limits.maxRowsPerTable > 0
      ? whole(limits.maxRowsPerTable, 1)
      : TELEMETRY_SCAN_MAX_SAMPLE_PER_OWNER,
    TELEMETRY_SCAN_MAX_SAMPLE_PER_OWNER,
  );
  const context: ScanContext = {
    window: { projectId: data.projectId, since: new Date(sinceTime), until },
    options: data.options,
    perOwnerLimit,
    maxOwners: Math.min(
      TELEMETRY_SCAN_MAX_OWNERS_PER_SIGNAL,
      limits.maxTables > 0
        ? whole(limits.maxTables, 1)
        : TELEMETRY_SCAN_MAX_OWNERS_PER_SIGNAL,
    ),
    bytesLeft:
      limits.maxBytesTotal > 0 ? limits.maxBytesTotal : DEFAULT_BYTES_PER_SCAN,
    stores: new Map(),
  };

  let restrictedServiceIds: ReadonlySet<string> | null;

  try {
    restrictedServiceIds = new Set(
      (
        await LlmConversationPrivacy.getRestrictedServiceIds(data.projectId)
      ).map((id: string): string => {
        return id.toLowerCase();
      }),
    );
  } catch (error) {
    // Who may read which conversations is unknown: no span is read.
    logger.warn(
      `DataSecurity: could not read which AI conversations of project ${data.projectId.toString()} are restricted; its spans are not sampled this time:`,
    );
    logger.warn(error);
    restrictedServiceIds = null;
  }

  for (const sourceName of TELEMETRY_SAMPLE_SOURCES) {
    const source: SourceDefinition = SOURCES[sourceName];

    if (isPastDeadline(data.options) || context.bytesLeft <= 0) {
      logger.warn(
        `DataSecurity: the telemetry scan of project ${data.projectId.toString()} stopped before its ${source.label} of ${ownerNoun(source)}s: out of time or bytes.`,
      );
      break;
    }

    if (restrictedServiceIds === null && SPANS_OF_SERVICES.has(sourceName)) {
      continue;
    }

    await sampleSource(source, context, restrictedServiceIds || new Set());
  }

  const samples: Array<StoreSample> = Array.from(context.stores.values());
  const owners: OwnerNames = await readOwnerNames(data.projectId, samples);
  const classifierOptions: FieldClassifierOptions = classifierOptionsOf(
    data.options,
  );

  return samples.map((sample: StoreSample): TelemetryStoreScan => {
    const name: string | undefined = owners.names.get(
      sample.ownerId.toLowerCase(),
    );
    const scan: TelemetryStoreScan = {
      serviceId: sample.ownerId,
      kind: sample.kind,
      result: toResult({
        sample,
        name,
        isDeletedOwner:
          !name &&
          (sample.isRumApplication
            ? owners.applicationsRead
            : owners.servicesRead),
        window: context.window,
        classifierOptions,
      }),
    };

    if (name) {
      scan.serviceName = name;
    }

    return scan;
  });
}
