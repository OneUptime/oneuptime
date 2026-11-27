/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import LogMonitorGroupResult from "../../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
import LogMonitorResponse from "../../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationWindow,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, it } from "@jest/globals";

/*
 * THE ROOT CAUSE OF WHAT A TELEMETRY CHECK OPENS SAYS WHICH WINDOW IT JUDGED
 * (issue #11248).
 *
 * A telemetry check judges the window that ends when it was due, however
 * late it runs, so the time an incident or an alert opened no longer says
 * which logs, metrics or spans it is about. Its root cause ends with the
 * window, in UTC - "**Window Judged**: 2026-11-27 10:00:07 to 10:01:07
 * UTC" - for the whole monitor and for each series a grouped monitor opens
 * one for. The window is the one the evaluation's summary holds
 * (MonitorResource puts it there from the evaluation job). A check that
 * judges no window - a probe's - says nothing of one.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11248000-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11248000-1111-4111-8111-111111111111",
);

const WINDOW: MonitorEvaluationWindow = {
  startsAt: new Date("2026-11-27T10:00:07.250Z"),
  endsAt: new Date("2026-11-27T10:01:07.250Z"),
};

const WINDOW_LINE: string =
  "**Window Judged**: 2026-11-27 10:00:07 to 10:01:07 UTC";

function criteriaInstance(id: string): MonitorCriteriaInstance {
  const filter: CriteriaFilter = {
    checkOn: CheckOn.LogCount,
    filterType: FilterType.GreaterThan,
    value: 0,
  };

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: id,
    name: "Errors in the minute",
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [filter],
    incidents: [],
    alerts: [],
    createAlerts: true,
    createIncidents: true,
    isEnabled: true,
  } as unknown as MonitorCriteriaInstance["data"];
  return instance;
}

function logStep(groupByAttributes: Array<string> | undefined): MonitorStep {
  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = {
    monitorCriteriaInstanceArray: [criteriaInstance("errors")],
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: criteria,
  } as unknown as MonitorStep["data"];
  monitorStep.data!.logMonitor = {
    ...MonitorStepLogMonitorUtil.getDefault(),
    lastXSecondsOfLogs: 60,
    groupByAttributes: groupByAttributes,
  };

  return monitorStep;
}

function logsMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.Logs;
  monitor.name = "Checkout errors";
  return monitor;
}

function group(labels: JSONObject, logCount: number): LogMonitorGroupResult {
  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    logCount: logCount,
  };
}

async function evaluate(input: {
  dataToProcess: LogMonitorResponse;
  groupByAttributes?: Array<string> | undefined;
  judgedWindow?: MonitorEvaluationWindow | undefined;
}): Promise<ProbeApiIngestResponse> {
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: new Date("2026-11-27T10:01:32.000Z"),
    criteriaResults: [],
    events: [],
    ...(input.judgedWindow ? { judgedWindow: input.judgedWindow } : {}),
  };

  return await MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: input.dataToProcess as DataToProcess,
    monitorStep: logStep(input.groupByAttributes),
    monitor: logsMonitor(),
    probeApiIngestResponse: { monitorId: MONITOR_ID, rootCause: null },
    evaluationSummary: summary,
  });
}

function ungrouped(logCount: number): LogMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    logCount: logCount,
    logQuery: {},
    evaluatedUntil: WINDOW.endsAt,
  };
}

function grouped(groups: Array<LogMonitorGroupResult>): LogMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    logCount: groups.reduce((sum: number, item: LogMonitorGroupResult) => {
      return sum + item.logCount;
    }, 0),
    logQuery: {},
    groupByAttributes: ["service.name"],
    groupBreakdown: groups,
    totalGroupCount: groups.length,
  };
}

describe("the root cause of what a telemetry check opens", () => {
  it("ends with the window it judged, after the filters it met", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: ungrouped(3),
      groupByAttributes: undefined,
      judgedWindow: WINDOW,
    });

    expect(response.criteriaMetId).toBe("errors");

    const rootCause: string = response.rootCause!;
    expect(rootCause).toContain("**Filter Conditions Met**:");
    expect(rootCause).toContain(WINDOW_LINE);
    expect(rootCause.indexOf(WINDOW_LINE)).toBeGreaterThan(
      rootCause.indexOf("**Filter Conditions Met**:"),
    );
    expect(rootCause.trimEnd().endsWith(WINDOW_LINE)).toBe(true);
    // Once.
    expect(rootCause.split("**Window Judged**").length).toBe(2);
  });

  it("names the window it was due to, not when it ran: the summary says it evaluated 25 seconds after its end", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: ungrouped(3),
      groupByAttributes: undefined,
      judgedWindow: WINDOW,
    });

    expect(response.rootCause).not.toContain("10:01:32");
  });

  it("each series of a grouped monitor says it too, and so does the whole monitor's", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: grouped([
        group({ "service.name": "checkout" }, 2),
        group({ "service.name": "payments" }, 1),
      ]),
      groupByAttributes: ["service.name"],
      judgedWindow: WINDOW,
    });

    expect(response.criteriaMetId).toBe("errors");
    expect(response.perSeriesMatches).toHaveLength(2);

    for (const match of response.perSeriesMatches as Array<PerSeriesCriteriaMatch>) {
      expect(match.rootCause).toContain(WINDOW_LINE);
      expect(match.rootCause.trimEnd().endsWith(WINDOW_LINE)).toBe(true);
      expect(match.rootCause.split("**Window Judged**").length).toBe(2);
    }

    expect(response.rootCause).toContain(WINDOW_LINE);
  });

  it("a check that judged no window - a probe's, or one from before checks said it - names none", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: ungrouped(3),
      groupByAttributes: undefined,
    });

    expect(response.criteriaMetId).toBe("errors");
    expect(response.rootCause).not.toContain("Window Judged");

    const groupedResponse: ProbeApiIngestResponse = await evaluate({
      dataToProcess: grouped([group({ "service.name": "checkout" }, 2)]),
      groupByAttributes: ["service.name"],
    });

    for (const match of groupedResponse.perSeriesMatches as Array<PerSeriesCriteriaMatch>) {
      expect(match.rootCause).not.toContain("Window Judged");
    }
  });

  it("a window across midnight in UTC names both days", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: ungrouped(3),
      groupByAttributes: undefined,
      judgedWindow: {
        startsAt: new Date("2026-11-26T23:59:30.000Z"),
        endsAt: new Date("2026-11-27T00:00:30.000Z"),
      },
    });

    expect(response.rootCause).toContain(
      "**Window Judged**: 2026-11-26 23:59:30 to 2026-11-27 00:00:30 UTC",
    );
  });

  it("a check that meets no criteria writes no root cause at all", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      dataToProcess: ungrouped(0),
      groupByAttributes: undefined,
      judgedWindow: WINDOW,
    });

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.rootCause).toBeNull();
  });
});
