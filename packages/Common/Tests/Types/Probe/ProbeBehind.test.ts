import { describe, expect, test } from "@jest/globals";
import ProbeBehindUtil, {
  BEHIND_AFTER_MS,
  CHECK_LATE_AFTER_MS,
  ON_TIME_AFTER_MS,
  ProbeBehindRead,
  ProbeBehindWork,
  ProbeLateChecks,
  ProbeLateDevicePolls,
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

/*
 * The network devices a probe polls, read by the same rules and kept in
 * two times of their own (OneUptime issue #9499), so a page can say which
 * of the two falls behind. A probe is behind when either is.
 */
describe("ProbeBehindUtil, for the network devices a probe polls", () => {
  // Its longest-waiting check due 14 minutes before the start: 15 late.
  const checksBehind: ProbeLateChecks = {
    checksLateSince: at(0),
    checksLastLateAt: at(MINUTE),
    checksLastLateDueAt: at(-14 * MINUTE),
  };
  // Its longest-waiting poll three hours late at its latest reading.
  const pollsBehind: ProbeLateDevicePolls = {
    devicePollsLateSince: at(2 * MINUTE),
    devicePollsLastLateAt: at(3 * MINUTE),
    devicePollsLastLateDueAt: at(3 * MINUTE - 3 * 60 * MINUTE),
  };
  // The same, as a page reads a probe late on only the one: both kinds of time.
  const checksBehindRead: ProbeBehindRead = { ...checksBehind };
  const pollsBehindRead: ProbeBehindRead = { ...pollsBehind };

  test("the device polls' times are judged as the checks' are, by the same rules", () => {
    const [first, second] = readings([true, true]);

    const polls: ProbeLateDevicePolls = ProbeBehindUtil.lateChecksAsDevicePolls(
      second!,
    );

    expect(polls).toEqual({
      devicePollsLateSince: first!.checksLateSince,
      devicePollsLastLateAt: second!.checksLastLateAt,
      devicePollsLastLateDueAt: second!.checksLastLateDueAt,
    });
    expect(ProbeBehindUtil.devicePollsAsLateChecks(polls)).toEqual(second);
    expect(ProbeBehindUtil.getDevicePollsBehindSince(polls)).toEqual(at(0));
    expect(ProbeBehindUtil.isDevicePollsBehind(polls)).toBe(true);

    // One late reading is not behind, as for checks.
    expect(
      ProbeBehindUtil.isDevicePollsBehind(
        ProbeBehindUtil.lateChecksAsDevicePolls(first!),
      ),
    ).toBe(false);
  });

  test("devices behind do not make the monitors behind, nor the other way round", () => {
    expect(ProbeBehindUtil.isBehind(pollsBehindRead)).toBe(false);
    expect(ProbeBehindUtil.isDevicePollsBehind(checksBehindRead)).toBe(false);
    expect(ProbeBehindUtil.isDevicePollsBehind(pollsBehind)).toBe(true);
    expect(ProbeBehindUtil.isBehind(checksBehind)).toBe(true);
  });

  test("a probe is behind when either is, since the earlier of the two", () => {
    expect(ProbeBehindUtil.isProbeBehind({})).toBe(false);
    expect(ProbeBehindUtil.getProbeBehindSince({})).toBeNull();

    expect(ProbeBehindUtil.isProbeBehind(checksBehind)).toBe(true);
    expect(ProbeBehindUtil.isProbeBehind(pollsBehind)).toBe(true);
    expect(ProbeBehindUtil.getProbeBehindSince(pollsBehind)).toEqual(
      at(2 * MINUTE),
    );

    expect(
      ProbeBehindUtil.getProbeBehindSince({ ...checksBehind, ...pollsBehind }),
    ).toEqual(at(0));
    expect(
      ProbeBehindUtil.getProbeBehindSince({
        checksLateSince: at(5 * MINUTE),
        checksLastLateAt: at(6 * MINUTE),
        ...pollsBehind,
      }),
    ).toEqual(at(2 * MINUTE));
  });

  test("says what the probe is behind on, monitors first", () => {
    expect(ProbeBehindUtil.getBehindWork({})).toEqual([]);
    expect(ProbeBehindUtil.getBehindWork(checksBehind)).toEqual([
      ProbeBehindWork.MonitorChecks,
    ]);
    expect(ProbeBehindUtil.getBehindWork(pollsBehind)).toEqual([
      ProbeBehindWork.DevicePolls,
    ]);
    expect(
      ProbeBehindUtil.getBehindWork({ ...pollsBehind, ...checksBehind }),
    ).toEqual([ProbeBehindWork.MonitorChecks, ProbeBehindWork.DevicePolls]);
  });

  test("reads the times as a page reads them: strings, or nothing", () => {
    expect(
      ProbeBehindUtil.isProbeBehind({
        devicePollsLateSince: pollsBehind.devicePollsLateSince!.toISOString(),
        devicePollsLastLateAt: pollsBehind.devicePollsLastLateAt!.toISOString(),
      }),
    ).toBe(true);
    expect(
      ProbeBehindUtil.isProbeBehind({
        devicePollsLateSince: "not a date",
        devicePollsLastLateAt: null,
      }),
    ).toBe(false);
  });

  test("a probe that is not connected keeps nothing of its devices", () => {
    expect(ProbeBehindUtil.clearedDevicePolls()).toEqual({
      devicePollsLateSince: null,
      devicePollsLastLateAt: null,
      devicePollsLastLateDueAt: null,
    });
    expect(
      ProbeBehindUtil.isDevicePollsBehind(ProbeBehindUtil.clearedDevicePolls()),
    ).toBe(false);
  });

  test("the job writes the device polls' times only when they changed", () => {
    expect(ProbeBehindUtil.hasDevicePollsChanged({}, pollsBehind)).toBe(true);
    expect(
      ProbeBehindUtil.hasDevicePollsChanged(
        pollsBehind,
        ProbeBehindUtil.clearedDevicePolls(),
      ),
    ).toBe(true);
    expect(
      ProbeBehindUtil.hasDevicePollsChanged(
        {},
        ProbeBehindUtil.clearedDevicePolls(),
      ),
    ).toBe(false);
    // Read back as strings, the same times are no change.
    expect(
      ProbeBehindUtil.hasDevicePollsChanged(
        {
          devicePollsLateSince: pollsBehind.devicePollsLateSince!.toISOString(),
          devicePollsLastLateAt:
            pollsBehind.devicePollsLastLateAt!.toISOString(),
          devicePollsLastLateDueAt:
            pollsBehind.devicePollsLastLateDueAt!.toISOString(),
        },
        pollsBehind,
      ),
    ).toBe(false);
    // The checks' times are not the device polls'.
    expect(
      ProbeBehindUtil.hasDevicePollsChanged(
        checksBehindRead,
        ProbeBehindUtil.clearedDevicePolls(),
      ),
    ).toBe(false);
  });
});

/*
 * How far behind a probe is ("Behind by 15 minutes"): how long its
 * longest-waiting check had waited past its check time at the latest
 * reading that found one late, kept as the due time of that check
 * (checksLastLateDueAt) beside that reading's time.
 */
describe("how far behind a probe is", () => {
  // Readings a minute apart of a probe handed nothing: one check waits on.
  function starved(count: number, dueAt: Date): ProbeLateChecks {
    let state: ProbeLateChecks = ProbeBehindUtil.cleared();

    for (let reading: number = 0; reading < count; reading++) {
      state = ProbeBehindUtil.next({
        state,
        isLate: true,
        now: at(reading * MINUTE),
        oldestDueAt: dueAt,
      });
    }

    return state;
  }

  test("a late reading keeps when its longest-waiting check was due", () => {
    const state: ProbeLateChecks = ProbeBehindUtil.next({
      state: ProbeBehindUtil.cleared(),
      isLate: true,
      now: START,
      oldestDueAt: at(-15 * MINUTE).toISOString(),
    });

    expect(state.checksLastLateDueAt).toEqual(at(-15 * MINUTE));
  });

  test("is how long that check had waited at the latest late reading, and grows while it waits", () => {
    expect(ProbeBehindUtil.getBehindByMs(starved(2, at(-15 * MINUTE)))).toBe(
      16 * MINUTE,
    );
    expect(ProbeBehindUtil.getBehindByMs(starved(5, at(-15 * MINUTE)))).toBe(
      19 * MINUTE,
    );
  });

  test("is nothing before the probe is behind, or when no due time is kept", () => {
    // One late reading is not behind yet.
    expect(
      ProbeBehindUtil.getBehindByMs(starved(1, at(-15 * MINUTE))),
    ).toBeNull();
    // Kept before OneUptime kept the due time: behind, by how much not known.
    const [, second] = readings([true, true]);
    expect(ProbeBehindUtil.isBehind(second!)).toBe(true);
    expect(ProbeBehindUtil.getBehindByMs(second!)).toBeNull();
    expect(ProbeBehindUtil.getBehindByMs({})).toBeNull();
    expect(
      ProbeBehindUtil.getBehindByMs({
        ...starved(2, at(-15 * MINUTE)),
        checksLastLateDueAt: "not a date",
      }),
    ).toBeNull();
  });

  test("keeps the latest lateness while on time inside the spell, and goes with the rest", () => {
    const behind: ProbeLateChecks = starved(2, at(-15 * MINUTE));
    const onTime: ProbeLateChecks = ProbeBehindUtil.next({
      state: behind,
      isLate: false,
      now: at(2 * MINUTE),
    });

    expect(ProbeBehindUtil.getBehindByMs(onTime)).toBe(16 * MINUTE);
    // Nothing changed for the job to write.
    expect(ProbeBehindUtil.hasChanged(behind, onTime)).toBe(false);

    const caughtUp: ProbeLateChecks = ProbeBehindUtil.next({
      state: onTime,
      isLate: false,
      now: at(3 * MINUTE),
    });

    expect(caughtUp).toEqual(ProbeBehindUtil.cleared());
    expect(ProbeBehindUtil.getBehindByMs(caughtUp)).toBeNull();
  });

  test("a new due time is a change the job writes; the same one read back as a string is not", () => {
    const behind: ProbeLateChecks = starved(2, at(-15 * MINUTE));

    expect(
      ProbeBehindUtil.hasChanged(behind, {
        ...behind,
        checksLastLateDueAt: at(-14 * MINUTE),
      }),
    ).toBe(true);
    expect(
      ProbeBehindUtil.hasChanged(
        {
          checksLateSince: behind.checksLateSince!.toISOString(),
          checksLastLateAt: behind.checksLastLateAt!.toISOString(),
          checksLastLateDueAt: behind.checksLastLateDueAt!.toISOString(),
        },
        behind,
      ),
    ).toBe(false);
  });

  test("is said in the largest whole unit that fits", () => {
    const amount: (ms: number) => unknown = (ms: number): unknown => {
      return ProbeBehindUtil.getBehindByAmount(ms);
    };

    expect(amount(61 * 1000)).toEqual({ unit: "minute", count: 1 });
    expect(amount(15 * MINUTE + 59 * 1000)).toEqual({
      unit: "minute",
      count: 15,
    });
    expect(amount(60 * MINUTE - 1)).toEqual({ unit: "minute", count: 59 });
    expect(amount(60 * MINUTE)).toEqual({ unit: "hour", count: 1 });
    // 2026-11-27: handed nothing from 04:09:46, read at 16:00.
    expect(amount(11 * 60 * MINUTE + 50 * MINUTE)).toEqual({
      unit: "hour",
      count: 11,
    });
    expect(amount(48 * 60 * MINUTE - 1)).toEqual({ unit: "hour", count: 47 });
    expect(amount(48 * 60 * MINUTE)).toEqual({ unit: "day", count: 2 });
    expect(amount(10 * 24 * 60 * MINUTE)).toEqual({ unit: "day", count: 10 });
  });

  test("the device polls' by the same rules, and the probe as far behind as the further of the two", () => {
    const checksBehind: ProbeLateChecks = starved(2, at(-14 * MINUTE));
    const pollsBehind: ProbeLateDevicePolls =
      ProbeBehindUtil.lateChecksAsDevicePolls(starved(2, at(-179 * MINUTE)));

    // As a page reads a probe late on only the one: both kinds of time.
    const checksBehindRead: ProbeBehindRead = { ...checksBehind };
    const pollsBehindRead: ProbeBehindRead = { ...pollsBehind };

    expect(ProbeBehindUtil.getBehindByMs(checksBehind)).toBe(15 * MINUTE);
    expect(ProbeBehindUtil.getDevicePollsBehindByMs(pollsBehind)).toBe(
      180 * MINUTE,
    );
    // Each kind's times are its own.
    expect(
      ProbeBehindUtil.getDevicePollsBehindByMs(checksBehindRead),
    ).toBeNull();
    expect(ProbeBehindUtil.getBehindByMs(pollsBehindRead)).toBeNull();

    expect(ProbeBehindUtil.getProbeBehindByMs({})).toBeNull();
    expect(ProbeBehindUtil.getProbeBehindByMs(checksBehind)).toBe(15 * MINUTE);
    expect(ProbeBehindUtil.getProbeBehindByMs(pollsBehind)).toBe(180 * MINUTE);
    expect(
      ProbeBehindUtil.getProbeBehindByMs({ ...checksBehind, ...pollsBehind }),
    ).toBe(180 * MINUTE);
  });
});
