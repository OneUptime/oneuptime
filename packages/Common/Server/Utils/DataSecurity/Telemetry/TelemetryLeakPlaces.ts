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
import BUILT_IN_DETECTORS from "../../../../Utils/DataSecurity/Detectors/Index";
import { alignTelemetryLeakTemplates } from "../../../../Utils/DataSecurity/TelemetryLeakTemplate";
import {
  findSensitiveValues,
  ScanDetector,
} from "../../../../Utils/DataSecurity/TextScanner";
import { normalizeCandidatePath } from "../../CodeRepository/StackTraceRepoResolver";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Telemetry/StackTraceParser";
import { TelemetrySampleSource } from "./TelemetrySampleSource";

/*
 * THE PLACE IN A SERVICE'S CODE A TELEMETRY RECORD NAMES (#10367): read
 * from the record's row as the locator selects it (TelemetryLeakLocator's
 * buildLeakRecordStatement), and nothing else of it.
 *
 *   - its code location attributes: code.filepath / code.file.path,
 *     code.function / code.function.name with code.namespace, code.lineno /
 *     code.line.number - the file as a repository path, a container's
 *     prefix and a dependency's path taken off;
 *   - its instrumentation scope: the logger's or the tracer's name;
 *   - a span's name, an exception's type, a log line, a message or a
 *     metric's name that holds the data - each as a template, its values
 *     replaced by their types' names (TelemetryLeakTemplate);
 *   - an exception's own top frames (StackTraceParser's in-app frames);
 *   - a metric's name, where the instrument is created - never one that
 *     holds the data.
 *
 * Pure - no database, no scanner, no service - so the eval set of recorded
 * findings and the code agent's benchmark read records exactly as the
 * product does.
 */

function readCell(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

/*
 * Whether a metric's name is the record's key rather than its data: no
 * detector finds a sensitive value in it (a name built from a user's email
 * is a value, never said as it is).
 */
function isNameAKey(
  name: string,
  customDetectors: ReadonlyArray<ScanDetector>,
): boolean {
  return (
    Boolean(name) &&
    findSensitiveValues(name, {
      detectors:
        customDetectors.length > 0
          ? [...BUILT_IN_DETECTORS, ...customDetectors]
          : BUILT_IN_DETECTORS,
    }).length === 0
  );
}

function firstText(row: JSONObject, aliases: ReadonlyArray<string>): string {
  for (const alias of aliases) {
    const text: string = readCell(row[alias]).trim();

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

// What no name keeps: the C0 controls and DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS: RegExp = /[\u0000-\u001f\u007f]/g;

// A name the code gave a function or a scope, on one line, held to its length.
function readName(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, " ")
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
  const namespace: string = readName(readCell(row["readNamespace"]));

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
  const scopeName: string = readName(readCell(row["readScope"]));

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
  const parsedFrames: string = readCell(row["readFrames"]);

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
    const stackTrace: string = readCell(row["readStackTrace"]);

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
      const template: string = data.templateOf(readCell(row["readBody"]));

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
      const spanName: string = data.templateOf(readCell(row["readName"]));

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
        readName(readCell(row["readExceptionType"])),
      );
      const template: string =
        data.location === "message" || data.location === "stackTrace"
          ? data.templateOf(readCell(row["readMessage"]))
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
      const metricName: string = readCell(row["readMetricName"]);

      if (
        data.location !== METRIC_NAME_LOCATION &&
        isNameAKey(metricName, data.customDetectors || [])
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
