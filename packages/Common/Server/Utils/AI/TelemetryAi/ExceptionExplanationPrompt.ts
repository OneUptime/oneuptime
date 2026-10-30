import Dictionary from "../../../../Types/Dictionary";
import {
  EXCEPTION_AI_EXPLANATION_VERSION,
  ExceptionAIExplanation,
  ExceptionExplanationFrame,
  readExceptionAIExplanation,
} from "../../../../Types/Telemetry/ExceptionAIExplanation";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Telemetry/StackTraceParser";
import {
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../../Telemetry/ExceptionSanitizer";

/*
 * WHAT ONEUPTIME AI IS TOLD ABOUT AN EXCEPTION, AND HOW ITS ANSWER IS READ.
 *
 * The pure half of ExceptionExplainer (ExceptionExplanation.ts): no database
 * and no model, so the prompt and the parser can be read in a test, and run
 * on megabytes in a process that compiles regular expressions unoptimized.
 *
 * Every value is cut to a fixed length FIRST - a message, a stack trace or a
 * log body can be megabytes on one line, and the sanitizers run regular
 * expressions over what they are given (AGENTS.md, "Megabyte-long values") -
 * then IDs, emails, IPs, tokens and secrets are taken out
 * (ExceptionSanitizer). The model's answer is found with indexOf, never a
 * regular expression over it, and every field is checked and bounded
 * (readExceptionAIExplanation); a suspect frame is kept only when the stack
 * trace holds its file.
 */

// How much of each value reaches the model, cut before anything else reads it.
export const MAX_PROMPT_MESSAGE_LENGTH: number = 2000;
export const MAX_PROMPT_STACK_TRACE_LENGTH: number = 6000;
export const MAX_PROMPT_LOG_LENGTH: number = 400;
export const MAX_PROMPT_SPAN_NAME_LENGTH: number = 200;
export const MAX_PROMPT_TITLE_LENGTH: number = 200;
export const MAX_PROMPT_SPANS: number = 40;
export const MAX_PROMPT_LOGS: number = 25;
export const MAX_PROMPT_CHANGES: number = 10;
export const MAX_PROMPT_IN_APP_FRAMES: number = 10;
// The most of a model's answer that is read: a fair answer is a few KB.
export const MAX_RESPONSE_LENGTH: number = 64 * 1024;

/*
 * The span attributes that say what a request was doing without carrying
 * who made it: its route and method, the status it answered, the database
 * or queue it used. Nothing else from a span's attributes is sent.
 */
export const EXPLANATION_SPAN_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "http.route",
  "http.method",
  "http.request.method",
  "http.status_code",
  "http.response.status_code",
  "rpc.system",
  "rpc.method",
  "db.system",
  "db.operation",
  "db.operation.name",
  "messaging.system",
  "messaging.operation",
  "exception.code",
  "error.type",
];

export const EXCEPTION_EXPLANATION_SYSTEM_PROMPT: string = `You are OneUptime AI, explaining one application exception to the engineer who will fix it.

You are given the exception (its type, message and stack trace, with the frames of the application's own code listed separately), when it was first and last seen and in which releases, the trace its latest occurrence happened in, the logs written in that trace, and the deploys around the time it started. Values were scrubbed: placeholders such as <UUID>, <EMAIL> or <NUMBER> stand for the real values.

Answer with ONE JSON object and nothing else, with exactly these fields:
{
  "summary": "One or two plain sentences: what went wrong, for whom, and since when if the data says.",
  "rootCause": "Markdown, at most 120 words: the most likely root cause, citing the frame, span, log line or deploy that shows it. Say plainly when the evidence is thin.",
  "suggestedFix": "Markdown, at most 150 words: what to change, concretely. A short code snippet is welcome when the stack trace shows the code.",
  "confidence": "high" | "medium" | "low",
  "category": "code" | "dependency" | "infrastructure" | "user-input" | "configuration" | "unknown",
  "suspectFrames": [{"file": "path as written in the stack trace", "line": 42, "function": "name"}],
  "nextSteps": ["At most three short steps to confirm or fix it."]
}

Rules:
- suspectFrames: at most 3, copied from the stack trace, the application's own frames first. Never invent a file.
- Do not guess values that were scrubbed.
- If a deploy shortly before the exception first appeared is the likely cause, say which.
- If the exception came back after it was resolved, say what that suggests about the earlier fix.
- Do not wrap the JSON in prose.`;

export interface ExplanationSpan {
  name: string;
  kind: string;
  statusCode?: number | undefined;
  durationMs?: number | undefined;
  isExceptionSpan: boolean;
}

export interface ExplanationLog {
  time?: Date | undefined;
  severity: string;
  body: string;
}

export interface ExplanationChange {
  time: Date;
  eventType: string;
  title: string;
  version?: string | undefined;
  commitSha?: string | undefined;
}

export interface ExplanationOccurrence {
  time?: Date | undefined;
  release?: string | undefined;
  environment?: string | undefined;
  spanName?: string | undefined;
  spanAttributes: Dictionary<string>;
}

export interface ExceptionExplanationEvidence {
  exceptionType: string;
  message: string;
  stackTrace: string;
  resourceName?: string | undefined;
  resourceType?: string | undefined;
  environment?: string | undefined;
  occurrenceCount: number;
  firstSeenAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  firstSeenInRelease?: string | undefined;
  lastSeenInRelease?: string | undefined;
  unhandled: boolean;
  errorClass?: string | undefined;
  isResolved: boolean;
  regressedAt?: Date | undefined;
  latestOccurrence?: ExplanationOccurrence | undefined;
  spans: Array<ExplanationSpan>;
  logs: Array<ExplanationLog>;
  changes: Array<ExplanationChange>;
}

// Cut first, then scrub: a value can be megabytes long.
function scrubbedText(value: string | undefined, max: number): string {
  return sanitizeExceptionMessage((value || "").slice(0, max)).trim();
}

function isoTime(value: Date | undefined): string {
  if (!value) {
    return "unknown";
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString();
}

function framesOf(stackTrace: string): Array<StackFrame> {
  try {
    const parsed: ParsedStackTrace = StackTraceParser.parse(stackTrace);
    return parsed.frames;
  } catch {
    return [];
  }
}

// The allowed span attributes only, each a short string.
export function pickExplanationSpanAttributes(
  attributes: Dictionary<unknown>,
): Dictionary<string> {
  const picked: Dictionary<string> = {};

  for (const key of EXPLANATION_SPAN_ATTRIBUTE_KEYS) {
    const value: unknown = attributes[key];

    if (typeof value === "string" || typeof value === "number") {
      picked[key] = String(value).slice(0, MAX_PROMPT_TITLE_LENGTH);
    }
  }

  return picked;
}

/*
 * The user message: the evidence, section by section, every value cut and
 * scrubbed.
 */
export function buildExceptionExplanationPrompt(
  evidence: ExceptionExplanationEvidence,
): string {
  const stackTrace: string = sanitizeStackTrace(
    (evidence.stackTrace || "").slice(0, MAX_PROMPT_STACK_TRACE_LENGTH),
  );

  const lines: Array<string> = [];

  lines.push("## Exception");
  lines.push(
    `Type: ${scrubbedText(evidence.exceptionType, MAX_PROMPT_TITLE_LENGTH) || "unknown"}`,
  );
  lines.push(
    `Message: ${scrubbedText(evidence.message, MAX_PROMPT_MESSAGE_LENGTH) || "(no message)"}`,
  );
  lines.push(
    `Where: ${scrubbedText(evidence.resourceName, MAX_PROMPT_TITLE_LENGTH) || "unknown resource"}${
      evidence.resourceType ? ` (${evidence.resourceType})` : ""
    }${
      evidence.environment
        ? `, environment ${scrubbedText(evidence.environment, MAX_PROMPT_TITLE_LENGTH)}`
        : ""
    }`,
  );
  lines.push(`Occurrences so far: ${evidence.occurrenceCount}`);
  lines.push(
    `First seen: ${isoTime(evidence.firstSeenAt)}${
      evidence.firstSeenInRelease
        ? ` in release ${scrubbedText(evidence.firstSeenInRelease, MAX_PROMPT_TITLE_LENGTH)}`
        : ""
    }`,
  );
  lines.push(
    `Last seen: ${isoTime(evidence.lastSeenAt)}${
      evidence.lastSeenInRelease
        ? ` in release ${scrubbedText(evidence.lastSeenInRelease, MAX_PROMPT_TITLE_LENGTH)}`
        : ""
    }`,
  );
  lines.push(
    `Handled by the application: ${
      evidence.unhandled
        ? "no (at least one occurrence escaped uncaught)"
        : "yes, or unknown"
    }`,
  );

  if (evidence.errorClass && evidence.errorClass !== "unknown") {
    lines.push(
      `Earlier triage classified it as: ${scrubbedText(evidence.errorClass, MAX_PROMPT_TITLE_LENGTH)}`,
    );
  }

  if (!evidence.isResolved && evidence.regressedAt) {
    lines.push(
      `It was resolved, and came back at ${isoTime(evidence.regressedAt)}: the earlier fix did not hold.`,
    );
  }

  const inAppFrames: Array<StackFrame> = framesOf(stackTrace)
    .filter((frame: StackFrame): boolean => {
      return frame.inApp;
    })
    .slice(0, MAX_PROMPT_IN_APP_FRAMES);

  lines.push("");
  lines.push("## Stack trace");
  lines.push(stackTrace || "(no stack trace was recorded)");

  if (inAppFrames.length > 0) {
    lines.push("");
    lines.push("## The application's own frames, innermost first");

    for (const frame of inAppFrames) {
      lines.push(
        `- ${frame.fileName}:${frame.lineNumber}${
          frame.functionName ? ` in ${frame.functionName}` : ""
        }`,
      );
    }
  }

  const occurrence: ExplanationOccurrence | undefined =
    evidence.latestOccurrence;

  if (occurrence) {
    lines.push("");
    lines.push("## Latest occurrence");
    lines.push(`Time: ${isoTime(occurrence.time)}`);

    if (occurrence.release) {
      lines.push(
        `Release: ${scrubbedText(occurrence.release, MAX_PROMPT_TITLE_LENGTH)}`,
      );
    }

    if (occurrence.spanName) {
      lines.push(
        `In span: ${scrubbedText(occurrence.spanName, MAX_PROMPT_SPAN_NAME_LENGTH)}`,
      );
    }

    for (const key of EXPLANATION_SPAN_ATTRIBUTE_KEYS) {
      const value: string | undefined = occurrence.spanAttributes[key];

      if (value) {
        lines.push(`${key}: ${scrubbedText(value, MAX_PROMPT_TITLE_LENGTH)}`);
      }
    }
  }

  if (evidence.spans.length > 0) {
    lines.push("");
    lines.push("## The trace of the latest occurrence, in order");

    for (const span of evidence.spans.slice(0, MAX_PROMPT_SPANS)) {
      const status: string =
        span.statusCode === 2
          ? "error"
          : span.statusCode === 1
            ? "ok"
            : "unset";
      const duration: string =
        span.durationMs !== undefined && Number.isFinite(span.durationMs)
          ? `, ${Math.round(span.durationMs)} ms`
          : "";

      lines.push(
        `- ${scrubbedText(span.name, MAX_PROMPT_SPAN_NAME_LENGTH) || "(unnamed)"} (${
          span.kind || "span"
        }, ${status}${duration})${
          span.isExceptionSpan ? " <- the exception was recorded here" : ""
        }`,
      );
    }
  }

  if (evidence.logs.length > 0) {
    lines.push("");
    lines.push("## Logs written in that trace");

    for (const log of evidence.logs.slice(0, MAX_PROMPT_LOGS)) {
      lines.push(
        `- ${isoTime(log.time)} ${log.severity || "Unspecified"}: ${scrubbedText(
          log.body,
          MAX_PROMPT_LOG_LENGTH,
        )}`,
      );
    }
  }

  if (evidence.changes.length > 0) {
    lines.push("");
    lines.push("## Deploys and changes around the time it started");

    for (const change of evidence.changes.slice(0, MAX_PROMPT_CHANGES)) {
      lines.push(
        `- ${isoTime(change.time)} ${change.eventType || "change"}: ${
          scrubbedText(change.title, MAX_PROMPT_TITLE_LENGTH) || "(untitled)"
        }${
          change.version
            ? `, version ${scrubbedText(change.version, MAX_PROMPT_TITLE_LENGTH)}`
            : ""
        }${change.commitSha ? `, commit ${change.commitSha.slice(0, 12)}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

/*
 * The JSON object in a model's answer: the whole answer, the inside of a
 * fenced block, or the outermost braces. Found with indexOf, never a regular
 * expression over the answer.
 */
function extractJsonObject(content: string): unknown {
  const text: string = content.slice(0, MAX_RESPONSE_LENGTH).trim();
  const candidates: Array<string> = [text];

  const fenceStart: number = text.indexOf("```");

  if (fenceStart !== -1) {
    const bodyStart: number = text.indexOf("\n", fenceStart);
    const fenceEnd: number =
      bodyStart === -1 ? -1 : text.indexOf("```", bodyStart);

    if (bodyStart !== -1 && fenceEnd !== -1) {
      candidates.push(text.slice(bodyStart + 1, fenceEnd));
    }
  }

  const open: number = text.indexOf("{");
  const close: number = text.lastIndexOf("}");

  if (open !== -1 && close > open) {
    candidates.push(text.slice(open, close + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // The next candidate.
    }
  }

  return null;
}

/*
 * The explanation a model's answer holds, every field checked and bounded,
 * or null when it holds none. A suspect frame is kept only when the stack
 * trace holds its file, so a frame the model made up is never shown as one
 * of the exception's own.
 */
export function parseExceptionExplanationResponse(
  content: string,
  stackTrace: string,
): ExceptionAIExplanation | null {
  const explanation: ExceptionAIExplanation | null = readExceptionAIExplanation(
    extractJsonObject(content || ""),
  );

  if (!explanation) {
    return null;
  }

  return {
    ...explanation,
    version: EXCEPTION_AI_EXPLANATION_VERSION,
    suspectFrames: explanation.suspectFrames.filter(
      (frame: ExceptionExplanationFrame): boolean => {
        return Boolean(stackTrace) && stackTrace.includes(frame.file);
      },
    ),
  };
}
