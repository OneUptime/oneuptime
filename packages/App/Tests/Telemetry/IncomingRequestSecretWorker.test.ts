/*
 * The Incoming Request worker and a project's incoming request secret
 * requirement (issue #7526).
 *
 * The endpoint refuses what it can, but it does not always know a request's
 * project (a new monitor's first request), and a secret can be deleted while a
 * job waits. So the worker decides again, on the policy as it is when the job
 * runs, before anything about the request is kept:
 *
 *   - a refused request is never tracked as a heartbeat, never kept as the
 *     monitor's latest request and never evaluated against its criteria;
 *   - an accepted one is evaluated as before, without the secret in it:
 *     X-OneUptime-Secret taken off, a Bearer token that is one of the
 *     project's secrets masked;
 *   - a request to a project that requires no secret is evaluated exactly as
 *     before.
 *
 * The real gate (IncomingRequestSecretGate) and request parsing run; the
 * project's policy, the monitor lookup, the arrival store and the evaluation
 * are stubbed.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(() => {
        return Promise.resolve();
      }),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import { processIncomingRequestFromQueue } from "../../FeatureSet/Telemetry/Jobs/IncomingRequestIngest/ProcessIncomingRequestIngest";
import { IncomingRequestIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import IncomingRequestReceivedAtStore from "Common/Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import IncomingRequestSecretPolicy, {
  IncomingRequestSecretPolicyValue,
} from "Common/Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "Common/Server/Utils/Monitor/IncomingRequestSecretRequest";
import MonitorSecretKeyCache from "Common/Server/Utils/Monitor/MonitorSecretKeyCache";
import { REDACTED } from "Common/Server/Utils/LogRedaction";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Dictionary from "Common/Types/Dictionary";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ObjectID from "Common/Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const PROJECT_ID: string = "aaaaaaaa-0000-4000-8000-00000000000a";
const MONITOR_ID: string = "b0b0b0b0-0000-4000-8000-0000000000b0";
const PROJECT_SECRET: string = "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99";
const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";

const REQUIRED: IncomingRequestSecretPolicyValue = {
  isRequired: true,
  secrets: [
    {
      secretId: SECRET_ID,
      secretHash: IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
    },
  ],
};

const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const findOneBy: jest.Mock = MonitorService.findOneBy as unknown as jest.Mock;

let policy: IncomingRequestSecretPolicyValue;
let track: jest.SpiedFunction<typeof IncomingRequestReceivedAtStore.track>;
let recordUse: jest.SpiedFunction<typeof IncomingRequestSecretPolicy.recordUse>;

const job: (
  overrides?: Partial<IncomingRequestIngestJobData>,
) => IncomingRequestIngestJobData = (
  overrides?: Partial<IncomingRequestIngestJobData>,
): IncomingRequestIngestJobData => {
  return {
    secretKey: SECRET_KEY,
    requestHeaders: {
      "content-type": "application/json",
      "user-agent": "acme-cron/1.4",
    },
    requestBody: { status: "ok" },
    requestMethod: "POST",
    ingestionTimestamp: new Date(),
    ...overrides,
  } as IncomingRequestIngestJobData;
};

const evaluated: () => IncomingMonitorRequest = (): IncomingMonitorRequest => {
  expect(monitorResource).toHaveBeenCalledTimes(1);
  return monitorResource.mock.calls[0]![0] as IncomingMonitorRequest;
};

beforeEach(() => {
  jest.clearAllMocks();

  policy = REQUIRED;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.projectId = new ObjectID(PROJECT_ID);
  monitor.isArchived = false;
  monitor.disableActiveMonitoring = false;
  monitor.disableActiveMonitoringBecauseOfManualIncident = false;
  monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent = false;

  findOneBy.mockResolvedValue(monitor as never);
  monitorResource.mockResolvedValue({} as never);

  jest.spyOn(MonitorSecretKeyCache, "getMonitor").mockResolvedValue(null);
  jest.spyOn(MonitorSecretKeyCache, "setMonitor").mockResolvedValue(undefined);

  track = jest
    .spyOn(IncomingRequestReceivedAtStore, "track")
    .mockImplementation(async (data: { receivedAt: Date }) => {
      return data.receivedAt;
    });

  jest
    .spyOn(IncomingRequestSecretPolicy, "getPolicy")
    .mockImplementation(async () => {
      return policy;
    });

  recordUse = jest
    .spyOn(IncomingRequestSecretPolicy, "recordUse")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project that requires an incoming request secret", () => {
  test("a request without the secret is not tracked, kept or evaluated", async () => {
    await processIncomingRequestFromQueue(job({ presentedSecretHashes: [] }));

    expect(track).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
  });

  test("a request whose secret was deleted while it waited is refused too", async () => {
    policy = {
      isRequired: true,
      secrets: [
        {
          secretId: SECRET_ID,
          secretHash: IncomingRequestSecretRequest.hashSecret(
            "the-secret-that-replaced-it",
          ),
        },
      ],
    };

    await processIncomingRequestFromQueue(
      job({
        presentedSecretHashes: [
          IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
        ],
      }),
    );

    expect(monitorResource).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  test("an accepted request is tracked and evaluated, and its secret stamped as used", async () => {
    await processIncomingRequestFromQueue(
      job({
        presentedSecretHashes: [
          IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
        ],
      }),
    );

    expect(track).toHaveBeenCalledTimes(1);
    expect(evaluated().requestHeaders).toEqual({
      "content-type": "application/json",
      "user-agent": "acme-cron/1.4",
    });
    expect(recordUse).toHaveBeenCalledWith(SECRET_ID);
  });

  test("a Bearer token that is the project's secret is masked before it is kept", async () => {
    await processIncomingRequestFromQueue(
      job({
        requestHeaders: {
          authorization: `Bearer ${PROJECT_SECRET}`,
          "user-agent": "alertmanager/0.27",
        },
        presentedSecretHashes: [
          IncomingRequestSecretRequest.hashSecret(PROJECT_SECRET),
        ],
      }),
    );

    const headers: Dictionary<string> = evaluated().requestHeaders || {};

    expect(headers["authorization"]).toBe(`Bearer ${REDACTED}`);
    expect(JSON.stringify(evaluated())).not.toContain(PROJECT_SECRET);
  });

  test("a job queued before the requirement still carries the header: it is checked and taken off", async () => {
    await processIncomingRequestFromQueue(
      job({
        requestHeaders: {
          "X-OneUptime-Secret": PROJECT_SECRET,
          "user-agent": "acme-cron/1.4",
        },
        presentedSecretHashes: undefined,
      }),
    );

    expect(evaluated().requestHeaders).toEqual({
      "user-agent": "acme-cron/1.4",
    });
    expect(JSON.stringify(evaluated())).not.toContain(PROJECT_SECRET);
  });
});

describe("a project that requires no secret", () => {
  beforeEach(() => {
    policy = { isRequired: false, secrets: [] };
  });

  test("every request is tracked and evaluated as before", async () => {
    await processIncomingRequestFromQueue(job());

    expect(track).toHaveBeenCalledTimes(1);
    expect(evaluated().requestHeaders).toEqual({
      "content-type": "application/json",
      "user-agent": "acme-cron/1.4",
    });
    expect(recordUse).not.toHaveBeenCalled();
  });

  test("the sender's own Authorization header is kept for its criteria", async () => {
    await processIncomingRequestFromQueue(
      job({
        requestHeaders: { authorization: "Bearer the-senders-own-token" },
      }),
    );

    expect(evaluated().requestHeaders).toEqual({
      authorization: "Bearer the-senders-own-token",
    });
  });
});
