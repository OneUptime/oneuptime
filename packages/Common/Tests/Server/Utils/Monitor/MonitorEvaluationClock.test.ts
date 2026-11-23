import MonitorEvaluationClock from "../../../../Server/Utils/Monitor/MonitorEvaluationClock";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE CLOCK OF ONE EVALUATION (#10317).
 *
 * An evaluation begins with its summary - or, for a telemetry check, with
 * its reads before that - and ends as its monitor log entry is written:
 * then its summary says how long it took, how many series it judged and
 * how often its monitor is evaluated. These tests drive the clock by hand.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

let now: number = 0;

function useClockAt(start: number): void {
  now = start;
  jest.spyOn(MonitorEvaluationClock, "now").mockImplementation((): number => {
    return now;
  });
}

function newSummary(): MonitorEvaluationSummary {
  return {
    evaluatedAt: new Date("2026-11-23T10:04:30.000Z"),
    criteriaResults: [],
    events: [],
  };
}

function checkWith(
  summary: MonitorEvaluationSummary,
  extra: Record<string, unknown> = {},
): DataToProcess {
  return {
    monitorId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    evaluationSummary: summary,
    ...extra,
  } as unknown as DataToProcess;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorEvaluationClock: how long an evaluation took", () => {
  test("from its beginning to its end, in whole milliseconds", () => {
    useClockAt(1_000);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.begin(summary);
    now = 3_450.4;
    MonitorEvaluationClock.end(checkWith(summary));

    expect(summary.durationInMs).toBe(2_450);
  });

  test("a telemetry check's begins with its reads, before its summary", () => {
    useClockAt(5_000);
    const summary: MonitorEvaluationSummary = newSummary();

    // The reads began at 1,200; the summary at 5,000.
    MonitorEvaluationClock.begin(summary, 1_200);
    now = 7_700;
    MonitorEvaluationClock.end(checkWith(summary));

    expect(summary.durationInMs).toBe(6_500);
  });

  test("a beginning that is no time is now", () => {
    useClockAt(2_000);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.begin(summary, Number.NaN);
    now = 2_250;
    MonitorEvaluationClock.end(checkWith(summary));

    expect(summary.durationInMs).toBe(250);
  });

  test("the summary says nothing of it until the end: one captured part way through holds none", () => {
    useClockAt(0);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.begin(summary);
    MonitorEvaluationClock.schedule(summary, {
      monitorType: MonitorType.Metrics,
      monitoringInterval: "* * * * *",
    });

    // What an incident or alert keeps of it (MonitorResource's capture).
    const captured: MonitorEvaluationSummary = { ...summary };

    now = 900;
    MonitorEvaluationClock.end(checkWith(summary));

    expect(captured.durationInMs).toBeUndefined();
    expect(captured.intervalInMs).toBeUndefined();
    expect(captured.seriesJudged).toBeUndefined();
    expect(summary.durationInMs).toBe(900);
    expect(summary.intervalInMs).toBe(MINUTE);
  });

  test("ends once: a second end changes nothing", () => {
    useClockAt(0);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.begin(summary);
    now = 100;
    MonitorEvaluationClock.end(checkWith(summary));
    now = 50_000;
    MonitorEvaluationClock.end(checkWith(summary));

    expect(summary.durationInMs).toBe(100);
  });

  test("a summary that never began here, or a check with none, is left as it is", () => {
    useClockAt(0);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.end(checkWith(summary));
    MonitorEvaluationClock.end(checkWith(undefined as never));
    MonitorEvaluationClock.end(undefined);

    expect(summary).toEqual(newSummary());
  });
});

describe("MonitorEvaluationClock: how many series it judged", () => {
  function seriesJudgedOf(extra: Record<string, unknown>): number | undefined {
    useClockAt(0);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.begin(summary);
    MonitorEvaluationClock.end(checkWith(summary, extra));
    jest.restoreAllMocks();

    return summary.seriesJudged;
  }

  test("a grouped Metrics check: every series, those with no data among them", () => {
    expect(
      seriesJudgedOf({
        seriesBreakdown: [
          { fingerprint: "a", aggregatedResults: [{ data: [{ value: 1 }] }] },
          { fingerprint: "b", aggregatedResults: [{ data: [] }] },
          { fingerprint: "c", aggregatedResults: [] },
        ],
      }),
    ).toBe(3);
  });

  test("a grouped Logs or Traces check: every group", () => {
    expect(
      seriesJudgedOf({
        groupBreakdown: Array.from(
          { length: 16_250 },
          (_v: unknown, i: number) => {
            return { fingerprint: `fp-${i}` };
          },
        ),
      }),
    ).toBe(16_250);
  });

  test("a check split into no series: none said", () => {
    expect(seriesJudgedOf({ metricResult: [{ data: [] }] })).toBeUndefined();
    expect(seriesJudgedOf({})).toBeUndefined();
  });
});

describe("MonitorEvaluationClock.getIntervalInMs: what an evaluation is weighed against", () => {
  const from: Date = new Date("2026-11-23T10:04:30.000Z");

  test.each([
    [MonitorType.Metrics, "* * * * *", MINUTE],
    [MonitorType.Metrics, "*/5 * * * *", 5 * MINUTE],
    [MonitorType.Logs, "*/10 * * * *", 10 * MINUTE],
    [MonitorType.Host, "0 * * * *", 60 * MINUTE],
    [MonitorType.Website, "*/2 * * * *", 2 * MINUTE],
    [MonitorType.Ping, "* * * * *", MINUTE],
  ])(
    "a %s monitor checked on %s: every %i ms",
    (monitorType: MonitorType, schedule: string, intervalInMs: number) => {
      expect(
        MonitorEvaluationClock.getIntervalInMs({
          monitorType: monitorType,
          monitoringInterval: schedule,
          from: from,
        }),
      ).toBe(intervalInMs);
    },
  );

  test("a cadence its scheduler reads as a schedule", () => {
    expect(
      MonitorEvaluationClock.getIntervalInMs({
        monitorType: MonitorType.Metrics,
        monitoringInterval: "5m",
        from: from,
      }),
    ).toBe(5 * MINUTE);
  });

  test("a telemetry monitor with no schedule it can read is checked every minute, as its scheduler falls back to", () => {
    for (const monitoringInterval of [undefined, null, "", "not a schedule"]) {
      expect(
        MonitorEvaluationClock.getIntervalInMs({
          monitorType: MonitorType.Metrics,
          monitoringInterval: monitoringInterval,
          from: from,
        }),
      ).toBe(MINUTE);
    }
  });

  test("a probe's monitor with none has none", () => {
    expect(
      MonitorEvaluationClock.getIntervalInMs({
        monitorType: MonitorType.Website,
        monitoringInterval: undefined,
        from: from,
      }),
    ).toBeUndefined();
  });

  test.each([
    MonitorType.IncomingRequest,
    MonitorType.IncomingEmail,
    MonitorType.Server,
    MonitorType.Manual,
  ])(
    "a %s monitor is evaluated as its results arrive: no interval",
    (monitorType: MonitorType) => {
      expect(
        MonitorEvaluationClock.getIntervalInMs({
          monitorType: monitorType,
          monitoringInterval: "* * * * *",
          from: from,
        }),
      ).toBeUndefined();
    },
  );

  test("no monitor type, no interval", () => {
    expect(
      MonitorEvaluationClock.getIntervalInMs({
        monitorType: undefined,
        monitoringInterval: "* * * * *",
        from: from,
      }),
    ).toBeUndefined();
  });

  test("scheduled once its monitor is read, said at the end", () => {
    useClockAt(0);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.begin(summary);
    MonitorEvaluationClock.schedule(summary, {
      monitorType: MonitorType.Metrics,
      monitoringInterval: "*/5 * * * *",
    });
    MonitorEvaluationClock.end(checkWith(summary));

    expect(summary.intervalInMs).toBe(5 * MINUTE);
  });

  test("a monitor evaluated as its results arrive says no interval", () => {
    useClockAt(0);
    const summary: MonitorEvaluationSummary = newSummary();

    MonitorEvaluationClock.begin(summary);
    MonitorEvaluationClock.schedule(summary, {
      monitorType: MonitorType.IncomingRequest,
      monitoringInterval: undefined,
    });
    MonitorEvaluationClock.end(checkWith(summary));

    expect(summary.durationInMs).toBe(0);
    expect("intervalInMs" in summary).toBe(false);
  });
});
