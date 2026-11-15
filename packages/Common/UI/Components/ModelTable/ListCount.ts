/*
 * HOW FAR A LIST COUNTS ITS RECORDS.
 *
 * The line under a list - "Showing 1-10 of 240 incidents" - used to cost a
 * count of every matching record: on a project that keeps its alerts for
 * ever, a million records read for the "of", every time the list was read.
 * A live list (LiveRows.ts) reads itself again as often as every five
 * seconds while things change, and every visible tab does so on its own.
 *
 * A list now asks for its count up to LIST_COUNT_UP_TO records (the API's
 * countUpTo; BaseAPI.getList). Fewer match: the count is exact, as before.
 * More match: the server stops counting and says so (isCountCapped), the
 * line reads "Showing 1-10 of 10,000+ incidents", and the list pages by
 * previous and next - a numbered last page would claim an end it does not
 * know. A capped count also says records follow the page it was read
 * with: the server counts at least to that page's end.
 *
 * A live read of a list already at "10,000+" does not count again: it asks
 * only as far as its own page (countUpTo 1, which the server raises to the
 * end of the page), which costs the page's own records, and keeps the
 * "10,000+" it showed - unless that shows the list is shorter now, when
 * the exact count takes its place.
 *
 * A drag-ordered list counts exactly: its rows are numbered from the total
 * (BaseModelTable's onRowDropped), and it is a short list of settings.
 */

// How many records a list counts before it says "10,000+".
export const LIST_COUNT_UP_TO: number = 10_000;

/*
 * What a live read of a capped list asks for: the end of its own page,
 * which the server counts to whatever this says.
 */
export const LIVE_READ_OF_CAPPED_LIST_COUNT_UP_TO: number = 1;

// What a list knows of its count.
export interface ListCountState {
  // The count to print: exact, or the cap when isCapped.
  total: number;
  // More records match than total.
  isCapped: boolean;
}

export const EMPTY_LIST_COUNT: ListCountState = {
  total: 0,
  isCapped: false,
};

// The countUpTo a list's read asks for; undefined asks for an exact count.
export const getListCountUpTo: (input: {
  isManuallyOrdered: boolean;
  // A read the list made itself to stay current (UseLiveRows).
  isLiveRead: boolean;
  // What the list knows of its count before this read.
  previous: ListCountState;
}) => number | undefined = (input: {
  isManuallyOrdered: boolean;
  isLiveRead: boolean;
  previous: ListCountState;
}): number | undefined => {
  if (input.isManuallyOrdered) {
    return undefined;
  }

  if (input.isLiveRead && input.previous.isCapped) {
    return LIVE_READ_OF_CAPPED_LIST_COUNT_UP_TO;
  }

  return LIST_COUNT_UP_TO;
};

// What a list knows of its count once a read answers.
export const getNextListCount: (input: {
  previous: ListCountState;
  result: { count: number; isCountCapped?: boolean | undefined };
  isLiveRead: boolean;
}) => ListCountState = (input: {
  previous: ListCountState;
  result: { count: number; isCountCapped?: boolean | undefined };
  isLiveRead: boolean;
}): ListCountState => {
  const count: number = Math.max(Math.floor(input.result.count) || 0, 0);

  if (!input.result.isCountCapped) {
    return { total: count, isCapped: false };
  }

  /*
   * A live read of a capped list counted only to its page's end: still
   * capped, the "10,000+" it showed stands.
   */
  if (input.isLiveRead && input.previous.isCapped) {
    return {
      total: Math.max(input.previous.total, count),
      isCapped: true,
    };
  }

  return { total: count, isCapped: true };
};

/*
 * Whether records follow the page, for a list that pages by previous and
 * next: always, for a capped count (the server counted past the page's
 * end and found more); otherwise what the read said (an analytics list's
 * hasMore), or undefined - the list pages by its exact count.
 */
export const getListHasMore: (input: {
  count: ListCountState;
  hasMore: boolean | undefined;
}) => boolean | undefined = (input: {
  count: ListCountState;
  hasMore: boolean | undefined;
}): boolean | undefined => {
  if (input.count.isCapped) {
    return true;
  }

  return input.hasMore;
};
