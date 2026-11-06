import { ResponseJSON } from "@clickhouse/client";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../../Models/AnalyticsModels/Log";
import RumSession from "../../../../Models/AnalyticsModels/RumSession";
import Span from "../../../../Models/AnalyticsModels/Span";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceRecordKind,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { readTelemetryDataStoreKeyOwnerId } from "../../../../Types/DataSecurity/DataStoreKey";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { isCustomDataTypeId } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { getBuiltInDetectorsOf } from "../../../../Utils/DataSecurity/Detectors/Index";
import {
  classifyField,
  FieldClassification,
  FieldClassifierOptions,
} from "../../../../Utils/DataSecurity/FieldClassifier";
import { ScanDetector } from "../../../../Utils/DataSecurity/TextScanner";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import logger from "../../Logger";
import { ContentScanOptions } from "../DataSecurityScanTypes";
import {
  appendOwnersIn,
  appendWhere,
  capsOf,
  getTelemetrySource,
  readTelemetryRecordValues,
  readText,
  SourceDefinition,
  tableOf,
  TELEMETRY_SCAN_MAX_EVENT_NAME_LENGTH,
  TELEMETRY_SCAN_MAX_KEY_LENGTH,
  TelemetryReadWindow,
  TelemetryRecordValue,
  TelemetrySampleCaps,
  TelemetrySampleSource,
  whole,
} from "./TelemetryDataScanner";

/*
 * WHERE A TELEMETRY FINDING'S DATA WAS SEEN: THE RECORDS THEMSELVES.
 *
 * A finding says a data type sits at a location of one service's telemetry
 * - attributes.user.pps in its traces - from a sample a scan classified.
 * This finds the newest records that carry it there, so a person can open
 * the trace, the log line, the exception or the session and see it happen
 * (issue #5594):
 *
 *  - which records: the store's own - one service's, or one RUM
 *    application's - of the finding's signal, with a value at the
 *    finding's location, the newest first, over the last
 *    OCCURRENCE_WINDOW_IN_DAYS days of data retention still keeps;
 *  - which of them carry it: each value at the location is read as the
 *    scan read it (readTelemetryRecordValues) and classified with the
 *    finding's own data type's detectors (classifyField), so a record is
 *    shown only when its value is that data type - not a test value, nor a
 *    value the project allows. A value a scrub rule masked at ingest is no
 *    longer one, so a scrubbed finding's newest records stop showing;
 *  - what of them: when it was written, the keys that open it (trace and
 *    span, the exception's group, the session), its name or severity, and
 *    the value masked as a finding's samples are (Masking). Never a raw
 *    value, nor anything else the record holds.
 *
 * One read, bounded like a scan's: the project is its first condition, the
 * owner and the window the next, at most a few hundred records, every value
 * cut in the database, and a time limit. The route (DataSecurityAPI) checks
 * that the reader may read the store's telemetry themselves, so nobody sees
 * a record here that they could not open.
 */

// How far back the newest records are looked for.
export const OCCURRENCE_WINDOW_IN_DAYS: number = 7;

/*
 * The window a read looks in: the last OCCURRENCE_WINDOW_IN_DAYS days to
 * the hour, whatever a clock change in the server's time zone did to them.
 */
export function getOccurrenceWindow(now: Date): { since: Date; until: Date } {
  return {
    since: OneUptimeDate.addRemoveHours(now, -OCCURRENCE_WINDOW_IN_DAYS * 24),
    until: now,
  };
}

// The most records with a value at the location one read takes.
export const OCCURRENCE_RECORDS_PER_READ: number = 300;

// Spans' events are wide: fewer of them.
export const OCCURRENCE_EVENT_RECORDS_PER_READ: number = 100;

// The most records a finding names.
export const MAX_OCCURRENCES: number = 10;

// The longest a span's name or an exception's type is read.
export const OCCURRENCE_MAX_NAME_LENGTH: number = 256;

// The most attribute pairs of one record a folded key reads.
export const OCCURRENCE_MAX_PAIRS_PER_RECORD: number = 64;

// How long the read may run.
export const OCCURRENCE_READ_TIME_LIMIT_IN_SECONDS: number = 20;

const OCCURRENCE_MAX_RESULT_BYTES: number = 64 * 1024 * 1024;

type OccurrenceTextColumn =
  | "body"
  | "message"
  | "stackTrace"
  | "identifiedUserLabel";

type OccurrencePairsColumn = "attributes" | "identifiedUserTraits";

// What one read takes of each record: the part of it the location names.
export type OccurrenceRead =
  | { kind: "text"; column: OccurrenceTextColumn }
  | { kind: "pairs"; column: OccurrencePairsColumn; key: string }
  | { kind: "events"; needle: string };

export interface OccurrencePlan {
  source: TelemetrySampleSource;
  read: OccurrenceRead;
}

// What each part is called in a row: the scan's own names (appendColumnsRead).
const TEXT_ALIASES: Readonly<Record<OccurrenceTextColumn, string>> = {
  body: "readBody",
  message: "readMessage",
  stackTrace: "readStackTrace",
  identifiedUserLabel: "readLabel",
};

const PAIRS_ALIASES: Readonly<Record<OccurrencePairsColumn, string>> = {
  attributes: "readAttributes",
  identifiedUserTraits: "readTraits",
};

const RECORD_KIND_OF_SOURCE: Readonly<
  Record<TelemetrySampleSource, DataSecurityOccurrenceRecordKind>
> = {
  [TelemetrySampleSource.Logs]: DataSecurityOccurrenceRecordKind.Log,
  [TelemetrySampleSource.Traces]: DataSecurityOccurrenceRecordKind.Span,
  [TelemetrySampleSource.Exceptions]:
    DataSecurityOccurrenceRecordKind.Exception,
  [TelemetrySampleSource.AiConversations]:
    DataSecurityOccurrenceRecordKind.AiCall,
  [TelemetrySampleSource.RumLogs]: DataSecurityOccurrenceRecordKind.Log,
  [TelemetrySampleSource.RumSpans]: DataSecurityOccurrenceRecordKind.Span,
  [TelemetrySampleSource.RumSessions]: DataSecurityOccurrenceRecordKind.Session,
};

const RUM_SOURCES: ReadonlySet<TelemetrySampleSource> = new Set([
  TelemetrySampleSource.RumLogs,
  TelemetrySampleSource.RumSpans,
  TelemetrySampleSource.RumSessions,
]);

export function isRumOccurrenceSource(source: TelemetrySampleSource): boolean {
  return RUM_SOURCES.has(source);
}

/*
 * The analytics model a source's records are rows of: whose read
 * permissions and scope (TelemetryReadAccess) decide who may see them.
 */
export function getOccurrenceModel(source: TelemetrySampleSource): {
  new (): AnalyticsBaseModel;
} {
  switch (source) {
    case TelemetrySampleSource.Logs:
    case TelemetrySampleSource.RumLogs:
      return Log;
    case TelemetrySampleSource.Exceptions:
      return ExceptionInstance;
    case TelemetrySampleSource.RumSessions:
      return RumSession;
    default:
      return Span;
  }
}

function text(
  source: TelemetrySampleSource,
  column: OccurrenceTextColumn,
): OccurrencePlan {
  return { source, read: { kind: "text", column } };
}

// The attribute under a location's prefix, as one read of its key.
function pairsAfter(
  source: TelemetrySampleSource,
  location: string,
  prefix: string,
  column: OccurrencePairsColumn = "attributes",
): OccurrencePlan | null {
  const key: string = location.slice(prefix.length);

  return location.startsWith(prefix) && key.length > 0
    ? { source, read: { kind: "pairs", column, key } }
    : null;
}

/*
 * An event's attribute: events.<event>.<key>, where both the event's name
 * and the key may hold dots, so the read takes the events whose text holds
 * the location's last part - the key is at least that - and the location
 * of each is worked out as the scan works it out.
 */
function eventsOf(
  source: TelemetrySampleSource,
  location: string,
): OccurrencePlan | null {
  if (!location.startsWith("events.") || location.length <= 7) {
    return null;
  }

  const lastPart: string = location.slice(location.lastIndexOf(".") + 1);

  return {
    source,
    read: { kind: "events", needle: lastPart.split("[]").join("") },
  };
}

/*
 * Which records a finding's location is in, and which part of them: the
 * finding's store's signal, and the location as the scan names it
 * (TelemetryDataScanner's readTelemetryRecordValues). Null for a store
 * that is not telemetry, or a location no record has.
 */
export function planOccurrenceRead(
  kind: DataStoreKind | string | null | undefined,
  location: string | null | undefined,
): OccurrencePlan | null {
  const at: string = (location || "").trim();

  if (!at) {
    return null;
  }

  switch (kind) {
    case DataStoreKind.TelemetryLogs:
      return at === "body"
        ? text(TelemetrySampleSource.Logs, "body")
        : pairsAfter(TelemetrySampleSource.Logs, at, "attributes.");
    case DataStoreKind.TelemetryTraces:
      return (
        pairsAfter(TelemetrySampleSource.Traces, at, "attributes.") ||
        eventsOf(TelemetrySampleSource.Traces, at)
      );
    case DataStoreKind.TelemetryExceptions:
      if (at === "message" || at === "stackTrace") {
        return text(TelemetrySampleSource.Exceptions, at);
      }

      return pairsAfter(TelemetrySampleSource.Exceptions, at, "attributes.");
    case DataStoreKind.TelemetryAiConversations:
      /*
       * What was said to or by the model is named for its key alone
       * (gen_ai.input.messages); every other attribute under attributes.
       */
      return (
        pairsAfter(TelemetrySampleSource.AiConversations, at, "attributes.") ||
        eventsOf(TelemetrySampleSource.AiConversations, at) || {
          source: TelemetrySampleSource.AiConversations,
          read: { kind: "pairs", column: "attributes", key: at },
        }
      );
    case DataStoreKind.TelemetrySessionReplays:
      if (at === "sessions.identifiedUserLabel") {
        return text(TelemetrySampleSource.RumSessions, "identifiedUserLabel");
      }

      return (
        pairsAfter(TelemetrySampleSource.RumLogs, at, "logs.attributes.") ||
        pairsAfter(TelemetrySampleSource.RumSpans, at, "spans.attributes.") ||
        pairsAfter(
          TelemetrySampleSource.RumSessions,
          at,
          "sessions.attributes.",
        ) ||
        pairsAfter(
          TelemetrySampleSource.RumSessions,
          at,
          "sessions.identifiedUserTraits.",
          "identifiedUserTraits",
        )
      );
    default:
      return null;
  }
}

// RE2's metacharacters, which a key's own characters are escaped from.
const REGEX_METACHARACTERS: ReadonlySet<string> = new Set([
  "\\",
  "^",
  "$",
  ".",
  "|",
  "?",
  "*",
  "+",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
]);

/*
 * The keys a folded key stands for, as a regular expression: the scan
 * folds every numbered part (foldAttributeKey), so gen_ai.prompt[].content
 * is gen_ai.prompt.0.content, gen_ai.prompt.1.content ...
 */
export function foldedKeyPattern(foldedKey: string): string {
  let pattern: string = "^";
  let index: number = 0;

  while (index < foldedKey.length) {
    if (foldedKey.startsWith("[]", index)) {
      pattern += index === 0 ? "[0-9]+" : "\\.[0-9]+";
      index += 2;
      continue;
    }

    const character: string = foldedKey[index]!;

    pattern += REGEX_METACHARACTERS.has(character)
      ? `\\${character}`
      : character;
    index++;
  }

  return pattern + "$";
}

// A key read as more than itself: the numbered keys it folds, or those it starts.
type KeysMatch =
  | { kind: "pattern"; pattern: string }
  | { kind: "prefix"; prefix: string };

type KeyMatch = { kind: "exact"; key: string } | KeysMatch;

/*
 * How a location's key is found in a record's keys: as it is, as the
 * numbered keys it folds, or - for a key the scan cut at
 * TELEMETRY_SCAN_MAX_KEY_LENGTH - as the keys it starts.
 */
export function keyMatchOf(key: string): KeyMatch {
  if (key.length >= TELEMETRY_SCAN_MAX_KEY_LENGTH) {
    return {
      kind: "prefix",
      prefix: key.slice(0, TELEMETRY_SCAN_MAX_KEY_LENGTH),
    };
  }

  return key.includes("[]")
    ? { kind: "pattern", pattern: foldedKeyPattern(key) }
    : { kind: "exact", key };
}

// The condition on one key, `name` being the SQL that holds it.
function appendKeyCondition(
  statement: Statement,
  match: KeysMatch,
  name: string,
): void {
  statement.append(
    match.kind === "pattern" ? `match(${name}, ` : `startsWith(${name}, `,
  );
  statement.append(
    SQL`${{
      type: TableColumnType.Text,
      value: match.kind === "pattern" ? match.pattern : match.prefix,
    }})`,
  );
}

function appendNumber(statement: Statement, value: number): void {
  statement.append(
    SQL`${{ type: TableColumnType.Number, value: whole(value, 1) }}`,
  );
}

// What opens a record of each signal, and what to call it.
function appendRecordKeys(
  statement: Statement,
  source: TelemetrySampleSource,
): void {
  switch (source) {
    case TelemetrySampleSource.Logs:
    case TelemetrySampleSource.RumLogs:
      statement.append(
        ", traceId AS readTraceId, spanId AS readSpanId, severityText AS readSeverity",
      );
      break;
    case TelemetrySampleSource.Traces:
    case TelemetrySampleSource.AiConversations:
    case TelemetrySampleSource.RumSpans:
      statement.append(
        ", traceId AS readTraceId, spanId AS readSpanId, substringUTF8(name, 1, ",
      );
      appendNumber(statement, OCCURRENCE_MAX_NAME_LENGTH);
      statement.append(") AS readName");
      break;
    case TelemetrySampleSource.Exceptions:
      statement.append(
        ", traceId AS readTraceId, spanId AS readSpanId, fingerprint AS readFingerprint, substringUTF8(exceptionType, 1, ",
      );
      appendNumber(statement, OCCURRENCE_MAX_NAME_LENGTH);
      statement.append(") AS readName");
      break;
    default:
      break;
  }

  if (
    source === TelemetrySampleSource.RumLogs ||
    source === TelemetrySampleSource.RumSpans ||
    source === TelemetrySampleSource.RumSessions
  ) {
    statement.append(", sessionId AS readSessionId");
  }
}

// The part of each record the location names, cut as the scan cuts it.
function appendOccurrenceColumns(
  statement: Statement,
  read: OccurrenceRead,
  caps: TelemetrySampleCaps,
): void {
  if (read.kind === "text") {
    statement.append(`, substringUTF8(${read.column}, 1, `);
    appendNumber(
      statement,
      read.column === "identifiedUserLabel"
        ? caps.attributeValueLength
        : caps.textLength,
    );
    statement.append(`) AS ${TEXT_ALIASES[read.column]}`);
    return;
  }

  if (read.kind === "pairs") {
    const match: KeyMatch = keyMatchOf(read.key);

    if (match.kind === "exact") {
      // The one value under the key, as the one pair the scan would read.
      statement.append(
        SQL`, [tuple(${{ type: TableColumnType.Text, value: match.key }}, substringUTF8(`,
      );
      statement.append(read.column);
      statement.append(
        SQL`[${{ type: TableColumnType.Text, value: match.key }}], 1, `,
      );
      appendNumber(statement, caps.attributeValueLength);
      statement.append(`))] AS ${PAIRS_ALIASES[read.column]}`);
      return;
    }

    statement.append(
      ", arraySlice(arrayMap(kv -> tuple(substringUTF8(tupleElement(kv, 1), 1, ",
    );
    appendNumber(statement, TELEMETRY_SCAN_MAX_KEY_LENGTH);
    statement.append("), substringUTF8(tupleElement(kv, 2), 1, ");
    appendNumber(statement, caps.attributeValueLength);
    statement.append(")), arrayFilter(kv -> ");
    appendKeyCondition(statement, match, "tupleElement(kv, 1)");
    statement.append(
      `, arrayZip(mapKeys(${read.column}), mapValues(${read.column})))), 1, `,
    );
    appendNumber(statement, OCCURRENCE_MAX_PAIRS_PER_RECORD);
    statement.append(`) AS ${PAIRS_ALIASES[read.column]}`);
    return;
  }

  // A span's events as the scan reads them, only those holding the key's text.
  statement.append(
    ", arrayMap(e -> tuple(substringUTF8(JSONExtractString(e, 'name'), 1, ",
  );
  appendNumber(statement, TELEMETRY_SCAN_MAX_EVENT_NAME_LENGTH);
  statement.append(
    "), arrayMap(kv -> tuple(substringUTF8(tupleElement(kv, 1), 1, ",
  );
  appendNumber(statement, TELEMETRY_SCAN_MAX_KEY_LENGTH);
  statement.append("), substringUTF8(tupleElement(kv, 2), 1, ");
  appendNumber(statement, caps.attributeValueLength);
  statement.append(
    ")), arraySlice(JSONExtractKeysAndValuesRaw(e, 'attributes'), 1, ",
  );
  appendNumber(statement, caps.attributesPerEvent);
  statement.append(")))");
  statement.append(", arraySlice(");

  if (read.needle) {
    statement.append("arrayFilter(e -> position(e, ");
    statement.append(
      SQL`${{ type: TableColumnType.Text, value: read.needle }}) > 0, JSONExtractArrayRaw(events))`,
    );
  } else {
    statement.append("JSONExtractArrayRaw(events)");
  }

  statement.append(", 1, ");
  appendNumber(statement, caps.eventsPerSpan);
  statement.append(")) AS readEvents");
}

// Only the records with a value at the location.
function appendLocationFilter(
  statement: Statement,
  read: OccurrenceRead,
): void {
  if (read.kind === "text") {
    statement.append(` AND ${read.column} != ''`);
    return;
  }

  if (read.kind === "pairs") {
    const match: KeyMatch = keyMatchOf(read.key);

    if (match.kind === "exact") {
      statement.append(` AND mapContains(${read.column}, `);
      statement.append(
        SQL`${{ type: TableColumnType.Text, value: match.key }})`,
      );
      return;
    }

    statement.append(" AND arrayExists(k -> ");
    appendKeyCondition(statement, match, "k");
    statement.append(`, mapKeys(${read.column}))`);
    return;
  }

  if (read.needle) {
    statement.append(" AND position(events, ");
    statement.append(
      SQL`${{ type: TableColumnType.Text, value: read.needle }}) > 0`,
    );
    return;
  }

  statement.append(" AND events != '' AND events != '[]'");
}

function readSettings(): string {
  return getQuerySettings({
    maxExecutionTimeInSeconds: OCCURRENCE_READ_TIME_LIMIT_IN_SECONDS,
    timeoutOverflowMode: "throw",
    boundScanMemory: true,
    additionalSettings: { max_result_bytes: OCCURRENCE_MAX_RESULT_BYTES },
  });
}

// The most records one read of a plan takes.
export function getOccurrenceReadLimit(plan: OccurrencePlan): number {
  return plan.read.kind === "events"
    ? OCCURRENCE_EVENT_RECORDS_PER_READ
    : OCCURRENCE_RECORDS_PER_READ;
}

/*
 * The newest records of one owner in the window with a value at the
 * plan's location: their time and keys, and that value, cut short. Every
 * value in it is bound as a parameter.
 */
export function buildTelemetryOccurrenceStatement(
  data: TelemetryReadWindow & {
    plan: OccurrencePlan;
    ownerId: string;
    limit: number;
    caps: TelemetrySampleCaps;
  },
): Statement {
  const source: SourceDefinition = getTelemetrySource(data.plan.source);
  const statement: Statement = SQL`SELECT `;

  statement.append(source.ownerColumn);
  statement.append(" AS ownerId, toUnixTimestamp64Milli(toDateTime64(");
  statement.append(source.timeColumn);
  statement.append(", 3)) AS recordTime");
  appendRecordKeys(statement, data.plan.source);
  appendOccurrenceColumns(statement, data.plan.read, data.caps);
  statement.append(" FROM ");
  statement.append(tableOf(source.table));
  appendWhere(statement, source, data);
  appendOwnersIn(statement, source, [data.ownerId]);
  appendLocationFilter(statement, data.plan.read);
  statement.append(" ORDER BY ");
  statement.append(source.timeColumn);
  statement.append(" DESC LIMIT ");
  appendNumber(statement, data.limit);
  statement.append(readSettings());

  return statement;
}

/*
 * Whether a value is the finding's data type, and how it reads masked:
 * the value classified at the finding's location with that type's own
 * detectors (the project's, for a custom type), its hints and its allowed
 * values. Null for a value that is not that type, or only a test value.
 */
export function buildOccurrenceMatcher(data: {
  dataTypeId: string;
  location: string;
  options: ContentScanOptions;
}): (value: string) => string | null {
  const detectors: Array<ScanDetector> = isCustomDataTypeId(data.dataTypeId)
    ? (data.options.customDetectors || []).filter(
        (detector: ScanDetector): boolean => {
          return detector.dataTypeId === data.dataTypeId;
        },
      )
    : [...getBuiltInDetectorsOf(data.dataTypeId)];
  const classifierOptions: FieldClassifierOptions = {
    detectors,
    extraHints: data.options.extraHints,
    disabledDataTypeIds: data.options.disabledDataTypeIds,
    allowedValues: data.options.allowedValues,
  };

  return (value: string): string | null => {
    const found: FieldClassification | undefined = classifyField(
      data.location,
      [value],
      classifierOptions,
    ).find((classification: FieldClassification): boolean => {
      return (
        classification.dataTypeId === data.dataTypeId &&
        classification.valuesWithMatch > 0
      );
    });

    return found?.maskedSamples[0] || null;
  };
}

function readTime(value: unknown): string | null {
  const milliseconds: number =
    typeof value === "number" ? value : Number(readText(value));

  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return null;
  }

  return new Date(milliseconds).toISOString();
}

function occurrenceOf(data: {
  source: TelemetrySampleSource;
  row: JSONObject;
  ownerId: string;
  time: string;
  maskedValue: string;
}): DataSecurityFindingOccurrence {
  const occurrence: DataSecurityFindingOccurrence = {
    time: data.time,
    recordKind: RECORD_KIND_OF_SOURCE[data.source],
    maskedValue: data.maskedValue,
  };

  if (isRumOccurrenceSource(data.source)) {
    occurrence.rumApplicationId = data.ownerId;
  } else {
    occurrence.serviceId = data.ownerId;
  }

  const fields: Array<[keyof DataSecurityFindingOccurrence & string, string]> =
    [
      ["traceId", "readTraceId"],
      ["spanId", "readSpanId"],
      ["name", "readName"],
      ["severity", "readSeverity"],
      ["fingerprint", "readFingerprint"],
      ["sessionId", "readSessionId"],
    ];

  for (const [field, column] of fields) {
    const value: string = readText(data.row[column]).trim();

    if (value) {
      (occurrence as unknown as Record<string, string>)[field] = value;
    }
  }

  return occurrence;
}

/*
 * The records the rows hold that carry the finding's data at its
 * location, the newest first, at most `max`: each row's values read as the
 * scan reads them, the first one at the location that is the data type
 * making it one. A session the table keeps several versions of is one
 * record.
 */
export function readOccurrenceRows(data: {
  plan: OccurrencePlan;
  rows: ReadonlyArray<JSONObject>;
  location: string;
  ownerId: string;
  caps: TelemetrySampleCaps;
  /*
   * The value masked when the finding's data type is in it, or null. Not
   * named match: PatternsAProjectWritesGuard reads a call of that name with
   * a variable as a pattern made from what a project writes.
   */
  maskIfFound: (value: string) => string | null;
  max: number;
}): { occurrences: Array<DataSecurityFindingOccurrence>; recordsRead: number } {
  const occurrences: Array<DataSecurityFindingOccurrence> = [];
  const seenSessions: Set<string> = new Set();
  let recordsRead: number = 0;

  for (const row of data.rows) {
    if (occurrences.length >= data.max) {
      break;
    }

    if (data.plan.source === TelemetrySampleSource.RumSessions) {
      const sessionId: string = readText(row["readSessionId"]);

      if (sessionId && seenSessions.has(sessionId)) {
        continue;
      }

      seenSessions.add(sessionId);
    }

    recordsRead++;

    const time: string | null = readTime(row["recordTime"]);

    if (!time) {
      continue;
    }

    const values: Array<TelemetryRecordValue> =
      readTelemetryRecordValues(data.plan.source, row, data.caps) || [];

    for (const value of values) {
      if (value.location !== data.location) {
        continue;
      }

      const maskedValue: string | null = data.maskIfFound(value.value);

      if (maskedValue) {
        occurrences.push(
          occurrenceOf({
            source: data.plan.source,
            row,
            ownerId: data.ownerId,
            time,
            maskedValue,
          }),
        );
        break;
      }
    }
  }

  return { occurrences, recordsRead };
}

/*
 * The owner a telemetry store's records are sent under: its service, or -
 * for a session replay store, which belongs to a RUM application, not a
 * service - the id its key carries (telemetry:<id>:<kind>).
 */
export function getTelemetryStoreOwnerId(store: {
  kind?: string | null | undefined;
  serviceId?: ObjectID | string | null | undefined;
  storeKey?: string | null | undefined;
}): string | null {
  if (store.kind !== DataStoreKind.TelemetrySessionReplays) {
    const serviceId: string = store.serviceId ? store.serviceId.toString() : "";

    return ObjectID.isValidUUID(serviceId) ? serviceId : null;
  }

  const ownerId: string =
    readTelemetryDataStoreKeyOwnerId(store.storeKey) || "";

  return ObjectID.isValidUUID(ownerId) ? ownerId : null;
}

/*
 * The newest records of a telemetry store that carry a finding's data at
 * its location, read now. The caller has checked the reader may read the
 * store's telemetry; `options` is the project's scan setup
 * (DataSecurityRunner.getScanSetup), for its custom types, hints, allowed
 * values and the scan's caps.
 */
export async function findTelemetryFindingOccurrences(data: {
  projectId: ObjectID;
  plan: OccurrencePlan;
  ownerId: string;
  location: string;
  dataTypeId: string;
  options: ContentScanOptions;
  now?: Date | undefined;
}): Promise<DataSecurityFindingOccurrences> {
  const { since, until } = getOccurrenceWindow(
    data.now || OneUptimeDate.getCurrentDate(),
  );
  const source: SourceDefinition = getTelemetrySource(data.plan.source);
  const caps: TelemetrySampleCaps = capsOf(source, data.options);
  const limit: number = getOccurrenceReadLimit(data.plan);
  let rows: Array<JSONObject>;

  try {
    const result: Results = await source.runner.executeQuery(
      buildTelemetryOccurrenceStatement({
        projectId: data.projectId,
        since,
        until,
        plan: data.plan,
        ownerId: data.ownerId,
        limit,
        caps,
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    rows = (response.data || []) as Array<JSONObject>;
  } catch (error) {
    logger.warn(
      `DataSecurity: could not read the records of ${source.label} ${data.ownerId} at ${data.location} in project ${data.projectId.toString()}:`,
    );
    logger.warn(error);

    throw new BadDataException(
      "Could not read these records just now. Try again in a minute.",
    );
  }

  const read: {
    occurrences: Array<DataSecurityFindingOccurrence>;
    recordsRead: number;
  } = readOccurrenceRows({
    plan: data.plan,
    rows,
    location: data.location,
    ownerId: data.ownerId,
    caps,
    maskIfFound: buildOccurrenceMatcher({
      dataTypeId: data.dataTypeId,
      location: data.location,
      options: data.options,
    }),
    max: MAX_OCCURRENCES,
  });

  return {
    occurrences: read.occurrences,
    since: since.toISOString(),
    until: until.toISOString(),
    recordsRead: read.recordsRead,
    isComplete: rows.length < limit,
  };
}
