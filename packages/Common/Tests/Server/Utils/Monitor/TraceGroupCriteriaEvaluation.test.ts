/*
 * isolated-vm is a native addon the evaluator loads through
 * JavaScript-expression criteria; nothing here runs one.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepTraceMonitorUtil } from "../../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import TraceMonitorGroupResult from "../../../../Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import TraceMonitorResponse from "../../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * #9711 through the whole criteria evaluation: a grouped Traces monitor
 * (Device Stopped Reporting) raises one match per install that went quiet,
 * under the install's own fingerprint, as a grouped Logs monitor raises one
 * per group (LogGroupCriteriaFanOut.test). Its alert then names the install,
 * dedupes on it, and resolves when the install reports again.
 */

const INSTALL: string = "resource.app.installation.id";

const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function install(
  id: string,
  spanCount: number,
  isQuiet: boolean = false,
): TraceMonitorGroupResult {
  const labels: JSONObject = { [INSTALL]: id };

  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    spanCount: spanCount,
    ...(isQuiet ? { isQuiet: true } : {}),
  };
}

function groupedResponse(
  groups: Array<TraceMonitorGroupResult>,
  extra: Partial<TraceMonitorResponse> = {},
): TraceMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    spanCount: groups.reduce((sum: number, item: TraceMonitorGroupResult) => {
      return sum + item.spanCount;
    }, 0),
    spanQuery: {},
    groupByAttributes: [INSTALL],
    groupBreakdown: groups,
    totalGroupCount: groups.length,
    ...extra,
  };
}

function spanCount(filterType: FilterType, value: number): CriteriaFilter {
  return { checkOn: CheckOn.SpanCount, filterType: filterType, value: value };
}

function criteriaInstance(input: {
  id: string;
  filters: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.id,
    name: `Criteria ${input.id}`,
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

function buildStep(input: {
  groupByAttributes: Array<string> | undefined;
  criteriaInstances: Array<MonitorCriteriaInstance>;
}): MonitorStep {
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = { monitorCriteriaInstanceArray: input.criteriaInstances };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: criteria,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.traceMonitor = {
    ...MonitorStepTraceMonitorUtil.getDefault(),
    lastXSecondsOfSpans: 3600,
    groupByAttributes: input.groupByAttributes,
  };

  return monitorStep;
}

function tracesMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.Traces;
  monitor.name = "Kiosk Ordering";
  return monitor;
}

async function evaluate(input: {
  groupByAttributes?: Array<string> | undefined;
  dataToProcess: TraceMonitorResponse;
}): Promise<ProbeApiIngestResponse> {
  const summary: MonitorEvaluationSummary = {
    criteriaResults: [],
    events: [],
  } as unknown as MonitorEvaluationSummary;

  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: input.dataToProcess as DataToProcess,
    monitorStep: buildStep({
      groupByAttributes:
        "groupByAttributes" in input ? input.groupByAttributes : [INSTALL],
      criteriaInstances: [
        criteriaInstance({
          id: "quiet",
          filters: [spanCount(FilterType.LessThan, 1)],
        }),
        criteriaInstance({
          id: "reporting",
          filters: [spanCount(FilterType.GreaterThanOrEqualTo, 1)],
        }),
      ],
    }),
    monitor: tracesMonitor(),
    probeApiIngestResponse: { monitorId: MONITOR_ID, rootCause: null },
    evaluationSummary: summary,
  });
}

function installsOf(matches: Array<PerSeriesCriteriaMatch>): Array<string> {
  return matches
    .map((match: PerSeriesCriteriaMatch): string => {
      return String(match.labels[INSTALL]);
    })
    .sort();
}

describe("a grouped Traces monitor - one alert per quiet install", () => {
  it("raises a match for each install that went quiet, under its own fingerprint", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: groupedResponse([
        install("kiosk-c", 0, true),
        install("kiosk-e", 0, true),
        install("kiosk-a", 12),
      ]),
    });

    expect(response.criteriaMetId).toBe("quiet");
    expect(installsOf(response.perSeriesMatches!)).toEqual([
      "kiosk-c",
      "kiosk-e",
    ]);

    for (const match of response.perSeriesMatches!) {
      expect(match.fingerprint).toBe(
        MetricSeriesFingerprint.computeFingerprint({
          [INSTALL]: match.labels[INSTALL],
        }),
      );
      expect(match.rootCause).toContain(
        `${INSTALL} = ${match.labels[INSTALL]}`,
      );
    }
  });

  it("is healthy while every install reports: the recovery criteria matches each of them", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: groupedResponse([
        install("kiosk-a", 12),
        install("kiosk-b", 3),
      ]),
    });

    expect(response.criteriaMetId).toBe("reporting");
    expect(installsOf(response.perSeriesMatches || [])).toEqual([
      "kiosk-a",
      "kiosk-b",
    ]);
  });

  it("a whole fleet gone quiet meets no criteria, and keeps its status and alerts as silence", async () => {
    const dataToProcess: TraceMonitorResponse = groupedResponse([], {
      isQuietWindow: true,
      totalGroupCount: 3,
    });
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess,
    });

    expect(response.criteriaMetId).toBeFalsy();
    expect(response.perSeriesMatches || []).toEqual([]);
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: tracesMonitor(),
        dataToProcess: dataToProcess as DataToProcess,
      }),
    ).toBe(true);
  });

  it("a window that heard from the fleet is no silence", () => {
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor: tracesMonitor(),
        dataToProcess: groupedResponse([
          install("kiosk-c", 0, true),
          install("kiosk-a", 12),
        ]) as DataToProcess,
      }),
    ).toBe(false);
  });
});

describe("an ungrouped Traces monitor is unchanged", () => {
  it("is judged on its one count, with no per-series match", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      groupByAttributes: undefined,
      dataToProcess: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        spanCount: 0,
        spanQuery: {},
      },
    });

    expect(response.criteriaMetId).toBe("quiet");
    expect(response.perSeriesMatches || []).toEqual([]);
  });
});
