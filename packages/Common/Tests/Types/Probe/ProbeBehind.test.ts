import { describe, expect, test } from "@jest/globals";
import ProbeBehindUtil, {
  BEHIND_AFTER_MS,
  CHECK_LATE_AFTER_MS,
  ON_TIME_AFTER_MS,
  ProbeLateChecks,
} from "../../../Types/Probe/ProbeBehind";

/*
 * When a probe is behind - its monitors checked later than their interval
 * (OneUptime issue #9488). Read once a minute; a check late at readings a
 * minute apart makes the probe behind, and none late for two minutes makes
 * it on time again.
 */

const MINUTE: number = 60 * 1000;
const START: Date = new Date("2026-11-18T09:00:00.000Z");

function at(offsetInMs: number): Date {
  return new Date(START.getTime() + offsetInMs);
}

// Readings a minute apart, late or not, from what is kept.
function readings(
  lateness: Array<boolean>,
  state: ProbeLateChecks = ProbeBehindUtil.cleared(),
): Array<ProbeLateChecks> {
  const states: Array<ProbeLateChecks> = [];
  let current: ProbeLateChecks = state;

  lateness.forEach((isLate: boolean, index: number) => {
    current = ProbeBehindUtil.next({
      state: current,
      isLate: isLate,
      now: at(index * MINUTE),
    });
    states.push(current);
  });

  return states;
}

describe("a late check", () => {
  test("has waited more than a minute past its check time", () => {
    expect(CHECK_LATE_AFTER_MS).toBe(MINUTE);

    expect(
      ProbeBehindUtil.isCheckLate({
        oldestDueAt: at(-MINUTE - 1),
        now: START,
      }),
    ).toBe(true);
    expect(
      ProbeBehindUtil.isCheckLate({ oldestDueAt: at(-MINUTE), now: START }),
    ).toBe(false);
    // Due within the minute: the probe asks for it within its minute.
    expect(
      ProbeBehindUtil.isCheckLate({ oldestDueAt: at(-45 * 1000), now: START }),
    ).toBe(false);
  });

  test("is none when nothing waits, or its time cannot be read", () => {
    expect(ProbeBehindUtil.isCheckLate({ oldestDueAt: null, now: START })).toBe(
      false,
    );
    expect(
      ProbeBehindUtil.isCheckLate({ oldestDueAt: undefined, now: START }),
    ).toBe(false);
    expect(
      ProbeBehindUtil.isCheckLate({ oldestDueAt: "not a date", now: START }),
    ).toBe(false);
  });

  test("is read from a date as a browser or the database hands it, too", () => {
    expect(
      ProbeBehindUtil.isCheckLate({
        oldestDueAt: at(-5 * MINUTE).toISOString(),
        now: START,
      }),
    ).toBe(true);
  });
});

describe("a probe is behind", () => {
  test("once checks are late at readings a minute apart, since the first of them", () => {
    const [first, second] = readings([true, true]);

    // One late reading: a restart, or a monitor created after the last ask.
    expect(ProbeBehindUtil.isBehind(first!)).toBe(false);
    expect(ProbeBehindUtil.getBehindSince(first!)).toBeNull();

    expect(ProbeBehindUtil.isBehind(second!)).toBe(true);
    expect(ProbeBehindUtil.getBehindSince(second!)?.toISOString()).toBe(
      START.toISOString(),
    );
  });

  test("not from two late readings bunched within the minute", () => {
    const first: ProbeLateChecks = ProbeBehindUtil.next({
      state: ProbeBehindUtil.cleared(),
      isLate: true,
      now: START,
    });
    const soon: ProbeLateChecks = ProbeBehindUtil.next({
      state: first,
      isLate: true,
      now: at(BEHIND_AFTER_MS - 1),
    });

    expect(ProbeBehindUtil.isBehind(soon)).toBe(false);

    const later: ProbeLateChecks = ProbeBehindUtil.next({
      state: soon,
      isLate: true,
      now: at(BEHIND_AFTER_MS),
    });

    expect(ProbeBehindUtil.isBehind(later)).toBe(true);
  });

  test("a reading a few seconds short of a minute after the first still counts", () => {
    expect(BEHIND_AFTER_MS).toBeLessThan(MINUTE);
    expect(BEHIND_AFTER_MS).toBeGreaterThanOrEqual(50 * 1000);
  });

  test("a probe checked half as often as set - late at most readings - stays behind", () => {
    // #9488: each monitor every two minutes; some readings land between.
    const states: Array<ProbeLateChecks> = readings([
      true,
      true,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
    ]);

    for (const state of states.slice(1)) {
      expect(ProbeBehindUtil.isBehind(state)).toBe(true);
      expect(ProbeBehindUtil.getBehindSince(state)?.toISOString()).toBe(
        START.toISOString(),
      );
    }
  });

  test("is on time again once no check has been late for two minutes", () => {
    expect(ON_TIME_AFTER_MS).toBe(2 * MINUTE);

    const states: Array<ProbeLateChecks> = readings([
      true,
      true,
      false,
      false,
      false,
    ]);

    expect(ProbeBehindUtil.isBehind(states[1]!)).toBe(true);
    // One and two minutes... on time for a minute: still behind.
    expect(ProbeBehindUtil.isBehind(states[2]!)).toBe(true);
    // Two minutes since the last late reading: on time, nothing kept.
    expect(states[3]).toEqual(ProbeBehindUtil.cleared());
    expect(ProbeBehindUtil.isBehind(states[3]!)).toBe(false);
    expect(states[4]).toEqual(ProbeBehindUtil.cleared());
  });

  test("a late reading after it is on time again starts a new spell", () => {
    const states: Array<ProbeLateChecks> = readings([
      true,
      true,
      false,
      false,
      true,
      true,
    ]);

    expect(ProbeBehindUtil.isBehind(states[3]!)).toBe(false);
    expect(ProbeBehindUtil.isBehind(states[4]!)).toBe(false);
    expect(ProbeBehindUtil.getBehindSince(states[5]!)?.toISOString()).toBe(
      at(4 * MINUTE).toISOString(),
    );
  });

  test("a probe whose checks are never late keeps nothing", () => {
    for (const state of readings([false, false, false])) {
      expect(state).toEqual(ProbeBehindUtil.cleared());
      expect(ProbeBehindUtil.isBehind(state)).toBe(false);
    }
  });

  test("is read the same from the dates a page is handed as strings", () => {
    const [, second] = readings([true, true]);

    expect(
      ProbeBehindUtil.isBehind({
        checksLateSince: second!.checksLateSince!.toISOString(),
        checksLastLateAt: second!.checksLastLateAt!.toISOString(),
      }),
    ).toBe(true);
    expect(ProbeBehindUtil.isBehind({})).toBe(false);
    expect(
      ProbeBehindUtil.isBehind({
        checksLateSince: "garbage",
        checksLastLateAt: second!.checksLastLateAt!.toISOString(),
      }),
    ).toBe(false);
    expect(
      ProbeBehindUtil.isBehind({
        checksLateSince: null,
        checksLastLateAt: second!.checksLastLateAt,
      }),
    ).toBe(false);
  });
});

describe("what the job writes", () => {
  test("only what changed", () => {
    const [first, second, third] = readings([true, true, false]);

    expect(ProbeBehindUtil.hasChanged(ProbeBehindUtil.cleared(), first!)).toBe(
      true,
    );
    // The latest late reading moves on.
    expect(ProbeBehindUtil.hasChanged(first!, second!)).toBe(true);
    // An on-time reading inside the spell changes nothing.
    expect(ProbeBehindUtil.hasChanged(second!, third!)).toBe(false);
    expect(
      ProbeBehindUtil.hasChanged(
        ProbeBehindUtil.cleared(),
        ProbeBehindUtil.cleared(),
      ),
    ).toBe(false);
    // Read back as strings, the same times are no change.
    expect(
      ProbeBehindUtil.hasChanged(
        {
          checksLateSince: second!.checksLateSince!.toISOString(),
          checksLastLateAt: second!.checksLastLateAt!.toISOString(),
        },
        second!,
      ),
    ).toBe(false);
  });
});
