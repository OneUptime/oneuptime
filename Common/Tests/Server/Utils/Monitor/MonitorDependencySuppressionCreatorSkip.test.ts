/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service used below
 * extends) imports it. Nothing password-related is under test here, so the
 * module is replaced WITH A FACTORY — an automock would still require (and
 * type-check) the real file.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

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
import MonitorClusterContextUtil from "../../../../Server/Utils/Monitor/MonitorClusterContext";
import { DependencySuppressionResult } from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import Dictionary from "../../../../Types/Dictionary";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
  MonitorEvaluationEventType,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * PR #3122 (alert-dependency suppression) added a skip block to BOTH
 * creators — MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus and
 * MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus. These
 * tests pin the block's contract, which the util-level tests
 * (MonitorDependencySuppression.test.ts) cannot see:
 *
 *   - isSuppressed=true → the create service is never called and exactly
 *     one "alert-skipped"/"incident-skipped" event naming the suppressing
 *     parent (via buildSuppressionReason) is pushed.
 *   - The open-alert/open-incident RESOLVE pass still runs first —
 *     resolution is never suppressed, only creation.
 *   - dependencySuppression undefined or {isSuppressed:false} → the flow
 *     proceeds past the skip block exactly as before the feature.
 *   - createAlerts/createIncidents=false returns BEFORE the skip block, so
 *     a suppressed evaluation of a non-creating criteria pushes no event.
 *   - The resolve-only entry points take no suppression input at all, so
 *     suppression state cannot block resolution.
 *
 * Mocking follows MonitorSummaryPersistence.test.ts: the real creators run
 * with the surrounding services stubbed, and assertions are made on what
 * was handed to AlertService.create / IncidentService.create.
 */

// The house workaround for @jest/globals vs @types/jest spy typing.
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

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

const SUPPRESSING_PARENT_NAME: string = "Core Router";

function suppressed(): DependencySuppressionResult {
  return {
    isSuppressed: true,
    suppressingParents: [
      {
        monitorId: "99999999-9999-4999-8999-999999999999",
        monitorName: SUPPRESSING_PARENT_NAME,
        statusName: "Offline",
      },
    ],
  };
}

function notSuppressed(): DependencySuppressionResult {
  return {
    isSuppressed: false,
    suppressingParents: [],
  };
}

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Website;
  model.name = "Child API Monitor";
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
  monitoredAt: new Date("2026-07-31T10:00:00.000Z"),
} as unknown as ProbeMonitorResponse;

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

function emptyEvaluationSummary(): MonitorEvaluationSummary {
  return {
    evaluatedAt: new Date("2026-07-31T10:00:00.000Z"),
    criteriaResults: [],
    events: [],
  };
}

function eventsOfType(
  summary: MonitorEvaluationSummary,
  type: MonitorEvaluationEventType,
): Array<MonitorEvaluationEvent> {
  return summary.events.filter((event: MonitorEvaluationEvent) => {
    return event.type === type;
  });
}

describe("Dependency-suppression skip block in the alert / incident creators", () => {
  let createdIncidents: Array<Incident> = [];
  let createdAlerts: Array<Alert> = [];
  let createdAlertStateTimelines: Array<AlertStateTimeline> = [];
  let createdIncidentStateTimelines: Array<IncidentStateTimeline> = [];

  let alertFindBySpy: SpyLike;
  let incidentFindBySpy: SpyLike;
  let clusterContextSpy: SpyLike;

  beforeEach(() => {
    createdIncidents = [];
    createdAlerts = [];
    createdAlertStateTimelines = [];
    createdIncidentStateTimelines = [];

    // No incident / alert is already open for this monitor (per-test overrides re-spy).
    incidentFindBySpy = jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([]) as unknown as SpyLike;
    alertFindBySpy = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([]) as unknown as SpyLike;

    // The criteria's severity belongs to this project, so no fallback lookup.
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);

    /*
     * First statement AFTER the dependency-suppression skip block in both
     * creators — its call count is how these tests observe whether the flow
     * proceeded past the block.
     */
    clusterContextSpy = jest
      .spyOn(MonitorClusterContextUtil, "resolveClusterContextForMonitor")
      .mockResolvedValue({
        proxmoxClusterIds: [],
        cephClusterIds: [],
        dockerSwarmClusterIds: [],
        iotFleetIds: [],
      }) as unknown as SpyLike;

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

    // The resolve pass (test 5's entry points) writes a resolved state timeline.
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation(
        async (createBy: unknown): Promise<AlertStateTimeline> => {
          const timeline: AlertStateTimeline = (
            createBy as { data: AlertStateTimeline }
          ).data;
          createdAlertStateTimelines.push(timeline);
          return timeline;
        },
      );

    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation(
        async (createBy: unknown): Promise<IncidentStateTimeline> => {
          const timeline: IncidentStateTimeline = (
            createBy as { data: IncidentStateTimeline }
          ).data;
          createdIncidentStateTimelines.push(timeline);
          return timeline;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runAlertCreator(input: {
    createAlerts: boolean;
    dependencySuppression: DependencySuppressionResult | undefined;
    summary: MonitorEvaluationSummary;
  }): Promise<void> {
    await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: false,
        createAlerts: input.createAlerts,
      }),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
      evaluationSummary: input.summary,
      dependencySuppression: input.dependencySuppression,
      props: {},
    });
  }

  async function runIncidentCreator(input: {
    createIncidents: boolean;
    dependencySuppression: DependencySuppressionResult | undefined;
    summary: MonitorEvaluationSummary;
  }): Promise<void> {
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaInstance({
        createIncidents: input.createIncidents,
        createAlerts: false,
      }),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      evaluationSummary: input.summary,
      dependencySuppression: input.dependencySuppression,
      props: {},
    });
  }

  describe("MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus", () => {
    it("suppressed: never calls AlertService.create and pushes exactly one skip event naming the parent", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runAlertCreator({
        createAlerts: true,
        dependencySuppression: suppressed(),
        summary,
      });

      expect(createdAlerts).toHaveLength(0);

      // Exactly one event total — the dependency skip — and nothing else.
      expect(summary.events).toHaveLength(1);

      const skipEvent: MonitorEvaluationEvent = summary.events[0]!;
      expect(skipEvent.type).toBe("alert-skipped");
      expect(skipEvent.title).toBe("Alert suppressed by monitor dependency");
      expect(skipEvent.message).toContain(
        `parent monitor "${SUPPRESSING_PARENT_NAME}" is Offline`,
      );
      expect(skipEvent.relatedCriteriaId).toBe("criteria-1");

      // The skip block RETURNS: nothing after it (cluster context) runs.
      expect(clusterContextSpy.mock.calls).toHaveLength(0);
    });

    it("suppressed: the open-alert resolve pass still runs before the skip block (resolution is never suppressed)", async () => {
      const checkOpenSpy: SpyLike = jest
        .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
        .mockResolvedValue([]) as unknown as SpyLike;

      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runAlertCreator({
        createAlerts: true,
        dependencySuppression: suppressed(),
        summary,
      });

      expect(checkOpenSpy.mock.calls).toHaveLength(1);

      const callInput: { monitorId: ObjectID } = checkOpenSpy.mock
        .calls[0]![0] as { monitorId: ObjectID };
      expect(callInput.monitorId.toString()).toBe(MONITOR_ID.toString());

      // Creation itself stayed suppressed.
      expect(createdAlerts).toHaveLength(0);
      expect(eventsOfType(summary, "alert-skipped")).toHaveLength(1);
    });

    it("undefined dependencySuppression: creates the alert exactly as before the feature", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runAlertCreator({
        createAlerts: true,
        dependencySuppression: undefined,
        summary,
      });

      expect(createdAlerts).toHaveLength(1);
      expect(createdAlerts[0]!.title).toBe("API is down");
      expect(eventsOfType(summary, "alert-skipped")).toHaveLength(0);
      expect(eventsOfType(summary, "alert-created")).toHaveLength(1);
    });

    it("isSuppressed=false: creates the alert (an evaluated-but-clear dependency changes nothing)", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runAlertCreator({
        createAlerts: true,
        dependencySuppression: notSuppressed(),
        summary,
      });

      expect(createdAlerts).toHaveLength(1);
      expect(eventsOfType(summary, "alert-skipped")).toHaveLength(0);
      expect(eventsOfType(summary, "alert-created")).toHaveLength(1);
    });

    it("createAlerts=false: returns BEFORE the skip block — no skip event even when suppressed", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runAlertCreator({
        createAlerts: false,
        dependencySuppression: suppressed(),
        summary,
      });

      // Gate order pinned: the createAlerts gate wins, so no event at all.
      expect(summary.events).toHaveLength(0);
      expect(createdAlerts).toHaveLength(0);

      // The resolve pass still ran (it sits above both gates) ...
      expect(alertFindBySpy.mock.calls).toHaveLength(1);
      // ... and nothing after the gates did.
      expect(clusterContextSpy.mock.calls).toHaveLength(0);
    });

    it("resolve-only entry point resolves an open alert — suppression state cannot block resolution", async () => {
      /*
       * checkOpenAlertsAndCloseIfResolved takes no dependencySuppression
       * input at all — the skip block lives only in the creator — so a
       * suppressing parent can never pin an open alert open.
       */
      const openAlert: Alert = new Alert();
      openAlert._id = new ObjectID(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ).toString();
      openAlert.projectId = PROJECT_ID;
      openAlert.title = "Raised before the parent went down";
      openAlert.createdCriteriaId = "old-criteria";

      jest.spyOn(AlertService, "findBy").mockResolvedValue([openAlert]);

      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      const openAlerts: Array<Alert> =
        await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          monitorId: MONITOR_ID,
          autoResolveCriteriaInstanceIdAlertIdsDictionary: {
            "old-criteria": ["alert-template-1"],
          },
          rootCause: "Monitor is back online",
          criteriaInstance: null,
          dataToProcess: dataToProcess,
          evaluationSummary: summary,
        });

      expect(openAlerts).toHaveLength(1);
      expect(createdAlertStateTimelines).toHaveLength(1);
      expect(createdAlertStateTimelines[0]!.alertId?.toString()).toBe(
        openAlert.id!.toString(),
      );
      expect(createdAlertStateTimelines[0]!.alertStateId?.toString()).toBe(
        RESOLVED_STATE_ID.toString(),
      );
      expect(eventsOfType(summary, "alert-resolved")).toHaveLength(1);
    });
  });

  describe("MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus", () => {
    it("suppressed: never calls IncidentService.create and pushes exactly one skip event naming the parent", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runIncidentCreator({
        createIncidents: true,
        dependencySuppression: suppressed(),
        summary,
      });

      expect(createdIncidents).toHaveLength(0);

      expect(summary.events).toHaveLength(1);

      const skipEvent: MonitorEvaluationEvent = summary.events[0]!;
      expect(skipEvent.type).toBe("incident-skipped");
      expect(skipEvent.title).toBe("Incident suppressed by monitor dependency");
      expect(skipEvent.message).toContain(
        `parent monitor "${SUPPRESSING_PARENT_NAME}" is Offline`,
      );
      expect(skipEvent.relatedCriteriaId).toBe("criteria-1");

      expect(clusterContextSpy.mock.calls).toHaveLength(0);
    });

    it("suppressed: the open-incident resolve pass still runs before the skip block (resolution is never suppressed)", async () => {
      const checkOpenSpy: SpyLike = jest
        .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
        .mockResolvedValue([]) as unknown as SpyLike;

      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runIncidentCreator({
        createIncidents: true,
        dependencySuppression: suppressed(),
        summary,
      });

      expect(checkOpenSpy.mock.calls).toHaveLength(1);

      const callInput: { monitorId: ObjectID } = checkOpenSpy.mock
        .calls[0]![0] as { monitorId: ObjectID };
      expect(callInput.monitorId.toString()).toBe(MONITOR_ID.toString());

      expect(createdIncidents).toHaveLength(0);
      expect(eventsOfType(summary, "incident-skipped")).toHaveLength(1);
    });

    it("undefined dependencySuppression: creates the incident exactly as before the feature", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runIncidentCreator({
        createIncidents: true,
        dependencySuppression: undefined,
        summary,
      });

      expect(createdIncidents).toHaveLength(1);
      expect(createdIncidents[0]!.title).toBe("API is down");
      expect(eventsOfType(summary, "incident-skipped")).toHaveLength(0);
      expect(eventsOfType(summary, "incident-created")).toHaveLength(1);
    });

    it("isSuppressed=false: creates the incident (an evaluated-but-clear dependency changes nothing)", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runIncidentCreator({
        createIncidents: true,
        dependencySuppression: notSuppressed(),
        summary,
      });

      expect(createdIncidents).toHaveLength(1);
      expect(eventsOfType(summary, "incident-skipped")).toHaveLength(0);
      expect(eventsOfType(summary, "incident-created")).toHaveLength(1);
    });

    it("createIncidents=false: returns BEFORE the skip block — no skip event even when suppressed", async () => {
      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      await runIncidentCreator({
        createIncidents: false,
        dependencySuppression: suppressed(),
        summary,
      });

      expect(summary.events).toHaveLength(0);
      expect(createdIncidents).toHaveLength(0);

      expect(incidentFindBySpy.mock.calls).toHaveLength(1);
      expect(clusterContextSpy.mock.calls).toHaveLength(0);
    });

    it("resolve-only entry point resolves an open incident — suppression state cannot block resolution", async () => {
      /*
       * checkOpenIncidentsAndCloseIfResolved takes no dependencySuppression
       * input at all — the skip block lives only in the creator — so a
       * suppressing parent can never pin an open incident open.
       */
      const openIncident: Incident = new Incident();
      openIncident._id = new ObjectID(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ).toString();
      openIncident.projectId = PROJECT_ID;
      openIncident.title = "Raised before the parent went down";
      openIncident.createdCriteriaId = "old-criteria";
      openIncident.createdIncidentTemplateId = "incident-template-1";

      jest.spyOn(IncidentService, "findBy").mockResolvedValue([openIncident]);

      const summary: MonitorEvaluationSummary = emptyEvaluationSummary();

      const openIncidents: Array<Incident> =
        await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
          monitorId: MONITOR_ID,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
            "old-criteria": ["incident-template-1"],
          },
          rootCause: "Monitor is back online",
          criteriaInstance: null,
          dataToProcess: dataToProcess,
          evaluationSummary: summary,
        });

      expect(openIncidents).toHaveLength(1);
      expect(createdIncidentStateTimelines).toHaveLength(1);
      expect(createdIncidentStateTimelines[0]!.incidentId?.toString()).toBe(
        openIncident.id!.toString(),
      );
      expect(
        createdIncidentStateTimelines[0]!.incidentStateId?.toString(),
      ).toBe(RESOLVED_STATE_ID.toString());
      expect(eventsOfType(summary, "incident-resolved")).toHaveLength(1);
    });
  });
});
