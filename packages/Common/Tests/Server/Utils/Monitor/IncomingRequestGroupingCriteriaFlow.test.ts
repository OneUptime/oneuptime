/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import IncomingRequestIncidentGrouping from "../../../../Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import ReceivingSilence from "../../../../Server/Utils/Monitor/ReceivingSilence";
import SeriesResourceLinker from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import OneUptimeDate from "../../../../Types/Date";
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
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  mockProjectStates,
} from "../../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A customer's report, end to end: "When 'Group incidents and alerts by a
 * payload field' is enabled for one criteria of a monitor, it prevents other
 * criteria from creating alerts or incidents if the configured grouping
 * field is missing from the incoming payload."
 *
 * Their monitor: criteria 1 matches a request body that contains `x` and
 * groups by requestBody.groupLabels.alertname; criteria 2 matches a body
 * that does not contain `x` and does not group. Both create alerts. A POST
 * of {"test": "test"} matched criteria 2, and no alert opened.
 *
 * What was really wrong: grouping was read for the whole monitor. One
 * grouped criteria put every criteria of the monitor in "one per value"
 * mode, so a criteria without grouping, which never has values, opened
 * nothing at all - whatever the request held. And a grouped criteria that
 * matched a request without its field opened nothing either.
 *
 * What holds now, each on the path every incoming request takes
 * (MonitorResourceUtil.monitorResource, with the real criteria evaluator and
 * the real incident and alert creators): grouping belongs to the criteria
 * that has it. A criteria without grouping opens its incident and alert as
 * it would on a monitor with no grouping at all. A grouped criteria opens one
 * per value it finds; with no value to group by it opens one for the whole
 * monitor rather than none; a request whose values all recovered opens
 * nothing new; and the monitor log says which.
 *
 * The incident and alert tables are in memory: they open, resolve and find
 * records the way the database does, so what one request opens is what the
 * next request's evaluation sees.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0f0a1b2c-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0f0a1b2c-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "0f0a1b2c-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "0f0a1b2c-4444-4444-8444-444444444444",
);
const DEGRADED_STATUS_ID: ObjectID = new ObjectID(
  "0f0a1b2c-5555-4555-8555-555555555555",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "0f0a1b2c-6666-4666-8666-666666666666",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "0f0a1b2c-7777-4777-8777-777777777777",
);

// Criteria ids, and the ids of the incident and alert each one declares.
const CONTAINS_X_ID: string = "6c1e1d6a-0001-4c00-8000-000000000001";
const WITHOUT_X_ID: string = "6c1e1d6a-0002-4c00-8000-000000000002";
const FIRING_ID: string = "6c1e1d6a-0003-4c00-8000-000000000003";
const WARNING_ID: string = "6c1e1d6a-0004-4c00-8000-000000000004";
const ALL_CLEAR_ID: string = "6c1e1d6a-0005-4c00-8000-000000000005";
const SILENCE_ID: string = "6c1e1d6a-0006-4c00-8000-000000000006";
const TEAM_ID: string = "6c1e1d6a-0007-4c00-8000-000000000007";

const START: Date = new Date("2026-10-20T09:00:00.000Z");

// What the monitor opened, open or not.
let incidents: Array<Incident> = [];
let alerts: Array<Alert> = [];
let nextIncidentNumber: number = 1;
let nextAlertNumber: number = 1;
// The criteria that set the monitor's status, in order.
let statusSetBy: Array<string> = [];
let lastRequest: IncomingMonitorRequest | null = null;

function parameterOf(operator: unknown): unknown {
  return Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  )[0];
}

function isIn(operator: unknown, value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return (parameterOf(operator) as Array<string>).includes(value);
}

// The open records a findBy reads: the creators ask for the open ones only.
function readOpen<T extends Incident | Alert>(
  table: Array<T>,
  stateColumn: "currentIncidentStateId" | "currentAlertStateId",
  query: JSONObject,
): Array<T> {
  return table.filter((record: T): boolean => {
    const state: unknown = query[stateColumn];
    const recordState: ObjectID | undefined = (
      record as unknown as Record<string, ObjectID | undefined>
    )[stateColumn];

    return state === undefined || isIn(state, recordState?.toString());
  });
}

function isOpenIncident(incident: Incident): boolean {
  return (
    incident.currentIncidentStateId?.toString() !==
    INCIDENT_STATE_IDS.resolved.toString()
  );
}

function isOpenAlert(alert: Alert): boolean {
  return (
    alert.currentAlertStateId?.toString() !==
    ALERT_STATE_IDS.resolved.toString()
  );
}

function openIncidentTitles(): Array<string> {
  return incidents.filter(isOpenIncident).map((incident: Incident): string => {
    return incident.title || "";
  });
}

function openAlertTitles(): Array<string> {
  return alerts.filter(isOpenAlert).map((alert: Alert): string => {
    return alert.title || "";
  });
}

function alertTitles(): Array<string> {
  return alerts.map((alert: Alert): string => {
    return alert.title || "";
  });
}

function bodyFilter(filterType: FilterType, value: string): CriteriaFilter {
  return { checkOn: CheckOn.RequestBody, filterType, value };
}

interface CriteriaOptions {
  id: string;
  name: string;
  statusId: ObjectID;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition | undefined;
  grouping?: IncidentGroupingConfig | undefined;
  // The incident the criteria declares, if any.
  incident?: { title: string; autoResolve: boolean } | undefined;
  // The alert the criteria raises, if any.
  alert?: { title: string; autoResolve: boolean } | undefined;
}

function criteria(options: CriteriaOptions): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: options.id,
    name: options.name,
    description: "",
    monitorStatusId: options.statusId,
    filterCondition: options.filterCondition || FilterCondition.All,
    filters: options.filters,
    incidents: options.incident
      ? [
          {
            id: `${options.id.slice(0, -4)}1111`,
            title: options.incident.title,
            description: "{{requestBody.message}}",
            incidentSeverityId: INCIDENT_SEVERITY_ID,
            autoResolveIncident: options.incident.autoResolve,
          },
        ]
      : [],
    alerts: options.alert
      ? [
          {
            id: `${options.id.slice(0, -4)}2222`,
            title: options.alert.title,
            description: "{{requestBody.message}}",
            alertSeverityId: ALERT_SEVERITY_ID,
            autoResolveAlert: options.alert.autoResolve,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: true,
    createIncidents: Boolean(options.incident),
    createAlerts: Boolean(options.alert),
    isEnabled: true,
    ...(options.grouping ? { incidentGrouping: options.grouping } : {}),
  };

  return instance;
}

// The customer's grouping, as they wrote it.
const CUSTOMER_GROUPING: IncidentGroupingConfig = {
  groupByJSONPath: "requestBody.groupLabels.alertname",
  resolvedWhenJSONPath: "requestBody.alerts[*].status",
  resolvedWhenValue: "resolved",
};

// Criteria 1: the body contains x, grouped by a payload field.
function containsX(
  options: {
    grouping?: IncidentGroupingConfig | undefined;
    incident?: boolean | undefined;
  } = {},
): MonitorCriteriaInstance {
  return criteria({
    id: CONTAINS_X_ID,
    name: "Contains x",
    statusId: OFFLINE_STATUS_ID,
    filters: [bodyFilter(FilterType.Contains, "x")],
    grouping: options.grouping || CUSTOMER_GROUPING,
    alert: { title: "Alert: {{alertname}}", autoResolve: true },
    incident: options.incident
      ? { title: "Incident: {{alertname}}", autoResolve: true }
      : undefined,
  });
}

// Criteria 2: the body does not contain x, not grouped.
function withoutX(
  options: { incident?: boolean | undefined; autoResolve?: boolean } = {},
): MonitorCriteriaInstance {
  return criteria({
    id: WITHOUT_X_ID,
    name: "Does not contain x",
    statusId: DEGRADED_STATUS_ID,
    filters: [bodyFilter(FilterType.NotContains, "x")],
    alert: {
      title: "A request without x",
      autoResolve: options.autoResolve !== false,
    },
    incident: options.incident
      ? {
          title: "An incident for a request without x",
          autoResolve: options.autoResolve !== false,
        }
      : undefined,
  });
}

/*
 * A Grafana-style monitor, as the Grafana guide sets it up: a firing
 * notification opens one incident and alert per alert, and a resolved one
 * brings the monitor back online.
 */
const PER_ALERT_GROUPING: IncidentGroupingConfig = {
  groupByJSONPath: "requestBody.alerts[*].labels.alertname",
  resolvedWhenJSONPath: "requestBody.alerts[*].status",
  resolvedWhenValue: "resolved",
};

function firing(
  grouping: IncidentGroupingConfig = PER_ALERT_GROUPING,
): MonitorCriteriaInstance {
  return criteria({
    id: FIRING_ID,
    name: "Firing",
    statusId: OFFLINE_STATUS_ID,
    filters: [bodyFilter(FilterType.Contains, '"status":"firing"')],
    grouping: grouping,
    incident: { title: "{{alertname}}", autoResolve: true },
    alert: { title: "{{alertname}}", autoResolve: true },
  });
}

function warning(): MonitorCriteriaInstance {
  return criteria({
    id: WARNING_ID,
    name: "Warning",
    statusId: DEGRADED_STATUS_ID,
    filters: [bodyFilter(FilterType.Contains, '"severity":"warning"')],
    alert: { title: "Warning: {{requestBody.summary}}", autoResolve: true },
  });
}

function allClear(): MonitorCriteriaInstance {
  return criteria({
    id: ALL_CLEAR_ID,
    name: "All clear",
    statusId: ONLINE_STATUS_ID,
    filters: [bodyFilter(FilterType.Contains, '"status":"resolved"')],
  });
}

function monitorWith(criteriaInstances: Array<MonitorCriteriaInstance>): Monitor {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: criteriaInstances,
  };
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "Webhooks";
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.monitorSteps = monitorSteps;
  // Already at its default status: the status itself is mocked below.
  monitor.currentMonitorStatusId = ONLINE_STATUS_ID;
  return monitor;
}

let monitorUnderTest: Monitor = monitorWith([]);

// A request as the ingest worker hands it over (ProcessIncomingRequestIngest).
function request(body: JSONObject | string | undefined): IncomingMonitorRequest {
  const now: Date = OneUptimeDate.getCurrentDate();

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestBody: body,
    requestHeaders: { "content-type": "application/json" },
    incomingRequestReceivedAt: now,
    checkedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
  };
}

async function send(
  body: JSONObject | string | undefined,
): Promise<MonitorEvaluationSummary> {
  // A minute between requests, as they arrive.
  jest.setSystemTime(
    OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 1),
  );

  lastRequest = request(body);

  const response: ProbeApiIngestResponse =
    await MonitorResourceUtil.monitorResource(lastRequest);

  return response.evaluationSummary!;
}

/*
 * The background check (IncomingRequestMonitor:CheckHeartbeat): every 30
 * seconds it re-reads the last request with
 * onlyCheckForIncomingRequestReceivedAt set, for monitors with an Incoming
 * Request criteria.
 */
async function backgroundCheck(
  silentMinutes: number,
): Promise<MonitorEvaluationSummary> {
  jest.setSystemTime(
    OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 1),
  );

  jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
    wallMinutes: silentMinutes,
    receivingMinutes: silentMinutes,
    notReceivingMinutes: 0,
  });

  const response: ProbeApiIngestResponse =
    await MonitorResourceUtil.monitorResource({
      ...(lastRequest || request(undefined)),
      onlyCheckForIncomingRequestReceivedAt: true,
      checkedAt: OneUptimeDate.getCurrentDate(),
    });

  return response.evaluationSummary!;
}

// What the monitor log lists under Actions, as "type: title".
function actions(summary: MonitorEvaluationSummary): Array<string> {
  return summary.events
    .filter((event: MonitorEvaluationEvent): boolean => {
      return event.type !== "criteria-met" && event.type !== "criteria-not-met";
    })
    .map((event: MonitorEvaluationEvent): string => {
      return `${event.type}: ${event.title}`;
    });
}

function groupingNotes(
  summary: MonitorEvaluationSummary,
): Array<MonitorEvaluationEvent> {
  return summary.events.filter((event: MonitorEvaluationEvent): boolean => {
    return event.type === "grouping";
  });
}

// The criteria that matched, in the monitor log.
function metCriteria(summary: MonitorEvaluationSummary): Array<string> {
  return summary.criteriaResults
    .filter((result: { met: boolean }): boolean => {
      return result.met;
    })
    .map((result: { criteriaName?: string | undefined }): string => {
      return result.criteriaName || "";
    });
}

// A Grafana-style notification. Every alert has its own status.
function notification(
  rootStatus: string,
  alertsByName: Array<[string, string]>,
): JSONObject {
  return {
    status: rootStatus,
    message: `Alerts: ${alertsByName.length}`,
    alerts: alertsByName.map(([name, status]: [string, string]) => {
      return { status: status, labels: { alertname: name } };
    }),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START);

  incidents = [];
  alerts = [];
  nextIncidentNumber = 1;
  nextAlertNumber = 1;
  statusSetBy = [];
  lastRequest = null;

  mockProjectStates();

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
    return monitorUnderTest;
  }) as never);
  jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
  jest
    .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
    .mockImplementation((async (input: {
      criteriaInstance: MonitorCriteriaInstance;
    }) => {
      statusSetBy.push(input.criteriaInstance.data?.name || "");
      return null;
    }) as never);
  jest
    .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
    .mockResolvedValue({
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    } as never);
  jest
    .spyOn(MonitorDependencySuppression, "getDependencySuppression")
    .mockResolvedValue({ isSuppressed: false } as never);
  jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(SeriesResourceLinker, "linkSeriesResourcesToModel")
    .mockResolvedValue(undefined);
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

  // A request that just arrived ends any silence.
  jest.spyOn(ReceivingSilence, "measure").mockResolvedValue({
    wallMinutes: 0,
    receivingMinutes: 0,
    notReceivingMinutes: 0,
  });

  // Each criteria's severity belongs to the monitor's project.
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentSeverity> => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = INCIDENT_SEVERITY_ID.toString();
      severity.projectId = PROJECT_ID;
      return severity;
    }) as never);
  jest
    .spyOn(AlertSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<AlertSeverity> => {
      const severity: AlertSeverity = new AlertSeverity();
      severity._id = ALERT_SEVERITY_ID.toString();
      severity.projectId = PROJECT_ID;
      return severity;
    }) as never);

  // The incident table.
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Incident>> => {
    return readOpen(incidents, "currentIncidentStateId", findBy.query);
  }) as never);
  jest.spyOn(IncidentService, "countBy").mockImplementation((async (countBy: {
    query: JSONObject;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(
      readOpen(incidents, "currentIncidentStateId", countBy.query).length,
    );
  }) as never);
  jest.spyOn(IncidentService, "create").mockImplementation((async (createBy: {
    data: Incident;
  }): Promise<Incident> => {
    const incident: Incident = createBy.data;
    incident.id = ObjectID.generate();
    incident.incidentNumber = nextIncidentNumber++;
    incident.createdAt = OneUptimeDate.getCurrentDate();
    incident.currentIncidentStateId = INCIDENT_STATE_IDS.created;
    incidents.push(incident);
    return incident;
  }) as never);
  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(INCIDENT_STATE_IDS.resolved);
  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentStateTimeline;
    }): Promise<IncidentStateTimeline> => {
      const incident: Incident | undefined = incidents.find(
        (candidate: Incident): boolean => {
          return (
            candidate.id!.toString() === createBy.data.incidentId!.toString()
          );
        },
      );

      incident!.currentIncidentStateId = createBy.data.incidentStateId!;
      return createBy.data;
    }) as never);

  // The alert table.
  jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Alert>> => {
    return readOpen(alerts, "currentAlertStateId", findBy.query);
  }) as never);
  jest.spyOn(AlertService, "countBy").mockImplementation((async (countBy: {
    query: JSONObject;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(
      readOpen(alerts, "currentAlertStateId", countBy.query).length,
    );
  }) as never);
  jest.spyOn(AlertService, "create").mockImplementation((async (createBy: {
    data: Alert;
  }): Promise<Alert> => {
    const alert: Alert = createBy.data;
    alert.id = ObjectID.generate();
    alert.alertNumber = nextAlertNumber++;
    alert.createdAt = OneUptimeDate.getCurrentDate();
    alert.currentAlertStateId = ALERT_STATE_IDS.created;
    alerts.push(alert);
    return alert;
  }) as never);
  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(ALERT_STATE_IDS.resolved);
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((async (createBy: {
      data: AlertStateTimeline;
    }): Promise<AlertStateTimeline> => {
      const alert: Alert | undefined = alerts.find(
        (candidate: Alert): boolean => {
          return candidate.id!.toString() === createBy.data.alertId!.toString();
        },
      );

      alert!.currentAlertStateId = createBy.data.alertStateId!;
      return createBy.data;
    }) as never);

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("The customer's monitor: criteria 1 groups, criteria 2 does not", () => {
  beforeEach(() => {
    monitorUnderTest = monitorWith([containsX(), withoutX()]);
  });

  it('a POST of {"test": "test"} matches criteria 2, and criteria 2 opens its alert', async () => {
    const summary: MonitorEvaluationSummary = await send({ test: "test" });

    expect(metCriteria(summary)).toEqual(["Does not contain x"]);
    expect(statusSetBy).toEqual(["Does not contain x"]);
    expect(alertTitles()).toEqual(["A request without x"]);
    expect(actions(summary)).toEqual([
      "alert-created: Alert created: A request without x",
    ]);

    // Opened for the whole monitor, as a criteria without grouping opens it.
    expect(alerts[0]!.seriesFingerprint).toBeUndefined();
    expect(alerts[0]!.seriesLabels).toBeUndefined();
    expect(alerts[0]!.createdCriteriaId).toBe(WITHOUT_X_ID);
    // Criteria 1's grouping has nothing to say about criteria 2.
    expect(groupingNotes(summary)).toEqual([]);
  });

  it("criteria 2 declares its incident too, when it has one", async () => {
    monitorUnderTest = monitorWith([
      containsX({ incident: true }),
      withoutX({ incident: true }),
    ]);

    await send({ test: "test" });

    expect(openIncidentTitles()).toEqual([
      "An incident for a request without x",
    ]);
    expect(openAlertTitles()).toEqual(["A request without x"]);
    expect(incidents[0]!.seriesFingerprint).toBeUndefined();
  });

  it("opens one at a time: a second request without x while the alert is open opens nothing new", async () => {
    await send({ test: "test" });
    const second: MonitorEvaluationSummary = await send({ test: "again" });

    expect(alertTitles()).toEqual(["A request without x"]);
    expect(actions(second)).toEqual([
      "alert-skipped: Alert already active: A request without x",
    ]);
  });

  it("whether or not the request carries criteria 1's grouping field", async () => {
    // The field is there, but the body has no x: criteria 2 still matches.
    await send({ groupLabels: { alertname: "HighCPU" }, test: "test" });

    expect(alertTitles()).toEqual(["A request without x"]);
    expect(alerts[0]!.seriesFingerprint).toBeUndefined();
  });

  it("a request with x and the field opens criteria 1's alert for that value", async () => {
    const summary: MonitorEvaluationSummary = await send({
      kind: "x",
      groupLabels: { alertname: "HighCPU" },
      alerts: [{ status: "firing" }],
    });

    expect(metCriteria(summary)).toEqual(["Contains x"]);
    expect(alertTitles()).toEqual(["Alert: HighCPU"]);
    expect(alerts[0]!.seriesFingerprint).toBeDefined();
    expect(alerts[0]!.seriesLabels).toEqual({ alertname: "HighCPU" });
    expect(groupingNotes(summary)).toEqual([]);
  });

  it("each value opens its own alert, and a request without x opens criteria 2's beside them", async () => {
    await send({ kind: "x", groupLabels: { alertname: "HighCPU" } });
    await send({ kind: "x", groupLabels: { alertname: "HighRAM" } });
    await send({ test: "test" });

    expect(openAlertTitles()).toEqual([
      "Alert: HighCPU",
      "Alert: HighRAM",
      "A request without x",
    ]);
  });

  it("criteria 1's alerts keep their values: requests criteria 2 matches leave them open", async () => {
    await send({ kind: "x", groupLabels: { alertname: "HighCPU" } });
    await send({ test: "test" });
    await send({ test: "test again" });

    const grouped: Alert | undefined = alerts.find((alert: Alert) => {
      return alert.title === "Alert: HighCPU";
    });

    expect(isOpenAlert(grouped!)).toBe(true);
    // And the next request for that value finds it, rather than opening another.
    const again: MonitorEvaluationSummary = await send({
      kind: "x",
      groupLabels: { alertname: "HighCPU" },
    });

    expect(actions(again)).toContain(
      "alert-skipped: Alert already active: Alert: HighCPU",
    );
    expect(
      alerts.filter((alert: Alert): boolean => {
        return alert.title === "Alert: HighCPU";
      }),
    ).toHaveLength(1);
  });

  it("criteria 2's alert is resolved when a later request matches criteria 1, with Auto Resolve on", async () => {
    await send({ test: "test" });
    await send({ kind: "x", groupLabels: { alertname: "HighCPU" } });

    expect(openAlertTitles()).toEqual(["Alert: HighCPU"]);
  });

  it("...and stays open without Auto Resolve", async () => {
    monitorUnderTest = monitorWith([
      containsX(),
      withoutX({ autoResolve: false }),
    ]);

    await send({ test: "test" });
    await send({ kind: "x", groupLabels: { alertname: "HighCPU" } });

    expect(openAlertTitles()).toEqual(["A request without x", "Alert: HighCPU"]);
  });
});

describe("A grouped criteria that matches a request without its field", () => {
  beforeEach(() => {
    monitorUnderTest = monitorWith([containsX({ incident: true }), withoutX()]);
  });

  it("opens one incident and one alert for the whole monitor, and the monitor log says why", async () => {
    const summary: MonitorEvaluationSummary = await send({
      kind: "x",
      message: "A payload of another shape",
    });

    expect(metCriteria(summary)).toEqual(["Contains x"]);
    expect(statusSetBy).toEqual(["Contains x"]);

    // The template's {{alertname}} has no value, so it is left as written.
    expect(openIncidentTitles()).toEqual(["Incident: {{alertname}}"]);
    expect(openAlertTitles()).toEqual(["Alert: {{alertname}}"]);
    expect(incidents[0]!.seriesFingerprint).toBeUndefined();
    expect(alerts[0]!.seriesFingerprint).toBeUndefined();
    expect(incidents[0]!.createdCriteriaId).toBe(CONTAINS_X_ID);

    // The rest of the template still reads the request.
    expect(incidents[0]!.description).toContain("A payload of another shape");

    const notes: Array<MonitorEvaluationEvent> = groupingNotes(summary);

    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe("No value to group by");
    expect(notes[0]!.message).toBe(
      'This request has no value at requestBody.groupLabels.alertname. Criteria "Contains x" handles it for the whole monitor, as it would without grouping.',
    );
    expect(notes[0]!.relatedCriteriaId).toBe(CONTAINS_X_ID);

    // The note comes before what was opened.
    expect(actions(summary)).toEqual([
      "grouping: No value to group by",
      "incident-created: Incident created: Incident: {{alertname}}",
      "alert-created: Alert created: Alert: {{alertname}}",
    ]);
  });

  it("says so in the root cause of what it opened", async () => {
    await send({ kind: "x" });

    for (const rootCause of [incidents[0]!.rootCause, alerts[0]!.rootCause]) {
      expect(rootCause).toContain("**Criteria Name**: Contains x");
      expect(rootCause).toContain(
        "**Grouping**: The request had no value at `requestBody.groupLabels.alertname`, so it counts for the whole monitor rather than for one value.",
      );
    }
  });

  it("a second such request opens nothing new: one at a time, as without grouping", async () => {
    await send({ kind: "x" });
    const second: MonitorEvaluationSummary = await send({ kind: "x", n: 2 });

    expect(incidents).toHaveLength(1);
    expect(alerts).toHaveLength(1);
    expect(actions(second)).toEqual([
      "grouping: No value to group by",
      "incident-skipped: Incident already active: Incident: {{alertname}}",
      "alert-skipped: Alert already active: Alert: {{alertname}}",
    ]);
  });

  it("a request with the field still opens that value's own incident and alert beside it", async () => {
    await send({ kind: "x" });
    await send({ kind: "x", groupLabels: { alertname: "HighCPU" } });

    expect(openIncidentTitles()).toEqual([
      "Incident: {{alertname}}",
      "Incident: HighCPU",
    ]);
    expect(openAlertTitles()).toEqual([
      "Alert: {{alertname}}",
      "Alert: HighCPU",
    ]);
  });

  it("what it opened resolves like any incident of a criteria without grouping: when another criteria matches", async () => {
    await send({ kind: "x" });
    await send({ kind: "x", groupLabels: { alertname: "HighCPU" } });
    await send({ test: "test" });

    // The whole-monitor pair resolved; the value's pair waits for its recovery.
    expect(openIncidentTitles()).toEqual(["Incident: HighCPU"]);
    expect(openAlertTitles()).toEqual([
      "Alert: HighCPU",
      "A request without x",
    ]);
  });

  it("a body that is not a JSON object has no field either", async () => {
    for (const body of ["x marks the spot", JSON.stringify(["x"])]) {
      incidents = [];
      alerts = [];

      const summary: MonitorEvaluationSummary = await send(body);

      expect(metCriteria(summary)).toEqual(["Contains x"]);
      expect(openAlertTitles()).toEqual(["Alert: {{alertname}}"]);
      expect(groupingNotes(summary)[0]!.title).toBe("No value to group by");
    }
  });

  it("so does a field holding an object, a list, null or an empty string", async () => {
    for (const alertname of [{ nested: true }, ["a"], null, ""]) {
      incidents = [];
      alerts = [];

      await send({ kind: "x", groupLabels: { alertname: alertname } });

      expect(openAlertTitles()).toEqual(["Alert: {{alertname}}"]);
      expect(alerts[0]!.seriesFingerprint).toBeUndefined();
    }
  });

  it("a grouping path that does not start with requestBody. never finds a value, and the monitor log names it", async () => {
    monitorUnderTest = monitorWith([
      containsX({
        grouping: { groupByJSONPath: "groupLabels.alertname" },
      }),
      withoutX(),
    ]);

    const summary: MonitorEvaluationSummary = await send({
      kind: "x",
      groupLabels: { alertname: "HighCPU" },
    });

    expect(openAlertTitles()).toEqual(["Alert: {{alertname}}"]);
    expect(groupingNotes(summary)[0]!.message).toBe(
      'This request has no value at groupLabels.alertname. Criteria "Contains x" handles it for the whole monitor, as it would without grouping.',
    );
  });
});

describe("Recovery, with and without the field", () => {
  beforeEach(() => {
    monitorUnderTest = monitorWith([firing(), allClear()]);
  });

  it("a recovery for one value resolves only that value's incident and alert", async () => {
    await send(
      notification("firing", [
        ["HighCPU", "firing"],
        ["HighRAM", "firing"],
      ]),
    );
    await send(
      notification("firing", [
        ["HighCPU", "resolved"],
        ["HighRAM", "firing"],
      ]),
    );

    expect(openIncidentTitles()).toEqual(["HighRAM"]);
    expect(openAlertTitles()).toEqual(["HighRAM"]);
  });

  it("a request whose values all recovered opens nothing new, and the monitor log says why", async () => {
    await send(notification("firing", [["HighCPU", "firing"]]));

    /*
     * The criteria still matches - the body says "firing" at the top - but
     * every alert in it recovered.
     */
    const summary: MonitorEvaluationSummary = await send(
      notification("firing", [["HighCPU", "resolved"]]),
    );

    expect(metCriteria(summary)).toEqual(["Firing"]);
    expect(incidents).toHaveLength(1);
    expect(openIncidentTitles()).toEqual([]);
    expect(openAlertTitles()).toEqual([]);

    const notes: Array<MonitorEvaluationEvent> = groupingNotes(summary);

    expect(notes.map((note: MonitorEvaluationEvent) => note.title)).toEqual([
      "Nothing new to open",
    ]);
    expect(notes[0]!.message).toBe(
      'Every value this request has at requestBody.alerts[*].labels.alertname reported recovered, so criteria "Firing" opens nothing new.',
    );
  });

  it("a recovery that the criteria does not match resolves the value all the same", async () => {
    await send(notification("firing", [["HighCPU", "firing"]]));
    const summary: MonitorEvaluationSummary = await send(
      notification("resolved", [["HighCPU", "resolved"]]),
    );

    expect(metCriteria(summary)).toEqual(["All clear"]);
    expect(openIncidentTitles()).toEqual([]);
    expect(openAlertTitles()).toEqual([]);
  });

  it("a request without the field resolves no value's incident", async () => {
    await send(notification("firing", [["HighCPU", "firing"]]));
    await send({ status: "resolved", message: "no alerts here" });

    expect(openIncidentTitles()).toEqual(["HighCPU"]);
    expect(openAlertTitles()).toEqual(["HighCPU"]);
  });

  it("a request without the field that says it recovered opens nothing", async () => {
    monitorUnderTest = monitorWith([
      firing({
        groupByJSONPath: "requestBody.commonLabels.alertname",
        resolvedWhenJSONPath: "requestBody.state",
        resolvedWhenValue: "ok",
      }),
      allClear(),
    ]);

    const summary: MonitorEvaluationSummary = await send({
      status: "firing",
      state: "ok",
    });

    expect(metCriteria(summary)).toEqual(["Firing"]);
    expect(incidents).toEqual([]);
    expect(alerts).toEqual([]);
    expect(groupingNotes(summary)[0]!.message).toBe(
      'This request has no value at requestBody.commonLabels.alertname and reports recovered, so criteria "Firing" opens nothing new.',
    );
  });

  it("the same request saying it is still firing opens one for the whole monitor", async () => {
    monitorUnderTest = monitorWith([
      firing({
        groupByJSONPath: "requestBody.commonLabels.alertname",
        resolvedWhenJSONPath: "requestBody.state",
        resolvedWhenValue: "ok",
      }),
      allClear(),
    ]);

    await send({ status: "firing", state: "alerting" });

    expect(openIncidentTitles()).toEqual(["{{alertname}}"]);
    expect(openAlertTitles()).toEqual(["{{alertname}}"]);
  });

  it("an item with no value beside named ones: the named ones open, and the monitor log counts the rest", async () => {
    const summary: MonitorEvaluationSummary = await send({
      status: "firing",
      alerts: [
        { status: "firing", labels: { alertname: "HighCPU" } },
        { status: "firing", labels: {} },
        { status: "firing" },
      ],
    });

    expect(openIncidentTitles()).toEqual(["HighCPU"]);

    const notes: Array<MonitorEvaluationEvent> = groupingNotes(summary);

    expect(notes.map((note: MonitorEvaluationEvent) => note.title)).toEqual([
      "Some items have no value to group by",
    ]);
    expect(notes[0]!.message).toBe(
      "2 items in this request have no value at requestBody.alerts[*].labels.alertname, so they open nothing of their own.",
    );
  });

  it("items with no value and nothing named: one for the whole monitor", async () => {
    await send({
      status: "firing",
      alerts: [{ status: "firing" }, { status: "firing", labels: {} }],
    });

    expect(openIncidentTitles()).toEqual(["{{alertname}}"]);
    expect(incidents[0]!.seriesFingerprint).toBeUndefined();
  });

  it("items with no value that all recovered open nothing", async () => {
    const summary: MonitorEvaluationSummary = await send({
      status: "firing",
      alerts: [{ status: "resolved" }, { status: "resolved", labels: {} }],
    });

    expect(incidents).toEqual([]);
    expect(groupingNotes(summary)[0]!.title).toBe("Nothing new to open");
  });

  it("an empty alerts list is a request with no value", async () => {
    await send({ status: "firing", alerts: [] });

    expect(openIncidentTitles()).toEqual(["{{alertname}}"]);
  });
});

describe("Three criteria, in different orders", () => {
  it("grouped, then two without grouping: each request is handled by the first criteria it matches", async () => {
    monitorUnderTest = monitorWith([firing(), warning(), allClear()]);

    const warned: MonitorEvaluationSummary = await send({
      severity: "warning",
      summary: "Disk at 85%",
    });

    expect(metCriteria(warned)).toEqual(["Warning"]);
    expect(openAlertTitles()).toEqual(["Warning: Disk at 85%"]);
    expect(alerts[0]!.seriesFingerprint).toBeUndefined();

    await send(notification("firing", [["HighCPU", "firing"]]));

    // The warning's alert resolved when another criteria matched.
    expect(openAlertTitles()).toEqual(["HighCPU"]);
    expect(openIncidentTitles()).toEqual(["HighCPU"]);

    const cleared: MonitorEvaluationSummary = await send(
      notification("resolved", [["HighCPU", "resolved"]]),
    );

    expect(metCriteria(cleared)).toEqual(["All clear"]);
    expect(openAlertTitles()).toEqual([]);
    expect(openIncidentTitles()).toEqual([]);
  });

  it("without grouping first: a request both match is handled by it, not grouped", async () => {
    monitorUnderTest = monitorWith([warning(), firing(), allClear()]);

    const summary: MonitorEvaluationSummary = await send({
      ...notification("firing", [["HighCPU", "firing"]]),
      severity: "warning",
      summary: "Both",
    });

    expect(metCriteria(summary)).toEqual(["Warning"]);
    expect(openAlertTitles()).toEqual(["Warning: Both"]);
    expect(incidents).toEqual([]);
    expect(groupingNotes(summary)).toEqual([]);
  });

  it("grouped below a criteria without grouping: requests that reach it are grouped", async () => {
    monitorUnderTest = monitorWith([warning(), firing(), allClear()]);

    await send(
      notification("firing", [
        ["HighCPU", "firing"],
        ["HighRAM", "firing"],
      ]),
    );

    expect(openIncidentTitles()).toEqual(["HighCPU", "HighRAM"]);
  });

  it("two grouped criteria: each groups by its own field", async () => {
    const byTeam: MonitorCriteriaInstance = criteria({
      id: TEAM_ID,
      name: "Team page",
      statusId: DEGRADED_STATUS_ID,
      filters: [bodyFilter(FilterType.Contains, '"page":"team"')],
      grouping: { groupByJSONPath: "requestBody.team" },
      alert: { title: "Team {{team}}", autoResolve: true },
    });

    monitorUnderTest = monitorWith([firing(), byTeam, allClear()]);

    await send({ page: "team", team: "payments" });
    await send(notification("firing", [["HighCPU", "firing"]]));
    await send({ page: "team", team: "search" });

    expect(alertTitles()).toEqual(["Team payments", "HighCPU", "Team search"]);
    expect(alerts[0]!.seriesLabels).toEqual({ team: "payments" });
    expect(alerts[1]!.seriesLabels).toEqual({ alertname: "HighCPU" });
  });

  it("a criteria without grouping between two grouped ones opens one for the whole monitor", async () => {
    const byTeam: MonitorCriteriaInstance = criteria({
      id: TEAM_ID,
      name: "Team page",
      statusId: DEGRADED_STATUS_ID,
      filters: [bodyFilter(FilterType.Contains, '"page":"team"')],
      grouping: { groupByJSONPath: "requestBody.team" },
      alert: { title: "Team {{team}}", autoResolve: true },
    });

    monitorUnderTest = monitorWith([firing(), warning(), byTeam]);

    await send({ severity: "warning", summary: "Queue is slow" });

    expect(alertTitles()).toEqual(["Warning: Queue is slow"]);
    expect(alerts[0]!.seriesFingerprint).toBeUndefined();
  });
});

describe("The background check", () => {
  function silence(
    grouping: IncidentGroupingConfig | undefined,
  ): MonitorCriteriaInstance {
    return criteria({
      id: SILENCE_ID,
      name: "No request in 10 minutes",
      statusId: OFFLINE_STATUS_ID,
      filters: [
        {
          checkOn: CheckOn.IncomingRequest,
          filterType: FilterType.NotRecievedInMinutes,
          value: 10,
        },
      ],
      grouping: grouping,
      incident: { title: "Requests stopped", autoResolve: true },
      alert: { title: "Requests stopped", autoResolve: true },
    });
  }

  it("a grouped criteria that matched because requests stopped arriving opens one for the whole monitor", async () => {
    monitorUnderTest = monitorWith([silence(PER_ALERT_GROUPING), allClear()]);

    await send(notification("resolved", [["HighCPU", "resolved"]]));
    const summary: MonitorEvaluationSummary = await backgroundCheck(11);

    expect(metCriteria(summary)).toEqual(["No request in 10 minutes"]);
    expect(openIncidentTitles()).toEqual(["Requests stopped"]);
    expect(openAlertTitles()).toEqual(["Requests stopped"]);
    expect(groupingNotes(summary).map((note: MonitorEvaluationEvent) => note.message)).toEqual([
      'Criteria "No request in 10 minutes" matched because requests stopped arriving. It handles that for the whole monitor, as it would without grouping.',
    ]);
  });

  it("the same criteria without grouping opens the same", async () => {
    monitorUnderTest = monitorWith([silence(undefined), allClear()]);

    await send(notification("resolved", [["HighCPU", "resolved"]]));
    const summary: MonitorEvaluationSummary = await backgroundCheck(11);

    expect(openIncidentTitles()).toEqual(["Requests stopped"]);
    expect(groupingNotes(summary)).toEqual([]);
  });

  it("re-reading the last request opens no value again, even one resolved by hand", async () => {
    monitorUnderTest = monitorWith([
      silence(undefined),
      firing(),
      allClear(),
    ]);

    await send(notification("firing", [["HighCPU", "firing"]]));
    expect(openIncidentTitles()).toEqual(["HighCPU"]);

    // Someone resolves it by hand; the last request still says firing.
    incidents[0]!.currentIncidentStateId = INCIDENT_STATE_IDS.resolved;

    const summary: MonitorEvaluationSummary = await backgroundCheck(2);

    expect(metCriteria(summary)).toEqual(["Firing"]);
    expect(openIncidentTitles()).toEqual([]);
    expect(incidents).toHaveLength(1);
    expect(groupingNotes(summary).map((note: MonitorEvaluationEvent) => note.message)).toEqual([
      'The background check re-read the last request. Criteria "Firing" opens one per value as a request arrives, not when it is re-read.',
    ]);
  });
});

describe("A recovery field with [*] when the grouping field has none", () => {
  /*
   * The customer's own grouping: one value per request
   * (groupLabels.alertname), recovered when the alerts in it say so.
   */
  beforeEach(() => {
    monitorUnderTest = monitorWith([
      criteria({
        id: CONTAINS_X_ID,
        name: "Contains x",
        statusId: OFFLINE_STATUS_ID,
        filters: [bodyFilter(FilterType.Contains, "x")],
        grouping: CUSTOMER_GROUPING,
        incident: { title: "{{alertname}}", autoResolve: true },
      }),
      withoutX(),
    ]);
  });

  function grafana(alertname: string, statuses: Array<string>): JSONObject {
    return {
      receiver: "x",
      groupLabels: { alertname: alertname },
      alerts: statuses.map((status: string) => {
        return { status: status };
      }),
    };
  }

  it("resolves the value's incident once every alert in the request says recovered", async () => {
    await send(grafana("HighCPU", ["firing", "firing"]));
    await send(grafana("HighCPU", ["resolved", "firing"]));

    expect(openIncidentTitles()).toEqual(["HighCPU"]);

    await send(grafana("HighCPU", ["resolved", "resolved"]));

    expect(openIncidentTitles()).toEqual([]);
  });

  it("never on a request with no alerts in it", async () => {
    await send(grafana("HighCPU", ["firing"]));
    await send(grafana("HighCPU", []));

    expect(openIncidentTitles()).toEqual(["HighCPU"]);
  });

  it("matches the value's fingerprint, so only that value resolves", async () => {
    await send(grafana("HighCPU", ["firing"]));
    await send(grafana("HighRAM", ["firing"]));
    await send(grafana("HighCPU", ["resolved"]));

    expect(openIncidentTitles()).toEqual(["HighRAM"]);
    expect(
      IncomingRequestIncidentGrouping.collectResolvedFingerprints({
        dataToProcess: request(grafana("HighCPU", ["resolved"])),
        criteriaInstances: [monitorUnderTest.monitorSteps!.data!
          .monitorStepsInstanceArray[0]!.data!.monitorCriteria.data!
          .monitorCriteriaInstanceArray[0]!],
      }),
    ).toEqual([incidents[0]!.seriesFingerprint]);
  });
});
