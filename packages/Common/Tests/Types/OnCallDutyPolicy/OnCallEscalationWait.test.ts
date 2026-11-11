import OneUptimeDate from "../../../Types/Date";
import {
  getOnCallEscalationDueAt,
  getOnCallEscalationWaitInMinutes,
  getOnCallEscalationWaitStartedAt,
  isOnCallEscalationWaitOver,
  OnCallEscalationWaitRun,
} from "../../../Types/OnCallDutyPolicy/OnCallEscalationWait";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN A RUN'S WAIT ON ITS ESCALATION RULE RUNS OUT (OnCallEscalationWait,
 * issue #6646).
 *
 * The escalation worker moves a run on once the level's "Escalate after"
 * has passed, counting whole minutes from when the level started; what it
 * pages then is timed from the moment the wait ran out
 * (notification.send.lag). Both read the wait here, so the worker's
 * decision is pinned to the rule it always had - written out below as it
 * stood in the worker - and the moment to the first at which that rule
 * says the wait is over: earlier would charge the platform with the
 * level's own wait, later would hide a worker that fell behind.
 */

const MINUTE_IN_MS: number = 60 * 1000;

const LEVEL_STARTED_AT: Date = new Date("2026-11-10T09:30:00.000Z");
const RUN_CREATED_AT: Date = new Date("2026-11-10T09:00:00.000Z");

// The worker's own rule, as it was written before #6646.
function asTheWorkerDecided(run: OnCallEscalationWaitRun, now: Date): boolean {
  const lastExecutedAt: Date = (run.lastEscalationRuleExecutedAt ||
    run.createdAt!) as Date;

  const getDifferenceInMinutes: number = OneUptimeDate.getDifferenceInMinutes(
    lastExecutedAt,
    now,
  );

  return !(
    getDifferenceInMinutes < (run.executeNextEscalationRuleInMinutes || 0)
  );
}

function after(start: Date, milliseconds: number): Date {
  return new Date(start.getTime() + milliseconds);
}

describe("getOnCallEscalationWaitStartedAt", () => {
  test("the wait starts when the level started", () => {
    expect(
      getOnCallEscalationWaitStartedAt({
        lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
        createdAt: RUN_CREATED_AT,
      }),
    ).toEqual(LEVEL_STARTED_AT);
  });

  test("before the run has started a level, at the run's creation", () => {
    expect(
      getOnCallEscalationWaitStartedAt({
        lastEscalationRuleExecutedAt: null,
        createdAt: RUN_CREATED_AT,
      }),
    ).toEqual(RUN_CREATED_AT);
    expect(
      getOnCallEscalationWaitStartedAt({ createdAt: RUN_CREATED_AT }),
    ).toEqual(RUN_CREATED_AT);
  });

  test("a moment read as text, as a row's JSON carries it", () => {
    expect(
      getOnCallEscalationWaitStartedAt({
        lastEscalationRuleExecutedAt: "2026-11-10T09:30:00.000Z",
      }),
    ).toEqual(LEVEL_STARTED_AT);
  });

  test("no moment at all: none", () => {
    expect(getOnCallEscalationWaitStartedAt({})).toBeUndefined();
    expect(
      getOnCallEscalationWaitStartedAt({
        lastEscalationRuleExecutedAt: null,
        createdAt: null,
      }),
    ).toBeUndefined();
  });
});

describe("getOnCallEscalationWaitInMinutes", () => {
  test.each([
    [10, 10],
    [1.5, 1.5],
    [0, 0],
    [null, 0],
    [undefined, 0],
    [NaN, 0],
  ])("a wait of %p is %p minutes", (wait: unknown, minutes: number) => {
    expect(
      getOnCallEscalationWaitInMinutes({
        executeNextEscalationRuleInMinutes: wait as number,
      }),
    ).toBe(minutes);
  });
});

describe("isOnCallEscalationWaitOver: the worker's rule, unchanged", () => {
  test("a wait of 10 minutes: not over at 9 minutes 59, over at 10", () => {
    const run: OnCallEscalationWaitRun = {
      lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
      executeNextEscalationRuleInMinutes: 10,
    };

    expect(
      isOnCallEscalationWaitOver(
        run,
        after(LEVEL_STARTED_AT, 10 * MINUTE_IN_MS - 1000),
      ),
    ).toBe(false);
    expect(
      isOnCallEscalationWaitOver(
        run,
        after(LEVEL_STARTED_AT, 10 * MINUTE_IN_MS),
      ),
    ).toBe(true);
  });

  test("no wait: over at once", () => {
    expect(
      isOnCallEscalationWaitOver(
        { lastEscalationRuleExecutedAt: LEVEL_STARTED_AT },
        LEVEL_STARTED_AT,
      ),
    ).toBe(true);
  });

  test("counts from the run's creation before it has started a level", () => {
    const run: OnCallEscalationWaitRun = {
      createdAt: RUN_CREATED_AT,
      executeNextEscalationRuleInMinutes: 5,
    };

    expect(
      isOnCallEscalationWaitOver(run, after(RUN_CREATED_AT, 4 * MINUTE_IN_MS)),
    ).toBe(false);
    expect(
      isOnCallEscalationWaitOver(run, after(RUN_CREATED_AT, 5 * MINUTE_IN_MS)),
    ).toBe(true);
  });

  test("a wait that never runs out is never over", () => {
    expect(
      isOnCallEscalationWaitOver(
        {
          lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
          executeNextEscalationRuleInMinutes: Infinity,
        },
        after(LEVEL_STARTED_AT, 365 * 24 * 60 * MINUTE_IN_MS),
      ),
    ).toBe(false);
  });

  test("decides as the worker always did, over a seeded sweep of waits, starts and ticks", () => {
    const random: SeededRandom = seededRandom(6646);
    const waits: Array<number | null | undefined> = [
      0,
      1,
      1.5,
      2,
      5,
      10,
      15,
      30,
      60,
      0.25,
      1440,
      -5,
      null,
      undefined,
    ];

    for (let sample: number = 0; sample < 5000; sample++) {
      const startedAt: Date = after(
        LEVEL_STARTED_AT,
        random(7 * 24 * 60 * 60) * 1000 + random(1000),
      );
      const run: OnCallEscalationWaitRun = {
        ...(random(4) === 0
          ? { createdAt: startedAt }
          : {
              lastEscalationRuleExecutedAt: startedAt,
              createdAt: RUN_CREATED_AT,
            }),
        executeNextEscalationRuleInMinutes: waits[random(waits.length)],
      };
      const now: Date = after(startedAt, random(3 * 60 * 60 * 1000));

      expect(isOnCallEscalationWaitOver(run, now)).toBe(
        asTheWorkerDecided(run, now),
      );
    }
  });
});

describe("getOnCallEscalationDueAt: the first moment the wait is over", () => {
  test("a wait of 10 minutes runs out 10 minutes after the level started", () => {
    expect(
      getOnCallEscalationDueAt({
        lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
        createdAt: RUN_CREATED_AT,
        executeNextEscalationRuleInMinutes: 10,
      }),
    ).toEqual(after(LEVEL_STARTED_AT, 10 * MINUTE_IN_MS));
  });

  test("before a level started, counted from the run's creation", () => {
    expect(
      getOnCallEscalationDueAt({
        createdAt: RUN_CREATED_AT,
        executeNextEscalationRuleInMinutes: 3,
      }),
    ).toEqual(after(RUN_CREATED_AT, 3 * MINUTE_IN_MS));
  });

  test.each([
    ["no wait", 0],
    ["a wait that is not set", null],
    ["a wait below 0", -5],
    ["a wait that is not a number", NaN],
  ])("%s: due as the level started", (_name: string, wait: unknown) => {
    expect(
      getOnCallEscalationDueAt({
        lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
        executeNextEscalationRuleInMinutes: wait as number,
      }),
    ).toEqual(LEVEL_STARTED_AT);
  });

  test("a part of a minute waits for the next whole one, as the worker counts: 1.5 runs out at 2", () => {
    const run: OnCallEscalationWaitRun = {
      lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
      executeNextEscalationRuleInMinutes: 1.5,
    };

    expect(getOnCallEscalationDueAt(run)).toEqual(
      after(LEVEL_STARTED_AT, 2 * MINUTE_IN_MS),
    );
    expect(
      isOnCallEscalationWaitOver(
        run,
        after(LEVEL_STARTED_AT, 1.5 * MINUTE_IN_MS),
      ),
    ).toBe(false);
  });

  test("a wait that never runs out has no moment", () => {
    expect(
      getOnCallEscalationDueAt({
        lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
        executeNextEscalationRuleInMinutes: Infinity,
      }),
    ).toBeUndefined();
  });

  test("no moment the wait started, or one that is not a moment: none", () => {
    expect(
      getOnCallEscalationDueAt({ executeNextEscalationRuleInMinutes: 5 }),
    ).toBeUndefined();
    expect(
      getOnCallEscalationDueAt({
        lastEscalationRuleExecutedAt: "not a moment",
        executeNextEscalationRuleInMinutes: 5,
      }),
    ).toBeUndefined();
    expect(
      getOnCallEscalationDueAt({
        lastEscalationRuleExecutedAt: new Date(NaN),
        executeNextEscalationRuleInMinutes: 5,
      }),
    ).toBeUndefined();
  });

  test("a new Date each time: changing it changes nothing the run holds", () => {
    const run: OnCallEscalationWaitRun = {
      lastEscalationRuleExecutedAt: LEVEL_STARTED_AT,
      executeNextEscalationRuleInMinutes: 0,
    };
    const dueAt: Date = getOnCallEscalationDueAt(run)!;

    dueAt.setTime(0);

    expect(run.lastEscalationRuleExecutedAt).toEqual(
      new Date("2026-11-10T09:30:00.000Z"),
    );
  });

  test("over a seeded sweep: the worker finds the wait over at its moment, and not a millisecond before", () => {
    const random: SeededRandom = seededRandom(6647);
    const waits: Array<number> = [
      0, 1, 1.5, 2, 2.25, 5, 7.75, 10, 15, 30, 60, 0.25, 1440,
    ];

    for (let sample: number = 0; sample < 3000; sample++) {
      const startedAt: Date = after(
        LEVEL_STARTED_AT,
        random(30 * 24 * 60 * 60) * 1000 + random(1000),
      );
      const wait: number = waits[random(waits.length)] as number;
      const run: OnCallEscalationWaitRun = {
        lastEscalationRuleExecutedAt: startedAt,
        executeNextEscalationRuleInMinutes: wait,
      };
      const dueAt: Date = getOnCallEscalationDueAt(run)!;

      expect(dueAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime());
      expect(isOnCallEscalationWaitOver(run, dueAt)).toBe(true);
      expect(asTheWorkerDecided(run, dueAt)).toBe(true);

      if (dueAt.getTime() > startedAt.getTime()) {
        expect(isOnCallEscalationWaitOver(run, after(dueAt, -1))).toBe(false);
        expect(asTheWorkerDecided(run, after(dueAt, -1))).toBe(false);
      }

      // Every moment after it is over too: the worker's tick finds it so.
      expect(
        isOnCallEscalationWaitOver(
          run,
          after(dueAt, random(10 * MINUTE_IN_MS)),
        ),
      ).toBe(true);
    }
  });
});
