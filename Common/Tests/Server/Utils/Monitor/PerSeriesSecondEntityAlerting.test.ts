/*
 * The alert/incident creation paths pull the native isolated-vm addon
 * through their template renderer (MonitorAlert → MonitorTemplateUtil →
 * VMAPI → VMRunner). Nothing here touches the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment, so stub it out
 * before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import HostService from "../../../../Server/Services/HostService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The reported bug, pinned at the layer that produced it.
 *
 * A metric monitor grouped by host alerts per host. Host A's disk filled
 * up and got an alert. While that alert was still open, Host B's disk
 * filled up and NOTHING happened — the evaluation logged "an active
 * alert exists for this criteria" and moved on, because the creators
 * decided between per-series and whole-monitor dedupe from whether that
 * tick happened to produce matches rather than from how the monitor is
 * configured.
 *
 * These tests drive the real creators and the real resolve pass with
 * every surrounding service stubbed, and mirror every case across alerts
 * and incidents so the two paths cannot drift apart again.
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
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const CRITICAL_CRITERIA_ID: string = "criteria-critical";
const WARNING_CRITERIA_ID: string = "criteria-warning";

const FP_HOST_A: string = "fp-host-a";
const FP_HOST_B: string = "fp-host-b";
const FP_HOST_C: string = "fp-host-c";

function monitorModel(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "Disk usage by host";
  return model;
}

function criteria(options: {
  id: string;
  name: string;
  createAlerts?: boolean | undefined;
  createIncidents?: boolean | undefined;
  autoResolve?: boolean | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = options.id;
  instance.data!.name = options.name;
  instance.data!.createAlerts = options.createAlerts !== false;
  instance.data!.createIncidents = options.createIncidents !== false;
  instance.data!.alerts = [
    {
      id: `${options.id}-alert-template`,
      title: "Disk usage on {{host.name}} is above threshold",
      description: "{{host.name}} is running out of disk.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: options.autoResolve === true,
    },
  ];
  instance.data!.incidents = [
    {
      id: `${options.id}-incident-template`,
      title: "Disk usage on {{host.name}} is above threshold",
      description: "{{host.name}} is running out of disk.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: options.autoResolve === true,
    },
  ];
  return instance;
}

const dataToProcess: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: new Date("2026-08-27T03:33:00.000Z"),
} as unknown as ProbeMonitorResponse;

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

function seriesMatch(
  criteriaId: string,
  fingerprint: string,
  hostName: string,
): PerSeriesCriteriaMatch {
  const labels: JSONObject = { "host.name": hostName };
  return {
    criteriaMetId: criteriaId,
    fingerprint: fingerprint,
    labels: labels,
    rootCause: `Disk usage on ${hostName} is above 90%`,
  };
}

function openAlertModel(options: {
  id: string;
  criteriaId: string;
  fingerprint?: string | undefined;
}): Alert {
  const alert: Alert = new Alert();
  alert._id = options.id;
  alert.projectId = PROJECT_ID;
  alert.title = "Disk usage is above threshold";
  alert.createdCriteriaId = options.criteriaId;
  if (options.fingerprint) {
    alert.seriesFingerprint = options.fingerprint;
  }
  return alert;
}

function openIncidentModel(options: {
  id: string;
  criteriaId: string;
  fingerprint?: string | undefined;
  templateId?: string | undefined;
}): Incident {
  const incident: Incident = new Incident();
  incident._id = options.id;
  incident.projectId = PROJECT_ID;
  incident.title = "Disk usage is above threshold";
  incident.createdCriteriaId = options.criteriaId;
  incident.createdIncidentTemplateId =
    options.templateId === undefined
      ? `${options.criteriaId}-incident-template`
      : options.templateId;
  if (options.fingerprint) {
    incident.seriesFingerprint = options.fingerprint;
  }
  return incident;
}

function emptyResourceContext(): SeriesResolvedResourceIds {
  return {
    hostIds: [],
    dockerHostIds: [],
    podmanHostIds: [],
    kubernetesClusterIds: [],
    serviceIds: [],
    proxmoxClusterIds: [],
    cephClusterIds: [],
    dockerSwarmClusterIds: [],
    iotFleetIds: [],
  };
}

function emptyEvaluationSummary(): MonitorEvaluationSummary {
  return {
    criteriaResults: [],
    events: [],
  } as unknown as MonitorEvaluationSummary;
}

describe("A second breaching series alerts even while the first is open", () => {
  let createdAlerts: Array<Alert> = [];
  let createdIncidents: Array<Incident> = [];
  let resolvedAlertIds: Array<string> = [];
  let resolvedIncidentIds: Array<string> = [];
  let openAlerts: Array<Alert> = [];
  let openIncidents: Array<Incident> = [];

  beforeEach(() => {
    createdAlerts = [];
    createdIncidents = [];
    resolvedAlertIds = [];
    resolvedIncidentIds = [];
    openAlerts = [];
    openIncidents = [];

    jest.spyOn(AlertService, "findBy").mockImplementation(async () => {
      return openAlerts as never;
    });
    jest.spyOn(IncidentService, "findBy").mockImplementation(async () => {
      return openIncidents as never;
    });

    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);

    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue(emptyResourceContext());

    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

    // The series labels name a host, so the linker looks the host up.
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);

    jest
      .spyOn(AlertService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Alert> => {
        const alert: Alert = (createBy as { data: Alert }).data;
        alert._id = `created-alert-${createdAlerts.length + 1}`;
        createdAlerts.push(alert);
        return alert;
      });

    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        incident._id = `created-incident-${createdIncidents.length + 1}`;
        createdIncidents.push(incident);
        return incident;
      });

    jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);

    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation(async (createBy: unknown): Promise<never> => {
        const timeline: { alertId?: ObjectID } = (
          createBy as { data: { alertId?: ObjectID } }
        ).data;
        resolvedAlertIds.push(String(timeline.alertId));
        return undefined as never;
      });

    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation(async (createBy: unknown): Promise<never> => {
        const timeline: { incidentId?: ObjectID } = (
          createBy as { data: { incidentId?: ObjectID } }
        ).data;
        resolvedIncidentIds.push(String(timeline.incidentId));
        return undefined as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the reported bug", () => {
    it("alerts: host B gets its own alert while host A's alert is open", async () => {
      openAlerts = [
        openAlertModel({
          id: "open-a",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
        }),
      ];

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
        ],
        props: {},
      });

      expect(createdAlerts).toHaveLength(1);
      expect(createdAlerts[0]!.seriesFingerprint).toBe(FP_HOST_B);
      expect(createdAlerts[0]!.seriesLabels).toEqual({
        "host.name": "host-b",
      });
      // Host A's alert is untouched — it is still breaching.
      expect(resolvedAlertIds).toEqual([]);
    });

    it("incidents: host B gets its own incident while host A's incident is open", async () => {
      openIncidents = [
        openIncidentModel({
          id: "open-a",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
        }),
      ];

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
        ],
        props: {},
      });

      expect(createdIncidents).toHaveLength(1);
      expect(createdIncidents[0]!.seriesFingerprint).toBe(FP_HOST_B);
      expect(resolvedIncidentIds).toEqual([]);
    });

    it("alerts: a third host joins later without disturbing the first two", async () => {
      openAlerts = [
        openAlertModel({
          id: "open-a",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
        }),
        openAlertModel({
          id: "open-b",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_B,
        }),
      ];

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_C, "host-c"),
        ],
        props: {},
      });

      expect(createdAlerts).toHaveLength(1);
      expect(createdAlerts[0]!.seriesFingerprint).toBe(FP_HOST_C);
    });

    it("alerts: nothing is created when the only breaching host already has its alert", async () => {
      openAlerts = [
        openAlertModel({
          id: "open-a",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
        }),
      ];

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
          autoResolve: true,
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-alert-template`],
        },
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
        ],
        props: {},
      });

      expect(createdAlerts).toHaveLength(0);
      expect(resolvedAlertIds).toEqual([]);
    });
  });

  describe("ungrouped monitors keep the whole-monitor contract", () => {
    /*
     * A monitor with no group-by raises one alert for the monitor. The
     * evaluator signals that by leaving matchesPerSeries undefined, and
     * the second breach must NOT open a second alert — there is no
     * second entity to distinguish in the data.
     */
    it("alerts: an open whole-monitor alert blocks another one", async () => {
      openAlerts = [
        openAlertModel({
          id: "open-monitor",
          criteriaId: CRITICAL_CRITERIA_ID,
        }),
      ];

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        props: {},
      });

      expect(createdAlerts).toHaveLength(0);
      expect(resolvedAlertIds).toEqual([]);
    });

    it("incidents: an open whole-monitor incident blocks another one", async () => {
      openIncidents = [
        openIncidentModel({
          id: "open-monitor",
          criteriaId: CRITICAL_CRITERIA_ID,
        }),
      ];

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        props: {},
      });

      expect(createdIncidents).toHaveLength(0);
    });
  });

  describe("a monitor that has just been grouped", () => {
    /*
     * The alert raised before the group-by was added carries no
     * fingerprint, so nothing can ever dedupe against it again. Left
     * alone it would sit open forever beside its per-series
     * replacements.
     */
    it("alerts: resolves the stale whole-monitor alert and still creates the per-series ones", async () => {
      openAlerts = [
        openAlertModel({ id: "stale", criteriaId: CRITICAL_CRITERIA_ID }),
      ];

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
          autoResolve: true,
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-alert-template`],
        },
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
        ],
        props: {},
      });

      expect(resolvedAlertIds).toEqual(["stale"]);
      expect(
        createdAlerts.map((alert: Alert) => {
          return alert.seriesFingerprint;
        }),
      ).toEqual([FP_HOST_A, FP_HOST_B]);
    });

    it("incidents: resolves the stale whole-monitor incident and still creates the per-series ones", async () => {
      openIncidents = [
        openIncidentModel({ id: "stale", criteriaId: CRITICAL_CRITERIA_ID }),
      ];

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
          autoResolve: true,
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-incident-template`],
        },
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
        ],
        props: {},
      });

      expect(resolvedIncidentIds).toEqual(["stale"]);
      expect(
        createdIncidents.map((incident: Incident) => {
          return incident.seriesFingerprint;
        }),
      ).toEqual([FP_HOST_A, FP_HOST_B]);
    });

    it("alerts: leaves the stale whole-monitor alert open when its criteria does not auto-resolve", async () => {
      openAlerts = [
        openAlertModel({ id: "stale", criteriaId: CRITICAL_CRITERIA_ID }),
      ];

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
        ],
        props: {},
      });

      expect(resolvedAlertIds).toEqual([]);
      expect(createdAlerts).toHaveLength(1);
      expect(createdAlerts[0]!.seriesFingerprint).toBe(FP_HOST_A);
    });
  });

  describe("severity bands do not resolve each other's alerts", () => {
    const AUTO_RESOLVE_BOTH: Dictionary<Array<string>> = {
      [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-alert-template`],
      [WARNING_CRITERIA_ID]: [`${WARNING_CRITERIA_ID}-alert-template`],
    };

    const AUTO_RESOLVE_BOTH_INCIDENTS: Dictionary<Array<string>> = {
      [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-incident-template`],
      [WARNING_CRITERIA_ID]: [`${WARNING_CRITERIA_ID}-incident-template`],
    };

    it("alerts: host B's warning alert survives host A going critical", async () => {
      openAlerts = [
        openAlertModel({
          id: "warning-b",
          criteriaId: WARNING_CRITERIA_ID,
          fingerprint: FP_HOST_B,
        }),
      ];

      await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: AUTO_RESOLVE_BOTH,
        rootCause: "Disk usage is above 95% on host-a",
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 95%",
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_A, FP_HOST_B]),
        breachingSeriesFingerprintsByCriteriaId: {
          [CRITICAL_CRITERIA_ID]: new Set<string>([FP_HOST_A]),
          [WARNING_CRITERIA_ID]: new Set<string>([FP_HOST_B]),
        },
      });

      expect(resolvedAlertIds).toEqual([]);
    });

    it("incidents: host B's warning incident survives host A going critical", async () => {
      openIncidents = [
        openIncidentModel({
          id: "warning-b",
          criteriaId: WARNING_CRITERIA_ID,
          fingerprint: FP_HOST_B,
        }),
      ];

      await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          AUTO_RESOLVE_BOTH_INCIDENTS,
        rootCause: "Disk usage is above 95% on host-a",
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 95%",
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_A, FP_HOST_B]),
        breachingSeriesFingerprintsByCriteriaId: {
          [CRITICAL_CRITERIA_ID]: new Set<string>([FP_HOST_A]),
          [WARNING_CRITERIA_ID]: new Set<string>([FP_HOST_B]),
        },
      });

      expect(resolvedIncidentIds).toEqual([]);
    });

    it("alerts: host B's warning alert resolves once host B stops breaching the warning band", async () => {
      openAlerts = [
        openAlertModel({
          id: "warning-b",
          criteriaId: WARNING_CRITERIA_ID,
          fingerprint: FP_HOST_B,
        }),
      ];

      const survivors: Array<Alert> =
        await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          monitorId: MONITOR_ID,
          autoResolveCriteriaInstanceIdAlertIdsDictionary: AUTO_RESOLVE_BOTH,
          rootCause: "host-b recovered",
          criteriaInstance: criteria({
            id: CRITICAL_CRITERIA_ID,
            name: "Disk > 95%",
          }),
          dataToProcess: dataToProcess,
          evaluationSummary: emptyEvaluationSummary(),
          breachingSeriesFingerprints: new Set<string>([FP_HOST_A]),
          breachingSeriesFingerprintsByCriteriaId: {
            [CRITICAL_CRITERIA_ID]: new Set<string>([FP_HOST_A]),
            // Warning ran this tick and matched nothing.
            [WARNING_CRITERIA_ID]: new Set<string>(),
          },
        });

      expect(resolvedAlertIds).toEqual(["warning-b"]);
      // The resolved alert must not be handed to the create path.
      expect(survivors).toHaveLength(0);
    });

    it("alerts: an alert whose criteria was not evaluated at all is left alone", async () => {
      openAlerts = [
        openAlertModel({
          id: "warning-b",
          criteriaId: WARNING_CRITERIA_ID,
          fingerprint: FP_HOST_B,
        }),
      ];

      await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: AUTO_RESOLVE_BOTH,
        rootCause: "Disk usage is above 95% on host-a",
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 95%",
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_A]),
        breachingSeriesFingerprintsByCriteriaId: {
          // The warning criteria is absent: it never ran (disabled/deleted).
          [CRITICAL_CRITERIA_ID]: new Set<string>([FP_HOST_A]),
        },
      });

      expect(resolvedAlertIds).toEqual([]);
    });

    it("incidents: an incident whose criteria was not evaluated at all is left alone", async () => {
      openIncidents = [
        openIncidentModel({
          id: "warning-b",
          criteriaId: WARNING_CRITERIA_ID,
          fingerprint: FP_HOST_B,
        }),
      ];

      await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          AUTO_RESOLVE_BOTH_INCIDENTS,
        rootCause: "Disk usage is above 95% on host-a",
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 95%",
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_A]),
        breachingSeriesFingerprintsByCriteriaId: {
          [CRITICAL_CRITERIA_ID]: new Set<string>([FP_HOST_A]),
        },
      });

      expect(resolvedIncidentIds).toEqual([]);
    });
  });

  describe("recovery ticks still resolve (no per-criteria map available)", () => {
    /*
     * Regression guard for PerSeriesRecoveryResolution: when only the
     * single-set form is available, a matched criteria that creates
     * nothing is a recovery criteria and its "matches" are healthy
     * series, so the open per-series record must resolve.
     */
    it("alerts: resolves on a recovery tick even though the fingerprint is in the matched set", async () => {
      openAlerts = [
        openAlertModel({
          id: "offline-a",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
        }),
      ];

      await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-alert-template`],
        },
        rootCause: "host-a is back",
        criteriaInstance: criteria({
          id: "criteria-recovery",
          name: "Disk is healthy",
          createAlerts: false,
          createIncidents: false,
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_A]),
      });

      expect(resolvedAlertIds).toEqual(["offline-a"]);
    });

    it("incidents: resolves on a recovery tick even though the fingerprint is in the matched set", async () => {
      openIncidents = [
        openIncidentModel({
          id: "offline-a",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
        }),
      ];

      await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-incident-template`],
        },
        rootCause: "host-a is back",
        criteriaInstance: criteria({
          id: "criteria-recovery",
          name: "Disk is healthy",
          createAlerts: false,
          createIncidents: false,
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_A]),
      });

      expect(resolvedIncidentIds).toEqual(["offline-a"]);
    });

    it("incidents: an incident whose template carries no id can still auto-resolve", async () => {
      /*
       * Criteria authored through the API can ship an incident template
       * with no id, so the created incident stores no
       * createdIncidentTemplateId. Requiring an exact template match
       * meant such an incident could never resolve — and, staying open,
       * its criteria could never raise a new one either.
       */
      openIncidents = [
        openIncidentModel({
          id: "template-less",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
          templateId: "",
        }),
      ];

      await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-incident-template`],
        },
        rootCause: "host-a is back",
        criteriaInstance: criteria({
          id: "criteria-recovery",
          name: "Disk is healthy",
          createAlerts: false,
          createIncidents: false,
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>(),
      });

      expect(resolvedIncidentIds).toEqual(["template-less"]);
    });
  });

  describe("event-driven (incoming request) grouping is untouched", () => {
    it("alerts: a per-key alert is never resolved by absence", async () => {
      openAlerts = [
        openAlertModel({
          id: "key-a",
          criteriaId: CRITICAL_CRITERIA_ID,
          fingerprint: FP_HOST_A,
        }),
      ];

      await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-alert-template`],
        },
        rootCause: "another key fired",
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Grafana alert",
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_B]),
        disableSeriesAbsenceResolution: true,
      });

      expect(resolvedAlertIds).toEqual([]);
    });

    it("alerts: a whole-monitor alert is not resolved as 'stale' on a webhook tick", async () => {
      openAlerts = [
        openAlertModel({ id: "whole", criteriaId: CRITICAL_CRITERIA_ID }),
      ];

      await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          [CRITICAL_CRITERIA_ID]: [`${CRITICAL_CRITERIA_ID}-alert-template`],
        },
        rootCause: "a key fired",
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Grafana alert",
        }),
        dataToProcess: dataToProcess,
        evaluationSummary: emptyEvaluationSummary(),
        breachingSeriesFingerprints: new Set<string>([FP_HOST_A]),
        disableSeriesAbsenceResolution: true,
      });

      expect(resolvedAlertIds).toEqual([]);
    });
  });

  describe("one series' failure does not silence the rest of the fleet", () => {
    it("alerts: a project with no severity configured skips instead of failing the whole evaluation", async () => {
      jest
        .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
        .mockResolvedValue(false);
      jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue(null);

      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await expect(
        MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
          criteriaInstance: criteria({
            id: CRITICAL_CRITERIA_ID,
            name: "Disk > 90%",
          }),
          monitor: monitorModel(),
          dataToProcess: dataToProcess,
          rootCause: "Disk usage is above 90%",
          autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
          matchesPerSeries: [
            seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
            seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
          ],
          evaluationSummary: summary,
          props: {},
        }),
      ).resolves.toBeUndefined();

      expect(createdAlerts).toHaveLength(0);
      expect(
        summary.events.filter((event: { type: string }) => {
          return event.type === "alert-skipped";
        }),
      ).toHaveLength(2);
    });

    it("alerts: a create that throws for one host still lets the others through", async () => {
      jest
        .spyOn(AlertService, "create")
        .mockImplementation(async (createBy: unknown): Promise<Alert> => {
          const alert: Alert = (createBy as { data: Alert }).data;

          if (alert.seriesFingerprint === FP_HOST_A) {
            throw new Error("row could not be written");
          }

          alert._id = `created-alert-${createdAlerts.length + 1}`;
          createdAlerts.push(alert);
          return alert;
        });

      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_C, "host-c"),
        ],
        evaluationSummary: summary,
        props: {},
      });

      expect(
        createdAlerts.map((alert: Alert) => {
          return alert.seriesFingerprint;
        }),
      ).toEqual([FP_HOST_B, FP_HOST_C]);
    });

    it("incidents: a create that throws for one host still lets the others through", async () => {
      jest
        .spyOn(IncidentService, "create")
        .mockImplementation(async (createBy: unknown): Promise<Incident> => {
          const incident: Incident = (createBy as { data: Incident }).data;

          if (incident.seriesFingerprint === FP_HOST_A) {
            throw new Error("row could not be written");
          }

          incident._id = `created-incident-${createdIncidents.length + 1}`;
          createdIncidents.push(incident);
          return incident;
        });

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_C, "host-c"),
        ],
        evaluationSummary: emptyEvaluationSummary(),
        props: {},
      });

      expect(
        createdIncidents.map((incident: Incident) => {
          return incident.seriesFingerprint;
        }),
      ).toEqual([FP_HOST_B, FP_HOST_C]);
    });
  });

  describe("the caller can own the resolve pass", () => {
    it("alerts: a supplied open set is used and no query is issued", async () => {
      const findBySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        AlertService,
        "findBy",
      );

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
        ],
        openAlerts: [
          openAlertModel({
            id: "open-a",
            criteriaId: CRITICAL_CRITERIA_ID,
            fingerprint: FP_HOST_A,
          }),
        ],
        props: {},
      });

      expect(findBySpy.mock.calls).toHaveLength(0);
      expect(createdAlerts).toHaveLength(1);
      expect(createdAlerts[0]!.seriesFingerprint).toBe(FP_HOST_B);
    });

    it("incidents: a supplied open set is used and no query is issued", async () => {
      const findBySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        IncidentService,
        "findBy",
      );

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
        ],
        openIncidents: [
          openIncidentModel({
            id: "open-a",
            criteriaId: CRITICAL_CRITERIA_ID,
            fingerprint: FP_HOST_A,
          }),
        ],
        props: {},
      });

      expect(findBySpy.mock.calls).toHaveLength(0);
      expect(createdIncidents).toHaveLength(1);
      expect(createdIncidents[0]!.seriesFingerprint).toBe(FP_HOST_B);
    });
  });

  describe("maintenance suppression is per series", () => {
    it("alerts: suppressing one host's resource still alerts on the others", async () => {
      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteria({
          id: CRITICAL_CRITERIA_ID,
          name: "Disk > 90%",
        }),
        monitor: monitorModel(),
        dataToProcess: dataToProcess,
        rootCause: "Disk usage is above 90%",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        matchesPerSeries: [
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_A, "host-a"),
          seriesMatch(CRITICAL_CRITERIA_ID, FP_HOST_B, "host-b"),
        ],
        suppressedSeriesFingerprints: new Set<string>([FP_HOST_A]),
        evaluationSummary: emptyEvaluationSummary(),
        props: {},
      });

      expect(
        createdAlerts.map((alert: Alert) => {
          return alert.seriesFingerprint;
        }),
      ).toEqual([FP_HOST_B]);
    });
  });
});
