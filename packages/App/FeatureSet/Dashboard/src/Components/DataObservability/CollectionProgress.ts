import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";

/*
 * WHAT COLLECT NOW WAITS FOR.
 *
 * Collect Now only queues a collection: a worker runs it in seconds to a
 * few minutes, a probe at its next poll, within five. So the page asks how
 * the store stands again and again - often at first, when most collections
 * end, then less - until the collection it asked for has ended, collected
 * or failed, and then shows how it went (#9506). A store that failed says
 * so again with the time it tried, so pressing it after a failure always
 * shows that it was tried.
 *
 * A collection has ended once the store's attemptedAt - when its last
 * collection ended - is a new one: not the one the page knew when it was
 * pressed, and not one that ended well before the server asked for it (a
 * page left open while the schedule collected). A worker's clock may run a
 * little behind the server that answered, so "well before" is a minute.
 */

// How soon to ask again after each look: the first few, then COLLECTION_POLL_INTERVAL_IN_MS.
export const COLLECTION_POLL_DELAYS_IN_MS: ReadonlyArray<number> = [
  2_000, 3_000, 5_000, 5_000, 10_000,
];

// How soon to ask again once the first looks have passed.
export const COLLECTION_POLL_INTERVAL_IN_MS: number = 15_000;

// The longest the page waits: a worker's five minutes, or a probe's next poll and its collection.
export const COLLECTION_WAIT_IN_MS: number = 7 * 60 * 1000;

// How far a worker's clock may run behind the server that answered Collect Now.
export const COLLECTION_CLOCK_SKEW_IN_MS: number = 60 * 1000;

// A collection the page asked for, and how the store stood when it did.
export interface CollectionRequest {
  // When the server asked for it, by its own clock; null from a server that does not say.
  requestedAt: string | null;
  // The store's attemptedAt and collectedAt when Collect Now was pressed.
  attemptedAtBefore: string | null;
  collectedAtBefore: string | null;
  // When it was pressed, by the browser's clock: how long the page has waited.
  startedAtMs: number;
}

export function startCollectionRequest(data: {
  store: Pick<DataObservabilityStoreSummary, "attemptedAt" | "collectedAt">;
  requestedAt: string | null;
  nowMs: number;
}): CollectionRequest {
  return {
    requestedAt: data.requestedAt,
    attemptedAtBefore: data.store.attemptedAt || null,
    collectedAtBefore: data.store.collectedAt || null,
    startedAtMs: data.nowMs,
  };
}

// How long to wait before the next look, after this many.
export function getCollectionPollDelayInMs(looks: number): number {
  return (
    COLLECTION_POLL_DELAYS_IN_MS[Math.max(0, looks)] ??
    COLLECTION_POLL_INTERVAL_IN_MS
  );
}

/*
 * Whether the collection asked for has ended: the store's attemptedAt is
 * a new one, or - from a server that keeps no attemptedAt - its
 * collectedAt is.
 */
export function hasRequestedCollectionEnded(
  store: Pick<DataObservabilityStoreSummary, "attemptedAt" | "collectedAt">,
  request: CollectionRequest,
): boolean {
  const askedAtMs: number = request.requestedAt
    ? Date.parse(request.requestedAt)
    : NaN;
  const floorMs: number = Number.isFinite(askedAtMs)
    ? askedAtMs - COLLECTION_CLOCK_SKEW_IN_MS
    : -Infinity;
  const isNew: (
    time: string | null | undefined,
    before: string | null,
  ) => boolean = (
    time: string | null | undefined,
    before: string | null,
  ): boolean => {
    if (!time || time === before) {
      return false;
    }

    const atMs: number = Date.parse(time);

    return Number.isFinite(atMs) && atMs >= floorMs;
  };

  return (
    isNew(store.attemptedAt, request.attemptedAtBefore) ||
    isNew(store.collectedAt, request.collectedAtBefore)
  );
}

// Whether the page has waited as long as a collection may take.
export function hasWaitedForCollectionTooLong(
  request: CollectionRequest,
  nowMs: number,
): boolean {
  return nowMs - request.startedAtMs >= COLLECTION_WAIT_IN_MS;
}
