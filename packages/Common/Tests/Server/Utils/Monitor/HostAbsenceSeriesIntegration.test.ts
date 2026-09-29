import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../../Types/Metrics/MetricQueryData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import { buildAbsentHostSeries } from "../../../../Server/Utils/Monitor/HostAbsenceSeries";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";

/*
 * End-to-end validation of the host-absence fix using the exact shape of
 * Aptean's "Host Availability" monitor: a group-by-host (resource.host.name)
 * metric monitor on oneuptime.host.heartbeat with a `== 0` filter and
 * onNoDataPolicy = Trigger. It proves that a synthetic absent-host series
 * produced by buildAbsentHostSeries flows through the real criteria
 * evaluator and yields exactly one correctly-labeled per-host trigger,
 * while a present (reporting) host does not fire.
 */

const HOST_KEY: string = "resource.host.name";
const HEARTBEAT_METRIC: string = "oneuptime.host.heartbeat";
const PRESENT_HOST: string = "pmtrs2app01";
const SILENT_HOST: string = "chsdc08";

function buildFixture(): {
  monitorStep: MonitorStep;
  criteriaFilter: CriteriaFilter;
  dataToProcess: MetricMonitorResponse;
} {
  const queryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "h0",
      title: HEARTBEAT_METRIC,
      description: undefined,
      legend: HEARTBEAT_METRIC,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: HEARTBEAT_METRIC,
      },
      groupByAttributeKeys: [HOST_KEY],
    } as unknown as MetricQueryData,
  };

  const metricViewConfig: MetricsViewConfig = {
    queryConfigs: [queryConfig],
    formulaConfigs: [],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined },
  } as unknown as MonitorStep["data"];
  monitorStep.data!.metricMonitor = {
    metricViewConfig,
    rollingTime: RollingTime.Past5Minutes,
  };

  // Mirrors the live criteria: heartbeat value Equal To 0, no-data → Trigger.
  const criteriaFilter: CriteriaFilter = {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.EqualTo,
    value: "0",
    metricMonitorOptions: {
      metricAlias: "h0",
      onNoDataPolicy: NoDataPolicy.Trigger,
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  };

  /*
   * A reporting host: heartbeat present (value 1) → "== 0" does not match,
   * and there is data so the no-data policy is not triggered.
   */
  const presentSeries: MetricSeriesResult = {
    fingerprint: MetricSeriesFingerprint.computeFingerprint({
      [HOST_KEY]: PRESENT_HOST,
    }),
    labels: { [HOST_KEY]: PRESENT_HOST },
    aggregatedResults: [
      {
        data: [
          {
            timestamp: new Date("2026-07-03T12:00:00.000Z"),
            value: 1,
          } as AggregatedModel,
        ],
      } as AggregatedResult,
    ],
  };

  /*
   * The silent host is materialized by the REAL injection helper, not hand-
   * built, so this exercises the exact series shape the worker produces.
   */
  const absentSeries: Array<MetricSeriesResult> = buildAbsentHostSeries({
    presentSeries: [presentSeries],
    expectedHostIdentifiers: [PRESENT_HOST, SILENT_HOST],
    hostKey: HOST_KEY,
    slotCount: 1,
  });

  const dataToProcess: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricViewConfig,
    metricResult: [presentSeries.aggregatedResults[0]!],
    seriesBreakdown: [presentSeries, ...absentSeries],
  };

  return { monitorStep, criteriaFilter, dataToProcess };
}

describe("HostAbsenceSeries end-to-end (Aptean Host Availability shape)", () => {
  test("injection produces exactly one absent series for the silent host", () => {
    const { dataToProcess } = buildFixture();
    const absent: Array<MetricSeriesResult> =
      dataToProcess.seriesBreakdown!.filter((s: MetricSeriesResult) => {
        return s.labels[HOST_KEY] === SILENT_HOST;
      });
    expect(absent).toHaveLength(1);
    expect(absent[0]!.aggregatedResults).toHaveLength(1);
    expect(absent[0]!.aggregatedResults[0]!.data).toEqual([]);
  });

  test("evaluateAllSeries: silent host fires no-data trigger, present host does not", async () => {
    const { monitorStep, criteriaFilter, dataToProcess } = buildFixture();

    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries({
        dataToProcess,
        criteriaFilter,
        monitorStep,
      });

    const present: MetricSeriesEvaluationResult | undefined = evaluations.find(
      (e: MetricSeriesEvaluationResult) => {
        return e.labels[HOST_KEY] === PRESENT_HOST;
      },
    );
    const silent: MetricSeriesEvaluationResult | undefined = evaluations.find(
      (e: MetricSeriesEvaluationResult) => {
        return e.labels[HOST_KEY] === SILENT_HOST;
      },
    );

    expect(present).toBeDefined();
    expect(present!.rootCause).toBeNull();

    expect(silent).toBeDefined();
    expect(silent!.rootCause).toContain("No data received");
    expect(silent!.rootCause).toContain(HEARTBEAT_METRIC);
  });

  test("scalar entrypoint reports the criteria as met when a host is silent", async () => {
    const { monitorStep, criteriaFilter, dataToProcess } = buildFixture();

    const message: string | null =
      await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
        dataToProcess,
        criteriaFilter,
        monitorStep,
      });

    expect(message).toBeTruthy();
    expect(message).toContain("No data received");
  });

  test("collectPerSeriesMatches: exactly one per-host match, labeled with the silent host", async () => {
    const { monitorStep, criteriaFilter, dataToProcess } = buildFixture();

    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.Metrics;

    const criteriaInstance: MonitorCriteriaInstance =
      new MonitorCriteriaInstance();
    criteriaInstance.data = {
      id: "criteria-1",
      monitorStatusId: undefined,
      filterCondition: FilterCondition.Any,
      filters: [criteriaFilter],
      incidents: [],
      alerts: [],
      name: "Host down",
      description: "",
    };

    /*
     * collectPerSeriesMatches is private; exercise it via the documented
     * `as any` escape hatch (same pattern as SeriesAbsenceResolutionGuard).
     */
    const matches: Array<{
      criteriaMetId: string;
      fingerprint: string;
      labels: Record<string, unknown>;
      rootCause: string;
    }> = await (
      MonitorCriteriaEvaluator as unknown as {
        collectPerSeriesMatches: (input: {
          dataToProcess: MetricMonitorResponse;
          monitor: Monitor;
          monitorStep: MonitorStep;
          criteriaInstance: MonitorCriteriaInstance;
        }) => Promise<
          Array<{
            criteriaMetId: string;
            fingerprint: string;
            labels: Record<string, unknown>;
            rootCause: string;
          }>
        >;
      }
    ).collectPerSeriesMatches({
      dataToProcess,
      monitor,
      monitorStep,
      criteriaInstance,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.labels[HOST_KEY]).toBe(SILENT_HOST);
    expect(matches[0]!.fingerprint).toBe(
      MetricSeriesFingerprint.computeFingerprint({ [HOST_KEY]: SILENT_HOST }),
    );
    expect(matches[0]!.rootCause).toContain("No data received");
    expect(matches[0]!.criteriaMetId).toBe("criteria-1");
  });
});
