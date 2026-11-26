import {
  MAX_PLACES_PER_TELEMETRY_LEAK,
  MAX_TELEMETRY_LEAK_FRAMES,
  MAX_TELEMETRY_LEAK_NAME_LENGTH,
  MAX_TELEMETRY_LEAK_PATH_LENGTH,
  MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH,
  TelemetryLeakFrame,
  TelemetryLeakPlace,
  getTelemetryLeakPlaceKey,
  readTelemetryLeakFrame,
  readTelemetryLeakList,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
import { METRIC_NAME_LOCATION } from "../../../../Types/DataSecurity/TelemetryScrubTarget";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import BUILT_IN_DETECTORS from "../../../../Utils/DataSecurity/Detectors/Index";
import {
  alignTelemetryLeakTemplates,
  maskUnprovenNameParts,
  maskUnprovenWords,
} from "../../../../Utils/DataSecurity/TelemetryLeakTemplate";
import UrlScrubber from "../../../../Utils/Rum/UrlScrubber";
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
import {
  MinifiedStackFrame,
  ResolvedStackFrame,
} from "../../../../Types/Telemetry/SourceMap";
import SourceMapResolver from "../../Telemetry/SourceMapResolver";

// The most of a finding's RUM records whose stacks are resolved through source maps (#10933).
export const MAX_RUM_STACKS_RESOLVED: number = 3;
// The most frames of one stack handed to the source maps.
export const MAX_RUM_FRAMES_RESOLVED: number = 20;

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
 * A RUM application's records (#10933) name their place the same way, in
 * its front-end code: a browser log's or span's code location
 * attributes, its JavaScript stack resolved through the application's
 * source maps to the original files (the locator resolves them, and hands
 * them in as readResolvedFrames), its span's name or its line as a
 * template - and the page it was written on: the path the URL scrubber
 * keeps of it (no host, no query; a hash route kept, identifiers masked),
 * as a template. A session's user details name the session recorder call
 * that gave them (identify) and the page the session started on. Never a
 * recording: no finding is in one, and nothing here reads one.
 *
 * Pure - no database, no scanner, no service - so the eval set of recorded
 * findings and the code agent's benchmark read records exactly as the
 * product does.
 */

// The session recorder call that gives a session its user and traits.
export const RUM_IDENTIFY_CALL: string = "identify";

// A session's user details - its label and its traits - are what identify() gives it.
const RUM_USER_DETAILS_PREFIX: string = "sessions.identifiedUser";

// The page a RUM record names, most specific first: its path, its URL, a session's entry page.
const RUM_URL_ALIASES: ReadonlyArray<string> = [
  "readUrlFull",
  "readHttpUrl",
  "readPage",
];

// A page the scrubber keeps nothing of.
const REDACTED_PAGE: string = "[redacted]";

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
 * The minified frames of a JavaScript stack a RUM record holds, as the
 * source maps are asked for them: at most MAX_RUM_FRAMES_RESOLVED. None
 * for a record with no stack.
 */
export function readMinifiedFrames(
  stackTrace: string,
): Array<MinifiedStackFrame> {
  if (!stackTrace.trim()) {
    return [];
  }

  try {
    return StackTraceParser.parse(stackTrace)
      .frames.slice(0, MAX_RUM_FRAMES_RESOLVED)
      .map((frame: StackFrame): MinifiedStackFrame => {
        return {
          functionName: frame.functionName || "",
          fileName: frame.fileName || "",
          lineNumber: frame.lineNumber || 0,
          ...(frame.columnNumber !== undefined
            ? { columnNumber: frame.columnNumber }
            : {}),
          inApp: frame.inApp !== false,
        };
      });
  } catch {
    return [];
  }
}

/*
 * The frames a stack's source maps resolved to the application's own
 * original files - a dependency's (node_modules) and an unresolved
 * minified bundle's left out - as a place keeps them.
 */
export function toOwnResolvedFrames(
  frames: ReadonlyArray<ResolvedStackFrame>,
): Array<TelemetryLeakFrame> {
  const own: Array<TelemetryLeakFrame> = [];

  for (const frame of frames) {
    const filePath: string = frame.resolved
      ? SourceMapResolver.cleanSourcePath(frame.originalFileName || "")
      : "";

    if (
      !filePath ||
      frame.inApp === false ||
      filePath.includes("node_modules/")
    ) {
      continue;
    }

    const functionName: string = (
      frame.originalFunctionName ||
      frame.functionName ||
      ""
    ).slice(0, MAX_TELEMETRY_LEAK_NAME_LENGTH);

    own.push({
      filePath: filePath.slice(0, MAX_TELEMETRY_LEAK_PATH_LENGTH),
      ...(functionName && functionName !== "<anonymous>"
        ? { functionName }
        : {}),
      ...(frame.originalLineNumber
        ? { lineNumber: frame.originalLineNumber }
        : {}),
    });

    if (own.length >= MAX_TELEMETRY_LEAK_FRAMES) {
      break;
    }
  }

  return own;
}

// Resolves a release's minified frames through its uploaded source maps.
export type RumFrameResolver = (data: {
  serviceVersion: string;
  frames: Array<MinifiedStackFrame>;
}) => Promise<Array<ResolvedStackFrame>>;

/*
 * A RUM application's records' JavaScript stacks, resolved through its
 * builds' source maps to its original files (#10933): at most
 * MAX_RUM_STACKS_RESOLVED records, each stack once, each by the release
 * the record names. What resolved goes on the row as readResolvedFrames,
 * which TelemetryLeakPlaces reads; the stack's own text is dropped here.
 * A stack that does not resolve - no maps for the release, or a map that
 * does not hold it - names no file.
 */
export async function resolveRumStacks(data: {
  rows: Array<JSONObject>;
  resolve: RumFrameResolver;
}): Promise<void> {
  const resolved: Map<string, Array<TelemetryLeakFrame>> = new Map();
  let stacksResolved: number = 0;

  for (const row of data.rows) {
    const stackTrace: string =
      typeof row["readStackTrace"] === "string" ? row["readStackTrace"] : "";
    const serviceVersion: string =
      typeof row["readServiceVersion"] === "string"
        ? row["readServiceVersion"].trim()
        : "";

    delete row["readStackTrace"];

    if (!stackTrace || !serviceVersion) {
      continue;
    }

    const key: string = `${serviceVersion}\u0000${stackTrace}`;
    let frames: Array<TelemetryLeakFrame> | undefined = resolved.get(key);

    if (!frames) {
      if (stacksResolved >= MAX_RUM_STACKS_RESOLVED) {
        continue;
      }

      stacksResolved++;

      const minified: Array<MinifiedStackFrame> =
        readMinifiedFrames(stackTrace);

      try {
        frames =
          minified.length > 0
            ? toOwnResolvedFrames(
                await data.resolve({ serviceVersion, frames: minified }),
              )
            : [];
      } catch {
        // Maps that could not be read resolve nothing: the stack names no file.
        frames = [];
      }

      resolved.set(key, frames);
    }

    if (frames.length > 0) {
      row["readResolvedFrames"] = frames as unknown as JSONArray;
    }
  }
}

/*
 * The page - or request - a RUM record was written on, as a place keeps
 * it: the path the URL scrubber keeps of it, then as a template, so no
 * value stays in it. Empty when the record names none, or the scrubber
 * keeps nothing of it.
 */
export function readRumPage(
  row: JSONObject,
  templateOf: (text: string) => string,
): string {
  const readPath: string = readCell(row["readUrlPath"]).trim();
  const named: string = firstText(row, RUM_URL_ALIASES);
  // Only a page's path or address: anything else a record put there names no page.
  const path: string = readPath.startsWith("/") ? readPath : "";
  const scheme: string = named.slice(0, 8).toLowerCase();
  const url: string =
    scheme.startsWith("https://") || scheme.startsWith("http://") ? named : "";
  let page: string = "";

  try {
    page = path
      ? UrlScrubber.getScrubbedPage(`https://page.invalid${path}`)
      : url
        ? UrlScrubber.getScrubbedPage(url)
        : "";
  } catch {
    page = "";
  }

  if (!page || page === REDACTED_PAGE) {
    return "";
  }

  return templateOf(page).slice(0, MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH);
}

/*
 * A RUM record's own frames, as the locator resolved them through the
 * application's source maps (readResolvedFrames): the original files, a
 * dependency's left out. None when it held no stack, or none resolved.
 */
export function readResolvedFrames(row: JSONObject): Array<TelemetryLeakFrame> {
  return readTelemetryLeakList(
    row["readResolvedFrames"],
    (value: unknown): TelemetryLeakFrame | null => {
      const frame: TelemetryLeakFrame | null = readTelemetryLeakFrame(value);
      const filePath: string = frame ? toLeakFilePath(frame.filePath) : "";

      return frame && filePath ? { ...frame, filePath } : null;
    },
    MAX_TELEMETRY_LEAK_FRAMES,
  );
}

// A RUM record's place in its front-end code: its own frames first, then its code attributes.
function readRumCodeLocation(row: JSONObject): Partial<TelemetryLeakPlace> {
  const frames: Array<TelemetryLeakFrame> = readResolvedFrames(row);
  const top: TelemetryLeakFrame | undefined = frames[0];

  return {
    ...readCodeLocation(row),
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
  };
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
    // A RUM application's browser log or span (#10933).
    case TelemetrySampleSource.RumLogs:
    case TelemetrySampleSource.RumSpans: {
      const page: string = readRumPage(row, data.templateOf);
      const text: string =
        data.source === TelemetrySampleSource.RumLogs
          ? data.templateOf(readCell(row["readBody"]))
          : "";
      const spanName: string =
        data.source === TelemetrySampleSource.RumSpans
          ? data.templateOf(readCell(row["readName"]))
          : "";

      place = {
        ...place,
        ...readRumCodeLocation(row),
        ...(text ? { template: text } : {}),
        ...(spanName ? { spanName } : {}),
        ...(page ? { page } : {}),
      };
      break;
    }
    /*
     * A session's: the page it started on, and for its user details (its
     * label and traits) the recorder call that gave them. A session's own
     * attributes are the host page's, not identify()'s: their key names them.
     */
    case TelemetrySampleSource.RumSessions: {
      const page: string = readRumPage(row, data.templateOf);
      const isUserDetail: boolean = data.location.startsWith(
        RUM_USER_DETAILS_PREFIX,
      );

      place = {
        ...place,
        ...(isUserDetail ? { recorderCall: RUM_IDENTIFY_CALL } : {}),
        ...(page ? { page } : {}),
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
 * A place with its texts as the records prove them (maskUnprovenWords): a
 * text with no word of the code's left is no part of it.
 */
function withProvenWords(
  place: TelemetryLeakPlace,
  proven: {
    template: string | undefined;
    spanName: string | undefined;
    page: string | undefined;
    metricName: string | undefined;
  },
): TelemetryLeakPlace {
  const kept: TelemetryLeakPlace = { ...place };

  for (const field of ["template", "spanName", "page", "metricName"] as const) {
    const text: string | undefined = proven[field];

    if (text) {
      kept[field] = text;
    } else {
      delete kept[field];
    }
  }

  return kept;
}

/*
 * The places a leak's records name, each once - counted by how many of
 * its records named it, the most named first - with the templates of one
 * place read from several records aligned, so a word that differs between
 * them is masked as the value it is, and every word no record proves is
 * the code's masked (#11098). At most MAX_PLACES_PER_TELEMETRY_LEAK.
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
  // The lines read with different words: what their reads share is proven the code's.
  const alignedLines: Set<string> = new Set();

  for (const [line, templates] of byLine) {
    aligned.set(line, alignTelemetryLeakTemplates(templates));

    if (new Set(templates).size >= 2) {
      alignedLines.add(line);
    }
  }

  const merged: Map<string, TelemetryLeakPlace> = new Map();

  for (const place of read) {
    const line: string =
      place.filePath && place.lineNumber !== undefined
        ? `${place.filePath}:${place.lineNumber}`
        : "";
    /*
     * Every word the records do not prove is the code's, masked (#11098):
     * a line read once - or always alike - keeps only the words code
     * writes log lines with; a span's name, a page and a metric's name are
     * never aligned, so they are read so too.
     */
    const kept: TelemetryLeakPlace = withProvenWords(place, {
      template: place.template
        ? maskUnprovenWords(
            aligned.get(line)?.get(place.template) || place.template,
            { isAligned: alignedLines.has(line) },
          )
        : undefined,
      spanName: place.spanName
        ? maskUnprovenWords(place.spanName, { isAligned: false })
        : undefined,
      page: place.page
        ? maskUnprovenWords(place.page, { isAligned: false })
        : undefined,
      metricName: place.metricName
        ? maskUnprovenNameParts(place.metricName)
        : undefined,
    });
    const key: string | null = getTelemetryLeakPlaceKey(kept);

    // A place named by nothing but words no record proves names none.
    if (key === null) {
      continue;
    }

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
