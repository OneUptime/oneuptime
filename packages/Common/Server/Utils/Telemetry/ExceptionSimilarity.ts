import {
  MAX_SIMILAR_EXCEPTIONS,
  SimilarExceptionReason,
} from "../../../Types/Telemetry/SimilarExceptions";
import { normalizeExceptionText } from "./ExceptionSanitizer";
import StackTraceParser, {
  ParsedStackTrace,
  StackFrame,
} from "./StackTraceParser";

/*
 * HOW MUCH ONE EXCEPTION LOOKS LIKE ANOTHER.
 *
 * Pure: no database. Each exception is reduced to a signature - its type,
 * its message with the values taken out (normalizeExceptionText, the
 * fingerprint's own normalizer), the words of that message, and the
 * function of the application's own code it was thrown from - and two
 * signatures are compared for the strongest reason they share
 * (SimilarExceptionReason). A message or a stack trace can be megabytes on
 * one line, and the normalizer runs regular expressions, so each is cut to
 * a fixed length before anything reads it (AGENTS.md, "Megabyte-long
 * values").
 */

export const MAX_SIGNATURE_MESSAGE_LENGTH: number = 1000;
export const MAX_SIGNATURE_STACK_TRACE_LENGTH: number = 8000;

/*
 * The share of words two messages must have in common to read as similar:
 * of the same type, or a great deal more of another.
 */
export const SIMILAR_MESSAGE_SAME_TYPE_THRESHOLD: number = 0.6;
export const SIMILAR_MESSAGE_ANY_TYPE_THRESHOLD: number = 0.8;

export interface ExceptionSignatureInput {
  id: string;
  exceptionType?: string | undefined;
  message?: string | undefined;
  stackTrace?: string | undefined;
}

export interface ExceptionSignature {
  id: string;
  type: string;
  message: string;
  words: Set<string>;
  // "file|function" of the first frame of the application's own code.
  codeLocation: string;
}

/*
 * The normalizer's placeholders (lowercased): every message with a number
 * has <number>, so they say nothing about whether two are alike.
 */
const PLACEHOLDER_WORDS: Set<string> = new Set<string>([
  "date",
  "email",
  "hex_id",
  "id",
  "ip",
  "memory_addr",
  "number",
  "object_id",
  "service_id",
  "stripe_id",
  "time",
  "timestamp",
  "uuid",
]);

function isAllDigits(word: string): boolean {
  if (!word) {
    return false;
  }

  for (const character of word) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  return true;
}

function wordsOf(message: string): Set<string> {
  const words: Set<string> = new Set<string>();
  let current: string = "";
  // The character just before the current word, and the last one read.
  let before: string = "";
  let last: string = "";

  // Read character by character: no regular expression over the message.
  for (const character of `${message} `) {
    const isWordCharacter: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      character === "_";

    if (isWordCharacter) {
      if (!current) {
        before = last;
      }
      current += character;
      last = character;
      continue;
    }

    const isPlaceholder: boolean =
      before === "<" && character === ">" && PLACEHOLDER_WORDS.has(current);
    // A number is a value, not a word: "order 1001" and "order 2002" agree.
    const isNumber: boolean = isAllDigits(current);

    if (current.length >= 3 && !isPlaceholder && !isNumber) {
      words.add(current);
    }

    current = "";
    last = character;
  }

  return words;
}

function codeLocationOf(stackTrace: string): string {
  if (!stackTrace) {
    return "";
  }

  let frames: Array<StackFrame> = [];

  try {
    const parsed: ParsedStackTrace = StackTraceParser.parse(
      stackTrace.slice(0, MAX_SIGNATURE_STACK_TRACE_LENGTH),
    );
    frames = parsed.frames;
  } catch {
    return "";
  }

  const frame: StackFrame | undefined = frames.find(
    (candidate: StackFrame): boolean => {
      return candidate.inApp && Boolean(candidate.fileName);
    },
  );

  return frame ? `${frame.fileName}|${frame.functionName || ""}` : "";
}

export function exceptionSignature(
  input: ExceptionSignatureInput,
): ExceptionSignature {
  const message: string = normalizeExceptionText(
    (input.message || "").slice(0, MAX_SIGNATURE_MESSAGE_LENGTH),
  )
    .trim()
    .toLowerCase();

  return {
    id: input.id,
    type: (input.exceptionType || "").trim(),
    message,
    words: wordsOf(message),
    codeLocation: codeLocationOf(input.stackTrace || ""),
  };
}

// The share of the two messages' words that both have (Jaccard).
export function sharedWords(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let both: number = 0;

  for (const word of a) {
    if (b.has(word)) {
      both++;
    }
  }

  return both / (a.size + b.size - both);
}

/*
 * The strongest reason the candidate looks like the target, or null when
 * it does not (or is the target).
 */
export function similarityReason(
  target: ExceptionSignature,
  candidate: ExceptionSignature,
): SimilarExceptionReason | null {
  if (target.id === candidate.id) {
    return null;
  }

  if (
    target.message &&
    target.message === candidate.message &&
    target.type === candidate.type
  ) {
    return SimilarExceptionReason.SameMessage;
  }

  if (target.codeLocation && target.codeLocation === candidate.codeLocation) {
    return SimilarExceptionReason.SameCodeLocation;
  }

  const shared: number = sharedWords(target.words, candidate.words);

  if (
    shared >=
    (target.type === candidate.type
      ? SIMILAR_MESSAGE_SAME_TYPE_THRESHOLD
      : SIMILAR_MESSAGE_ANY_TYPE_THRESHOLD)
  ) {
    return SimilarExceptionReason.SimilarMessage;
  }

  return null;
}

const REASON_RANK: Record<SimilarExceptionReason, number> = {
  [SimilarExceptionReason.SameMessage]: 0,
  [SimilarExceptionReason.SameCodeLocation]: 1,
  [SimilarExceptionReason.SimilarMessage]: 2,
};

export interface RankedSimilar<T extends ExceptionSignatureInput> {
  candidate: T;
  reason: SimilarExceptionReason;
}

/*
 * The candidates that look like the target, the strongest reason first and,
 * within a reason, in the order they were given (the most recently seen
 * first, as they are read). Each candidate once, the target never.
 */
export function rankSimilarExceptions<T extends ExceptionSignatureInput>(
  target: ExceptionSignatureInput,
  candidates: Array<T>,
  max: number = MAX_SIMILAR_EXCEPTIONS,
): Array<RankedSimilar<T>> {
  const targetSignature: ExceptionSignature = exceptionSignature(target);
  const seen: Set<string> = new Set<string>([target.id]);
  const ranked: Array<RankedSimilar<T> & { index: number }> = [];

  candidates.forEach((candidate: T, index: number): void => {
    if (seen.has(candidate.id)) {
      return;
    }

    seen.add(candidate.id);

    const reason: SimilarExceptionReason | null = similarityReason(
      targetSignature,
      exceptionSignature(candidate),
    );

    if (reason) {
      ranked.push({ candidate, reason, index });
    }
  });

  return ranked
    .sort(
      (
        a: RankedSimilar<T> & { index: number },
        b: RankedSimilar<T> & { index: number },
      ): number => {
        return (
          REASON_RANK[a.reason] - REASON_RANK[b.reason] || a.index - b.index
        );
      },
    )
    .slice(0, max)
    .map((entry: RankedSimilar<T> & { index: number }): RankedSimilar<T> => {
      return { candidate: entry.candidate, reason: entry.reason };
    });
}
