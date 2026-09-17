import TraceMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/TraceMonitorCriteria";
import SpanCountBaselineService from "../../../../../Server/Services/SpanCountBaselineService";
import { CountBaselineSummary } from "../../../../../Server/Utils/Monitor/Criteria/CountAnomaly";
import {
  AnomalyDetectionMethod,
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import TraceMonitorResponse from "../../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../../../Types/Monitor/MonitorStepTraceMonitor";
import { SpanStatus } from "../../../../../Models/AnalyticsModels/Span";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * TraceMonitorCriteria is the SpanCount analogue of LogMonitorCriteria and
 * shares the same fallback-fixed worker path (monitorTrace). Covered here for
 * parity so the two count-based telemetry criteria stay in lock-step.
 */
function buildResponse(spanCount: number | undefined): DataToProcess {
  const response: Partial<TraceMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    spanCount: spanCount as number,
    spanQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  spanCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(spanCount),
    criteriaFilter,
  });
}

describe("TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  test("SpanCount GreaterThan → met when above threshold", async () => {
    expect(
      await evaluate(9, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("SpanCount EqualTo 0 → met when no spans (offline)", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("SpanCount GreaterThan → not met at/below threshold", async () => {
    expect(
      await evaluate(0, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });

  test("a missing spanCount is treated as 0", async () => {
    expect(
      await evaluate(undefined, {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.EqualTo,
        value: 0,
      }),
    ).toBeTruthy();
  });

  test("a non-SpanCount checkOn returns null (unhandled)", async () => {
    expect(
      await evaluate(50, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    ).toBeNull();
  });
});

/*
 * Anomaly filters on SpanCount: the evaluator normalizes the observed
 * count to spans-per-minute (the SpanCountBaseline sample unit) and
 * compares it to the same-hour-of-week baseline of the monitor's scope,
 * mirroring the Metric/SNMP baseline paths — including the Learning
 * cold-start and zero-variance guards.
 */
describe("TraceMonitorCriteria SpanCount anomaly filters", () => {
  let getBaselineSpy: jest.SpyInstance;

  beforeEach(() => {
    getBaselineSpy = jest.spyOn(SpanCountBaselineService, "getBaseline");
  });

  afterEach(() => {
    getBaselineSpy.mockRestore();
  });

  function buildBaseline(
    overrides: Partial<CountBaselineSummary>,
  ): CountBaselineSummary {
    return {
      sampleCount: 120,
      mean: 20,
      stddev: 5,
      median: 19,
      madSigma: 4,
      minObserved: 8,
      maxObserved: 33,
      isReliable: true,
      windowDays: 14,
      hourOfWeek: 8,
      ...overrides,
    };
  }

  function buildMonitorStep(
    overrides: Partial<MonitorStepTraceMonitor>,
  ): MonitorStep {
    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.data = {
      id: ObjectID.generate().toString(),
      monitorCriteria: { data: undefined } as never,
    } as unknown as MonitorStep["data"];
    monitorStep.data!.traceMonitor = {
      ...MonitorStepTraceMonitorUtil.getDefault(),
      ...overrides,
    };
    return monitorStep;
  }

  function evaluateAnomaly(input: {
    spanCount: number;
    criteriaFilter: CriteriaFilter;
    monitorStep?: MonitorStep | undefined;
  }): Promise<string | null> {
    return TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: buildResponse(input.spanCount),
      criteriaFilter: input.criteriaFilter,
      monitorStep: input.monitorStep,
    });
  }

  test("AnomalouslyHigh fires when the span rate exceeds mean + 3σ (Medium default)", async () => {
    // mean 20/min, σ 5 → 3σ band is [5, 35]; 90 spans in 60s = 90/min.
    getBaselineSpy.mockResolvedValue(buildBaseline({}));

    const result: string | null = await evaluateAnomaly({
      spanCount: 90,
      criteriaFilter: {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      },
    });

    expect(result).toBeTruthy();
    expect(result).toContain("above the same-hour baseline");
    expect(result).toContain("90.00 spans/min");
    expect(result).toContain("sensitivity Medium");
  });

  test("no fire when the span rate is inside the expected band", async () => {
    getBaselineSpy.mockResolvedValue(buildBaseline({}));

    expect(
      await evaluateAnomaly({
        spanCount: 25,
        criteriaFilter: {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
        },
      }),
    ).toBeNull();
  });

  test("observed count is normalized by the monitor's evaluation window", async () => {
    getBaselineSpy.mockResolvedValue(buildBaseline({}));

    const monitorStep: MonitorStep = buildMonitorStep({
      lastXSecondsOfSpans: 300,
    });

    // 100 spans over 300s = 20/min — exactly the mean, inside the band.
    expect(
      await evaluateAnomaly({
        spanCount: 100,
        criteriaFilter: {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
        },
        monitorStep,
      }),
    ).toBeNull();

    // 300 spans over 300s = 60/min — well above mean + 3σ = 35.
    const result: string | null = await evaluateAnomaly({
      spanCount: 300,
      criteriaFilter: {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      },
      monitorStep,
    });
    expect(result).toBeTruthy();
    expect(result).toContain("300 over the last 300 seconds");
    expect(result).toContain("60.00 spans/min");
  });

  test("AnomalouslyLow fires when the span rate drops below mean - 3σ", async () => {
    // mean 60/min, σ 10 → low band edge 30; 0 spans breaches low.
    getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 60, stddev: 10 }));

    const result: string | null = await evaluateAnomaly({
      spanCount: 0,
      criteriaFilter: {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.AnomalouslyLow,
        value: undefined,
      },
    });

    expect(result).toBeTruthy();
    expect(result).toContain("below the same-hour baseline");
  });

  test("baseline lookup is keyed by project, services, statuses and anomaly options", async () => {
    getBaselineSpy.mockResolvedValue(buildBaseline({}));

    const serviceId: ObjectID = ObjectID.generate();
    const monitorStep: MonitorStep = buildMonitorStep({
      telemetryServiceIds: [serviceId],
      spanStatuses: [SpanStatus.Error],
    });

    const dataToProcess: DataToProcess = buildResponse(90);

    await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess,
      criteriaFilter: {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
        metricMonitorOptions: {
          anomalyDetection: {
            sensitivity: AnomalyDetectionSensitivity.High,
            windowDays: 28,
            minSamples: 10,
          },
        },
      },
      monitorStep,
    });

    expect(getBaselineSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: (dataToProcess as TraceMonitorResponse).projectId.toString(),
        telemetryServiceIds: [serviceId.toString()],
        spanStatusCodes: [SpanStatus.Error],
        windowDays: 28,
        minSamples: 10,
      }),
    );
  });

  test("Learning state (unreliable or missing baseline) never fires", async () => {
    getBaselineSpy.mockResolvedValue(buildBaseline({ isReliable: false }));
    expect(
      await evaluateAnomaly({
        spanCount: 10000,
        criteriaFilter: {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
        },
      }),
    ).toBeNull();

    getBaselineSpy.mockResolvedValue(null);
    expect(
      await evaluateAnomaly({
        spanCount: 10000,
        criteriaFilter: {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
        },
      }),
    ).toBeNull();
  });

  test("zero-variance baseline never fires", async () => {
    getBaselineSpy.mockResolvedValue(buildBaseline({ stddev: 0, madSigma: 0 }));
    expect(
      await evaluateAnomaly({
        spanCount: 10000,
        criteriaFilter: {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
        },
      }),
    ).toBeNull();
  });

  test("MedianMad method compares against the median and reports it", async () => {
    // median 19, MAD-σ 4 → 3σ band edge 31; 90/min breaches high.
    getBaselineSpy.mockResolvedValue(buildBaseline({}));

    const result: string | null = await evaluateAnomaly({
      spanCount: 90,
      criteriaFilter: {
        checkOn: CheckOn.SpanCount,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
        metricMonitorOptions: {
          anomalyDetection: {
            method: AnomalyDetectionMethod.MedianMad,
          },
        },
      },
    });

    expect(result).toBeTruthy();
    expect(result).toContain("median 19.00 spans/min");
  });

  test("a baseline lookup error is swallowed and never fires", async () => {
    getBaselineSpy.mockRejectedValue(new Error("clickhouse down"));
    expect(
      await evaluateAnomaly({
        spanCount: 10000,
        criteriaFilter: {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
        },
      }),
    ).toBeNull();
  });
});
