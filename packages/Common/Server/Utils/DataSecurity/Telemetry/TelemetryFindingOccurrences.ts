import { ResponseJSON } from "@clickhouse/client";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../../Models/AnalyticsModels/Log";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import RumSession from "../../../../Models/AnalyticsModels/RumSession";
import Span from "../../../../Models/AnalyticsModels/Span";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import {
  DataSecurityFindingOccurrence,
  DataSecurityFindingOccurrences,
  DataSecurityOccurrenceExcerpt,
  DataSecurityOccurrenceRecordKind,
  DataSecurityOccurrencesSource,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { readTelemetryDataStoreKeyOwnerId } from "../../../../Types/DataSecurity/DataStoreKey";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { FindingSampleRecord } from "../../../../Types/DataSecurity/FindingSampleRecord";
import { METRIC_NAME_LOCATION } from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { isCustomDataTypeId } from "../../../../Utils/DataSecurity/CustomDataTypeDetector";
import { getDataTypePrefilter } from "../../../../Utils/DataSecurity/DetectorPrefilter";
import { getBuiltInDetectorsOf } from "../../../../Utils/DataSecurity/Detectors/Index";
import {
  classifyField,
  FieldClassification,
  FieldClassifierOptions,
} from "../../../../Utils/DataSecurity/FieldClassifier";
import { getHintedDataTypeIds } from "../../../../Utils/DataSecurity/FieldNameHints";
import {
  buildOccurrenceExcerpt,
  maskSensitiveText,
} from "../../../../Utils/DataSecurity/OccurrenceExcerpt";
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
  TELEMETRY_SCAN_MAX_METRIC_NAME_LENGTH,
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
 * This reads the records that carry it there, so a person sees the log line
 * or the span with the data in its place, and opens the trace, the logs,
 * the exception or the session (issues #5594 and #9549):
 *
 *  - which records: where the evidence is. The very records the last scan
 *    found it in, when the finding kept them (FindingSampleRecord): read by
 *    their millisecond, a lookup. A finding from before scans kept them is
 *    looked for in the hour the last scan read, before it last saw it, and
 *    one no scan has seen in the newest records of the last
 *    OCCURRENCE_WINDOW_IN_DAYS days. It used to be the newest records of
 *    the last week, whatever the finding: a finding last seen twelve days
 *    ago had no record in the window, and a type seen in one sampled line
 *    of four hundred was not among a busy service's newest three hundred;
 *  - a search, not a lookup, asks the database for the records whose value
 *    could hold the type (DetectorPrefilter), not every record with a value
 *    there, so the few hundred it reads are the right ones;
 *  - which of them carry it: each value at the location is read as the
 *    scan read it (readTelemetryRecordValues) and classified with the
 *    finding's own data type's detectors (classifyField), so a record is
 *    shown only when its value is that data type - not a test value, nor a
 *    value the project allows. A value a scrub rule masked at ingest is no
 *    longer one, so a scrubbed finding's newest records stop showing;
 *  - what of them: when it was written, the keys that open it (trace and
 *    span, the exception's group, the session), its name or severity, and
 *    its value at the location cut around the data, every sensitive value
 *    in it masked as a finding's samples are (OccurrenceExcerpt). Never a
 *    raw value of any type.
 *
 * A metric's records are its data points. Every series of a metric is
 * written at the same moment, so a millisecond holds many of them: a kept
 * point is looked up by its metric and its millisecond, narrowed by the
 * data type's patterns as a search is, and each series it found is one
 * record however many of its points the read returns. A metric's name is
 * shown with every sensitive value in it masked, and goes into a link only
 * when nothing in it is.
 *
 * One read, bounded like a scan's: the project is its first condition, the
 * owner and the window the next, at most a few hundred records, every value
 * cut in the database, and a time limit. The route (DataSecurityAPI) checks
 * that the reader may read the store's telemetry themselves, so nobody sees
 * a record here that they could not open.
 */

// How far back the newest records are looked for, when no scan has seen it.
export const OCCURRENCE_WINDOW_IN_DAYS: number = 7;

/*
 * How long before a scan finished the records it read can be: the hour it
 * reads (DataSecurityRunner.scanTelemetry), and the minutes a scan of every
 * service's telemetry takes before its findings are written.
 */
export const SAMPLE_WINDOW_IN_MINUTES: number = 75;

// The rows read for each kept record: a few may share its millisecond.
export const SAMPLED_ROWS_PER_RECORD: number = 4;

/*
 * The rows read for each kept point of a metric: every series of a metric
 * is written in the same millisecond, so the point's series is one of many.
 */
export const SAMPLED_ROWS_PER_METRIC_RECORD: number = 30;

/*
 * Where a finding's records are read: the ones the last scan kept, the
 * hour it read, or the newest of the last days - and over which window.
 */
export interface OccurrenceSearch {
  source: DataSecurityOccurrencesSource;
  since: Date;
  until: Date;
  // The kept records, for a read of them.
  records: Array<FindingSampleRecord>;
}

export function planOccurrenceSearch(data: {
  now: Date;
  sampleRecords?: ReadonlyArray<FindingSampleRecord> | undefined;
  lastSeenAt?: Date | null | undefined;
}): OccurrenceSearch {
  const records: Array<FindingSampleRecord> = [...(data.sampleRecords || [])];

  if (records.length > 0) {
    const times: Array<number> = records.map(
      (record: FindingSampleRecord): number => {
        return new Date(record.time).getTime();
      },
    );

    return {
      source: DataSecurityOccurrencesSource.SampledRecords,
      since: new Date(Math.min(...times)),
      // The newest record's millisecond, all of it.
      until: new Date(Math.max(...times) + 1),
      records,
    };
  }

  const lastSeenAt: number =
    data.lastSeenAt instanceof Date ? data.lastSeenAt.getTime() : NaN;

  if (Number.isFinite(lastSeenAt) && lastSeenAt > 0) {
    return {
      source: DataSecurityOccurrencesSource.SampleWindow,
      since: new Date(lastSeenAt - SAMPLE_WINDOW_IN_MINUTES * 60 * 1000),
      until: new Date(lastSeenAt),
      records: [],
    };
  }

  return {
    source: DataSecurityOccurrencesSource.Recent,
    ...getOccurrenceWindow(data.now),
    records: [],
  };
}

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
  | "identifiedUserLabel"
  // A metric's own name.
  | "name";

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
  name: "readMetricName",
};

// How much of a text column is read: as much as the scan read.
function textLengthOf(
  column: OccurrenceTextColumn,
  caps: TelemetrySampleCaps,
): number {
  switch (column) {
    case "identifiedUserLabel":
      return caps.attributeValueLength;
    case "name":
      return TELEMETRY_SCAN_MAX_METRIC_NAME_LENGTH;
    default:
      return caps.textLength;
  }
}

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
  [TelemetrySampleSource.Metrics]: DataSecurityOccurrenceRecordKind.Metric,
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
    case TelemetrySampleSource.Metrics:
      return Metric;
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
    case DataStoreKind.TelemetryMetrics:
      // The metric's own name, or a point's attribute, its resource's among them.
      return at === METRIC_NAME_LOCATION
        ? text(TelemetrySampleSource.Metrics, "name")
        : pairsAfter(TelemetrySampleSource.Metrics, at, "attributes.");
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
function appendRecordKeys(statement: Statement, plan: OccurrencePlan): void {
  const source: TelemetrySampleSource = plan.source;

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
    case TelemetrySampleSource.Metrics:
      // The metric a point is of - read as the location's own text when it is the name.
      if (plan.read.kind !== "text") {
        statement.append(", substringUTF8(name, 1, ");
        appendNumber(statement, TELEMETRY_SCAN_MAX_METRIC_NAME_LENGTH);
        statement.append(") AS readMetricName");
      }
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
    appendNumber(statement, textLengthOf(read.column, caps));
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

/*
 * The value - `appendValue` writes the SQL that holds it - cut where the
 * scan cuts it, holds what the prefilter matches. Bound, never written in.
 */
function appendPrefilter(
  statement: Statement,
  appendValue: (statement: Statement) => void,
  maxLength: number,
  prefilter: string,
): void {
  statement.append("match(substringUTF8(");
  appendValue(statement);
  statement.append(", 1, ");
  appendNumber(statement, maxLength);
  statement.append(
    SQL`), ${{ type: TableColumnType.Text, value: prefilter }})`,
  );
}

function sqlOf(text: string): (statement: Statement) => void {
  return (statement: Statement): void => {
    statement.append(text);
  };
}

/*
 * Only the records with a value at the location - and, given a prefilter
 * (DetectorPrefilter), only those whose value there could hold the data.
 * A span's events are read whole: their values are JSON text there.
 */
function appendLocationFilter(
  statement: Statement,
  read: OccurrenceRead,
  caps: TelemetrySampleCaps,
  prefilter: string | null,
): void {
  if (read.kind === "text") {
    statement.append(` AND ${read.column} != ''`);

    if (prefilter) {
      statement.append(" AND ");
      appendPrefilter(
        statement,
        sqlOf(read.column),
        textLengthOf(read.column, caps),
        prefilter,
      );
    }

    return;
  }

  if (read.kind === "pairs") {
    const match: KeyMatch = keyMatchOf(read.key);

    if (match.kind === "exact") {
      statement.append(` AND mapContains(${read.column}, `);
      statement.append(
        SQL`${{ type: TableColumnType.Text, value: match.key }})`,
      );

      if (prefilter) {
        statement.append(" AND ");
        appendPrefilter(
          statement,
          (inner: Statement): void => {
            inner.append(`${read.column}[`);
            inner.append(
              SQL`${{ type: TableColumnType.Text, value: match.key }}]`,
            );
          },
          caps.attributeValueLength,
          prefilter,
        );
      }

      return;
    }

    if (prefilter) {
      // A key the location stands for, whose value could hold the data.
      statement.append(" AND arrayExists((k, v) -> ");
      appendKeyCondition(statement, match, "k");
      statement.append(" AND ");
      appendPrefilter(
        statement,
        sqlOf("v"),
        caps.attributeValueLength,
        prefilter,
      );
      statement.append(`, mapKeys(${read.column}), mapValues(${read.column}))`);
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

/*
 * The most records one read of a plan takes: for kept records, a few rows
 * for each of their milliseconds.
 */
export function getOccurrenceReadLimit(
  plan: OccurrencePlan,
  records: ReadonlyArray<FindingSampleRecord> = [],
): number {
  const most: number =
    plan.read.kind === "events"
      ? OCCURRENCE_EVENT_RECORDS_PER_READ
      : OCCURRENCE_RECORDS_PER_READ;
  const rowsPerRecord: number =
    plan.source === TelemetrySampleSource.Metrics
      ? SAMPLED_ROWS_PER_METRIC_RECORD
      : SAMPLED_ROWS_PER_RECORD;

  return records.length > 0
    ? Math.min(most, records.length * rowsPerRecord)
    : most;
}

/*
 * Whether a read of kept records is narrowed by the data type's patterns
 * too: a metric's, whose kept millisecond holds every series of the
 * metric; any other kept record's millisecond is a lookup already.
 */
export function isKeptRecordReadNarrowed(plan: OccurrencePlan): boolean {
  return plan.source === TelemetrySampleSource.Metrics;
}

/*
 * What a search asks the database to narrow by: the finding's data type's
 * own patterns (DetectorPrefilter) - none where the location's name hints
 * at the type, since a value there counts by its shape or its name alone (a
 * cvv field's "123"), which no pattern finds.
 */
export function getOccurrencePrefilter(data: {
  dataTypeId: string;
  location: string;
  options: ContentScanOptions;
}): string | null {
  if (
    getHintedDataTypeIds(data.location, data.options.extraHints).has(
      data.dataTypeId,
    )
  ) {
    return null;
  }

  return getDataTypePrefilter({
    dataTypeId: data.dataTypeId,
    customDetectors: data.options.customDetectors,
  });
}

/*
 * A record's value at the location as its excerpt shows it: cut around the
 * finding's data, every sensitive value in it masked (OccurrenceExcerpt).
 */
export function buildOccurrenceExcerptReader(data: {
  dataTypeId: string;
  location: string;
  options: ContentScanOptions;
}): (value: TelemetryRecordValue) => DataSecurityOccurrenceExcerpt {
  return (value: TelemetryRecordValue): DataSecurityOccurrenceExcerpt => {
    return buildOccurrenceExcerpt({
      value: value.value,
      dataTypeId: data.dataTypeId,
      location: data.location,
      field: value.field,
      event: value.event,
      options: {
        customDetectors: data.options.customDetectors,
        extraHints: data.options.extraHints,
        disabledDataTypeIds: data.options.disabledDataTypeIds,
        allowedValues: data.options.allowedValues,
      },
    });
  };
}

/*
 * Only the records written in one of the kept records' milliseconds: each
 * a range of the primary key's own column, so the read is a lookup - for a
 * metric's point kept with its metric, of that metric, which the metrics
 * table is keyed by before the time.
 */
function appendRecordTimes(
  statement: Statement,
  timeColumn: string,
  records: ReadonlyArray<FindingSampleRecord>,
  isMetric: boolean = false,
): void {
  statement.append(" AND (");

  records.forEach((record: FindingSampleRecord, index: number): void => {
    const time: Date = new Date(record.time);

    statement.append(index === 0 ? "(" : " OR (");

    if (isMetric && record.metricName) {
      statement.append(
        SQL`name = ${{
          type: TableColumnType.Text,
          value: record.metricName,
        }} AND `,
      );
    }

    statement.append(timeColumn);
    statement.append(
      SQL` >= ${{ type: TableColumnType.DateTime64, value: time }} AND `,
    );
    statement.append(timeColumn);
    statement.append(
      SQL` < ${{
        type: TableColumnType.DateTime64,
        value: new Date(time.getTime() + 1),
      }})`,
    );
  });

  statement.append(")");
}

/*
 * The newest records of one owner in the window with a value at the
 * plan's location: their time and keys, and that value, cut short. Given
 * kept records, only those records' milliseconds; given a prefilter, only
 * records whose value could hold the data. Every value in it is bound as a
 * parameter.
 */
export function buildTelemetryOccurrenceStatement(
  data: TelemetryReadWindow & {
    plan: OccurrencePlan;
    ownerId: string;
    limit: number;
    caps: TelemetrySampleCaps;
    records?: ReadonlyArray<FindingSampleRecord> | undefined;
    prefilter?: string | null | undefined;
  },
): Statement {
  const source: SourceDefinition = getTelemetrySource(data.plan.source);
  const statement: Statement = SQL`SELECT `;

  statement.append(source.ownerColumn);
  statement.append(" AS ownerId, toUnixTimestamp64Milli(toDateTime64(");
  statement.append(source.timeColumn);
  statement.append(", 3)) AS recordTime");
  appendRecordKeys(statement, data.plan);
  appendOccurrenceColumns(statement, data.plan.read, data.caps);
  statement.append(" FROM ");
  statement.append(tableOf(source.table));
  appendWhere(statement, source, data);
  appendOwnersIn(statement, source, [data.ownerId]);

  if (data.records && data.records.length > 0) {
    appendRecordTimes(
      statement,
      source.timeColumn,
      data.records,
      data.plan.source === TelemetrySampleSource.Metrics,
    );
  }

  appendLocationFilter(
    statement,
    data.plan.read,
    data.caps,
    data.prefilter || null,
  );
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

// A metric's name as a record shows it, and whether it may go into a link.
export interface ShownMetricName {
  text: string;
  isKey: boolean;
}

/*
 * A metric's name as a record shows it: every sensitive value in it masked
 * (OccurrenceExcerpt.maskSensitiveText); a name with nothing masked is a
 * key, which opens the metric in the metrics explorer.
 */
export function buildMetricNameReader(
  options: ContentScanOptions | undefined,
): (metricName: string) => ShownMetricName {
  return (metricName: string): ShownMetricName => {
    const masked: { text: string; isMasked: boolean } = maskSensitiveText(
      metricName,
      { customDetectors: options?.customDetectors },
    );

    return { text: masked.text, isKey: !masked.isMasked };
  };
}

function occurrenceOf(data: {
  source: TelemetrySampleSource;
  row: JSONObject;
  ownerId: string;
  time: string;
  maskedValue: string;
  showMetricName: (metricName: string) => ShownMetricName;
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

  // A metric's point: its metric, masked where it holds data, and its key.
  const metricName: string = readText(data.row["readMetricName"]);

  if (data.source === TelemetrySampleSource.Metrics && metricName.trim()) {
    const shown: ShownMetricName = data.showMetricName(metricName);

    occurrence.name = shown.text;

    if (shown.isKey) {
      occurrence.metricName = metricName;
    }
  }

  return occurrence;
}

/*
 * The records the rows hold that carry the finding's data at its
 * location, the newest first, at most `max`: each row's values read as the
 * scan reads them, the first one at the location that is the data type
 * making it one. A session the table keeps several versions of is one
 * record; so is a metric's series, however many of its points were read -
 * the same metric with the same value there.
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
  // The excerpt of a value that holds it (buildOccurrenceExcerptReader).
  excerptOf?:
    | ((value: TelemetryRecordValue) => DataSecurityOccurrenceExcerpt)
    | undefined;
  // A metric's name as a record shows it (buildMetricNameReader).
  showMetricName?: ((metricName: string) => ShownMetricName) | undefined;
  max: number;
}): { occurrences: Array<DataSecurityFindingOccurrence>; recordsRead: number } {
  const occurrences: Array<DataSecurityFindingOccurrence> = [];
  const seenSessions: Set<string> = new Set();
  // A metric's series already shown: its metric and its value, never sent.
  const seenSeries: Set<string> = new Set();
  const showMetricName: (metricName: string) => ShownMetricName =
    data.showMetricName || buildMetricNameReader(undefined);
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

      if (data.plan.source === TelemetrySampleSource.Metrics) {
        const series: string = JSON.stringify([
          readText(row["readMetricName"]),
          value.value,
        ]);

        if (seenSeries.has(series)) {
          break;
        }

        seenSeries.add(series);
      }

      const maskedValue: string | null = data.maskIfFound(value.value);

      if (maskedValue) {
        const occurrence: DataSecurityFindingOccurrence = occurrenceOf({
          source: data.plan.source,
          row,
          ownerId: data.ownerId,
          time,
          maskedValue,
          showMetricName,
        });

        if (data.excerptOf) {
          occurrence.excerpt = data.excerptOf(value);
        }

        occurrences.push(occurrence);
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

async function readRows(
  source: SourceDefinition,
  statement: Statement,
): Promise<Array<JSONObject>> {
  const result: Results = await source.runner.executeQuery(statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
}

/*
 * The records of a telemetry store that carry a finding's data at its
 * location, read now: the ones the last scan kept, the hour it read, or the
 * newest of the last days (planOccurrenceSearch). The caller has checked
 * the reader may read the store's telemetry; `options` is the project's
 * scan setup (DataSecurityRunner.getScanSetup), for its custom types,
 * hints, allowed values and the scan's caps.
 */
export async function findTelemetryFindingOccurrences(data: {
  projectId: ObjectID;
  plan: OccurrencePlan;
  ownerId: string;
  location: string;
  dataTypeId: string;
  options: ContentScanOptions;
  // The records the last scan found it in, and when that was.
  sampleRecords?: ReadonlyArray<FindingSampleRecord> | undefined;
  lastSeenAt?: Date | null | undefined;
  now?: Date | undefined;
}): Promise<DataSecurityFindingOccurrences> {
  const search: OccurrenceSearch = planOccurrenceSearch({
    now: data.now || OneUptimeDate.getCurrentDate(),
    sampleRecords: data.sampleRecords,
    lastSeenAt: data.lastSeenAt,
  });
  const source: SourceDefinition = getTelemetrySource(data.plan.source);
  const caps: TelemetrySampleCaps = capsOf(source, data.options);
  const limit: number = getOccurrenceReadLimit(data.plan, search.records);
  /*
   * A lookup of kept records needs no narrowing - but a metric's, whose
   * millisecond holds every series of the metric; a search does.
   */
  const prefilter: string | null =
    search.source === DataSecurityOccurrencesSource.SampledRecords &&
    !isKeptRecordReadNarrowed(data.plan)
      ? null
      : getOccurrencePrefilter({
          dataTypeId: data.dataTypeId,
          location: data.location,
          options: data.options,
        });

  const statementFor: (prefilter: string | null) => Statement = (
    narrowedBy: string | null,
  ): Statement => {
    return buildTelemetryOccurrenceStatement({
      projectId: data.projectId,
      since: search.since,
      until: search.until,
      plan: data.plan,
      ownerId: data.ownerId,
      limit,
      caps,
      records: search.records,
      prefilter: narrowedBy,
    });
  };

  const readFailed: (error: unknown) => void = (error: unknown): void => {
    logger.warn(
      `DataSecurity: could not read the records of ${source.label} ${data.ownerId} at ${data.location} in project ${data.projectId.toString()}:`,
    );
    logger.warn(error);
  };

  let rows: Array<JSONObject>;

  try {
    rows = await readRows(source, statementFor(prefilter));
  } catch (error) {
    readFailed(error);

    /*
     * Narrowed, a search the database could not run - an expression it
     * refused, a search that ran out of time - is read again as it always
     * was: the newest records with a value there.
     */
    if (!prefilter) {
      throw new BadDataException(
        "Could not read these records just now. Try again in a minute.",
      );
    }

    try {
      rows = await readRows(source, statementFor(null));
    } catch (retryError) {
      readFailed(retryError);

      throw new BadDataException(
        "Could not read these records just now. Try again in a minute.",
      );
    }
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
    excerptOf: buildOccurrenceExcerptReader({
      dataTypeId: data.dataTypeId,
      location: data.location,
      options: data.options,
    }),
    showMetricName: buildMetricNameReader(data.options),
    max: MAX_OCCURRENCES,
  });

  const found: DataSecurityFindingOccurrences = {
    occurrences: read.occurrences,
    since: search.since.toISOString(),
    until: search.until.toISOString(),
    recordsRead: read.recordsRead,
    isComplete: rows.length < limit,
    source: search.source,
  };

  if (data.lastSeenAt instanceof Date && !isNaN(data.lastSeenAt.getTime())) {
    found.lastSeenAt = data.lastSeenAt.toISOString();
  }

  return found;
}
