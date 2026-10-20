import { TelemetryFixSignal } from "../../../../Types/AI/FixProductionBaseline";
import FixProductionStatus from "../../../../Types/AI/FixProductionStatus";
import {
  FIX_PRODUCTION_THRESHOLDS,
  FixProductionVerdict,
  HOUR_IN_MS,
  capitalize,
  describeDuration,
  fitVerdict,
  formatCount,
  quoteName,
  watchedMilliseconds,
} from "./FixProductionVerdict";

/*
 * Whether a merged AI telemetry improvement - ImproveInstrumentation,
 * ImproveLogging, ImproveTracing - sends what it adds once it runs: the
 * pure decisions behind TelemetryFixWatch, so every rule is pinned by tests.
 *
 * What a fix adds is read from its pull request's diff: the text quoted on
 * the lines it adds - a span's name, an attribute's key, a log's message
 * (readAddedQuotedText). Text the service (or, with no service, the
 * project) already sent in the week before the merge is not new, so it is
 * left out; what is left is looked for in the deployed fix. That ties the
 * verdict to this fix's own changes: a name that arrives was quoted by the
 * fix and was never sent before.
 *
 *   - Verified: something the fix adds arrives from the deployed fix, or a
 *     service that sent no spans (or logs) before starts sending them;
 *   - Regressed: a service whose spans (or logs) arrived steadily before
 *     sends none at all after the rollout grace - the change broke them;
 *   - Unverifiable: maxWatchDays pass with neither, or the fix quotes
 *     nothing to look for and names no service to watch.
 *
 * Nothing is decided before the fix has run minWatchHours: a whole day, so
 * a service that only sends at some hours is not taken for one that
 * stopped, and something that arrived is not Verified by a deploy that
 * broke the rest of its telemetry.
 */

export const TELEMETRY_FIX_THRESHOLDS: {
  readonly rolloutGraceMinutes: number;
  readonly minWatchHours: number;
  readonly maxWatchDays: number;
  // The window before the merge that says what was sent already.
  readonly baselineDays: number;
  /*
   * How many spans (or logs) the service's rate before the fix must predict
   * for the watched time before none arriving means the fix stopped them.
   */
  readonly minExpectedSignal: number;
} = {
  rolloutGraceMinutes: FIX_PRODUCTION_THRESHOLDS.rolloutGraceMinutes,
  minWatchHours: 24,
  maxWatchDays: 7,
  baselineDays: 7,
  minExpectedSignal: 100,
};

/*
 * How much of a diff is read. The diff is the customer's code, read on a
 * schedule: every limit is a count, and the scan is one pass with indexOf
 * and character loops, never a regular expression over a line.
 */
export const TELEMETRY_FIX_DIFF_LIMITS: {
  // The most quoted texts kept.
  readonly maxTexts: number;
  readonly minTextLength: number;
  readonly maxTextLength: number;
  // A line is read only this far: past it is generated or minified code.
  readonly maxLineLength: number;
  // The most diff text read in all.
  readonly maxDiffCharacters: number;
} = {
  maxTexts: 200,
  minTextLength: 3,
  maxTextLength: 200,
  maxLineLength: 2000,
  maxDiffCharacters: 2000000,
};

// Where a text the fix adds arrived.
export enum TelemetryArrivalKind {
  SpanName = "SpanName",
  SpanAttribute = "SpanAttribute",
  LogAttribute = "LogAttribute",
  LogBody = "LogBody",
}

export interface TelemetryArrival {
  text: string;
  kind: TelemetryArrivalKind;
}

// The spans and logs a service sent over a window.
export interface TelemetrySignalCounts {
  spans: number;
  logs: number;
}

const ARRIVAL_WORDS: Record<TelemetryArrivalKind, string> = {
  [TelemetryArrivalKind.SpanName]: "span",
  [TelemetryArrivalKind.SpanAttribute]: "span attribute",
  [TelemetryArrivalKind.LogAttribute]: "log attribute",
  [TelemetryArrivalKind.LogBody]: "log",
};

const SIGNAL_WORDS: Record<TelemetryFixSignal, string> = {
  [TelemetryFixSignal.Spans]: "spans",
  [TelemetryFixSignal.Logs]: "logs",
};

// The most arrivals a summary names; the rest are counted.
const MAX_NAMED_ARRIVALS: number = 3;

const QUOTES: Array<number> = ['"'.charCodeAt(0), "'".charCodeAt(0), 96];
const BACKSLASH: number = 92;
const PLUS: number = "+".charCodeAt(0);
// One character, so no quantifier ever runs over the diff.
const LETTER: RegExp = /\p{L}/u;

/*
 * The text quoted on the lines a diff adds, in the order it appears, each
 * once: what a telemetry improvement names. A patch is GitHub's per-file
 * unified diff; its added lines start with "+". A quote that does not
 * close on its line, a text with an escape or an interpolation in it (its
 * value at run time is not the text), and one without a letter are left
 * out.
 */
export function readAddedQuotedText(patches: Array<string>): {
  texts: Array<string>;
  // Whether a limit stopped the read before the end of the diff.
  isTruncated: boolean;
} {
  const limits: typeof TELEMETRY_FIX_DIFF_LIMITS = TELEMETRY_FIX_DIFF_LIMITS;
  const seen: Set<string> = new Set<string>();
  const texts: Array<string> = [];
  let read: number = 0;

  for (const patch of patches) {
    let lineStart: number = 0;

    while (lineStart < patch.length) {
      if (read >= limits.maxDiffCharacters || texts.length >= limits.maxTexts) {
        return { texts, isTruncated: true };
      }

      let lineEnd: number = patch.indexOf("\n", lineStart);

      if (lineEnd === -1) {
        lineEnd = patch.length;
      }

      // An added line; "+++ " heads a file in a whole diff.
      if (
        patch.charCodeAt(lineStart) === PLUS &&
        !patch.startsWith("+++ ", lineStart)
      ) {
        for (const text of readQuotedOnLine(
          patch,
          lineStart + 1,
          Math.min(lineEnd, lineStart + 1 + limits.maxLineLength),
        )) {
          if (!seen.has(text) && texts.length < limits.maxTexts) {
            seen.add(text);
            texts.push(text);
          }
        }
      }

      read += lineEnd - lineStart + 1;
      lineStart = lineEnd + 1;
    }
  }

  return { texts, isTruncated: false };
}

// The quoted texts between start and end of one line.
function readQuotedOnLine(
  text: string,
  start: number,
  end: number,
): Array<string> {
  const found: Array<string> = [];
  let index: number = start;

  while (index < end) {
    const quote: number = text.charCodeAt(index);

    if (!QUOTES.includes(quote)) {
      index++;
      continue;
    }

    let close: number = index + 1;
    let hasEscape: boolean = false;

    while (close < end && text.charCodeAt(close) !== quote) {
      if (text.charCodeAt(close) === BACKSLASH) {
        hasEscape = true;
        close++;
      }

      close++;
    }

    // Unclosed on this line: an apostrophe in a comment, or a string that goes on.
    if (close >= end) {
      return found;
    }

    const value: string = text.slice(index + 1, close).trim();

    if (!hasEscape && isNameLike(value)) {
      found.push(value);
    }

    index = close + 1;
  }

  return found;
}

function isNameLike(value: string): boolean {
  const limits: typeof TELEMETRY_FIX_DIFF_LIMITS = TELEMETRY_FIX_DIFF_LIMITS;

  if (
    value.length < limits.minTextLength ||
    value.length > limits.maxTextLength ||
    value.includes("${") ||
    value.includes("\n")
  ) {
    return false;
  }

  // At least one letter, in any script: "200", "..." and "-->" name nothing.
  for (const character of value) {
    if (LETTER.test(character)) {
      return true;
    }
  }

  return false;
}

/*
 * The fix's texts to look for, and whether anything can be watched at all:
 * a fix that quotes nothing new and names no service whose spans and logs
 * can be followed is Unverifiable at once.
 */
export function decideTelemetryBaseline(data: {
  candidateCount: number;
  isServiceScoped: boolean;
}): FixProductionVerdict | null {
  if (data.candidateCount > 0 || data.isServiceScoped) {
    return null;
  }

  return {
    status: FixProductionStatus.Unverifiable,
    summary:
      "The fix's changes quote no span name, attribute key or log text that was not sent already, and it names no service whose telemetry to follow, so there is nothing to look for in production.",
  };
}

// 'span "checkout.pay", log attribute "order.id" and 2 more'.
export function describeArrivals(arrivals: Array<TelemetryArrival>): string {
  const named: Array<string> = arrivals
    .slice(0, MAX_NAMED_ARRIVALS)
    .map((arrival: TelemetryArrival): string => {
      return `${ARRIVAL_WORDS[arrival.kind]} ${quoteName(arrival.text)}`;
    });
  const more: number = arrivals.length - named.length;

  if (more > 0) {
    return `${named.join(", ")} and ${formatCount(more)} more`;
  }

  if (named.length <= 1) {
    return named.join("");
  }

  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/*
 * A deployed telemetry improvement, watched (see the module comment). The
 * counts are the service's, read after the rollout grace whatever version
 * sent them - a broken exporter sends no version - and null when no service
 * is followed.
 */
export function decideTelemetryVerdict(data: {
  deployedAt: Date;
  now: Date;
  signals: Array<TelemetryFixSignal>;
  // How many texts the fix adds are looked for.
  candidateCount: number;
  // The texts that arrived from the deployed fix.
  arrivals: Array<TelemetryArrival>;
  baselineCounts: TelemetrySignalCounts | null;
  sinceCounts: TelemetrySignalCounts | null;
  // describeDeploy's words for the deploy.
  deployLabel: string;
}): FixProductionVerdict {
  const thresholds: typeof TELEMETRY_FIX_THRESHOLDS = TELEMETRY_FIX_THRESHOLDS;
  const watched: number = watchedMilliseconds({
    deployedAt: data.deployedAt,
    now: data.now,
    rolloutGraceMinutes: thresholds.rolloutGraceMinutes,
  });
  const watchedHours: number = watched / HOUR_IN_MS;
  const hasRunADay: boolean = watchedHours >= thresholds.minWatchHours;
  const deploy: string = data.deployLabel;

  // A signal the service sent steadily before, and none of since.
  if (hasRunADay && data.baselineCounts && data.sinceCounts) {
    for (const signal of data.signals) {
      const before: number = countOf(data.baselineCounts, signal);
      const expected: number =
        (before / (thresholds.baselineDays * 24)) * watchedHours;

      if (
        expected >= thresholds.minExpectedSignal &&
        countOf(data.sinceCounts, signal) === 0
      ) {
        return fitVerdict({
          status: FixProductionStatus.Regressed,
          summary: `The service sent ${formatCount(before)} ${
            SIGNAL_WORDS[signal]
          } in the ${
            thresholds.baselineDays
          } days before the fix merged, and none in the ${describeDuration(
            watched,
          )} since ${deploy} shipped it, so the fix stopped them.`,
        });
      }
    }
  }

  // A signal the service never sent before, and sends since.
  let started: TelemetryFixSignal | null = null;

  if (data.baselineCounts && data.sinceCounts) {
    for (const signal of data.signals) {
      if (
        countOf(data.baselineCounts, signal) === 0 &&
        countOf(data.sinceCounts, signal) > 0
      ) {
        started = signal;
        break;
      }
    }
  }

  if (data.arrivals.length > 0 || started) {
    const what: string =
      data.arrivals.length > 0
        ? `${capitalize(deploy)} sends what the fix adds: ${describeArrivals(
            data.arrivals,
          )}`
        : `The service sent no ${SIGNAL_WORDS[started!]} in the ${
            thresholds.baselineDays
          } days before the fix merged, and sends them since ${deploy} shipped it`;

    if (!hasRunADay) {
      return fitVerdict({
        status: FixProductionStatus.Watching,
        summary: `${what}. It counts once the fix has run for a day without stopping the rest of the service's telemetry.`,
      });
    }

    return fitVerdict({
      status: FixProductionStatus.Verified,
      summary: `${what}.`,
    });
  }

  const lookedFor: string =
    data.candidateCount === 1
      ? "the 1 name it adds"
      : `the ${formatCount(data.candidateCount)} names it adds`;

  if (watchedHours >= thresholds.maxWatchDays * 24) {
    return fitVerdict({
      status: FixProductionStatus.Unverifiable,
      summary:
        data.candidateCount > 0
          ? `None of ${lookedFor} arrived in the ${describeDuration(
              watched,
            )} since ${deploy} shipped the fix: the code that sends them may not have run.`
          : `The fix's changes quote nothing new to look for, and the service's telemetry kept arriving in the ${describeDuration(
              watched,
            )} since ${deploy} shipped the fix.`,
    });
  }

  // Worded the same on every check, so a check that learns nothing writes nothing.
  return fitVerdict({
    status: FixProductionStatus.Watching,
    summary:
      data.candidateCount > 0
        ? `${capitalize(deploy)} shipped the fix; none of ${lookedFor} has arrived yet.`
        : `${capitalize(deploy)} shipped the fix; the service's telemetry is followed to see it keeps arriving.`,
  });
}

function countOf(
  counts: TelemetrySignalCounts,
  signal: TelemetryFixSignal,
): number {
  return signal === TelemetryFixSignal.Spans ? counts.spans : counts.logs;
}
