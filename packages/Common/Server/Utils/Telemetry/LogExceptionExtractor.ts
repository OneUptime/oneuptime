import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  looksLikeStackTrace,
  readAfterGoPanic,
  readAfterJavaThreadPrefix,
  readQualifiedTypeLine,
} from "./LogExceptionText";
import StackTraceParser, { ParsedStackTrace } from "./StackTraceParser";
import {
  ANR_EXCEPTION_MESSAGE,
  ANR_EXCEPTION_TYPE,
  HANG_EXCEPTION_MESSAGE,
  HANG_EXCEPTION_TYPE,
  MobileAppFaultKind,
  getMobileAppFaultEventName,
  getMobileAppFaultKind,
  isMetricKitFaultEventName,
} from "../../../Utils/Telemetry/MobileAppFaults";
import { toReadableMetricKitStackTrace } from "../../../Utils/Telemetry/MetricKitCallStack";

/**
 * Result of detecting an exception inside a single log record. Shaped to feed
 * the same ExceptionInstance (ClickHouse) + TelemetryException (Postgres)
 * sinks the trace span-event path uses, so log-derived and span-derived
 * exceptions group under one fingerprint when identical.
 */
export interface ExtractedLogException {
  message: string;
  exceptionType: string;
  stackTrace: string;
  parsedFrames: string; // JSON.stringify(StackFrame[]) or "[]"
  /*
   * Path A may carry exception.escaped; Path B => null (unknown). A mobile
   * app's crash, ANR or hang (MobileAppFaults) => true unless the record
   * says.
   */
  escaped: boolean | null;
}

export interface LogExceptionExtractorInput {
  body: string; // post-scrub log body
  attributes: JSONObject; // post-scrub merged log attributes
  severityNumber: number;
  /**
   * True when the log carries BOTH a traceId and a spanId — i.e. it was
   * emitted inside an instrumented span. The span-exception path is the
   * canonical source for those, so Path B (body scan) is suppressed to avoid
   * double-counting (which would also inflate occuranceCount and the windowed
   * exception monitor). Path A (explicit exception.* attributes) is NOT
   * suppressed — those are an intentional structured exception record.
   */
  hasTraceAndSpan: boolean;
}

/**
 * OTel log severityNumber >= 17 is ERROR (17-20) or FATAL (21-24). Path B only
 * scans those — the overwhelming majority of logs are below this and never
 * reach the parser.
 */
const MIN_ERROR_SEVERITY_NUMBER: number = 17;
const MAX_FATAL_SEVERITY_NUMBER: number = 24;

/*
 * A positive range check, so anything that is not an ERROR/FATAL integer
 * fails closed. The gate used to be `severityNumber < 17 -> skip`, and
 * `NaN < 17` is false: a NaN severity — what OtelLogsIngestService produced
 * for every OTLP severity name it did not map, e.g. SEVERITY_NUMBER_WARN2
 * (GH#3978) — was body-scanned as if it were an error.
 */
function isErrorOrFatalSeverity(severityNumber: unknown): boolean {
  return (
    typeof severityNumber === "number" &&
    Number.isInteger(severityNumber) &&
    severityNumber >= MIN_ERROR_SEVERITY_NUMBER &&
    severityNumber <= MAX_FATAL_SEVERITY_NUMBER
  );
}

/**
 * Only the first 16 KB of a body is parsed. A clean single-record stack trace
 * fits comfortably (~150 frames); the top frames are the most diagnostic and
 * are at the front. Guards against pathological multi-megabyte error logs on
 * the hot path.
 */
const MAX_PARSE_BODY_LENGTH: number = 16 * 1024;

/*
 * Raw log bodies are unbounded (unlike SDK-bounded span exception.stacktrace),
 * so clamp what we store into the ZSTD stackTrace column and the Postgres summary.
 */
const MAX_STORED_STACK_TRACE_LENGTH: number = 64 * 1024;
const MAX_MESSAGE_LENGTH: number = 1024;

/*
 * Whether a body plausibly contains a stack trace (looksLikeStackTrace, in
 * LogExceptionText) is asked once before the (more expensive) multi-language
 * parser. It covers: Python traceback header, JS/Java `at file:line`, Go
 * panic/goroutine, Python `File "...", line N`, a Firefox/Safari
 * `fn@url:line:col` frame, and a typed `SomethingException`/`SomethingError`.
 *
 * The `fn@url:line` signature mirrors the shape StackTraceParser's browser
 * parser accepts and must stay in step with it. Without it a SpiderMonkey or
 * JavaScriptCore stack reaches this gate with no `at ` frame and — unless the
 * app happened to log a `*Error`/`*Exception` token above it — is rejected
 * here, before the parser ever runs.
 *
 * The body is whatever an application logged, so every reader of it - the
 * signature and the first line's type and message - reads it a fixed number
 * of times (LogExceptionText).
 */

// Header parsers for deriving exceptionType + message from a raw body.
const PYTHON_TRACEBACK_HEADER: RegExp = /^Traceback \(most recent call last\):/;
/*
 * Leading identifier is optional so a bare "Error: msg" / "Exception: msg"
 * (common in Node.js) matches as well as "TypeError" / "java.lang.IOException".
 */
const TYPED_ERROR: RegExp =
  /^((?:[A-Za-z_][\w.$]*)?(?:Error|Exception|Warning|Fault))(?::\s*([\s\S]*))?$/;

export default class LogExceptionExtractor {
  /**
   * Detect an exception in a single log record. Returns null when none is
   * found. Never throws — extraction must never fail log ingest.
   */
  public static extractFromLogRecord(
    input: LogExceptionExtractorInput,
  ): ExtractedLogException | null {
    try {
      // A mobile app's crash, ANR or hang, unhandled whatever it says.
      const fault: MobileAppFaultKind | null = getMobileAppFaultKind(
        input.attributes,
      );
      // An iOS app's MetricKit diagnostic, whose stack is JSON.
      const isMetricKit: boolean = isMetricKitFaultEventName(
        getMobileAppFaultEventName(input.attributes),
      );

      /*
       * Path A — explicit OTel exception.* attributes. Always on, cheapest,
       * highest-signal (the app explicitly recorded an exception on the log).
       */
      const fromAttributes: ExtractedLogException | null =
        LogExceptionExtractor.extractFromAttributes(
          input.attributes,
          fault,
          isMetricKit,
        );
      if (fromAttributes) {
        return fromAttributes;
      }

      /*
       * A crash, an ANR or a hang is an exception whatever its record
       * carries: one with no exception.* attribute is read from its body,
       * at any severity (the SDK may set none), and an ANR or a hang counts
       * even with no stack trace at all.
       */
      if (fault) {
        return LogExceptionExtractor.extractMobileAppFaultFromBody(
          input.body,
          fault,
        );
      }

      // Path B — raw body scan. Gated to keep the hot path cheap.
      if (!isErrorOrFatalSeverity(input.severityNumber)) {
        return null;
      }
      if (input.hasTraceAndSpan) {
        return null;
      }
      return LogExceptionExtractor.extractFromBody(input.body);
    } catch {
      return null;
    }
  }

  private static extractFromAttributes(
    attributes: JSONObject,
    fault: MobileAppFaultKind | null,
    isMetricKit: boolean = false,
  ): ExtractedLogException | null {
    if (!attributes) {
      return null;
    }

    let stackTrace: string = asString(attributes["exception.stacktrace"]);
    let exceptionType: string = asString(attributes["exception.type"]);
    let message: string = asString(attributes["exception.message"]);

    if (!stackTrace && !exceptionType && !message) {
      return null;
    }

    /*
     * An ANR, and an iOS hang, carry the main thread's stack and nothing
     * else: name each, so it reads as what it is in Exceptions rather than
     * as a row with no type and no message. A type or message the SDK did
     * send wins.
     */
    if (fault === MobileAppFaultKind.Anr) {
      exceptionType = exceptionType || ANR_EXCEPTION_TYPE;
      message = message || ANR_EXCEPTION_MESSAGE;
    }

    if (fault === MobileAppFaultKind.Hang) {
      exceptionType = exceptionType || HANG_EXCEPTION_TYPE;
      message = message || HANG_EXCEPTION_MESSAGE;
    }

    /*
     * A MetricKit crash's or hang's stack is Apple's call stack tree as
     * JSON: drawn as the threads of a crash report instead, the one it is
     * about first (MetricKitCallStack). A stack that is not such a tree is
     * kept as sent.
     */
    if (isMetricKit && stackTrace && fault) {
      stackTrace =
        toReadableMetricKitStackTrace(
          stackTrace,
          fault === MobileAppFaultKind.Crash ? "crash" : "hang",
        ) || stackTrace;
    }

    const clampedStack: string = clamp(
      stackTrace,
      MAX_STORED_STACK_TRACE_LENGTH,
    );

    let parsedFrames: string = "[]";
    if (clampedStack) {
      try {
        const parsed: ParsedStackTrace = StackTraceParser.parse(clampedStack);
        parsedFrames = JSON.stringify(parsed.frames);
      } catch {
        parsedFrames = "[]";
      }
    }

    return {
      message: clamp(message, MAX_MESSAGE_LENGTH),
      exceptionType: exceptionType,
      stackTrace: clampedStack,
      parsedFrames: parsedFrames,
      escaped: escapedFor(
        toNullableBoolean(attributes["exception.escaped"]),
        fault,
      ),
    };
  }

  /*
   * A crash, an ANR or a hang whose record holds no exception.* attribute:
   * its body's stack trace when it has one. A crash with nothing to read is
   * no exception - nothing says what was thrown - while an ANR or a hang
   * still counts, as one with no stack, because that it happened is the
   * fact.
   */
  private static extractMobileAppFaultFromBody(
    body: string,
    fault: MobileAppFaultKind,
  ): ExtractedLogException | null {
    const fromBody: ExtractedLogException | null =
      LogExceptionExtractor.extractFromBody(body);

    if (fault === MobileAppFaultKind.Anr || fault === MobileAppFaultKind.Hang) {
      const isHang: boolean = fault === MobileAppFaultKind.Hang;

      return {
        message: isHang ? HANG_EXCEPTION_MESSAGE : ANR_EXCEPTION_MESSAGE,
        exceptionType: isHang ? HANG_EXCEPTION_TYPE : ANR_EXCEPTION_TYPE,
        stackTrace: fromBody?.stackTrace || "",
        parsedFrames: fromBody?.parsedFrames || "[]",
        escaped: true,
      };
    }

    if (!fromBody) {
      return null;
    }

    return { ...fromBody, escaped: true };
  }

  /**
   * Whether a log body holds a stack trace as the body scan reads one: the
   * signature, then at least one parsed frame - the same test that makes a
   * line an exception here, so a reader elsewhere (the Logs product's AI
   * section, Utils/Logs/LogInsight) tells an exception from a plain error
   * message exactly as ingest does. Never throws.
   */
  public static bodyHoldsStackTrace(body: string): boolean {
    try {
      return LogExceptionExtractor.extractFromBody(body) !== null;
    } catch {
      return false;
    }
  }

  private static extractFromBody(body: string): ExtractedLogException | null {
    if (!body) {
      return null;
    }

    const sliced: string =
      body.length > MAX_PARSE_BODY_LENGTH
        ? body.slice(0, MAX_PARSE_BODY_LENGTH)
        : body;

    if (!looksLikeStackTrace(sliced)) {
      return null;
    }

    const parsed: ParsedStackTrace = StackTraceParser.parse(sliced);

    /*
     * Require at least one parsed frame. A signature match with zero frames is
     * usually prose that merely mentions "...Error:" / "...Exception" — not an
     * actual stack trace. Path A is the path allowed to emit without frames.
     */
    if (!parsed.frames || parsed.frames.length === 0) {
      return null;
    }

    const header: { exceptionType: string; message: string } =
      LogExceptionExtractor.parseHeader(sliced);

    return {
      message: clamp(header.message, MAX_MESSAGE_LENGTH),
      exceptionType: header.exceptionType,
      stackTrace: clamp(sliced, MAX_STORED_STACK_TRACE_LENGTH),
      parsedFrames: JSON.stringify(parsed.frames),
      escaped: null,
    };
  }

  /**
   * Best-effort derivation of exceptionType + message from a raw stack-trace
   * body. A stable, clean exceptionType improves grouping and exception-monitor
   * targeting, but a miss is harmless — the fingerprint also uses the message
   * and the normalized stack trace.
   */
  private static parseHeader(body: string): {
    exceptionType: string;
    message: string;
  } {
    const lines: Array<string> = body
      .split("\n")
      .map((l: string) => {
        return l.trim();
      })
      .filter((l: string) => {
        return l.length > 0;
      });

    if (lines.length === 0) {
      return { exceptionType: "", message: "" };
    }

    /*
     * Python: header is "Traceback (most recent call last):"; the "Type: message"
     * line is at the BOTTOM of the traceback, so scan upward for it.
     */
    if (PYTHON_TRACEBACK_HEADER.test(lines[0]!)) {
      for (let i: number = lines.length - 1; i >= 0; i--) {
        const candidate: RegExpMatchArray | null = lines[i]!.match(TYPED_ERROR);
        if (candidate) {
          return {
            exceptionType: candidate[1] || "",
            message: (candidate[2] || "").trim(),
          };
        }
      }
      // Truncated traceback with no type line — keep the last line as message.
      return { exceptionType: "", message: lines[lines.length - 1]! };
    }

    // Strip Java's "Exception in thread "name"" prefix if present.
    let firstLine: string = lines[0]!;
    const afterThreadPrefix: string | null =
      readAfterJavaThreadPrefix(firstLine);
    if (afterThreadPrefix !== null) {
      firstLine = afterThreadPrefix.trim();
    }

    const afterPanic: string | null = readAfterGoPanic(firstLine);
    if (afterPanic !== null) {
      return { exceptionType: "panic", message: afterPanic.trim() };
    }

    // "TypeError: msg", "java.lang.NullPointerException: msg", "...Exception"
    const typedMatch: RegExpMatchArray | null = firstLine.match(TYPED_ERROR);
    if (typedMatch) {
      return {
        exceptionType: typedMatch[1] || "",
        message: (typedMatch[2] || "").trim(),
      };
    }

    // Generic qualified "pkg.Sub.Type: msg"
    const qualified: { type: string; message: string } | null =
      readQualifiedTypeLine(firstLine);
    if (qualified) {
      return {
        exceptionType: qualified.type,
        message: qualified.message.trim(),
      };
    }

    return { exceptionType: "", message: firstLine };
  }
}

function asString(value: JSONValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return "";
}

/*
 * Whether an occurrence escaped (was unhandled): what the record says, and
 * for a mobile app's crash, ANR or hang, which says nothing, yes.
 */
function escapedFor(
  stated: boolean | null,
  fault: MobileAppFaultKind | null,
): boolean | null {
  if (stated !== null) {
    return stated;
  }

  return fault ? true : null;
}

function toNullableBoolean(value: JSONValue | undefined): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized: string = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
}

function clamp(value: string, max: number): string {
  if (value && value.length > max) {
    return value.slice(0, max);
  }
  return value;
}
