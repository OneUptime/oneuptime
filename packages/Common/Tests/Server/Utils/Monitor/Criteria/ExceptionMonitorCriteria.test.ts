import ExceptionMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/ExceptionMonitorCriteria";
import MonitorCriteriaObservationBuilder from "../../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import ExceptionMonitorResponse, {
  ExceptionLearnedBaseline,
} from "../../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * ExceptionMonitorCriteria is the ExceptionCount analogue of
 * LogMonitorCriteria and shares the same fallback-fixed worker path
 * (monitorException). Covered here for parity across the count-based
 * telemetry criteria.
 */
function buildResponse(exceptionCount: number | undefined): DataToProcess {
  const response: Partial<ExceptionMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    exceptionCount: exceptionCount as number,
    exceptionQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  exceptionCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(exceptionCount),
    criteriaFilter,
  });
}

describe("ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("ExceptionCount GreaterThan 0 → met when exceptions exist", async () => {
    expect(
      await evaluate(3, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("ExceptionCount EqualTo 0 → met when there are none (default)", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("ExceptionCount GreaterThan → not met when none", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });

  test("a missing exceptionCount is treated as 0", async () => {
    expect(
      await evaluate(undefined, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("a non-ExceptionCount checkOn returns null (unhandled)", async () => {
    expect(
      await evaluate(9, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });
});

describe("ExceptionMonitorCriteria: the count against the learned baseline", () => {
  // Two earlier weeks: around five exceptions a window, spread by chance.
  const baseline: ExceptionLearnedBaseline = {
    windowDays: 14,
    windowSeconds: 900,
    weeksOfHistory: 2,
    sampleCount: 8,
    mean: 5,
    stddev: Math.sqrt(5),
    median: 5,
    madSigma: Math.sqrt(5),
    minObserved: 3,
    maxObserved: 7,
  };

  const spike: CriteriaFilter = {
    checkOn: CheckOn.ExceptionCount,
    filterType: FilterType.AnomalouslyHigh,
    value: undefined,
    metricMonitorOptions: {
      anomalyDetection: { sensitivity: AnomalyDetectionSensitivity.Medium },
    },
  };

  function responseWith(
    exceptionCount: number,
    exceptionLearnedBaselines: Array<ExceptionLearnedBaseline> | undefined,
  ): DataToProcess {
    return {
      projectId: ObjectID.generate(),
      monitorId: ObjectID.generate(),
      exceptionCount,
      exceptionQuery: {},
      exceptionLearnedBaselines,
    } as DataToProcess;
  }

  function judge(
    exceptionCount: number,
    criteriaFilter: CriteriaFilter = spike,
    baselines: Array<ExceptionLearnedBaseline> = [baseline],
  ): Promise<string | null> {
    return ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: responseWith(exceptionCount, baselines),
      criteriaFilter,
    });
  }

  test("a window inside the range does not match", async () => {
    expect(await judge(9)).toBeNull();
  });

  test("a window above it matches, and says the range and how far outside", async () => {
    expect(await judge(40)).toBe(
      "Exception count 40 over the last 15 minutes is above the 0 to 11 expected for this hour of the week, by 29: 15.65σ from the average of 5.00 (8 windows over 2 weeks, sensitivity Medium).",
    );
  });

  test("the criteria's sensitivity decides, on the same baseline", async () => {
    const at: (sensitivity: AnomalyDetectionSensitivity) => CriteriaFilter = (
      sensitivity: AnomalyDetectionSensitivity,
    ): CriteriaFilter => {
      return {
        ...spike,
        metricMonitorOptions: { anomalyDetection: { sensitivity } },
      };
    };

    expect(await judge(14, at(AnomalyDetectionSensitivity.Low))).toBeNull();
    expect(
      await judge(14, at(AnomalyDetectionSensitivity.Medium)),
    ).toBeTruthy();
    expect(await judge(14, at(AnomalyDetectionSensitivity.High))).toBeTruthy();
  });

  test("the first few of a quiet service do not match", async () => {
    const quiet: ExceptionLearnedBaseline = {
      ...baseline,
      mean: 0,
      stddev: 1,
      median: 0,
      madSigma: 1,
      minObserved: 0,
      maxObserved: 0,
    };

    expect(await judge(9, spike, [quiet])).toBeNull();
    expect(await judge(10, spike, [quiet])).toBeTruthy();
  });

  test("a baseline with too little history alerts on nothing, however high the count", async () => {
    expect(
      await judge(100000, spike, [{ ...baseline, weeksOfHistory: 1 }]),
    ).toBeNull();
  });

  test("a check that read no baseline alerts on nothing", async () => {
    expect(await judge(100000, spike, [])).toBeNull();
    // A response from before it could read one.
    expect(
      await ExceptionMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: responseWith(100000, undefined),
        criteriaFilter: spike,
      }),
    ).toBeNull();
  });

  test("it reads the baseline of its own baseline window", async () => {
    const wider: ExceptionLearnedBaseline = {
      ...baseline,
      windowDays: 28,
      weeksOfHistory: 4,
      sampleCount: 16,
      mean: 100,
      stddev: 10,
      median: 100,
      madSigma: 10,
    };
    const baselines: Array<ExceptionLearnedBaseline> = [baseline, wider];

    expect(await judge(40, spike, baselines)).toBeTruthy();
    expect(
      await judge(
        40,
        {
          ...spike,
          metricMonitorOptions: { anomalyDetection: { windowDays: 28 } },
        },
        baselines,
      ),
    ).toBeNull();
  });

  test.each([
    CheckOn.NewExceptionCount,
    CheckOn.RegressedExceptionCount,
    CheckOn.ExceptionCountIncreasePercent,
  ])(
    "an anomaly condition written on %s never matches: it has no baseline",
    async (checkOn: CheckOn) => {
      expect(await judge(100000, { ...spike, checkOn })).toBeNull();
    },
  );

  test("the numeric conditions are read as they always were", async () => {
    expect(
      await judge(3, {
        checkOn: CheckOn.ExceptionCount,
        filterType: FilterType.GreaterThan,
        value: 1,
      }),
    ).toBeTruthy();
  });

  test("the status timeline says the range, or that it is still learning", () => {
    const say: (
      exceptionCount: number,
      baselines?: Array<ExceptionLearnedBaseline> | undefined,
    ) => string | null = (
      exceptionCount: number,
      baselines?: Array<ExceptionLearnedBaseline> | undefined,
    ): string | null => {
      return MonitorCriteriaObservationBuilder.describeExceptionCountObservation(
        {
          dataToProcess: responseWith(exceptionCount, baselines),
          checkOn: CheckOn.ExceptionCount,
          criteriaFilter: spike,
        },
      );
    };

    expect(say(6, [baseline])).toBe(
      "Exception count was 6, within the 0 to 11 expected for this hour of the week.",
    );
    expect(say(40, [baseline])).toBe(
      "Exception count was 40, above the 0 to 11 expected for this hour of the week.",
    );
    expect(say(12, [{ ...baseline, weeksOfHistory: 1 }])).toBe(
      "Exception count was 12. Still learning what is normal for this hour of the week: 1 of the 2 weeks of history it needs.",
    );
    expect(say(12, undefined)).toBe(
      "Exception count was 12. Still learning what is normal for this hour of the week: 0 of the 2 weeks of history it needs.",
    );
  });

  test("a numeric condition's timeline is what it always said", () => {
    expect(
      MonitorCriteriaObservationBuilder.describeExceptionCountObservation({
        dataToProcess: responseWith(12, [baseline]),
        checkOn: CheckOn.ExceptionCount,
        criteriaFilter: {
          checkOn: CheckOn.ExceptionCount,
          filterType: FilterType.GreaterThan,
          value: 5,
        },
      }),
    ).toBe("Exception count was 12.");
  });
});
