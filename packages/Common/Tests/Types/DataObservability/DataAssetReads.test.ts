import { describe, expect, test } from "@jest/globals";
import {
  DataAssetReadState,
  DataAssetReadTracking,
  getUnusedCutoff,
  isDataAssetUnused,
  noteObservedRead,
  READ_TIME_PRECISION_IN_SECONDS,
  trackDataAssetReads,
  UNUSED_AFTER_DAYS,
} from "../../../Types/DataObservability/DataAssetReads";

/*
 * A table's reads are told by the engine's read counter moving between two
 * collections, by the engine's own time of its last read, or by a service's
 * database span - and a counter of 0 at the first collection says it has
 * not been read since the engine's statistics started.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function track(data: {
  previous?: DataAssetReadState | null;
  readCount?: number | null;
  secondsSinceRead?: number | null;
  secondsSinceStatsReset?: number | null;
  collectedAt?: Date;
}): DataAssetReadTracking {
  return trackDataAssetReads({
    previous: data.previous ?? null,
    readCount: data.readCount ?? null,
    secondsSinceRead: data.secondsSinceRead ?? null,
    secondsSinceStatsReset: data.secondsSinceStatsReset ?? null,
    collectedAt: data.collectedAt ?? NOW,
  });
}

describe("trackDataAssetReads", () => {
  test("a counter of 0 at first sight: not read since the statistics started", () => {
    expect(
      track({ readCount: 0, secondsSinceStatsReset: 200 * 24 * 60 * 60 }).state,
    ).toEqual({
      readCount: 0,
      lastReadAt: null,
      unreadSince: ago(200 * DAY),
    });
  });

  test("a counter above 0 at first sight: read, at a time not known, so nothing before now", () => {
    expect(
      track({ readCount: 42, secondsSinceStatsReset: 1000 }).state,
    ).toEqual({ readCount: 42, lastReadAt: null, unreadSince: NOW });
  });

  test("a counter that moved: read between the collections", () => {
    const tracking: DataAssetReadTracking = track({
      previous: { readCount: 42, lastReadAt: ago(DAY), unreadSince: ago(DAY) },
      readCount: 50,
    });

    expect(tracking.state).toEqual({
      readCount: 50,
      lastReadAt: NOW,
      unreadSince: NOW,
    });
    expect(tracking.isChanged).toBe(true);
  });

  test("a counter that moved within the hour of the last read kept: nothing to write", () => {
    const previous: DataAssetReadState = {
      readCount: 42,
      lastReadAt: ago(10 * 60 * 1000),
      unreadSince: ago(10 * 60 * 1000),
    };
    const tracking: DataAssetReadTracking = track({ previous, readCount: 50 });

    // The counter waits with the read: the next collection still sees it moved.
    expect(tracking.state).toEqual(previous);
    expect(tracking.isChanged).toBe(false);
  });

  test("a counter that stood still: no read, nothing changes", () => {
    const previous: DataAssetReadState = {
      readCount: 0,
      lastReadAt: null,
      unreadSince: ago(120 * DAY),
    };

    expect(track({ previous, readCount: 0 })).toEqual({
      state: previous,
      isChanged: false,
    });
  });

  test("a counter that went down was reset: read since the reset when above 0", () => {
    expect(
      track({
        previous: {
          readCount: 900,
          lastReadAt: ago(3 * DAY),
          unreadSince: ago(3 * DAY),
        },
        readCount: 4,
      }).state,
    ).toEqual({ readCount: 4, lastReadAt: NOW, unreadSince: NOW });
    expect(
      track({
        previous: {
          readCount: 900,
          lastReadAt: ago(3 * DAY),
          unreadSince: ago(3 * DAY),
        },
        readCount: 0,
        secondsSinceStatsReset: 60,
      }).state,
    ).toEqual({
      readCount: 0,
      lastReadAt: ago(3 * DAY),
      unreadSince: ago(60 * 1000),
    });
  });

  test("the engine's own time of the last read is taken as it is", () => {
    expect(
      track({ secondsSinceRead: 5 * 24 * 60 * 60, readCount: 7 }).state,
    ).toEqual({
      readCount: null,
      lastReadAt: ago(5 * DAY),
      unreadSince: ago(5 * DAY),
    });
  });

  test("no counter: nothing can be said", () => {
    expect(track({}).state).toEqual({
      readCount: null,
      lastReadAt: null,
      unreadSince: null,
    });
  });
});

describe("noteObservedRead", () => {
  test("a read a span saw moves the last read up", () => {
    expect(
      noteObservedRead(
        { readCount: 0, lastReadAt: null, unreadSince: ago(200 * DAY) },
        ago(HOUR * 2),
      ).state,
    ).toEqual({
      readCount: 0,
      lastReadAt: ago(HOUR * 2),
      unreadSince: ago(HOUR * 2),
    });
  });

  test("an older read, or one within the hour of the last, changes nothing", () => {
    const state: DataAssetReadState = {
      readCount: null,
      lastReadAt: ago(HOUR),
      unreadSince: ago(HOUR),
    };

    expect(noteObservedRead(state, ago(2 * HOUR)).isChanged).toBe(false);
    expect(
      noteObservedRead(
        state,
        new Date(
          ago(HOUR).getTime() + (READ_TIME_PRECISION_IN_SECONDS - 60) * 1000,
        ),
      ).isChanged,
    ).toBe(false);
  });
});

describe("isDataAssetUnused", () => {
  test("unused after 90 days without a read", () => {
    expect(UNUSED_AFTER_DAYS).toBe(90);
    expect(isDataAssetUnused({ unreadSince: ago(91 * DAY), now: NOW })).toBe(
      true,
    );
    expect(isDataAssetUnused({ unreadSince: ago(89 * DAY), now: NOW })).toBe(
      false,
    );
    expect(isDataAssetUnused({ unreadSince: null, now: NOW })).toBe(false);
    expect(getUnusedCutoff(NOW)).toEqual(ago(90 * DAY));
  });
});
