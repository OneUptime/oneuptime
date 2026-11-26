// Nothing here runs a sandbox; the native isolated-vm addon need not load.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

/*
 * The real Queue wrapper, on a queue of this suite's own, so nothing shares
 * its jobs. The Telemetry entry of the wrapper's own enum is renamed in
 * place rather than in a copy: the wrapper gives jobs the Telemetry queue's
 * retries (3 attempts, exponential backoff) by comparing against that enum.
 * The name is built inside the factory, which runs, hoisted, before anything
 * declared in this file.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  type QueueModule = {
    default: unknown;
    QueueName: Record<string, string>;
  };

  const actual: QueueModule = jest.requireActual(
    "Common/Server/Infrastructure/Queue",
  ) as QueueModule;

  actual.QueueName["Telemetry"] =
    `IncomingRequestEveryRequestTest-${process.pid}-${Date.now()}`;

  return {
    __esModule: true,
    default: actual.default,
    QueueName: actual.QueueName,
  };
});

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

import IncomingRequestAPI, {
  INCOMING_REQUEST_NOT_QUEUED_MESSAGE,
} from "../../FeatureSet/Telemetry/API/IncomingRequestIngest/IncomingRequest";
import { processPendingIncomingRequestsFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import { TelemetryIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import IncomingRequestPendingStore, {
  PendingIncomingRequest,
} from "../../FeatureSet/Telemetry/Utils/IncomingRequestPendingStore";
import Alert from "Common/Models/DatabaseModels/Alert";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Queue, { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressUrlEncoded,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import MonitorEvaluationLock from "Common/Server/Utils/Monitor/MonitorEvaluationLock";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorSecretKeyCache from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import { isNonActionableIngestError } from "Common/Server/Utils/Monitor/NonActionableIngestError";
import {
  MonitorRecordTables,
  isOpenAlert,
  mockMonitorRecordTables,
} from "Common/Tests/Server/TestingUtils/MonitorRecordTables";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "Common/Tests/Helpers/SeededRandom";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
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
 * EVERY REQUEST TO A GROUPED INCOMING REQUEST MONITOR IS EVALUATED, IN THE
 * ORDER IT ARRIVED (#10582).
 *
 * SolarWinds Orion posts one request per alert to an Incoming Request
 * monitor whose criteria groups its alerts by AlertActiveID, and posts each
 * alert's reset the same way. A switch going down fires many at once, and the
 * resets come back in a burst too. Same-monitor coalescing evaluated only the
 * newest request of a burst: a trigger it skipped never opened its alert,
 * and a reset it skipped never resolved one - #10550's symptom from a second
 * cause. Now every request is kept in its monitor's list, the monitor's job
 * works through it in order, and each request is judged against its own
 * values.
 *
 * Each request here goes through the real Incoming Request route, over HTTP,
 * behind the parsers StartServer runs for every route; the real enqueue path
 * and waiting-request store on Redis; real BullMQ, on a queue of this
 * suite's own; the real ingest worker; and MonitorResourceUtil.monitorResource
 * with the real criteria evaluator and the real incident and alert creators.
 * Only the monitor's key cache and arrival store, and the tables the records
 * live in (MonitorRecordTables, in memory) are stood in for - and, but in the
 * lock's own test, the monitor's lock.
 *
 * It needs Redis: CI's test-setup.sh starts one on localhost:6310 and `npm
 * test` exports its settings from config.env. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16379:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16379 \
 *     npx jest Tests/Telemetry/IncomingRequestEveryRequest.test.ts
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10582000-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "10582000-2222-4222-8222-222222222222",
);
const ONLINE_STATUS_ID: ObjectID = new ObjectID(
  "10582000-3333-4333-8333-333333333333",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "10582000-4444-4444-8444-444444444444",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "10582000-5555-4555-8555-555555555555",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "10582000-6666-4666-8666-666666666666",
);

const ORION_CRITERIA_ID: string = "10582000-7777-4777-8777-777777777777";
const DOWN_CRITERIA_ID: string = "10582000-8888-4888-8888-888888888888";

function orionTrigger(alertActiveId: string): JSONObject {
  return {
    status: "triggered",
    alertActiveID: alertActiveId,
    AlertName: "Node is down",
    Severity: "Critical",
    Message: `Node ${alertActiveId} is down`,
  };
}

function orionReset(alertActiveId: string): JSONObject {
  return {
    status: "resolved",
    alertActiveID: alertActiveId,
    AlertName: "Node is down",
    Severity: "Critical",
    Message: `Node ${alertActiveId} is back up`,
  };
}

/*
 * The customer's criteria (#10550): a filter Orion's posts match, an alert
 * that resolves on its own, grouped by AlertActiveID, recovered when the
 * status is "resolved".
 */
function orionCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const alert: CriteriaAlert = {
    title: "{{requestBody.AlertName}}",
    description: "{{requestBody.Message}}",
    alertSeverityId: ALERT_SEVERITY_ID,
    id: `${ORION_CRITERIA_ID.slice(0, -4)}2222`,
    autoResolveAlert: true,
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
    incidentGrouping: {
      groupByJSONPath: "requestBody.alertActiveID",
      resolvedWhenJSONPath: "requestBody.status",
      resolvedWhenValue: "resolved",
    },
  };

  return instance;
}

/*
 * A status-style sender without grouping: "down" opens an alert that
 * resolves on its own once a request no longer says so.
 */
function downCriteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  const alert: CriteriaAlert = {
    title: "Service is down",
    description: "The sender says it is down.",
    alertSeverityId: ALERT_SEVERITY_ID,
    id: `${DOWN_CRITERIA_ID.slice(0, -4)}2222`,
    autoResolveAlert: true,
  };

  instance.data = {
    ...instance.data!,
    id: DOWN_CRITERIA_ID,
    name: "Service down",
    monitorStatusId: OFFLINE_STATUS_ID,
    changeMonitorStatus: true,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
        value: "down",
      },
    ],
    createAlerts: true,
    alerts: [alert],
  };

  return instance;
}

function monitorWith(
  criteria: Array<MonitorCriteriaInstance>,
  secretKey: string,
): Monitor {
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
  monitor.isArchived = false;
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  // The key the URL carries: monitorResource checks it is still the monitor's.
  monitor.incomingRequestSecretKey = new ObjectID(secretKey);

  return monitor;
}

let monitorUnderTest: Monitor;
let secretKey: string;
let tables: MonitorRecordTables;

let http: Server;
let origin: string;
let queue: ReturnType<typeof Queue.getQueue>;
const workers: Array<ReturnType<typeof QueueWorker.getWorker>> = [];
const secretKeys: Array<string> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  what: string,
  condition: () => boolean | Promise<boolean>,
  timeoutInMs: number = 20000,
): Promise<void> {
  const deadline: number = Date.now() + timeoutInMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }

    await sleep(20);
  }
}

function hash(): string {
  return IncomingRequestPendingStore.getSecretKeyHash(secretKey);
}

// POSTs a body to the monitor's URL, as Orion does; returns the status.
async function post(body: JSONObject | string): Promise<number> {
  const response: globalThis.Response = await fetch(
    `${origin}/incoming-request/${secretKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );

  await response.text();

  return response.status;
}

/*
 * The worker runs the waiting-requests case of the telemetry worker
 * (ProcessTelemetry): a refusal of the monitor completes the job, anything
 * else fails it for BullMQ to retry.
 */
function startWorker(concurrency: number = 1): void {
  QueueWorker.startProcessingJobs();

  workers.push(
    QueueWorker.getWorker(
      QueueName.Telemetry,
      async (job: QueueJob): Promise<void> => {
        const data: TelemetryIngestJobData = job.data as TelemetryIngestJobData;

        try {
          await processPendingIncomingRequestsFromQueue(
            data.incomingRequestPending!,
            {
              isFinalAttempt:
                (Number(job.attemptsMade) || 0) + 1 >=
                (Number(job.opts?.attempts) || 1),
            },
          );
        } catch (err) {
          if (isNonActionableIngestError(err)) {
            return;
          }

          throw err;
        }
      },
      { concurrency: concurrency },
    ),
  );
}

// Nothing of the monitor's is waiting, running or delayed, nor kept.
async function settled(): Promise<void> {
  await waitFor("the monitor's requests to be evaluated", async () => {
    const live: Array<QueueJob | undefined> = await queue.getJobs([
      "active",
      "waiting",
      "delayed",
    ]);

    const hasJob: boolean = live.some((job: QueueJob | undefined) => {
      return (
        (job?.data as TelemetryIngestJobData | undefined)
          ?.incomingRequestPending?.secretKeyHash === hash()
      );
    });

    return !hasJob && !(await IncomingRequestPendingStore.hasPending(hash()));
  });
}

// Each evaluation's request body and monitor log, in the order they ran.
function evaluations(): Array<{
  body: JSONObject;
  summary: MonitorEvaluationSummary;
}> {
  return (MonitorLogUtil.saveMonitorLog as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>) => {
      const dataToProcess: IncomingMonitorRequest = (
        call[0] as { dataToProcess: IncomingMonitorRequest }
      ).dataToProcess;

      return {
        body: dataToProcess.requestBody as JSONObject,
        summary: dataToProcess.evaluationSummary!,
      };
    },
  );
}

// What a monitor log lists under Actions, as "type: title".
function actions(summary: MonitorEvaluationSummary): Array<string> {
  return summary.events
    .filter((event: MonitorEvaluationEvent): boolean => {
      return event.type !== "criteria-met" && event.type !== "criteria-not-met";
    })
    .map((event: MonitorEvaluationEvent): string => {
      return `${event.type}: ${event.title}`;
    });
}

function alertActiveIdOf(alert: Alert): string {
  return String((alert.seriesLabels as JSONObject)?.["alertActiveID"]);
}

// The bodies in the order the endpoint kept them.
function spyOnKeptOrder(): Array<JSONObject> {
  const kept: Array<JSONObject> = [];
  const push: typeof IncomingRequestPendingStore.push =
    IncomingRequestPendingStore.push.bind(IncomingRequestPendingStore);

  jest
    .spyOn(IncomingRequestPendingStore, "push")
    .mockImplementation(
      async (data: Parameters<typeof IncomingRequestPendingStore.push>[0]) => {
        const result: Awaited<ReturnType<typeof push>> = await push(data);
        kept.push(data.payload.requestBody as JSONObject);
        return result;
      },
    );

  return kept;
}

beforeAll(async () => {
  await Redis.connect();

  queue = Queue.getQueue(QueueName.Telemetry);
  await queue.waitUntilReady();

  const app: ExpressApplication = createExpressApp();

  // As StartServer, for every route: JSON, then forms.
  app.use(ExpressJson({ limit: "50mb" }));
  app.use(ExpressUrlEncoded({ extended: true, limit: "50mb" }));
  app.use(["/incoming-request-ingest", "/"], IncomingRequestAPI);
  // The App's own error handler, which answers a refusal with its status.
  app.use(expressErrorHandler);

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

  if (queue) {
    await queue.obliterate({ force: true });
    await queue.close();
  }

  const client: ClientType | null = Redis.getClient();

  if (client && secretKeys.length > 0) {
    await client.del(
      ...secretKeys.flatMap((key: string): Array<string> => {
        const keyHash: string =
          IncomingRequestPendingStore.getSecretKeyHash(key);
        return [
          IncomingRequestPendingStore.getListKey(keyHash),
          IncomingRequestPendingStore.getRequestsKey(keyHash),
        ];
      }),
    );
  }

  await Redis.disconnect();
});

beforeEach(() => {
  secretKey = ObjectID.generate().toString();
  secretKeys.push(secretKey);
  monitorUnderTest = monitorWith([orionCriteria()], secretKey);

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
});

afterEach(async () => {
  await Promise.all(
    workers
      .splice(0)
      .map((worker: ReturnType<typeof QueueWorker.getWorker>) => {
        return worker.close(true);
      }),
  );

  jest.restoreAllMocks();
});

describe("a burst to a monitor grouped by AlertActiveID", () => {
  /*
   * Twenty Orion alerts fire and reset at once: each alert's trigger, then -
   * once it was answered - its reset, every alert at the same time, so their
   * requests cross on the wire in an order nobody chose. Each alert opens
   * once and resolves once.
   */
  test("triggers and resets for many AlertActiveIDs, close together and interleaved, each open and resolve exactly once", async () => {
    const alertActiveIds: Array<string> = Array.from(
      { length: 20 },
      (_value: unknown, index: number): string => {
        return String(48201 + index);
      },
    );
    const kept: Array<JSONObject> = spyOnKeptOrder();
    const random: SeededRandom = seededRandom(10582);
    const pauses: Array<number> = alertActiveIds.map((): number => {
      return random(15);
    });

    // The worker runs while the burst arrives.
    startWorker();

    const statuses: Array<number> = (
      await Promise.all(
        shuffled(alertActiveIds, random).map(
          async (id: string, index: number): Promise<Array<number>> => {
            await sleep(pauses[index]!);
            const triggered: number = await post(orionTrigger(id));
            await sleep(pauses[(index + 7) % pauses.length]!);
            return [triggered, await post(orionReset(id))];
          },
        ),
      )
    ).flat();

    await settled();

    expect(
      statuses.every((status: number) => {
        return status === 200;
      }),
    ).toBe(true);

    // One alert per AlertActiveID, and every one resolved.
    expect(tables.alerts.map(alertActiveIdOf).sort()).toEqual(alertActiveIds);
    expect(tables.alerts.filter(isOpenAlert)).toEqual([]);

    // Resolved once each, by its own reset.
    for (const alert of tables.alerts) {
      expect(
        tables.stateChanges.filter((change: { id: string }) => {
          return change.id === alert.id!.toString();
        }),
      ).toEqual([
        {
          record: "alert",
          id: alert.id!.toString(),
          rootCause: expect.stringContaining(
            "Incoming request reported this key as resolved.",
          ),
        },
      ]);
    }

    // Every request evaluated once, in the order the endpoint kept them.
    expect(
      evaluations().map((evaluation: { body: JSONObject }) => {
        return evaluation.body;
      }),
    ).toEqual(kept);
    expect(kept).toHaveLength(40);
  }, 60000);

  /*
   * The production case of #10582: the burst lands while the monitor's job
   * waits in a backlog. Before, the one job evaluated the newest request:
   * 19 of 20 alerts never opened.
   */
  test("a burst that lands while the monitor's job waits: every trigger opens its own alert", async () => {
    const alertActiveIds: Array<string> = Array.from(
      { length: 20 },
      (_value: unknown, index: number): string => {
        return String(48301 + index);
      },
    );

    for (const id of alertActiveIds) {
      expect(await post(orionTrigger(id))).toBe(200);
    }

    // One job for the whole burst...
    expect(
      (await queue.getJobs(["waiting"])).filter((job: QueueJob) => {
        return (
          (job.data as TelemetryIngestJobData).incomingRequestPending
            ?.secretKeyHash === hash()
        );
      }),
    ).toHaveLength(1);

    startWorker();
    await settled();

    // ...and an alert for every trigger in it.
    expect(tables.alerts.map(alertActiveIdOf)).toEqual(alertActiveIds);
    expect(tables.alerts.filter(isOpenAlert)).toHaveLength(20);

    // The resets come back in a burst too: each resolves only its own.
    await Promise.all(
      [...alertActiveIds].reverse().map((id: string) => {
        return post(orionReset(id));
      }),
    );

    await settled();

    expect(tables.alerts.filter(isOpenAlert)).toEqual([]);
    expect(tables.alerts).toHaveLength(20);
  }, 60000);
});

describe("a trigger and its reset within one evaluation", () => {
  /*
   * Orion fires an alert and resets it before the monitor's job runs - a
   * flapping port. Before, only the reset was evaluated: it resolved
   * nothing, and the alert was never seen at all.
   */
  test("both are evaluated, in order: the alert opens, then resolves", async () => {
    expect(await post(orionTrigger("48214"))).toBe(200);
    expect(await post(orionReset("48214"))).toBe(200);

    startWorker();
    await settled();

    expect(tables.alerts.map(alertActiveIdOf)).toEqual(["48214"]);
    expect(isOpenAlert(tables.alerts[0]!)).toBe(false);

    const [trigger, reset]: Array<{
      body: JSONObject;
      summary: MonitorEvaluationSummary;
    }> = evaluations();

    expect(trigger!.body["status"]).toBe("triggered");
    expect(actions(trigger!.summary)).toEqual([
      `alert-created: Alert created: ${tables.alerts[0]!.title}`,
    ]);
    expect(reset!.body["status"]).toBe("resolved");
    expect(actions(reset!.summary)).toEqual([
      "grouping: Nothing new to open",
      `alert-resolved: Alert resolved: ${tables.alerts[0]!.title}`,
    ]);
  });

  /*
   * The endpoint keeps a request before it answers, so a reset sent once
   * its trigger was answered is kept - and evaluated - after it, however
   * fast it follows.
   */
  test("a reset sent the moment its trigger is answered is kept after it", async () => {
    expect(await post(orionTrigger("48215"))).toBe(200);

    const afterTrigger: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekNewest(hash());
    expect(afterTrigger!.payload.requestBody).toEqual(orionTrigger("48215"));

    expect(await post(orionReset("48215"))).toBe(200);

    const oldest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekOldest(hash());
    const newest: PendingIncomingRequest | null =
      await IncomingRequestPendingStore.peekNewest(hash());

    expect(oldest!.payload.requestBody).toEqual(orionTrigger("48215"));
    expect(newest!.payload.requestBody).toEqual(orionReset("48215"));

    startWorker();
    await settled();

    expect(tables.alerts).toHaveLength(1);
    expect(isOpenAlert(tables.alerts[0]!)).toBe(false);
  });

  test("with the worker running, a trigger and its reset back to back still open and resolve the alert", async () => {
    startWorker();

    expect(await post(orionTrigger("48216"))).toBe(200);
    expect(await post(orionReset("48216"))).toBe(200);

    await settled();

    expect(tables.alerts.map(alertActiveIdOf)).toEqual(["48216"]);
    expect(isOpenAlert(tables.alerts[0]!)).toBe(false);
  });
});

describe("a request the endpoint cannot keep", () => {
  /*
   * Answered 503, for the sender to send again - not 200 and lost behind a
   * success, as a request whose queueing failed after the answer was.
   */
  test("is answered 503, and nothing is evaluated", async () => {
    jest
      .spyOn(IncomingRequestPendingStore, "push")
      .mockRejectedValue(
        new Error(
          "Redis is not connected, so waiting incoming requests cannot be kept or read.",
        ),
      );

    const response: globalThis.Response = await fetch(
      `${origin}/incoming-request/${secretKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(orionTrigger("48217")),
      },
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toContain(
      INCOMING_REQUEST_NOT_QUEUED_MESSAGE,
    );
    expect(
      IncomingRequestReceivedAtStore.advanceIfTracked,
    ).not.toHaveBeenCalled();

    startWorker();
    await sleep(200);

    expect(tables.alerts).toEqual([]);
  });
});

describe("a monitor without grouping", () => {
  beforeEach(() => {
    monitorUnderTest = monitorWith([downCriteria()], secretKey);
  });

  /*
   * A status-style sender: what is true is what it said last. A burst
   * still evaluates only the newest request, as before #10582.
   */
  test("a burst that lands while its job waits: only the newest request is evaluated", async () => {
    for (const status of ["down", "down", "down", "up"]) {
      expect(await post({ status: status })).toBe(200);
    }

    startWorker();
    await settled();

    expect(
      evaluations().map((evaluation: { body: JSONObject }) => {
        return evaluation.body;
      }),
    ).toEqual([{ status: "up" }]);
    expect(tables.alerts).toEqual([]);
  });

  test("its newest request opens what it says, and the older ones are not evaluated", async () => {
    for (const status of ["up", "up", "down"]) {
      expect(await post({ status: status })).toBe(200);
    }

    startWorker();
    await settled();

    expect(evaluations()).toHaveLength(1);
    expect(tables.alerts).toHaveLength(1);
    expect(isOpenAlert(tables.alerts[0]!)).toBe(true);
  });

  test("requests that arrive one at a time are each evaluated, as before", async () => {
    startWorker();

    for (const status of ["down", "up"]) {
      expect(await post({ status: status })).toBe(200);
      await settled();
    }

    expect(
      evaluations().map((evaluation: { body: JSONObject }) => {
        return evaluation.body;
      }),
    ).toEqual([{ status: "down" }, { status: "up" }]);
    expect(tables.alerts).toHaveLength(1);
    expect(isOpenAlert(tables.alerts[0]!)).toBe(false);
  });
});

describe("the monitor's evaluation lock", () => {
  /*
   * The monitor's lock (MonitorEvaluationLock, #10108) is the real one here,
   * on Redis, while the background check of the monitor - what the
   * heartbeat cron runs every 30 seconds - keeps taking it in between the
   * burst's evaluations. Every evaluation still holds it alone, none is
   * lost or run twice, and the burst is evaluated in order.
   */
  test("a burst and the monitor's background checks share the lock: one evaluation at a time, nothing lost", async () => {
    (Semaphore.lock as unknown as jest.Mock).mockRestore();
    (Semaphore.release as unknown as jest.Mock).mockRestore();

    let holding: number = 0;
    let mostHolding: number = 0;
    let acquired: number = 0;

    const acquire: typeof MonitorEvaluationLock.acquire =
      MonitorEvaluationLock.acquire.bind(MonitorEvaluationLock);

    jest
      .spyOn(MonitorEvaluationLock, "acquire")
      .mockImplementation(
        async (
          options: Parameters<typeof MonitorEvaluationLock.acquire>[0],
        ): Promise<MonitorEvaluationLock> => {
          const lock: MonitorEvaluationLock = await acquire(options);
          const release: () => Promise<void> = lock.release.bind(lock);
          let isReleased: boolean = false;

          acquired++;
          holding++;
          mostHolding = Math.max(mostHolding, holding);

          lock.release = async (): Promise<void> => {
            if (!isReleased) {
              isReleased = true;
              holding--;
            }

            await release();
          };

          return lock;
        },
      );

    const alertActiveIds: Array<string> = Array.from(
      { length: 10 },
      (_value: unknown, index: number): string => {
        return String(48401 + index);
      },
    );
    const kept: Array<JSONObject> = spyOnKeptOrder();

    for (const id of alertActiveIds) {
      await post(orionTrigger(id));
      await post(orionReset(id));
    }

    let checking: boolean = true;
    let backgroundChecks: number = 0;

    const backgroundCheck: Promise<void> = (async (): Promise<void> => {
      while (checking) {
        await MonitorResourceUtil.monitorResource({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          requestHeaders: {},
          requestBody: {},
          incomingRequestReceivedAt: new Date(),
          onlyCheckForIncomingRequestReceivedAt: true,
          checkedAt: new Date(),
        } as IncomingMonitorRequest);
        backgroundChecks++;
        await sleep(1);
      }
    })();

    startWorker(4);
    await settled();

    checking = false;
    await backgroundCheck;

    expect(backgroundChecks).toBeGreaterThan(0);
    expect(mostHolding).toBe(1);
    expect(holding).toBe(0);
    expect(acquired).toBeGreaterThanOrEqual(kept.length + backgroundChecks);

    // Every request evaluated once, in order, among the background checks.
    expect(
      evaluations()
        .map((evaluation: { body: JSONObject }) => {
          return evaluation.body;
        })
        .filter((body: JSONObject) => {
          return Object.keys(body).length > 0;
        }),
    ).toEqual(kept);

    expect(tables.alerts.map(alertActiveIdOf)).toEqual(alertActiveIds);
    expect(tables.alerts.filter(isOpenAlert)).toEqual([]);
  }, 60000);
});

describe("a flood past what a monitor keeps", () => {
  /*
   * Its log says how many were skipped, on the first evaluation after: the
   * reader knows alerts may be missing, rather than finding out later.
   */
  test("the evaluation after the skip says how many requests were not evaluated", async () => {
    // What a push past the limit leaves behind for the next evaluation.
    await post(orionTrigger("48501"));
    await post(orionTrigger("48502"));
    await Redis.getClient()!.hset(
      IncomingRequestPendingStore.getRequestsKey(hash()),
      "skippedOverLimit",
      "250",
    );

    startWorker();
    await settled();

    const [first, second]: Array<{
      body: JSONObject;
      summary: MonitorEvaluationSummary;
    }> = evaluations();

    expect(actions(first!.summary)[0]).toBe(
      "requests-skipped: Requests not evaluated: 250",
    );
    expect(first!.summary.events[0]!.message).toBe(
      "More requests were waiting to be evaluated than this monitor keeps, so the oldest of them were skipped. An incident or alert a skipped request would have opened or resolved may be missing or still open.",
    );
    // Said once.
    expect(
      actions(second!.summary).filter((action: string) => {
        return action.startsWith("requests-skipped");
      }),
    ).toEqual([]);
    expect(tables.alerts.map(alertActiveIdOf)).toEqual(["48501", "48502"]);
  });
});
