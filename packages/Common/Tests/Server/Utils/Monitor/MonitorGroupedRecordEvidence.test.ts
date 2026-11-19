import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import SeriesResourceLinker from "../../../../Server/Utils/Monitor/SeriesResourceLinker";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import {
  EVIDENCE_SCOPE_FIELD,
  STORED_CHECK_MAX_SIZE_IN_BYTES,
} from "../../../../Utils/Monitor/StoredCheckEvidence";
import {
  GroupedMetricCheck,
  fingerprintOf,
  groupedMetricCheck,
  seriesLabels,
} from "../../../Helpers/GroupedMetricCheck";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
import OwnerRuleAssignment from "../../../../Server/Utils/Rules/OwnerRuleAssignment";

/*
 * A GROUPED METRIC MONITOR'S ALERTS AND INCIDENTS KEEP THEIR OWN SERIES
 * (issue #9189), through the real creation and auto-resolve paths with the
 * services around them stubbed.
 *
 * The monitor of the issue - container restarts grouped by host and
 * container - opened fifteen alerts on one host restart, and each kept
 * every series of the fleet: on the alert (createdStateLog), copied to its
 * Identified row, and again on its Resolved row.
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
  "88888888-8888-4888-8888-888888888888",
);

const FLEET_SIZE: number = 2000;
const BREACHING: Array<number> = [3, 401, 1999];

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "Container restarts";
  return model;
}

function criteriaInstance(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Restarted";
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = true;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "Container restarted",
      description: "A container restarted.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: true,
    },
  ];
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "Container restarted",
      description: "A container restarted.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: true,
    },
  ];
  return instance;
}

function matches(): Array<PerSeriesCriteriaMatch> {
  return BREACHING.map((index: number): PerSeriesCriteriaMatch => {
    return {
      criteriaMetId: "criteria-1",
      fingerprint: fingerprintOf(index),
      labels: seriesLabels(index),
      rootCause: `Series ${index} restarted.`,
      metricContext: undefined,
    };
  });
}

function expectOwnSeries(log: JSONObject, index: number): void {
  const breakdown: Array<JSONObject> = log[
    "seriesBreakdown"
  ] as Array<JSONObject>;

  expect(breakdown).toHaveLength(1);
  expect(breakdown[0]!["fingerprint"]).toBe(fingerprintOf(index));

  for (const result of log["metricResult"] as Array<JSONObject>) {
    for (const row of result["data"] as Array<JSONObject>) {
      expect(row["attributes"]).toEqual(seriesLabels(index));
    }
  }

  expect(log[EVIDENCE_SCOPE_FIELD]).toEqual({
    seriesFingerprint: fingerprintOf(index),
    seriesInEvaluation: FLEET_SIZE,
  });
  expect(bytes(log)).toBeLessThan(16 * 1024);
}

describe("a grouped metric monitor's records keep their own series", () => {
  let fleet: GroupedMetricCheck;
  let createdIncidents: Array<Incident> = [];
  let createdAlerts: Array<Alert> = [];
  let incidentStateTimelines: Array<IncidentStateTimeline> = [];
  let alertStateTimelines: Array<AlertStateTimeline> = [];

  beforeEach(() => {
    mockProjectStates();
    fleet = groupedMetricCheck({ seriesCount: FLEET_SIZE });
    createdIncidents = [];
    createdAlerts = [];
    incidentStateTimelines = [];
    alertStateTimelines = [];

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
    jest
      .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
    jest
      .spyOn(SeriesResourceLinker, "linkSeriesResourcesToModel")
      .mockResolvedValue(undefined);

    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        createdIncidents.push(incident);
        incident._id = ObjectID.generate().toString();
        return incident;
      });
    jest
      .spyOn(AlertService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Alert> => {
        const alert: Alert = (createBy as { data: Alert }).data;
        createdAlerts.push(alert);
        alert._id = ObjectID.generate().toString();
        return alert;
      });

    jest
      .spyOn(IncidentService, "addOwners")
      .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());
    jest
      .spyOn(AlertService, "addOwners")
      .mockResolvedValue(OwnerRuleAssignment.noOwnersAdded());

    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation(
        async (createBy: unknown): Promise<IncidentStateTimeline> => {
          const timeline: IncidentStateTimeline = (
            createBy as { data: IncidentStateTimeline }
          ).data;
          incidentStateTimelines.push(timeline);
          return timeline;
        },
      );
    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation(
        async (createBy: unknown): Promise<AlertStateTimeline> => {
          const timeline: AlertStateTimeline = (
            createBy as { data: AlertStateTimeline }
          ).data;
          alertStateTimelines.push(timeline);
          return timeline;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("each alert opened for a series keeps that series only", async () => {
    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: fleet.check,
      rootCause: "Containers restarted.",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
      monitorSummary: null,
      props: {},
      matchesPerSeries: matches(),
    });

    expect(createdAlerts).toHaveLength(BREACHING.length);

    createdAlerts.forEach((alert: Alert, i: number) => {
      expect(alert.seriesFingerprint).toBe(fingerprintOf(BREACHING[i]!));
      expectOwnSeries(alert.createdStateLog!, BREACHING[i]!);
    });
  });

  it("each incident opened for a series keeps that series only", async () => {
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: fleet.check,
      rootCause: "Containers restarted.",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
      monitorSummary: null,
      props: {},
      matchesPerSeries: matches(),
    });

    expect(createdIncidents).toHaveLength(BREACHING.length);

    createdIncidents.forEach((incident: Incident, i: number) => {
      expect(incident.seriesFingerprint).toBe(fingerprintOf(BREACHING[i]!));
      expectOwnSeries(incident.createdStateLog!, BREACHING[i]!);
    });
  });

  it("an alert resolved per series keeps the resolving series on its Resolved row", async () => {
    const openAlert: Alert = new Alert();
    openAlert._id = ObjectID.generate().toString();
    openAlert.projectId = PROJECT_ID;
    openAlert.createdCriteriaId = "criteria-1";
    openAlert.seriesFingerprint = fingerprintOf(401);
    openAlert.seriesLabels = seriesLabels(401);

    jest.spyOn(AlertService, "findBy").mockResolvedValue([openAlert]);

    await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      autoResolveCriteriaInstanceIdAlertIdsDictionary: {
        "criteria-1": ["alert-template-1"],
      },
      rootCause: "No monitoring criteria met.",
      criteriaInstance: null,
      dataToProcess: fleet.check,
      // No series breaches any more.
      breachingSeriesFingerprints: new Set<string>(),
    });

    expect(alertStateTimelines).toHaveLength(1);
    expect(alertStateTimelines[0]!.alertStateId).toBe(RESOLVED_STATE_ID);
    expectOwnSeries(alertStateTimelines[0]!.stateChangeLog!, 401);
  });

  it("an incident resolved per series keeps the resolving series on its Resolved row", async () => {
    const openIncident: Incident = new Incident();
    openIncident._id = ObjectID.generate().toString();
    openIncident.projectId = PROJECT_ID;
    openIncident.createdCriteriaId = "criteria-1";
    openIncident.createdIncidentTemplateId = "incident-template-1";
    openIncident.seriesFingerprint = fingerprintOf(1999);
    openIncident.seriesLabels = seriesLabels(1999);

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([openIncident]);

    await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
        "criteria-1": ["incident-template-1"],
      },
      rootCause: "No monitoring criteria met.",
      criteriaInstance: null,
      dataToProcess: fleet.check,
      breachingSeriesFingerprints: new Set<string>(),
    });

    expect(incidentStateTimelines).toHaveLength(1);
    expect(incidentStateTimelines[0]!.incidentStateId).toBe(RESOLVED_STATE_ID);
    expectOwnSeries(incidentStateTimelines[0]!.stateChangeLog!, 1999);
  });

  it("a whole-monitor alert of the same fleet is kept within the size limit", async () => {
    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance(),
      monitor: monitor(),
      dataToProcess: fleet.check,
      rootCause: "Containers restarted.",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
      monitorSummary: null,
      props: {},
    });

    expect(createdAlerts).toHaveLength(1);

    const log: JSONObject = createdAlerts[0]!.createdStateLog!;

    expect(bytes(log)).toBeLessThanOrEqual(STORED_CHECK_MAX_SIZE_IN_BYTES);
    expect(log["isEvidenceTruncated"]).toBe(true);
  });
});
