import SliType from "../../Types/ServiceLevelObjective/SliType";
import SloUtil, { ErrorBudgetResult } from "./SloUtil";

/**
 * REQUEST SLIs: an SLO measured from the requests its services served, not
 * from its monitors' status timelines.
 *
 *   - Request Success: a request is good when its span's status is not
 *     Error (OpenTelemetry's own verdict on a request: an HTTP server span
 *     with a 5xx answer, an uncaught exception, a gRPC failure).
 *   - Request Latency: a request is good when it was served within the
 *     SLO's latency threshold, whatever its status.
 *
 * "A request" is an entry span of one of the SLO's services: where work
 * enters the service (a root span, or a SERVER or CONSUMER span whatever its
 * parent - Utils/Telemetry/EntrySpan), so a request that crosses three
 * services counts once in each of them, and a database call inside it does
 * not count at all.
 *
 * HOW THEY ARE COUNTED. Counting a month of spans on every evaluation would
 * read billions of rows every five minutes, and telemetry is often kept for
 * less time than an SLO's window. So the evaluation worker counts each
 * service's requests once, in 5-minute steps, and keeps the counts in
 * SloHistory ("good.count" and "total.count", kept 400 days); the SLI, the
 * error budget and every burn rate are then sums of those steps.
 * planRequestCounting decides which steps an evaluation counts:
 *
 *   - a step is counted once it is SLO_REQUEST_SETTLE_MINUTES old, so spans
 *     still on their way are not missed, and the last
 *     SLO_REQUEST_RESTATE_STEPS steps are counted again on the next
 *     evaluation, for the stragglers;
 *   - the first evaluation counts the last 6 hours, so a new SLO has numbers
 *     right away, and every evaluation counts older requests too, 6 hours
 *     at a time, until the steps reach the start of the window (or of the
 *     longest burn rate rule's lookback, when that is older);
 *   - changing what the SLO counts (its SLI type, services or latency
 *     threshold) starts the counting again, because every step counted
 *     before counted something else; so does a gap of more than 6 hours
 *     (the worker was down), so the newest requests are counted first.
 *
 * Isomorphic (no server imports), like SloUtil: the dashboard reads the
 * same constants to say what the counts cover.
 */

export const SLO_REQUEST_STEP_MINUTES: number = 5;

export const SLO_REQUEST_STEP_MILLISECONDS: number =
  SLO_REQUEST_STEP_MINUTES * 60 * 1000;

/*
 * How old a step must be before it is counted. Spans reach OneUptime after
 * the request they describe has ended and its exporter has flushed - seconds
 * for most services, a minute or two for a long request behind a batching
 * collector.
 */
export const SLO_REQUEST_SETTLE_MINUTES: number = 2;

/*
 * How many already-counted steps the next evaluation counts again, so a span
 * that arrived after its step was first counted still counts. Counting a
 * step again replaces its counts (SloHistory keeps the newest version).
 */
export const SLO_REQUEST_RESTATE_STEPS: number = 2;

/*
 * The most time one count reads spans for. The evaluation worker measures
 * every SLO one after another, so a count that read a busy project's month
 * of spans would hold up every SLO behind it: each count is at most this
 * long, and older requests are counted in pieces of this size.
 *
 *   - The first evaluation counts the newest piece, so a new SLO has numbers
 *     at once - and the 6 hours the default Slow burn rule looks back.
 *   - A gap longer than this since the newest counted step (the worker was
 *     down) starts the counting again from now, rather than catching up
 *     oldest first and showing an hours-old SLI while it does.
 */
export const SLO_REQUEST_COUNT_CHUNK_MINUTES: number = 6 * 60;

/*
 * Each evaluation counts up to this many older pieces too, going back from
 * the oldest counted step until the window is covered (the worker stops
 * early once a few seconds are spent: SloRequestCounting).
 */
export const SLO_REQUEST_MAX_BACKFILL_CHUNKS: number = 4;

// The SloHistory series a request SLO's counts are kept in, per step.
export enum SloRequestCountSeries {
  Good = "good.count",
  Total = "total.count",
}

// [from, to): the steps from `from` up to, not including, `to`.
export interface SloRequestCountingRange {
  from: Date;
  to: Date;
}

export interface SloRequestCountingPlan {
  /*
   * The newest steps: those that settled since the last evaluation, with the
   * last few counted again, or - when the counting starts again - the newest
   * piece. Null when nothing new has settled. Counted first, and the
   * evaluation cannot go on without it.
   */
  forward: SloRequestCountingRange | null;
  /*
   * Older pieces, newest first, each ending where the one before it starts,
   * the first ending at `firstAccumulatedBucketStartAt`. Counted after
   * `forward`, as far as time allows: the counts cover back to the start of
   * the last piece counted.
   */
  backfill: Array<SloRequestCountingRange>;
  // What the counts cover once `forward` is counted: the two cursor columns.
  firstAccumulatedBucketStartAt: Date;
  lastAccumulatedBucketEndAt: Date;
  // True when the counting starts again, rather than carrying on.
  isRestart: boolean;
}

export type IsRequestSliTypeFunction = (
  sliType: SliType | string | undefined | null,
) => boolean;

export const isRequestSliType: IsRequestSliTypeFunction = (
  sliType: SliType | string | undefined | null,
): boolean => {
  return (
    sliType === SliType.RequestSuccess || sliType === SliType.RequestLatency
  );
};

export type FloorToRequestStepFunction = (date: Date) => Date;

// The start of the 5-minute step `date` falls in, aligned to the Unix epoch.
export const floorToRequestStep: FloorToRequestStepFunction = (
  date: Date,
): Date => {
  return new Date(
    Math.floor(date.getTime() / SLO_REQUEST_STEP_MILLISECONDS) *
      SLO_REQUEST_STEP_MILLISECONDS,
  );
};

export type GetSettledRequestStepEndFunction = (now: Date) => Date;

/*
 * The end of the newest step old enough to count: every step that ends at or
 * before it has been over for SLO_REQUEST_SETTLE_MINUTES.
 */
export const getSettledRequestStepEnd: GetSettledRequestStepEndFunction = (
  now: Date,
): Date => {
  return floorToRequestStep(
    new Date(now.getTime() - SLO_REQUEST_SETTLE_MINUTES * 60 * 1000),
  );
};

export type ListRequestStepStartsFunction = (
  range: SloRequestCountingRange,
) => Array<Date>;

// The start of every step in the range, oldest first.
export const listRequestStepStarts: ListRequestStepStartsFunction = (
  range: SloRequestCountingRange,
): Array<Date> => {
  const starts: Array<Date> = [];

  for (
    let time: number = floorToRequestStep(range.from).getTime();
    time < range.to.getTime();
    time += SLO_REQUEST_STEP_MILLISECONDS
  ) {
    starts.push(new Date(time));
  }

  return starts;
};

export type PlanRequestCountingFunction = (data: {
  now: Date;
  /*
   * The oldest time this evaluation needs counts for: the start of the
   * compliance window, or of the longest burn rate rule's lookback when that
   * is older.
   */
  neededFrom: Date;
  firstAccumulatedBucketStartAt?: Date | undefined | null;
  lastAccumulatedBucketEndAt?: Date | undefined | null;
  // False when the SLO now counts something else than the steps were counted for.
  isSameCounting: boolean;
}) => SloRequestCountingPlan;

export const planRequestCounting: PlanRequestCountingFunction = (data: {
  now: Date;
  neededFrom: Date;
  firstAccumulatedBucketStartAt?: Date | undefined | null;
  lastAccumulatedBucketEndAt?: Date | undefined | null;
  isSameCounting: boolean;
}): SloRequestCountingPlan => {
  const settledEnd: Date = getSettledRequestStepEnd(data.now);
  const neededFrom: Date = floorToRequestStep(data.neededFrom);
  const chunkMilliseconds: number = SLO_REQUEST_COUNT_CHUNK_MINUTES * 60 * 1000;
  const savedFirst: Date | null = data.firstAccumulatedBucketStartAt || null;
  const savedLast: Date | null = data.lastAccumulatedBucketEndAt || null;

  let forward: SloRequestCountingRange | null = null;
  let first: Date;
  let last: Date;
  let isRestart: boolean = false;

  if (
    !data.isSameCounting ||
    !savedFirst ||
    !savedLast ||
    savedFirst.getTime() > savedLast.getTime() ||
    // A clock that went back, or a cursor written ahead of it: start over.
    savedLast.getTime() > settledEnd.getTime() ||
    settledEnd.getTime() - savedLast.getTime() > chunkMilliseconds
  ) {
    isRestart = true;
    last = settledEnd;
    first = new Date(
      Math.min(
        settledEnd.getTime(),
        Math.max(
          neededFrom.getTime(),
          settledEnd.getTime() - chunkMilliseconds,
        ),
      ),
    );

    forward =
      first.getTime() < last.getTime() ? { from: first, to: last } : null;
  } else {
    first = savedFirst;
    last = savedLast;

    // The steps that settled since, and the last few counted again.
    if (savedLast.getTime() < settledEnd.getTime()) {
      forward = {
        from: new Date(
          Math.max(
            savedFirst.getTime(),
            savedLast.getTime() -
              SLO_REQUEST_RESTATE_STEPS * SLO_REQUEST_STEP_MILLISECONDS,
          ),
        ),
        to: settledEnd,
      };
      last = settledEnd;
    }
  }

  // Older requests, a piece at a time, until the window is covered.
  const backfill: Array<SloRequestCountingRange> = [];
  let backfillTo: Date = first;

  while (
    backfill.length < SLO_REQUEST_MAX_BACKFILL_CHUNKS &&
    backfillTo.getTime() > neededFrom.getTime()
  ) {
    const backfillFrom: Date = new Date(
      Math.max(neededFrom.getTime(), backfillTo.getTime() - chunkMilliseconds),
    );

    backfill.push({ from: backfillFrom, to: backfillTo });
    backfillTo = backfillFrom;
  }

  return {
    forward: forward,
    backfill: backfill,
    firstAccumulatedBucketStartAt: first,
    lastAccumulatedBucketEndAt: last,
    isRestart: isRestart,
  };
};

export type GetCountedWindowStartFunction = (data: {
  windowStart: Date;
  firstAccumulatedBucketStartAt: Date;
}) => Date;

/*
 * Where the counts for a window start: the window's own start, or the oldest
 * counted step when the counting has not reached it yet. Steps older than the
 * oldest counted one may still hold counts of something the SLO no longer
 * counts (before its services changed), so a sum never reaches past it.
 */
export const getCountedWindowStart: GetCountedWindowStartFunction = (data: {
  windowStart: Date;
  firstAccumulatedBucketStartAt: Date;
}): Date => {
  return new Date(
    Math.max(
      floorToRequestStep(data.windowStart).getTime(),
      data.firstAccumulatedBucketStartAt.getTime(),
    ),
  );
};

export interface SloRequestCounts {
  goodCount: number;
  totalCount: number;
}

export interface SloEventSliResult {
  goodEventCount: number;
  totalEventCount: number;
  badEventCount: number;
  /*
   * UNROUNDED. 100 when nothing was counted: the caller decides what "no
   * requests" means (the worker never reads it as a healthy 100%).
   */
  sliPercentage: number;
}

export type ComputeEventSliFunction = (
  counts: SloRequestCounts,
) => SloEventSliResult;

/*
 * The SLI of a set of counts. A good count above the total (a straggler
 * counted into one series and not yet the other) is held to the total, so a
 * sum never claims more good requests than there were.
 */
export const computeEventSli: ComputeEventSliFunction = (
  counts: SloRequestCounts,
): SloEventSliResult => {
  const totalEventCount: number = Math.max(0, toCount(counts.totalCount));
  const goodEventCount: number = Math.min(
    totalEventCount,
    Math.max(0, toCount(counts.goodCount)),
  );

  return {
    goodEventCount: goodEventCount,
    totalEventCount: totalEventCount,
    badEventCount: totalEventCount - goodEventCount,
    sliPercentage:
      totalEventCount === 0 ? 100 : (goodEventCount / totalEventCount) * 100,
  };
};

export interface SloEventErrorBudget {
  // The bad requests the target allows in the window: allowed share * total.
  budgetTotalEvents: number;
  budgetConsumedEvents: number;
  // SIGNED: negative once more requests were bad than the target allows.
  budgetRemainingEvents: number;
  // Signed, uncapped below 0, capped at 100. UNROUNDED.
  budgetRemainingPercentage: number;
}

export type GetEventErrorBudgetFunction = (data: {
  sli: SloEventSliResult;
  targetPercentage: number;
}) => SloEventErrorBudget;

/*
 * The error budget of a request SLI: SloUtil's budget maths, which is the
 * same for requests as for seconds, in requests.
 */
export const getEventErrorBudget: GetEventErrorBudgetFunction = (data: {
  sli: SloEventSliResult;
  targetPercentage: number;
}): SloEventErrorBudget => {
  const budget: ErrorBudgetResult = SloUtil.getErrorBudget({
    badSeconds: data.sli.badEventCount,
    totalSeconds: data.sli.totalEventCount,
    targetPercentage: data.targetPercentage,
  });

  return {
    budgetTotalEvents: budget.budgetTotalSeconds,
    budgetConsumedEvents: budget.budgetConsumedSeconds,
    budgetRemainingEvents: budget.budgetRemainingSeconds,
    budgetRemainingPercentage: budget.budgetRemainingPercentage,
  };
};

export type ComputeEventBurnRateFunction = (data: {
  counts: SloRequestCounts;
  targetPercentage: number;
}) => number;

// Burn rate over a set of counts: 0 when nothing was counted (no evidence).
export const computeEventBurnRate: ComputeEventBurnRateFunction = (data: {
  counts: SloRequestCounts;
  targetPercentage: number;
}): number => {
  const sli: SloEventSliResult = computeEventSli(data.counts);

  return SloUtil.computeBurnRate({
    badSeconds: sli.badEventCount,
    totalSeconds: sli.totalEventCount,
    targetPercentage: data.targetPercentage,
  });
};

export type GetRequestCountingWindowFillFunction = (data: {
  windowStart: Date;
  windowEnd: Date;
  firstAccumulatedBucketStartAt: Date | undefined | null;
}) => number | null;

/*
 * The share of the window the counts cover, 0..1: 1 once the counting has
 * reached the start of the window, less while it is still counting older
 * requests (a new SLO, or one whose services just changed). Null when
 * nothing has been counted yet.
 */
export const getRequestCountingWindowFill: GetRequestCountingWindowFillFunction =
  (data: {
    windowStart: Date;
    windowEnd: Date;
    firstAccumulatedBucketStartAt: Date | undefined | null;
  }): number | null => {
    if (!data.firstAccumulatedBucketStartAt) {
      return null;
    }

    const windowMilliseconds: number =
      data.windowEnd.getTime() - data.windowStart.getTime();

    if (windowMilliseconds <= 0) {
      return null;
    }

    const coveredMilliseconds: number =
      data.windowEnd.getTime() -
      Math.max(
        data.windowStart.getTime(),
        data.firstAccumulatedBucketStartAt.getTime(),
      );

    return Math.min(1, Math.max(0, coveredMilliseconds / windowMilliseconds));
  };

/*
 * How a bad request is named for the SLI type: a Request Success SLO's bad
 * requests failed, a Request Latency SLO's were slow.
 */
export type GetBadRequestKindFunction = (
  sliType: SliType | string | undefined | null,
) => "failed" | "slow";

export const getBadRequestKind: GetBadRequestKindFunction = (
  sliType: SliType | string | undefined | null,
): "failed" | "slow" => {
  return sliType === SliType.RequestLatency ? "slow" : "failed";
};

export type FormatRequestCountFunction = (count: number) => string;

/*
 * A count of requests in English, for the server's own text (feed items,
 * alert templates, notifications): whole requests, grouped by thousands. The
 * budget is a share of a count and rarely whole ("12.345 failed requests
 * left"), so it is rounded to the nearest request, and a remainder that
 * rounds to nothing reads 0, never -0.
 */
export const formatRequestCount: FormatRequestCountFunction = (
  count: number,
): string => {
  if (typeof count !== "number" || !isFinite(count)) {
    return "";
  }

  const rounded: number = Math.round(Math.abs(count));

  return rounded.toLocaleString("en-US");
};

export type FormatRequestBudgetFunction = (data: {
  sliType: SliType | string | undefined | null;
  remainingEvents: number;
}) => string;

/*
 * "1,234 failed requests" / "1 slow request" - the bad requests a budget has
 * left, unsigned: the caller words an overspent budget ("over budget by").
 */
export const formatRequestBudget: FormatRequestBudgetFunction = (data: {
  sliType: SliType | string | undefined | null;
  remainingEvents: number;
}): string => {
  const count: string = formatRequestCount(data.remainingEvents);

  if (!count) {
    return "";
  }

  const kind: string = getBadRequestKind(data.sliType);
  const noun: string = count === "1" ? "request" : "requests";

  return `${count} ${kind} ${noun}`;
};

type ToCountFunction = (value: number | string | undefined | null) => number;

// A count read from ClickHouse or a decimal column may arrive as a string.
const toCount: ToCountFunction = (
  value: number | string | undefined | null,
): number => {
  const parsed: number =
    typeof value === "number" ? value : parseFloat(String(value ?? ""));

  return isFinite(parsed) ? parsed : 0;
};
