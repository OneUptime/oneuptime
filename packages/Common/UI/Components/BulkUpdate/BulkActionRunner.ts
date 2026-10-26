import GenericObject from "../../../Types/GenericObject";
import API from "../../Utils/API/API";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionUnchanged,
} from "./BulkUpdateForm";

/*
 * The per-item loop every bulk action runs, in one place.
 *
 * Each item ends in exactly one of four lists, which is what the progress
 * modal shows (BulkUpdateForm):
 *
 *   - changed:     the step resolved (with nothing, or CHANGED);
 *   - unchanged:   the step looked at the item and left it alone on purpose,
 *                  and says why - a device nothing polls, one already in the
 *                  state asked for;
 *   - failed:      the step threw. The message is the server's, through
 *                  API.getFriendlyMessage, so a refused permission or a
 *                  validation error is reported in the words that explain it;
 *   - not started: the person stopped the run before it reached the item
 *                  (BulkActionOnClickProps.stopSignal). Nothing was done to
 *                  it.
 *
 * The lists are always reported in the order the items were selected, not
 * the order they finished in, so a result read twice reads the same.
 *
 * Several items are worked on at once (BULK_ACTION_CONCURRENCY), each still
 * through its own step - the same API request, permission checks and
 * server-side follow-ons as changing that one item alone. A failure fails
 * only its own item. A stop lets the steps already running finish and starts
 * no more. The modal hears about the run at most every
 * BULK_PROGRESS_INTERVAL_IN_MS, and always once at the end: a run of
 * thousands of items that finish in a burst used to rebuild every list after
 * every item.
 */

export enum BulkItemStatus {
  Changed = "changed",
  Unchanged = "unchanged",
}

export type BulkItemOutcome =
  | { status: BulkItemStatus.Changed }
  | { status: BulkItemStatus.Unchanged; reason: string };

export const BULK_ITEM_CHANGED: BulkItemOutcome = {
  status: BulkItemStatus.Changed,
};

export function bulkItemUnchanged(reason: string): BulkItemOutcome {
  return {
    status: BulkItemStatus.Unchanged,
    reason: reason,
  };
}

/*
 * How many items a bulk action works on at once unless it says otherwise.
 *
 * Four: while one item's request waits on the database or on Slack, the
 * server works on the next. And four leave room for the page itself - a
 * browser keeps six connections to one server over HTTP/1.1, and the side
 * menu's counts and the page's other reads go on through the other two.
 *
 * An action passes 1 when its items' writes read shared state on the server
 * (a plan's monitor count, a network site's health rollup): each write must
 * see the one before it finished.
 */
export const BULK_ACTION_CONCURRENCY: number = 4;

/*
 * How often, at most, a run tells the progress modal where it is. Ten times
 * a second is smooth to watch, and a run that finishes thousands of items in
 * a burst (each one left alone, say) builds its lists ten times a second
 * instead of once per item.
 */
export const BULK_PROGRESS_INTERVAL_IN_MS: number = 100;

/*
 * A run guesses how long it has left once it has run this long - before
 * that, the first few items (a cold cache, the first page of a read) say
 * little about the rest.
 */
export const BULK_ESTIMATE_AFTER_IN_MS: number = 2000;

// Where a run reads the time and waits. Tests pass their own.
export interface BulkActionClock {
  now: () => number;
  setTimeout: (callback: () => void, delayInMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export const SYSTEM_BULK_ACTION_CLOCK: BulkActionClock = {
  now: (): number => {
    return Date.now();
  },
  setTimeout: (callback: () => void, delayInMs: number): unknown => {
    return setTimeout(callback, delayInMs);
  },
  clearTimeout: (handle: unknown): void => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface BulkActionRunResult<T extends GenericObject> {
  changed: Array<T>;
  unchanged: Array<BulkActionUnchanged<T>>;
  failed: Array<BulkActionFailed<T>>;
  // Never started: the person stopped the run before it reached them.
  notStarted: Array<T>;
}

export interface RunBulkActionOptions<T extends GenericObject> {
  actionProps: BulkActionOnClickProps<T>;
  /*
   * What to do to one item. Resolving with nothing means it was changed.
   * Throwing means it failed, and the error's message is what the result
   * shows against it.
   */
  step: (item: T) => Promise<BulkItemOutcome | void>;
  /*
   * How many items are worked on at once: BULK_ACTION_CONCURRENCY unless the
   * caller says otherwise. 1 when the items' writes read shared state on the
   * server and each has to see the one before it finished (see
   * BULK_ACTION_CONCURRENCY).
   */
  concurrency?: number | undefined;
  /*
   * Whether the person may stop the run part-way. On by default. Off for an
   * action whose items all go in one request (everything is started at
   * once, so there is nothing left to not start).
   */
  isStoppable?: boolean | undefined;
  // How often the modal hears about the run (BULK_PROGRESS_INTERVAL_IN_MS).
  progressIntervalInMs?: number | undefined;
  clock?: BulkActionClock | undefined;
}

type ItemResult<T extends GenericObject> =
  | { kind: "changed" }
  | { kind: "unchanged"; entry: BulkActionUnchanged<T> }
  | { kind: "failed"; entry: BulkActionFailed<T> };

/*
 * How long a run has left, from how long the items done so far took: the
 * rate so far, applied to what is left. Undefined until there is enough to
 * go on (BULK_ESTIMATE_AFTER_IN_MS, and at least one item done) and once
 * nothing is left.
 */
export function estimateBulkTimeLeftInMs(data: {
  doneCount: number;
  totalCount: number;
  elapsedInMs: number;
}): number | undefined {
  const left: number = data.totalCount - data.doneCount;

  if (
    data.doneCount <= 0 ||
    left <= 0 ||
    !(data.elapsedInMs >= BULK_ESTIMATE_AFTER_IN_MS)
  ) {
    return undefined;
  }

  return Math.round((data.elapsedInMs / data.doneCount) * left);
}

export function getBulkActionConcurrency(
  concurrency: number | undefined,
): number {
  if (concurrency === undefined) {
    return BULK_ACTION_CONCURRENCY;
  }

  // Anything that is not a whole number of at least one runs one at a time.
  const whole: number = Math.floor(concurrency);

  return Number.isFinite(whole) && whole >= 1 ? whole : 1;
}

export async function runBulkAction<T extends GenericObject>(
  options: RunBulkActionOptions<T>,
): Promise<BulkActionRunResult<T>> {
  const {
    items,
    onProgressInfo,
    onBulkActionStart,
    onBulkActionEnd,
    stopSignal,
  } = options.actionProps;

  const clock: BulkActionClock = options.clock || SYSTEM_BULK_ACTION_CLOCK;
  const progressIntervalInMs: number = Math.max(
    0,
    options.progressIntervalInMs ?? BULK_PROGRESS_INTERVAL_IN_MS,
  );
  const isStoppable: boolean = options.isStoppable !== false;

  const totalItems: Array<T> = [...items];
  const results: Array<ItemResult<T> | undefined> = totalItems.map(() => {
    return undefined;
  });

  const concurrency: number = getBulkActionConcurrency(options.concurrency);

  // How far the run got: items started, and items finished.
  let nextIndex: number = 0;
  let doneCount: number = 0;
  let wasStopped: boolean = false;

  const startedAt: number = clock.now();
  // When the modal last heard: the first item done is reported at once.
  let lastReportAt: number | null = null;
  // A report held back by the interval, sent when it has passed.
  let heldReport: unknown = null;
  let isFinished: boolean = false;

  type Snapshot = BulkActionRunResult<T> & { inProgress: Array<T> };

  /*
   * Rebuilt from the results array each time, so the lists keep selection
   * order. An item with no result is still running - or, once the run has
   * stopped, was never started.
   */
  const collect: () => Snapshot = (): Snapshot => {
    const changed: Array<T> = [];
    const unchanged: Array<BulkActionUnchanged<T>> = [];
    const failed: Array<BulkActionFailed<T>> = [];
    const inProgress: Array<T> = [];
    const notStarted: Array<T> = [];

    totalItems.forEach((item: T, index: number) => {
      const result: ItemResult<T> | undefined = results[index];

      if (!result) {
        if (wasStopped && index >= nextIndex) {
          notStarted.push(item);
        } else {
          inProgress.push(item);
        }
        return;
      }

      if (result.kind === "changed") {
        changed.push(item);
      } else if (result.kind === "unchanged") {
        unchanged.push(result.entry);
      } else {
        failed.push(result.entry);
      }
    });

    return { changed, unchanged, failed, notStarted, inProgress };
  };

  const report: (isFinal: boolean) => Snapshot | null = (
    isFinal: boolean,
  ): Snapshot | null => {
    const now: number = clock.now();

    if (!isFinal && lastReportAt !== null) {
      const waitInMs: number = lastReportAt + progressIntervalInMs - now;

      /*
       * Too soon after the last one: held back, and sent once the interval
       * has passed - so a burst of items done, then a slow one, still moves
       * the bar while the slow one runs.
       */
      if (waitInMs > 0) {
        if (heldReport === null) {
          heldReport = clock.setTimeout((): void => {
            heldReport = null;

            if (!isFinished) {
              report(false);
            }
          }, waitInMs);
        }

        return null;
      }
    }

    if (heldReport !== null) {
      clock.clearTimeout(heldReport);
      heldReport = null;
    }

    lastReportAt = now;

    const snapshot: Snapshot = collect();

    const estimatedTimeLeftInMs: number | undefined = isFinal
      ? undefined
      : estimateBulkTimeLeftInMs({
          doneCount: doneCount,
          totalCount: totalItems.length,
          elapsedInMs: now - startedAt,
        });

    onProgressInfo({
      totalItems: totalItems,
      successItems: snapshot.changed,
      failed: snapshot.failed,
      unchanged: snapshot.unchanged,
      inProgressItems: snapshot.inProgress,
      ...(snapshot.notStarted.length > 0
        ? { notStartedItems: snapshot.notStarted }
        : {}),
      ...(estimatedTimeLeftInMs !== undefined
        ? { estimatedTimeLeftInMs: estimatedTimeLeftInMs }
        : {}),
    });

    return snapshot;
  };

  type RunOneFunction = (index: number) => Promise<void>;

  const runOne: RunOneFunction = async (index: number): Promise<void> => {
    const item: T = totalItems[index]!;

    try {
      const outcome: BulkItemOutcome | void = await options.step(item);

      results[index] =
        outcome && outcome.status === BulkItemStatus.Unchanged
          ? {
              kind: "unchanged",
              entry: { item: item, reason: outcome.reason },
            }
          : { kind: "changed" };
    } catch (err) {
      results[index] = {
        kind: "failed",
        entry: { item: item, failedMessage: API.getFriendlyMessage(err) },
      };
    }

    doneCount += 1;

    // The last item's report is the final one, sent once every worker is done.
    if (doneCount < totalItems.length) {
      report(false);
    }
  };

  onBulkActionStart({ isStoppable: isStoppable });

  let finalSnapshot: Snapshot | null = null;

  try {
    type WorkerFunction = () => Promise<void>;

    // Each worker takes the next item as soon as it is free.
    const worker: WorkerFunction = async (): Promise<void> => {
      while (nextIndex < totalItems.length) {
        if (isStoppable && stopSignal?.aborted) {
          wasStopped = true;
          return;
        }

        const index: number = nextIndex;
        nextIndex += 1;
        await runOne(index);
      }
    };

    const workers: Array<Promise<void>> = [];

    for (let i: number = 0; i < Math.min(concurrency, totalItems.length); i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    if (totalItems.length > 0) {
      finalSnapshot = report(true);
    }
  } finally {
    isFinished = true;

    if (heldReport !== null) {
      clock.clearTimeout(heldReport);
      heldReport = null;
    }

    onBulkActionEnd();
  }

  const snapshot: Snapshot = finalSnapshot || collect();

  return {
    changed: snapshot.changed,
    unchanged: snapshot.unchanged,
    failed: snapshot.failed,
    notStarted: snapshot.notStarted,
  };
}
