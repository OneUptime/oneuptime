/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import fs from "fs";
import path from "path";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
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
 * "A FIRING ALERTMANAGER ALERT FROM A KOLLA STACK OPENS AN INCIDENT ON THE RIGHT CLOUD."
 *
 * What Alertmanager really posted, byte for byte, goes where the heartbeat route's worker
 * sends every request (MonitorResourceUtil.monitorResource), through the real criteria
 * evaluator, the real grouping, the real incident creator and the real reading of what a
 * monitor is linked to. The monitor is the one integrations/prometheus-alertmanager.md tells
 * a person to make, setting by setting. Only the database is in memory.
 *
 * Tests/Ops/openstack-e2e records each folder under Fixtures/OpenStack/alertmanager. Each
 * holds a notification of one firing alert and the notification of its recovery.
 */

const FIXTURES: string = path.join(
  __dirname,
  "../../../Fixtures/OpenStack/alertmanager",
);
const RECORDINGS: Array<string> = fs.readdirSync(FIXTURES).sort();

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const THE_CLOUD: string = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ANOTHER_CLOUD: string = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const MONITOR_OF_THE_CLOUD: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_OF_ANOTHER_CLOUD: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const CRITERIA_FIRING: string = "9c1f8d0e-6a55-4ad4-9d43-2a3c1f9a7c01";
const CRITERIA_RESOLVED: string = "9c1f8d0e-6a55-4ad4-9d43-2a3c1f9a7c02";

// The incident table, and how each monitor's status moved.
let table: Array<Incident> = [];
let statusChanges: Array<string> = [];
let nextNumber: number = 1;

function readRecording(recording: string, file: string): JSONObject {
  /*
   * The heartbeat route's JSON body parser turns what arrived into this, so the evaluator
   * reads it as an object, as it does for Alertmanager's own Content-Type.
   */
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, recording, file), "utf8"),
  ) as JSONObject;
}

// "Declare an incident for each firing alert", "Open one incident per alert" and the rest.
function firingCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: CRITERIA_FIRING,
    name: "Firing",
    description: "",
    monitorStatusId: OFFLINE_STATUS_ID,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: '"status":"firing"',
      },
    ],
    incidents: [
      {
        id: "9c1f8d0e-6a55-4ad4-9d43-2a3c1f9a7d01",
        title:
          "{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}",
        description:
          "{{requestBody.commonAnnotations.summary}}\n\n{{requestBody.commonAnnotations.description}}",
        incidentSeverityId: SEVERITY_ID,
        autoResolveIncident: true,
      },
    ],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: false,
    isEnabled: true,
    incidentGrouping: {
      groupByJSONPath: "requestBody.alerts[*].fingerprint",
      resolvedWhenJSONPath: "requestBody.alerts[*].status",
      resolvedWhenValue: "resolved",
    },
  };
  return instance;
}

// "Bring the monitor back online".
function resolvedCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: CRITERIA_RESOLVED,
    name: "Resolved",
    description: "",
    monitorStatusId: ONLINE_STATUS_ID,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: '"status":"resolved"',
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
  };
  return instance;
}

function incomingRequestMonitor(id: ObjectID, name: string): Monitor {
  const step: MonitorStep = new MonitorStep();
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [firingCriteria(), resolvedCriteria()],
  };
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = id;
  monitor.projectId = PROJECT_ID;
  monitor.name = name;
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ONLINE_STATUS_ID;
  return monitor;
}

const MONITORS: Map<string, Monitor> = new Map<string, Monitor>();

// The monitor's Overview > Linked Resources: one cloud for each monitor.
const LINKED_CLOUD: Map<string, string> = new Map<string, string>([
  [MONITOR_OF_THE_CLOUD.toString(), THE_CLOUD],
  [MONITOR_OF_ANOTHER_CLOUD.toString(), ANOTHER_CLOUD],
]);

function monitorOf(id: unknown): Monitor | undefined {
  return MONITORS.get(String(id));
}

function parameterOf(operator: unknown): unknown {
  return Object.values(
    (operator as FindOperator<unknown>).objectLiteralParameters || {},
  )[0];
}

function isIn(operator: unknown, value: string | undefined): boolean {
  return (
    Boolean(value) &&
    (parameterOf(operator) as Array<string>).includes(value as string)
  );
}

function readIncidents(
  query: JSONObject,
  limit: number | undefined,
): Array<Incident> {
  return table
    .filter((incident: Incident): boolean => {
      const monitors: Array<ObjectID> | undefined = query[
        "monitors"
      ] as unknown as Array<ObjectID> | undefined;

      if (
        monitors !== undefined &&
        !monitors.some((monitorId: ObjectID): boolean => {
          return (
            monitorId.toString() === incident.monitors?.[0]?.id?.toString()
          );
        })
      ) {
        return false;
      }

      const state: unknown = query["currentIncidentStateId"];

      if (
        state !== undefined &&
        !isIn(state, incident.currentIncidentStateId?.toString())
      ) {
        return false;
      }

      const fingerprint: unknown = query["seriesFingerprint"];

      if (
        fingerprint !== undefined &&
        !isIn(fingerprint, incident.seriesFingerprint)
      ) {
        return false;
      }

      return true;
    })
    .slice(0, limit ?? Infinity);
}

async function post(
  monitorId: ObjectID,
  requestBody: JSONObject,
): Promise<ProbeApiIngestResponse> {
  jest.setSystemTime(
    OneUptimeDate.addRemoveMinutes(OneUptimeDate.getCurrentDate(), 1),
  );

  const now: Date = OneUptimeDate.getCurrentDate();
  const request: IncomingMonitorRequest = {
    projectId: PROJECT_ID,
    monitorId: monitorId,
    requestHeaders: { "content-type": "application/json" },
    requestBody: requestBody,
    requestMethod: HTTPMethod.POST,
    incomingRequestReceivedAt: now,
    onlyCheckForIncomingRequestReceivedAt: false,
    checkedAt: now,
  };

  return await MonitorResourceUtil.monitorResource(request);
}

function cloudsOf(incident: Incident): Array<string> {
  return (incident.openStackClouds || []).map(
    (cloud: { _id?: string | undefined }): string => {
      return String(cloud._id);
    },
  );
}

function isOpen(incident: Incident): boolean {
  return (
    incident.currentIncidentStateId?.toString() !==
    INCIDENT_STATE_IDS.resolved.toString()
  );
}

// What the cloud's Incidents page lists: Pages/OpenStack/View/Incidents.tsx.
function incidentsOnTheCloudsPage(cloud: string): Array<Incident> {
  return table.filter((incident: Incident): boolean => {
    return cloudsOf(incident).includes(cloud);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-04T20:30:00.000Z"));

  table = [];
  statusChanges = [];
  nextNumber = 1;
  MONITORS.clear();
  MONITORS.set(
    MONITOR_OF_THE_CLOUD.toString(),
    incomingRequestMonitor(MONITOR_OF_THE_CLOUD, "Kolla production alerts"),
  );
  MONITORS.set(
    MONITOR_OF_ANOTHER_CLOUD.toString(),
    incomingRequestMonitor(MONITOR_OF_ANOTHER_CLOUD, "Kolla staging alerts"),
  );

  mockProjectStates();

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    return monitorOf(data.id);
  }) as never);
  jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorService, "findOneBy")
    .mockResolvedValue({ autoProvisionedNetworkDeviceId: null } as never);

  /*
   * What LinkedAffectedResources reads, a query per relation. This is the only part of a
   * monitor's links that is made up here, because it is the database's answer: the reading
   * of it, and what is done with it, are the real code.
   */
  jest.spyOn(MonitorService, "findAllBy").mockImplementation((async (data: {
    query: JSONObject;
    select: JSONObject;
  }): Promise<Array<Monitor>> => {
    const ids: Array<string> = parameterOf(data.query["_id"]) as Array<string>;

    if (!data.select["openStackClouds"]) {
      return [];
    }

    return ids.map((id: string): Monitor => {
      const row: Monitor = new Monitor();
      row.id = new ObjectID(id);
      row.projectId = PROJECT_ID;
      row.openStackClouds = [
        {
          _id: LINKED_CLOUD.get(id),
          projectId: PROJECT_ID,
          name: "the cloud",
        },
      ] as never;
      return row;
    });
  }) as never);
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);

  jest
    .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
  jest
    .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
    .mockImplementation((async (data: {
      criteriaInstance: MonitorCriteriaInstance;
    }): Promise<MonitorStatusTimeline | null> => {
      statusChanges.push(
        String(data.criteriaInstance.data?.monitorStatusId?.toString()),
      );
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
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentSeverity> => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ID.toString();
      severity.projectId = PROJECT_ID;
      return severity;
    }) as never);

  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

  jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    limit: number;
  }): Promise<Array<Incident>> => {
    return readIncidents(findBy.query, findBy.limit);
  }) as never);

  jest.spyOn(IncidentService, "countBy").mockImplementation((async (countBy: {
    query: JSONObject;
    limit?: number | undefined;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(
      readIncidents(countBy.query, countBy.limit).length,
    );
  }) as never);

  jest.spyOn(GlobalCache, "getStrings").mockResolvedValue([] as never);
  jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined as never);

  jest.spyOn(IncidentService, "create").mockImplementation((async (createBy: {
    data: Incident;
  }): Promise<Incident> => {
    const incident: Incident = createBy.data;
    incident.id = ObjectID.generate();
    incident.incidentNumber = nextNumber++;
    incident.createdAt = OneUptimeDate.getCurrentDate();
    incident.currentIncidentStateId = INCIDENT_STATE_IDS.created;
    table.push(incident);
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
      const incident: Incident | undefined = table.find(
        (candidate: Incident): boolean => {
          return (
            candidate.id!.toString() === createBy.data.incidentId!.toString()
          );
        },
      );

      incident!.currentIncidentStateId = createBy.data.incidentStateId!;
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

describe.each(RECORDINGS)(
  "what Alertmanager posted, in %s",
  (recording: string) => {
    const firing: JSONObject = readRecording(recording, "firing.json");
    const resolved: JSONObject = readRecording(recording, "resolved.json");
    const alertname: string = (firing["commonLabels"] as JSONObject)[
      "alertname"
    ] as string;
    const instance: string = (firing["commonLabels"] as JSONObject)[
      "instance"
    ] as string;
    const fingerprint: string = (firing["alerts"] as Array<JSONObject>)[0]![
      "fingerprint"
    ] as string;

    it("is what the integration's page says it is: one alert, with a fingerprint and a status", () => {
      for (const [notification, status] of [
        [firing, "firing"],
        [resolved, "resolved"],
      ] as Array<[JSONObject, string]>) {
        expect(notification["status"]).toBe(status);
        expect(notification["version"]).toBe("4");
        expect(notification["receiver"]).toBe("oneuptime");

        const alerts: Array<JSONObject> = notification[
          "alerts"
        ] as Array<JSONObject>;

        expect(alerts).toHaveLength(1);
        expect(alerts[0]!["status"]).toBe(status);
        expect(alerts[0]!["fingerprint"]).toEqual(expect.any(String));
      }

      // The same alert, or its recovery would close nothing.
      expect((firing["alerts"] as Array<JSONObject>)[0]!["fingerprint"]).toBe(
        (resolved["alerts"] as Array<JSONObject>)[0]!["fingerprint"],
      );
    });

    it("the firing notification opens one incident, on the cloud the monitor is linked to", async () => {
      await post(MONITOR_OF_THE_CLOUD, firing);

      expect(table).toHaveLength(1);
      // The page's template, and what tells this alert's incident from another's.
      expect(table[0]!.title).toBe(
        `${alertname} on ${instance} - Fingerprint: ${fingerprint}`,
      );
      expect(cloudsOf(table[0]!)).toEqual([THE_CLOUD]);
      expect(isOpen(table[0]!)).toBe(true);
      expect(table[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(
        (firing["commonAnnotations"] as JSONObject)["summary"] as string,
      ).not.toBe("");
      expect(table[0]!.description).toContain(
        (firing["commonAnnotations"] as JSONObject)["summary"] as string,
      );

      expect(incidentsOnTheCloudsPage(THE_CLOUD)).toHaveLength(1);
    });

    it("and on no other cloud", async () => {
      await post(MONITOR_OF_THE_CLOUD, firing);

      expect(incidentsOnTheCloudsPage(ANOTHER_CLOUD)).toEqual([]);
    });

    it("each cloud's Alertmanager opens incidents on that cloud alone", async () => {
      await post(MONITOR_OF_THE_CLOUD, firing);
      await post(MONITOR_OF_ANOTHER_CLOUD, firing);

      expect(table).toHaveLength(2);
      expect(incidentsOnTheCloudsPage(THE_CLOUD)).toHaveLength(1);
      expect(incidentsOnTheCloudsPage(ANOTHER_CLOUD)).toHaveLength(1);
      expect(incidentsOnTheCloudsPage(THE_CLOUD)[0]).not.toBe(
        incidentsOnTheCloudsPage(ANOTHER_CLOUD)[0],
      );
    });

    it("Alertmanager repeating itself opens nothing new", async () => {
      await post(MONITOR_OF_THE_CLOUD, firing);
      // repeat_interval: the same notification again, the alert having never stopped.
      await post(MONITOR_OF_THE_CLOUD, firing);
      await post(MONITOR_OF_THE_CLOUD, firing);

      expect(table).toHaveLength(1);
      expect(table.filter(isOpen)).toHaveLength(1);
    });

    it("the resolved notification resolves that incident, and takes the monitor back online", async () => {
      await post(MONITOR_OF_THE_CLOUD, firing);
      expect(statusChanges).toEqual([OFFLINE_STATUS_ID.toString()]);
      monitorOf(MONITOR_OF_THE_CLOUD)!.currentMonitorStatusId =
        OFFLINE_STATUS_ID;

      await post(MONITOR_OF_THE_CLOUD, resolved);

      expect(table).toHaveLength(1);
      expect(isOpen(table[0]!)).toBe(false);
      expect(statusChanges).toEqual([
        OFFLINE_STATUS_ID.toString(),
        ONLINE_STATUS_ID.toString(),
      ]);
    });

    it("a recovery on one cloud closes nothing on the other", async () => {
      await post(MONITOR_OF_THE_CLOUD, firing);
      await post(MONITOR_OF_ANOTHER_CLOUD, firing);

      await post(MONITOR_OF_THE_CLOUD, resolved);

      expect(isOpen(incidentsOnTheCloudsPage(THE_CLOUD)[0]!)).toBe(false);
      expect(isOpen(incidentsOnTheCloudsPage(ANOTHER_CLOUD)[0]!)).toBe(true);
    });

    it("the same alert firing again after its recovery is a new incident", async () => {
      await post(MONITOR_OF_THE_CLOUD, firing);
      await post(MONITOR_OF_THE_CLOUD, resolved);
      await post(MONITOR_OF_THE_CLOUD, firing);

      expect(table).toHaveLength(2);
      expect(table.filter(isOpen)).toHaveLength(1);
      expect(cloudsOf(table[1]!)).toEqual([THE_CLOUD]);
    });
  },
);
