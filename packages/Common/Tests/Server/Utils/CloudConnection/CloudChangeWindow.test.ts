import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_CHANGE_RECENT_IDS_MAX,
  CloudChangeWindowSnapshot,
  forgetStalePlaces,
  getChangePlace,
  getChangeWindowStart,
  getHealthWindowStart,
  isHealthPaused,
  keepNewChanges,
  markHealthRead,
  pauseHealth,
  restoreChangeWindow,
  snapshotChangeWindow,
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

  test("a busy log listed newest first moves on to now: its newest changes were read", () => {
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
      order: "newest-first",
    });

    expect(state.changeCursors).toEqual({ [PLACE]: NOW.toISOString() });
    expect(state.changeResume).toBeUndefined();
    expect(state.recentChanges?.[PLACE]).toEqual({
      a: minutesAgo(2).getTime(),
    });
  });

  test("without an order said, a busy log is taken as listed newest first", () => {
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

    expect(state.changeCursors?.[PLACE]).toBe(NOW.toISOString());
  });

  test("the next read of a busy newest-first log never reads the same stretch forever", () => {
    // Before: the cursor stayed, and every read read the same newest page again.
    const state: CloudConnectionPullState = {
      changeCursors: { [PLACE]: minutesAgo(180).toISOString() },
    };

    keepNewChanges({
      state,
      place: PLACE,
      changes: [change("a", minutesAgo(1))],
      now: NOW,
      complete: false,
      isLookBack: false,
      order: "newest-first",
    });

    expect(getChangeWindowStart({ state, place: PLACE, now: NOW })).toEqual(
      minutesAgo(20),
    );
  });

  test("a busy log listed oldest first carries on exactly from the newest change read", () => {
    const state: CloudConnectionPullState = {
      changeCursors: { [PLACE]: minutesAgo(300).toISOString() },
    };

    keepNewChanges({
      state,
      place: PLACE,
      changes: [
        change("a", minutesAgo(299)),
        change("b", minutesAgo(250)),
        change("c", minutesAgo(240)),
      ],
      now: NOW,
      complete: false,
      isLookBack: false,
      order: "oldest-first",
    });

    // The cursor stays; the next read starts where this one got to.
    expect(state.changeCursors).toEqual({
      [PLACE]: minutesAgo(300).toISOString(),
    });
    expect(state.changeResume).toEqual({
      [PLACE]: minutesAgo(240).toISOString(),
    });
    expect(getChangeWindowStart({ state, place: PLACE, now: NOW })).toEqual(
      minutesAgo(240),
    );
    // Only the change the next read can bring in again is remembered.
    expect(state.recentChanges?.[PLACE]).toEqual({
      c: minutesAgo(240).getTime(),
    });
  });

  test("a read of an oldest-first log that gets to its end lets go of where it resumed", () => {
    const state: CloudConnectionPullState = {
      changeCursors: { [PLACE]: minutesAgo(300).toISOString() },
      changeResume: { [PLACE]: minutesAgo(240).toISOString() },
    };

    keepNewChanges({
      state,
      place: PLACE,
      changes: [change("d", minutesAgo(30))],
      now: NOW,
      complete: true,
      isLookBack: false,
      order: "oldest-first",
    });

    expect(state.changeCursors).toEqual({ [PLACE]: NOW.toISOString() });
    expect(state.changeResume).toBeUndefined();
  });

  test("a busy oldest-first read that found nothing new keeps its place", () => {
    const state: CloudConnectionPullState = {
      changeCursors: { [PLACE]: minutesAgo(60).toISOString() },
    };

    keepNewChanges({
      state,
      place: PLACE,
      changes: [],
      now: NOW,
      complete: false,
      isLookBack: false,
      order: "oldest-first",
    });

    expect(state.changeCursors).toEqual({
      [PLACE]: minutesAgo(60).toISOString(),
    });
    expect(state.changeResume).toBeUndefined();
  });

  test("a place resumed more than a day back starts a day back", () => {
    expect(
      getChangeWindowStart({
        state: {
          changeResume: { [PLACE]: minutesAgo(3 * 24 * 60).toISOString() },
        },
        place: PLACE,
        now: NOW,
      }),
    ).toEqual(minutesAgo(24 * 60));
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

  test("where a stale place resumed, its health reads and its spent pauses go too", () => {
    const state: CloudConnectionPullState = {
      changeResume: {
        [PLACE]: minutesAgo(30).toISOString(),
        old: minutesAgo(26 * 60).toISOString(),
      },
      accountHealthReadAt: {
        "123456789012": minutesAgo(10).toISOString(),
        "210987654321": minutesAgo(26 * 60).toISOString(),
      },
      healthPausedAccounts: {
        "123456789012": new Date(NOW.getTime() + 60 * MINUTE).toISOString(),
        "210987654321": minutesAgo(1).toISOString(),
      },
    };

    forgetStalePlaces(state, NOW);

    expect(state.changeResume).toEqual({
      [PLACE]: minutesAgo(30).toISOString(),
    });
    expect(state.accountHealthReadAt).toEqual({
      "123456789012": minutesAgo(10).toISOString(),
    });
    expect(state.healthPausedAccounts).toEqual({
      "123456789012": new Date(NOW.getTime() + 60 * MINUTE).toISOString(),
    });
  });

  test("nothing left of them is no field at all", () => {
    const state: CloudConnectionPullState = {
      changeResume: { old: minutesAgo(26 * 60).toISOString() },
      accountHealthReadAt: { a: minutesAgo(26 * 60).toISOString() },
      healthPausedAccounts: { a: minutesAgo(1).toISOString() },
    };

    forgetStalePlaces(state, NOW);

    expect(state).toEqual({});
  });
});

describe("an account's health events", () => {
  const ACCOUNT: string = "123456789012";

  test("are read from where its own last read got to, a little before", () => {
    expect(
      getHealthWindowStart({
        state: {
          healthReadAt: minutesAgo(60).toISOString(),
          accountHealthReadAt: { [ACCOUNT]: minutesAgo(15).toISOString() },
        },
        accountId: ACCOUNT,
        now: NOW,
      }),
    ).toEqual(minutesAgo(35));
  });

  test("before it was read on its own, from where every account's got to", () => {
    expect(
      getHealthWindowStart({
        state: { healthReadAt: minutesAgo(15).toISOString() },
        accountId: ACCOUNT,
        now: NOW,
      }),
    ).toEqual(minutesAgo(35));
  });

  test("never read, or read long ago: a day back", () => {
    expect(
      getHealthWindowStart({ state: {}, accountId: ACCOUNT, now: NOW }),
    ).toEqual(minutesAgo(24 * 60));
    expect(
      getHealthWindowStart({
        state: {
          accountHealthReadAt: {
            [ACCOUNT]: minutesAgo(3 * 24 * 60).toISOString(),
          },
        },
        accountId: ACCOUNT,
        now: NOW,
      }),
    ).toEqual(minutesAgo(24 * 60));
  });

  test("a read is recorded for that account alone", () => {
    const state: CloudConnectionPullState = {
      accountHealthReadAt: { other: minutesAgo(5).toISOString() },
    };

    markHealthRead({ state, accountId: ACCOUNT, now: NOW });

    expect(state.accountHealthReadAt).toEqual({
      other: minutesAgo(5).toISOString(),
      [ACCOUNT]: NOW.toISOString(),
    });
  });

  test("a pause holds that account alone, until it is over", () => {
    const state: CloudConnectionPullState = {};

    pauseHealth({ state, accountId: ACCOUNT, now: NOW, forMs: 60 * MINUTE });

    expect(isHealthPaused({ state, accountId: ACCOUNT, now: NOW })).toBe(true);
    expect(isHealthPaused({ state, accountId: "other", now: NOW })).toBe(false);
    expect(
      isHealthPaused({
        state,
        accountId: ACCOUNT,
        now: new Date(NOW.getTime() + 61 * MINUTE),
      }),
    ).toBe(false);
  });
});

describe("a read whose changes could not all be written", () => {
  const OTHER: string = "123456789012|us-east-1";

  function readOnce(): {
    state: CloudConnectionPullState;
    snapshot: CloudChangeWindowSnapshot;
  } {
    const state: CloudConnectionPullState = {
      changeCursors: {
        [PLACE]: minutesAgo(10).toISOString(),
        [OTHER]: minutesAgo(10).toISOString(),
      },
      changeResume: { [OTHER]: minutesAgo(40).toISOString() },
      healthReadAt: minutesAgo(30).toISOString(),
      accountHealthReadAt: { a: minutesAgo(30).toISOString() },
      recentChanges: { [PLACE]: { old: minutesAgo(12).getTime() } },
    };
    const snapshot: CloudChangeWindowSnapshot = snapshotChangeWindow(state);

    keepNewChanges({
      state,
      place: PLACE,
      changes: [
        change("written", minutesAgo(3)),
        change("lost", minutesAgo(2)),
      ],
      now: NOW,
      complete: true,
      isLookBack: false,
    });
    keepNewChanges({
      state,
      place: OTHER,
      changes: [change("also-written", minutesAgo(4))],
      now: NOW,
      complete: true,
      isLookBack: false,
      order: "oldest-first",
    });
    state.healthReadAt = NOW.toISOString();
    markHealthRead({ state, accountId: "a", now: NOW });

    return { state, snapshot };
  }

  test("goes back to where every place was, and forgets only what was not written", () => {
    const { state, snapshot } = readOnce();

    restoreChangeWindow({ state, snapshot, unwrittenEventIds: ["lost"] });

    expect(state.changeCursors).toEqual({
      [PLACE]: minutesAgo(10).toISOString(),
      [OTHER]: minutesAgo(10).toISOString(),
    });
    expect(state.changeResume).toEqual({
      [OTHER]: minutesAgo(40).toISOString(),
    });
    expect(state.healthReadAt).toBe(minutesAgo(30).toISOString());
    expect(state.accountHealthReadAt).toEqual({
      a: minutesAgo(30).toISOString(),
    });
    // What was written stays seen: the next read does not write it twice.
    expect(Object.keys(state.recentChanges?.[PLACE] || {}).sort()).toEqual([
      "old",
      "written",
    ]);
    expect(state.recentChanges?.[OTHER]).toEqual({
      "also-written": minutesAgo(4).getTime(),
    });
  });

  test("the next read reads the lost change again, and keeps it", () => {
    const { state, snapshot } = readOnce();

    restoreChangeWindow({ state, snapshot, unwrittenEventIds: ["lost"] });

    const fresh: Array<CloudChange> = keepNewChanges({
      state,
      place: PLACE,
      changes: [
        change("written", minutesAgo(3)),
        change("lost", minutesAgo(2)),
      ],
      now: new Date(NOW.getTime() + MINUTE),
      complete: true,
      isLookBack: false,
    });

    expect(
      fresh.map((entry: CloudChange): string => {
        return entry.eventId;
      }),
    ).toEqual(["lost"]);
  });

  test("a read that failed part way goes back whole, what it saw included", () => {
    const { state, snapshot } = readOnce();

    restoreChangeWindow({ state, snapshot });

    expect(state.recentChanges).toEqual({
      [PLACE]: { old: minutesAgo(12).getTime() },
    });
    expect(state.changeCursors?.[PLACE]).toBe(minutesAgo(10).toISOString());
  });

  test("a place the snapshot did not have is dropped when going back", () => {
    const state: CloudConnectionPullState = {};
    const snapshot: CloudChangeWindowSnapshot = snapshotChangeWindow(state);

    keepNewChanges({
      state,
      place: PLACE,
      changes: [change("a", minutesAgo(1))],
      now: NOW,
      complete: false,
      isLookBack: false,
      order: "oldest-first",
    });
    state.healthReadAt = NOW.toISOString();

    restoreChangeWindow({ state, snapshot });

    expect(state).toEqual({});
  });

  test("the snapshot is a copy: what the read moves does not move it", () => {
    const state: CloudConnectionPullState = {
      recentChanges: { [PLACE]: { a: minutesAgo(1).getTime() } },
    };
    const snapshot: CloudChangeWindowSnapshot = snapshotChangeWindow(state);

    state.recentChanges![PLACE]!["b"] = NOW.getTime();

    expect(snapshot.recentChanges).toEqual({
      [PLACE]: { a: minutesAgo(1).getTime() },
    });
  });
});
