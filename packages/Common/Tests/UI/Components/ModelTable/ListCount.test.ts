import {
  EMPTY_LIST_COUNT,
  LIST_COUNT_UP_TO,
  LIVE_READ_OF_CAPPED_LIST_COUNT_UP_TO,
  ListCountState,
  getListCountUpTo,
  getListHasMore,
  getNextListCount,
} from "../../../../UI/Components/ModelTable/ListCount";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * HOW FAR A LIST COUNTS ITS RECORDS (ListCount.ts).
 *
 * A list asks for its count up to 10,000; past that it reads "10,000+" and
 * pages by previous and next. A live read of a list already at "10,000+"
 * counts only to its own page's end and keeps what it showed, unless that
 * shows the list is shorter now. A drag-ordered list counts exactly.
 */

const CAPPED: ListCountState = { total: 10000, isCapped: true };
const EXACT: ListCountState = { total: 240, isCapped: false };

describe("the count a read asks for", () => {
  it("is 10,000, for a read the reader asked for", () => {
    expect(LIST_COUNT_UP_TO).toBe(10000);

    for (const previous of [EMPTY_LIST_COUNT, EXACT, CAPPED]) {
      expect(
        getListCountUpTo({
          isManuallyOrdered: false,
          isLiveRead: false,
          previous: previous,
        }),
      ).toBe(10000);
    }
  });

  it("is 10,000 for a live read of a list whose count was exact: it may have grown", () => {
    expect(
      getListCountUpTo({
        isManuallyOrdered: false,
        isLiveRead: true,
        previous: EXACT,
      }),
    ).toBe(10000);
    expect(
      getListCountUpTo({
        isManuallyOrdered: false,
        isLiveRead: true,
        previous: EMPTY_LIST_COUNT,
      }),
    ).toBe(10000);
  });

  it("is the page's end for a live read of a list already capped: no count again", () => {
    expect(LIVE_READ_OF_CAPPED_LIST_COUNT_UP_TO).toBe(1);
    expect(
      getListCountUpTo({
        isManuallyOrdered: false,
        isLiveRead: true,
        previous: CAPPED,
      }),
    ).toBe(1);
  });

  it("is exact for a drag-ordered list, live or not", () => {
    for (const isLiveRead of [false, true]) {
      for (const previous of [EMPTY_LIST_COUNT, EXACT, CAPPED]) {
        expect(
          getListCountUpTo({
            isManuallyOrdered: true,
            isLiveRead: isLiveRead,
            previous: previous,
          }),
        ).toBeUndefined();
      }
    }
  });
});

describe("what a list knows of its count once a read answers", () => {
  it("takes an exact count as it is, whatever it knew before", () => {
    for (const isLiveRead of [false, true]) {
      for (const previous of [EMPTY_LIST_COUNT, EXACT, CAPPED]) {
        expect(
          getNextListCount({
            previous: previous,
            result: { count: 37 },
            isLiveRead: isLiveRead,
          }),
        ).toEqual({ total: 37, isCapped: false });
      }
    }
  });

  it("takes a capped count as the cap, on a read the reader asked for", () => {
    expect(
      getNextListCount({
        previous: EXACT,
        result: { count: 10000, isCountCapped: true },
        isLiveRead: false,
      }),
    ).toEqual({ total: 10000, isCapped: true });

    // A page far down a long list: the server counted to its end.
    expect(
      getNextListCount({
        previous: CAPPED,
        result: { count: 20010, isCountCapped: true },
        isLiveRead: false,
      }),
    ).toEqual({ total: 20010, isCapped: true });

    // Back near the top after that: the smaller cap, as the server said.
    expect(
      getNextListCount({
        previous: { total: 20010, isCapped: true },
        result: { count: 10000, isCountCapped: true },
        isLiveRead: false,
      }),
    ).toEqual({ total: 10000, isCapped: true });
  });

  it("keeps the 10,000+ it showed when a live read of a capped list counted only to its page's end", () => {
    expect(
      getNextListCount({
        previous: CAPPED,
        result: { count: 10, isCountCapped: true },
        isLiveRead: true,
      }),
    ).toEqual({ total: 10000, isCapped: true });
  });

  it("takes the exact count when a live read of a capped list finds it shorter now", () => {
    expect(
      getNextListCount({
        previous: CAPPED,
        result: { count: 6 },
        isLiveRead: true,
      }),
    ).toEqual({ total: 6, isCapped: false });
  });

  it("takes a live read's cap as it is when the list was not capped before", () => {
    expect(
      getNextListCount({
        previous: EXACT,
        result: { count: 10000, isCountCapped: true },
        isLiveRead: true,
      }),
    ).toEqual({ total: 10000, isCapped: true });
  });

  it("reads a count that is not a whole number of records as the nearest below, never negative", () => {
    expect(
      getNextListCount({
        previous: EMPTY_LIST_COUNT,
        result: { count: 12.7 },
        isLiveRead: false,
      }),
    ).toEqual({ total: 12, isCapped: false });
    expect(
      getNextListCount({
        previous: EMPTY_LIST_COUNT,
        result: { count: -3 },
        isLiveRead: false,
      }),
    ).toEqual({ total: 0, isCapped: false });
    expect(
      getNextListCount({
        previous: EMPTY_LIST_COUNT,
        result: { count: Number.NaN },
        isLiveRead: false,
      }),
    ).toEqual({ total: 0, isCapped: false });
  });

  /*
   * A NOC wall's list through a run of live reads: it reads "10,000+" from
   * the first load on, every live read after that costs only its page, and
   * the reader's own read (Refresh) counts again.
   */
  it("follows a capped list through live reads and a refresh", () => {
    let state: ListCountState = EMPTY_LIST_COUNT;
    const asked: Array<number | undefined> = [];

    const read: (isLiveRead: boolean, matching: number) => void = (
      isLiveRead: boolean,
      matching: number,
    ): void => {
      const countUpTo: number | undefined = getListCountUpTo({
        isManuallyOrdered: false,
        isLiveRead: isLiveRead,
        previous: state,
      });
      asked.push(countUpTo);

      // The server: up to max(countUpTo, page end = 10), then capped.
      const cap: number = Math.max(countUpTo as number, 10);
      const result: { count: number; isCountCapped?: boolean } =
        matching > cap
          ? { count: cap, isCountCapped: true }
          : { count: matching };

      state = getNextListCount({
        previous: state,
        result: result,
        isLiveRead: isLiveRead,
      });
    };

    read(false, 1_000_000);
    expect(state).toEqual({ total: 10000, isCapped: true });

    read(true, 1_000_001);
    read(true, 1_000_002);
    expect(state).toEqual({ total: 10000, isCapped: true });

    read(false, 1_000_003);
    expect(state).toEqual({ total: 10000, isCapped: true });

    expect(asked).toEqual([10000, 1, 1, 10000]);
  });
});

describe("whether records follow the page", () => {
  it("is always so for a capped count: the server counted past the page's end", () => {
    expect(getListHasMore({ count: CAPPED, hasMore: undefined })).toBe(true);
    expect(getListHasMore({ count: CAPPED, hasMore: false })).toBe(true);
  });

  it("is what the read said otherwise - undefined pages by the exact count", () => {
    expect(getListHasMore({ count: EXACT, hasMore: undefined })).toBe(
      undefined,
    );
    expect(getListHasMore({ count: EXACT, hasMore: true })).toBe(true);
    expect(getListHasMore({ count: EXACT, hasMore: false })).toBe(false);
  });
});

/*
 * The table asks with these rules on every read, a live one included, and
 * shows what they say: read from its source, whitespace folded, as
 * PagedFindSql reads DatabaseService.
 */
describe("BaseModelTable reads through these rules", () => {
  const source: string = fs
    .readFileSync(
      path.join(
        __dirname,
        "../../../../UI/Components/ModelTable/BaseModelTable.tsx",
      ),
      "utf8",
    )
    .split(/\s+/)
    .join("");

  it("asks for its count with getListCountUpTo, telling it whether the read is live", () => {
    expect(source).toContain(
      "countUpTo:getListCountUpTo({isManuallyOrdered:isManuallyOrdered,isLiveRead:isBackground,previous:listCountRef.current,}),",
    );
  });

  it("keeps what it knows of its count with getNextListCount, and pages by getListHasMore", () => {
    expect(source).toContain(
      "constlistCount:ListCountState=getNextListCount({previous:listCountRef.current,result:listResult,isLiveRead:isBackground,});listCountRef.current=listCount;setTotalItemsCount(listCount.total);setIsCountCapped(listCount.isCapped);setHasMore(getListHasMore({count:listCount,hasMore:listResult.hasMore}),);",
    );
  });

  it("hands the cap to its table and its list", () => {
    expect(
      source.split("isCountCapped={isCountCapped}").length - 1,
    ).toBeGreaterThanOrEqual(2);
  });
});
