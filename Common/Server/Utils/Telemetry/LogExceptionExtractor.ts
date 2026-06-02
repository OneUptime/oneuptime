import { JSONObject, JSONValue } from "../../../Types/JSON";
import StackTraceParser, { ParsedStackTrace } from "./StackTraceParser";

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
  escaped: boolean | null; // Path A may carry exception.escaped; Path B => null (unknown)
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

/**
 * Single pre-compiled signature for "this body plausibly contains a stack
 * trace". Evaluated once before the (more expensive) multi-language parser.
 * Covers: Python traceback header, JS/Java `at file:line`, Go panic/goroutine,
 * Python `File "...", line N`, and a typed `SomethingException`/`SomethingError`.
 */
const LOOKS_LIKE_STACK_TRACE: RegExp =
  /(?:Traceback \(most recent call last\)|\n\s+at\s+.+:\d+|\bpanic:\s|goroutine\s+\d+\s+\[|\n\s*File\s+"[^"]+",\s+line\s+\d+|\b[A-Za-z_][\w.$]*(?:Exception|Error)\b)/;

// Header parsers for deriving exceptionType + message from a raw body.
const PYTHON_TRACEBACK_HEADER: RegExp = /^Traceback \(most recent call last\):/;
const JAVA_THREAD_PREFIX: RegExp = /^Exception in thread\s+"[^"]*"\s+(.*)$/;
const GO_PANIC: RegExp = /^panic:\s*(.*)$/;
/*
 * Leading identifier is optional so a bare "Error: msg" / "Exception: msg"
 * (common in Node.js) matches as well as "TypeError" / "java.lang.IOException".
 */
const TYPED_ERROR: RegExp =
  /^((?:[A-Za-z_][\w.$]*)?(?:Error|Exception|Warning|Fault))(?::\s*([\s\S]*))?$/;
const QUALIFIED_TYPE: RegExp = /^([A-Za-z_][\w.$]*\.[A-Za-z_][\w.$]*):\s*(.*)$/;

export default class LogExceptionExtractor {
  /**
   * Detect an exception in a single log record. Returns null when none is
   * found. Never throws — extraction must never fail log ingest.
   */
  public static extractFromLogRecord(
    input: LogExceptionExtractorInput,
  ): ExtractedLogException | null {
    try {
      /*
       * Path A — explicit OTel exception.* attributes. Always on, cheapest,
       * highest-signal (the app explicitly recorded an exception on the log).
       */
      const fromAttributes: ExtractedLogException | null =
        LogExceptionExtractor.extractFromAttributes(input.attributes);
      if (fromAttributes) {
        return fromAttributes;
      }

      // Path B — raw body scan. Gated to keep the hot path cheap.
      if (input.severityNumber < MIN_ERROR_SEVERITY_NUMBER) {
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
  ): ExtractedLogException | null {
    if (!attributes) {
      return null;
    }

    const stackTrace: string = asString(attributes["exception.stacktrace"]);
    const exceptionType: string = asString(attributes["exception.type"]);
    const message: string = asString(attributes["exception.message"]);

    if (!stackTrace && !exceptionType && !message) {
      return null;
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
      escaped: toNullableBoolean(attributes["exception.escaped"]),
    };
  }

  private static extractFromBody(body: string): ExtractedLogException | null {
    if (!body) {
      return null;
    }

    const sliced: string =
      body.length > MAX_PARSE_BODY_LENGTH
        ? body.slice(0, MAX_PARSE_BODY_LENGTH)
        : body;

    if (!LOOKS_LIKE_STACK_TRACE.test(sliced)) {
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
    const threadMatch: RegExpMatchArray | null =
      firstLine.match(JAVA_THREAD_PREFIX);
    if (threadMatch) {
      firstLine = threadMatch[1]!.trim();
    }

    const goMatch: RegExpMatchArray | null = firstLine.match(GO_PANIC);
    if (goMatch) {
      return { exceptionType: "panic", message: (goMatch[1] || "").trim() };
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
    const qualifiedMatch: RegExpMatchArray | null =
      firstLine.match(QUALIFIED_TYPE);
    if (qualifiedMatch) {
      return {
        exceptionType: qualifiedMatch[1] || "",
        message: (qualifiedMatch[2] || "").trim(),
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
