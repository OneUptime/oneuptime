/*
 * The criteria evaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { GROUPING_NOTE_TITLES } from "../../../../Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import ReceivingSilence from "../../../../Server/Utils/Monitor/ReceivingSilence";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import IncidentGroupingConfig from "../../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * What the criteria evaluator tells MonitorResource about an Incoming Request
 * monitor's matching criteria - the contract the incident and alert creators
 * read:
 *
 *   - perSeriesMatches undefined: act once for the whole monitor, deduped on
 *     the criteria;
 *   - an array: act once per value, exactly these; an empty one opens
 *     nothing new.
 *
 * It used to publish an array for every criteria of a monitor with one
 * grouped criteria, so a criteria without grouping - which never has values
 * - handed the creators an empty one, and they opened nothing. The decision
 * is now the matching criteria's own.
 */

const GROUPED_ID: string = "1d8b2c3e-0001-4a00-8000-000000000001";
const PLAIN_ID: string = "1d8b2c3e-0002-4a00-8000-000000000002";
const SECOND_GROUPED_ID: string = "1d8b2c3e-0003-4a00-8000-000000000003";

const GROUPING: IncidentGroupingConfig = {
  groupByJSONPath: "requestBody.alerts[*].labels.alertname",
  resolvedWhenJSONPath: "requestBody.alerts[*].status",
  resolvedWhenValue: "resolved",
};

function bodyFilter(filterType: FilterType, value: string): CriteriaFilter {
  return { checkOn: CheckOn.RequestBody, filterType, value };
}

function criteria(input: {
  id: string;
  name: string;
  filters: Array<CriteriaFilter>;
  grouping?: IncidentGroupingConfig | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: input.id,
    name: input.name,
    description: "",
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: input.filters,
    incidents: [],
    alerts: [],
    changeMonitorStatus: false,
    createIncidents: false,
    createAlerts: true,
    isEnabled: true,
    ...(input.grouping ? { incidentGrouping: input.grouping } : {}),
  } as unknown as MonitorCriteriaInstance["data"];

  return instance;
}

// "Firing": the body says firing, grouped per alert.
function grouped(): MonitorCriteriaInstance {
  return criteria({
    id: GROUPED_ID,
    name: "Firing",
    filters: [bodyFilter(FilterType.Contains, "firing")],
    grouping: GROUPING,
  });
}

// "Other": anything that does not say firing, not grouped.
function plain(): MonitorCriteriaInstance {
  return criteria({
    id: PLAIN_ID,
    name: "Other",
    filters: [bodyFilter(FilterType.NotContains, "firing")],
  });
}

function evaluate(input: {
  criteriaInstances: Array<MonitorCriteriaInstance>;
  body: JSONObject | string | undefined;
  onlyCheckForIncomingRequestReceivedAt?: boolean | undefined;
}): Promise<{
  response: ProbeApiIngestResponse;
  summary: MonitorEvaluationSummary;
}> {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: input.criteriaInstances,
  };

  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data!.monitorCriteria = monitorCriteria;

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.IncomingRequest;

  const request: IncomingMonitorRequest = {
    projectId: monitor.projectId,
    monitorId: monitor.id,
    requestBody: input.body,
    incomingRequestReceivedAt: new Date("2026-10-20T09:00:00.000Z"),
    checkedAt: new Date("2026-10-20T09:00:00.000Z"),
    onlyCheckForIncomingRequestReceivedAt: Boolean(
      input.onlyCheckForIncomingRequestReceivedAt,
    ),
  };

  const summary: MonitorEvaluationSummary = {
    evaluatedAt: new Date("2026-10-20T09:00:00.000Z"),
    criteriaResults: [],
    events: [],
  };

  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: request,
    monitorStep: monitorStep,
    monitor: monitor,
    probeApiIngestResponse: {
      monitorId: monitor.id,
      criteriaMetId: undefined,
      rootCause: null,
    },
    evaluationSummary: summary,
  }).then((response: ProbeApiIngestResponse) => {
    return { response, summary };
  });
}

function groupingEvents(
  summary: MonitorEvaluationSummary,
): Array<MonitorEvaluationEvent> {
  return summary.events.filter((event: MonitorEvaluationEvent): boolean => {
    return event.type === "grouping";
  });
}

function firingNotification(names: Array<string>): JSONObject {
  return {
    status: "firing",
    alerts: names.map((name: string) => {
      return { status: "firing", labels: { alertname: name } };
    }),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a criteria without grouping on a monitor that has a grouped one", () => {
  it("acts once for the whole monitor: no per-value list at all", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: { test: "test" },
    });

    expect(response.criteriaMetId).toBe(PLAIN_ID);
    expect(response.perSeriesMatches).toBeUndefined();
    expect(response.rootCause).toContain("**Criteria Name**: Other");
    expect(response.rootCause).not.toContain("**Grouping**");
    expect(groupingEvents(summary)).toEqual([]);
  });

  it("whichever order the criteria are in", async () => {
    const { response } = await evaluate({
      criteriaInstances: [plain(), grouped()],
      body: { test: "test" },
    });

    expect(response.criteriaMetId).toBe(PLAIN_ID);
    expect(response.perSeriesMatches).toBeUndefined();
  });

  it("even when the request carries the other criteria's field", async () => {
    const { response } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: { alerts: [{ status: "ok", labels: { alertname: "HighCPU" } }] },
    });

    expect(response.criteriaMetId).toBe(PLAIN_ID);
    expect(response.perSeriesMatches).toBeUndefined();
  });

  it("is never fanned out across criteria: the first match still decides", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [plain(), grouped()],
      body: { test: "test" },
    });

    expect(response.matchedCriteria).toBeUndefined();
    expect(response.evaluatedCriteriaIds).toBeUndefined();

    const firing: MonitorEvaluationCriteriaResult | undefined =
      summary.criteriaResults.find(
        (result: MonitorEvaluationCriteriaResult): boolean => {
          return result.criteriaId === GROUPED_ID;
        },
      );

    expect(firing?.skipped).toBe(true);
    expect(firing?.skipCause).toBe("earlier-criterion-matched");
  });
});

describe("a grouped criteria that matches", () => {
  it("publishes one match per firing value, and says nothing more", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: firingNotification(["HighCPU", "HighRAM"]),
    });

    expect(response.criteriaMetId).toBe(GROUPED_ID);
    expect(
      response.perSeriesMatches!.map((match: { labels: JSONObject }) => {
        return match.labels;
      }),
    ).toEqual([{ alertname: "HighCPU" }, { alertname: "HighRAM" }]);
    expect(
      response.perSeriesMatches!.every((match: { criteriaMetId: string }) => {
        return match.criteriaMetId === GROUPED_ID;
      }),
    ).toBe(true);
    expect(response.rootCause).not.toContain("**Grouping**");
    expect(groupingEvents(summary)).toEqual([]);
  });

  it("publishes an empty list when every value recovered: nothing new opens", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: {
        status: "firing",
        alerts: [{ status: "resolved", labels: { alertname: "HighCPU" } }],
      },
    });

    expect(response.criteriaMetId).toBe(GROUPED_ID);
    expect(response.perSeriesMatches).toEqual([]);

    const events: Array<MonitorEvaluationEvent> = groupingEvents(summary);

    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe(GROUPING_NOTE_TITLES.nothingNew);
    expect(events[0]!.relatedCriteriaId).toBe(GROUPED_ID);
  });

  it("publishes no list when the request has no value: it acts for the whole monitor", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: { status: "firing", message: "a payload of another shape" },
    });

    expect(response.criteriaMetId).toBe(GROUPED_ID);
    expect(response.perSeriesMatches).toBeUndefined();

    const events: Array<MonitorEvaluationEvent> = groupingEvents(summary);

    expect(
      events.map((event: MonitorEvaluationEvent) => {
        return event.title;
      }),
    ).toEqual([GROUPING_NOTE_TITLES.noValue]);
    expect(events[0]!.message).toBe(
      'This request has no value at requestBody.alerts[*].labels.alertname. Criteria "Firing" handles it for the whole monitor, as it would without grouping.',
    );
  });

  it("says why in the root cause, after the filters it met", async () => {
    const { response } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: { status: "firing" },
    });

    const rootCause: string = response.rootCause || "";
    const filters: number = rootCause.indexOf("**Filter Conditions Met**");
    const grouping: number = rootCause.indexOf(
      "**Grouping**: The request had no value at `requestBody.alerts[*].labels.alertname`, so it counts for the whole monitor rather than for one value.",
    );

    expect(filters).toBeGreaterThan(-1);
    expect(grouping).toBeGreaterThan(filters);
  });

  it("logs the grouping note after the criteria's own verdict", async () => {
    const { summary } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: { status: "firing" },
    });

    expect(
      summary.events.map((event: MonitorEvaluationEvent): string => {
        return event.type;
      }),
    ).toEqual(["criteria-met", "grouping"]);
  });

  it("two grouped criteria: the one that matches groups by its own path", async () => {
    const byTeam: MonitorCriteriaInstance = criteria({
      id: SECOND_GROUPED_ID,
      name: "Team",
      filters: [bodyFilter(FilterType.Contains, "team")],
      grouping: { groupByJSONPath: "requestBody.team" },
    });

    const { response } = await evaluate({
      criteriaInstances: [grouped(), byTeam],
      body: { team: "payments" },
    });

    expect(response.criteriaMetId).toBe(SECOND_GROUPED_ID);
    expect(
      response.perSeriesMatches!.map((match: { labels: JSONObject }) => {
        return match.labels;
      }),
    ).toEqual([{ team: "payments" }]);
  });

  it("no criteria matches: nothing is published", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [grouped()],
      body: { test: "test" },
    });

    expect(response.criteriaMetId).toBeUndefined();
    expect(response.perSeriesMatches).toBeUndefined();
    expect(groupingEvents(summary)).toEqual([]);
  });
});

describe("on the background check", () => {
  function silence(
    grouping: IncidentGroupingConfig | undefined,
  ): MonitorCriteriaInstance {
    return criteria({
      id: SECOND_GROUPED_ID,
      name: "Silent",
      filters: [
        {
          checkOn: CheckOn.IncomingRequest,
          filterType: FilterType.NotRecievedInMinutes,
          value: 10,
        },
      ],
      grouping: grouping,
    });
  }

  it("a grouped criteria that matched because requests stopped arriving acts for the whole monitor", async () => {
    jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
      wallMinutes: 30,
      receivingMinutes: 30,
      notReceivingMinutes: 0,
    });

    const { response, summary } = await evaluate({
      criteriaInstances: [silence(GROUPING), plain()],
      body: firingNotification(["HighCPU"]),
      onlyCheckForIncomingRequestReceivedAt: true,
    });

    expect(response.criteriaMetId).toBe(SECOND_GROUPED_ID);
    expect(response.perSeriesMatches).toBeUndefined();
    expect(response.rootCause).toContain(
      "**Grouping**: Requests stopped arriving, so there was no value to group by.",
    );
    expect(
      groupingEvents(summary).map((event: MonitorEvaluationEvent) => {
        return event.title;
      }),
    ).toEqual([GROUPING_NOTE_TITLES.noRequest]);
  });

  it("a grouped criteria that re-read the last request opens nothing new", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: firingNotification(["HighCPU"]),
      onlyCheckForIncomingRequestReceivedAt: true,
    });

    expect(response.criteriaMetId).toBe(GROUPED_ID);
    expect(response.perSeriesMatches).toEqual([]);
    expect(
      groupingEvents(summary).map((event: MonitorEvaluationEvent) => {
        return event.title;
      }),
    ).toEqual([GROUPING_NOTE_TITLES.nothingNew]);
  });

  it("a criteria without grouping acts for the whole monitor, as before", async () => {
    const { response, summary } = await evaluate({
      criteriaInstances: [grouped(), plain()],
      body: { test: "test" },
      onlyCheckForIncomingRequestReceivedAt: true,
    });

    expect(response.criteriaMetId).toBe(PLAIN_ID);
    expect(response.perSeriesMatches).toBeUndefined();
    expect(groupingEvents(summary)).toEqual([]);
  });
});
