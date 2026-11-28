import {
  ProbeSchedulingOutcome,
  ProbeSchedulingRefusalAlarm,
  REFUSAL_ALARM_AFTER_MS,
  REFUSAL_ALARM_EVERY_MS,
  REFUSAL_ALARM_MIN_REFUSED,
  REFUSAL_ALARM_SHARE,
  RefusalAlarmNotice,
  RefusalAlarmNoticeKind,
  getRefusalAlarmText,
} from "../../../../Server/Utils/Probe/ProbeSchedulingRefusalAlarm";
import ProbeSchedulingLane from "../../../../Server/Utils/Probe/ProbeSchedulingLane";
import { describe, expect, test } from "@jest/globals";

/*
 * WHEN AN APP REPLICA ANSWERS MOST PROBE REQUESTS BUSY FOR MINUTES.
 *
 * On 27 November 2026 every App replica answered every probe's request for
 * monitors busy from 04:09:46 to 16:24 UTC, and nothing that anyone watched
 * said so. The rules, minute by minute of the clock, per lane:
 *
 *   - a refusal now and then, or a few in a busy minute, is the limit
 *     doing its job: no alarm;
 *   - most of a lane's requests refused minute after minute for three
 *     minutes raises the alarm, once, and again every five minutes while
 *     it goes on - never once a request;
 *   - a minute that is not refusing, or a whole minute in which nobody
 *     asked, ends it, and a run that raised it says once that it is over;
 *   - the lanes are judged apart.
 */

const MINUTE: number = 60 * 1000;

// 2026-11-27T04:09:00Z, the minute the outage began in.
const START: number = Date.parse("2026-11-27T04:09:00.000Z");

class Clock {
  public at: number = START;

  public read: () => number = (): number => {
    return this.at;
  };
}

interface Run {
  alarm: ProbeSchedulingRefusalAlarm;
  clock: Clock;
  notices: Array<RefusalAlarmNotice>;
}

function newRun(): Run {
  const clock: Clock = new Clock();

  return {
    alarm: new ProbeSchedulingRefusalAlarm(clock.read),
    clock: clock,
    notices: [],
  };
}

/*
 * One minute of requests from `at`, spread across it: `refused` answered
 * busy and `granted` given a slot, in the lane.
 */
function minute(
  run: Run,
  data: {
    at: number;
    refused: number;
    granted?: number | undefined;
    lane?: ProbeSchedulingLane | undefined;
  },
): void {
  const lane: ProbeSchedulingLane = data.lane || ProbeSchedulingLane.Work;
  const outcomes: Array<ProbeSchedulingOutcome> = [
    ...Array(data.refused).fill(ProbeSchedulingOutcome.Refused),
    ...Array(data.granted || 0).fill(ProbeSchedulingOutcome.Granted),
  ];

  outcomes.forEach((outcome: ProbeSchedulingOutcome, index: number) => {
    run.clock.at = data.at + Math.floor((index * MINUTE) / outcomes.length);
    run.notices.push(...run.alarm.record(lane, outcome));
  });
}

// `count` minutes in a row from `from`, each refusing every request.
function refusingMinutes(
  run: Run,
  data: { from: number; count: number; refused?: number | undefined },
): void {
  for (let index: number = 0; index < data.count; index++) {
    minute(run, {
      at: data.from + index * MINUTE,
      refused: data.refused ?? 40,
    });
  }
}

function raised(run: Run): Array<RefusalAlarmNotice> {
  return run.notices.filter((notice: RefusalAlarmNotice): boolean => {
    return notice.kind === RefusalAlarmNoticeKind.Raised;
  });
}

function over(run: Run): Array<RefusalAlarmNotice> {
  return run.notices.filter((notice: RefusalAlarmNotice): boolean => {
    return notice.kind === RefusalAlarmNoticeKind.Over;
  });
}

describe("ProbeSchedulingRefusalAlarm", () => {
  test("the rules: half refused, three at least, three minutes on end, said every five", () => {
    expect(REFUSAL_ALARM_SHARE).toBe(0.5);
    expect(REFUSAL_ALARM_MIN_REFUSED).toBe(3);
    expect(REFUSAL_ALARM_AFTER_MS).toBe(3 * MINUTE);
    expect(REFUSAL_ALARM_EVERY_MS).toBe(5 * MINUTE);
  });

  test("a few refusals in busy minutes are the limit doing its job: no alarm", () => {
    const run: Run = newRun();

    for (let index: number = 0; index < 20; index++) {
      minute(run, { at: START + index * MINUTE, refused: 10, granted: 90 });
    }

    expect(run.notices).toEqual([]);
  });

  test("most requests refused for three minutes raises the alarm once, after the third", () => {
    const run: Run = newRun();

    // The first refusal at 04:09:46, then every request refused.
    run.clock.at = START + 46 * 1000;
    run.notices.push(
      ...run.alarm.record(
        ProbeSchedulingLane.Work,
        ProbeSchedulingOutcome.Refused,
      ),
    );
    minute(run, { at: START + 47 * 1000, refused: 9 });
    refusingMinutes(run, { from: START + MINUTE, count: 3 });

    // 04:09 to 04:12 refusing: not three minutes since 04:09:46 yet.
    expect(raised(run)).toEqual([]);

    // The first request of 04:13 closes 04:12: 3 min 14 s of refusals.
    minute(run, { at: START + 4 * MINUTE, refused: 1 });

    expect(raised(run)).toHaveLength(1);
    expect(raised(run)[0]).toEqual({
      kind: RefusalAlarmNoticeKind.Raised,
      lane: ProbeSchedulingLane.Work,
      since: new Date("2026-11-27T04:09:46.000Z"),
      until: new Date("2026-11-27T04:13:00.000Z"),
      asked: 130,
      refused: 130,
    });
  });

  test("while it goes on, it is raised again every five minutes - never once a request", () => {
    const run: Run = newRun();

    // Twelve hours of it, 40 refused a minute.
    refusingMinutes(run, { from: START, count: 12 * 60 });

    const times: Array<string> = raised(run).map(
      (notice: RefusalAlarmNotice): string => {
        return notice.until.toISOString();
      },
    );

    // About one every five minutes: 12 hours, 144 at most.
    expect(times.length).toBeGreaterThan(140);
    expect(times.length).toBeLessThanOrEqual(144);
    expect(times.slice(0, 3)).toEqual([
      "2026-11-27T04:12:00.000Z",
      "2026-11-27T04:17:00.000Z",
      "2026-11-27T04:22:00.000Z",
    ]);
    // Each one counts the whole run so far, from where it began.
    expect(raised(run)[1]!.since.toISOString()).toBe(
      "2026-11-27T04:09:00.000Z",
    );
    expect(raised(run)[1]!.refused).toBe(8 * 40);
    expect(over(run)).toEqual([]);
  });

  test("a minute that is not refusing ends it, said once, and a new run starts from nothing", () => {
    const run: Run = newRun();

    refusingMinutes(run, { from: START, count: 5 });
    // Handed out again.
    minute(run, { at: START + 5 * MINUTE, refused: 0, granted: 50 });
    minute(run, { at: START + 6 * MINUTE, refused: 0, granted: 50 });

    expect(raised(run)).toHaveLength(1);
    expect(over(run)).toEqual([
      {
        kind: RefusalAlarmNoticeKind.Over,
        lane: ProbeSchedulingLane.Work,
        since: new Date("2026-11-27T04:09:00.000Z"),
        until: new Date("2026-11-27T04:14:00.000Z"),
        asked: 200,
        refused: 200,
      },
    ]);

    // Refusing again: three more minutes before it is raised again.
    refusingMinutes(run, { from: START + 7 * MINUTE, count: 3 });
    expect(raised(run)).toHaveLength(1);
    minute(run, { at: START + 10 * MINUTE, refused: 40 });
    expect(raised(run)).toHaveLength(2);
    expect(raised(run)[1]!.since.toISOString()).toBe(
      "2026-11-27T04:16:00.000Z",
    );
  });

  test("a whole minute in which no probe asked ends it: nothing was refused then", () => {
    const run: Run = newRun();

    refusingMinutes(run, { from: START, count: 4 });
    // Nobody asks at 04:13; the next request comes at 04:14.
    minute(run, { at: START + 5 * MINUTE, refused: 0, granted: 1 });

    expect(raised(run)).toHaveLength(1);
    expect(over(run)).toHaveLength(1);
    expect(over(run)[0]!.until.toISOString()).toBe("2026-11-27T04:13:00.000Z");
  });

  test("a run that never raised the alarm ends without a word", () => {
    const run: Run = newRun();

    refusingMinutes(run, { from: START, count: 2 });
    minute(run, { at: START + 2 * MINUTE, refused: 0, granted: 50 });
    minute(run, { at: START + 3 * MINUTE, refused: 0, granted: 50 });

    expect(run.notices).toEqual([]);
  });

  test("an install whose one probe asks three times a minute is caught; two refusals in a minute are not", () => {
    const quiet: Run = newRun();
    refusingMinutes(quiet, { from: START, count: 4, refused: 3 });
    minute(quiet, { at: START + 4 * MINUTE, refused: 3 });
    expect(raised(quiet)).toHaveLength(1);

    const fewer: Run = newRun();
    refusingMinutes(fewer, { from: START, count: 10, refused: 2 });
    expect(fewer.notices).toEqual([]);
  });

  test("half refused is a refusing minute; less than half is not", () => {
    const half: Run = newRun();

    for (let index: number = 0; index < 5; index++) {
      minute(half, { at: START + index * MINUTE, refused: 20, granted: 20 });
    }
    expect(raised(half)).toHaveLength(1);

    const less: Run = newRun();

    for (let index: number = 0; index < 5; index++) {
      minute(less, { at: START + index * MINUTE, refused: 19, granted: 21 });
    }
    expect(less.notices).toEqual([]);
  });

  test("each lane is judged apart: a busy test lane says nothing of the work lane", () => {
    const run: Run = newRun();

    for (let index: number = 0; index < 5; index++) {
      minute(run, {
        at: START + index * MINUTE,
        refused: 30,
        lane: ProbeSchedulingLane.MonitorTests,
      });
      minute(run, {
        at: START + index * MINUTE + 30 * 1000,
        refused: 0,
        granted: 30,
        lane: ProbeSchedulingLane.Work,
      });
    }

    expect(
      raised(run).map((notice: RefusalAlarmNotice): ProbeSchedulingLane => {
        return notice.lane;
      }),
    ).toEqual([ProbeSchedulingLane.MonitorTests]);
  });
});

describe("getRefusalAlarmText", () => {
  const lane: {
    name: string;
    setting: string;
    running: number;
    waiting: number;
    slots: number;
  } = {
    name: "work",
    setting: "PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS",
    running: 10,
    waiting: 87,
    slots: 10,
  };

  test("says how many were refused since when, what waits, and how full the lane is now", () => {
    expect(
      getRefusalAlarmText({
        notice: {
          kind: RefusalAlarmNoticeKind.Raised,
          lane: ProbeSchedulingLane.Work,
          since: new Date("2026-11-27T04:09:46.000Z"),
          until: new Date("2026-11-27T04:13:00.000Z"),
          asked: 130,
          refused: 130,
        },
        lane: lane,
      }),
    ).toBe(
      "this App replica has answered 130 of 130 probe requests busy in its work lane since 2026-11-27T04:09:46.000Z (3 min), so the probes that ask it are refused most of the monitors and other work they ask for, and their checks wait past their time. Now 10 requests are running and 87 waiting for its 10 slots (PROBE_SCHEDULING_MAX_CONCURRENT_REQUESTS=10). /metrics/probe-scheduling shows how every App replica hands out probe work.",
    );
  });

  test("a busy monitor test lane says the Test Monitor runs wait", () => {
    expect(
      getRefusalAlarmText({
        notice: {
          kind: RefusalAlarmNoticeKind.Raised,
          lane: ProbeSchedulingLane.MonitorTests,
          since: new Date("2026-11-27T04:09:00.000Z"),
          until: new Date("2026-11-27T04:12:00.000Z"),
          asked: 40,
          refused: 30,
        },
        lane: {
          ...lane,
          name: "monitor test",
          setting: "PROBE_SCHEDULING_MAX_CONCURRENT_MONITOR_TEST_REQUESTS",
          slots: 2,
        },
      }),
    ).toContain(
      "30 of 40 probe requests busy in its monitor test lane since 2026-11-27T04:09:00.000Z (3 min), so the Test Monitor runs people asked for wait for a probe.",
    );
  });

  test("over: says it hands out work again, and how long it did not", () => {
    expect(
      getRefusalAlarmText({
        notice: {
          kind: RefusalAlarmNoticeKind.Over,
          lane: ProbeSchedulingLane.Work,
          since: new Date("2026-11-27T04:09:46.000Z"),
          until: new Date("2026-11-27T16:24:00.000Z"),
          asked: 29_000,
          refused: 29_000,
        },
        lane: lane,
      }),
    ).toBe(
      "this App replica hands out probe work again in its work lane. It had answered 29000 of 29000 probe requests busy there from 2026-11-27T04:09:46.000Z to 2026-11-27T16:24:00.000Z (734 min).",
    );
  });
});
