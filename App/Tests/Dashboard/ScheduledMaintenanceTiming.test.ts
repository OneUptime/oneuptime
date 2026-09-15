import { describe, expect, test } from "@jest/globals";
import {
  SCHEDULED_MAINTENANCE_DURATION_PREFIX,
  SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS,
  SCHEDULED_MAINTENANCE_STATE_RECHECK_MIN_INTERVAL_IN_MS,
  SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS,
  SCHEDULED_MAINTENANCE_TIMING_MIN_REFRESH_DELAY_IN_MS,
  SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS,
  ScheduledMaintenancePhase,
  ScheduledMaintenanceStateFlags,
  ScheduledMaintenanceStateKind,
  ScheduledMaintenanceTiming,
  ScheduledMaintenanceTimingInput,
  formatScheduledMaintenanceRelativeTime,
  getCurrentTimelineStateId,
  getScheduledMaintenanceStateKind,
  getScheduledMaintenanceTiming,
  getScheduledMaintenanceTimingRefreshDelayInMs,
  getTimelineDateForState,
  isScheduledMaintenanceTimingLive,
  shouldRecheckScheduledMaintenanceState,
  toValidDate,
} from "../../FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTiming";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const STARTS_AT: Date = new Date("2026-09-14T20:00:00.000Z");
const ENDS_AT: Date = new Date("2026-09-14T22:00:00.000Z");

type AtFunction = (offsetInMs: number, from?: Date) => Date;

// A date offset from STARTS_AT (or `from`).
const at: AtFunction = (offsetInMs: number, from?: Date): Date => {
  return new Date((from || STARTS_AT).getTime() + offsetInMs);
};

type TimingFunction = (
  overrides: Partial<ScheduledMaintenanceTimingInput> & { now: Date },
) => ScheduledMaintenanceTiming;

const timing: TimingFunction = (
  overrides: Partial<ScheduledMaintenanceTimingInput> & { now: Date },
): ScheduledMaintenanceTiming => {
  return getScheduledMaintenanceTiming({
    stateKind: ScheduledMaintenanceStateKind.Scheduled,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    ...overrides,
  });
};

describe("toValidDate", () => {
  test("keeps a valid Date instance as is", () => {
    expect(toValidDate(STARTS_AT)).toBe(STARTS_AT);
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an invalid Date", new Date("not a date")],
    ["an empty string", ""],
    ["a blank string", "   "],
  ])("returns undefined for %s", (_label: string, value: unknown) => {
    expect(toValidDate(value as Date | string | null | undefined)).toBe(
      undefined,
    );
  });

  test("parses an ISO string", () => {
    expect(toValidDate("2026-09-14T20:00:00.000Z")?.getTime()).toBe(
      STARTS_AT.getTime(),
    );
  });

  test("returns undefined for a string that is not a date", () => {
    expect(toValidDate("definitely not a date")).toBe(undefined);
  });
});

describe("getScheduledMaintenanceStateKind", () => {
  const scheduled: ScheduledMaintenanceStateFlags = {
    id: "scheduled",
    isScheduledState: true,
  };
  const preparing: ScheduledMaintenanceStateFlags = { id: "preparing" };
  const ongoing: ScheduledMaintenanceStateFlags = {
    id: "ongoing",
    isOngoingState: true,
  };
  const verifying: ScheduledMaintenanceStateFlags = { id: "verifying" };
  const ended: ScheduledMaintenanceStateFlags = {
    id: "ended",
    isEndedState: true,
  };
  const resolved: ScheduledMaintenanceStateFlags = {
    id: "resolved",
    isResolvedState: true,
  };
  const states: Array<ScheduledMaintenanceStateFlags> = [
    scheduled,
    preparing,
    ongoing,
    verifying,
    ended,
    resolved,
  ];

  test.each([
    ["scheduled", ScheduledMaintenanceStateKind.Scheduled],
    ["preparing", ScheduledMaintenanceStateKind.Scheduled],
    ["ongoing", ScheduledMaintenanceStateKind.Ongoing],
    ["verifying", ScheduledMaintenanceStateKind.Ongoing],
    ["ended", ScheduledMaintenanceStateKind.Ended],
    ["resolved", ScheduledMaintenanceStateKind.Ended],
  ])(
    "classifies the %s state as %s",
    (currentStateId: string, kind: ScheduledMaintenanceStateKind) => {
      expect(
        getScheduledMaintenanceStateKind({
          states: states,
          currentStateId: currentStateId,
        }),
      ).toBe(kind);
    },
  );

  test("is Unknown without a current state", () => {
    expect(
      getScheduledMaintenanceStateKind({
        states: states,
        currentStateId: undefined,
      }),
    ).toBe(ScheduledMaintenanceStateKind.Unknown);
  });

  test("is Unknown when the current state is not in the list", () => {
    expect(
      getScheduledMaintenanceStateKind({
        states: states,
        currentStateId: "deleted-state",
      }),
    ).toBe(ScheduledMaintenanceStateKind.Unknown);
  });

  test("is Unknown for a custom state when the project has no ongoing state", () => {
    expect(
      getScheduledMaintenanceStateKind({
        states: [scheduled, preparing, ended],
        currentStateId: "preparing",
      }),
    ).toBe(ScheduledMaintenanceStateKind.Unknown);
  });

  test("lets an ended flag win over any other flag", () => {
    expect(
      getScheduledMaintenanceStateKind({
        states: [
          {
            id: "confused",
            isScheduledState: true,
            isOngoingState: true,
            isEndedState: true,
          },
        ],
        currentStateId: "confused",
      }),
    ).toBe(ScheduledMaintenanceStateKind.Ended);
  });

  test("lets a scheduled flag win over an ongoing flag", () => {
    expect(
      getScheduledMaintenanceStateKind({
        states: [{ id: "both", isScheduledState: true, isOngoingState: true }],
        currentStateId: "both",
      }),
    ).toBe(ScheduledMaintenanceStateKind.Scheduled);
  });
});

describe("getTimelineDateForState", () => {
  const timelines: Array<{ stateId?: string; startsAt?: Date | string }> = [
    { stateId: "ongoing", startsAt: at(10 * MINUTE) },
    { stateId: "scheduled", startsAt: at(-DAY) },
    { stateId: "ongoing", startsAt: at(-5 * MINUTE) },
    { stateId: "ongoing", startsAt: "2026-09-14T20:30:00.000Z" },
    { stateId: "ongoing", startsAt: new Date("invalid") },
    { stateId: "ongoing" },
  ];

  test("picks the earliest entry into the state, whatever the list order", () => {
    expect(
      getTimelineDateForState({
        timelines: timelines,
        stateId: "ongoing",
        pick: "first",
      })?.getTime(),
    ).toBe(at(-5 * MINUTE).getTime());
  });

  test("picks the latest entry into the state, parsing string dates", () => {
    expect(
      getTimelineDateForState({
        timelines: timelines,
        stateId: "ongoing",
        pick: "last",
      })?.getTime(),
    ).toBe(at(30 * MINUTE).getTime());
  });

  test("returns undefined for a state with no entries", () => {
    expect(
      getTimelineDateForState({
        timelines: timelines,
        stateId: "ended",
        pick: "last",
      }),
    ).toBe(undefined);
  });

  test("returns undefined without a state id", () => {
    expect(
      getTimelineDateForState({
        timelines: timelines,
        stateId: undefined,
        pick: "first",
      }),
    ).toBe(undefined);
  });
});

describe("getCurrentTimelineStateId", () => {
  test("returns undefined for an empty timeline", () => {
    expect(getCurrentTimelineStateId([])).toBe(undefined);
  });

  test("returns the state of the latest entry by date, not by position", () => {
    expect(
      getCurrentTimelineStateId([
        { stateId: "ongoing", startsAt: at(0) },
        { stateId: "ended", startsAt: at(HOUR) },
        { stateId: "scheduled", startsAt: at(-HOUR) },
      ]),
    ).toBe("ended");
  });

  test("breaks a tie on date by list order", () => {
    expect(
      getCurrentTimelineStateId([
        { stateId: "scheduled", startsAt: at(0) },
        { stateId: "ongoing", startsAt: at(0) },
      ]),
    ).toBe("ongoing");
  });

  test("ignores undated entries when a dated one exists", () => {
    expect(
      getCurrentTimelineStateId([
        { stateId: "scheduled", startsAt: at(0) },
        { stateId: "ended" },
      ]),
    ).toBe("scheduled");
    expect(
      getCurrentTimelineStateId([
        { stateId: "ended" },
        { stateId: "scheduled", startsAt: at(0) },
      ]),
    ).toBe("scheduled");
  });

  test("falls back to the last undated entry when nothing is dated", () => {
    expect(
      getCurrentTimelineStateId([
        { stateId: "scheduled" },
        { stateId: "ongoing" },
      ]),
    ).toBe("ongoing");
  });
});

describe("getScheduledMaintenanceTiming: scheduled events", () => {
  test("counts down to the start while the start is in the future", () => {
    const now: Date = at(-2 * HOUR);
    const result: ScheduledMaintenanceTiming = timing({ now: now });

    expect(result).toEqual({
      phase: ScheduledMaintenancePhase.Scheduled,
      durationPrefix: "Starts in",
      durationStartsAt: now,
      durationEndsAt: STARTS_AT,
      isOverdue: false,
      nextChangeAt: STARTS_AT,
    });
  });

  test("is still scheduled one millisecond before the start", () => {
    expect(timing({ now: at(-1) }).phase).toBe(
      ScheduledMaintenancePhase.Scheduled,
    );
  });

  test("becomes start-overdue exactly at the start, without warning yet", () => {
    const result: ScheduledMaintenanceTiming = timing({ now: STARTS_AT });

    expect(result).toEqual({
      phase: ScheduledMaintenancePhase.StartOverdue,
      durationPrefix: "Start overdue by",
      durationStartsAt: STARTS_AT,
      durationEndsAt: STARTS_AT,
      overdueSince: STARTS_AT,
      isOverdue: false,
      nextChangeAt: at(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS),
    });
  });

  test("does not warn until the grace period has passed", () => {
    expect(
      timing({ now: at(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS - 1) })
        .isOverdue,
    ).toBe(false);

    const overdue: ScheduledMaintenanceTiming = timing({
      now: at(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS),
    });

    expect(overdue.phase).toBe(ScheduledMaintenancePhase.StartOverdue);
    expect(overdue.isOverdue).toBe(true);
    expect(overdue.nextChangeAt).toBe(undefined);
  });

  test("measures how late the start is, even once the whole window has passed", () => {
    const now: Date = at(3 * DAY);
    const result: ScheduledMaintenanceTiming = timing({ now: now });

    expect(result.phase).toBe(ScheduledMaintenancePhase.StartOverdue);
    expect(result.durationStartsAt).toBe(STARTS_AT);
    expect(result.durationEndsAt).toBe(now);
    expect(result.isOverdue).toBe(true);
  });

  test("shows no duration without a usable start date", () => {
    for (const startsAt of [undefined, null, "", new Date("nope")]) {
      expect(timing({ startsAt: startsAt, now: at(-HOUR) })).toEqual({
        phase: ScheduledMaintenancePhase.Scheduled,
        isOverdue: false,
      });
    }
  });

  test("accepts string dates", () => {
    const result: ScheduledMaintenanceTiming = timing({
      startsAt: "2026-09-14T20:00:00.000Z",
      now: at(-HOUR),
    });

    expect(result.durationEndsAt?.getTime()).toBe(STARTS_AT.getTime());
  });
});

describe("getScheduledMaintenanceTiming: ongoing events", () => {
  const ongoing: TimingFunction = (
    overrides: Partial<ScheduledMaintenanceTimingInput> & { now: Date },
  ): ScheduledMaintenanceTiming => {
    return timing({
      stateKind: ScheduledMaintenanceStateKind.Ongoing,
      ...overrides,
    });
  };

  test("counts from when work actually began and changes at the planned end", () => {
    const startedAt: Date = at(5 * MINUTE);
    const now: Date = at(HOUR);

    expect(ongoing({ startedAt: startedAt, now: now })).toEqual({
      phase: ScheduledMaintenancePhase.Ongoing,
      durationPrefix: "In progress for",
      durationStartsAt: startedAt,
      durationEndsAt: now,
      isOverdue: false,
      nextChangeAt: ENDS_AT,
    });
  });

  test("falls back to the planned start without a timeline entry", () => {
    expect(ongoing({ now: at(HOUR) }).durationStartsAt).toBe(STARTS_AT);
  });

  test("shows no duration when it was started before its planned start and has no timeline entry", () => {
    const result: ScheduledMaintenanceTiming = ongoing({ now: at(-HOUR) });

    expect(result.phase).toBe(ScheduledMaintenancePhase.Ongoing);
    expect(result.durationPrefix).toBe(undefined);
    expect(result.durationStartsAt).toBe(undefined);
    expect(result.nextChangeAt).toBe(ENDS_AT);
  });

  test("has no next change without an end date", () => {
    const result: ScheduledMaintenanceTiming = ongoing({
      endsAt: undefined,
      now: at(10 * DAY),
    });

    expect(result.phase).toBe(ScheduledMaintenancePhase.Ongoing);
    expect(result.durationPrefix).toBe("In progress for");
    expect(result.nextChangeAt).toBe(undefined);
  });

  test("treats an invalid end date as no end date", () => {
    expect(ongoing({ endsAt: new Date("bad"), now: at(10 * DAY) }).phase).toBe(
      ScheduledMaintenancePhase.Ongoing,
    );
  });

  test("is still within its window one millisecond before the end", () => {
    expect(ongoing({ now: at(-1, ENDS_AT) }).phase).toBe(
      ScheduledMaintenancePhase.Ongoing,
    );
  });

  test("starts overrunning exactly at the planned end", () => {
    expect(ongoing({ startedAt: at(0), now: ENDS_AT })).toEqual({
      phase: ScheduledMaintenancePhase.EndOverdue,
      durationPrefix: "Overrunning by",
      durationStartsAt: ENDS_AT,
      durationEndsAt: ENDS_AT,
      overdueSince: ENDS_AT,
      isOverdue: false,
      nextChangeAt: at(
        SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS,
        ENDS_AT,
      ),
    });
  });

  test("warns about an overrun only after the grace period", () => {
    expect(
      ongoing({
        now: at(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS - 1, ENDS_AT),
      }).isOverdue,
    ).toBe(false);

    const overrun: ScheduledMaintenanceTiming = ongoing({
      now: at(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS, ENDS_AT),
    });

    expect(overrun.isOverdue).toBe(true);
    expect(overrun.nextChangeAt).toBe(undefined);
  });
});

describe("getScheduledMaintenanceTiming: ended events", () => {
  const ended: TimingFunction = (
    overrides: Partial<ScheduledMaintenanceTimingInput> & { now: Date },
  ): ScheduledMaintenanceTiming => {
    return timing({
      stateKind: ScheduledMaintenanceStateKind.Ended,
      ...overrides,
    });
  };

  test("measures from the actual start to the actual completion", () => {
    const startedAt: Date = at(5 * MINUTE);
    const completedAt: Date = at(90 * MINUTE);

    expect(
      ended({ startedAt: startedAt, completedAt: completedAt, now: at(DAY) }),
    ).toEqual({
      phase: ScheduledMaintenancePhase.Ended,
      durationPrefix: "Completed in",
      durationStartsAt: startedAt,
      durationEndsAt: completedAt,
      isOverdue: false,
    });
  });

  test("falls back to the planned window when the timeline is missing", () => {
    const result: ScheduledMaintenanceTiming = ended({ now: at(DAY) });

    expect(result.durationStartsAt).toBe(STARTS_AT);
    expect(result.durationEndsAt).toBe(ENDS_AT);
  });

  test("does not depend on the clock", () => {
    const early: ScheduledMaintenanceTiming = ended({ now: at(-DAY) });
    const late: ScheduledMaintenanceTiming = ended({ now: at(30 * DAY) });

    expect(early).toEqual(late);
    expect(late.isOverdue).toBe(false);
    expect(late.nextChangeAt).toBe(undefined);
  });

  test("has no duration when it ended before it ever started", () => {
    expect(
      ended({ completedAt: at(-HOUR), startedAt: undefined, now: at(DAY) }),
    ).toEqual({
      phase: ScheduledMaintenancePhase.Ended,
      isOverdue: false,
    });
  });

  test("allows a zero-length completion", () => {
    expect(
      ended({ startedAt: at(0), completedAt: at(0), now: at(DAY) })
        .durationPrefix,
    ).toBe("Completed in");
  });

  test("has no duration without any usable dates", () => {
    expect(ended({ startsAt: undefined, endsAt: null, now: at(DAY) })).toEqual({
      phase: ScheduledMaintenancePhase.Ended,
      isOverdue: false,
    });
  });
});

describe("getScheduledMaintenanceTiming: unknown states", () => {
  test("claims nothing about an unclassified state", () => {
    expect(
      timing({
        stateKind: ScheduledMaintenanceStateKind.Unknown,
        now: at(HOUR),
      }),
    ).toEqual({
      phase: ScheduledMaintenancePhase.Unknown,
      isOverdue: false,
    });
  });
});

describe("duration prefixes", () => {
  test("use the exact copy shown in the header", () => {
    expect(SCHEDULED_MAINTENANCE_DURATION_PREFIX).toEqual({
      startsIn: "Starts in",
      startOverdueBy: "Start overdue by",
      inProgressFor: "In progress for",
      overrunningBy: "Overrunning by",
      completedIn: "Completed in",
    });
  });
});

describe("isScheduledMaintenanceTimingLive", () => {
  test.each([
    ["a countdown", timing({ now: at(-HOUR) }), true],
    ["a start overdue", timing({ now: at(DAY) }), true],
    [
      "an event in progress",
      timing({
        stateKind: ScheduledMaintenanceStateKind.Ongoing,
        now: at(HOUR),
      }),
      true,
    ],
    [
      "an overrun",
      timing({
        stateKind: ScheduledMaintenanceStateKind.Ongoing,
        now: at(DAY),
      }),
      true,
    ],
    [
      "an event in progress with only an end date",
      timing({
        stateKind: ScheduledMaintenanceStateKind.Ongoing,
        startsAt: undefined,
        now: at(HOUR),
      }),
      true,
    ],
    [
      "an ended event",
      timing({ stateKind: ScheduledMaintenanceStateKind.Ended, now: at(DAY) }),
      false,
    ],
    [
      "an unknown state",
      timing({
        stateKind: ScheduledMaintenanceStateKind.Unknown,
        now: at(DAY),
      }),
      false,
    ],
    [
      "a scheduled event without dates",
      timing({ startsAt: undefined, endsAt: undefined, now: at(DAY) }),
      false,
    ],
    [
      "an event in progress without dates",
      timing({
        stateKind: ScheduledMaintenanceStateKind.Ongoing,
        startsAt: undefined,
        endsAt: undefined,
        now: at(DAY),
      }),
      false,
    ],
  ])(
    "is right for %s",
    (_label: string, value: ScheduledMaintenanceTiming, expected: boolean) => {
      expect(isScheduledMaintenanceTimingLive(value)).toBe(expected);
    },
  );
});

describe("getScheduledMaintenanceTimingRefreshDelayInMs", () => {
  test("uses the regular interval when nothing is about to change", () => {
    expect(SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS).toBe(
      30 * SECOND,
    );
    expect(
      getScheduledMaintenanceTimingRefreshDelayInMs(
        { phase: ScheduledMaintenancePhase.Ongoing, isOverdue: false },
        STARTS_AT,
      ),
    ).toBe(30 * SECOND);
  });

  test("shortens the wait to land on a phase change", () => {
    expect(
      getScheduledMaintenanceTimingRefreshDelayInMs(
        timing({ now: at(-10 * SECOND) }),
        at(-10 * SECOND),
      ),
    ).toBe(10 * SECOND);
  });

  test("keeps the regular interval when the change is further away", () => {
    expect(
      getScheduledMaintenanceTimingRefreshDelayInMs(
        timing({ now: at(-2 * MINUTE) }),
        at(-2 * MINUTE),
      ),
    ).toBe(30 * SECOND);
  });

  test("never schedules a tight loop", () => {
    expect(
      getScheduledMaintenanceTimingRefreshDelayInMs(
        timing({ now: at(-200) }),
        at(-200),
      ),
    ).toBe(SCHEDULED_MAINTENANCE_TIMING_MIN_REFRESH_DELAY_IN_MS);
  });

  test("ignores a change that is already in the past", () => {
    expect(
      getScheduledMaintenanceTimingRefreshDelayInMs(
        {
          phase: ScheduledMaintenancePhase.Scheduled,
          isOverdue: false,
          nextChangeAt: at(-MINUTE),
        },
        STARTS_AT,
      ),
    ).toBe(30 * SECOND);
  });

  test("ticking with the suggested delays lands on every boundary of a whole event", () => {
    /*
     * Simulates the header's timer: evaluate, wait the suggested delay,
     * evaluate again. It must never overshoot a phase change by more than
     * the minimum delay, and must reach the overdue warning.
     */
    let now: Date = at(-65 * SECOND);
    const seenPhases: Array<string> = [];
    let firstOverdueWarningAt: Date | undefined = undefined;

    for (let tick: number = 0; tick < 20; tick++) {
      const current: ScheduledMaintenanceTiming = timing({ now: now });

      if (seenPhases[seenPhases.length - 1] !== current.phase) {
        seenPhases.push(current.phase);
      }

      if (current.isOverdue && !firstOverdueWarningAt) {
        firstOverdueWarningAt = now;
      }

      now = at(
        getScheduledMaintenanceTimingRefreshDelayInMs(current, now),
        now,
      );
    }

    expect(seenPhases).toEqual([
      ScheduledMaintenancePhase.Scheduled,
      ScheduledMaintenancePhase.StartOverdue,
    ]);
    expect(firstOverdueWarningAt?.getTime()).toBe(
      at(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS).getTime(),
    );
  });
});

describe("shouldRecheckScheduledMaintenanceState", () => {
  test("never rechecks outside the overdue phases", () => {
    expect(
      shouldRecheckScheduledMaintenanceState(
        timing({ now: at(-MINUTE) }),
        at(-MINUTE),
      ),
    ).toBe(false);
    expect(
      shouldRecheckScheduledMaintenanceState(
        timing({
          stateKind: ScheduledMaintenanceStateKind.Ongoing,
          now: at(HOUR),
        }),
        at(HOUR),
      ),
    ).toBe(false);
    expect(
      shouldRecheckScheduledMaintenanceState(
        timing({
          stateKind: ScheduledMaintenanceStateKind.Ended,
          now: at(10 * SECOND),
        }),
        at(10 * SECOND),
      ),
    ).toBe(false);
  });

  test("rechecks a missed start for a few minutes, then stops", () => {
    for (const offset of [
      0,
      MINUTE,
      SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS,
    ]) {
      expect(
        shouldRecheckScheduledMaintenanceState(
          timing({ now: at(offset) }),
          at(offset),
        ),
      ).toBe(true);
    }

    const tooLate: number =
      SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS + 1;

    expect(
      shouldRecheckScheduledMaintenanceState(
        timing({ now: at(tooLate) }),
        at(tooLate),
      ),
    ).toBe(false);
  });

  test("rechecks a missed end the same way", () => {
    const ongoingAt: (offset: number) => ScheduledMaintenanceTiming = (
      offset: number,
    ): ScheduledMaintenanceTiming => {
      return timing({
        stateKind: ScheduledMaintenanceStateKind.Ongoing,
        now: at(offset, ENDS_AT),
      });
    };

    expect(
      shouldRecheckScheduledMaintenanceState(
        ongoingAt(2 * MINUTE),
        at(2 * MINUTE, ENDS_AT),
      ),
    ).toBe(true);
    expect(
      shouldRecheckScheduledMaintenanceState(ongoingAt(DAY), at(DAY, ENDS_AT)),
    ).toBe(false);
  });

  test("does not recheck without a boundary to measure from", () => {
    expect(
      shouldRecheckScheduledMaintenanceState(
        { phase: ScheduledMaintenancePhase.StartOverdue, isOverdue: true },
        STARTS_AT,
      ),
    ).toBe(false);
  });

  test("keeps the re-read window and spacing sensible", () => {
    // The worker runs every minute, so the window must cover a few of its runs.
    expect(SCHEDULED_MAINTENANCE_STATE_RECHECK_WINDOW_IN_MS).toBeGreaterThan(
      2 * MINUTE,
    );
    expect(SCHEDULED_MAINTENANCE_STATE_RECHECK_MIN_INTERVAL_IN_MS).toBeLessThan(
      SCHEDULED_MAINTENANCE_TIMING_REFRESH_INTERVAL_IN_MS,
    );
    expect(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS).toBeGreaterThan(
      MINUTE,
    );
  });
});

describe("formatScheduledMaintenanceRelativeTime", () => {
  const now: Date = STARTS_AT;

  test.each([
    [30 * SECOND, "in less than a minute"],
    [-30 * SECOND, "less than a minute ago"],
    [0, "less than a minute ago"],
    [MINUTE, "in 1 minute"],
    [MINUTE + 59 * SECOND, "in 1 minute"],
    [2 * MINUTE, "in 2 minutes"],
    [-59 * MINUTE, "59 minutes ago"],
    [HOUR, "in 1 hour"],
    [89 * MINUTE, "in 1 hour"],
    [90 * MINUTE, "in 2 hours"],
    [-5 * HOUR, "5 hours ago"],
    [23 * HOUR + 29 * MINUTE, "in 23 hours"],
    [23 * HOUR + 30 * MINUTE, "in 1 day"],
    [-36 * HOUR, "2 days ago"],
    [3 * DAY, "in 3 days"],
  ])("formats %i ms as %s", (offset: number, text: string) => {
    expect(formatScheduledMaintenanceRelativeTime(at(offset, now), now)).toBe(
      text,
    );
  });

  test("returns an empty string for a missing or invalid date", () => {
    expect(formatScheduledMaintenanceRelativeTime(undefined, now)).toBe("");
    expect(formatScheduledMaintenanceRelativeTime(null, now)).toBe("");
    expect(formatScheduledMaintenanceRelativeTime(new Date("bad"), now)).toBe(
      "",
    );
  });

  test("accepts a string date", () => {
    expect(
      formatScheduledMaintenanceRelativeTime("2026-09-14T22:00:00.000Z", now),
    ).toBe("in 2 hours");
  });
});
