import MonitorService from "../../../../Server/Services/MonitorService";
import IncomingRequestReceivedAtStore from "../../../../Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import IncomingRequestSecretActivity from "../../../../Server/Utils/Monitor/IncomingRequestSecretActivity";
import IncomingRequestSecretGate, {
  IncomingRequestSecretEdgeDecision,
  IncomingRequestSecretWorkerDecision,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretGate";
import IncomingRequestSecretPolicy, {
  INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
  INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
  IncomingRequestSecretPolicyValue,
  IncomingRequestSecretVerdict,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "../../../../Server/Utils/Monitor/IncomingRequestSecretRequest";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
} from "../../../../Server/Utils/Monitor/MonitorSecretKeyCache";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { IncomingRequestSecretProblem } from "../../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * Where a project's incoming request secret requirement is enforced (issue
 * #7526): at the ingest endpoint, before it answers, and again in the worker,
 * before anything about the request is kept.
 *
 * What matters at the edge:
 *   - a request without the secret is refused with what to send, and its
 *     arrival is never recorded for the heartbeat;
 *   - an arrival is recorded only once the request is known to count;
 *   - a key the edge cannot place goes on undecided - and a made-up key costs
 *     no database read: only a key a trusted caller registered is looked up;
 *   - a failure to decide never refuses, and never records the arrival.
 *
 * What matters in the worker:
 *   - it decides on the policy as it is now, whatever the edge decided;
 *   - X-OneUptime-Secret never reaches what is kept, and a bearer token that
 *     is one of the project's secrets is masked;
 *   - the secret a request was accepted with is stamped as used.
 *
 * And both tell the monitor whether its requests send a valid secret, while
 * the project has one (IncomingRequestSecretActivity, issue #8498): the edge
 * for a request it refuses - which never reaches the worker - and the worker
 * for every request, so the senders to fix are known before the requirement
 * is turned on.
 *
 * The policy, the key cache, the arrival store, the monitor lookup and the
 * monitor's record are stubs.
 */

jest.mock("../../../../Server/Utils/Logger");

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "b0b0b0b0-0000-4000-8000-0000000000b0",
);
const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";
const SECRET: string = "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99";

const hash: (value: string) => string = (value: string): string => {
  return IncomingRequestSecretRequest.hashSecret(value);
};

const REQUIRED: IncomingRequestSecretPolicyValue = {
  isRequired: true,
  secrets: [{ secretId: SECRET_ID, secretHash: hash(SECRET) }],
};

const NOT_REQUIRED: IncomingRequestSecretPolicyValue = {
  isRequired: false,
  secrets: [],
};

// A project with a secret that does not require one yet.
const NOT_REQUIRED_YET: IncomingRequestSecretPolicyValue = {
  isRequired: false,
  secrets: REQUIRED.secrets,
};

let keptMonitor: MonitorOfSecretKey | null;
let isTracked: boolean;
let lookedUpMonitor: Monitor | null;
let policy: IncomingRequestSecretPolicyValue;

let getMonitor: SpyInstance<typeof MonitorSecretKeyCache.getMonitor>;
let setMonitor: SpyInstance<typeof MonitorSecretKeyCache.setMonitor>;
let isTrackedSpy: SpyInstance<
  typeof IncomingRequestReceivedAtStore.isTracked
>;
let findOneBy: SpyInstance<typeof MonitorService.findOneBy>;
let getPolicy: SpyInstance<typeof IncomingRequestSecretPolicy.getPolicy>;
let recordUse: SpyInstance<typeof IncomingRequestSecretPolicy.recordUse>;
let recordActivity: SpyInstance<
  typeof IncomingRequestSecretActivity.record
>;

const makeMonitor: (flags?: Partial<Monitor>) => Monitor = (
  flags?: Partial<Monitor>,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.isArchived = false;
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;
  Object.assign(monitor, flags || {});
  return monitor;
};

beforeEach(() => {
  keptMonitor = { monitorId: MONITOR_ID, projectId: PROJECT_ID };
  isTracked = false;
  lookedUpMonitor = makeMonitor();
  policy = REQUIRED;

  getMonitor = jest
    .spyOn(MonitorSecretKeyCache, "getMonitor")
    .mockImplementation(async () => {
      return keptMonitor;
    });

  setMonitor = jest
    .spyOn(MonitorSecretKeyCache, "setMonitor")
    .mockResolvedValue(undefined);

  isTrackedSpy = jest
    .spyOn(IncomingRequestReceivedAtStore, "isTracked")
    .mockImplementation(async () => {
      return isTracked;
    });

  findOneBy = jest
    .spyOn(MonitorService, "findOneBy")
    .mockImplementation(async () => {
      return lookedUpMonitor;
    });

  getPolicy = jest
    .spyOn(IncomingRequestSecretPolicy, "getPolicy")
    .mockImplementation(async () => {
      return policy;
    });

  recordUse = jest
    .spyOn(IncomingRequestSecretPolicy, "recordUse")
    .mockResolvedValue(undefined);

  recordActivity = jest
    .spyOn(IncomingRequestSecretActivity, "record")
    .mockResolvedValue(undefined);
});

// What the monitor was told, call by call.
const recorded: () => Array<{
  monitorId: string | undefined;
  sentValidSecret: boolean;
  problem: IncomingRequestSecretProblem | undefined;
}> = (): Array<{
  monitorId: string | undefined;
  sentValidSecret: boolean;
  problem: IncomingRequestSecretProblem | undefined;
}> => {
  return recordActivity.mock.calls.map(
    (
      call: Parameters<typeof IncomingRequestSecretActivity.record>,
    ): {
      monitorId: string | undefined;
      sentValidSecret: boolean;
      problem: IncomingRequestSecretProblem | undefined;
    } => {
      return {
        monitorId: call[0].monitorId?.toString(),
        sentValidSecret: call[0].sentValidSecret,
        problem: call[0].problem,
      };
    },
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("decideAtEdge", () => {
  const decide: (
    presented: Array<string>,
    secretKey?: string,
  ) => Promise<IncomingRequestSecretEdgeDecision> = (
    presented: Array<string>,
    secretKey?: string,
  ): Promise<IncomingRequestSecretEdgeDecision> => {
    return IncomingRequestSecretGate.decideAtEdge({
      secretKey: secretKey ?? SECRET_KEY,
      presentedSecretHashes: presented,
    });
  };

  test("a project that does not require a secret: the request counts", async () => {
    policy = NOT_REQUIRED;

    expect(await decide([])).toEqual({ mayRecordArrival: true });
    expect(getPolicy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("the project's secret: the request counts", async () => {
    expect(await decide([hash(SECRET)])).toEqual({ mayRecordArrival: true });
  });

  test("no secret: refused, with what to send, and the arrival not recorded", async () => {
    expect(await decide([])).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
    });
  });

  test("a secret that is not the project's: refused as not recognized", async () => {
    expect(await decide([hash("a-guess-at-the-secret")])).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
    });
  });

  test("a key kept in the cache is placed without a database read", async () => {
    await decide([hash(SECRET)]);

    expect(findOneBy).not.toHaveBeenCalled();
    expect(isTrackedSpy).not.toHaveBeenCalled();
  });

  test("a made-up key costs no database read and goes on undecided", async () => {
    keptMonitor = null;
    isTracked = false;

    expect(await decide([])).toEqual({ mayRecordArrival: false });
    expect(findOneBy).not.toHaveBeenCalled();
    expect(getPolicy).not.toHaveBeenCalled();
  });

  test("a key that is not a UUID is not looked up anywhere", async () => {
    expect(await decide([], "not-a-key")).toEqual({ mayRecordArrival: false });
    expect(getMonitor).not.toHaveBeenCalled();
    expect(isTrackedSpy).not.toHaveBeenCalled();
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("a registered key that is not kept is looked up, kept, and decided", async () => {
    keptMonitor = null;
    isTracked = true;

    expect(await decide([])).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
    });

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(findOneBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(
      (
        findOneBy.mock.calls[0]![0].query as {
          incomingRequestSecretKey: ObjectID;
        }
      ).incomingRequestSecretKey.toString(),
    ).toBe(SECRET_KEY);

    expect(setMonitor).toHaveBeenCalledTimes(1);
    expect(setMonitor.mock.calls[0]![0].monitor.projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("a paused monitor is decided but never kept, as the worker never keeps one", async () => {
    keptMonitor = null;
    isTracked = true;
    lookedUpMonitor = makeMonitor({ disableActiveMonitoring: true });

    await decide([hash(SECRET)]);

    expect(setMonitor).not.toHaveBeenCalled();
    expect(getPolicy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a registered key whose monitor is gone goes on undecided", async () => {
    keptMonitor = null;
    isTracked = true;
    lookedUpMonitor = null;

    expect(await decide([])).toEqual({ mayRecordArrival: false });
    expect(getPolicy).not.toHaveBeenCalled();
  });

  test("a refused request tells its monitor it had no secret: it never reaches the worker", async () => {
    await decide([]);

    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.NoSecret,
      },
    ]);
  });

  test("a refused request with a wrong secret tells its monitor so", async () => {
    await decide([hash("an-old-secret-of-the-sender")]);

    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.WrongSecret,
      },
    ]);
  });

  test("a request that counts is left for the worker to record", async () => {
    await decide([hash(SECRET)]);

    policy = NOT_REQUIRED_YET;
    await decide([]);

    expect(recordActivity).not.toHaveBeenCalled();
  });

  test("a refusal for a key it looked up is recorded on that monitor, paused or not", async () => {
    keptMonitor = null;
    isTracked = true;
    lookedUpMonitor = makeMonitor({ disableActiveMonitoring: true });

    await decide([]);

    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.NoSecret,
      },
    ]);
  });

  test("a key it cannot place records nothing", async () => {
    keptMonitor = null;
    isTracked = false;

    await decide([]);

    expect(recordActivity).not.toHaveBeenCalled();
  });

  test("a failure to decide refuses nothing and records nothing", async () => {
    getPolicy.mockRejectedValueOnce(new Error("Postgres is down"));

    expect(await decide([])).toEqual({ mayRecordArrival: false });

    keptMonitor = null;
    isTracked = true;
    findOneBy.mockRejectedValueOnce(new Error("Postgres is down"));

    expect(await decide([])).toEqual({ mayRecordArrival: false });
  });
});

describe("decideInWorker", () => {
  test("refuses a request without the secret, on the policy as it is now", async () => {
    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        presentedSecretHashes: [],
        requestHeaders: { "content-type": "application/json" },
      });

    expect(decision.isRefused).toBe(true);
    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.Missing);
    expect(getPolicy).toHaveBeenCalledWith(PROJECT_ID);
    expect(recordUse).not.toHaveBeenCalled();
  });

  test("refuses a secret deleted while the job waited", async () => {
    // The edge accepted it; the project's only secret is now another one.
    policy = {
      isRequired: true,
      secrets: [{ secretId: SECRET_ID, secretHash: hash("the-new-secret!!") }],
    };

    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: {},
      });

    expect(decision.isRefused).toBe(true);
    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.NotRecognized);
  });

  test("accepts the project's secret, and stamps it as used", async () => {
    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: { accept: "*/*" },
      });

    expect(decision.isRefused).toBe(false);
    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.Accepted);
    expect(decision.requestHeaders).toEqual({ accept: "*/*" });
    expect(recordUse).toHaveBeenCalledWith(SECRET_ID);
  });

  test("masks a bearer token that is the project's secret before it is kept", async () => {
    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: { authorization: `Bearer ${SECRET}` },
      });

    expect(decision.isRefused).toBe(false);
    expect(decision.requestHeaders).toEqual({
      authorization: `Bearer ${REDACTED}`,
    });
    expect(JSON.stringify(decision)).not.toContain(SECRET);
  });

  test("a job from before the requirement still carries the header: it is read, and taken off", async () => {
    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        presentedSecretHashes: undefined,
        requestHeaders: { "X-OneUptime-Secret": SECRET, accept: "*/*" },
      });

    expect(decision.isRefused).toBe(false);
    expect(decision.requestHeaders).toEqual({ accept: "*/*" });
  });

  test("a project that does not require a secret keeps the request, without the secret header", async () => {
    policy = NOT_REQUIRED;

    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        presentedSecretHashes: [],
        requestHeaders: {
          "x-oneuptime-secret": SECRET,
          authorization: `Bearer ${SECRET}`,
        },
      });

    expect(decision.isRefused).toBe(false);
    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.NotRequired);
    // The sender's own Authorization is the sender's: no project secret to mask.
    expect(decision.requestHeaders).toEqual({
      authorization: `Bearer ${SECRET}`,
    });
    expect(recordUse).not.toHaveBeenCalled();
  });

  test("tells the monitor a refused request had no secret, or a wrong one", async () => {
    await IncomingRequestSecretGate.decideInWorker({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      presentedSecretHashes: [],
      requestHeaders: {},
    });

    await IncomingRequestSecretGate.decideInWorker({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      presentedSecretHashes: [hash("an-old-secret-of-the-sender")],
      requestHeaders: {},
    });

    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.NoSecret,
      },
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.WrongSecret,
      },
    ]);
  });

  test("tells the monitor an accepted request sent the secret", async () => {
    await IncomingRequestSecretGate.decideInWorker({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      presentedSecretHashes: [hash(SECRET)],
      requestHeaders: {},
    });

    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: true,
        problem: undefined,
      },
    ]);
  });

  test("a project with no secret tells the monitor nothing: there is nothing to send", async () => {
    policy = NOT_REQUIRED;

    await IncomingRequestSecretGate.decideInWorker({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      presentedSecretHashes: [],
      requestHeaders: {},
    });

    expect(recordActivity).not.toHaveBeenCalled();
  });

  test("before the project requires a secret, a request without one is kept as it was, and its monitor told", async () => {
    policy = NOT_REQUIRED_YET;

    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        presentedSecretHashes: [],
        requestHeaders: { "user-agent": "acme-cron/1.4" },
      });

    expect(decision.isRefused).toBe(false);
    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.NotRequired);
    expect(decision.requestHeaders).toEqual({ "user-agent": "acme-cron/1.4" });
    expect(recordUse).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.NoSecret,
      },
    ]);
  });

  test("before the project requires a secret, a sender's own bearer token is kept for its criteria, and counted as a wrong secret, as the requirement would refuse it", async () => {
    policy = NOT_REQUIRED_YET;

    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        presentedSecretHashes: [],
        requestHeaders: { authorization: "Bearer the-senders-own-token" },
      });

    expect(decision.isRefused).toBe(false);
    expect(decision.requestHeaders).toEqual({
      authorization: "Bearer the-senders-own-token",
    });
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.WrongSecret,
      },
    ]);

    // The same request, once the project requires a secret.
    policy = REQUIRED;

    const refused: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        presentedSecretHashes: [],
        requestHeaders: { authorization: "Bearer the-senders-own-token" },
      });

    expect(refused.verdict).toBe(IncomingRequestSecretVerdict.NotRecognized);
  });

  test("before the project requires a secret, one of its secrets is stamped as used and masked, as it would be after", async () => {
    policy = NOT_REQUIRED_YET;

    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: { authorization: `Bearer ${SECRET}` },
      });

    expect(decision.isRefused).toBe(false);
    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.NotRequired);
    expect(decision.requestHeaders).toEqual({
      authorization: `Bearer ${REDACTED}`,
    });
    expect(JSON.stringify(decision)).not.toContain(SECRET);
    expect(recordUse).toHaveBeenCalledWith(SECRET_ID);
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: true,
        problem: undefined,
      },
    ]);
  });

  test("a failed read of the policy fails the job, so it is retried", async () => {
    getPolicy.mockRejectedValueOnce(new Error("Postgres is down"));

    await expect(
      IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: {},
      }),
    ).rejects.toThrow("Postgres is down");
  });
});
