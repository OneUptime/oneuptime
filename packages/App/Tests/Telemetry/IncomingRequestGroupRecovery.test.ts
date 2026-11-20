// Nothing here runs a sandbox; the native isolated-vm addon need not load.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

/*
 * The queue between the endpoint and the worker. Each request is its own
 * job, handed to the real worker as it is queued - as when coalescing is off
 * (INCOMING_REQUEST_INGEST_COALESCE_ENABLED=false). Coalescing is
 * IncomingRequestCoalescedJob.test.ts's.
 */
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addIncomingRequestIngestJob: jest.fn(),
      },
    };
  },
);

/*
 * Every request counts: a project's incoming request secret requirement is
 * IncomingRequestSecretEndpoint.test.ts's and IncomingRequestSecretWorker's.
 */
jest.mock("Common/Server/Utils/Monitor/IncomingRequestSecretGate", () => {
  return {
    __esModule: true,
    default: {
      decideAtEdge: async (): Promise<{ mayRecordArrival: boolean }> => {
        return { mayRecordArrival: true };
      },
      decideInWorker: async (data: {
        requestHeaders?: Record<string, string> | undefined;
      }): Promise<{
        verdict: string;
        isRefused: boolean;
        requestHeaders: Record<string, string>;
      }> => {
        return {
          verdict: "NotRequired",
          isRefused: false,
          requestHeaders: data.requestHeaders || {},
        };
      },
    },
  };
});

import IncomingRequestAPI from "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest";
import { processIncomingRequestJobFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import TelemetryQueueService, {
  IncomingRequestIngestJobData,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import Alert from "Common/Models/DatabaseModels/Alert";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressUrlEncoded,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorSecretKeyCache from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import {
  MonitorRecordTables,
  isOpenAlert,
  mockMonitorRecordTables,
} from "Common/Tests/Server/TestingUtils/MonitorRecordTables";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import IncidentGroupingConfig from "Common/Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * ONE SOLARWINDS ORION ALERT, ONE ONEUPTIME ALERT - AND ITS RESET RESOLVES IT
 * (issue #10550).
 *
 * Orion posts each alert to an Incoming Request monitor with the alert's
 * AlertActiveID in the body, and the monitor's criteria groups its alerts by
 * that field, so each Orion alert opens an alert of its own. When the alert
 * resets, Orion posts its reset action's body, which carries "status":
 * "resolved" - the criteria's recovery field and value. The customer's alerts
 * opened, and never resolved.
 *
 * Every step of what they relied on works: the reset reaches the monitor,
 * names the same AlertActiveID as the alert, is read as recovered under the
 * criteria's own grouping, and resolves that value's alert - in the same
 * evaluation, without waiting for another one. What stopped it is the alert
 * itself: an alert added to a criteria in the Dashboard starts with Auto
 * Resolve Alert off, folded under More fields in its form, and a recovery
 * resolves only an alert that is set to resolve on its own. Nothing said so:
 * the grouping settings promised "Resolves an incident when requestBody.status
 * equals resolved", and the monitor log said only that the reset opened
 * nothing new. Now the grouping settings say which of the criteria's
 * incidents and alerts a recovery resolves, and offer to turn the switch on
 * (MonitorCriteriaGroupingRecovery), and the monitor log names each alert a
 * recovery left open, and why.
 *
 * Each request here goes through the real Incoming Request route, over HTTP,
 * behind the parsers StartServer runs for every route, then through the real
 * ingest worker into MonitorResourceUtil.monitorResource, with the real
 * criteria evaluator and the real incident and alert creators. Only the
 * queue between them, the monitor's key cache and arrival store, and the
 * tables the records live in (MonitorRecordTables, in memory) are stood in
 * for.
 */

const SECRET_KEY: string = "10550aaa-0b1e-4c0d-9e5f-0123456789ab";

const PROJECT_ID: ObjectID = new ObjectID(
  "10550000-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "10550000-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "10550000-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "10550000-4444-4444-8444-444444444444",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "10550000-5555-4555-8555-555555555555",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "10550000-6666-4666-8666-666666666666",
);

const ORION_CRITERIA_ID: string = "10550000-7777-4777-8777-777777777777";
const ALL_CLEAR_CRITERIA_ID: string = "10550000-8888-4888-8888-888888888888";

// The grouping, recovery field and value of the issue's first screenshot.
const ORION_GROUPING: IncidentGroupingConfig = {
  groupByJSONPath: "requestBody.alertActiveID",
  resolvedWhenJSONPath: "requestBody.status",
  resolvedWhenValue: "resolved",
};

/*
 * What Orion's reset action posts, from the issue's second screenshot - its
 * "Body to POST", with Orion's variables filled in for alert 48214. The
 * screenshot cuts the body off after Message; the rest of it is not read.
 */
function orionReset(alertActiveId: string): JSONObject {
  return {
    status: "resolved",
    alertActiveID: alertActiveId,
    AlertName: "Hardware status is Critical",
    Severity: "Critical",
    Message: "Fan 2 on core-sw-01 issue resolved",
  };
}

/*
 * The trigger action's body, which the issue does not show: the reset's,
 * saying the alert is active.
 */
function orionTrigger(alertActiveId: string): JSONObject {
  return {
    status: "triggered",
    alertActiveID: alertActiveId,
    AlertName: "Hardware status is Critical",
    Severity: "Critical",
    Message: "Fan 2 on core-sw-01 issue detected",
  };
}

/*
 * The customer's criteria, built as the Dashboard builds it: Add Criteria,
 * a filter Orion's posts match, the status to set, Create an alert - which
 * seeds the alert without Auto Resolve Alert (MonitorCriteriaInstance.tsx) -
 * its title and severity filled in, then grouping. `autoResolveAlert` is
 * what its alert's More fields say; left out, the alert is as seeded.
 */
function orionCriteria(
  options: { autoResolveAlert?: boolean | undefined } = {},
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const alert: CriteriaAlert = {
    title: "{{requestBody.AlertName}}",
    description: "{{requestBody.Message}}",
    alertSeverityId: ALERT_SEVERITY_ID,
    id: `${ORION_CRITERIA_ID.slice(0, -4)}2222`,
    ...(options.autoResolveAlert !== undefined
      ? { autoResolveAlert: options.autoResolveAlert }
      : {}),
  };

  instance.data = {
    ...instance.data!,
    id: ORION_CRITERIA_ID,
    name: "SolarWinds Orion alert",
    monitorStatusId: OFFLINE_STATUS_ID,
    changeMonitorStatus: true,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "AlertName",
      },
    ],
    createAlerts: true,
    alerts: [alert],
    incidentGrouping: ORION_GROUPING,
  };

  return instance;
}

/*
 * A criteria above Orion's that takes its resets: they bring the monitor
 * back online, and the Orion criteria never sees them.
 */
function allClearCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    ...instance.data!,
    id: ALL_CLEAR_CRITERIA_ID,
    name: "Orion reset",
    monitorStatusId: ONLINE_STATUS_ID,
    changeMonitorStatus: true,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "resolved",
      },
    ],
  };

  return instance;
}

function monitorWith(criteria: Array<MonitorCriteriaInstance>): Monitor {
  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: criteria };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "SolarWinds Orion";
  monitor.monitorType = MonitorType.IncomingRequest;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ONLINE_STATUS_ID;
  // The key the URL carries: monitorResource checks it is still the monitor's.
  monitor.incomingRequestSecretKey = new ObjectID(SECRET_KEY);

  return monitor;
}

let monitorUnderTest: Monitor = monitorWith([]);
let tables: MonitorRecordTables;

let http: Server;
let origin: string;

// Every job queued so far, as the worker's run of it.
const jobs: Array<Promise<void>> = [];

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();

  // As StartServer, for every route: JSON, then forms.
  app.use(ExpressJson({ limit: "50mb" }));
  app.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));
  app.use(["/incoming-request-ingest", "/"], IncomingRequestAPI);

  http = createServer(app);

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    http.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  tables = mockMonitorRecordTables({
    getMonitor: (): Monitor => {
      return monitorUnderTest;
    },
    projectId: PROJECT_ID,
    incidentSeverityId: INCIDENT_SEVERITY_ID,
    alertSeverityId: ALERT_SEVERITY_ID,
  });

  for (const level of ["debug", "info", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {}) as never);
  }

  // The key's monitor, as MonitorSecretKeyCache keeps it for a minute.
  jest.spyOn(MonitorSecretKeyCache, "getMonitor").mockResolvedValue({
    monitorId: MONITOR_ID,
    projectId: PROJECT_ID,
  });
  jest
    .spyOn(IncomingRequestReceivedAtStore, "advanceIfTracked")
    .mockResolvedValue(undefined);
  jest
    .spyOn(IncomingRequestReceivedAtStore, "track")
    .mockImplementation(async (data: { receivedAt: Date }): Promise<Date> => {
      return data.receivedAt;
    });

  (
    TelemetryQueueService.addIncomingRequestIngestJob as unknown as jest.Mock
  ).mockImplementation(((job: {
    secretKey: string;
    requestHeaders: Record<string, string>;
    requestBody: string | JSONObject;
    requestMethod: string;
    receivedAt?: Date | undefined;
    presentedSecretHashes?: Array<string> | undefined;
  }): Promise<void> => {
    // The job the queue would hand the worker, without coalescing.
    const jobData: IncomingRequestIngestJobData = {
      secretKey: job.secretKey,
      requestHeaders: job.requestHeaders,
      requestBody: job.requestBody,
      requestMethod: job.requestMethod,
      ingestionTimestamp: job.receivedAt || new Date(),
      presentedSecretHashes: job.presentedSecretHashes,
    };

    const run: Promise<void> = processIncomingRequestJobFromQueue(jobData);

    jobs.push(run);

    return run;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * POSTs a body to the monitor's URL, as Orion does, waits for the worker to
 * evaluate it, and returns the monitor log of that evaluation.
 */
async function post(
  body: JSONObject | string,
  contentType: string = "application/json",
): Promise<MonitorEvaluationSummary> {
  const before: number = jobs.length;

  const response: globalThis.Response = await fetch(
    `${origin}/incoming-request/${SECRET_KEY}`,
    {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body, null, 2),
    },
  );

  // Answered at once; the request is queued after the answer.
  expect(response.status).toBe(200);

  for (let attempt: number = 0; jobs.length === before; attempt++) {
    if (attempt > 400) {
      throw new Error("The request never reached the queue.");
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });
  }

  await jobs[before];

  // The monitor log of the evaluation, as the worker left it.
  const saveMonitorLog: jest.Mock =
    MonitorLogUtil.saveMonitorLog as unknown as jest.Mock;
  const lastLog: { dataToProcess: IncomingMonitorRequest } = saveMonitorLog.mock
    .calls[saveMonitorLog.mock.calls.length - 1]![0] as {
    dataToProcess: IncomingMonitorRequest;
  };

  return lastLog.dataToProcess.evaluationSummary!;
}

// The AlertActiveID each alert was opened for, in the order they opened.
function alertActiveIds(alerts: Array<Alert>): Array<string> {
  return alerts.map((alert: Alert): string => {
    return String((alert.seriesLabels as JSONObject)?.["alertActiveID"]);
  });
}

function openAlertActiveIds(): Array<string> {
  return alertActiveIds(tables.alerts.filter(isOpenAlert));
}

function allAlertActiveIds(): Array<string> {
  return alertActiveIds(tables.alerts);
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

function event(
  summary: MonitorEvaluationSummary,
  type: MonitorEvaluationEvent["type"],
): MonitorEvaluationEvent | undefined {
  return summary.events.find((candidate: MonitorEvaluationEvent): boolean => {
    return candidate.type === type;
  });
}

const LEFT_OPEN_MESSAGE: string =
  "A request reported this alert recovered, but Auto Resolve Alert is off in its criteria, so the alert stays open. Turn on Auto Resolve Alert, under More fields in the criteria's alert, to resolve it on recovery.";

describe("Orion alerts grouped by AlertActiveID, with Auto Resolve Alert on", () => {
  beforeEach(() => {
    monitorUnderTest = monitorWith([orionCriteria({ autoResolveAlert: true })]);
  });

  test("each AlertActiveID opens an alert of its own", async () => {
    for (const id of ["48213", "48214", "48215"]) {
      await post(orionTrigger(id));
    }

    expect(openAlertActiveIds()).toEqual(["48213", "48214", "48215"]);

    for (const alert of tables.alerts) {
      expect(alert.createdCriteriaId).toBe(ORION_CRITERIA_ID);
      expect(alert.seriesFingerprint).toBeTruthy();
    }

    // Three groups, three fingerprints.
    expect(
      new Set<string>(
        tables.alerts.map((alert: Alert): string => {
          return alert.seriesFingerprint!;
        }),
      ).size,
    ).toBe(3);
  });

  test("the reset resolves its own AlertActiveID's alert, and leaves the others open", async () => {
    for (const id of ["48213", "48214", "48215"]) {
      await post(orionTrigger(id));
    }

    const summary: MonitorEvaluationSummary = await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48213", "48215"]);
    expect(allAlertActiveIds()).toEqual(["48213", "48214", "48215"]);

    // Resolved in the reset's own evaluation, said once, for that alert.
    expect(actions(summary)).toEqual([
      "grouping: Nothing new to open",
      `alert-resolved: Alert resolved: ${tables.alerts[1]!.title}`,
    ]);
    expect(event(summary, "alert-resolved")?.relatedAlertId).toBe(
      tables.alerts[1]!.id!.toString(),
    );
    expect(event(summary, "alert-resolved")?.message).toBe(
      "Alert auto-resolved because the incoming payload reported this key as resolved.",
    );

    // Its timeline says why.
    expect(tables.stateChanges).toEqual([
      {
        record: "alert",
        id: tables.alerts[1]!.id!.toString(),
        rootCause: expect.stringContaining(
          "Incoming request reported this key as resolved.",
        ),
      },
    ]);
  });

  test("a later trigger for the same AlertActiveID opens a new alert", async () => {
    await post(orionTrigger("48213"));
    await post(orionTrigger("48214"));
    await post(orionReset("48214"));

    const summary: MonitorEvaluationSummary = await post(orionTrigger("48214"));

    expect(allAlertActiveIds()).toEqual(["48213", "48214", "48214"]);
    expect(openAlertActiveIds()).toEqual(["48213", "48214"]);
    // The resolved one stays resolved; the new one is its own alert.
    expect(isOpenAlert(tables.alerts[1]!)).toBe(false);
    expect(isOpenAlert(tables.alerts[2]!)).toBe(true);
    expect(tables.alerts[2]!.seriesFingerprint).toBe(
      tables.alerts[1]!.seriesFingerprint,
    );
    expect(actions(summary)).toEqual([
      `alert-created: Alert created: ${tables.alerts[2]!.title}`,
    ]);

    // And that one resolves on its own reset, as the first did.
    await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48213"]);
  });

  test("a trigger repeated while its alert is open opens nothing new", async () => {
    await post(orionTrigger("48213"));
    const summary: MonitorEvaluationSummary = await post(orionTrigger("48213"));

    expect(allAlertActiveIds()).toEqual(["48213"]);
    expect(actions(summary)).toEqual([
      `alert-skipped: Alert already active: ${tables.alerts[0]!.title}`,
    ]);
  });

  test("a second reset for the same AlertActiveID changes nothing", async () => {
    await post(orionTrigger("48213"));
    await post(orionTrigger("48214"));
    await post(orionReset("48214"));

    const summary: MonitorEvaluationSummary = await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48213"]);
    expect(tables.alerts).toHaveLength(2);
    expect(tables.stateChanges).toHaveLength(1);
    expect(actions(summary)).toEqual(["grouping: Nothing new to open"]);
  });

  test("a reset for an AlertActiveID with no open alert resolves nothing and opens nothing", async () => {
    await post(orionTrigger("48213"));

    const summary: MonitorEvaluationSummary = await post(orionReset("99999"));

    expect(openAlertActiveIds()).toEqual(["48213"]);
    expect(tables.alerts).toHaveLength(1);
    expect(actions(summary)).toEqual(["grouping: Nothing new to open"]);
  });

  test("the reset Orion posts, as its Body to POST shows it, resolves the alert", async () => {
    await post(orionTrigger("48214"));

    /*
     * The body as Orion sends it: written with the screenshot's spacing,
     * labelled JSON.
     */
    await post(
      [
        "{",
        '"status": "resolved",',
        '"alertActiveID": "48214",',
        '"AlertName": "Hardware status is Critical",',
        '"Severity": "Critical",',
        '"Message": "Fan 2 on core-sw-01 issue resolved"',
        "}",
      ].join("\n"),
    );

    expect(openAlertActiveIds()).toEqual([]);
  });

  test("JSON labelled text/plain is read as JSON, and the reset resolves the alert all the same", async () => {
    await post(JSON.stringify(orionTrigger("48214")), "text/plain");
    await post(JSON.stringify(orionReset("48214")), "text/plain");

    expect(allAlertActiveIds()).toEqual(["48214"]);
    expect(openAlertActiveIds()).toEqual([]);
  });

  /*
   * Orion fills its variables into the text of the body, so whether the id
   * arrives as a number depends only on the quotes around it.
   */
  test("an AlertActiveID sent as a number in one post and as text in the other is the same alert", async () => {
    await post({ ...orionTrigger("48214"), alertActiveID: 48214 });
    await post(orionTrigger("48215"));
    await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48215"]);
  });

  /*
   * The path is read as written: a reset that spells the field otherwise
   * names no value, and resolves nothing - the monitor log says it has no
   * value there.
   */
  test("a reset that spells the field AlertActiveID has no value at requestBody.alertActiveID, and resolves nothing", async () => {
    await post(orionTrigger("48214"));

    const reset: JSONObject = orionReset("48214");
    delete reset["alertActiveID"];
    reset["AlertActiveID"] = "48214";

    const summary: MonitorEvaluationSummary = await post(reset);

    expect(openAlertActiveIds()).toEqual(["48214"]);
    expect(event(summary, "grouping")?.message).toBe(
      'This request has no value at requestBody.alertActiveID and reported recovered, so criteria "SolarWinds Orion alert" opened nothing new.',
    );
  });

  test("a reset that another criteria takes resolves the alert all the same", async () => {
    monitorUnderTest = monitorWith([
      allClearCriteria(),
      orionCriteria({ autoResolveAlert: true }),
    ]);

    await post(orionTrigger("48213"));
    await post(orionTrigger("48214"));

    const summary: MonitorEvaluationSummary = await post(orionReset("48214"));

    expect(
      summary.criteriaResults
        .filter((result: { met: boolean }) => {
          return result.met;
        })
        .map((result: { criteriaName?: string | undefined }) => {
          return result.criteriaName;
        }),
    ).toEqual(["Orion reset"]);
    expect(openAlertActiveIds()).toEqual(["48213"]);
    // The reset set the monitor's status, as the criteria it matched says.
    expect(tables.statusSetBy[tables.statusSetBy.length - 1]).toBe(
      "Orion reset",
    );
    expect(monitorUnderTest.currentMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
  });
});

describe("The alert as the Dashboard adds it to a criteria: Auto Resolve Alert off", () => {
  beforeEach(() => {
    monitorUnderTest = monitorWith([orionCriteria()]);
  });

  test("the customer's monitor: its alerts open per AlertActiveID", async () => {
    for (const id of ["48213", "48214", "48215"]) {
      await post(orionTrigger(id));
    }

    expect(openAlertActiveIds()).toEqual(["48213", "48214", "48215"]);
    expect(
      (
        monitorUnderTest.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
          .monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!.data!
          .alerts[0] as CriteriaAlert
      ).autoResolveAlert,
    ).toBeUndefined();
  });

  test("the reset leaves its alert open, and the monitor log names it and says why", async () => {
    await post(orionTrigger("48213"));
    await post(orionTrigger("48214"));

    const summary: MonitorEvaluationSummary = await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48213", "48214"]);
    expect(tables.stateChanges).toEqual([]);

    // Before #10550 the log stopped at the grouping note.
    expect(actions(summary)).toEqual([
      "grouping: Nothing new to open",
      `alert-skipped: Alert left open: ${tables.alerts[1]!.title}`,
    ]);
    expect(event(summary, "alert-skipped")).toMatchObject({
      message: LEFT_OPEN_MESSAGE,
      relatedCriteriaId: ORION_CRITERIA_ID,
      relatedAlertId: tables.alerts[1]!.id!.toString(),
      relatedAlertNumber: tables.alerts[1]!.alertNumber,
    });
  });

  test("an alert turned off by hand is left open the same way", async () => {
    monitorUnderTest = monitorWith([
      orionCriteria({ autoResolveAlert: false }),
    ]);

    await post(orionTrigger("48214"));
    const summary: MonitorEvaluationSummary = await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48214"]);
    expect(event(summary, "alert-skipped")?.message).toBe(LEFT_OPEN_MESSAGE);
  });

  test("with Auto Resolve Alert turned on - what the grouping settings offer - the next reset resolves exactly that alert", async () => {
    await post(orionTrigger("48213"));
    await post(orionTrigger("48214"));
    await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48213", "48214"]);

    // The criteria saved with its alert's switch on; the alerts stay as they are.
    monitorUnderTest.monitorSteps = monitorWith([
      orionCriteria({ autoResolveAlert: true }),
    ]).monitorSteps;

    const summary: MonitorEvaluationSummary = await post(orionReset("48214"));

    expect(openAlertActiveIds()).toEqual(["48213"]);
    expect(actions(summary)).toEqual([
      "grouping: Nothing new to open",
      `alert-resolved: Alert resolved: ${tables.alerts[1]!.title}`,
    ]);
  });
});

describe("An Incoming Request monitor without grouping is unchanged", () => {
  /*
   * The criteria a new Incoming Request monitor starts with, its offline
   * one raising an alert: online while the body does not mention "error",
   * offline, with an alert, while it does.
   */
  function defaultMonitor(): Monitor {
    const online: MonitorCriteriaInstance =
      MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
        monitorType: MonitorType.IncomingRequest,
        monitorStatusId: ONLINE_STATUS_ID,
        monitorName: "Backups",
      })!;
    const offline: MonitorCriteriaInstance =
      MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
        monitorType: MonitorType.IncomingRequest,
        monitorStatusId: OFFLINE_STATUS_ID,
        incidentSeverityId: INCIDENT_SEVERITY_ID,
        alertSeverityId: ALERT_SEVERITY_ID,
        monitorName: "Backups",
      })!;

    offline.data!.createAlerts = true;
    offline.data!.createIncidents = false;

    return monitorWith([offline, online]);
  }

  beforeEach(() => {
    monitorUnderTest = defaultMonitor();
  });

  test("a request with error opens one alert for the whole monitor, and the next one opens nothing new", async () => {
    await post({ status: "error", alertActiveID: "48213" });
    const second: MonitorEvaluationSummary = await post({
      status: "error",
      alertActiveID: "48214",
    });

    expect(tables.alerts).toHaveLength(1);
    expect(tables.alerts[0]!.seriesFingerprint).toBeUndefined();
    expect(tables.alerts[0]!.seriesLabels).toBeUndefined();
    expect(actions(second)).toEqual([
      `alert-skipped: Alert already active: ${tables.alerts[0]!.title}`,
    ]);
  });

  test("a body that says resolved resolves nothing by itself: the alert resolves when the online criteria matches", async () => {
    await post({ status: "error" });

    // Still mentions error: still the offline criteria, nothing resolved.
    const stillDown: MonitorEvaluationSummary = await post({
      status: "resolved",
      detail: "error count 1",
    });

    expect(tables.alerts.filter(isOpenAlert)).toHaveLength(1);
    expect(
      stillDown.events.filter((candidate: MonitorEvaluationEvent) => {
        return (
          candidate.type === "grouping" ||
          candidate.type === "alert-resolved" ||
          candidate.title.startsWith("Alert left open")
        );
      }),
    ).toEqual([]);

    const backUp: MonitorEvaluationSummary = await post({
      status: "resolved",
    });

    expect(tables.alerts.filter(isOpenAlert)).toHaveLength(0);
    expect(actions(backUp)).toEqual([
      `alert-resolved: Alert resolved: ${tables.alerts[0]!.title}`,
    ]);
    expect(monitorUnderTest.currentMonitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
  });

  test("an alert without Auto Resolve Alert stays open, and nothing in the log speaks of a recovery", async () => {
    const monitor: Monitor = defaultMonitor();
    const offline: MonitorCriteriaInstance =
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
        .monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!;

    offline.data!.alerts[0]!.autoResolveAlert = false;
    monitorUnderTest = monitor;

    await post({ status: "error" });
    const backUp: MonitorEvaluationSummary = await post({ status: "ok" });

    expect(tables.alerts.filter(isOpenAlert)).toHaveLength(1);
    expect(actions(backUp)).toEqual([]);
  });
});
