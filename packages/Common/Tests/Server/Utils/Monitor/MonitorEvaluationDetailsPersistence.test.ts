import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorEvaluationDetailsBuilder from "../../../../Server/Utils/Monitor/MonitorEvaluationDetailsBuilder";
import MonitorEvaluationDetailsCapture, {
  GetEvaluationDetails,
} from "../../../../Server/Utils/Monitor/MonitorEvaluationDetailsCapture";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import URL from "../../../../Types/API/URL";
import Dictionary from "../../../../Types/Dictionary";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationDetails from "../../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorSummarySnapshot from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import MonitorEvaluationDetailsUtil from "../../../../Utils/Monitor/MonitorEvaluationDetailsUtil";
import MonitorSummarySnapshotUtil from "../../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";

/*
 * THE EVALUATION DETAILS LAND ON THE INCIDENT AND THE ALERT.
 *
 * An API monitor's check is evaluated by the real criteria evaluator; the
 * incident and the alert are created through the real creators, with only
 * the database services around them stubbed. What they hand to
 * IncidentService.create and AlertService.create is what a reader of the
 * record will see: the criteria and filters that matched, the JSON path, a
 * redacted excerpt - and, for a monitor set to keep no response content,
 * none of the response at all, not in the details, not in the stored check,
 * not in the monitor summary.
 */

const REDACTED: string = "[REDACTED]";
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STEP_ID: string = "33333333-3333-4333-8333-333333333333";
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CHECKED_AT: Date = new Date("2026-11-08T10:04:12.000Z");
const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const BODY: string = JSON.stringify({
  service: "checkout",
  owner: "oncall@acme.example",
  session: { id: "sess_123", token: "tok_live_9f8e7d6c5b4a" },
  checks: [
    { name: "db", status: "ok" },
    { name: "payments", status: "error: connection refused" },
  ],
});

function criteriaInstance(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Payments degraded";
  instance.data!.filterCondition = FilterCondition.All;
  instance.data!.filters = [
    {
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "error",
    },
    {
      checkOn: CheckOn.ResponseStatusCode,
      filterType: FilterType.GreaterThan,
      value: 499,
    },
  ];
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = true;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: "Payments degraded",
      description: "The health check reported an error.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: false,
    },
  ];
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: "Payments degraded",
      description: "The health check reported an error.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: false,
    },
  ];
  return instance;
}

function monitorStep(instance: MonitorCriteriaInstance): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.id = STEP_ID;
  step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray = [instance];
  step.data!.monitorDestination = URL.fromString(
    "https://api.acme.example/v1/health?api_key=k_live_123",
  );
  return step;
}

function monitorWith(input: {
  step: MonitorStep;
  keepResponseContent?: boolean | undefined;
}): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.API;
  model.name = "Checkout API";

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = [input.step];
  model.monitorSteps = steps;

  if (input.keepResponseContent !== undefined) {
    model.keepResponseContent = input.keepResponseContent;
  }

  return model;
}

function check(): DataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: new ObjectID(STEP_ID),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    isOnline: true,
    responseCode: 503,
    responseTimeInMs: 640,
    responseBody: BODY,
    responseHeaders: {
      "content-type": "application/json",
      "set-cookie": "session=abc; HttpOnly",
    },
    // What the probe echoed: the URL as it was asked, its key filled in.
    monitorDestination: URL.fromString(
      "https://api.acme.example/v1/health?api_key=k_live_123",
    ),
    failureCause: "",
    monitoredAt: CHECKED_AT,
  } as unknown as DataToProcess;
}

interface EvaluatedCheck {
  monitor: Monitor;
  instance: MonitorCriteriaInstance;
  step: MonitorStep;
  dataToProcess: DataToProcess;
  evaluationSummary: MonitorEvaluationSummary;
  rootCause: string;
  monitorSummary: MonitorSummarySnapshot | null;
  getEvaluationDetails: GetEvaluationDetails;
}

// The check, judged by the real evaluator, captured as MonitorResource does.
async function evaluateCheck(input: {
  keepResponseContent?: boolean | undefined;
}): Promise<EvaluatedCheck> {
  const instance: MonitorCriteriaInstance = criteriaInstance();
  const step: MonitorStep = monitorStep(instance);
  const monitor: Monitor = monitorWith({
    step: step,
    keepResponseContent: input.keepResponseContent,
  });
  const dataToProcess: DataToProcess = check();

  const evaluationSummary: MonitorEvaluationSummary = {
    evaluatedAt: CHECKED_AT,
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: step,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: MONITOR_ID,
        rootCause: null,
      } as ProbeApiIngestResponse,
      evaluationSummary: evaluationSummary,
    });

  expect(response.criteriaMetId).toBe("criteria-1");

  const monitorSummary: MonitorSummarySnapshot | null =
    await MonitorSummaryCapture.capture({
      monitor: monitor,
      dataToProcess: dataToProcess,
      evaluationSummary: evaluationSummary,
      probeName: "US West",
    });

  return {
    monitor,
    instance,
    step,
    dataToProcess,
    evaluationSummary,
    rootCause: response.rootCause!,
    monitorSummary,
    getEvaluationDetails: MonitorEvaluationDetailsCapture.forCriteria({
      monitor: monitor,
      monitorStep: step,
      criteriaInstance: instance,
      evaluationSummary: evaluationSummary,
      dataToProcess: dataToProcess,
      probeName: "US West",
    }),
  };
}

async function createBoth(
  evaluated: EvaluatedCheck,
  matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined,
): Promise<void> {
  await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
    criteriaInstance: evaluated.instance,
    monitor: evaluated.monitor,
    dataToProcess: evaluated.dataToProcess,
    rootCause: evaluated.rootCause,
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
    evaluationSummary: evaluated.evaluationSummary,
    monitorSummary: evaluated.monitorSummary,
    getEvaluationDetails: evaluated.getEvaluationDetails,
    matchesPerSeries: matchesPerSeries,
    props: {},
  });

  await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
    criteriaInstance: evaluated.instance,
    monitor: evaluated.monitor,
    dataToProcess: evaluated.dataToProcess,
    rootCause: evaluated.rootCause,
    autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
    evaluationSummary: evaluated.evaluationSummary,
    monitorSummary: evaluated.monitorSummary,
    getEvaluationDetails: evaluated.getEvaluationDetails,
    matchesPerSeries: matchesPerSeries,
    props: {},
  });
}

// What a reader gets back from the stored column, through JSON as Postgres has it.
function readBack(stored: JSONObject | undefined): MonitorEvaluationDetails {
  expect(stored).toBeDefined();

  const details: MonitorEvaluationDetails | null =
    MonitorEvaluationDetailsUtil.deserialize(
      JSON.parse(JSON.stringify(stored)) as JSONObject,
    );

  expect(details).not.toBeNull();

  return details!;
}

describe("Incidents and alerts keep the evaluation that opened them", () => {
  let createdIncidents: Array<Incident> = [];
  let createdAlerts: Array<Alert> = [];

  beforeEach(() => {
    mockProjectStates();
    createdIncidents = [];
    createdAlerts = [];

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

    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
    jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("an API monitor whose JSON body matched: both keep the field and the redacted excerpt", async () => {
    await createBoth(await evaluateCheck({}));

    expect(createdIncidents).toHaveLength(1);
    expect(createdAlerts).toHaveLength(1);

    for (const record of [createdIncidents[0]!, createdAlerts[0]!]) {
      const details: MonitorEvaluationDetails = readBack(
        record.evaluationDetails,
      );

      expect(details.criteriaName).toBe("Payments degraded");
      expect(details.evaluatedAt).toEqual(CHECKED_AT);
      expect(details.probeName).toBe("US West");
      expect(details.response).toEqual({
        statusCode: 503,
        responseTimeInMs: 640,
        isOnline: true,
      });
      expect(details.request?.url).toBe(
        `https://api.acme.example/v1/health?api_key=${REDACTED}`,
      );

      const body: MonitorEvaluationDetails["filters"][number] =
        details.filters[0]!;

      expect(body.checkOn).toBe(CheckOn.ResponseBody);
      expect(body.field).toBe("checks[1].status");
      expect(body.excerpt!.match).toBe("error");

      expect(details.filters[1]!.actual).toBe("503");

      // Nothing secret is in what was stored.
      const stored: string = JSON.stringify(record.evaluationDetails);

      expect(stored).not.toContain("tok_live_9f8e7d6c5b4a");
      expect(stored).not.toContain("sess_123");
      expect(stored).not.toContain("oncall@acme.example");
      expect(stored).not.toContain("k_live_123");
      expect(stored).not.toContain("session=abc");
    }
  });

  it("the details are built once for the incident and the alert", async () => {
    const evaluated: EvaluatedCheck = await evaluateCheck({});
    const build: jest.SpiedFunction<typeof MonitorEvaluationDetailsBuilder.build> =
      jest.spyOn(MonitorEvaluationDetailsBuilder, "build");

    // A fresh getter, so the spy sees its one build.
    evaluated.getEvaluationDetails = MonitorEvaluationDetailsCapture.forCriteria(
      {
        monitor: evaluated.monitor,
        monitorStep: evaluated.step,
        criteriaInstance: evaluated.instance,
        evaluationSummary: evaluated.evaluationSummary,
        dataToProcess: evaluated.dataToProcess,
      },
    );

    await createBoth(evaluated);

    expect(build).toHaveBeenCalledTimes(1);
    expect(createdIncidents[0]!.evaluationDetails).toEqual(
      createdAlerts[0]!.evaluationDetails,
    );
  });

  it("nothing is built while the incident is already open", async () => {
    const evaluated: EvaluatedCheck = await evaluateCheck({});

    const openIncident: Incident = new Incident();
    openIncident._id = ObjectID.generate().toString();
    openIncident.createdCriteriaId = "criteria-1";
    openIncident.createdIncidentTemplateId = "incident-template-1";

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([openIncident]);

    const build: jest.SpiedFunction<typeof MonitorEvaluationDetailsBuilder.build> =
      jest.spyOn(MonitorEvaluationDetailsBuilder, "build");

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: evaluated.instance,
      monitor: evaluated.monitor,
      dataToProcess: evaluated.dataToProcess,
      rootCause: evaluated.rootCause,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      evaluationSummary: evaluated.evaluationSummary,
      getEvaluationDetails: MonitorEvaluationDetailsCapture.forCriteria({
        monitor: evaluated.monitor,
        monitorStep: evaluated.step,
        criteriaInstance: evaluated.instance,
        evaluationSummary: evaluated.evaluationSummary,
        dataToProcess: evaluated.dataToProcess,
      }),
      props: {},
    });

    expect(createdIncidents).toHaveLength(0);
    expect(build).not.toHaveBeenCalled();
  });

  it("the stored check and the summary mask the credential header and the URL's key", async () => {
    await createBoth(await evaluateCheck({}));

    for (const record of [createdIncidents[0]!, createdAlerts[0]!]) {
      const stateLog: JSONObject = record.createdStateLog!;
      const headers: JSONObject = stateLog["responseHeaders"] as JSONObject;

      expect(headers["set-cookie"]).toBe(REDACTED);
      expect(headers["content-type"]).toBe("application/json");
      // The stored check keeps its body while the monitor keeps content.
      expect(stateLog["responseBody"]).toBe(BODY);

      const summary: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.deserialize(
          JSON.parse(JSON.stringify(record.monitorSummary)) as JSONObject,
        );

      expect(summary!.probeMonitorResponse!.responseHeaders).toEqual({
        "content-type": "application/json",
        "set-cookie": REDACTED,
      });
      expect(
        String(summary!.probeMonitorResponse!.monitorDestination),
      ).toBe(`https://api.acme.example/v1/health?api_key=${REDACTED}`);
      expect(summary!.isResponseContentOmitted).toBeUndefined();
    }
  });

  it("with response content off, none of the response is stored anywhere on them", async () => {
    await createBoth(await evaluateCheck({ keepResponseContent: false }));

    expect(createdIncidents).toHaveLength(1);
    expect(createdAlerts).toHaveLength(1);

    for (const record of [createdIncidents[0]!, createdAlerts[0]!]) {
      const details: MonitorEvaluationDetails = readBack(
        record.evaluationDetails,
      );

      expect(details.areResponseExcerptsOff).toBe(true);
      expect(details.filters[0]!.excerpt).toBeUndefined();
      expect(details.filters[0]!.excerptOmission).toBe(
        "response-excerpts-off",
      );
      // The status code is no content of the response: it stays.
      expect(details.filters[1]!.actual).toBe("503");

      expect(record.createdStateLog!["responseBody"]).toBeUndefined();

      const summary: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.deserialize(
          JSON.parse(JSON.stringify(record.monitorSummary)) as JSONObject,
        );

      expect(summary!.probeMonitorResponse!.responseBody).toBeUndefined();
      expect(summary!.isResponseContentOmitted).toBe(true);

      for (const column of [
        record.evaluationDetails,
        record.createdStateLog,
        record.monitorSummary,
      ]) {
        const text: string = JSON.stringify(column);

        expect(text).not.toContain("connection refused");
        expect(text).not.toContain("checkout");
      }
    }
  });

  it("one series of a grouped criteria keeps no details: they describe the whole monitor", async () => {
    const evaluated: EvaluatedCheck = await evaluateCheck({});

    await createBoth(evaluated, [
      {
        criteriaMetId: "criteria-1",
        fingerprint: "0123456789abcdef",
        labels: { host: "web-1" },
        rootCause: "- CPU on web-1 was 97%, above the 90 threshold.",
        metricContext: undefined,
      },
    ]);

    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]!.evaluationDetails).toBeUndefined();
    expect(createdAlerts[0]!.evaluationDetails).toBeUndefined();
  });

  it("a record of the whole monitor on a grouped monitor keeps them", () => {
    expect(
      MonitorEvaluationDetailsCapture.describesRecord({
        monitorType: MonitorType.Server,
        seriesFingerprint: "__all__",
      }),
    ).toBe(true);
    expect(
      MonitorEvaluationDetailsCapture.describesRecord({
        monitorType: MonitorType.Server,
        seriesFingerprint: undefined,
      }),
    ).toBe(true);
    // Every record of an Incoming Request criteria came from the one request.
    expect(
      MonitorEvaluationDetailsCapture.describesRecord({
        monitorType: MonitorType.IncomingRequest,
        seriesFingerprint: "abc",
      }),
    ).toBe(true);
    expect(
      MonitorEvaluationDetailsCapture.describesRecord({
        monitorType: MonitorType.Metrics,
        seriesFingerprint: "abc",
      }),
    ).toBe(false);
  });

  it("a capture that fails stores nothing, and the incident still opens", async () => {
    const evaluated: EvaluatedCheck = await evaluateCheck({});

    jest
      .spyOn(MonitorEvaluationDetailsBuilder, "build")
      .mockRejectedValue(new Error("unexpected shape"));

    evaluated.getEvaluationDetails = MonitorEvaluationDetailsCapture.forCriteria(
      {
        monitor: evaluated.monitor,
        monitorStep: evaluated.step,
        criteriaInstance: evaluated.instance,
        evaluationSummary: evaluated.evaluationSummary,
        dataToProcess: evaluated.dataToProcess,
      },
    );

    await createBoth(evaluated);

    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]!.evaluationDetails).toBeUndefined();
    expect(createdAlerts).toHaveLength(1);
    expect(createdAlerts[0]!.evaluationDetails).toBeUndefined();
  });

  it("a record created without a getter keeps none, as before", async () => {
    const evaluated: EvaluatedCheck = await evaluateCheck({});

    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: evaluated.instance,
      monitor: evaluated.monitor,
      dataToProcess: evaluated.dataToProcess,
      rootCause: evaluated.rootCause,
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
      props: {},
    });

    expect(createdIncidents).toHaveLength(1);
    expect(createdIncidents[0]!.evaluationDetails).toBeUndefined();
  });

  it("the stored details read back to what was captured", async () => {
    const evaluated: EvaluatedCheck = await evaluateCheck({});
    const captured: JSONObject | null = await evaluated.getEvaluationDetails();

    await createBoth(evaluated);

    expect(createdIncidents[0]!.evaluationDetails).toEqual(captured);

    const direct: MonitorEvaluationDetails | null =
      await MonitorEvaluationDetailsBuilder.build({
        monitor: evaluated.monitor,
        monitorStep: evaluated.step,
        criteriaInstance: evaluated.instance,
        evaluationSummary: evaluated.evaluationSummary,
        dataToProcess: evaluated.dataToProcess,
        probeName: "US West",
      });

    expect(readBack(createdIncidents[0]!.evaluationDetails)).toEqual(direct);
  });

  describe("the check that resolves one, on its state timeline", () => {
    let incidentStateTimelines: Array<IncidentStateTimeline> = [];
    let alertStateTimelines: Array<AlertStateTimeline> = [];

    beforeEach(() => {
      incidentStateTimelines = [];
      alertStateTimelines = [];

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

      const openIncident: Incident = new Incident();
      openIncident._id = ObjectID.generate().toString();
      openIncident.projectId = PROJECT_ID;
      openIncident.createdCriteriaId = "criteria-1";

      const openAlert: Alert = new Alert();
      openAlert._id = ObjectID.generate().toString();
      openAlert.projectId = PROJECT_ID;
      openAlert.createdCriteriaId = "criteria-1";

      jest.spyOn(IncidentService, "findBy").mockResolvedValue([openIncident]);
      jest.spyOn(AlertService, "findBy").mockResolvedValue([openAlert]);
    });

    async function resolveBoth(keepResponseContent: boolean): Promise<void> {
      await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
          "criteria-1": ["incident-template-1"],
        },
        rootCause: "No monitoring criteria met.",
        criteriaInstance: null,
        dataToProcess: check(),
        keepResponseContent: keepResponseContent,
      });

      await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        autoResolveCriteriaInstanceIdAlertIdsDictionary: {
          "criteria-1": ["alert-template-1"],
        },
        rootCause: "No monitoring criteria met.",
        criteriaInstance: null,
        dataToProcess: check(),
        keepResponseContent: keepResponseContent,
      });
    }

    it("masks its credential headers and keeps its body", async () => {
      await resolveBoth(true);

      for (const timeline of [
        incidentStateTimelines[0]!,
        alertStateTimelines[0]!,
      ]) {
        const log: JSONObject = timeline.stateChangeLog!;

        expect((log["responseHeaders"] as JSONObject)["set-cookie"]).toBe(
          REDACTED,
        );
        expect(log["responseBody"]).toBe(BODY);
      }
    });

    it("keeps no body for a monitor that keeps no response content", async () => {
      await resolveBoth(false);

      for (const timeline of [
        incidentStateTimelines[0]!,
        alertStateTimelines[0]!,
      ]) {
        expect(timeline.stateChangeLog!["responseBody"]).toBeUndefined();
        expect(timeline.stateChangeLog!["responseCode"]).toBe(503);
      }
    });
  });
});
