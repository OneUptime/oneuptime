import OneUptimeDate from "../../../Types/Date";
import {
  getOnCallAcknowledgementTimeoutDueAt,
  isOnCallAcknowledgementTimeoutDue,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  getOnCallPolicyRunPagingDueAt,
  isOnCallPolicyRunWaitOver,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN A PAGE A WORKER STARTS WAS DUE (issue #6708).
 *
 * Two once-a-minute workers start pages that wait: the escalation worker
 * starts a run held by its on-call rule or by OneUptime AI once its moment
 * (pagingStartsAt) has come (isOnCallPolicyRunWaitOver), and the
 * acknowledgement timeout worker pages again once a clock has run out
 * (isOnCallAcknowledgementTimeoutDue). Each page is timed from the moment
 * it was due - getOnCallPolicyRunPagingDueAt, getOnCallAcknowledgementTimeoutDueAt
 * - read from the same row the worker decided with, so the two never
 * disagree: a page is never timed from before its moment came, nor from
 * after the tick that started it.
 */

const MINUTE: number = 60 * 1000;

// The moment a held run's hold runs out: on a minute, with a few seconds.
const HOLD_RUNS_OUT: Date = new Date("2026-11-11T09:00:17.250Z");

describe("whether a held run's moment has come (isOnCallPolicyRunWaitOver)", () => {
  test.each([
    ["no moment", undefined],
    ["null", null],
    ["empty text", ""],
  ])(
    "%s: it pages at once",
    (_name: string, pagingStartsAt: string | null | undefined) => {
      expect(
        isOnCallPolicyRunWaitOver({
          pagingStartsAt: pagingStartsAt,
          now: HOLD_RUNS_OUT,
        }),
      ).toBe(true);
    },
  );

  test("its very moment: come", () => {
    expect(
      isOnCallPolicyRunWaitOver({
        pagingStartsAt: HOLD_RUNS_OUT,
        now: HOLD_RUNS_OUT,
      }),
    ).toBe(true);
  });

  test("a moment past: come", () => {
    expect(
      isOnCallPolicyRunWaitOver({
        pagingStartsAt: HOLD_RUNS_OUT,
        now: new Date(HOLD_RUNS_OUT.getTime() + 61 * MINUTE),
      }),
    ).toBe(true);
  });

  test("a second ahead: not yet", () => {
    expect(
      isOnCallPolicyRunWaitOver({
        pagingStartsAt: HOLD_RUNS_OUT,
        now: new Date(HOLD_RUNS_OUT.getTime() - 1000),
      }),
    ).toBe(false);
  });

  test("counted in whole seconds, as the worker always has: a later millisecond of the same second has come", () => {
    expect(
      isOnCallPolicyRunWaitOver({
        pagingStartsAt: new Date("2026-11-11T09:00:17.900Z"),
        now: new Date("2026-11-11T09:00:17.100Z"),
      }),
    ).toBe(true);
  });

  test("a moment read back as text counts the same", () => {
    expect(
      isOnCallPolicyRunWaitOver({
        pagingStartsAt: HOLD_RUNS_OUT.toISOString(),
        now: new Date(HOLD_RUNS_OUT.getTime() - 5 * MINUTE),
      }),
    ).toBe(false);
    expect(
      isOnCallPolicyRunWaitOver({
        pagingStartsAt: HOLD_RUNS_OUT.toISOString(),
        now: new Date(HOLD_RUNS_OUT.getTime() + 5 * MINUTE),
      }),
    ).toBe(true);
  });

  test("decides exactly as the worker's own reading did before it, offset by offset", () => {
    // ExecutePendingExecutions read it this way until issue #6708.
    const before: (pagingStartsAt: Date | undefined, now: Date) => boolean = (
      pagingStartsAt: Date | undefined,
      now: Date,
    ): boolean => {
      return !(
        pagingStartsAt &&
        OneUptimeDate.isAfter(OneUptimeDate.fromString(pagingStartsAt), now)
      );
    };

    const offsetsInMs: Array<number> = [];

    for (let offset: number = -3000; offset <= 3000; offset += 50) {
      offsetsInMs.push(offset);
    }

    for (const minutes of [-90, -61, -60, -1, 1, 60, 61, 90]) {
      offsetsInMs.push(minutes * MINUTE);
    }

    for (const offset of offsetsInMs) {
      const now: Date = new Date(HOLD_RUNS_OUT.getTime() + offset);

      expect({
        offset,
        over: isOnCallPolicyRunWaitOver({
          pagingStartsAt: HOLD_RUNS_OUT,
          now: now,
        }),
      }).toEqual({ offset, over: before(HOLD_RUNS_OUT, now) });
    }

    expect(before(undefined, HOLD_RUNS_OUT)).toBe(
      isOnCallPolicyRunWaitOver({
        pagingStartsAt: undefined,
        now: HOLD_RUNS_OUT,
      }),
    );
  });
});

describe("when a held run's page was due (getOnCallPolicyRunPagingDueAt)", () => {
  test.each([
    ["on time", 0],
    ["a second late", 1000],
    ["a minute late", MINUTE],
    ["an hour late", 60 * MINUTE],
    ["a day late", 24 * 60 * MINUTE],
  ])("started %s: its moment", (_name: string, lateByInMs: number) => {
    expect(
      getOnCallPolicyRunPagingDueAt({
        pagingStartsAt: HOLD_RUNS_OUT,
        now: new Date(HOLD_RUNS_OUT.getTime() + lateByInMs),
      }),
    ).toEqual(HOLD_RUNS_OUT);
  });

  test("started before its moment - a rule that now matches, OneUptime AI handing it off: now", () => {
    const now: Date = new Date(HOLD_RUNS_OUT.getTime() - 25 * MINUTE);

    expect(
      getOnCallPolicyRunPagingDueAt({
        pagingStartsAt: HOLD_RUNS_OUT,
        now: now,
      }),
    ).toEqual(now);
  });

  test("a moment a later millisecond of the same second - the worker's 'come' - is now, never after it", () => {
    const now: Date = new Date("2026-11-11T09:00:17.100Z");

    expect(
      getOnCallPolicyRunPagingDueAt({
        pagingStartsAt: new Date("2026-11-11T09:00:17.900Z"),
        now: now,
      }),
    ).toEqual(now);
  });

  test("a moment read back as text: the moment it names", () => {
    expect(
      getOnCallPolicyRunPagingDueAt({
        pagingStartsAt: HOLD_RUNS_OUT.toISOString(),
        now: new Date(HOLD_RUNS_OUT.getTime() + 3 * MINUTE),
      }),
    ).toEqual(HOLD_RUNS_OUT);
  });

  test.each([
    ["no moment", undefined],
    ["null", null],
    ["empty text", ""],
    ["text that is no moment", "after lunch"],
    ["a Date that is no moment", new Date(NaN)],
  ])(
    "%s: now",
    (_name: string, pagingStartsAt: Date | string | null | undefined) => {
      const now: Date = new Date(HOLD_RUNS_OUT.getTime() + 2 * MINUTE);

      expect(
        getOnCallPolicyRunPagingDueAt({
          pagingStartsAt: pagingStartsAt,
          now: now,
        }),
      ).toEqual(now);
    },
  );

  test("an answer that is a copy: neither the moment nor now it was handed", () => {
    const now: Date = new Date(HOLD_RUNS_OUT.getTime() + MINUTE);
    const late: Date = getOnCallPolicyRunPagingDueAt({
      pagingStartsAt: HOLD_RUNS_OUT,
      now: now,
    });
    const early: Date = getOnCallPolicyRunPagingDueAt({
      pagingStartsAt: new Date(now.getTime() + MINUTE),
      now: now,
    });

    expect(late).not.toBe(HOLD_RUNS_OUT);
    expect(early).not.toBe(now);

    late.setTime(0);
    early.setTime(0);

    expect(HOLD_RUNS_OUT.toISOString()).toBe("2026-11-11T09:00:17.250Z");
    expect(now.getTime()).toBe(HOLD_RUNS_OUT.getTime() + MINUTE);
  });

  /*
   * A worker that ticks once a minute, at a few seconds past each minute,
   * from ten minutes before the moment to ten after. On every tick the
   * worker starts the run on (its moment has come) the page is due at a
   * moment no later than the tick and - but for the same-second case -
   * at the run's own moment; on the first such tick, its lateness is under
   * a minute; and no tick before it starts the run.
   */
  test("minute by minute, the page's due moment agrees with the worker's decision", () => {
    let firstStartTick: Date | null = null;

    for (let minute: number = -10; minute <= 10; minute++) {
      const tick: Date = new Date(Date.UTC(2026, 10, 11, 9, minute, 3, 0));
      const over: boolean = isOnCallPolicyRunWaitOver({
        pagingStartsAt: HOLD_RUNS_OUT,
        now: tick,
      });

      if (!over) {
        expect({
          tick: tick.toISOString(),
          isBefore: tick < HOLD_RUNS_OUT,
        }).toEqual({ tick: tick.toISOString(), isBefore: true });
        continue;
      }

      const dueAt: Date = getOnCallPolicyRunPagingDueAt({
        pagingStartsAt: HOLD_RUNS_OUT,
        now: tick,
      });

      expect(dueAt.getTime()).toBeLessThanOrEqual(tick.getTime());
      expect(dueAt).toEqual(HOLD_RUNS_OUT);

      if (!firstStartTick) {
        firstStartTick = tick;
      }
    }

    expect(firstStartTick).toEqual(new Date("2026-11-11T09:01:03.000Z"));
    expect(firstStartTick!.getTime() - HOLD_RUNS_OUT.getTime()).toBeLessThan(
      MINUTE,
    );
  });
});

describe("when a page again was due (getOnCallAcknowledgementTimeoutDueAt), against the worker's decision", () => {
  const CLOCK_STARTED_AT: Date = new Date("2026-11-11T08:31:42.500Z");

  test.each([5, 30, 45, 1440])(
    "a %i-minute timeout: due that many minutes after its clock started",
    (minutes: number) => {
      expect(
        getOnCallAcknowledgementTimeoutDueAt({
          startedAt: CLOCK_STARTED_AT,
          minutes: minutes,
        }).getTime() - CLOCK_STARTED_AT.getTime(),
      ).toBe(minutes * MINUTE);
    },
  );

  /*
   * The worker ticks once a minute and pages again on its first tick at or
   * after the moment: the due moment lies after the tick before it and no
   * later than the tick that pages, and every tick from then on finds it
   * due - so the page is never timed from a moment the worker had not
   * reached, nor from one before the timeout ran out.
   */
  test.each([5, 30, 45])(
    "a %i-minute timeout, tick by tick: due between the last tick that waited and the first that pages",
    (minutes: number) => {
      const dueAt: Date = getOnCallAcknowledgementTimeoutDueAt({
        startedAt: CLOCK_STARTED_AT,
        minutes: minutes,
      });
      let previousTick: Date | null = null;
      let pagedAt: Date | null = null;

      for (let tickIndex: number = 0; tickIndex <= minutes + 3; tickIndex++) {
        const tick: Date = new Date(
          Date.UTC(2026, 10, 11, 8, 31, 0, 0) + tickIndex * MINUTE,
        );
        const due: boolean = isOnCallAcknowledgementTimeoutDue({
          startedAt: CLOCK_STARTED_AT,
          minutes: minutes,
          now: tick,
        });

        expect({ tick: tick.toISOString(), due }).toEqual({
          tick: tick.toISOString(),
          due: dueAt.getTime() <= tick.getTime(),
        });

        if (due && !pagedAt) {
          pagedAt = tick;

          expect(dueAt.getTime()).toBeLessThanOrEqual(tick.getTime());
          expect(dueAt.getTime()).toBeGreaterThan(previousTick!.getTime());
        }

        previousTick = tick;
      }

      expect(pagedAt).not.toBeNull();
      // Its lateness against the tick that paged: under a minute.
      expect(pagedAt!.getTime() - dueAt.getTime()).toBeLessThan(MINUTE);
      expect(pagedAt!.getTime() - dueAt.getTime()).toBeGreaterThanOrEqual(0);
    },
  );

  test("a worker that fell behind an hour pages again with the same due moment: its lateness is the hour", () => {
    const dueAt: Date = getOnCallAcknowledgementTimeoutDueAt({
      startedAt: CLOCK_STARTED_AT,
      minutes: 30,
    });
    const lateTick: Date = new Date(dueAt.getTime() + 60 * MINUTE);

    expect(
      isOnCallAcknowledgementTimeoutDue({
        startedAt: CLOCK_STARTED_AT,
        minutes: 30,
        now: lateTick,
      }),
    ).toBe(true);
    expect(lateTick.getTime() - dueAt.getTime()).toBe(60 * MINUTE);
  });
});
