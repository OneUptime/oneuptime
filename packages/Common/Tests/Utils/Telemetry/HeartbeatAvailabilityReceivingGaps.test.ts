import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import HeartbeatAvailabilityUtil, {
  HeartbeatAvailabilityPoint,
  HeartbeatAvailabilityResult,
  MIN_SILENCE_EVIDENCE_MS,
} from "../../../Utils/Telemetry/HeartbeatAvailability";
import {
  ReceivingGap,
  ReceivingGapReason,
} from "../../../Utils/Telemetry/ReceivingGaps";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #2825: the host availability chart and its uptime percentage never
 * count OneUptime's own downtime against the host. A restart or upgrade
 * used to draw every host "down" for as long as OneUptime could not receive
 * its heartbeats. Now that time is "not monitored": silent buckets in it are
 * neither up nor down, and the uptime percentage leaves them out - while a
 * heartbeat still proves the host up, and silence OneUptime did hear is
 * still downtime.
 */

const MINUTE: number = 60_000;

// A 30-minute window ending at `now`: the Host overview's default (Minute grid).
const NOW: Date = new Date("2026-10-09T10:30:30.000Z");
const WINDOW_START: Date = new Date(NOW.getTime() - 30 * MINUTE);

function minute(hhmm: string): Date {
  return new Date(`2026-10-09T${hhmm}:00.000Z`);
}

function rows(fromHhmm: string, toHhmm: string, skip: Array<string> = []): Array<AggregatedModel> {
  const result: Array<AggregatedModel> = [];
  const skipped: Set<number> = new Set(
    skip.map((hhmm: string) => {
      return minute(hhmm).getTime();
    }),
  );
  for (
    let t: number = minute(fromHhmm).getTime();
    t <= minute(toHhmm).getTime();
    t += MINUTE
  ) {
    if (!skipped.has(t)) {
      result.push({ timestamp: new Date(t), value: 2 } as AggregatedModel);
    }
  }
  return result;
}

function range(fromHhmm: string, toHhmm: string): Array<string> {
  const result: Array<string> = [];
  for (
    let t: number = minute(fromHhmm).getTime();
    t <= minute(toHhmm).getTime();
    t += MINUTE
  ) {
    result.push(new Date(t).toISOString().slice(11, 16));
  }
  return result;
}

function gap(
  startsAt: Date,
  endsAt: Date,
  reason: ReceivingGapReason = ReceivingGapReason.NotReceiving,
): ReceivingGap {
  return { startsAt, endsAt, reason };
}

// OneUptime restarted at 10:10 and was back at 10:18; agents reconnecting to 10:20.
const RESTART: Array<ReceivingGap> = [
  gap(minute("10:10"), minute("10:18")),
  gap(minute("10:18"), minute("10:20"), ReceivingGapReason.Reconnecting),
];

function build(data: {
  heartbeatData: Array<AggregatedModel>;
  receivingGaps?: Array<ReceivingGap> | undefined;
  windowStart?: Date;
  windowEnd?: Date;
  now?: Date;
}): HeartbeatAvailabilityResult {
  return HeartbeatAvailabilityUtil.buildAvailabilitySeries({
    heartbeatData: data.heartbeatData,
    windowStart: data.windowStart || WINDOW_START,
    windowEnd: data.windowEnd || NOW,
    now: data.now || NOW,
    receivingGaps: data.receivingGaps,
  });
}

function minutesWith(
  result: HeartbeatAvailabilityResult,
  y: number,
): Array<string> {
  return result.points
    .filter((p: HeartbeatAvailabilityPoint) => {
      return p.y === y;
    })
    .map((p: HeartbeatAvailabilityPoint) => {
      return p.x.toISOString().slice(11, 16);
    });
}

describe("A restart is not the host's downtime", () => {
  // The host is up the whole time, but OneUptime heard nothing 10:10-10:19.
  const heartbeats: Array<AggregatedModel> = rows(
    "10:00",
    "10:30",
    range("10:10", "10:19"),
  );

  test("without the gaps the restart reads as ten minutes of downtime (the bug)", () => {
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: heartbeats,
    });
    expect(minutesWith(result, 0)).toEqual(range("10:10", "10:19"));
    expect(result.uptimePercent!).toBeLessThan(70);
  });

  test("with them, the restart is not monitored: no downtime, 100% uptime", () => {
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: heartbeats,
      receivingGaps: RESTART,
    });
    expect(minutesWith(result, 0)).toEqual([]);
    expect(result.uptimePercent).toBe(100);
    // Not monitored is not up either: those minutes are simply not plotted.
    expect(minutesWith(result, 100)).not.toContain("10:12");
  });

  test("a heartbeat that did get through during the gap still proves the host up", () => {
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: [
        ...heartbeats,
        { timestamp: minute("10:12"), value: 1 } as AggregatedModel,
      ],
      receivingGaps: RESTART,
    });
    expect(minutesWith(result, 100)).toContain("10:12");
    expect(minutesWith(result, 0)).toEqual([]);
  });

  test("the first minute after the grace, missed by one beat, is bridged as before", () => {
    // OneUptime is back by 10:20; the host's first beat lands at 10:21.
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: rows("10:00", "10:30", range("10:10", "10:20")),
      receivingGaps: RESTART,
    });
    expect(minutesWith(result, 0)).toEqual([]);
  });
});

describe("Real downtime around a restart is still downtime", () => {
  test("a host that went down before the restart is down before and after it, and unknown during it", () => {
    // The host's last heartbeat was at 10:04.
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: rows("10:00", "10:04"),
      receivingGaps: RESTART,
    });
    expect(minutesWith(result, 0)).toEqual([
      ...range("10:05", "10:09"),
      ...range("10:20", "10:28"),
    ]);
    expect(minutesWith(result, 100)).toEqual(range("10:00", "10:04"));
    // 5 up of 19 judged minutes; the 10 restart minutes are not counted.
    expect(result.uptimePercent).toBeCloseTo((5 / 19) * 100, 6);
  });

  test("without the gaps the same host would be judged on 29 minutes", () => {
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: rows("10:00", "10:04"),
    });
    expect(result.uptimePercent).toBeCloseTo((5 / 29) * 100, 6);
  });
});

describe("Coarser buckets", () => {
  // A 24-hour window: 15-minute buckets.
  const DAY_END: Date = new Date("2026-10-09T12:00:30.000Z");
  const DAY_START: Date = new Date(DAY_END.getTime() - 24 * 60 * MINUTE);

  function quarterRows(skip: Array<string>): Array<AggregatedModel> {
    const result: Array<AggregatedModel> = [];
    const skipped: Set<string> = new Set(skip);
    for (
      let t: number = Date.parse("2026-10-08T12:00:00.000Z");
      t <= Date.parse("2026-10-09T12:00:00.000Z");
      t += 15 * MINUTE
    ) {
      const label: string = new Date(t).toISOString().slice(11, 16);
      if (!skipped.has(label) || new Date(t).getUTCDate() !== 9) {
        result.push({ timestamp: new Date(t), value: 30 } as AggregatedModel);
      }
    }
    return result;
  }

  function quarter(hhmm: string): Date {
    return new Date(`2026-10-09T${hhmm}:00.000Z`);
  }

  function downQuarters(result: HeartbeatAvailabilityResult): Array<string> {
    return result.points
      .filter((p: HeartbeatAvailabilityPoint) => {
        return p.y === 0;
      })
      .map((p: HeartbeatAvailabilityPoint) => {
        return p.x.toISOString().slice(11, 16);
      });
  }

  test("a silent bucket OneUptime heard most of is still down", () => {
    // OneUptime was down 10:00-10:10; the host was silent the whole 10:00 quarter.
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: quarterRows(["10:00"]),
      receivingGaps: [gap(quarter("10:00"), quarter("10:10"))],
      windowStart: DAY_START,
      windowEnd: DAY_END,
      now: DAY_END,
    });
    expect(downQuarters(result)).toEqual(["10:00"]);
  });

  test("a silent bucket OneUptime barely heard is not monitored", () => {
    // Down 09:58-10:14: one minute of the 10:00 quarter was heard.
    const receivingGaps: Array<ReceivingGap> = [
      gap(new Date("2026-10-09T09:58:00.000Z"), quarter("10:14")),
    ];
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: quarterRows(["10:00"]),
      receivingGaps,
      windowStart: DAY_START,
      windowEnd: DAY_END,
      now: DAY_END,
    });
    expect(downQuarters(result)).toEqual([]);
    expect(MIN_SILENCE_EVIDENCE_MS).toBe(2 * MINUTE);
  });

  test("buckets wholly inside a long outage are not monitored", () => {
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: quarterRows(["10:00", "10:15", "10:30", "10:45"]),
      receivingGaps: [gap(quarter("09:55"), quarter("11:00"))],
      windowStart: DAY_START,
      windowEnd: DAY_END,
      now: DAY_END,
    });
    expect(downQuarters(result)).toEqual([]);
    expect(result.uptimePercent).toBe(100);
  });
});

describe("A queue that is behind", () => {
  test("the trailing minutes OneUptime has not read yet are not down", () => {
    // Heartbeats processed up to 10:23; the queue is catching up since 10:24.
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: rows("10:00", "10:23"),
      receivingGaps: [
        gap(minute("10:24"), NOW, ReceivingGapReason.CatchingUp),
      ],
    });
    expect(minutesWith(result, 0)).toEqual([]);
    expect(result.uptimePercent).toBe(100);
  });

  test("without the gap the same tail reads as downtime", () => {
    const result: HeartbeatAvailabilityResult = build({
      heartbeatData: rows("10:00", "10:23"),
    });
    expect(minutesWith(result, 0)).toEqual(range("10:24", "10:28"));
  });
});

describe("No gaps, no change", () => {
  const scenarios: Array<Array<AggregatedModel>> = [
    rows("10:00", "10:30"),
    rows("10:00", "10:30", ["10:07"]),
    rows("10:00", "10:30", range("10:05", "10:12")),
    rows("10:00", "10:04"),
    [],
  ];

  test.each(scenarios.map((scenario: Array<AggregatedModel>, i: number) => {
    return [i, scenario];
  }))("scenario %i reads the same with no gaps, an empty list, or malformed gaps", (_i: number, heartbeatData: Array<AggregatedModel>) => {
    const baseline: HeartbeatAvailabilityResult = build({ heartbeatData });
    expect(build({ heartbeatData, receivingGaps: [] })).toEqual(baseline);
    expect(
      build({
        heartbeatData,
        receivingGaps: [
          gap(new Date("nope"), minute("10:20")),
          gap(minute("10:20"), minute("10:10")),
          gap(minute("09:00"), minute("09:30")),
        ],
      }),
    ).toEqual(baseline);
  });
});
