import MonitorService from "../../../../Server/Services/MonitorService";
import IncomingRequestReceivedAtStore from "../../../../Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import IncomingRequestSecretActivity from "../../../../Server/Utils/Monitor/IncomingRequestSecretActivity";
import IncomingRequestMonitorLabels from "../../../../Server/Utils/Monitor/IncomingRequestMonitorLabels";
import IncomingRequestSecretGate, {
  IncomingRequestSecretEdgeDecision,
  IncomingRequestSecretRefusalKind,
  IncomingRequestSecretWorkerDecision,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretGate";
import IncomingRequestSecretPolicy, {
  INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
  INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
  INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE,
  INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE,
  IncomingRequestSecretPolicyValue,
  IncomingRequestSecretVerdict,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "../../../../Server/Utils/Monitor/IncomingRequestSecretRequest";
import IncomingRequestSecretValues from "../../../../Server/Utils/Monitor/IncomingRequestSecretValues";
import IncomingRequestSignature from "../../../../Server/Utils/Monitor/IncomingRequestSignature";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
} from "../../../../Server/Utils/Monitor/MonitorSecretKeyCache";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import WrongIncomingRequestSecretLimit, {
  WRONG_INCOMING_REQUEST_SECRETS_MESSAGE,
} from "../../../../Server/Utils/RateLimit/WrongIncomingRequestSecretLimit";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../../Types/Dictionary";
import {
  IncomingRequestSecretProblem,
  IncomingRequestSignatureScheme,
} from "../../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "../../../../Types/Monitor/MonitorSecretAccess";
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
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "c0c0c0c0-0000-4000-8000-0000000000c0",
);
const LABEL_ID: string = "1abe1000-0000-4000-8000-00000000000a";
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
let isTrackedSpy: SpyInstance<typeof IncomingRequestReceivedAtStore.isTracked>;
// The monitor's lookup by its key: by the key's hash, as it is kept encrypted (#9012).
let findOneBy: SpyInstance<typeof MonitorService.findOneByPresentedKey>;
let getPolicy: SpyInstance<typeof IncomingRequestSecretPolicy.getPolicy>;
let recordUse: SpyInstance<typeof IncomingRequestSecretPolicy.recordUse>;
let recordActivity: SpyInstance<typeof IncomingRequestSecretActivity.record>;

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
    .spyOn(MonitorService, "findOneByPresentedKey")
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
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });
  });

  test("a secret that is not the project's: refused as not recognized", async () => {
    expect(await decide([hash("a-guess-at-the-secret")])).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
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
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(findOneBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(findOneBy.mock.calls[0]![0].column).toBe("incomingRequestSecretKey");
    expect(String(findOneBy.mock.calls[0]![0].presentedKey)).toBe(SECRET_KEY);

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

  /*
   * A verification handshake (WebhookVerification, issue #8429) is answered
   * only for a monitor's key, once the project's requirement lets it
   * through - and it is usually a new monitor's first request, whose key no
   * trusted caller has registered yet. So the edge looks it up whatever the
   * key, when asked to.
   */
  describe("for a verification handshake, which asks to place an untracked key", () => {
    const decideHandshake: (
      presented: Array<string>,
      secretKey?: string,
    ) => Promise<IncomingRequestSecretEdgeDecision> = (
      presented: Array<string>,
      secretKey?: string,
    ): Promise<IncomingRequestSecretEdgeDecision> => {
      return IncomingRequestSecretGate.decideAtEdge({
        secretKey: secretKey ?? SECRET_KEY,
        presentedSecretHashes: presented,
        placeUntrackedKey: true,
      });
    };

    beforeEach(() => {
      keptMonitor = null;
      isTracked = false;
    });

    test("a new monitor's key is looked up, kept, and decided", async () => {
      policy = NOT_REQUIRED;

      expect(await decideHandshake([])).toEqual({ mayRecordArrival: true });
      expect(isTrackedSpy).not.toHaveBeenCalled();
      expect(findOneBy).toHaveBeenCalledTimes(1);
      expect(setMonitor).toHaveBeenCalledTimes(1);
    });

    test("the project's requirement still refuses it without the secret", async () => {
      expect(await decideHandshake([])).toEqual({
        mayRecordArrival: false,
        refusalMessage: INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
        refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
      });
      expect(recorded()).toEqual([
        {
          monitorId: MONITOR_ID.toString(),
          sentValidSecret: false,
          problem: IncomingRequestSecretProblem.NoSecret,
        },
      ]);
    });

    test("and lets it through with the secret", async () => {
      expect(await decideHandshake([hash(SECRET)])).toEqual({
        mayRecordArrival: true,
      });
    });

    test("a key that is no monitor's is not placed", async () => {
      lookedUpMonitor = null;

      expect(await decideHandshake([])).toEqual({ mayRecordArrival: false });
      expect(getPolicy).not.toHaveBeenCalled();
    });

    test("a key kept in the cache still costs no database read", async () => {
      keptMonitor = { monitorId: MONITOR_ID, projectId: PROJECT_ID };

      await decideHandshake([hash(SECRET)]);

      expect(findOneBy).not.toHaveBeenCalled();
    });

    test("a key that is not a UUID is still looked up nowhere", async () => {
      expect(await decideHandshake([], "not-a-key")).toEqual({
        mayRecordArrival: false,
      });
      expect(getMonitor).not.toHaveBeenCalled();
      expect(findOneBy).not.toHaveBeenCalled();
    });

    test("a failed lookup refuses nothing, and places nothing", async () => {
      findOneBy.mockRejectedValue(new Error("Postgres is unreachable"));

      expect(await decideHandshake([])).toEqual({ mayRecordArrival: false });
    });
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

  test("refuses a secret limited to another monitor, and tells the monitor so (issue #8501)", async () => {
    policy = {
      isRequired: true,
      secrets: [
        {
          secretId: SECRET_ID,
          secretHash: hash(SECRET),
          monitorAccess: MonitorSecretAccess.SpecificMonitors,
          monitorIds: [OTHER_MONITOR_ID.toString()],
          labelIds: [],
        },
      ],
    };

    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: {},
      });

    expect(decision.isRefused).toBe(true);
    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.NotRecognized);
    expect(recordUse).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.SecretNotForMonitor,
      },
    ]);

    // The monitor it covers accepts it.
    expect(
      (
        await IncomingRequestSecretGate.decideInWorker({
          projectId: PROJECT_ID,
          monitorId: OTHER_MONITOR_ID,
          presentedSecretHashes: [hash(SECRET)],
          requestHeaders: {},
        })
      ).isRefused,
    ).toBe(false);
  });

  test("reads the monitor's labels for a label-scoped secret, and only then", async () => {
    const getLabelIds: SpyInstance<
      typeof IncomingRequestMonitorLabels.getLabelIds
    > = jest
      .spyOn(IncomingRequestMonitorLabels, "getLabelIds")
      .mockResolvedValue([LABEL_ID]);

    await IncomingRequestSecretGate.decideInWorker({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      presentedSecretHashes: [hash(SECRET)],
      requestHeaders: {},
    });

    expect(getLabelIds).not.toHaveBeenCalled();

    policy = {
      isRequired: true,
      secrets: [
        {
          secretId: SECRET_ID,
          secretHash: hash(SECRET),
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          monitorIds: [],
          labelIds: [LABEL_ID],
        },
      ],
    };

    const decision: IncomingRequestSecretWorkerDecision =
      await IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: {},
      });

    expect(getLabelIds).toHaveBeenCalledWith(MONITOR_ID.toString());
    expect(decision.isRefused).toBe(false);

    // A monitor without the label is refused it.
    getLabelIds.mockResolvedValueOnce([]);

    expect(
      (
        await IncomingRequestSecretGate.decideInWorker({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          presentedSecretHashes: [hash(SECRET)],
          requestHeaders: {},
        })
      ).isRefused,
    ).toBe(true);
  });

  test("a failed read of the monitor's labels fails the job, so it is retried, rather than refusing", async () => {
    policy = {
      isRequired: true,
      secrets: [
        {
          secretId: SECRET_ID,
          secretHash: hash(SECRET),
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          monitorIds: [],
          labelIds: [LABEL_ID],
        },
      ],
    };

    jest
      .spyOn(IncomingRequestMonitorLabels, "getLabelIds")
      .mockRejectedValue(new Error("Postgres is down"));

    await expect(
      IncomingRequestSecretGate.decideInWorker({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        presentedSecretHashes: [hash(SECRET)],
        requestHeaders: {},
      }),
    ).rejects.toThrow("Postgres is down");
  });
});

/*
 * A secret limited to some monitors (issue #8501), at the edge: refused by
 * every other monitor with the 401 a wrong secret gets.
 */
describe("decideAtEdge, for a secret limited to some monitors", () => {
  test("is accepted by the monitor it names, and refused by another as if wrong", async () => {
    policy = {
      isRequired: true,
      secrets: [
        {
          secretId: SECRET_ID,
          secretHash: hash(SECRET),
          monitorAccess: MonitorSecretAccess.SpecificMonitors,
          monitorIds: [MONITOR_ID.toString()],
          labelIds: [],
        },
      ],
    };

    expect(
      await IncomingRequestSecretGate.decideAtEdge({
        secretKey: SECRET_KEY,
        presentedSecretHashes: [hash(SECRET)],
      }),
    ).toEqual({ mayRecordArrival: true });

    keptMonitor = { monitorId: OTHER_MONITOR_ID, projectId: PROJECT_ID };

    expect(
      await IncomingRequestSecretGate.decideAtEdge({
        secretKey: SECRET_KEY,
        presentedSecretHashes: [hash(SECRET)],
      }),
    ).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });

    expect(recorded()).toEqual([
      {
        monitorId: OTHER_MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.SecretNotForMonitor,
      },
    ]);
  });
});

/*
 * A client that sends too many different wrong secrets to one monitor
 * (issue #8499) is refused with 429. The limit itself is
 * WrongIncomingRequestSecretLimit's (its own suite); here, when the edge asks
 * it, and what it does with the answer.
 */
describe("decideAtEdge, for a client guessing a monitor's secret", () => {
  const CLIENT_REQUEST: ExpressRequest = {
    headers: { "x-forwarded-for": "203.0.113.7" },
    socket: { remoteAddress: "10.0.0.2" },
  } as unknown as ExpressRequest;

  const REFUSAL: { retryAfterSeconds: number } = { retryAfterSeconds: 321 };

  let checkBeforeComparing: SpyInstance<
    typeof WrongIncomingRequestSecretLimit.checkBeforeComparing
  >;
  let countWrong: SpyInstance<
    typeof WrongIncomingRequestSecretLimit.countWrong
  >;

  beforeEach(() => {
    checkBeforeComparing = jest
      .spyOn(WrongIncomingRequestSecretLimit, "checkBeforeComparing")
      .mockResolvedValue(null);
    countWrong = jest
      .spyOn(WrongIncomingRequestSecretLimit, "countWrong")
      .mockResolvedValue(null);
  });

  const decide: (
    presented: Array<string>,
  ) => Promise<IncomingRequestSecretEdgeDecision> = (
    presented: Array<string>,
  ): Promise<IncomingRequestSecretEdgeDecision> => {
    return IncomingRequestSecretGate.decideAtEdge({
      secretKey: SECRET_KEY,
      presentedSecretHashes: presented,
      req: CLIENT_REQUEST,
    });
  };

  test("a wrong secret is counted for the client and the monitor, and still answered 401 within the limit", async () => {
    expect(await decide([hash("a-guess-at-the-secret")])).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });

    expect(checkBeforeComparing).toHaveBeenCalledTimes(1);
    expect(countWrong).toHaveBeenCalledTimes(1);
    expect(countWrong.mock.calls[0]![0]).toEqual({
      req: CLIENT_REQUEST,
      monitorId: MONITOR_ID.toString(),
      wrongValues: [hash("a-guess-at-the-secret")],
    });
  });

  test("the wrong secret that takes it over the limit is answered 429, with when to try again", async () => {
    countWrong.mockResolvedValueOnce(REFUSAL);

    expect(await decide([hash("the-eleventh-guess")])).toEqual({
      mayRecordArrival: false,
      refusalMessage: WRONG_INCOMING_REQUEST_SECRETS_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.TooManyWrongSecrets,
      retryAfterSeconds: 321,
    });

    // The monitor still learns its request had a wrong secret.
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.WrongSecret,
      },
    ]);
  });

  test("a client over the limit is refused 429 before its secret is compared, the right one too", async () => {
    checkBeforeComparing.mockResolvedValue(REFUSAL);

    for (const presented of [[hash(SECRET)], [hash("another-guess")]]) {
      expect(await decide(presented)).toEqual({
        mayRecordArrival: false,
        refusalMessage: WRONG_INCOMING_REQUEST_SECRETS_MESSAGE,
        refusalKind: IncomingRequestSecretRefusalKind.TooManyWrongSecrets,
        retryAfterSeconds: 321,
      });
    }

    expect(countWrong).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
  });

  test("the right secret is never counted", async () => {
    expect(await decide([hash(SECRET)])).toEqual({ mayRecordArrival: true });
    expect(countWrong).not.toHaveBeenCalled();
  });

  test("a request with no secret guesses nothing: neither checked nor counted", async () => {
    expect(await decide([])).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });
    expect(checkBeforeComparing).not.toHaveBeenCalled();
    expect(countWrong).not.toHaveBeenCalled();
  });

  test("a project that does not require a secret refuses nothing, so nothing can be guessed or counted", async () => {
    policy = NOT_REQUIRED_YET;

    expect(await decide([hash("a-guess-at-the-secret")])).toEqual({
      mayRecordArrival: true,
    });
    expect(checkBeforeComparing).not.toHaveBeenCalled();
    expect(countWrong).not.toHaveBeenCalled();
  });

  test("a caller with no request counts nothing", async () => {
    await IncomingRequestSecretGate.decideAtEdge({
      secretKey: SECRET_KEY,
      presentedSecretHashes: [hash("a-guess-at-the-secret")],
    });

    expect(checkBeforeComparing).not.toHaveBeenCalled();
    expect(countWrong).not.toHaveBeenCalled();
  });
});

/*
 * A signed request (issue #8500): its signature is checked with the values
 * of the project's secrets, at the edge, where the body is as it came.
 */
describe("decideAtEdge, for a signed request", () => {
  const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
  const NOW_SECONDS: number = Math.floor(NOW.getTime() / 1000);
  const BODY: Buffer = Buffer.from('{"status":"healthy"}', "utf8");

  let getSigningSecrets: SpyInstance<
    typeof IncomingRequestSecretValues.getSigningSecrets
  >;
  let rememberAccepted: SpyInstance<
    typeof IncomingRequestSignature.rememberAccepted
  >;
  let countWrong: SpyInstance<
    typeof WrongIncomingRequestSecretLimit.countWrong
  >;

  const CLIENT_REQUEST: ExpressRequest = {
    headers: { "x-forwarded-for": "203.0.113.7" },
    socket: { remoteAddress: "10.0.0.2" },
  } as unknown as ExpressRequest;

  beforeEach(() => {
    getSigningSecrets = jest
      .spyOn(IncomingRequestSecretValues, "getSigningSecrets")
      .mockResolvedValue([{ secretId: SECRET_ID, value: SECRET }]);
    rememberAccepted = jest
      .spyOn(IncomingRequestSignature, "rememberAccepted")
      .mockResolvedValue(true);
    jest
      .spyOn(WrongIncomingRequestSecretLimit, "checkBeforeComparing")
      .mockResolvedValue(null);
    countWrong = jest
      .spyOn(WrongIncomingRequestSecretLimit, "countWrong")
      .mockResolvedValue(null);
  });

  const signed: (data?: {
    secret?: string;
    timestampSeconds?: number;
    scheme?: IncomingRequestSignatureScheme;
  }) => Dictionary<string> = (data?: {
    secret?: string;
    timestampSeconds?: number;
    scheme?: IncomingRequestSignatureScheme;
  }): Dictionary<string> => {
    const scheme: IncomingRequestSignatureScheme =
      data?.scheme || IncomingRequestSignatureScheme.OneUptime;
    const timestampSeconds: number = data?.timestampSeconds ?? NOW_SECONDS;

    const headers: Dictionary<string> = {
      [IncomingRequestSignature.formatOf(scheme).header]:
        IncomingRequestSignature.sign({
          scheme,
          secret: data?.secret || SECRET,
          body: BODY,
          timestampSeconds,
        }),
    };

    // Slack sends the time in a header of its own.
    const timestampHeader: string | undefined =
      IncomingRequestSignature.formatOf(scheme).timestampHeader;

    if (timestampHeader) {
      headers[timestampHeader] = String(timestampSeconds);
    }

    return headers;
  };

  const decideSigned: (
    headers: Dictionary<string>,
    presented?: Array<string>,
  ) => Promise<IncomingRequestSecretEdgeDecision> = (
    headers: Dictionary<string>,
    presented?: Array<string>,
  ): Promise<IncomingRequestSecretEdgeDecision> => {
    return IncomingRequestSecretGate.decideAtEdge({
      secretKey: SECRET_KEY,
      presentedSecretHashes: presented || [],
      requestHeaders: headers,
      signedBody: BODY,
      req: CLIENT_REQUEST,
      now: NOW,
    });
  };

  test("a signature made with the project's secret is accepted, and presents that secret to the worker", async () => {
    for (const scheme of Object.values(IncomingRequestSignatureScheme)) {
      expect(await decideSigned(signed({ scheme }))).toEqual({
        mayRecordArrival: true,
        signedWithSecretHash: hash(SECRET),
      });
    }

    expect(getSigningSecrets).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      policy: REQUIRED,
    });
    expect(rememberAccepted).toHaveBeenCalled();
  });

  test("the same signed request sent again is refused as a replay, and is no wrong guess", async () => {
    rememberAccepted.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect(await decideSigned(signed())).toEqual({
      mayRecordArrival: true,
      signedWithSecretHash: hash(SECRET),
    });

    expect(await decideSigned(signed())).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });

    expect(countWrong).not.toHaveBeenCalled();
    // The first one was recorded as a valid request by the worker; the replay is not news.
    expect(recordActivity).not.toHaveBeenCalled();
  });

  test("a signature made with a wrong secret is refused as not recognized, and counted as a guess", async () => {
    const headers: Dictionary<string> = signed({
      secret: "a-secret-that-is-not-the-projects",
    });

    expect(await decideSigned(headers)).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });

    expect(countWrong).toHaveBeenCalledTimes(1);
    expect(countWrong.mock.calls[0]![0].wrongValues).toEqual([
      IncomingRequestSignature.readPresentedSignatures(headers)[0]!.digests[0],
    ]);
    expect(rememberAccepted).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.WrongSecret,
      },
    ]);
  });

  test("a signature more than five minutes old is refused as expired, recorded as such, and not counted", async () => {
    expect(
      await decideSigned(signed({ timestampSeconds: NOW_SECONDS - 3600 })),
    ).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });

    expect(countWrong).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.ExpiredSignature,
      },
    ]);
  });

  test("a signature made with a secret limited to another monitor is refused, as not for this monitor", async () => {
    policy = {
      isRequired: true,
      secrets: [
        {
          secretId: SECRET_ID,
          secretHash: hash(SECRET),
          monitorAccess: MonitorSecretAccess.SpecificMonitors,
          monitorIds: [OTHER_MONITOR_ID.toString()],
          labelIds: [],
        },
      ],
    };

    expect(await decideSigned(signed())).toEqual({
      mayRecordArrival: false,
      refusalMessage: INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
      refusalKind: IncomingRequestSecretRefusalKind.NotAuthenticated,
    });
    expect(rememberAccepted).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.SecretNotForMonitor,
      },
    ]);
  });

  test("a signed request for a key no trusted caller registered is looked up: a signature is checked only here", async () => {
    keptMonitor = null;
    isTracked = false;

    expect(await decideSigned(signed())).toEqual({
      mayRecordArrival: true,
      signedWithSecretHash: hash(SECRET),
    });
    expect(isTrackedSpy).not.toHaveBeenCalled();
    expect(findOneBy).toHaveBeenCalledTimes(1);
  });

  test("a header that only looks like a signature places no untracked key", async () => {
    keptMonitor = null;
    isTracked = false;

    expect(
      await decideSigned({ "x-hub-signature-256": "sha256=not-a-signature" }),
    ).toEqual({ mayRecordArrival: false });
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("before the project requires a secret, a good signature counts, is presented to the worker, and nothing is remembered", async () => {
    policy = NOT_REQUIRED_YET;

    expect(await decideSigned(signed())).toEqual({
      mayRecordArrival: true,
      signedWithSecretHash: hash(SECRET),
    });
    expect(rememberAccepted).not.toHaveBeenCalled();
  });

  test("before the project requires a secret, a signature no secret made is let through, and the worker is told it was wrong", async () => {
    policy = NOT_REQUIRED_YET;

    expect(
      await decideSigned(signed({ secret: "not-the-projects-secret-at-all" })),
    ).toEqual({
      mayRecordArrival: true,
      signatureProblem: IncomingRequestSecretProblem.WrongSecret,
    });

    expect(
      await decideSigned(signed({ timestampSeconds: NOW_SECONDS - 3600 })),
    ).toEqual({
      mayRecordArrival: true,
      signatureProblem: IncomingRequestSecretProblem.ExpiredSignature,
    });

    // The worker records it as such, as nothing else was sent.
    await IncomingRequestSecretGate.decideInWorker({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      presentedSecretHashes: [],
      requestHeaders: {},
      signatureProblem: IncomingRequestSecretProblem.WrongSecret,
    });

    expect(recorded()).toEqual([
      {
        monitorId: MONITOR_ID.toString(),
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.WrongSecret,
      },
    ]);
  });

  test("the worker reads only a signature problem it knows from a job", async () => {
    await IncomingRequestSecretGate.decideInWorker({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      presentedSecretHashes: [],
      requestHeaders: {},
      signatureProblem:
        "Something Else" as unknown as IncomingRequestSecretProblem,
    });

    expect(recorded()[0]!.problem).toBe(IncomingRequestSecretProblem.NoSecret);
  });

  test("a request let in by a secret in a header is not refused for a signature it sent again", async () => {
    rememberAccepted.mockResolvedValue(false);

    expect(await decideSigned(signed(), [hash(SECRET)])).toEqual({
      mayRecordArrival: true,
      signedWithSecretHash: hash(SECRET),
    });
    expect(rememberAccepted).not.toHaveBeenCalled();
  });

  test("a project with no secret reads no value and checks nothing", async () => {
    policy = NOT_REQUIRED;

    expect(await decideSigned(signed())).toEqual({ mayRecordArrival: true });
    expect(getSigningSecrets).not.toHaveBeenCalled();
  });

  test("values that cannot be read decide nothing: the worker decides", async () => {
    getSigningSecrets.mockRejectedValueOnce(new Error("Postgres is down"));

    expect(await decideSigned(signed())).toEqual({ mayRecordArrival: false });
  });
});
