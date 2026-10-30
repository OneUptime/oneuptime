/*
 * WHAT IS NEW IN A PROJECT'S EXCEPTIONS, IN A FEW LINES FROM ONEUPTIME AI.
 *
 * The exceptions first seen in the last day, and the ones that came back in
 * the last day after they were resolved, summed up for the person on call:
 * a headline, then each exception in one sentence with how urgent it looks
 * (Server/Utils/AI/TelemetryAi/ExceptionDigest). Written on demand from
 * Exceptions' Insights page and not kept: the next person asks again.
 *
 * Shared by the server, which writes it, and the Dashboard, which reads it
 * back defensively (readExceptionAIDigest): it is JSON a model helped write,
 * so every field is checked and bounded. Which exception an item is about,
 * its kind and its type come from OneUptime, never from the model.
 */

export const EXCEPTION_AI_DIGEST_VERSION: number = 1;

// How far back the digest looks: the day the New badge covers.
export const EXCEPTION_DIGEST_WINDOW_HOURS: number = 24;

// The most exceptions one digest is written from, the busiest first.
export const MAX_DIGEST_EXCEPTIONS: number = 20;

export enum ExceptionDigestKind {
  // First seen in the last day.
  New = "new",
  // Resolved before, and came back in the last day.
  Regressed = "regressed",
}

export enum ExceptionDigestPriority {
  High = "high",
  Medium = "medium",
  Low = "low",
}

export interface ExceptionDigestItem {
  telemetryExceptionId: string;
  kind: ExceptionDigestKind;
  exceptionType: string;
  // One sentence: what it is and why it matters.
  summary: string;
  priority: ExceptionDigestPriority;
}

export interface ExceptionAIDigest {
  version: number;
  // Two or three sentences over all of them.
  headline: string;
  // The most urgent first.
  items: Array<ExceptionDigestItem>;
}

// How much of each field is kept.
export const MAX_DIGEST_HEADLINE_LENGTH: number = 600;
export const MAX_DIGEST_ITEM_SUMMARY_LENGTH: number = 300;
export const MAX_DIGEST_EXCEPTION_TYPE_LENGTH: number = 200;

const PRIORITY_ORDER: Record<ExceptionDigestPriority, number> = {
  [ExceptionDigestPriority.High]: 0,
  [ExceptionDigestPriority.Medium]: 1,
  [ExceptionDigestPriority.Low]: 2,
};

export function boundedDigestText(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const text: string = value.trim();

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function readDigestPriority(value: unknown): ExceptionDigestPriority {
  return typeof value === "string" &&
    Object.values(ExceptionDigestPriority).includes(
      value as ExceptionDigestPriority,
    )
    ? (value as ExceptionDigestPriority)
    : ExceptionDigestPriority.Medium;
}

// The most urgent first; equal ones keep their order.
export function sortDigestItems(
  items: Array<ExceptionDigestItem>,
): Array<ExceptionDigestItem> {
  return items
    .map((item: ExceptionDigestItem, index: number) => {
      return { item, index };
    })
    .sort(
      (
        a: { item: ExceptionDigestItem; index: number },
        b: { item: ExceptionDigestItem; index: number },
      ): number => {
        return (
          PRIORITY_ORDER[a.item.priority] - PRIORITY_ORDER[b.item.priority] ||
          a.index - b.index
        );
      },
    )
    .map((entry: { item: ExceptionDigestItem; index: number }) => {
      return entry.item;
    });
}

function readItem(value: unknown): ExceptionDigestItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const id: unknown = record["telemetryExceptionId"];
  const kind: unknown = record["kind"];
  const summary: string = boundedDigestText(
    record["summary"],
    MAX_DIGEST_ITEM_SUMMARY_LENGTH,
  );

  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 64 ||
    !Object.values(ExceptionDigestKind).includes(kind as ExceptionDigestKind) ||
    !summary
  ) {
    return null;
  }

  return {
    telemetryExceptionId: id,
    kind: kind as ExceptionDigestKind,
    exceptionType: boundedDigestText(
      record["exceptionType"],
      MAX_DIGEST_EXCEPTION_TYPE_LENGTH,
    ),
    summary,
    priority: readDigestPriority(record["priority"]),
  };
}

/*
 * A digest as the server sent it, every field checked and bounded, or null
 * when it holds no headline. An item without an exception, a kind or a
 * summary is left out, and so is a second item about the same exception.
 */
export function readExceptionAIDigest(
  value: unknown,
): ExceptionAIDigest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const headline: string = boundedDigestText(
    record["headline"],
    MAX_DIGEST_HEADLINE_LENGTH,
  );

  if (!headline) {
    return null;
  }

  const seen: Set<string> = new Set<string>();
  const items: Array<ExceptionDigestItem> = [];

  for (const entry of Array.isArray(record["items"]) ? record["items"] : []) {
    const item: ExceptionDigestItem | null = readItem(entry);

    if (!item || seen.has(item.telemetryExceptionId)) {
      continue;
    }

    seen.add(item.telemetryExceptionId);
    items.push(item);

    if (items.length >= MAX_DIGEST_EXCEPTIONS) {
      break;
    }
  }

  return {
    version: EXCEPTION_AI_DIGEST_VERSION,
    headline,
    items: sortDigestItems(items),
  };
}
