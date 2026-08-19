import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
  MonitorSummarySnapshotVersion,
} from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import MonitorSummarySnapshotUtil from "../../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The point of the whole feature: the Monitor Summary has to land on the
 * incident / alert ROW. Storing it anywhere else - or forgetting to store
 * it on one of the two - leaves the page blank once MonitorLog's retention
 * (one day by default) drops the underlying check.
 *
 * These drive the real creation paths with the surrounding services stubbed
 * and assert on what was handed to IncidentService.create / AlertService.create.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CAPTURED_AT: Date = new Date("2026-07-31T10:00:00.000Z");

const SNAPSHOT: MonitorSummarySnapshot = {
  version: MonitorSummarySnapshotVersion,
  source: MonitorSummarySnapshotSource.Captured,
  monitorType: MonitorType.Website,
  monitorId: MONITOR_ID.toString(),
  monitorName: "Production API",
  probeName: "US West Probe",
  capturedAt: CAPTURED_AT,
  probeMonitorResponse: {
    responseCode: 503,
    failureCause: "Connection refused",
  } as unknown as ProbeMonitorResponse,
};

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Website;
  model.name = "Production API";
  return model;
}

function criteriaInstance(input: {
  createIncidents: boolean;
  createAlerts: boolean;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Is Offline";
  instance.data!.createIncidents = input.createIncidents;
  instance.data!.createAlerts = input.createAlerts;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "API is down",
      description: "The API stopped responding.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: false,
    },
  ];
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "API is down",
      description: "The API stopped responding.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: false,
    },
  ];
  return instance;
}

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
  probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  failureCause: "Connection refused",
  responseCode: 503,
  monitoredAt: CAPTURED_AT,
} as unknown as ProbeMonitorResponse;

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

describe("The monitor summary is stored on the incident / alert it created", () => {
  let createdIncidents: Array<Incident> = [];
  let createdAlerts: Array<Alert> = [];

  beforeEach(() => {
    createdIncidents = [];
    createdAlerts = [];

    // No incident / alert is already open for this monitor.
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    // The criteria's severity belongs to this project, so no fallback lookup.
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);

    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue({
        hostIds: [],
        dockerHostIds: [],
        podmanHostIds: [],
        kubernetesClusterIds: [],
        serviceIds: [],
        proxmoxClusterIds: [],
        cephClusterIds: [],
        dockerSwarmClusterIds: [],
        iotFleetIds: [],
      });

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        createdIncidents.push(incident);
        incident._id = new ObjectID(
          "66666666-6666-4666-8666-666666666666",
        ).toString();
        return incident;
      });

    jest
      .spyOn(AlertService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Alert> => {
        const alert: Alert = (createBy as { data: Alert }).data;
        createdAlerts.push(alert);
        alert._id = new ObjectID(
          "77777777-7777-4777-8777-777777777777",
        ).toString();
        return alert;
      });

    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
    jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("stores the captured summary on a created incident", async () => {
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: true,
        createAlerts: false,
      }),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      monitorSummary: SNAPSHOT,
      props: {},
    });

    expect(createdIncidents).toHaveLength(1);

    const stored: JSONObject | undefined = createdIncidents[0]!
      .monitorSummary as JSONObject | undefined;

    expect(stored).toBeDefined();

    const readBack: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.deserialize(
        JSON.parse(JSON.stringify(stored)) as JSONObject,
      );

    expect(readBack).not.toBeNull();
    expect(readBack!.monitorType).toBe(MonitorType.Website);
    expect(readBack!.probeName).toBe("US West Probe");
    expect(readBack!.probeMonitorResponse?.responseCode).toBe(503);
  });

  it("stores the captured summary on a created alert", async () => {
    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: false,
        createAlerts: true,
      }),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      monitorSummary: SNAPSHOT,
      props: {},
    });

    expect(createdAlerts).toHaveLength(1);

    const stored: JSONObject | undefined = createdAlerts[0]!.monitorSummary as
      | JSONObject
      | undefined;

    expect(stored).toBeDefined();

    const readBack: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.deserialize(
        JSON.parse(JSON.stringify(stored)) as JSONObject,
      );

    expect(readBack).not.toBeNull();
    expect(readBack!.monitorType).toBe(MonitorType.Website);
    expect(readBack!.probeMonitorResponse?.failureCause).toBe(
      "Connection refused",
    );
  });

  it("still creates the incident when there is no summary to store", async () => {
    /*
     * A capture is evidence, not a precondition. MonitorSummaryCapture
     * returns null for manual monitors and swallows its own failures, and
     * neither may cost us the incident.
     */
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: true,
        createAlerts: false,
      }),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      monitorSummary: null,
      props: {},
    });

    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]!.monitorSummary).toBeUndefined();
    // The raw state log is untouched by any of this.
    expect(createdIncidents[0]!.createdStateLog).toBeDefined();
  });

  it("still creates the alert when there is no summary to store", async () => {
    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: false,
        createAlerts: true,
      }),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      monitorSummary: undefined,
      props: {},
    });

    expect(createdAlerts).toHaveLength(1);
    expect(createdAlerts[0]!.monitorSummary).toBeUndefined();
    expect(createdAlerts[0]!.createdStateLog).toBeDefined();
  });

  it("keeps the summary alongside the state log rather than replacing it", async () => {
    /*
     * createdStateLog is copied onward into the incident state timeline and
     * the monitor status change log. The summary is additive - anything
     * that quietly took its place would break those.
     */
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: true,
        createAlerts: false,
      }),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      monitorSummary: SNAPSHOT,
      props: {},
    });

    const incident: Incident = createdIncidents[0]!;

    expect(incident.createdStateLog).toBeDefined();
    expect((incident.createdStateLog as JSONObject)["responseCode"]).toBe(503);
    expect(incident.monitorSummary).toBeDefined();
    expect(incident.rootCause).toBe("Monitor is offline");
  });
});
