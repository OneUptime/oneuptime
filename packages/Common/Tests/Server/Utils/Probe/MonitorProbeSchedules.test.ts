import { Service as MonitorProbeService } from "../../../../Server/Services/MonitorProbeService";
import MonitorProbeSchedules, {
  KnownSchedules,
  MAX_KNOWN_SCHEDULES,
  NextRunResolver,
  ScheduledRun,
} from "../../../../Server/Utils/Probe/MonitorProbeSchedules";
import CronTab from "../../../../Server/Utils/CronTab";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * The schedules a process hands monitors out on (issue #10819): a probe's
 * claim writes each monitor's next run in its own statement, worked out in
 * Node beforehand for every schedule the process has seen. Which schedules
 * are known, what an unreadable one gets, how many are remembered, and how
 * long an interval is (to tell a monitor handed out a whole interval late).
 */

jest.mock("../../../../Server/Utils/Logger");

const FALLBACK: Date = new Date("2026-11-24T10:01:00.000Z");

function realResolver(): NextRunResolver {
  return (data: {
    monitoringInterval: string;
    fallback: Date;
    onUnreadable: () => void;
  }): Date => {
    return MonitorProbeService.resolveNextPingAt(data);
  };
}

describe("MonitorProbeSchedules", () => {
  afterEach(() => {
    jest.useRealTimers();
    CronTab.clearNextExecutionMemo();
  });

  test("knows no schedule at first, so a fresh process's first claim knows none", () => {
    const schedules: MonitorProbeSchedules = new MonitorProbeSchedules(
      realResolver(),
    );
    expect(schedules.knownSchedules(FALLBACK)).toEqual({
      intervals: [],
      nextPingAts: [],
    });
    expect(schedules.isKnown("* * * * *")).toBe(false);
  });

  test("a schedule worked out once is known, with its next run from now", () => {
    jest.useFakeTimers({ now: new Date("2026-11-24T10:00:30.000Z") });

    const schedules: MonitorProbeSchedules = new MonitorProbeSchedules(
      realResolver(),
    );
    const run: ScheduledRun = schedules.nextRun("*/5 * * * *", FALLBACK);

    expect(run).toEqual({
      nextPingAt: new Date("2026-11-24T10:05:00.000Z"),
      readable: true,
    });
    expect(schedules.isKnown("*/5 * * * *")).toBe(true);

    schedules.nextRun("* * * * *", FALLBACK);
    const known: KnownSchedules = schedules.knownSchedules(FALLBACK);

    expect(known.intervals).toEqual(["*/5 * * * *", "* * * * *"]);
    expect(known.nextPingAts).toEqual([
      "2026-11-24T10:05:00.000Z",
      "2026-11-24T10:01:00.000Z",
    ]);

    // A minute later, the next runs move on.
    jest.setSystemTime(new Date("2026-11-24T10:01:30.000Z"));
    expect(schedules.knownSchedules(FALLBACK).nextPingAts).toEqual([
      "2026-11-24T10:05:00.000Z",
      "2026-11-24T10:02:00.000Z",
    ]);
  });

  test("a human cadence is read as the schedule it means, as every scheduling path reads it", () => {
    jest.useFakeTimers({ now: new Date("2026-11-24T10:00:30.000Z") });

    const schedules: MonitorProbeSchedules = new MonitorProbeSchedules(
      realResolver(),
    );
    expect(schedules.nextRun("5m", FALLBACK)).toEqual({
      nextPingAt: new Date("2026-11-24T10:05:00.000Z"),
      readable: true,
    });
  });

  test("a schedule that cannot be read gets the fallback, is remembered as such, and is never written by the statement", () => {
    const resolve: Mock<NextRunResolver> = jest.fn(
      (data: { fallback: Date; onUnreadable: () => void }): Date => {
        data.onUnreadable();
        return data.fallback;
      },
    ) as never;
    const schedules: MonitorProbeSchedules = new MonitorProbeSchedules(resolve);

    expect(schedules.nextRun("every blue moon", FALLBACK)).toEqual({
      nextPingAt: FALLBACK,
      readable: false,
    });
    expect(schedules.isUnreadable("every blue moon")).toBe(true);
    expect(schedules.isKnown("every blue moon")).toBe(false);
    expect(schedules.knownSchedules(FALLBACK).intervals).toEqual([]);

    // Not read again: cron reads the same text the same way.
    schedules.nextRun("every blue moon", FALLBACK);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  test(`remembers at most ${MAX_KNOWN_SCHEDULES} schedules; one past that is worked out each time`, () => {
    let calls: number = 0;
    const schedules: MonitorProbeSchedules = new MonitorProbeSchedules(
      (): Date => {
        calls++;
        return FALLBACK;
      },
    );

    for (let index: number = 0; index < MAX_KNOWN_SCHEDULES + 5; index++) {
      schedules.nextRun(`schedule ${index}`, FALLBACK);
    }

    expect(schedules.knownSchedules(FALLBACK).intervals).toHaveLength(
      MAX_KNOWN_SCHEDULES,
    );

    const late: string = `schedule ${MAX_KNOWN_SCHEDULES + 4}`;
    const before: number = calls;
    schedules.nextRun(late, FALLBACK);
    expect(calls).toBe(before + 1);
    expect(schedules.isKnown(late)).toBe(false);
  });

  test("an interval's length is its longest gap, worked out once per schedule", () => {
    const schedules: MonitorProbeSchedules = new MonitorProbeSchedules(
      realResolver(),
    );
    const intervalInSeconds: SpyInstance<
      typeof CronTab.getIntervalInSeconds
    > = jest.spyOn(CronTab, "getIntervalInSeconds");

    expect(schedules.getIntervalInMs("* * * * *")).toBe(60_000);
    expect(schedules.getIntervalInMs("*/5 * * * *")).toBe(300_000);
    expect(schedules.getIntervalInMs("5m")).toBe(300_000);
    expect(schedules.getIntervalInMs("* * * * *")).toBe(60_000);
    expect(intervalInSeconds).toHaveBeenCalledTimes(3);

    expect(schedules.getIntervalInMs(null)).toBeNull();
    expect(schedules.getIntervalInMs("not a schedule")).toBeNull();
  });

  test("clear forgets every schedule", () => {
    const schedules: MonitorProbeSchedules = new MonitorProbeSchedules(
      realResolver(),
    );
    schedules.nextRun("* * * * *", FALLBACK);
    schedules.clear();
    expect(schedules.knownSchedules(FALLBACK).intervals).toEqual([]);
  });
});
