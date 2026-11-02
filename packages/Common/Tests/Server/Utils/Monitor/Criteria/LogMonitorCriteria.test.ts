import LogMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import LogCountBaselineService from "../../../../../Server/Services/LogCountBaselineService";
import { CountBaselineSummary } from "../../../../../Server/Utils/Monitor/Criteria/CountAnomaly";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  FilterType,
  MetricAnomalyDetectionOptions,
} from "../../../../../Types/Monitor/CriteriaFilter";
import LogMonitorResponse from "../../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import DataToProcess from "../../../../../Server/Utils/Monitor/DataToProcess";
import MonitorStep from "../../../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../../../Types/Monitor/MonitorStepLogMonitor";
import LogSeverity from "../../../../../Types/Log/LogSeverity";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * LogMonitorCriteria is what turns the logCount the (now-fixed) worker
 * produces into an online/offline verdict. It only understands
 * CheckOn.LogCount — the sole check the Logs criteria UI offers — and defers
 * the numeric comparison to CompareCriteria.
 */
function buildResponse(logCount: number | undefined): DataToProcess {
  const response: Partial<LogMonitorResponse> = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    logCount: logCount as number,
    logQuery: {},
  };
  return response as DataToProcess;
}

function evaluate(
  logCount: number | undefined,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: buildResponse(logCount),
    criteriaFilter,
  });
}

describe("LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  describe("LogCount GreaterThan", () => {
    test("count above threshold → met", async () => {
      const result: string | null = await evaluate(5, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      });
      expect(result).toBeTruthy();
      expect(result).toContain("Log Count");
    });

    test("count equal to threshold → not met", async () => {
      expect(
        await evaluate(3, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 3,
        }),
      ).toBeNull();
    });

    test("count below threshold → not met", async () => {
      expect(
        await evaluate(0, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });
  });

  describe("LogCount EqualTo (the default offline criteria)", () => {
    test("zero logs equal to 0 → met (monitor goes offline)", async () => {
      const result: string | null = await evaluate(0, {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.EqualTo,
        value: 0,
      });
      expect(result).toBeTruthy();
    });

    test("some logs not equal to 0 → not met", async () => {
      expect(
        await evaluate(7, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeNull();
    });
  });

  describe("other numeric comparators", () => {
    test("LessThan → met when below", async () => {
      expect(
        await evaluate(2, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.LessThan,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("GreaterThanOrEqualTo → met at the boundary", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThanOrEqualTo,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("LessThanOrEqualTo → met at the boundary", async () => {
      expect(
        await evaluate(5, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.LessThanOrEqualTo,
          value: 5,
        }),
      ).toBeTruthy();
    });

    test("NotEqualTo → met when different", async () => {
      expect(
        await evaluate(4, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.NotEqualTo,
          value: 0,
        }),
      ).toBeTruthy();
    });
  });

  /*
   * The exact production shape of a "log presence" alert: criteria
   * "Log Count >= 1" flips the monitor Offline the moment a matching log
   * line is ingested. Documents the comparator behavior downstream of
   * countBy — the countBy parsing regression itself (ClickHouse >= 25.x
   * returning count() as a JSON number) is pinned in
   * AnalyticsDatabaseService.test.ts.
   */
  describe("log-presence offline criteria (Log Count >= 1)", () => {
    const offlineCriteria: CriteriaFilter = {
      checkOn: CheckOn.LogCount,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 1,
    };

    test("one matching log → met (monitor goes offline)", async () => {
      const result: string | null = await evaluate(1, offlineCriteria);
      expect(result).toBeTruthy();
      expect(result).toContain("Log Count");
    });

    test("many matching logs → met", async () => {
      expect(await evaluate(6718284, offlineCriteria)).toBeTruthy();
    });

    test("zero matching logs → not met (monitor stays operational)", async () => {
      expect(await evaluate(0, offlineCriteria)).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("a missing logCount is treated as 0", async () => {
      // undefined logCount → 0; "equal to 0" is therefore met.
      expect(
        await evaluate(undefined, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.EqualTo,
          value: 0,
        }),
      ).toBeTruthy();
    });

    test("a string threshold is coerced to a number", async () => {
      expect(
        await evaluate(10, {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: "5",
        }),
      ).toBeTruthy();
    });

    test("a non-LogCount checkOn returns null (unhandled)", async () => {
      expect(
        await evaluate(100, {
          checkOn: CheckOn.SpanCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      ).toBeNull();
    });
  });

  /*
   * Anomaly filters on LogCount: the evaluator normalizes the observed
   * count to logs-per-minute (the unit getBaseline answers in) and
   * compares it to the earlier weeks of the monitor's scope, including
   * the Learning cold-start and zero-variance guards. Full matrix coverage
   * of the shared math lives in CountAnomaly.test.ts and the trace
   * sibling in TraceMonitorCriteria.test.ts.
   */
  describe("LogCount anomaly filters", () => {
    let getBaselineSpy: jest.SpyInstance;

    beforeEach(() => {
      getBaselineSpy = jest.spyOn(LogCountBaselineService, "getBaseline");
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
      overrides: Partial<MonitorStepLogMonitor>,
    ): MonitorStep {
      const monitorStep: MonitorStep = new MonitorStep();
      monitorStep.data = {
        id: ObjectID.generate().toString(),
        monitorCriteria: { data: undefined } as never,
      } as unknown as MonitorStep["data"];
      monitorStep.data!.logMonitor = {
        ...MonitorStepLogMonitorUtil.getDefault(),
        ...overrides,
      };
      return monitorStep;
    }

    function evaluateAnomaly(input: {
      logCount: number;
      criteriaFilter: CriteriaFilter;
      monitorStep?: MonitorStep | undefined;
    }): Promise<string | null> {
      return LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess: buildResponse(input.logCount),
        criteriaFilter: input.criteriaFilter,
        monitorStep: input.monitorStep,
      });
    }

    test("AnomalouslyHigh fires when the log rate exceeds mean + 3σ (Medium default)", async () => {
      // mean 20/min, σ 5 → 3σ band is [5, 35]; 90 logs in 60s = 90/min.
      getBaselineSpy.mockResolvedValue(buildBaseline({}));

      const result: string | null = await evaluateAnomaly({
        logCount: 90,
        criteriaFilter: {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
        },
      });

      expect(result).toBeTruthy();
      expect(result).toContain("above the same-hour baseline");
      expect(result).toContain("90.00 logs/min");
    });

    test("no fire when the log rate is inside the expected band", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({}));

      expect(
        await evaluateAnomaly({
          logCount: 25,
          criteriaFilter: {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.AnomalouslyLow,
            value: undefined,
          },
        }),
      ).toBeNull();
    });

    test("AnomalouslyLow fires when the log rate drops below mean - 3σ", async () => {
      // mean 60/min, σ 10 → low band edge 30; 0 logs breaches low.
      getBaselineSpy.mockResolvedValue(buildBaseline({ mean: 60, stddev: 10 }));

      const result: string | null = await evaluateAnomaly({
        logCount: 0,
        criteriaFilter: {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.AnomalouslyLow,
          value: undefined,
        },
      });

      expect(result).toBeTruthy();
      expect(result).toContain("below the same-hour baseline");
    });

    test("observed count is normalized by the monitor's evaluation window", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({}));

      // 100 logs over 300s = 20/min — exactly the mean, inside the band.
      expect(
        await evaluateAnomaly({
          logCount: 100,
          criteriaFilter: {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.AnomalouslyHigh,
            value: undefined,
          },
          monitorStep: buildMonitorStep({ lastXSecondsOfLogs: 300 }),
        }),
      ).toBeNull();
    });

    test("baseline lookup is keyed by project, services, severities and anomaly options", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({}));

      const serviceId: ObjectID = ObjectID.generate();
      const monitorStep: MonitorStep = buildMonitorStep({
        telemetryServiceIds: [serviceId],
        severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      });

      const dataToProcess: DataToProcess = buildResponse(90);

      await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess,
        criteriaFilter: {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.AnomalouslyHigh,
          value: undefined,
          metricMonitorOptions: {
            anomalyDetection: {
              sensitivity: AnomalyDetectionSensitivity.Low,
              windowDays: 90,
              minSamples: 20,
            },
          },
        },
        monitorStep,
      });

      expect(getBaselineSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: (dataToProcess as LogMonitorResponse).projectId.toString(),
          telemetryServiceIds: [serviceId.toString()],
          severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
          windowDays: 90,
          minSamples: 20,
        }),
      );
    });

    test("Learning state (unreliable or missing baseline) never fires", async () => {
      getBaselineSpy.mockResolvedValue(buildBaseline({ isReliable: false }));
      expect(
        await evaluateAnomaly({
          logCount: 10000,
          criteriaFilter: {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.AnomalouslyHigh,
            value: undefined,
          },
        }),
      ).toBeNull();

      getBaselineSpy.mockResolvedValue(null);
      expect(
        await evaluateAnomaly({
          logCount: 10000,
          criteriaFilter: {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.AnomalouslyHigh,
            value: undefined,
          },
        }),
      ).toBeNull();
    });

    test("zero-variance baseline never fires", async () => {
      getBaselineSpy.mockResolvedValue(
        buildBaseline({ stddev: 0, madSigma: 0 }),
      );
      expect(
        await evaluateAnomaly({
          logCount: 10000,
          criteriaFilter: {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.AnomalouslyHigh,
            value: undefined,
          },
        }),
      ).toBeNull();
    });

    describe("the window an anomaly filter reads", () => {
      const high: CriteriaFilter = {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.AnomalouslyHigh,
        value: undefined,
      };

      function evaluateWindow(input: {
        evaluatedUntil?: Date | string;
        monitorStep?: MonitorStep;
      }): Promise<string | null> {
        return LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: {
            ...(buildResponse(90) as LogMonitorResponse),
            evaluatedUntil: input.evaluatedUntil,
          } as DataToProcess,
          criteriaFilter: high,
          monitorStep: input.monitorStep,
        });
      }

      test("it is the window judged, not the time of the check", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline({}));

        const heldBack: Date = new Date("2026-11-02T09:40:00.000Z");

        await evaluateWindow({
          evaluatedUntil: heldBack,
          monitorStep: buildMonitorStep({ lastXSecondsOfLogs: 900 }),
        });

        expect(getBaselineSpy).toHaveBeenCalledWith(
          expect.objectContaining({ windowEnd: heldBack, windowSeconds: 900 }),
        );
      });

      test("a window kept as JSON reads as the same instant", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline({}));

        await evaluateWindow({ evaluatedUntil: "2026-11-02T09:40:00.000Z" });

        expect(getBaselineSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            windowEnd: new Date("2026-11-02T09:40:00.000Z"),
          }),
        );
      });

      test("a response without one is read as ending now", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline({}));

        const before: number = Date.now();

        await evaluateWindow({});

        const windowEnd: Date = getBaselineSpy.mock.calls[0]![0].windowEnd;

        expect(windowEnd.getTime()).toBeGreaterThanOrEqual(before);
        expect(windowEnd.getTime()).toBeLessThanOrEqual(Date.now());
      });

      test("the window's length defaults as the rate does", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline({}));

        await evaluateWindow({});

        expect(getBaselineSpy).toHaveBeenCalledWith(
          expect.objectContaining({ windowSeconds: 60 }),
        );
      });
    });

    describe("a quiet scope's baseline", () => {
      const quiet: Partial<CountBaselineSummary> = {
        sampleCount: 360,
        mean: 0,
        stddev: 1,
        median: 0,
        madSigma: 1,
        minObserved: 0,
        maxObserved: 0,
      };

      // Runs of a job among the empty windows of a sparse scope.
      const jobLike: Partial<CountBaselineSummary> = {
        ...quiet,
        mean: 1.1,
        stddev: 7.8,
        maxObserved: 110,
        nonEmpty: {
          sampleCount: 4,
          mean: 100,
          stddev: 10,
          median: 100,
          madSigma: 10,
          minObserved: 90,
          maxObserved: 110,
        },
      };

      function filterOf(
        filterType: FilterType,
        anomalyDetection?: MetricAnomalyDetectionOptions,
      ): CriteriaFilter {
        return {
          checkOn: CheckOn.LogCount,
          filterType,
          value: undefined,
          metricMonitorOptions: { anomalyDetection },
        };
      }

      test("its first few are no reason to alert", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline(quiet));

        expect(
          await evaluateAnomaly({
            logCount: 9,
            criteriaFilter: filterOf(FilterType.AnomalouslyHigh),
          }),
        ).toBeNull();
      });

      test("a burst is", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline(quiet));

        expect(
          await evaluateAnomaly({
            logCount: 10,
            criteriaFilter: filterOf(FilterType.AnomalouslyHigh),
          }),
        ).toBeTruthy();
      });

      test("the minimum follows the sensitivity", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline(quiet));

        expect(
          await evaluateAnomaly({
            logCount: 5,
            criteriaFilter: filterOf(FilterType.AnomalouslyHigh, {
              sensitivity: AnomalyDetectionSensitivity.High,
            }),
          }),
        ).toBeTruthy();

        expect(
          await evaluateAnomaly({
            logCount: 19,
            criteriaFilter: filterOf(FilterType.AnomalouslyHigh, {
              sensitivity: AnomalyDetectionSensitivity.Low,
            }),
          }),
        ).toBeNull();
      });

      test("a minimum the monitor sets is honoured", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline(quiet));

        expect(
          await evaluateAnomaly({
            logCount: 50,
            criteriaFilter: filterOf(FilterType.AnomalouslyHigh, {
              minimumCount: 100,
            }),
          }),
        ).toBeNull();
      });

      test("a job's usual run is not unusually high", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline(jobLike));

        expect(
          await evaluateAnomaly({
            logCount: 105,
            criteriaFilter: filterOf(FilterType.AnomalouslyHigh),
          }),
        ).toBeNull();
      });

      test("a run past the usual is, and the alert says what was usual", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline(jobLike));

        const result: string | null = await evaluateAnomaly({
          logCount: 300,
          criteriaFilter: filterOf(FilterType.AnomalouslyHigh),
        });

        expect(result).toContain("mean 100.00 logs/min");
        expect(result).toContain("4 samples over 14 days");
      });

      test("an empty window is not unusually low", async () => {
        getBaselineSpy.mockResolvedValue(buildBaseline(jobLike));

        expect(
          await evaluateAnomaly({
            logCount: 0,
            criteriaFilter: filterOf(FilterType.Anomalous),
          }),
        ).toBeNull();
      });
    });

    test("a baseline lookup error is swallowed and never fires", async () => {
      getBaselineSpy.mockRejectedValue(new Error("clickhouse down"));
      expect(
        await evaluateAnomaly({
          logCount: 10000,
          criteriaFilter: {
            checkOn: CheckOn.LogCount,
            filterType: FilterType.AnomalouslyHigh,
            value: undefined,
          },
        }),
      ).toBeNull();
    });
  });
});
