/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import LogGroupCriteriaFanOut from "../../../../Server/Utils/Monitor/LogGroupCriteriaFanOut";
import { MaxEntitiesPerCriteria } from "../../../../Server/Utils/Monitor/PerEntityCriteriaFanOut";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import logger from "../../../../Server/Utils/Logger";
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
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - a grouped Logs monitor raises one alert per group.
 *
 * The motivating case: a Sophos firewall logs "IPsec connection ...
 * terminated" with the tunnel in `con_name`. Ungrouped, the first tunnel
 * to go down opens the monitor's one alert and every later tunnel is
 * swallowed by it. Grouped by `con_name`, each tunnel is its own series:
 * its own match, its own fingerprint, so MonitorResource creates, dedupes
 * and resolves one alert per tunnel through the same per-series path a
 * grouped metric monitor uses.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function group(labels: JSONObject, logCount: number): LogMonitorGroupResult {
  return {
    fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
    labels: labels,
    logCount: logCount,
  };
}

function tunnel(conName: string, logCount: number): LogMonitorGroupResult {
  return group({ con_name: conName }, logCount);
}

function groupedResponse(
  groups: Array<LogMonitorGroupResult>,
): LogMonitorResponse {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: MONITOR_ID,
    logCount: groups.reduce((sum: number, item: LogMonitorGroupResult) => {
      return sum + item.logCount;
    }, 0),
    logQuery: {},
    groupByAttributes: Object.keys(groups[0]?.labels || { con_name: "" }),
    groupBreakdown: groups,
    totalGroupCount: groups.length,
  };
}

function logCount(filterType: FilterType, value: number): CriteriaFilter {
  return { checkOn: CheckOn.LogCount, filterType: filterType, value: value };
}

function criteriaInstance(input: {
  id: string;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.id,
    name: `Criteria ${input.id}`,
    description: "",
    monitorStatusId: undefined,
    filterCondition: input.filterCondition || FilterCondition.All,
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
  monitorStep.data!.logMonitor = {
    ...MonitorStepLogMonitorUtil.getDefault(),
    body: "terminated",
    attributes: { log_component: "IPSec" },
    groupByAttributes: input.groupByAttributes,
  };

  return monitorStep;
}

function logsMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = new ObjectID("11111111-1111-4111-8111-111111111111");
  monitor.monitorType = MonitorType.Logs;
  monitor.name = "IPsec tunnels";
  return monitor;
}

async function evaluate(input: {
  groupByAttributes?: Array<string> | undefined;
  criteriaInstances: Array<MonitorCriteriaInstance>;
  dataToProcess: LogMonitorResponse;
}): Promise<{
  response: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
}> {
  const summary: MonitorEvaluationSummary = {
    criteriaResults: [],
    events: [],
  } as unknown as MonitorEvaluationSummary;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: input.dataToProcess as DataToProcess,
      monitorStep: buildStep({
        groupByAttributes:
          "groupByAttributes" in input ? input.groupByAttributes : ["con_name"],
        criteriaInstances: input.criteriaInstances,
      }),
      monitor: logsMonitor(),
      probeApiIngestResponse: { monitorId: MONITOR_ID, rootCause: null },
      evaluationSummary: summary,
    });

  return { response, summary };
}

function conNamesOf(matches: Array<PerSeriesCriteriaMatch>): Array<unknown> {
  return matches
    .map((match: PerSeriesCriteriaMatch) => {
      return match.labels["con_name"];
    })
    .sort();
}

describe("a grouped Logs monitor - one alert per group", () => {
  it("raises a separate match for every tunnel that terminated", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "down",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: groupedResponse([
        tunnel("HQ-Branch1", 2),
        tunnel("Branch2", 1),
      ]),
    });

    expect(response.criteriaMetId).toBe("down");
    expect(conNamesOf(response.perSeriesMatches!)).toEqual([
      "Branch2",
      "HQ-Branch1",
    ]);

    for (const match of response.perSeriesMatches!) {
      // The fingerprint the alert is stored under is the group's own.
      expect(match.fingerprint).toBe(
        MetricSeriesFingerprint.computeFingerprint({
          con_name: match.labels["con_name"],
        }),
      );
      // The root cause names the tunnel it is about.
      expect(match.rootCause).toContain(
        `con_name = ${match.labels["con_name"]}`,
      );
    }

    expect(response.matchedCriteria).toHaveLength(1);
    expect(response.evaluatedCriteriaIds).toEqual(["down"]);
  });

  it("gives each tunnel a distinct fingerprint, so they dedupe and resolve independently", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "down",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: groupedResponse([
        tunnel("HQ-Branch1", 1),
        tunnel("Branch2", 1),
      ]),
    });

    const fingerprints: Array<string> = response.perSeriesMatches!.map(
      (match: PerSeriesCriteriaMatch) => {
        return match.fingerprint;
      },
    );

    expect(new Set(fingerprints).size).toBe(2);
    expect(fingerprints).not.toContain(
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    );
  });

  it("leaves out a tunnel below the threshold, so its open alert resolves", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "flapping",
          filters: [logCount(FilterType.GreaterThan, 3)],
        }),
      ],
      dataToProcess: groupedResponse([
        tunnel("HQ-Branch1", 5),
        tunnel("Branch2", 1),
      ]),
    });

    expect(conNamesOf(response.perSeriesMatches!)).toEqual(["HQ-Branch1"]);
    /*
     * The criteria was evaluated, so the resolve pass treats Branch2 -
     * absent from the matches - as recovered.
     */
    expect(response.evaluatedCriteriaIds).toEqual(["flapping"]);
  });

  it("stays in per-group mode when no group breaches", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "flapping",
          filters: [logCount(FilterType.GreaterThan, 3)],
        }),
      ],
      dataToProcess: groupedResponse([tunnel("HQ-Branch1", 1)]),
    });

    expect(response.criteriaMetId).toBeUndefined();
    // A defined (empty) list: per-group mode, nothing to raise.
    expect(response.matchedCriteria).toEqual([]);
    expect(response.evaluatedCriteriaIds).toEqual(["flapping"]);
    expect(summary.criteriaResults[0]!.met).toBe(false);
  });

  it("raises nothing when no log matched at all", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "down",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: groupedResponse([]),
    });

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.matchedCriteria).toEqual([]);
  });

  it("evaluates every criteria, so severity bands fire on different tunnels", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "critical",
          filters: [logCount(FilterType.GreaterThan, 10)],
        }),
        criteriaInstance({
          id: "warning",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: groupedResponse([
        tunnel("HQ-Branch1", 12),
        tunnel("Branch2", 1),
      ]),
    });

    // The monitor's single status belongs to the first match.
    expect(response.criteriaMetId).toBe("critical");
    expect(
      response.matchedCriteria!.map((m: { criteriaId: string }) => {
        return m.criteriaId;
      }),
    ).toEqual(["critical", "warning"]);
    expect(conNamesOf(response.matchedCriteria![0]!.perSeriesMatches)).toEqual([
      "HQ-Branch1",
    ]);
    // HQ-Branch1 is in both; MonitorResource de-escalates it downstream.
    expect(conNamesOf(response.matchedCriteria![1]!.perSeriesMatches)).toEqual([
      "Branch2",
      "HQ-Branch1",
    ]);
  });

  it("applies All per group: one tunnel must meet every filter itself", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "band",
          filterCondition: FilterCondition.All,
          filters: [
            logCount(FilterType.GreaterThan, 2),
            logCount(FilterType.LessThan, 10),
          ],
        }),
      ],
      dataToProcess: groupedResponse([
        tunnel("in-band", 5),
        tunnel("too-many", 20),
        tunnel("too-few", 1),
      ]),
    });

    expect(conNamesOf(response.perSeriesMatches!)).toEqual(["in-band"]);
  });

  it("applies Any per group", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "outside-band",
          filterCondition: FilterCondition.Any,
          filters: [
            logCount(FilterType.GreaterThan, 15),
            logCount(FilterType.LessThan, 2),
          ],
        }),
      ],
      dataToProcess: groupedResponse([
        tunnel("in-band", 5),
        tunnel("too-many", 20),
        tunnel("too-few", 1),
      ]),
    });

    expect(conNamesOf(response.perSeriesMatches!)).toEqual([
      "too-few",
      "too-many",
    ]);
  });

  it("does not fire for two tunnels that only breach together", async () => {
    // 3 + 3 > 5, but neither tunnel logged more than 5 on its own.
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "burst",
          filters: [logCount(FilterType.GreaterThan, 5)],
        }),
      ],
      dataToProcess: groupedResponse([
        tunnel("HQ-Branch1", 3),
        tunnel("Branch2", 3),
      ]),
    });

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.matchedCriteria).toEqual([]);
  });
});

describe("a grouped Logs monitor - logs missing the group attribute", () => {
  it("counts them as their own group, with an empty value", async () => {
    const { response } = await evaluate({
      criteriaInstances: [
        criteriaInstance({
          id: "down",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: groupedResponse([tunnel("HQ-Branch1", 2), tunnel("", 4)]),
    });

    const unnamed: PerSeriesCriteriaMatch | undefined =
      response.perSeriesMatches!.find((match: PerSeriesCriteriaMatch) => {
        return match.labels["con_name"] === "";
      });

    expect(unnamed).toBeDefined();
    expect(unnamed!.fingerprint).toBe(
      MetricSeriesFingerprint.computeFingerprint({ con_name: "" }),
    );
    // Its own group - never the whole-monitor series.
    expect(unnamed!.fingerprint).not.toBe(
      MetricSeriesFingerprint.WholeMonitorFingerprint,
    );
    expect(unnamed!.rootCause).toContain("con_name = (not set)");
  });
});

describe("a grouped Logs monitor - several group-by attributes", () => {
  it("is one group per combination, whatever order the keys are in", async () => {
    const { response } = await evaluate({
      groupByAttributes: ["con_name", "gw_name"],
      criteriaInstances: [
        criteriaInstance({
          id: "down",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: groupedResponse([
        group({ con_name: "HQ-Branch1", gw_name: "WAN1" }, 1),
        group({ con_name: "HQ-Branch1", gw_name: "WAN2" }, 1),
      ]),
    });

    expect(response.perSeriesMatches).toHaveLength(2);
    expect(response.perSeriesMatches![0]!.fingerprint).toBe(
      MetricSeriesFingerprint.computeFingerprint({
        gw_name: "WAN1",
        con_name: "HQ-Branch1",
      }),
    );
    expect(response.perSeriesMatches![0]!.rootCause).toContain(
      "con_name = HQ-Branch1, gw_name = WAN1",
    );
  });
});

describe("a grouped Logs monitor - the per-evaluation group cap", () => {
  it(`fans out to at most ${MaxEntitiesPerCriteria} groups and says so`, async () => {
    const warnSpy: jest.SpiedFunction<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});

    try {
      const groups: Array<LogMonitorGroupResult> = Array.from(
        { length: MaxEntitiesPerCriteria + 20 },
        (_: unknown, index: number) => {
          return tunnel(`tunnel-${index}`, 1);
        },
      );

      const { response } = await evaluate({
        criteriaInstances: [
          criteriaInstance({
            id: "down",
            filters: [logCount(FilterType.GreaterThan, 0)],
          }),
        ],
        dataToProcess: groupedResponse(groups),
      });

      expect(response.perSeriesMatches).toHaveLength(MaxEntitiesPerCriteria);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`${MaxEntitiesPerCriteria} per-criteria cap`),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("an ungrouped Logs monitor is unchanged", () => {
  it("raises one whole-monitor match from the single count", async () => {
    const { response } = await evaluate({
      groupByAttributes: undefined,
      criteriaInstances: [
        criteriaInstance({
          id: "down",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
        criteriaInstance({
          id: "never-reached",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: {
        projectId: ObjectID.generate(),
        monitorId: MONITOR_ID,
        logCount: 3,
        logQuery: {},
      },
    });

    expect(response.criteriaMetId).toBe("down");
    // The legacy single-alert shape: no per-series fields at all.
    expect(response.perSeriesMatches).toBeUndefined();
    expect(response.matchedCriteria).toBeUndefined();
    expect(response.evaluatedCriteriaIds).toBeUndefined();
  });

  it("treats an empty group-by list as ungrouped", async () => {
    const { response } = await evaluate({
      groupByAttributes: [],
      criteriaInstances: [
        criteriaInstance({
          id: "down",
          filters: [logCount(FilterType.GreaterThan, 0)],
        }),
      ],
      dataToProcess: {
        projectId: ObjectID.generate(),
        monitorId: MONITOR_ID,
        logCount: 3,
        logQuery: {},
      },
    });

    expect(response.criteriaMetId).toBe("down");
    expect(response.perSeriesMatches).toBeUndefined();
  });
});

describe("LogGroupCriteriaFanOut.getGroupEntities", () => {
  it("builds one entity per group, each judged on its own count", () => {
    const response: LogMonitorResponse = groupedResponse([
      tunnel("HQ-Branch1", 2),
      tunnel("Branch2", 7),
    ]);

    const entities: Array<{
      labels: JSONObject;
      dataToProcess?: DataToProcess | undefined;
    }> = LogGroupCriteriaFanOut.getGroupEntities({
      dataToProcess: response as DataToProcess,
    });

    expect(
      entities.map((entity: { labels: JSONObject }) => {
        return entity.labels;
      }),
    ).toEqual([{ con_name: "HQ-Branch1" }, { con_name: "Branch2" }]);

    expect((entities[1]!.dataToProcess as LogMonitorResponse).logCount).toBe(7);
    expect(
      (entities[1]!.dataToProcess as LogMonitorResponse).evaluatedGroup?.labels,
    ).toEqual({ con_name: "Branch2" });
  });

  it("has no entities for an ungrouped response", () => {
    expect(
      LogGroupCriteriaFanOut.getGroupEntities({
        dataToProcess: {
          projectId: ObjectID.generate(),
          monitorId: MONITOR_ID,
          logCount: 3,
          logQuery: {},
        } as DataToProcess,
      }),
    ).toEqual([]);
  });
});
