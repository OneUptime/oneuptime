/*
 * OTHER EXCEPTIONS THAT LOOK LIKE THIS ONE, AND WHETHER ONEUPTIME AI THINKS
 * THEY ARE THE SAME BUG.
 *
 * An exception's fingerprint groups occurrences whose normalized message
 * and stack are the same, so one root cause can still land in several
 * groups: a message that carries a value the normalizer does not know, a
 * second code path to the same fault, a rename between releases. Similar
 * exceptions finds those groups for the person looking at one of them
 * (Server/Utils/Telemetry/SimilarExceptions), and OneUptime AI can say which
 * are duplicates (Server/Utils/AI/TelemetryAi/ExceptionDuplicateCheck).
 *
 * Shared by the server and the Dashboard, which reads the answers back
 * defensively (readSimilarExceptions, readDuplicateVerdicts).
 */

// At most this many similar exceptions are shown, the most similar first.
export const MAX_SIMILAR_EXCEPTIONS: number = 5;

// Why an exception is listed as similar, the strongest reason first.
export enum SimilarExceptionReason {
  // The same type and the same message, once the values are taken out.
  SameMessage = "same-message",
  // Thrown from the same function of the application's own code.
  SameCodeLocation = "same-code-location",
  // Most of the message's words are the same.
  SimilarMessage = "similar-message",
}

export interface SimilarException {
  telemetryExceptionId: string;
  exceptionType: string;
  message: string;
  occurrenceCount: number;
  lastSeenAt?: string | undefined;
  isResolved: boolean;
  isArchived: boolean;
  reason: SimilarExceptionReason;
}

export enum DuplicateVerdictKind {
  // The same root cause: fixing one fixes the other.
  Duplicate = "duplicate",
  // Connected - the same area or a shared cause - but not the same bug.
  Related = "related",
  Different = "different",
}

export interface DuplicateVerdict {
  telemetryExceptionId: string;
  verdict: DuplicateVerdictKind;
  // One sentence: why.
  reason: string;
}

export const MAX_SIMILAR_MESSAGE_LENGTH: number = 500;
export const MAX_SIMILAR_TYPE_LENGTH: number = 200;
export const MAX_DUPLICATE_REASON_LENGTH: number = 300;

export function boundedSimilarText(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const text: string = value.trim();

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

// The similar exceptions as the server sent them, checked and bounded.
export function readSimilarExceptions(value: unknown): Array<SimilarException> {
  const seen: Set<string> = new Set<string>();
  const result: Array<SimilarException> = [];

  for (const entry of Array.isArray(value) ? value : []) {
    if (!isRecord(entry) || !isId(entry["telemetryExceptionId"])) {
      continue;
    }

    const id: string = entry["telemetryExceptionId"];
    const reason: unknown = entry["reason"];

    if (
      seen.has(id) ||
      !Object.values(SimilarExceptionReason).includes(
        reason as SimilarExceptionReason,
      )
    ) {
      continue;
    }

    seen.add(id);

    const count: unknown = entry["occurrenceCount"];
    const lastSeenAt: unknown = entry["lastSeenAt"];

    result.push({
      telemetryExceptionId: id,
      exceptionType: boundedSimilarText(
        entry["exceptionType"],
        MAX_SIMILAR_TYPE_LENGTH,
      ),
      message: boundedSimilarText(entry["message"], MAX_SIMILAR_MESSAGE_LENGTH),
      occurrenceCount:
        typeof count === "number" && Number.isFinite(count) && count > 0
          ? Math.floor(count)
          : 0,
      ...(typeof lastSeenAt === "string" &&
      !Number.isNaN(new Date(lastSeenAt).getTime())
        ? { lastSeenAt }
        : {}),
      isResolved: entry["isResolved"] === true,
      isArchived: entry["isArchived"] === true,
      reason: reason as SimilarExceptionReason,
    });

    if (result.length >= MAX_SIMILAR_EXCEPTIONS) {
      break;
    }
  }

  return result;
}

// OneUptime AI's verdicts as the server sent them, checked and bounded.
export function readDuplicateVerdicts(value: unknown): Array<DuplicateVerdict> {
  const seen: Set<string> = new Set<string>();
  const result: Array<DuplicateVerdict> = [];

  for (const entry of Array.isArray(value) ? value : []) {
    if (!isRecord(entry) || !isId(entry["telemetryExceptionId"])) {
      continue;
    }

    const id: string = entry["telemetryExceptionId"];
    const verdict: unknown = entry["verdict"];

    if (
      seen.has(id) ||
      !Object.values(DuplicateVerdictKind).includes(
        verdict as DuplicateVerdictKind,
      )
    ) {
      continue;
    }

    seen.add(id);
    result.push({
      telemetryExceptionId: id,
      verdict: verdict as DuplicateVerdictKind,
      reason: boundedSimilarText(entry["reason"], MAX_DUPLICATE_REASON_LENGTH),
    });
  }

  return result.slice(0, MAX_SIMILAR_EXCEPTIONS);
}
