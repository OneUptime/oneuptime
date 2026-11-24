import { ResponseJSON } from "@clickhouse/client";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import { DataSecurityFindingOccurrences } from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  FindingSampleRecord,
  toFindingSampleRecord,
} from "../../../../Types/DataSecurity/FindingSampleRecord";
import {
  MAX_PLACES_PER_TELEMETRY_LEAK,
  MAX_TELEMETRY_LEAK_FRAMES,
  MAX_TELEMETRY_LEAK_NAME_LENGTH,
  MAX_TELEMETRY_LEAK_PATH_LENGTH,
  TelemetryLeakFrame,
  TelemetryLeakPlace,
  getTelemetryLeakPlaceKey,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
import { METRIC_NAME_LOCATION } from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  TelemetryLeakTemplateOptions,
  alignTelemetryLeakTemplates,
  buildTelemetryLeakTemplate,
} from "../../../../Utils/DataSecurity/TelemetryLeakTemplate";
import { ScanDetector } from "../../../../Utils/DataSecurity/TextScanner";
import { Results } from "../../../Services/AnalyticsDatabaseService";
import { getQuerySettings } from "../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../AnalyticsDatabase/Statement";
import { normalizeCandidatePath } from "../../CodeRepository/StackTraceRepoResolver";
import logger from "../../Logger";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Telemetry/StackTraceParser";
import { ContentScanOptions } from "../DataSecurityScanTypes";
import {
  appendOwnersIn,
  appendWhere,
  getTelemetrySource,
  isMetricNameAKey,
  readText,
  SOURCES_WITH_LOG_IDS,
  SourceDefinition,
  tableOf,
  whole,
} from "./TelemetryDataScanner";
import {
  findTelemetryFindingOccurrences,
  OccurrencePlan,
  planOccurrenceRead,
} from "./TelemetryFindingOccurrences";
// Read while this module loads, which can be in the middle of the scanner's: see its module.
import { TelemetrySampleSource } from "./TelemetrySampleSource";

/*
 * WHERE IN A SERVICE'S CODE EACH TELEMETRY LEAK IS WRITTEN (#10367) - FROM
 * THE RECORDS IT WAS SEEN IN, READ INSIDE ONEUPTIME.
 *
 * A finding says a data type sits at a location of a service's telemetry:
 * attributes.user.email in its spans, the body of its logs. The scan kept
 * the records it found it in (FindingSampleRecord); this reads those very
 * records again - a lookup by their millisecond and their own ids - and
 * keeps only where they came from:
 *
 *   - spans and AI calls: the code location attributes (code.filepath /
 *     code.file.path, code.function / code.function.name, code.lineno /
 *     code.line.number), the span's name and its instrumentation scope;
 *   - exceptions: the top frames of the stack that are the service's own
 *     code (StackTraceParser's in-app frames, with a dependency's and a
 *     container's paths taken off by normalizeCandidatePath), its type,
 *     and - for a finding in its message - the message as a template;
 *   - logs: the code location attributes when present, the logger's
 *     scope, and the line as a template (TelemetryLeakTemplate): its
 *     pattern, every value replaced by its type's name;
 *   - metrics: the metric's name, where the instrument is created - never
 *     a name that holds the data (isMetricNameAKey), which is said as a
 *     template instead.
 *
 * A finding from before scans kept records is looked for as its records
 * list on the issue's page is (findTelemetryFindingOccurrences), and the
 * records that carry it are read again the same way.
 *
 * Nothing else of a record leaves this file: no value, no attribute but
 * the code's own, no excerpt. The values a template is made from are read
 * here and dropped here. Bounded like the occurrences' read: the project
 * and the owner first, at most a few rows a record, every text cut in the
 * database, and a time limit. Read as OneUptime itself: who asked has been
 * checked by the caller, and what is kept is no record's content.
 */

// The attributes a record names its code with, the older names first.
export const LEAK_FILE_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "code.filepath",
  "code.file.path",
];
export const LEAK_FUNCTION_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "code.function",
  "code.function.name",
];
export const LEAK_LINE_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "code.lineno",
  "code.line.number",
];
export const LEAK_NAMESPACE_ATTRIBUTE_KEY: string = "code.namespace";
// The instrumentation scope: ingest keeps it as scope.<field> (Telemetry.getPrefixedScopeAttributes).
export const LEAK_SCOPE_ATTRIBUTE_KEY: string = "scope.name";

const CODE_ATTRIBUTE_ALIASES: ReadonlyArray<[string, string]> = [
  ["code.filepath", "readFile1"],
  ["code.file.path", "readFile2"],
  ["code.function", "readFunction1"],
  ["code.function.name", "readFunction2"],
  ["code.lineno", "readLine1"],
  ["code.line.number", "readLine2"],
  [LEAK_NAMESPACE_ATTRIBUTE_KEY, "readNamespace"],
  [LEAK_SCOPE_ATTRIBUTE_KEY, "readScope"],
];

// The rows read for each kept record: a few may share its millisecond.
export const LEAK_ROWS_PER_RECORD: number = 4;
// The most rows one read takes.
export const MAX_LEAK_ROWS_PER_READ: number = 40;
// How long the read may run.
export const LEAK_READ_TIME_LIMIT_IN_SECONDS: number = 20;
// How much of a log line, a message or a stack is read to make a place of it.
export const LEAK_TEXT_READ_LENGTH: number = 4_096;
export const LEAK_FRAMES_READ_LENGTH: number = 16_384;

const LEAK_MAX_RESULT_BYTES: number = 16 * 1024 * 1024;

// One finding to locate: its data at its location of one telemetry store.
export interface TelemetryLeakFindingToLocate {
  findingId: string;
  storeKind: DataStoreKind | string;
  // Whose records they are: the store's service.
  ownerId: string;
  location: string;
  dataTypeId: string;
  // The records the last scan found it in.
  sampleRecords: ReadonlyArray<FindingSampleRecord>;
  lastSeenAt?: Date | null | undefined;
}

export interface TelemetryLeakLocation {
  findingId: string;
  places: Array<TelemetryLeakPlace>;
  // How many of its records were read.
  recordsRead: number;
}

/*
 * What a read of a source's records takes: the code's own attributes, and
 * the part each signal names its place with.
 */
export interface LeakRecordRead {
  source: TelemetrySampleSource;
  // Read the exception's message too: the finding is in it.
  withMessage?: boolean | undefined;
}

function appendNumber(statement: Statement, value: number): void {
  statement.append(
    SQL`${{ type: TableColumnType.Number, value: whole(value, 1) }}`,
  );
}

function appendText(
  statement: Statement,
  column: string,
  length: number,
  alias: string,
): void {
  statement.append(`, substringUTF8(${column}, 1, `);
  appendNumber(statement, length);
  statement.append(`) AS ${alias}`);
}

// The code's own attributes, each cut, by its alias.
function appendCodeAttributes(statement: Statement): void {
  for (const [key, alias] of CODE_ATTRIBUTE_ALIASES) {
    statement.append(
      SQL`, substringUTF8(attributes[${{ type: TableColumnType.Text, value: key }}], 1, `,
    );
    appendNumber(statement, MAX_TELEMETRY_LEAK_PATH_LENGTH);
    statement.append(`) AS ${alias}`);
  }
}

/*
 * Only the kept records: each its millisecond - a range of the primary
 * key's own column - narrowed by what tells it from its neighbours there:
 * a log line's own id, its trace and span, a metric's point by its metric.
 */
function appendLeakRecords(
  statement: Statement,
  source: SourceDefinition,
  records: ReadonlyArray<FindingSampleRecord>,
): void {
  const isLogLine: boolean = SOURCES_WITH_LOG_IDS.has(source.source);
  const isMetric: boolean = source.source === TelemetrySampleSource.Metrics;

  statement.append(" AND (");

  records.forEach((record: FindingSampleRecord, index: number): void => {
    const time: Date = new Date(record.time);

    statement.append(index === 0 ? "(" : " OR (");

    if (isLogLine && record.logId) {
      statement.append(
        SQL`_id = ${{ type: TableColumnType.Text, value: record.logId }} AND `,
      );
    }

    if (isMetric && record.metricName) {
      statement.append(
        SQL`name = ${{ type: TableColumnType.Text, value: record.metricName }} AND `,
      );
    }

    if (!isMetric && record.traceId) {
      statement.append(
        SQL`traceId = ${{ type: TableColumnType.Text, value: record.traceId }} AND `,
      );
    }

    if (!isMetric && record.spanId) {
      statement.append(
        SQL`spanId = ${{ type: TableColumnType.Text, value: record.spanId }} AND `,
      );
    }

    statement.append(source.timeColumn);
    statement.append(
      SQL` >= ${{ type: TableColumnType.DateTime64, value: time }} AND `,
    );
    statement.append(source.timeColumn);
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
 * The kept records of one owner, by their keys: the code's own attributes
 * and what each signal names its place with, every text cut in the
 * database. Every value in it is bound as a parameter.
 */
export function buildLeakRecordStatement(data: {
  projectId: ObjectID;
  read: LeakRecordRead;
  ownerId: string;
  records: ReadonlyArray<FindingSampleRecord>;
}): Statement {
  const source: SourceDefinition = getTelemetrySource(data.read.source);
  const times: Array<number> = data.records.map(
    (record: FindingSampleRecord): number => {
      return new Date(record.time).getTime();
    },
  );
  const statement: Statement = SQL`SELECT toUnixTimestamp64Milli(toDateTime64(`;

  statement.append(source.timeColumn);
  statement.append(", 3)) AS recordTime");

  switch (data.read.source) {
    case TelemetrySampleSource.Logs:
      appendCodeAttributes(statement);
      appendText(statement, "body", LEAK_TEXT_READ_LENGTH, "readBody");
      break;
    case TelemetrySampleSource.Traces:
    case TelemetrySampleSource.AiConversations:
      appendCodeAttributes(statement);
      appendText(statement, "name", MAX_TELEMETRY_LEAK_NAME_LENGTH, "readName");
      break;
    case TelemetrySampleSource.Exceptions:
      appendCodeAttributes(statement);
      appendText(
        statement,
        "parsedFrames",
        LEAK_FRAMES_READ_LENGTH,
        "readFrames",
      );
      appendText(
        statement,
        "stackTrace",
        LEAK_FRAMES_READ_LENGTH,
        "readStackTrace",
      );
      appendText(
        statement,
        "exceptionType",
        MAX_TELEMETRY_LEAK_NAME_LENGTH,
        "readExceptionType",
      );

      if (data.read.withMessage) {
        appendText(statement, "message", LEAK_TEXT_READ_LENGTH, "readMessage");
      }
      break;
    case TelemetrySampleSource.Metrics:
      appendText(statement, "name", LEAK_TEXT_READ_LENGTH, "readMetricName");
      break;
    default:
      break;
  }

  statement.append(" FROM ");
  statement.append(tableOf(source.table));
  appendWhere(statement, source, {
    projectId: data.projectId,
    since: new Date(Math.min(...times)),
    // The newest record's millisecond, all of it.
    until: new Date(Math.max(...times) + 1),
  });
  appendOwnersIn(statement, source, [data.ownerId]);
  appendLeakRecords(statement, source, data.records);
  statement.append(" LIMIT ");
  appendNumber(
    statement,
    Math.min(MAX_LEAK_ROWS_PER_READ, data.records.length * LEAK_ROWS_PER_RECORD),
  );
  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: LEAK_READ_TIME_LIMIT_IN_SECONDS,
      timeoutOverflowMode: "throw",
      boundScanMemory: true,
      additionalSettings: { max_result_bytes: LEAK_MAX_RESULT_BYTES },
    }),
  );

  return statement;
}

function firstText(row: JSONObject, aliases: ReadonlyArray<string>): string {
  for (const alias of aliases) {
    const text: string = readText(row[alias]).trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function readLineNumber(value: string): number | undefined {
  const line: number = Number(value);

  return Number.isSafeInteger(line) && line > 0 && line < 10_000_000
    ? line
    : undefined;
}

// A name the code gave a function or a scope, on one line, held to its length.
function readName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TELEMETRY_LEAK_NAME_LENGTH);
}

/*
 * A file a record names, as a repository path: the container's prefix and
 * a dependency's path taken off (normalizeCandidatePath). Empty for one
 * that is no file of the service's own.
 */
export function toLeakFilePath(value: string): string {
  if (!value) {
    return "";
  }

  // A file:// address, as some instrumentations write it.
  const path: string = value.replace(/^file:\/\//i, "");

  return (normalizeCandidatePath(path) || "").slice(
    0,
    MAX_TELEMETRY_LEAK_PATH_LENGTH,
  );
}

// A function as a record names it: its namespace before it, when it has one.
function readFunctionName(row: JSONObject): string {
  const name: string = readName(
    firstText(row, ["readFunction1", "readFunction2"]),
  );
  const namespace: string = readName(readText(row["readNamespace"]));

  if (!name) {
    return "";
  }

  return namespace && !name.startsWith(namespace)
    ? readName(`${namespace}.${name}`)
    : name;
}

// The code location a record's own attributes name, as far as they name one.
function readCodeLocation(row: JSONObject): Partial<TelemetryLeakPlace> {
  const filePath: string = toLeakFilePath(
    firstText(row, ["readFile1", "readFile2"]),
  );
  const functionName: string = readFunctionName(row);
  const lineNumber: number | undefined = readLineNumber(
    firstText(row, ["readLine1", "readLine2"]),
  );
  const scopeName: string = readName(readText(row["readScope"]));

  return {
    ...(filePath ? { filePath } : {}),
    ...(functionName ? { functionName } : {}),
    ...(filePath && lineNumber !== undefined ? { lineNumber } : {}),
    ...(scopeName ? { scopeName } : {}),
  };
}

/*
 * An exception's own top frames: the stack as ingest parsed it
 * (parsedFrames), else as it was sent, parsed here - frames only, never
 * the message line - keeping the service's own code.
 */
export function readOwnFrames(row: JSONObject): Array<TelemetryLeakFrame> {
  let frames: Array<StackFrame> = [];
  const parsedFrames: string = readText(row["readFrames"]);

  if (parsedFrames && parsedFrames !== "[]") {
    try {
      const parsed: unknown = JSON.parse(parsedFrames);

      if (Array.isArray(parsed)) {
        frames = parsed as Array<StackFrame>;
      }
    } catch {
      // A stack cut by the read: parsed again from the trace below.
      frames = [];
    }
  }

  if (frames.length === 0) {
    const stackTrace: string = readText(row["readStackTrace"]);

    if (stackTrace) {
      try {
        const parsed: ParsedStackTrace = StackTraceParser.parse(stackTrace);
        frames = parsed.frames;
      } catch {
        frames = [];
      }
    }
  }

  const own: Array<TelemetryLeakFrame> = [];

  for (const frame of frames) {
    if (!frame || typeof frame !== "object" || frame.inApp === false) {
      continue;
    }

    const filePath: string = toLeakFilePath(
      typeof frame.fileName === "string" ? frame.fileName : "",
    );

    if (!filePath) {
      continue;
    }

    const functionName: string = readName(
      typeof frame.functionName === "string" ? frame.functionName : "",
    );
    const lineNumber: number | undefined =
      typeof frame.lineNumber === "number"
        ? readLineNumber(String(frame.lineNumber))
        : undefined;

    own.push({
      filePath,
      ...(functionName && functionName !== "<anonymous>"
        ? { functionName }
        : {}),
      ...(lineNumber !== undefined ? { lineNumber } : {}),
    });

    if (own.length >= MAX_TELEMETRY_LEAK_FRAMES) {
      break;
    }
  }

  return own;
}

/*
 * The place one record names, as its signal names it - or null for a
 * record that names none. `templateOf` makes a template of a text the
 * record holds (TelemetryLeakTemplate).
 */
export function readLeakPlaceOfRow(data: {
  source: TelemetrySampleSource;
  row: JSONObject;
  location: string;
  templateOf: (text: string) => string;
  customDetectors?: ReadonlyArray<ScanDetector> | undefined;
}): TelemetryLeakPlace | null {
  const row: JSONObject = data.row;
  let place: TelemetryLeakPlace = { recordCount: 1 };

  switch (data.source) {
    case TelemetrySampleSource.Logs: {
      const template: string = data.templateOf(readText(row["readBody"]));

      place = {
        ...place,
        ...readCodeLocation(row),
        ...(template ? { template } : {}),
      };
      break;
    }
    case TelemetrySampleSource.Traces:
    case TelemetrySampleSource.AiConversations: {
      // A span's name can hold an id or a value: its template, never as it was.
      const spanName: string = data.templateOf(readText(row["readName"]));

      place = {
        ...place,
        ...readCodeLocation(row),
        ...(spanName ? { spanName } : {}),
      };
      break;
    }
    case TelemetrySampleSource.Exceptions: {
      const frames: Array<TelemetryLeakFrame> = readOwnFrames(row);
      const own: Partial<TelemetryLeakPlace> = readCodeLocation(row);
      const top: TelemetryLeakFrame | undefined = frames[0];
      // A class name, as the code wrote it - put through a template all the same.
      const exceptionType: string = data.templateOf(
        readName(readText(row["readExceptionType"])),
      );
      const template: string =
        data.location === "message" || data.location === "stackTrace"
          ? data.templateOf(readText(row["readMessage"]))
          : "";

      place = {
        ...place,
        ...own,
        ...(top
          ? {
              filePath: top.filePath,
              ...(top.functionName ? { functionName: top.functionName } : {}),
              ...(top.lineNumber !== undefined
                ? { lineNumber: top.lineNumber }
                : {}),
            }
          : {}),
        ...(frames.length > 0 ? { frames } : {}),
        ...(exceptionType ? { exceptionType } : {}),
        ...(template ? { template } : {}),
      };
      break;
    }
    case TelemetrySampleSource.Metrics: {
      const metricName: string = readText(row["readMetricName"]);

      if (
        data.location !== METRIC_NAME_LOCATION &&
        isMetricNameAKey(metricName, data.customDetectors || [])
      ) {
        place = {
          ...place,
          metricName: readName(metricName),
        };
      } else {
        // The name holds the data: said as a template, never as it is.
        const template: string = data.templateOf(metricName);

        place = { ...place, ...(template ? { template } : {}) };
      }
      break;
    }
    default:
      return null;
  }

  return getTelemetryLeakPlaceKey(place) ? place : null;
}

/*
 * The places a leak's records name, each once - counted by how many of
 * its records named it, the most named first - with the templates of one
 * place read from several records aligned, so a word that differs between
 * them is masked as the value it is. At most MAX_PLACES_PER_TELEMETRY_LEAK.
 */
export function readLeakPlaces(data: {
  source: TelemetrySampleSource;
  rows: ReadonlyArray<JSONObject>;
  location: string;
  templateOf: (text: string) => string;
  customDetectors?: ReadonlyArray<ScanDetector> | undefined;
}): Array<TelemetryLeakPlace> {
  const read: Array<TelemetryLeakPlace> = [];

  for (const row of data.rows) {
    const place: TelemetryLeakPlace | null = readLeakPlaceOfRow({
      source: data.source,
      row,
      location: data.location,
      templateOf: data.templateOf,
      customDetectors: data.customDetectors,
    });

    if (place) {
      read.push(place);
    }
  }

  /*
   * One line of code read with different values: each word that differs
   * between its records' templates is masked. Only templates of one file
   * and line are lined up - two lines of code alike are two lines.
   */
  const byLine: Map<string, Array<string>> = new Map();

  for (const place of read) {
    if (place.template && place.filePath && place.lineNumber !== undefined) {
      const line: string = `${place.filePath}:${place.lineNumber}`;

      byLine.set(line, [...(byLine.get(line) || []), place.template]);
    }
  }

  const aligned: Map<string, Map<string, string>> = new Map();

  for (const [line, templates] of byLine) {
    aligned.set(line, alignTelemetryLeakTemplates(templates));
  }

  const merged: Map<string, TelemetryLeakPlace> = new Map();

  for (const place of read) {
    const line: string =
      place.filePath && place.lineNumber !== undefined
        ? `${place.filePath}:${place.lineNumber}`
        : "";
    const template: string | undefined = place.template
      ? aligned.get(line)?.get(place.template) || place.template
      : undefined;
    const kept: TelemetryLeakPlace = {
      ...place,
      ...(template ? { template } : {}),
    };
    const key: string = getTelemetryLeakPlaceKey(kept) || "";
    const seen: TelemetryLeakPlace | undefined = merged.get(key);

    if (seen) {
      seen.recordCount += kept.recordCount;
    } else {
      merged.set(key, kept);
    }
  }

  return Array.from(merged.values())
    .sort((left: TelemetryLeakPlace, right: TelemetryLeakPlace): number => {
      return right.recordCount - left.recordCount;
    })
    .slice(0, MAX_PLACES_PER_TELEMETRY_LEAK);
}

async function readRows(
  source: SourceDefinition,
  statement: Statement,
): Promise<Array<JSONObject>> {
  const result: Results = await source.runner.executeQuery(statement);
  const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

  return (response.data || []) as Array<JSONObject>;
}

export default class TelemetryLeakLocator {
  /*
   * The records a finding was seen in: the ones the last scan kept, else
   * those its records list would show (findTelemetryFindingOccurrences),
   * each by its keys only.
   */
  public static async findRecords(data: {
    projectId: ObjectID;
    finding: TelemetryLeakFindingToLocate;
    plan: OccurrencePlan;
    options: ContentScanOptions;
  }): Promise<Array<FindingSampleRecord>> {
    if (data.finding.sampleRecords.length > 0) {
      return [...data.finding.sampleRecords];
    }

    const found: DataSecurityFindingOccurrences =
      await findTelemetryFindingOccurrences({
        projectId: data.projectId,
        plan: data.plan,
        ownerId: data.finding.ownerId,
        location: data.finding.location,
        dataTypeId: data.finding.dataTypeId,
        options: data.options,
        lastSeenAt: data.finding.lastSeenAt || undefined,
      });

    return found.occurrences
      .map((occurrence: DataSecurityFindingOccurrences["occurrences"][number]) => {
        return toFindingSampleRecord({
          time: occurrence.time,
          traceId: occurrence.traceId,
          spanId: occurrence.spanId,
          sessionId: occurrence.sessionId,
          logId: occurrence.logId,
          metricName: occurrence.metricName,
        });
      })
      .filter(
        (record: FindingSampleRecord | null): record is FindingSampleRecord => {
          return record !== null;
        },
      );
  }

  /*
   * Where one finding's data is written: the places its records name. A
   * finding whose records cannot be read now - aged out, or a read that
   * failed - has none, and its key is where the code is looked for.
   */
  public static async locateFinding(data: {
    projectId: ObjectID;
    finding: TelemetryLeakFindingToLocate;
    options: ContentScanOptions;
    nameOf: (dataTypeId: string) => string;
  }): Promise<TelemetryLeakLocation> {
    const none: TelemetryLeakLocation = {
      findingId: data.finding.findingId,
      places: [],
      recordsRead: 0,
    };
    const plan: OccurrencePlan | null = planOccurrenceRead(
      data.finding.storeKind,
      data.finding.location,
    );

    if (!plan || !ObjectID.isValidUUID(data.finding.ownerId)) {
      return none;
    }

    try {
      const records: Array<FindingSampleRecord> =
        await TelemetryLeakLocator.findRecords({
          projectId: data.projectId,
          finding: data.finding,
          plan,
          options: data.options,
        });

      if (records.length === 0) {
        return none;
      }

      const source: SourceDefinition = getTelemetrySource(plan.source);
      const rows: Array<JSONObject> = await readRows(
        source,
        buildLeakRecordStatement({
          projectId: data.projectId,
          read: {
            source: plan.source,
            withMessage:
              plan.source === TelemetrySampleSource.Exceptions &&
              (data.finding.location === "message" ||
                data.finding.location === "stackTrace"),
          },
          ownerId: data.finding.ownerId,
          records,
        }),
      );
      const templateOptions: TelemetryLeakTemplateOptions = {
        customDetectors: data.options.customDetectors,
        nameOf: data.nameOf,
      };

      return {
        findingId: data.finding.findingId,
        places: readLeakPlaces({
          source: plan.source,
          rows,
          location: data.finding.location,
          templateOf: (text: string): string => {
            return buildTelemetryLeakTemplate(text, templateOptions);
          },
          customDetectors: data.options.customDetectors,
        }),
        recordsRead: rows.length,
      };
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read where finding ${data.finding.findingId} of project ${data.projectId.toString()} is written:`,
      );
      logger.warn(error);
      return none;
    }
  }

  // Every finding's places, one finding at a time, in the order given.
  public static async locate(data: {
    projectId: ObjectID;
    findings: ReadonlyArray<TelemetryLeakFindingToLocate>;
    options: ContentScanOptions;
    nameOf: (dataTypeId: string) => string;
  }): Promise<Map<string, TelemetryLeakLocation>> {
    const located: Map<string, TelemetryLeakLocation> = new Map();

    for (const finding of data.findings) {
      located.set(
        finding.findingId,
        await TelemetryLeakLocator.locateFinding({
          projectId: data.projectId,
          finding,
          options: data.options,
          nameOf: data.nameOf,
        }),
      );
    }

    return located;
  }
}
