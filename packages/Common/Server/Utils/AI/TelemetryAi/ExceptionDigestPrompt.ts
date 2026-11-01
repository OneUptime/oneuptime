import {
  boundedDigestText,
  EXCEPTION_AI_DIGEST_VERSION,
  EXCEPTION_DIGEST_WINDOW_HOURS,
  ExceptionAIDigest,
  ExceptionDigestItem,
  ExceptionDigestKind,
  MAX_DIGEST_EXCEPTION_TYPE_LENGTH,
  MAX_DIGEST_EXCEPTIONS,
  MAX_DIGEST_HEADLINE_LENGTH,
  MAX_DIGEST_ITEM_SUMMARY_LENGTH,
  readDigestPriority,
  sortDigestItems,
} from "../../../../Types/Telemetry/ExceptionAIDigest";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Telemetry/StackTraceParser";
import { sanitizeExceptionMessage } from "../../Telemetry/ExceptionSanitizer";
import { extractJsonObject } from "./ExceptionExplanationPrompt";

/*
 * WHAT ONEUPTIME AI IS TOLD ABOUT A DAY'S NEW AND REGRESSED EXCEPTIONS, AND
 * HOW ITS ANSWER IS READ.
 *
 * The pure half of ExceptionDigester (ExceptionDigest.ts): no database and
 * no model. Each exception is named in the prompt by a short reference (E1,
 * E2, ...), never by its id, and the answer is mapped back through those
 * references: an item about a reference the prompt did not hold is dropped,
 * so the model cannot point the digest at an exception that is not one of
 * them. Every value is cut to a fixed length FIRST, then scrubbed
 * (ExceptionSanitizer) - a message or a stack trace can be megabytes on one
 * line (AGENTS.md, "Megabyte-long values") - and the answer is found with
 * indexOf (extractJsonObject), never a regular expression over it.
 */

export const MAX_DIGEST_PROMPT_MESSAGE_LENGTH: number = 300;
export const MAX_DIGEST_PROMPT_TITLE_LENGTH: number = 200;
// The top frame is read from this much of the stack trace.
export const MAX_DIGEST_PROMPT_STACK_TRACE_LENGTH: number = 4000;

export const EXCEPTION_DIGEST_SYSTEM_PROMPT: string = `You are OneUptime AI, summing up for the engineer on call the exceptions that are new in a project, or came back after they were resolved, in the last ${EXCEPTION_DIGEST_WINDOW_HOURS} hours.

Each exception is given with a reference (E1, E2, ...), whether it is new or regressed, its type and message, where it happened, how often, when it was first seen and in which release, and the top frame of its stack trace. Values were scrubbed: placeholders such as <UUID>, <EMAIL> or <NUMBER> stand for the real values.

Answer with ONE JSON object and nothing else, with exactly these fields:
{
  "headline": "Two or three plain sentences over all of them: what stands out, what they have in common (one service, one release, one dependency), and what to look at first.",
  "items": [{"ref": "E1", "summary": "One sentence: what it is and why it matters.", "priority": "high" | "medium" | "low"}]
}

Rules:
- One item per exception given, using its reference exactly. Never invent a reference.
- priority: high for what likely hurts users now (unhandled, frequent, a regression, a core path); low for noise.
- Do not guess values that were scrubbed.
- Do not wrap the JSON in prose.`;

export interface DigestException {
  telemetryExceptionId: string;
  kind: ExceptionDigestKind;
  exceptionType: string;
  message: string;
  stackTrace: string;
  resourceName?: string | undefined;
  environment?: string | undefined;
  occurrenceCount: number;
  firstSeenAt?: Date | undefined;
  regressedAt?: Date | undefined;
  release?: string | undefined;
  unhandled: boolean;
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

// The first frame of the application's own code, else the first frame.
function topFrame(stackTrace: string): string {
  let frames: Array<StackFrame> = [];

  try {
    const parsed: ParsedStackTrace = StackTraceParser.parse(
      stackTrace.slice(0, MAX_DIGEST_PROMPT_STACK_TRACE_LENGTH),
    );
    frames = parsed.frames;
  } catch {
    return "";
  }

  const frame: StackFrame | undefined =
    frames.find((candidate: StackFrame): boolean => {
      return candidate.inApp;
    }) || frames[0];

  if (!frame) {
    return "";
  }

  const where: string = scrubbedText(
    `${frame.fileName}${frame.lineNumber ? `:${frame.lineNumber}` : ""}`,
    MAX_DIGEST_PROMPT_TITLE_LENGTH,
  );
  const name: string = scrubbedText(
    frame.functionName,
    MAX_DIGEST_PROMPT_TITLE_LENGTH,
  );

  return name ? `${name} (${where})` : where;
}

export function digestReference(index: number): string {
  return `E${index + 1}`;
}

export function buildExceptionDigestPrompt(
  exceptions: Array<DigestException>,
): string {
  const lines: Array<string> = [];

  exceptions
    .slice(0, MAX_DIGEST_EXCEPTIONS)
    .forEach((exception: DigestException, index: number): void => {
      lines.push(
        `## ${digestReference(index)} (${
          exception.kind === ExceptionDigestKind.Regressed
            ? "regressed: resolved before, came back"
            : "new"
        })`,
      );
      lines.push(
        `Type: ${scrubbedText(exception.exceptionType, MAX_DIGEST_PROMPT_TITLE_LENGTH) || "unknown"}`,
      );
      lines.push(
        `Message: ${scrubbedText(exception.message, MAX_DIGEST_PROMPT_MESSAGE_LENGTH) || "(no message)"}`,
      );
      lines.push(
        `Where: ${scrubbedText(exception.resourceName, MAX_DIGEST_PROMPT_TITLE_LENGTH) || "unknown resource"}${
          exception.environment
            ? `, environment ${scrubbedText(exception.environment, MAX_DIGEST_PROMPT_TITLE_LENGTH)}`
            : ""
        }`,
      );
      lines.push(`Occurrences so far: ${exception.occurrenceCount}`);
      lines.push(
        exception.kind === ExceptionDigestKind.Regressed
          ? `Came back: ${isoTime(exception.regressedAt)}`
          : `First seen: ${isoTime(exception.firstSeenAt)}`,
      );

      if (exception.release) {
        lines.push(
          `Release: ${scrubbedText(exception.release, MAX_DIGEST_PROMPT_TITLE_LENGTH)}`,
        );
      }

      lines.push(
        `Handled by the application: ${exception.unhandled ? "no" : "yes, or unknown"}`,
      );

      const frame: string = topFrame(exception.stackTrace || "");

      if (frame) {
        lines.push(`Top frame: ${frame}`);
      }

      lines.push("");
    });

  return lines.join("\n").trim();
}

/*
 * The digest a model's answer holds, mapped back to the exceptions it was
 * written from, or null when it holds no headline. An item about a
 * reference the prompt did not hold, or a second item about the same one,
 * is dropped; an exception the model left out is still listed, with its
 * message as its summary, so none of them goes missing from the digest.
 */
export function parseExceptionDigestResponse(
  content: string,
  exceptions: Array<DigestException>,
): ExceptionAIDigest | null {
  const parsed: unknown = extractJsonObject(content || "");

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record: Record<string, unknown> = parsed as Record<string, unknown>;
  const headline: string = boundedDigestText(
    record["headline"],
    MAX_DIGEST_HEADLINE_LENGTH,
  );

  if (!headline) {
    return null;
  }

  const given: Array<DigestException> = exceptions.slice(
    0,
    MAX_DIGEST_EXCEPTIONS,
  );
  const byReference: Map<string, number> = new Map<string, number>();

  given.forEach((_exception: DigestException, index: number): void => {
    byReference.set(digestReference(index), index);
  });

  const items: Array<ExceptionDigestItem> = [];
  const covered: Set<number> = new Set<number>();

  for (const entry of Array.isArray(record["items"]) ? record["items"] : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const item: Record<string, unknown> = entry as Record<string, unknown>;
    const reference: unknown = item["ref"];
    const index: number | undefined =
      typeof reference === "string"
        ? byReference.get(reference.trim().toUpperCase())
        : undefined;

    if (index === undefined || covered.has(index)) {
      continue;
    }

    const summary: string = boundedDigestText(
      item["summary"],
      MAX_DIGEST_ITEM_SUMMARY_LENGTH,
    );

    if (!summary) {
      continue;
    }

    covered.add(index);
    items.push(digestItem(given[index]!, summary, item["priority"]));
  }

  given.forEach((exception: DigestException, index: number): void => {
    if (!covered.has(index)) {
      items.push(
        digestItem(
          exception,
          scrubbedText(exception.message, MAX_DIGEST_ITEM_SUMMARY_LENGTH) ||
            scrubbedText(
              exception.exceptionType,
              MAX_DIGEST_ITEM_SUMMARY_LENGTH,
            ) ||
            "(no message)",
          undefined,
        ),
      );
    }
  });

  return {
    version: EXCEPTION_AI_DIGEST_VERSION,
    headline,
    items: sortDigestItems(items),
  };
}

function digestItem(
  exception: DigestException,
  summary: string,
  priority: unknown,
): ExceptionDigestItem {
  return {
    telemetryExceptionId: exception.telemetryExceptionId,
    kind: exception.kind,
    exceptionType: scrubbedText(
      exception.exceptionType,
      MAX_DIGEST_EXCEPTION_TYPE_LENGTH,
    ),
    summary,
    priority: readDigestPriority(priority),
  };
}
