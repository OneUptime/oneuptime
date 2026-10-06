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
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSummarySnapshot from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import MonitorSummarySnapshotUtil from "../../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import {
  assertJsonbAccepts,
  jsonbWouldRefuse,
} from "../../../Helpers/PostgresJsonbInput";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The incident and alert a check opens, and the state change that resolves
 * them, each store a copy of the check's payload in jsonb:
 *
 *   - Incident.createdStateLog / Alert.createdStateLog - the raw payload,
 *     copied on into the incident state timeline and the monitor status
 *     change log;
 *   - Incident.monitorSummary / Alert.monitorSummary - the frozen Monitor
 *     Summary (MonitorSummaryCapture), which holds the response body;
 *   - Incident.seriesLabels / Alert.seriesLabels - the series a grouped
 *     monitor matched, which for an Incoming Request monitor are values
 *     straight out of the webhook body;
 *   - IncidentStateTimeline.stateChangeLog / AlertStateTimeline
 *     .stateChangeLog - the payload that auto-resolved them.
 *
 * A NUL in any of them made Postgres refuse the INSERT ("unsupported Unicode
 * escape sequence"), so the incident or alert never opened - or never
 * resolved. These drive the real creation and resolution paths with the
 * surrounding services stubbed; the create stubs refuse exactly what
 * Postgres refuses (Tests/Helpers/PostgresJsonbInput).
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

// The first bytes of a ZIP archive, as a probe decodes them.
const ZIP_BODY: string = "PK\u0003\u0004\u0014\u0000\u0000\u0000\u0008\u0000";
const STORED_ZIP_BODY: string =
  "PK\u0003\u0004\u0014\uFFFD\uFFFD\uFFFD\u0008\uFFFD";

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Website;
  model.name = "Downloads";
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
      title: "Download is broken",
      description: "The download link returned something unexpected.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: true,
    },
  ];
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "Download is broken",
      description: "The download link returned something unexpected.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: true,
    },
  ];
  return instance;
}

function probeResult(): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: true,
    responseCode: 200,
    responseBody: ZIP_BODY,
    responseHeaders: {
      "content-type": "application/zip",
      "x-request\u0000id": "abc\u0000def",
    },
    failureCause: "",
    monitoredAt: new Date("2026-10-06T10:00:00.000Z"),
  } as unknown as ProbeMonitorResponse;
}

/*
 * The summary MonitorSummaryCapture would freeze for this check: built by
 * the real util, so it holds the live payload, body and all.
 */
function summaryOf(payload: ProbeMonitorResponse): MonitorSummarySnapshot {
  return MonitorSummarySnapshotUtil.buildSnapshot({
    monitorType: MonitorType.Website,
    dataToProcess: payload,
    monitorId: MONITOR_ID.toString(),
    monitorName: "Downloads",
    probeName: "Frankfurt",
    capturedAt: new Date("2026-10-06T10:00:01.000Z"),
  })!;
}

// A grouped (per-series) match whose label came out of a webhook body.
function seriesMatch(): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: "criteria-1",
    fingerprint: "0123456789abcdef",
    labels: { alertname: "disk\u0000full" },
    rootCause: "Incoming request matched grouping key.",
    metricContext: undefined,
  };
}

describe("Incidents and alerts store payload copies Postgres can hold", () => {
  let createdIncidents: Array<Incident> = [];
  let createdAlerts: Array<Alert> = [];
  let incidentStateTimelines: Array<IncidentStateTimeline> = [];
  let alertStateTimelines: Array<AlertStateTimeline> = [];

  beforeEach(() => {
    createdIncidents = [];
    createdAlerts = [];
    incidentStateTimelines = [];
    alertStateTimelines = [];

    // No incident / alert is already open for this monitor.
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

    // Which resources a series names is covered elsewhere.
    jest
      .spyOn(SeriesResourceLinker, "linkSeriesResourcesToModel")
      .mockResolvedValue(undefined);

    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;

        // Each jsonb column, as Postgres would take it.
        assertJsonbAccepts(incident.createdStateLog);
        assertJsonbAccepts(incident.monitorSummary);
        assertJsonbAccepts(incident.seriesLabels);

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

        assertJsonbAccepts(alert.createdStateLog);
        assertJsonbAccepts(alert.monitorSummary);
        assertJsonbAccepts(alert.seriesLabels);

        createdAlerts.push(alert);
        alert._id = new ObjectID(
          "77777777-7777-4777-8777-777777777777",
        ).toString();
        return alert;
      });

    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
    jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);

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

          assertJsonbAccepts(timeline.stateChangeLog);
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

          assertJsonbAccepts(timeline.stateChangeLog);
          alertStateTimelines.push(timeline);
          return timeline;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("the payload and its summary are what Postgres refused", () => {
    const payload: ProbeMonitorResponse = probeResult();

    // What the old code stored, for each column.
    expect(jsonbWouldRefuse(JSON.parse(JSON.stringify(payload)))).toBe(true);
    expect(
      jsonbWouldRefuse(
        MonitorSummarySnapshotUtil.serialize(summaryOf(payload)),
      ),
    ).toBe(true);
  });

  describe("an incident opened from a check whose body held NUL", () => {
    it("is created, with a storable createdStateLog", async () => {
      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance({
          createIncidents: true,
          createAlerts: false,
        }),
        monitor: monitor(),
        dataToProcess: probeResult(),
        rootCause: "Monitor is offline",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        monitorSummary: null,
        props: {},
      });

      expect(createdIncidents).toHaveLength(1);

      const createdStateLog: JSONObject = createdIncidents[0]!.createdStateLog!;

      expect(createdStateLog["responseBody"]).toBe(STORED_ZIP_BODY);
      expect(createdStateLog["responseHeaders"]).toEqual({
        "content-type": "application/zip",
        "x-request\uFFFDid": "abc\uFFFDdef",
      });
      expect(createdStateLog["responseCode"]).toBe(200);
    });

    it("stores a storable monitor summary that still reads back", async () => {
      const payload: ProbeMonitorResponse = probeResult();

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance({
          createIncidents: true,
          createAlerts: false,
        }),
        monitor: monitor(),
        dataToProcess: payload,
        rootCause: "Monitor is offline",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        monitorSummary: summaryOf(payload),
        props: {},
      });

      const stored: JSONObject = createdIncidents[0]!.monitorSummary!;

      expect(jsonbWouldRefuse(stored)).toBe(false);

      /*
       * Made storable after serialize(), so the page still gets its Dates
       * back as Dates.
       */
      const readBack: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.deserialize(
          JSON.parse(JSON.stringify(stored)) as JSONObject,
        );

      expect(readBack).not.toBeNull();
      expect(readBack!.capturedAt).toBeInstanceOf(Date);
      expect(readBack!.probeName).toBe("Frankfurt");
      expect(readBack!.probeMonitorResponse?.responseBody).toBe(
        STORED_ZIP_BODY,
      );
    });

    it("stores storable series labels for a grouped match", async () => {
      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance({
          createIncidents: true,
          createAlerts: false,
        }),
        monitor: monitor(),
        dataToProcess: probeResult(),
        rootCause: "Monitor is offline",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        monitorSummary: null,
        props: {},
        matchesPerSeries: [seriesMatch()],
      });

      expect(createdIncidents).toHaveLength(1);
      expect(createdIncidents[0]!.seriesLabels).toEqual({
        alertname: "disk\uFFFDfull",
      });
      expect(createdIncidents[0]!.seriesFingerprint).toBe("0123456789abcdef");
    });

    it("leaves the payload, summary and labels it was handed untouched", async () => {
      const payload: ProbeMonitorResponse = probeResult();
      const summary: MonitorSummarySnapshot = summaryOf(payload);
      const match: PerSeriesCriteriaMatch = seriesMatch();

      await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance({
          createIncidents: true,
          createAlerts: false,
        }),
        monitor: monitor(),
        dataToProcess: payload,
        rootCause: "Monitor is offline",
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
        monitorSummary: summary,
        props: {},
        matchesPerSeries: [match],
      });

      // The evaluation that follows still reads these as they arrived.
      expect(payload.responseBody).toBe(ZIP_BODY);
      expect(summary.probeMonitorResponse?.responseBody).toBe(ZIP_BODY);
      expect(match.labels).toEqual({ alertname: "disk\u0000full" });
    });

    it("resolves an auto-resolving incident with a storable stateChangeLog", async () => {
      const openIncident: Incident = new Incident();
      openIncident._id = new ObjectID(
        "99999999-9999-4999-8999-999999999999",
      ).toString();
      openIncident.projectId = PROJECT_ID;
      openIncident.createdCriteriaId = "criteria-1";
      openIncident.createdIncidentTemplateId = "incident-template-1";

      jest.spyOn(IncidentService, "findBy").mockResolvedValue([openIncident]);

      // No criteria met on this check: the open incident auto-resolves.
      await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
          "criteria-1": ["incident-template-1"],
        },
        rootCause: "No monitoring criteria met.",
        criteriaInstance: null,
        dataToProcess: probeResult(),
      });

      expect(incidentStateTimelines).toHaveLength(1);
      expect(incidentStateTimelines[0]!.incidentStateId).toBe(
        RESOLVED_STATE_ID,
      );
      expect(incidentStateTimelines[0]!.stateChangeLog!["responseBody"]).toBe(
        STORED_ZIP_BODY,
      );
    });
  });

  describe("an alert opened from a check whose body held NUL", () => {
    it("is created, with a storable createdStateLog", async () => {
      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance({
          createIncidents: false,
          createAlerts: true,
        }),
        monitor: monitor(),
        dataToProcess: probeResult(),
        rootCause: "Monitor is offline",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        monitorSummary: null,
        props: {},
      });

      expect(createdAlerts).toHaveLength(1);

      const createdStateLog: JSONObject = createdAlerts[0]!.createdStateLog!;

      expect(createdStateLog["responseBody"]).toBe(STORED_ZIP_BODY);
      expect(createdStateLog["responseHeaders"]).toEqual({
        "content-type": "application/zip",
        "x-request\uFFFDid": "abc\uFFFDdef",
      });
    });

    it("stores a storable monitor summary that still reads back", async () => {
      const payload: ProbeMonitorResponse = probeResult();

      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance({
          createIncidents: false,
          createAlerts: true,
        }),
        monitor: monitor(),
        dataToProcess: payload,
        rootCause: "Monitor is offline",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        monitorSummary: summaryOf(payload),
        props: {},
      });

      const stored: JSONObject = createdAlerts[0]!.monitorSummary!;

      expect(jsonbWouldRefuse(stored)).toBe(false);

      const readBack: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.deserialize(
          JSON.parse(JSON.stringify(stored)) as JSONObject,
        );

      expect(readBack!.capturedAt).toBeInstanceOf(Date);
      expect(readBack!.probeMonitorResponse?.responseBody).toBe(
        STORED_ZIP_BODY,
      );
    });

    it("stores storable series labels for a grouped match", async () => {
      await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
        criteriaInstance: criteriaInstance({
          createIncidents: false,
          createAlerts: true,
        }),
        monitor: monitor(),
        dataToProcess: probeResult(),
        rootCause: "Monitor is offline",
        autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
        monitorSummary: null,
        props: {},
        matchesPerSeries: [seriesMatch()],
      });

      expect(createdAlerts).toHaveLength(1);
      expect(createdAlerts[0]!.seriesLabels).toEqual({
        alertname: "disk\uFFFDfull",
      });
    });

    it("resolves an auto-resolving alert with a storable stateChangeLog", async () => {
      const openAlert: Alert = new Alert();
      openAlert._id = new ObjectID(
        "99999999-9999-4999-8999-999999999998",
      ).toString();
      openAlert.projectId = PROJECT_ID;
      openAlert.createdCriteriaId = "criteria-1";

      jest.spyOn(AlertService, "findBy").mockResolvedValue([openAlert]);

      await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          "criteria-1": ["alert-template-1"],
        },
        rootCause: "No monitoring criteria met.",
        criteriaInstance: null,
        dataToProcess: probeResult(),
      });

      expect(alertStateTimelines).toHaveLength(1);
      expect(alertStateTimelines[0]!.alertStateId).toBe(RESOLVED_STATE_ID);
      expect(alertStateTimelines[0]!.stateChangeLog!["responseBody"]).toBe(
        STORED_ZIP_BODY,
      );
    });
  });
});
