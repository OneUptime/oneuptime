import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_CHANGE_RECENT_IDS_MAX,
  forgetStalePlaces,
  getChangePlace,
  getChangeWindowStart,
  keepNewChanges,
} from "../../../../Server/Utils/CloudConnection/CloudChangeWindow";
import {
  CloudChange,
  CloudConnectionPullState,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";

/*
 * Which stretch of an activity log each read looks at: two hours back the
 * first time, twenty minutes before where the last read stopped after
 * that, a day back at most - and the changes a read sees again because
 * the logs deliver late are never written twice, while what is remembered
 * stays the size of what the next read can bring in again.
 */

const NOW: Date = new Date("2026-10-21T12:00:00Z");
const MINUTE: number = 60 * 1000;
const PLACE: string = "123456789012|eu-west-1";

function change(eventId: string, at: Date): CloudChange {
  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: "123456789012",
    region: "eu-west-1",
    time: at,
    eventId,
    operation: "ec2:RunInstances",
    actor: "someone",
    resources: [],
    failed: false,
  };
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

describe("a place", () => {
  test("is an account and a Region, or the account alone", () => {
    expect(getChangePlace("123456789012", "eu-west-1")).toBe(
      "123456789012|eu-west-1",
    );
    expect(getChangePlace("acme-prod", "")).toBe("acme-prod");
  });
});

describe("where a read starts", () => {
  test("a place never read starts two hours back", () => {
    expect(getChangeWindowStart({ state: {}, place: PLACE, now: NOW })).toEqual(
      minutesAgo(120),
    );
  });

  test("a place read before starts twenty minutes before where it stopped", () => {
    expect(
      getChangeWindowStart({
        state: { changeCursors: { [PLACE]: minutesAgo(5).toISOString() } },
        place: PLACE,
        now: NOW,
      }),
    ).toEqual(minutesAgo(25));
  });

  test("after a long pause, a day back at most", () => {
    expect(
      getChangeWindowStart({
        state: {
          changeCursors: { [PLACE]: minutesAgo(3 * 24 * 60).toISOString() },
        },
        place: PLACE,
        now: NOW,
      }),
    ).toEqual(minutesAgo(24 * 60));
  });

  test("an investigation's look back starts where it says", () => {
    const since: Date = minutesAgo(600);

    expect(
      getChangeWindowStart({
        state: { changeCursors: { [PLACE]: NOW.toISOString() } },
        place: PLACE,
        now: NOW,
        since,
      }),
    ).toEqual(since);
  });

  test("a cursor that is not a time is a place never read", () => {
    expect(
      getChangeWindowStart({
        state: { changeCursors: { [PLACE]: "yesterday" } },
        place: PLACE,
        now: NOW,
      }),
    ).toEqual(minutesAgo(120));
  });
});

describe("the changes a read keeps", () => {
  test("are the ones not seen before, oldest first, and the cursor moves to now", () => {
    const state: CloudConnectionPullState = {};

    const fresh: Array<CloudChange> = keepNewChanges({
      state,
      place: PLACE,
      changes: [
        change("b", minutesAgo(10)),
        change("a", minutesAgo(30)),
        change("", minutesAgo(5)),
        change("b", minutesAgo(10)),
      ],
      now: NOW,
      complete: true,
      isLookBack: false,
    });

    expect(
      fresh.map((entry: CloudChange): string => {
        return entry.eventId;
      }),
    ).toEqual(["a", "b"]);
    expect(state.changeCursors).toEqual({ [PLACE]: NOW.toISOString() });
    // Only what the next read - from twenty minutes back - can bring again.
    expect(state.recentChanges).toEqual({
      [PLACE]: { b: minutesAgo(10).getTime() },
    });
  });

  test("a change read again is not kept twice", () => {
    const state: CloudConnectionPullState = {};

    keepNewChanges({
      state,
      place: PLACE,
      changes: [change("a", minutesAgo(3))],
      now: NOW,
      complete: true,
      isLookBack: false,
    });

    const later: Date = new Date(NOW.getTime() + 5 * MINUTE);
    const fresh: Array<CloudChange> = keepNewChanges({
      state,
      place: PLACE,
      changes: [change("a", minutesAgo(3)), change("c", minutesAgo(1))],
      now: later,
      complete: true,
      isLookBack: false,
    });

    expect(
      fresh.map((entry: CloudChange): string => {
        return entry.eventId;
      }),
    ).toEqual(["c"]);
    expect(Object.keys(state.recentChanges?.[PLACE] || {}).sort()).toEqual([
      "a",
      "c",
    ]);
  });

  test("a place read only in part keeps its cursor, and remembers what it did read", () => {
    const state: CloudConnectionPullState = {
      changeCursors: { [PLACE]: minutesAgo(15).toISOString() },
    };

    keepNewChanges({
      state,
      place: PLACE,
      changes: [change("a", minutesAgo(2))],
      now: NOW,
      complete: false,
      isLookBack: false,
    });

    expect(state.changeCursors).toEqual({
      [PLACE]: minutesAgo(15).toISOString(),
    });
    expect(state.recentChanges?.[PLACE]).toEqual({
      a: minutesAgo(2).getTime(),
    });
  });

  test("an investigation's look back moves nothing", () => {
    const state: CloudConnectionPullState = {
      changeCursors: { [PLACE]: minutesAgo(5).toISOString() },
      recentChanges: { [PLACE]: { a: minutesAgo(6).getTime() } },
    };
    const before: string = JSON.stringify(state);

    const fresh: Array<CloudChange> = keepNewChanges({
      state,
      place: PLACE,
      changes: [change("a", minutesAgo(6)), change("old", minutesAgo(300))],
      now: NOW,
      complete: true,
      isLookBack: true,
    });

    // What the regular reads already wrote is not written again.
    expect(
      fresh.map((entry: CloudChange): string => {
        return entry.eventId;
      }),
    ).toEqual(["old"]);
    expect(JSON.stringify(state)).toBe(before);
  });

  test("remembers the newest few hundred at most", () => {
    const state: CloudConnectionPullState = {};
    const many: Array<CloudChange> = [];

    for (
      let index: number = 0;
      index < CLOUD_CHANGE_RECENT_IDS_MAX + 50;
      index++
    ) {
      many.push(change(`e${index}`, new Date(NOW.getTime() - index * 1000)));
    }

    keepNewChanges({
      state,
      place: PLACE,
      changes: many,
      now: NOW,
      complete: false,
      isLookBack: false,
    });

    const kept: Record<string, number> = state.recentChanges?.[PLACE] || {};
    expect(Object.keys(kept)).toHaveLength(CLOUD_CHANGE_RECENT_IDS_MAX);
    expect(kept["e0"]).toBeDefined();
    expect(kept[`e${CLOUD_CHANGE_RECENT_IDS_MAX + 49}`]).toBeUndefined();
  });

  test("a place with nothing left to remember is dropped", () => {
    const state: CloudConnectionPullState = {
      recentChanges: { [PLACE]: { a: minutesAgo(200).getTime() } },
    };

    keepNewChanges({
      state,
      place: PLACE,
      changes: [],
      now: NOW,
      complete: true,
      isLookBack: false,
    });

    expect(state.recentChanges).toEqual({});
  });
});

describe("places no read reaches any more", () => {
  test("are forgotten after a day; the others are kept", () => {
    const stale: string = "210987654321|eu-west-1";
    const state: CloudConnectionPullState = {
      changeCursors: {
        [PLACE]: minutesAgo(5).toISOString(),
        [stale]: minutesAgo(25 * 60).toISOString(),
      },
      recentChanges: {
        [PLACE]: { a: minutesAgo(10).getTime() },
        [stale]: { b: minutesAgo(25 * 60).getTime() },
        // Read only in part, with nothing newer than a day.
        "acme-prod": { c: minutesAgo(30 * 60).getTime() },
      },
    };

    forgetStalePlaces(state, NOW);

    expect(state.changeCursors).toEqual({
      [PLACE]: minutesAgo(5).toISOString(),
    });
    expect(state.recentChanges).toEqual({
      [PLACE]: { a: minutesAgo(10).getTime() },
    });
  });

  test("a state with no changes read is left as it is", () => {
    const state: CloudConnectionPullState = { inventoryListedAt: "x" };

    forgetStalePlaces(state, NOW);

    expect(state).toEqual({ inventoryListedAt: "x" });
  });
});
