import EvaluateOverTime, {
  EvaluateOverTimeResult,
} from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import MetricService from "../../../../../Server/Services/MetricService";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CheckOn,
  EvaluateOverTimeType,
  NoDataPolicy,
} from "../../../../../Types/Monitor/CriteriaFilter";

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(Date.now() - minutes * 60 * 1000);
};

describe("EvaluateOverTime.hasSufficientWindowCoverage", () => {
  test("an empty sample set is never sufficient", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [],
        timeValueInMinutes: 5,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(false);
  });

  test("with a 1-minute interval, a single sample does NOT cover a 5-minute window (issue #2321)", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0)],
        timeValueInMinutes: 5,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(false);
  });

  test("with a 1-minute interval, a single sample does NOT cover a 2-minute window (the INC-12 case)", () => {
    // window fits 2 samples -> we must observe 2; one spike can never be "all values over 2 minutes"
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0)],
        timeValueInMinutes: 2,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(false);
  });

  test("with a 1-minute interval, two samples DO cover a 2-minute window", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0), minutesAgo(1)],
        timeValueInMinutes: 2,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(true);
  });

  test("with a 1-minute interval, a 3-minute window still needs at least two samples", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0)],
        timeValueInMinutes: 3,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(false);
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0), minutesAgo(1)],
        timeValueInMinutes: 3,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(true);
  });

  test("with a 1-minute interval, a full window of samples is sufficient", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [
          minutesAgo(0),
          minutesAgo(1),
          minutesAgo(2),
          minutesAgo(3),
          minutesAgo(4),
        ],
        timeValueInMinutes: 5,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(true);
  });

  test("allows one missing sample for scheduling jitter (4 of an expected 5)", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [
          minutesAgo(0),
          minutesAgo(1),
          minutesAgo(2),
          minutesAgo(3),
        ],
        timeValueInMinutes: 5,
        monitoringInterval: "* * * * *",
      }),
    ).toBe(true);
  });

  test("with a coarse interval (>= window), a single sample IS full coverage", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0)],
        timeValueInMinutes: 5,
        monitoringInterval: "*/10 * * * *",
      }),
    ).toBe(true);
  });

  test("without a known interval, only-recent samples do not cover the window", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0), minutesAgo(1)],
        timeValueInMinutes: 5,
      }),
    ).toBe(false);
  });

  test("without a known interval, a single stale sample is NOT enough (need at least two)", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(5)],
        timeValueInMinutes: 5,
      }),
    ).toBe(false);
  });

  test("without a known interval, two samples reaching back to the window start cover it", () => {
    expect(
      EvaluateOverTime.hasSufficientWindowCoverage({
        sampleTimes: [minutesAgo(0), minutesAgo(5)],
        timeValueInMinutes: 5,
      }),
    ).toBe(true);
  });
});

describe("EvaluateOverTime.resolveFilterOverTime", () => {
  const projectId: ObjectID = new ObjectID(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  );
  const monitorId: ObjectID = new ObjectID(
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  );

  const mockSamples: (values: Array<number>) => void = (
    values: Array<number>,
  ): void => {
    jest.spyOn(MetricService, "findBy").mockResolvedValue(
      values.map((value: number, index: number) => {
        return { value: value, time: minutesAgo(index) };
      }) as never,
    );
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("All Values fires not-met (with a reason) on a single sample in a 2-minute window", async () => {
    mockSamples([9171]);

    const result: EvaluateOverTimeResult =
      await EvaluateOverTime.resolveFilterOverTime({
        projectId: projectId,
        monitorId: monitorId,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 2,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
        metricType: CheckOn.ResponseTime,
        monitoringInterval: "* * * * *",
      });

    expect(result.decision).toBe("not-met");
    expect(
      (result as { decision: "not-met"; reason: string }).reason,
    ).toContain("Not enough data");
  });

  test("aggregates (Average) are also gated: a single sample is not-met", async () => {
    mockSamples([9171]);

    const result: EvaluateOverTimeResult =
      await EvaluateOverTime.resolveFilterOverTime({
        projectId: projectId,
        monitorId: monitorId,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 2,
          evaluateOverTimeType: EvaluateOverTimeType.Average,
        },
        metricType: CheckOn.ResponseTime,
        monitoringInterval: "* * * * *",
      });

    expect(result.decision).toBe("not-met");
  });

  test("Any Value is exempt from the coverage gate: a single sample is compared", async () => {
    mockSamples([9171]);

    const result: EvaluateOverTimeResult =
      await EvaluateOverTime.resolveFilterOverTime({
        projectId: projectId,
        monitorId: monitorId,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 2,
          evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
        },
        metricType: CheckOn.ResponseTime,
        monitoringInterval: "* * * * *",
      });

    expect(result.decision).toBe("compare");
  });

  test("All Values compares once the window is covered by two samples", async () => {
    mockSamples([9171, 9200]);

    const result: EvaluateOverTimeResult =
      await EvaluateOverTime.resolveFilterOverTime({
        projectId: projectId,
        monitorId: monitorId,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 2,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
        metricType: CheckOn.ResponseTime,
        monitoringInterval: "* * * * *",
      });

    expect(result.decision).toBe("compare");
    expect(
      (result as { decision: "compare"; value: Array<number> }).value,
    ).toEqual([9171, 9200]);
  });

  test("no data honors the NoDataPolicy: default Ignore -> not-met", async () => {
    mockSamples([]);

    const result: EvaluateOverTimeResult =
      await EvaluateOverTime.resolveFilterOverTime({
        projectId: projectId,
        monitorId: monitorId,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 2,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
        metricType: CheckOn.ResponseTime,
        monitoringInterval: "* * * * *",
      });

    expect(result.decision).toBe("not-met");
    expect(
      (result as { decision: "not-met"; reason: string }).reason,
    ).toContain("No data");
  });

  test("no data with NoDataPolicy Trigger -> trigger", async () => {
    mockSamples([]);

    const result: EvaluateOverTimeResult =
      await EvaluateOverTime.resolveFilterOverTime({
        projectId: projectId,
        monitorId: monitorId,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 2,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          onNoDataPolicy: NoDataPolicy.Trigger,
        },
        metricType: CheckOn.ResponseTime,
        monitoringInterval: "* * * * *",
      });

    expect(result.decision).toBe("trigger");
  });

  test("insufficient coverage never triggers, even with NoDataPolicy Trigger (only true no-data does)", async () => {
    // One sample in a 2-minute window is under-covered, NOT no-data: must stay not-met.
    mockSamples([9171]);

    const result: EvaluateOverTimeResult =
      await EvaluateOverTime.resolveFilterOverTime({
        projectId: projectId,
        monitorId: monitorId,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 2,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          onNoDataPolicy: NoDataPolicy.Trigger,
        },
        metricType: CheckOn.ResponseTime,
        monitoringInterval: "* * * * *",
      });

    expect(result.decision).toBe("not-met");
  });
});
