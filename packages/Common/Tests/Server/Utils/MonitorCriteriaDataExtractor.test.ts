import MonitorCriteriaDataExtractor from "../../../Server/Utils/Monitor/MonitorCriteriaDataExtractor";
import DataToProcess from "../../../Server/Utils/Monitor/DataToProcess";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * MonitorCriteriaDataExtractor discriminates the DataToProcess union into a
 * concrete monitor-response shape using presence checks on marker fields
 * (hostname, logCount, spanCount, ...). If one of those markers changes, the
 * whole criteria-evaluation pipeline silently starts feeding the wrong
 * evaluator. These tests lock the discrimination + the numeric extraction in
 * extractMetricValues.
 */

const projectId: ObjectID = new ObjectID("project");
const monitorId: ObjectID = new ObjectID("monitor");

function metricResponse(
  metricResult: Array<AggregatedResult>,
): MetricMonitorResponse {
  return {
    projectId,
    monitorId,
    metricResult,
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
  };
}

describe("MonitorCriteriaDataExtractor discriminators", () => {
  test("getServerMonitorResponse matches on hostname", () => {
    const server: DataToProcess = {
      hostname: "host-1",
    } as unknown as DataToProcess;

    expect(MonitorCriteriaDataExtractor.getServerMonitorResponse(server)).toBe(
      server,
    );
    expect(
      MonitorCriteriaDataExtractor.getServerMonitorResponse({
        logCount: 0,
      } as unknown as DataToProcess),
    ).toBeNull();
  });

  test("getProbeMonitorResponse matches on monitorStepId", () => {
    const probe: DataToProcess = {
      monitorStepId: new ObjectID("step"),
    } as unknown as DataToProcess;

    expect(MonitorCriteriaDataExtractor.getProbeMonitorResponse(probe)).toBe(
      probe,
    );
    expect(
      MonitorCriteriaDataExtractor.getProbeMonitorResponse(
        {} as unknown as DataToProcess,
      ),
    ).toBeNull();
  });

  test("getLogMonitorResponse matches when logCount is defined (even 0)", () => {
    const log: DataToProcess = {
      logCount: 0,
    } as unknown as DataToProcess;

    expect(MonitorCriteriaDataExtractor.getLogMonitorResponse(log)).toBe(log);
  });

  test("getTraceMonitorResponse matches when spanCount is defined", () => {
    const trace: DataToProcess = {
      spanCount: 5,
    } as unknown as DataToProcess;

    expect(MonitorCriteriaDataExtractor.getTraceMonitorResponse(trace)).toBe(
      trace,
    );
    expect(
      MonitorCriteriaDataExtractor.getTraceMonitorResponse({
        hostname: "x",
      } as unknown as DataToProcess),
    ).toBeNull();
  });

  test("getExceptionMonitorResponse matches when exceptionCount is defined", () => {
    const exception: DataToProcess = {
      exceptionCount: 3,
    } as unknown as DataToProcess;

    expect(
      MonitorCriteriaDataExtractor.getExceptionMonitorResponse(exception),
    ).toBe(exception);
  });

  test("getIncomingMonitorRequest matches when incomingRequestReceivedAt is defined", () => {
    const incoming: DataToProcess = {
      incomingRequestReceivedAt: new Date(),
    } as unknown as DataToProcess;

    expect(
      MonitorCriteriaDataExtractor.getIncomingMonitorRequest(incoming),
    ).toBe(incoming);
  });

  test("getMetricMonitorResponse matches when metricResult is defined", () => {
    const metric: DataToProcess = metricResponse([]) as DataToProcess;
    expect(MonitorCriteriaDataExtractor.getMetricMonitorResponse(metric)).toBe(
      metric,
    );
  });

  test("nested probe extractors return empty/null when not a probe", () => {
    const notProbe: DataToProcess = {
      hostname: "x",
    } as unknown as DataToProcess;

    expect(
      MonitorCriteriaDataExtractor.getSyntheticMonitorResponses(notProbe),
    ).toEqual([]);
    expect(MonitorCriteriaDataExtractor.getSslResponse(notProbe)).toBeNull();
    expect(
      MonitorCriteriaDataExtractor.getCustomCodeMonitorResponse(notProbe),
    ).toBeNull();
  });
});

describe("MonitorCriteriaDataExtractor.extractMetricValues", () => {
  const emptyFilter: CriteriaFilter = {} as CriteriaFilter;

  test("returns null when the data is not a metric response", () => {
    const result: { alias: string | null; values: Array<number> } | null =
      MonitorCriteriaDataExtractor.extractMetricValues({
        criteriaFilter: emptyFilter,
        dataToProcess: { hostname: "x" } as unknown as DataToProcess,
        monitorStep: new MonitorStep(),
      });

    expect(result).toBeNull();
  });

  test("returns empty values when the metric result set is empty", () => {
    const result: { alias: string | null; values: Array<number> } | null =
      MonitorCriteriaDataExtractor.extractMetricValues({
        criteriaFilter: {
          metricMonitorOptions: { metricAlias: "cpu" },
        } as CriteriaFilter,
        dataToProcess: metricResponse([]) as DataToProcess,
        monitorStep: new MonitorStep(),
      });

    expect(result).toEqual({ alias: "cpu", values: [] });
  });

  test("extracts numeric values from the first result and drops NaN", () => {
    const aggregated: AggregatedResult = {
      data: [
        { timestamp: new Date(), value: 10 },
        { timestamp: new Date(), value: NaN },
        { timestamp: new Date(), value: 20 },
      ],
    };

    const result: { alias: string | null; values: Array<number> } | null =
      MonitorCriteriaDataExtractor.extractMetricValues({
        criteriaFilter: emptyFilter,
        dataToProcess: metricResponse([aggregated]) as DataToProcess,
        monitorStep: new MonitorStep(),
      });

    expect(result).not.toBeNull();
    expect(result!.values).toEqual([10, 20]);
  });
});
