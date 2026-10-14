import MonitorStatusEventDelete, {
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
  ONLY_STATUS_EVENT_MESSAGE,
  StatusEventDeleteDecision,
  StatusEventDeleteFacts,
} from "../../../../Server/Utils/Monitor/MonitorStatusEventDelete";
import ObjectID from "../../../../Types/ObjectID";
import { KEPT_STATUS_HISTORY_DAYS } from "../../../../Types/StateTimeline/RowsKeptOnDelete";
import { describe, expect, test } from "@jest/globals";

/*
 * DELETING ONE STATUS EVENT OF A MONITOR, BY ITS ID: what happens to the
 * time it covered. The event before it runs on over it; with no event left
 * to, the delete is refused. Every case, at its boundaries, with the clock
 * held - the hook that acts on the answer is pinned in
 * MonitorStatusTimelineDeleteOneEvent, and on Postgres in
 * StateTimelineRowsKeptPostgres.
 */

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const KEPT_FROM: Date = new Date(
  NOW.getTime() - KEPT_STATUS_HISTORY_DAYS * DAY_IN_MS,
);

const BEFORE_ID: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-00000000000b",
);

const daysAgo: (days: number) => Date = (days: number): Date => {
  return new Date(NOW.getTime() - days * DAY_IN_MS);
};

const decide: (
  facts: Partial<StatusEventDeleteFacts>,
) => StatusEventDeleteDecision = (
  facts: Partial<StatusEventDeleteFacts>,
): StatusEventDeleteDecision => {
  return MonitorStatusEventDelete.decide({
    event: { startsAt: daysAgo(10), endsAt: daysAgo(5) },
    before: null,
    after: null,
    eventCount: 3,
    now: NOW,
    ...facts,
  });
};

describe("the monitor's only event", () => {
  test("is refused: the monitor would have no status at all", () => {
    for (const eventCount of [1, 0]) {
      expect(
        decide({
          eventCount,
          event: { startsAt: daysAgo(365), endsAt: null },
        }),
      ).toEqual({ kind: "refuse", message: ONLY_STATUS_EVENT_MESSAGE });
    }
  });

  test("is refused however old it is", () => {
    expect(
      decide({
        eventCount: 1,
        event: { startsAt: daysAgo(3000), endsAt: daysAgo(2000) },
      }),
    ).toEqual({ kind: "refuse", message: ONLY_STATUS_EVENT_MESSAGE });
  });
});

describe("the monitor's oldest event", () => {
  test("is refused while it covers part of the last 90 days", () => {
    for (const endsAt of [daysAgo(89), daysAgo(1), NOW]) {
      expect(
        decide({
          event: { startsAt: daysAgo(365), endsAt },
          after: { startsAt: endsAt },
        }),
      ).toEqual({
        kind: "refuse",
        message: OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
      });
    }
  });

  test("is refused when it ends a millisecond inside the kept history", () => {
    const endsAt: Date = new Date(KEPT_FROM.getTime() + 1);

    expect(
      decide({ event: { startsAt: daysAgo(365), endsAt }, after: null }),
    ).toEqual({
      kind: "refuse",
      message: OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
    });
  });

  test("can go once it ended by the oldest moment kept: the history then starts later", () => {
    for (const endsAt of [KEPT_FROM, daysAgo(91), daysAgo(500)]) {
      expect(
        decide({
          event: { startsAt: daysAgo(1000), endsAt },
          after: { startsAt: endsAt },
        }),
      ).toEqual({ kind: "history-starts-later" });
    }
  });

  test("still open, an orphan: in effect until the event after it starts", () => {
    expect(
      decide({
        event: { startsAt: daysAgo(400), endsAt: null },
        after: { startsAt: daysAgo(300) },
      }),
    ).toEqual({ kind: "history-starts-later" });

    expect(
      decide({
        event: { startsAt: daysAgo(400), endsAt: null },
        after: { startsAt: daysAgo(10) },
      }),
    ).toEqual({
      kind: "refuse",
      message: OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
    });
  });

  test("still open with nothing after it: in effect now, refused", () => {
    expect(
      decide({
        event: { startsAt: daysAgo(400), endsAt: null },
        after: null,
        eventCount: 2,
      }),
    ).toEqual({
      kind: "refuse",
      message: OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
    });
  });

  test("reads the clock it is given, not the real one", () => {
    const endsAt: Date = daysAgo(100);

    expect(
      decide({ event: { startsAt: daysAgo(365), endsAt }, after: null }),
    ).toEqual({ kind: "history-starts-later" });

    // Seen from 20 days after it ended, the same event is still inside the kept history.
    expect(
      MonitorStatusEventDelete.decide({
        event: { startsAt: daysAgo(365), endsAt },
        before: null,
        after: null,
        eventCount: 2,
        now: new Date(endsAt.getTime() + 20 * DAY_IN_MS),
      }),
    ).toEqual({
      kind: "refuse",
      message: OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
    });
  });
});

describe("the newest event", () => {
  test("hands the current status back to the event before it, which runs on", () => {
    expect(
      decide({
        event: { startsAt: daysAgo(1), endsAt: null },
        before: { id: BEFORE_ID, startsAt: daysAgo(10), endsAt: daysAgo(1) },
        after: null,
      }),
    ).toEqual({ kind: "previous-runs-on", previousId: BEFORE_ID, endsAt: null });
  });

  test("closed, as an API write can leave it: the event before it runs on to its end", () => {
    expect(
      decide({
        event: { startsAt: daysAgo(3), endsAt: daysAgo(2) },
        before: { id: BEFORE_ID, startsAt: daysAgo(10), endsAt: daysAgo(3) },
        after: null,
      }),
    ).toEqual({
      kind: "previous-runs-on",
      previousId: BEFORE_ID,
      endsAt: daysAgo(2),
    });
  });

  test("can go even inside the last 90 days: no time is left without a status", () => {
    expect(
      decide({
        event: { startsAt: daysAgo(1), endsAt: null },
        before: { id: BEFORE_ID, startsAt: daysAgo(400), endsAt: daysAgo(1) },
        after: null,
        eventCount: 2,
      }).kind,
    ).toBe("previous-runs-on");
  });
});

describe("an event in the middle", () => {
  test("the event before it runs on to where the next one starts, and the next one stays where it was", () => {
    const decision: StatusEventDeleteDecision = decide({
      event: { startsAt: daysAgo(3), endsAt: daysAgo(2) },
      before: { id: BEFORE_ID, startsAt: daysAgo(10), endsAt: daysAgo(3) },
      after: { startsAt: daysAgo(2) },
    });

    expect(decision).toEqual({
      kind: "previous-runs-on",
      previousId: BEFORE_ID,
      endsAt: daysAgo(2),
    });
  });

  test("an orphan in the middle: the event before it runs on to the next one's start", () => {
    expect(
      decide({
        event: { startsAt: daysAgo(3), endsAt: null },
        before: { id: BEFORE_ID, startsAt: daysAgo(10), endsAt: daysAgo(3) },
        after: { startsAt: daysAgo(1) },
      }),
    ).toEqual({
      kind: "previous-runs-on",
      previousId: BEFORE_ID,
      endsAt: daysAgo(1),
    });
  });

  test("is never refused, however recent: its time goes to the event before it", () => {
    expect(
      decide({
        event: { startsAt: daysAgo(1), endsAt: NOW },
        before: { id: BEFORE_ID, startsAt: daysAgo(2), endsAt: daysAgo(1) },
        after: { startsAt: NOW },
        eventCount: 3,
      }).kind,
    ).toBe("previous-runs-on");
  });
});

describe("the refusals", () => {
  test("say what would happen in plain words, and what to do instead", () => {
    expect(ONLY_STATUS_EVENT_MESSAGE).toBe(
      "This is the monitor's only status event, so it can't be deleted: the monitor would be left with no status, and status pages would show it grey. To change the monitor's status, add a new status event.",
    );
    expect(OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE).toBe(
      "This is the monitor's oldest status event and it covers part of the last 90 days, so it can't be deleted: that time would be left with no status, and status pages would show it grey. To change the status for that time, add a status event with the same start, then delete this one.",
    );
  });
});
