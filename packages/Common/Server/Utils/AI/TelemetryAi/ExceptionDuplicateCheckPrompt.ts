import {
  boundedSimilarText,
  DuplicateVerdict,
  DuplicateVerdictKind,
  MAX_DUPLICATE_REASON_LENGTH,
  MAX_SIMILAR_EXCEPTIONS,
} from "../../../../Types/Telemetry/SimilarExceptions";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "../../Telemetry/StackTraceParser";
import { sanitizeExceptionMessage } from "../../Telemetry/ExceptionSanitizer";
import { extractJsonObject } from "./ExceptionExplanationPrompt";

/*
 * WHAT ONEUPTIME AI IS TOLD TO DECIDE WHETHER SIMILAR EXCEPTIONS ARE THE SAME
 * BUG, AND HOW ITS ANSWER IS READ.
 *
 * The pure half of ExceptionDuplicateChecker (ExceptionDuplicateCheck.ts).
 * The exception is T and the candidates C1, C2, ...: never their ids, and an
 * answer about a reference the prompt did not hold is dropped. Every value
 * is cut first, then scrubbed (ExceptionSanitizer), and only the top frames
 * of each stack trace are sent; the answer is found with indexOf
 * (extractJsonObject).
 */

export const MAX_DUPLICATE_PROMPT_MESSAGE_LENGTH: number = 500;
export const MAX_DUPLICATE_PROMPT_TITLE_LENGTH: number = 200;
export const MAX_DUPLICATE_PROMPT_STACK_TRACE_LENGTH: number = 8000;
export const MAX_DUPLICATE_PROMPT_FRAMES: number = 5;

export const EXCEPTION_DUPLICATE_CHECK_SYSTEM_PROMPT: string = `You are OneUptime AI, deciding whether exceptions an engineer is looking at are the same bug.

You are given one exception (T) and a few others that look like it (C1, C2, ...): each with its type, message, the top frames of its stack trace (the application's own code first), how often it happened, and whether it was resolved or archived. Values were scrubbed: placeholders such as <UUID>, <EMAIL> or <NUMBER> stand for the real values.

Answer with ONE JSON object and nothing else:
{
  "items": [{"ref": "C1", "verdict": "duplicate" | "related" | "different", "reason": "One sentence: why, citing the frame or the words that decide it."}]
}

Rules:
- duplicate: the same root cause as T, so one fix fixes both. related: the same area or a shared cause, but a different bug. different: otherwise.
- One item per candidate, using its reference exactly. Never invent a reference.
- Do not guess values that were scrubbed.
- Do not wrap the JSON in prose.`;

export interface DuplicateCheckException {
  telemetryExceptionId: string;
  exceptionType: string;
  message: string;
  stackTrace: string;
  occurrenceCount: number;
  isResolved: boolean;
  isArchived: boolean;
}

// Cut first, then scrub: a value can be megabytes long.
function scrubbedText(value: string | undefined, max: number): string {
  return sanitizeExceptionMessage((value || "").slice(0, max)).trim();
}

function topFrames(stackTrace: string): Array<string> {
  let frames: Array<StackFrame> = [];

  try {
    const parsed: ParsedStackTrace = StackTraceParser.parse(
      stackTrace.slice(0, MAX_DUPLICATE_PROMPT_STACK_TRACE_LENGTH),
    );
    frames = parsed.frames;
  } catch {
    return [];
  }

  const ordered: Array<StackFrame> = [
    ...frames.filter((frame: StackFrame): boolean => {
      return frame.inApp;
    }),
    ...frames.filter((frame: StackFrame): boolean => {
      return !frame.inApp;
    }),
  ];

  return ordered
    .slice(0, MAX_DUPLICATE_PROMPT_FRAMES)
    .map((frame: StackFrame): string => {
      const where: string = scrubbedText(
        `${frame.fileName}${frame.lineNumber ? `:${frame.lineNumber}` : ""}`,
        MAX_DUPLICATE_PROMPT_TITLE_LENGTH,
      );
      const name: string = scrubbedText(
        frame.functionName,
        MAX_DUPLICATE_PROMPT_TITLE_LENGTH,
      );

      return `${name || "(anonymous)"} (${where})${frame.inApp ? "" : " [library]"}`;
    });
}

export function candidateReference(index: number): string {
  return `C${index + 1}`;
}

function describe(
  reference: string,
  exception: DuplicateCheckException,
): Array<string> {
  const lines: Array<string> = [];
  const status: string = exception.isArchived
    ? "archived"
    : exception.isResolved
      ? "resolved"
      : "unresolved";

  lines.push(`## ${reference} (${status})`);
  lines.push(
    `Type: ${scrubbedText(exception.exceptionType, MAX_DUPLICATE_PROMPT_TITLE_LENGTH) || "unknown"}`,
  );
  lines.push(
    `Message: ${scrubbedText(exception.message, MAX_DUPLICATE_PROMPT_MESSAGE_LENGTH) || "(no message)"}`,
  );
  lines.push(`Occurrences: ${exception.occurrenceCount}`);

  const frames: Array<string> = topFrames(exception.stackTrace || "");

  if (frames.length > 0) {
    lines.push("Top frames:");

    for (const frame of frames) {
      lines.push(`- ${frame}`);
    }
  }

  lines.push("");

  return lines;
}

export function buildExceptionDuplicateCheckPrompt(data: {
  target: DuplicateCheckException;
  candidates: Array<DuplicateCheckException>;
}): string {
  const lines: Array<string> = [...describe("T", data.target)];

  data.candidates
    .slice(0, MAX_SIMILAR_EXCEPTIONS)
    .forEach((candidate: DuplicateCheckException, index: number): void => {
      lines.push(...describe(candidateReference(index), candidate));
    });

  return lines.join("\n").trim();
}

/*
 * The verdicts a model's answer holds, mapped back to the candidates. An
 * item about a reference the prompt did not hold, a second item about the
 * same one, or one with a verdict it does not know is dropped: that
 * candidate simply has no verdict.
 */
export function parseExceptionDuplicateCheckResponse(
  content: string,
  candidates: Array<DuplicateCheckException>,
): Array<DuplicateVerdict> | null {
  const parsed: unknown = extractJsonObject(content || "");

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const items: unknown = (parsed as Record<string, unknown>)["items"];

  if (!Array.isArray(items)) {
    return null;
  }

  const given: Array<DuplicateCheckException> = candidates.slice(
    0,
    MAX_SIMILAR_EXCEPTIONS,
  );
  const byReference: Map<string, number> = new Map<string, number>();

  given.forEach((_candidate: DuplicateCheckException, index: number): void => {
    byReference.set(candidateReference(index), index);
  });

  const covered: Set<number> = new Set<number>();
  const verdicts: Array<DuplicateVerdict> = [];

  for (const entry of items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const item: Record<string, unknown> = entry as Record<string, unknown>;
    const reference: unknown = item["ref"];
    const index: number | undefined =
      typeof reference === "string"
        ? byReference.get(reference.trim().toUpperCase())
        : undefined;
    const verdict: unknown = item["verdict"];

    if (
      index === undefined ||
      covered.has(index) ||
      !Object.values(DuplicateVerdictKind).includes(
        verdict as DuplicateVerdictKind,
      )
    ) {
      continue;
    }

    covered.add(index);
    verdicts.push({
      telemetryExceptionId: given[index]!.telemetryExceptionId,
      verdict: verdict as DuplicateVerdictKind,
      reason: boundedDigestReason(item["reason"]),
    });
  }

  return verdicts;
}

function boundedDigestReason(value: unknown): string {
  return boundedSimilarText(value, MAX_DUPLICATE_REASON_LENGTH);
}
