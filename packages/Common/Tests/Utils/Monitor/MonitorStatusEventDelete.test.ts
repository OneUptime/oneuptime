import MonitorStatusEventDelete, {
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_TEMPLATE,
  ONLY_STATUS_EVENT_MESSAGE,
  StatusEventDeleteDecision,
  StatusEventDeleteFacts,
  StatusEventDeleteRefusal,
} from "../../../Utils/Monitor/MonitorStatusEventDelete";
import ObjectID from "../../../Types/ObjectID";
import { KEPT_STATUS_HISTORY_DAYS } from "../../../Types/StateTimeline/RowsKeptOnDelete";
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
      ).toEqual({
        kind: "refuse",
        refusal: StatusEventDeleteRefusal.OnlyEvent,
        message: ONLY_STATUS_EVENT_MESSAGE,
      });
    }
  });

  test("is refused however old it is", () => {
    expect(
      decide({
        eventCount: 1,
        event: { startsAt: daysAgo(3000), endsAt: daysAgo(2000) },
      }),
    ).toEqual({
      kind: "refuse",
      refusal: StatusEventDeleteRefusal.OnlyEvent,
      message: ONLY_STATUS_EVENT_MESSAGE,
    });
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
        refusal: StatusEventDeleteRefusal.OldestInKeptHistory,
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
      refusal: StatusEventDeleteRefusal.OldestInKeptHistory,
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
      refusal: StatusEventDeleteRefusal.OldestInKeptHistory,
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
      refusal: StatusEventDeleteRefusal.OldestInKeptHistory,
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
      refusal: StatusEventDeleteRefusal.OldestInKeptHistory,
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
    ).toEqual({
      kind: "previous-runs-on",
      previousId: BEFORE_ID,
      endsAt: null,
    });
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
  test("say the rule, what would go gray, and what to do instead", () => {
    expect(ONLY_STATUS_EVENT_MESSAGE).toBe(
      "The monitor's only status event can't be deleted: the monitor would have no status, and status pages would show it gray. To change its status, add a new status event.",
    );
    expect(OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE).toBe(
      "The monitor's oldest status event can't be deleted while it covers part of the last 90 days: status pages would show that time gray. To replace it, add a status event that starts before it, then delete this one.",
    );
  });

  test("fill the Dashboard's translation key with the kept history's length", () => {
    // The tooltip looks the template up; the server sends it filled in.
    expect(OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_TEMPLATE).toContain(
      "the last {{days}} days",
    );
    expect(OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE).toBe(
      OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_TEMPLATE.split("{{days}}").join(
        String(KEPT_STATUS_HISTORY_DAYS),
      ),
    );
    expect(OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE).not.toContain("{{");
  });

  test("the way round the oldest event's refusal works: an event that starts before it gives it one to hand its time to", () => {
    // The refused delete: the oldest event, still in the kept history.
    expect(
      decide({
        event: { startsAt: daysAgo(365), endsAt: daysAgo(20) },
        before: null,
        after: { startsAt: daysAgo(20) },
      }).kind,
    ).toBe("refuse");

    // Once an event starts before it, it is no longer the oldest: it can go.
    expect(
      decide({
        event: { startsAt: daysAgo(365), endsAt: daysAgo(20) },
        before: {
          id: BEFORE_ID,
          startsAt: daysAgo(366),
          endsAt: daysAgo(365),
        },
        after: { startsAt: daysAgo(20) },
      }),
    ).toEqual({
      kind: "previous-runs-on",
      previousId: BEFORE_ID,
      endsAt: daysAgo(20),
    });
  });
});

describe("the event a status timeline page locks Delete on", () => {
  const lockOf: (data: {
    oldestEvents: Array<{
      id: string;
      startsAt?: Date | undefined;
      endsAt?: Date | null | undefined;
    }>;
    eventCount: number;
  }) => { eventId: string; refusal: StatusEventDeleteRefusal } | null = (data: {
    oldestEvents: Array<{
      id: string;
      startsAt?: Date | undefined;
      endsAt?: Date | null | undefined;
    }>;
    eventCount: number;
  }) => {
    return MonitorStatusEventDelete.getLockedOldestEvent({ ...data, now: NOW });
  };

  test("is the only event, whatever its age", () => {
    for (const startsAt of [daysAgo(1000), daysAgo(1)]) {
      expect(
        lockOf({
          oldestEvents: [{ id: "only", startsAt, endsAt: null }],
          eventCount: 1,
        }),
      ).toEqual({
        eventId: "only",
        refusal: StatusEventDeleteRefusal.OnlyEvent,
      });
    }
  });

  test("is the oldest event while it covers part of the last 90 days", () => {
    expect(
      lockOf({
        oldestEvents: [
          { id: "oldest", startsAt: daysAgo(365), endsAt: daysAgo(20) },
          { id: "next", startsAt: daysAgo(20), endsAt: null },
        ],
        eventCount: 2,
      }),
    ).toEqual({
      eventId: "oldest",
      refusal: StatusEventDeleteRefusal.OldestInKeptHistory,
    });
  });

  test("is none once the oldest event ended before the last 90 days", () => {
    expect(
      lockOf({
        oldestEvents: [
          { id: "oldest", startsAt: daysAgo(365), endsAt: daysAgo(100) },
          { id: "next", startsAt: daysAgo(100), endsAt: null },
        ],
        eventCount: 5,
      }),
    ).toBeNull();
  });

  test("reads an open oldest event, an orphan, by the start of the next one", () => {
    expect(
      lockOf({
        oldestEvents: [
          { id: "orphan", startsAt: daysAgo(400), endsAt: null },
          { id: "next", startsAt: daysAgo(300), endsAt: null },
        ],
        eventCount: 3,
      }),
    ).toBeNull();

    expect(
      lockOf({
        oldestEvents: [
          { id: "orphan", startsAt: daysAgo(400), endsAt: null },
          { id: "next", startsAt: daysAgo(30), endsAt: null },
        ],
        eventCount: 3,
      })?.eventId,
    ).toBe("orphan");
  });

  test("is none when the two oldest events start together: each is the other's before", () => {
    expect(
      lockOf({
        oldestEvents: [
          { id: "a", startsAt: daysAgo(10), endsAt: daysAgo(10) },
          { id: "b", startsAt: daysAgo(10), endsAt: null },
        ],
        eventCount: 2,
      }),
    ).toBeNull();
  });

  test("is none for a monitor with no events", () => {
    expect(lockOf({ oldestEvents: [], eventCount: 0 })).toBeNull();
  });
});
