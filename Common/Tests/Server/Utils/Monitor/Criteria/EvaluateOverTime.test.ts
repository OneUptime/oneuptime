import EvaluateOverTime, {
  OverTimeCriteriaValue,
  OverTimeEvaluation,
  OverTimeEvaluationStatus,
} from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import MetricService from "../../../../../Server/Services/MetricService";
import FindBy from "../../../../../Server/Types/AnalyticsDatabase/FindBy";
import { JSONObject } from "../../../../../Types/JSON";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Everything here is anchored to a fixed "now" so the window arithmetic -
 * which is the whole point of these tests - never depends on the wall clock.
 */
const NOW: Date = new Date("2026-08-20T12:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/** A Metric row as the analytics layer hands it back. */
function sample(input: { value: number; minutesAgo: number }): Metric {
  const metric: Metric = new Metric();
  metric.value = input.value;
  metric.time = new Date(NOW.getTime() - input.minutesAgo * 60 * 1000);
  return metric;
}

/**
 * A run of samples one per minute ending at `now`, oldest first.
 * `values[0]` is the oldest.
 */
function everyMinute(values: Array<number>): Array<Metric> {
  return values.map((value: number, index: number) => {
    return sample({
      value: value,
      minutesAgo: values.length - 1 - index,
    });
  });
}

function criteria(overrides: Partial<CriteriaFilter> = {}): CriteriaFilter {
  return {
    checkOn: CheckOn.ResponseStatusCode,
    filterType: FilterType.NotEqualTo,
    value: 200,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
    },
    ...overrides,
  };
}

/*
 * The metric read is stubbed in memory rather than through a typed spy so
 * every query it receives can be asserted on directly.
 */
let findByCalls: Array<FindBy<Metric>> = [];
let findByResult: Array<Metric> = [];
let findByError: Error | null = null;

function mockSamples(metrics: Array<Metric>): void {
  findByResult = metrics;
}

function lastQuery(): JSONObject {
  return findByCalls[0]!.query as unknown as JSONObject;
}

function lastSelect(): JSONObject {
  return findByCalls[0]!.select as unknown as JSONObject;
}

function evaluate(input: {
  criteriaFilter: CriteriaFilter;
  monitoringInterval?: string | undefined;
  miscData?: JSONObject | undefined;
}): Promise<OverTimeEvaluation> {
  return EvaluateOverTime.evaluateOverTime({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    criteriaFilter: input.criteriaFilter,
    monitoringInterval: input.monitoringInterval,
    miscData: input.miscData,
  });
}

describe("EvaluateOverTime", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    findByCalls = [];
    findByResult = [];
    findByError = null;

    jest
      .spyOn(MetricService, "findBy")
      .mockImplementation((findBy: FindBy<Metric>): Promise<Array<Metric>> => {
        findByCalls.push(findBy);

        if (findByError) {
          return Promise.reject(findByError);
        }

        return Promise.resolve(findByResult);
      });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("when the filter does not evaluate over time", () => {
    test("reports NotConfigured when evaluateOverTime is false", async () => {
      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({ evaluateOverTime: false }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.NotConfigured);
      expect(findByCalls).toHaveLength(0);
    });

    test("reports NotConfigured when the options are missing", async () => {
      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({ evaluateOverTimeOptions: undefined }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.NotConfigured);
      expect(findByCalls).toHaveLength(0);
    });
  });

  describe("query shape", () => {
    test("scopes the window, the project, the monitor and the series", async () => {
      mockSamples(everyMinute([200, 200, 200, 200, 200]));

      await evaluate({ criteriaFilter: criteria() });

      expect(findByCalls).toHaveLength(1);

      const query: JSONObject = lastQuery();

      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["primaryEntityId"]).toBe(MONITOR_ID);
      expect(query["name"]).toBe(MonitorMetricType.ResponseStatusCode);

      const time: InBetween<Date> = query["time"] as InBetween<Date>;
      expect(time).toBeInstanceOf(InBetween);
      expect((time.startValue as Date).toISOString()).toBe(
        "2026-08-20T11:55:00.000Z",
      );
      expect((time.endValue as Date).toISOString()).toBe(NOW.toISOString());
    });

    test("selects the sample time as well as the value", async () => {
      mockSamples(everyMinute([200]));

      await evaluate({ criteriaFilter: criteria() });

      const select: JSONObject = lastSelect();

      expect(select["value"]).toBe(true);
      expect(select["time"]).toBe(true);
    });

    test("passes misc data through as an attribute filter", async () => {
      mockSamples(everyMinute([10]));

      await evaluate({
        criteriaFilter: criteria({ checkOn: CheckOn.DiskUsagePercent }),
        miscData: { diskPath: "/var" },
      });

      const query: JSONObject = lastQuery();

      expect(query["attributes"]).toEqual({ diskPath: "/var" });
    });
  });

  describe("CheckOns that no series records", () => {
    /*
     * These used to throw inside a try/catch that reset the value to
     * undefined, which sent the evaluator down its instantaneous fallback -
     * an over-time filter that quietly was not one.
     */
    test("reports Unsupported instead of throwing", async () => {
      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({ checkOn: CheckOn.ResponseBody }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Unsupported);
      expect(findByCalls).toHaveLength(0);
    });

    test("neither do incoming requests or SNMP OID existence", async () => {
      for (const checkOn of [CheckOn.IncomingRequest, CheckOn.SnmpOidExists]) {
        const result: OverTimeEvaluation = await evaluate({
          criteriaFilter: criteria({ checkOn: checkOn }),
        });

        expect(result.status).toBe(OverTimeEvaluationStatus.Unsupported);
      }

      expect(findByCalls).toHaveLength(0);
    });

    test("Is Request Timeout has no series of its own", async () => {
      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({ checkOn: CheckOn.IsRequestTimeout }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Unsupported);
    });
  });

  describe("CheckOns that share the generic probe series", () => {
    /*
     * DNS / SNMP / External Status Page probes write into the shared online
     * and response-time series. Their CheckOns had no entry in the metric
     * map at all, so "evaluate over time" was a no-op for every one of them.
     */
    const onlineCheckOns: Array<CheckOn> = [
      CheckOn.DnsIsOnline,
      CheckOn.SnmpIsOnline,
      CheckOn.ExternalStatusPageIsOnline,
    ];

    for (const checkOn of onlineCheckOns) {
      test(`${checkOn} reads the online series`, async () => {
        mockSamples(everyMinute([0, 0, 0, 0, 0]));

        const result: OverTimeEvaluation = await evaluate({
          criteriaFilter: criteria({
            checkOn: checkOn,
            filterType: FilterType.False,
            value: undefined,
          }),
        });

        expect(lastQuery()["name"]).toBe(MonitorMetricType.IsOnline);
        expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
        // 0 maps to false for online-style series.
        expect(result.value).toEqual([false, false, false, false, false]);
      });
    }

    const responseTimeCheckOns: Array<CheckOn> = [
      CheckOn.DnsResponseTime,
      CheckOn.SnmpResponseTime,
      CheckOn.ExternalStatusPageResponseTime,
    ];

    for (const checkOn of responseTimeCheckOns) {
      test(`${checkOn} reads the response time series`, async () => {
        mockSamples(everyMinute([10, 20, 30, 40, 50]));

        const result: OverTimeEvaluation = await evaluate({
          criteriaFilter: criteria({ checkOn: checkOn }),
        });

        expect(lastQuery()["name"]).toBe(MonitorMetricType.ResponseTime);
        expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
        expect(result.value).toEqual([10, 20, 30, 40, 50]);
      });
    }
  });

  describe("empty and unreadable windows", () => {
    test("an empty window is InsufficientData, not an empty array", async () => {
      mockSamples([]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
      expect(result.sampleCount).toBe(0);
      expect(result.isReadError).toBe(false);
      expect(result.noDataReason).toContain("No data was recorded");
    });

    test("a failed read is InsufficientData and is flagged as an error", async () => {
      findByError = new Error("clickhouse unavailable");

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
      expect(result.isReadError).toBe(true);
    });

    /*
     * The dashboard persists the window dropdown's STRING value while
     * Terraform and the API send a number - both must behave the same.
     */
    test("accepts a window length that arrives as a string", async () => {
      mockSamples(everyMinute([404, 404, 404, 404, 404]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          evaluateOverTimeOptions: {
            timeValueInMinutes: "5" as unknown as number,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        }),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);

      const time: InBetween<Date> = lastQuery()["time"] as InBetween<Date>;
      expect((time.startValue as Date).toISOString()).toBe(
        "2026-08-20T11:55:00.000Z",
      );
    });

    test("an unparseable window length cannot be evaluated", async () => {
      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          evaluateOverTimeOptions: {
            timeValueInMinutes: "not-a-number" as unknown as number,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
      expect(findByCalls).toHaveLength(0);
    });

    test("a window of zero minutes cannot be evaluated", async () => {
      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 0,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
      expect(findByCalls).toHaveLength(0);
    });

    test("rows with no value are dropped", async () => {
      const withoutValue: Metric = new Metric();
      withoutValue.time = NOW;

      mockSamples([...everyMinute([200, 200, 200, 200, 200]), withoutValue]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
      });

      expect(result.sampleCount).toBe(5);
    });
  });

  describe("All Values needs the window to actually be covered", () => {
    /*
     * This is the bug from #2321. Array.every() is trivially true on a
     * single element, so one bad probe satisfied "all values over the last
     * five minutes" - on a brand new monitor, or any time the window had not
     * filled up.
     */
    test("a single sample cannot satisfy a five minute window", async () => {
      mockSamples([sample({ value: 404, minutesAgo: 0 })]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
      expect(result.sampleCount).toBe(1);
      expect(result.noDataReason).toContain("not enough to cover");
    });

    test("a partially filled window cannot satisfy it either", async () => {
      mockSamples([
        sample({ value: 404, minutesAgo: 1 }),
        sample({ value: 404, minutesAgo: 0 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
    });

    test("a fully covered window evaluates", async () => {
      mockSamples(everyMinute([404, 404, 404, 404, 404]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
      expect(result.value).toEqual([404, 404, 404, 404, 404]);
    });

    /*
     * A monitor polled once every five minutes can only ever put one sample
     * in a five minute window, so that one sample IS the whole window.
     */
    test("one sample covers the window when the monitor polls that slowly", async () => {
      mockSamples([sample({ value: 404, minutesAgo: 0 })]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "*/5 * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
    });

    test("tolerates a probe skipping a beat at the start of the window", async () => {
      /*
       * Oldest sample sits 1.5 intervals into the window, which is the
       * documented jitter allowance - still covered.
       */
      mockSamples([
        sample({ value: 404, minutesAgo: 3.5 }),
        sample({ value: 404, minutesAgo: 2 }),
        sample({ value: 404, minutesAgo: 1 }),
        sample({ value: 404, minutesAgo: 0 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
    });

    test("rejects a gap wider than the jitter allowance", async () => {
      mockSamples([
        sample({ value: 404, minutesAgo: 3.4 }),
        sample({ value: 404, minutesAgo: 2 }),
        sample({ value: 404, minutesAgo: 1 }),
        sample({ value: 404, minutesAgo: 0 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
    });

    /*
     * Coverage has two edges. Samples that stop part way through the window
     * say nothing about the minutes since, so they must not satisfy
     * "all values over the last N minutes" either.
     */
    test("rejects a window whose samples stopped part way through", async () => {
      mockSamples([
        sample({ value: 404, minutesAgo: 4 }),
        sample({ value: 404, minutesAgo: 3 }),
        sample({ value: 404, minutesAgo: 2 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
    });

    /*
     * Metric writes are not synchronous, so the newest sample can lag the
     * check that produced it. One interval of lag must not stall the filter.
     */
    test("tolerates the newest sample lagging by one interval", async () => {
      mockSamples([
        sample({ value: 404, minutesAgo: 4 }),
        sample({ value: 404, minutesAgo: 3 }),
        sample({ value: 404, minutesAgo: 2 }),
        sample({ value: 404, minutesAgo: 1 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
    });

    test("the trailing tolerance is exactly one and a half intervals", async () => {
      mockSamples([
        sample({ value: 404, minutesAgo: 4 }),
        sample({ value: 404, minutesAgo: 3 }),
        sample({ value: 404, minutesAgo: 1.5 }),
      ]);

      const onTheBoundary: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(onTheBoundary.status).toBe(OverTimeEvaluationStatus.Evaluated);

      mockSamples([
        sample({ value: 404, minutesAgo: 4 }),
        sample({ value: 404, minutesAgo: 3 }),
        sample({ value: 404, minutesAgo: 1.6 }),
      ]);

      const pastTheBoundary: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(pastTheBoundary.status).toBe(
        OverTimeEvaluationStatus.InsufficientData,
      );
    });

    /*
     * A probe's clock running slightly ahead of ours dates a sample in the
     * future. That is still fresh data, not a gap.
     */
    test("a sample dated slightly in the future does not break coverage", async () => {
      mockSamples([
        sample({ value: 404, minutesAgo: 4 }),
        sample({ value: 404, minutesAgo: 3 }),
        sample({ value: 404, minutesAgo: 2 }),
        sample({ value: 404, minutesAgo: 1 }),
        sample({ value: 404, minutesAgo: -0.5 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
    });

    /*
     * A monitoringInterval that is not a cron (the label form this repo's
     * own Terraform examples write) must not be trusted as a cadence - the
     * samples themselves are the only evidence left.
     */
    test("an unparseable schedule falls back to the sampled cadence", async () => {
      mockSamples([sample({ value: 404, minutesAgo: 0 })]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "Every 5 minutes",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
    });

    test("infers the cadence from the samples when no schedule is configured", async () => {
      mockSamples(everyMinute([404, 404, 404, 404, 404]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
    });

    test("a lone sample with no schedule cannot cover the window", async () => {
      mockSamples([sample({ value: 404, minutesAgo: 0 })]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
    });

    /*
     * Several probes write into the same series, so samples interleave and
     * the window holds many more rows than one per interval. That must not
     * be mistaken for a gap.
     */
    test("handles several probes writing into the same series", async () => {
      const metrics: Array<Metric> = [];

      for (let minutesAgo: number = 4; minutesAgo >= 0; minutesAgo--) {
        metrics.push(sample({ value: 404, minutesAgo: minutesAgo }));
        metrics.push(sample({ value: 404, minutesAgo: minutesAgo - 0.1 }));
        metrics.push(sample({ value: 404, minutesAgo: minutesAgo - 0.2 }));
      }

      mockSamples(metrics);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
      expect(result.sampleCount).toBe(15);
    });

    test("rows arriving out of order are still judged correctly", async () => {
      mockSamples([
        sample({ value: 404, minutesAgo: 0 }),
        sample({ value: 404, minutesAgo: 4 }),
        sample({ value: 404, minutesAgo: 2 }),
        sample({ value: 404, minutesAgo: 1 }),
        sample({ value: 404, minutesAgo: 3 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
    });
  });

  describe("evaluation types other than All Values", () => {
    /*
     * "Any Value" is documented to fire on a single breaching sample, so the
     * coverage guard must not touch it.
     */
    test("Any Value evaluates off a single sample", async () => {
      mockSamples([sample({ value: 404, minutesAgo: 0 })]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
          },
        }),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
      expect(result.value).toEqual([404]);
    });

    test("Any Value is not gated on coverage at all", async () => {
      // Samples cover only the first minute of a five minute window.
      mockSamples([
        sample({ value: 404, minutesAgo: 5 }),
        sample({ value: 404, minutesAgo: 4.5 }),
      ]);

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
          },
        }),
        monitoringInterval: "* * * * *",
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
    });

    test("Average aggregates the window", async () => {
      mockSamples(everyMinute([10, 20, 30]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          checkOn: CheckOn.ResponseTime,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
      expect(result.value).toBe(20);
    });

    test("Sum aggregates the window", async () => {
      mockSamples(everyMinute([10, 20, 30]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          checkOn: CheckOn.ResponseTime,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Sum,
          },
        }),
      });

      expect(result.value).toBe(60);
    });

    test("Maximum Value aggregates the window", async () => {
      mockSamples(everyMinute([10, 90, 30]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          checkOn: CheckOn.ResponseTime,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.MaximumValue,
          },
        }),
      });

      expect(result.value).toBe(90);
    });

    test("Minimum Value aggregates the window", async () => {
      mockSamples(everyMinute([10, 90, 30]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          checkOn: CheckOn.ResponseTime,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.MunimumValue,
          },
        }),
      });

      expect(result.value).toBe(10);
    });

    /*
     * Math.min/max/average over an empty array produce Infinity, -Infinity
     * and NaN. None of those are arrays, so the old empty-window guard never
     * saw them and "Minimum Value greater than <anything>" was a guaranteed
     * false alarm on a monitor with no data. An empty window is now reported
     * before any aggregate is computed.
     */
    test("an empty window never reaches the aggregates", async () => {
      const aggregateTypes: Array<EvaluateOverTimeType> = [
        EvaluateOverTimeType.Average,
        EvaluateOverTimeType.Sum,
        EvaluateOverTimeType.MaximumValue,
        EvaluateOverTimeType.MunimumValue,
      ];

      for (const evaluateOverTimeType of aggregateTypes) {
        mockSamples([]);

        const result: OverTimeEvaluation = await evaluate({
          criteriaFilter: criteria({
            checkOn: CheckOn.ResponseTime,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: evaluateOverTimeType,
            },
          }),
        });

        expect(result.status).toBe(OverTimeEvaluationStatus.InsufficientData);
        expect(result.value).toBeUndefined();
      }
    });

    test("an aggregate of exactly zero is still a real value", async () => {
      mockSamples(everyMinute([0, 0, 0]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          checkOn: CheckOn.CPUUsagePercent,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        }),
      });

      expect(result.status).toBe(OverTimeEvaluationStatus.Evaluated);
      expect(result.value).toBe(0);
    });
  });

  describe("boolean series", () => {
    test("1 becomes true and everything else becomes false", async () => {
      mockSamples(everyMinute([1, 0, 1, 1, 0]));

      const result: OverTimeEvaluation = await evaluate({
        criteriaFilter: criteria({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        }),
        monitoringInterval: "* * * * *",
      });

      expect(result.value).toEqual([true, false, true, true, false]);
    });
  });

  describe("getOverTimeValueForCriteriaFilter", () => {
    function resolve(input: {
      criteriaFilter: CriteriaFilter;
      monitoringInterval?: string | undefined;
    }): Promise<OverTimeCriteriaValue> {
      return EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval,
      });
    }

    test("hands back the window when it is usable", async () => {
      mockSamples(everyMinute([404, 404, 404, 404, 404]));

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.earlyReturn).toBeNull();
      expect(result.value).toEqual([404, 404, 404, 404, 404]);
    });

    test("lets a filter that does not evaluate over time carry on", async () => {
      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria({ evaluateOverTime: false }),
      });

      expect(result.earlyReturn).toBeNull();
      expect(result.value).toBeUndefined();
    });

    test("lets a CheckOn with no series carry on with its live value", async () => {
      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria({ checkOn: CheckOn.ResponseBody }),
      });

      expect(result.earlyReturn).toBeNull();
      expect(result.value).toBeUndefined();
    });

    test("does not fire by default while the window is still filling", async () => {
      mockSamples([sample({ value: 404, minutesAgo: 0 })]);

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria(),
        monitoringInterval: "* * * * *",
      });

      expect(result.earlyReturn).toEqual({ result: null });
      expect(result.value).toBeUndefined();
    });

    test("Ignore is the default even when nothing was ever recorded", async () => {
      mockSamples([]);

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria(),
      });

      expect(result.earlyReturn).toEqual({ result: null });
    });

    test("Trigger fires with a no-data root cause", async () => {
      mockSamples([]);

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        }),
      });

      expect(result.earlyReturn?.result).toContain(
        CheckOn.ResponseStatusCode as string,
      );
      expect(result.earlyReturn?.result).toContain("no data");
    });

    test("Treat As Zero substitutes zero for a numeric series", async () => {
      mockSamples([]);

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria({
          checkOn: CheckOn.ResponseTime,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.TreatAsZero,
          },
        }),
      });

      expect(result.earlyReturn).toBeNull();
      expect(result.value).toEqual([0]);
    });

    test("Treat As Zero substitutes false for an online series", async () => {
      mockSamples([]);

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria({
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.TreatAsZero,
          },
        }),
      });

      expect(result.value).toEqual([false]);
    });

    /*
     * A metric store we could not read tells us nothing about the monitor.
     * Reporting that as a breach would turn every ClickHouse hiccup into an
     * incident, so Trigger is deliberately not honoured here.
     */
    test("a read failure is not substituted with zero either", async () => {
      findByError = new Error("clickhouse unavailable");

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria({
          checkOn: CheckOn.ResponseTime,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.TreatAsZero,
          },
        }),
      });

      expect(result.earlyReturn).toEqual({ result: null });
      expect(result.value).toBeUndefined();
    });

    test("a read failure never fires, even under the Trigger policy", async () => {
      findByError = new Error("clickhouse unavailable");

      const result: OverTimeCriteriaValue = await resolve({
        criteriaFilter: criteria({
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        }),
      });

      expect(result.earlyReturn).toEqual({ result: null });
    });
  });
});
