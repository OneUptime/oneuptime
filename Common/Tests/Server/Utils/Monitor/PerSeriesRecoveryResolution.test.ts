import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";

/*
 * Regression tests for per-series (fingerprint-grouped) telemetry monitor
 * auto-resolution — IoT / Kubernetes / Docker / Host / Proxmox / Ceph.
 *
 * The snapshot model: each evaluation tick, the matched criteria's
 * per-series matches are turned into a "breaching fingerprints" set, and
 * any open per-series incident/alert whose fingerprint is NOT in that set
 * is auto-resolved (when the creating criteria opted into auto-resolve).
 *
 * The critical case is FULL recovery: every device/entity comes back
 * healthy, so the alerting ("down") criteria no longer matches and the
 * HEALTHY criteria matches instead — with per-series matches for every
 * recovered series (the default Healthy criteria of these monitor types
 * uses MetricValue filters, e.g. `device.online == 1`, and has
 * createIncidents/createAlerts = false). Those healthy matches must NOT
 * be treated as breaching fingerprints, otherwise the open per-series
 * incidents/alerts never auto-resolve exactly when everything recovers.
 */

jest.mock("../../../../Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      create: jest.fn(),
      addOwners: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/IncidentStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      getResolvedStateIdForProject: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      create: jest.fn(),
      addOwners: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/AlertStateTimelineService", () => {
  return {
    __esModule: true,
    default: {
      getResolvedStateIdForProject: jest.fn(),
      create: jest.fn(),
    },
  };
});

/*
 * Cluster-context resolution (Proxmox/Ceph/DockerSwarm/IoT fleet lookups)
 * hits the DB via services — stub it to the empty context. It's only
 * reached on the create path for criteria that create incidents/alerts.
 */
jest.mock("../../../../Server/Utils/Monitor/MonitorClusterContext", () => {
  return {
    __esModule: true,
    default: {
      resolveClusterContextForMonitor: jest.fn(() => {
        return Promise.resolve({
          proxmoxClusterIds: [],
          cephClusterIds: [],
          dockerSwarmClusterIds: [],
          iotFleetIds: [],
        });
      }),
    },
  };
});

const incidentFindByMock: jest.Mock = IncidentService.findBy as jest.Mock;
const incidentCreateMock: jest.Mock = IncidentService.create as jest.Mock;
const incidentTimelineCreateMock: jest.Mock =
  IncidentStateTimelineService.create as jest.Mock;
const incidentResolvedStateMock: jest.Mock =
  IncidentStateTimelineService.getResolvedStateIdForProject as jest.Mock;

const alertFindByMock: jest.Mock = AlertService.findBy as jest.Mock;
const alertCreateMock: jest.Mock = AlertService.create as jest.Mock;
const alertTimelineCreateMock: jest.Mock =
  AlertStateTimelineService.create as jest.Mock;
const alertResolvedStateMock: jest.Mock =
  AlertStateTimelineService.getResolvedStateIdForProject as jest.Mock;

const PROJECT_ID: ObjectID = ObjectID.generate();
const DOWN_CRITERIA_ID: string = "down-criteria";
const HEALTHY_CRITERIA_ID: string = "healthy-criteria";
const INCIDENT_TEMPLATE_ID: string = "incident-template-1";
const ALERT_TEMPLATE_ID: string = "alert-template-1";

const INCIDENT_AUTO_RESOLVE: Record<string, Array<string>> = {
  [DOWN_CRITERIA_ID]: [INCIDENT_TEMPLATE_ID],
};
const ALERT_AUTO_RESOLVE: Record<string, Array<string>> = {
  [DOWN_CRITERIA_ID]: [ALERT_TEMPLATE_ID],
};

function buildMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.IoTDevice;
  return monitor;
}

const dataToProcess: DataToProcess = {
  monitorId: ObjectID.generate(),
} as unknown as DataToProcess;

function buildOpenIncident(fingerprint: string): Incident {
  const incident: Incident = new Incident();
  incident._id = ObjectID.generate().toString();
  incident.projectId = PROJECT_ID;
  incident.title = `Device offline: ${fingerprint}`;
  incident.createdCriteriaId = DOWN_CRITERIA_ID;
  incident.createdIncidentTemplateId = INCIDENT_TEMPLATE_ID;
  incident.seriesFingerprint = fingerprint;
  return incident;
}

function buildOpenAlert(fingerprint: string): Alert {
  const alert: Alert = new Alert();
  alert._id = ObjectID.generate().toString();
  alert.projectId = PROJECT_ID;
  alert.title = `Device offline: ${fingerprint}`;
  alert.createdCriteriaId = DOWN_CRITERIA_ID;
  alert.seriesFingerprint = fingerprint;
  return alert;
}

function buildDownCriteria(): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data = {
    id: DOWN_CRITERIA_ID,
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [],
    incidents: [
      {
        id: INCIDENT_TEMPLATE_ID,
        title: "Device offline",
        description: "A device stopped reporting.",
        incidentSeverityId: ObjectID.generate(),
        autoResolveIncident: true,
      },
    ],
    alerts: [
      {
        id: ALERT_TEMPLATE_ID,
        title: "Device offline",
        description: "A device stopped reporting.",
        alertSeverityId: ObjectID.generate(),
        autoResolveAlert: true,
      },
    ],
    name: "Device Offline",
    description: "Fires when a device is offline.",
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    isEnabled: true,
  };
  return criteria;
}

/*
 * The "Healthy" criteria that ships with the per-series infra monitor
 * templates: MetricValue filters (so it produces per-series matches for
 * every healthy series) but creates neither incidents nor alerts.
 */
function buildHealthyCriteria(): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data = {
    id: HEALTHY_CRITERIA_ID,
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [],
    incidents: [],
    alerts: [],
    name: "Healthy",
    description: "All devices are online.",
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
  };
  return criteria;
}

function match(
  criteriaMetId: string,
  fingerprint: string,
): PerSeriesCriteriaMatch {
  return {
    criteriaMetId,
    fingerprint,
    labels: {},
    rootCause: `Series ${fingerprint} matched criteria ${criteriaMetId}.`,
  };
}

function resolvedIncidentIds(): Array<string> {
  return incidentTimelineCreateMock.mock.calls.map(
    (call: Array<{ data: { incidentId: ObjectID } }>) => {
      return call[0]!.data.incidentId.toString();
    },
  );
}

function resolvedAlertIds(): Array<string> {
  return alertTimelineCreateMock.mock.calls.map(
    (call: Array<{ data: { alertId: ObjectID } }>) => {
      return call[0]!.data.alertId.toString();
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();

  incidentResolvedStateMock.mockResolvedValue(ObjectID.generate());
  incidentTimelineCreateMock.mockResolvedValue(undefined);
  incidentCreateMock.mockImplementation(
    (args: { data: Incident }): Promise<Incident> => {
      return Promise.resolve(args.data);
    },
  );

  alertResolvedStateMock.mockResolvedValue(ObjectID.generate());
  alertTimelineCreateMock.mockResolvedValue(undefined);
  alertCreateMock.mockImplementation(
    (args: { data: Alert }): Promise<Alert> => {
      return Promise.resolve(args.data);
    },
  );
});

describe("Per-series incident auto-resolution on recovery", () => {
  it("FULL recovery: healthy criteria matching all series resolves every open per-series incident", async () => {
    const incidentA: Incident = buildOpenIncident("fp-A");
    const incidentB: Incident = buildOpenIncident("fp-B");
    incidentFindByMock.mockResolvedValue([incidentA, incidentB]);

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: buildHealthyCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "All devices are back online.",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: INCIDENT_AUTO_RESOLVE,
      props: {},
      // Healthy criteria matched both (recovered) series this tick.
      matchesPerSeries: [
        match(HEALTHY_CRITERIA_ID, "fp-A"),
        match(HEALTHY_CRITERIA_ID, "fp-B"),
      ],
    });

    const resolved: Array<string> = resolvedIncidentIds();
    expect(resolved).toContain(incidentA.id!.toString());
    expect(resolved).toContain(incidentB.id!.toString());
    expect(incidentCreateMock).not.toHaveBeenCalled();
  });

  it("FULL recovery without auto-resolve configured: incidents stay open for human ack", async () => {
    const incidentA: Incident = buildOpenIncident("fp-A");
    incidentFindByMock.mockResolvedValue([incidentA]);

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: buildHealthyCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "All devices are back online.",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {}, // no auto-resolve
      props: {},
      matchesPerSeries: [match(HEALTHY_CRITERIA_ID, "fp-A")],
    });

    expect(incidentTimelineCreateMock).not.toHaveBeenCalled();
  });

  it("PARTIAL recovery: only the recovered series' incident resolves; the still-breaching one stays open", async () => {
    const incidentA: Incident = buildOpenIncident("fp-A"); // still down
    const incidentB: Incident = buildOpenIncident("fp-B"); // recovered
    incidentFindByMock.mockResolvedValue([incidentA, incidentB]);

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: buildDownCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "Device fp-A is offline.",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: INCIDENT_AUTO_RESOLVE,
      props: {},
      matchesPerSeries: [match(DOWN_CRITERIA_ID, "fp-A")],
    });

    const resolved: Array<string> = resolvedIncidentIds();
    expect(resolved).toContain(incidentB.id!.toString());
    expect(resolved).not.toContain(incidentA.id!.toString());
    // fp-A already has an open incident — deduped, not recreated.
    expect(incidentCreateMock).not.toHaveBeenCalled();
  });

  it("NEW breach while another series recovers: recovered incident resolves, new incident opens for the new breach", async () => {
    const incidentA: Incident = buildOpenIncident("fp-A"); // recovered
    incidentFindByMock.mockResolvedValue([incidentA]);

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: buildDownCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "Device fp-B is offline.",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: INCIDENT_AUTO_RESOLVE,
      props: {},
      matchesPerSeries: [match(DOWN_CRITERIA_ID, "fp-B")],
    });

    const resolved: Array<string> = resolvedIncidentIds();
    expect(resolved).toContain(incidentA.id!.toString());

    expect(incidentCreateMock).toHaveBeenCalledTimes(1);
    const createdIncident: Incident = incidentCreateMock.mock.calls[0]![0].data;
    expect(createdIncident.seriesFingerprint).toBe("fp-B");
  });

  it("legacy (non-series) incidents on the same monitor still resolve via the cross-criteria path", async () => {
    const legacyIncident: Incident = new Incident();
    legacyIncident._id = ObjectID.generate().toString();
    legacyIncident.projectId = PROJECT_ID;
    legacyIncident.createdCriteriaId = DOWN_CRITERIA_ID;
    legacyIncident.createdIncidentTemplateId = INCIDENT_TEMPLATE_ID;
    // no seriesFingerprint — legacy whole-monitor incident
    incidentFindByMock.mockResolvedValue([legacyIncident]);

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: buildHealthyCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "All devices are back online.",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: INCIDENT_AUTO_RESOLVE,
      props: {},
      matchesPerSeries: [match(HEALTHY_CRITERIA_ID, "fp-A")],
    });

    expect(resolvedIncidentIds()).toContain(legacyIncident.id!.toString());
  });
});

describe("Per-series alert auto-resolution on recovery", () => {
  it("FULL recovery: healthy criteria matching all series resolves every open per-series alert", async () => {
    const alertA: Alert = buildOpenAlert("fp-A");
    const alertB: Alert = buildOpenAlert("fp-B");
    alertFindByMock.mockResolvedValue([alertA, alertB]);

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: buildHealthyCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "All devices are back online.",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
      props: {},
      matchesPerSeries: [
        match(HEALTHY_CRITERIA_ID, "fp-A"),
        match(HEALTHY_CRITERIA_ID, "fp-B"),
      ],
    });

    const resolved: Array<string> = resolvedAlertIds();
    expect(resolved).toContain(alertA.id!.toString());
    expect(resolved).toContain(alertB.id!.toString());
    expect(alertCreateMock).not.toHaveBeenCalled();
  });

  it("FULL recovery without auto-resolve configured: alerts stay open for human ack", async () => {
    const alertA: Alert = buildOpenAlert("fp-A");
    alertFindByMock.mockResolvedValue([alertA]);

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: buildHealthyCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "All devices are back online.",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: {}, // no auto-resolve
      props: {},
      matchesPerSeries: [match(HEALTHY_CRITERIA_ID, "fp-A")],
    });

    expect(alertTimelineCreateMock).not.toHaveBeenCalled();
  });

  it("PARTIAL recovery: only the recovered series' alert resolves; the still-breaching one stays open", async () => {
    const alertA: Alert = buildOpenAlert("fp-A"); // still down
    const alertB: Alert = buildOpenAlert("fp-B"); // recovered
    alertFindByMock.mockResolvedValue([alertA, alertB]);

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: buildDownCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "Device fp-A is offline.",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
      props: {},
      matchesPerSeries: [match(DOWN_CRITERIA_ID, "fp-A")],
    });

    const resolved: Array<string> = resolvedAlertIds();
    expect(resolved).toContain(alertB.id!.toString());
    expect(resolved).not.toContain(alertA.id!.toString());
    // fp-A already has an open alert — deduped, not recreated.
    expect(alertCreateMock).not.toHaveBeenCalled();
  });

  it("NEW breach while another series recovers: recovered alert resolves, new alert opens for the new breach", async () => {
    const alertA: Alert = buildOpenAlert("fp-A"); // recovered
    alertFindByMock.mockResolvedValue([alertA]);

    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: buildDownCriteria(),
      monitor: buildMonitor(),
      dataToProcess,
      rootCause: "Device fp-B is offline.",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
      props: {},
      matchesPerSeries: [match(DOWN_CRITERIA_ID, "fp-B")],
    });

    const resolved: Array<string> = resolvedAlertIds();
    expect(resolved).toContain(alertA.id!.toString());

    expect(alertCreateMock).toHaveBeenCalledTimes(1);
    const createdAlert: Alert = alertCreateMock.mock.calls[0]![0].data;
    expect(createdAlert.seriesFingerprint).toBe("fp-B");
  });
});
