import MetricWindowCoverage, {
  MetricEvaluationWindow,
  MetricWindowCoverageResult,
  NOTABLE_DATA_LAG_MS,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricWindowCoverage";
import { WindowCoverageShortfall } from "../../../../../Server/Utils/Monitor/Criteria/WindowCoverage";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import MetricSeriesArrival from "../../../../../Types/Monitor/MetricMonitor/MetricSeriesArrival";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import { describe, expect, test } from "@jest/globals";

/*
 * A SERIES' LAG AND STALENESS, FROM WHEN ITS DATA ARRIVED (#4912's
 * follow-up, #5281, #5437).
 *
 * A metric row is stamped with the time its source measured, and OneUptime
 * notes the second it wrote the row (createdAt). By the stamp alone a late
 * series and a stopped one look alike - neither has a data point near now -
 * so #4912 judged a Metrics monitor's freshness against its own newest data
 * point (and missed a source that stopped altogether) and an infrastructure
 * monitor's against now (and waited for ever on a collector whose clock runs
 * behind). With the series' arrivals (MetricSeriesArrival: how long nothing
 * has arrived, how late it arrives, how often), a series is stale only once
 * nothing of it has arrived for one and a half times its cadence, and its
 * window counts as far as its data reaches.
 *
 * The window comes from the worker's response and the arrivals are
 * durations the worker measured, so nothing here reads the clock.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

// The worker's window for Past 15 Minutes, evaluated at 12:15:30.
const NOW: Date = new Date(Date.UTC(2026, 9, 16, 12, 15, 30));

function windowOf(rollingTime: RollingTime, at: Date): MetricEvaluationWindow {
  const range: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    rollingTime,
    at,
  );

  return {
    startMs: (range.startValue as Date).getTime(),
    endMs: (range.endValue as Date).getTime(),
    completeFromMs: null,
  };
}

const WINDOW: MetricEvaluationWindow = windowOf(RollingTime.Past15Minutes, NOW);

// A data point for the minute bucket starting at `utcMinute` past 12:00.
function point(utcMinute: number): AggregateModel {
  return {
    timestamp: new Date(Date.UTC(2026, 9, 16, 12, 0, 0) + utcMinute * MINUTE),
    value: 1,
  };
}

// One data point a minute, from the bucket at 12:`from` to 12:`to`.
function points(from: number, to: number): Array<AggregateModel> {
  const result: Array<AggregateModel> = [];
  for (let minute: number = from; minute <= to; minute++) {
    result.push(point(minute));
  }
  return result;
}

function arrival(input: Partial<MetricSeriesArrival>): MetricSeriesArrival {
  return {
    sinceNewestArrivalMs: 20 * SECOND,
    lagMs: 30 * SECOND,
    arrivalIntervalMs: MINUTE,
    ...input,
  };
}

function judge(input: {
  samples: Array<AggregateModel>;
  arrival?: MetricSeriesArrival | null;
  window?: MetricEvaluationWindow;
  monitorIntervalMs?: number | null;
  monitorNewestDataPointMs?: number | null;
}): MetricWindowCoverageResult {
  return MetricWindowCoverage.judge({
    window: input.window || WINDOW,
    samples: input.samples,
    monitorIntervalMs: input.monitorIntervalMs,
    monitorNewestDataPointMs: input.monitorNewestDataPointMs,
    arrival: input.arrival,
  });
}

describe("a series whose data arrives late, but keeps arriving", () => {
  /*
   * A host whose clock runs four minutes behind: its newest data point,
   * 12:10's bucket, ended four and a half minutes before the window's end,
   * and it arrived twenty seconds ago.
   */
  const behind: Array<AggregateModel> = points(0, 10);

  test("covers the window as far as its data reaches", () => {
    const result: MetricWindowCoverageResult = judge({
      samples: behind,
      arrival: arrival({ lagMs: 4 * MINUTE + 50 * SECOND }),
    });

    expect(result.isCovered).toBe(true);
    expect(result.shortfall).toBeNull();
    expect(result.lagMs).toBe(4 * MINUTE + 50 * SECOND);
    expect(result.sinceNewestArrivalMs).toBe(20 * SECOND);
  });

  test("by its data points' times alone it looked stopped, and waited for ever", () => {
    const result: MetricWindowCoverageResult = judge({ samples: behind });

    expect(result.shortfall).toBe(WindowCoverageShortfall.Stale);
    expect(result.lagMs).toBeNull();
    expect(MetricWindowCoverage.describeWait(result)).toBe(
      "Waiting for 15 minutes of data: no new data point for the last 4 minutes.",
    );
  });

  test("so does a source late by design, however late, while its data keeps coming", () => {
    // CloudWatch: 30 minutes read, the newest point fourteen minutes old.
    const lateWindow: MetricEvaluationWindow = windowOf(
      RollingTime.Past30Minutes,
      new Date(Date.UTC(2026, 9, 16, 12, 30, 30)),
    );

    expect(
      judge({
        window: lateWindow,
        samples: points(0, 16),
        arrival: arrival({
          sinceNewestArrivalMs: 2 * MINUTE,
          lagMs: 11 * MINUTE,
          arrivalIntervalMs: 5 * MINUTE,
        }),
      }).isCovered,
    ).toBe(true);
  });

  test("a source that delivers five minutes at once may go one and a half deliveries without anything new", () => {
    const deliveries: (
      sinceNewestArrivalMs: number,
    ) => MetricWindowCoverageResult = (
      sinceNewestArrivalMs: number,
    ): MetricWindowCoverageResult => {
      return judge({
        samples: behind,
        arrival: arrival({
          sinceNewestArrivalMs: sinceNewestArrivalMs,
          lagMs: 6 * MINUTE,
          arrivalIntervalMs: 5 * MINUTE,
        }),
      });
    };

    expect(deliveries(4 * MINUTE + 59 * SECOND).isCovered).toBe(true);
    expect(deliveries(7.5 * MINUTE).isCovered).toBe(true);
    expect(deliveries(7.5 * MINUTE + 1).shortfall).toBe(
      WindowCoverageShortfall.Stale,
    );
  });

  test("a late start and a hole still wait", () => {
    expect(
      judge({
        samples: points(6, 10),
        arrival: arrival({ lagMs: 5 * MINUTE }),
      }).shortfall,
    ).toBe(WindowCoverageShortfall.StartsLate);
    expect(
      judge({
        samples: [...points(0, 3), ...points(7, 10)],
        arrival: arrival({ lagMs: 5 * MINUTE }),
      }).shortfall,
    ).toBe(WindowCoverageShortfall.Hole);
  });
});

describe("a series whose data stopped arriving", () => {
  test("is stale once nothing has arrived for one and a half data points, wherever its data points end", () => {
    // Its points reach the very end of the window, but none came for 2 minutes.
    expect(
      judge({
        samples: points(0, 15),
        arrival: arrival({ sinceNewestArrivalMs: 2 * MINUTE }),
      }).shortfall,
    ).toBe(WindowCoverageShortfall.Stale);
    expect(
      judge({
        samples: points(0, 15),
        arrival: arrival({ sinceNewestArrivalMs: 90 * SECOND }),
      }).isCovered,
    ).toBe(true);
  });

  test("says how long nothing has arrived, not how old its newest data point is", () => {
    const result: MetricWindowCoverageResult = judge({
      samples: points(0, 10),
      arrival: arrival({ sinceNewestArrivalMs: 6 * MINUTE, lagMs: 0 }),
    });

    expect(result.shortfall).toBe(WindowCoverageShortfall.Stale);
    // Four and a half minutes old by its own time; six minutes since it arrived.
    expect(result.sinceNewestReadingMs).toBe(4.5 * MINUTE);
    expect(MetricWindowCoverage.describeWait(result)).toBe(
      "Waiting for 15 minutes of data: no new data point for the last 6 minutes.",
    );
  });

  /*
   * A Metrics monitor without arrivals judges its series against its own
   * newest data point: when every series stopped at once (the exporter went
   * away), each is as fresh as the newest, and the window was judged up to
   * where they stopped. With arrivals, they are stale.
   */
  test("on a Metrics monitor whose every series stopped at once, too - the monitor's newest data point no longer passes for now", () => {
    const stopped: Array<AggregateModel> = points(0, 6);
    const newestMs: number = (point(6).timestamp as Date).getTime();

    expect(
      judge({
        samples: stopped,
        monitorIntervalMs: MINUTE,
        monitorNewestDataPointMs: newestMs,
      }).isCovered,
    ).toBe(true);

    const result: MetricWindowCoverageResult = judge({
      samples: stopped,
      monitorIntervalMs: MINUTE,
      monitorNewestDataPointMs: newestMs,
      arrival: arrival({ sinceNewestArrivalMs: 8 * MINUTE + 40 * SECOND }),
    });

    expect(result.shortfall).toBe(WindowCoverageShortfall.Stale);
    expect(MetricWindowCoverage.describeWait(result)).toBe(
      "Waiting for 15 minutes of data: no new data point for the last 8 minutes.",
    );
  });

  test("a series that stopped while the monitor's others kept coming still waits", () => {
    expect(
      judge({
        samples: points(0, 9),
        monitorIntervalMs: MINUTE,
        monitorNewestDataPointMs: (point(15).timestamp as Date).getTime(),
        arrival: arrival({ sinceNewestArrivalMs: 6 * MINUTE }),
      }).shortfall,
    ).toBe(WindowCoverageShortfall.Stale);
  });
});

describe("what the evaluation log says about a late series", () => {
  test("a late series that is new says how late its data arrives", () => {
    expect(
      MetricWindowCoverage.describeWait(
        judge({
          samples: points(7, 10),
          arrival: arrival({ lagMs: 4 * MINUTE + 50 * SECOND }),
        }),
      ),
    ).toBe(
      "Waiting for 15 minutes of data: 4 of 15 minutes so far. Its data arrives about 4 minutes late.",
    );
  });

  test("and so does one with a hole", () => {
    expect(
      MetricWindowCoverage.describeWait(
        judge({
          samples: [...points(0, 3), ...points(7, 10)],
          arrival: arrival({ lagMs: 12 * MINUTE }),
        }),
      ),
    ).toBe(
      "Waiting for 15 minutes of data: 4 of 15 minutes so far, since a 3-minute gap in its data. Its data arrives about 12 minutes late.",
    );
  });

  test("a stale series' sentence is about when it stopped, never its lag", () => {
    const message: string = MetricWindowCoverage.describeWait(
      judge({
        samples: points(0, 6),
        arrival: arrival({
          sinceNewestArrivalMs: 6 * MINUTE,
          lagMs: 3 * MINUTE,
        }),
      }),
    );

    expect(message).toBe(
      "Waiting for 15 minutes of data: no new data point for the last 6 minutes.",
    );
  });

  test("an ordinary pipeline's lag - under two minutes - is not said", () => {
    expect(
      MetricWindowCoverage.describeWait(
        judge({
          samples: points(12, 15),
          arrival: arrival({ lagMs: NOTABLE_DATA_LAG_MS - 1 }),
        }),
      ),
    ).toBe("Waiting for 15 minutes of data: 3 of 15 minutes so far.");
  });

  test("a cut read says so before it says how late the data arrives", () => {
    const cut: MetricEvaluationWindow = {
      ...WINDOW,
      completeFromMs: NOW.getTime() - 10 * MINUTE,
    };

    expect(
      MetricWindowCoverage.describeWait(
        judge({
          window: cut,
          samples: points(9, 12),
          arrival: arrival({ lagMs: 3 * MINUTE }),
        }),
      ),
    ).toBe(
      "Waiting for 10 minutes of data: 4 of 10 minutes so far. Only the newest 10 minutes of the 15-minute time range could be read: it holds more data points than one check reads. Its data arrives about 3 minutes late.",
    );
  });
});

describe("MetricWindowCoverage.isNotableLag and describeLag", () => {
  test.each([
    [0, MINUTE, false],
    [NOTABLE_DATA_LAG_MS - 1, MINUTE, false],
    [NOTABLE_DATA_LAG_MS, MINUTE, true],
    [11 * MINUTE, MINUTE, true],
    // A 6-hour window's points stand for 5 minutes: 3 minutes late is within one.
    [3 * MINUTE, 5 * MINUTE, false],
    [5 * MINUTE, 5 * MINUTE, true],
  ])(
    "a lag of %d ms with %d ms data points: %s",
    (lagMs: number, dataPointMs: number, notable: boolean) => {
      expect(
        MetricWindowCoverage.isNotableLag({
          lagMs: lagMs,
          dataPointMs: dataPointMs,
        }),
      ).toBe(notable);
    },
  );

  test("no lag, or one that cannot be read, is never said", () => {
    for (const lagMs of [null, undefined, Number.NaN]) {
      expect(
        MetricWindowCoverage.isNotableLag({
          lagMs: lagMs,
          dataPointMs: MINUTE,
        }),
      ).toBe(false);
    }
  });

  test.each([
    [2 * MINUTE, "Its data arrives about 2 minutes late."],
    [11 * MINUTE + 40 * SECOND, "Its data arrives about 11 minutes late."],
    [3 * 60 * MINUTE, "Its data arrives about 3 hours late."],
  ])("describeLag(%d)", (lagMs: number, text: string) => {
    expect(MetricWindowCoverage.describeLag(lagMs)).toBe(text);
  });
});

/*
 * A lone data point - no series of the monitor has two in the window - is
 * taken for the window while it sits inside it, by its age by the clock
 * (MetricWindowCoverage). Its arrivals change nothing there.
 */
describe("a lone data point, with its arrival known", () => {
  test("inside the window it is still taken for it", () => {
    const result: MetricWindowCoverageResult = judge({
      samples: [point(8)],
      monitorIntervalMs: null,
      arrival: arrival({ sinceNewestArrivalMs: 6 * MINUTE }),
    });

    expect(result.isCovered).toBe(true);
    expect(result.isLoneDataPoint).toBe(true);
  });

  test("among the newest it still waits", () => {
    const result: MetricWindowCoverageResult = judge({
      samples: [point(14)],
      monitorIntervalMs: null,
      arrival: arrival({ sinceNewestArrivalMs: 10 * SECOND }),
    });

    expect(result.isCovered).toBe(false);
    expect(result.isLoneDataPoint).toBe(false);
  });
});

describe("without arrivals, a series is judged as before", () => {
  test("lagMs is null and nothing about arrivals is said", () => {
    const result: MetricWindowCoverageResult = judge({
      samples: points(13, 15),
    });

    expect(result.lagMs).toBeNull();
    expect(result.sinceNewestArrivalMs).toBeNull();
    expect(MetricWindowCoverage.describeWait(result)).toBe(
      "Waiting for 15 minutes of data: 2 of 15 minutes so far.",
    );
  });

  test("null arrivals are no arrivals", () => {
    expect(judge({ samples: points(0, 10), arrival: null }).shortfall).toBe(
      WindowCoverageShortfall.Stale,
    );
  });
});
