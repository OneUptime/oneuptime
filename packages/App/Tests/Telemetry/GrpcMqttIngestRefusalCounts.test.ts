import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import * as grpc from "@grpc/grpc-js";

/*
 * THE TWO NON-HTTP INGEST PIPES COUNT THEIR REFUSALS TOO (issue #6378).
 *
 * The gRPC OTLP server and the MQTT broker make their own key decisions
 * (TelemetryIngestionKeyGuard), so they count their own refusals: against
 * the key, under the guard's reason, on the Grpc or Mqtt surface - and
 * nothing for a token that names no key. The key's page lists these beside
 * the HTTP endpoints' refusals; a pipe that forgot would leave a disabled
 * key's gRPC exporter invisible there.
 *
 * The recorder is spied on; the key lookup, the queue, the broker and its
 * socket are stubbed as in GrpcMqttIngestionKeyRefusal.test.ts.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: jest.fn(),
      getProjectIdFromSecretKey: jest.fn(),
      findOneBy: jest.fn(),
      markUsed: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TelemetryIngestionKeyRefusalService", () => {
  return {
    __esModule: true,
    default: {
      addRefusals: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/PayAsYouGoBillingService", () => {
  return {
    __esModule: true,
    default: { requirePayAsYouGo: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: {
      getCredentialContext: jest.fn(),
      markConnected: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter",
  () => {
    return {
      __esModule: true,
      default: {
        consume: jest.fn(),
      },
    };
  },
);

const admit: jest.Mock = jest.fn();
jest.mock("Common/Server/Utils/Telemetry/TelemetryIngestionBudget", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Telemetry/TelemetryIngestionBudget",
  ) as Record<string, unknown>;

  return { __esModule: true, ...actual, default: { admit } };
});

jest.mock("aedes", () => {
  const brokers: Array<Record<string, unknown>> = [];

  return {
    __esModule: true,
    Aedes: {
      createBroker: async (): Promise<Record<string, unknown>> => {
        const broker: Record<string, unknown> = {
          on: (): void => {
            return undefined;
          },
        };
        brokers.push(broker);
        return broker;
      },
    },
    __brokers: brokers,
  };
});

jest.mock("net", () => {
  const actualNet: Record<string, unknown> = jest.requireActual(
    "net",
  ) as Record<string, unknown>;

  return {
    ...actualNet,
    createServer: (): Record<string, unknown> => {
      return {
        on: (): void => {
          return undefined;
        },
        listen: (): void => {
          return undefined;
        },
      };
    },
  };
});

import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import IoTDeviceCredentialService from "Common/Server/Services/IoTDeviceCredentialService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestRefusalRecorder, {
  TelemetryIngestRefusalRecord,
  noteTelemetryIngestRefusalKey,
} from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import logger from "Common/Server/Utils/Logger";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryIngestRefusalReason } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import {
  authenticateRequest,
  handleExport,
} from "../../FeatureSet/Telemetry/GrpcServer";
import { startMqttServer } from "../../FeatureSet/Telemetry/MqttServer";

type MockedFn = jest.Mock;

type SpyLike = {
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => SpyLike;
  mockRestore: () => void;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "a3c40000-0000-4000-8000-000000000001",
);
const KEY_ID: ObjectID = new ObjectID("a3c40000-0000-4000-8000-000000000002");

function buildPolicy(
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: KEY_ID,
    projectId: PROJECT_ID,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
    ingestionBudgets: null,
    ...overrides,
  };
}

function resolver(): MockedFn {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockedFn;
}

function metadataWith(token: string): grpc.Metadata {
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", token);
  return metadata;
}

function notedBillingError(makeError: () => Error): Error {
  const err: Error = makeError();
  noteTelemetryIngestRefusalKey(err, {
    projectId: PROJECT_ID,
    ingestionKeyId: KEY_ID,
  });
  return err;
}

let record: SpyLike & {
  mock: { calls: Array<[TelemetryIngestRefusalRecord]> };
};
let spies: Array<SpyLike> = [];

function counted(): Array<Record<string, unknown>> {
  return record.mock.calls.map(
    (call: [TelemetryIngestRefusalRecord]): Record<string, unknown> => {
      return {
        project: call[0].projectId.toString(),
        key: call[0].ingestionKeyId.toString(),
        reason: call[0].reason,
        surface: call[0].surface,
      };
    },
  );
}

function one(
  reason: TelemetryIngestRefusalReason,
  surface: TelemetryIngestSurface,
): Array<Record<string, unknown>> {
  return [
    {
      project: PROJECT_ID.toString(),
      key: KEY_ID.toString(),
      reason,
      surface,
    },
  ];
}

/* --------------------------------- MQTT ---------------------------------- */

type MqttDoneCallback = (error: Error | null, success: boolean | null) => void;

interface MqttClientStub {
  id: string;
  closed: boolean;
  close: () => void;
}

type MqttAuthenticateFunction = (
  client: MqttClientStub,
  username: string | undefined,
  password: Buffer | undefined,
  done: MqttDoneCallback,
) => void;

let mqttAuthenticate: MqttAuthenticateFunction;

function mqttConnect(token: string): Promise<boolean | null> {
  const client: MqttClientStub = {
    id: "sensor-7",
    closed: false,
    close: (): void => {
      return undefined;
    },
  };

  return new Promise<boolean | null>(
    (resolve: (value: boolean | null) => void): void => {
      mqttAuthenticate(
        client,
        undefined,
        Buffer.from(token, "utf8"),
        (_error: Error | null, success: boolean | null): void => {
          resolve(success);
        },
      );
    },
  );
}

beforeAll(async () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    spies.push(
      (jest.spyOn(logger, level) as unknown as SpyLike).mockImplementation(
        (): unknown => {
          return undefined;
        },
      ),
    );
  }

  await startMqttServer();

  const aedesModule: {
    __brokers: Array<{ authenticate: MqttAuthenticateFunction }>;
  } = jest.requireMock("aedes") as {
    __brokers: Array<{ authenticate: MqttAuthenticateFunction }>;
  };

  mqttAuthenticate =
    aedesModule.__brokers[aedesModule.__brokers.length - 1]!.authenticate;
});

afterAll(() => {
  for (const spy of spies) {
    spy.mockRestore();
  }
  spies = [];
});

beforeEach(() => {
  jest.clearAllMocks();
  record?.mockRestore();
  record = jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {
      return undefined;
    }) as unknown as typeof record;
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  (
    IoTDeviceCredentialService.getCredentialContext as unknown as MockedFn
  ).mockResolvedValue(null);
  (
    TelemetryIngestionKeyService.markUsed as unknown as MockedFn
  ).mockResolvedValue(undefined);
  admit.mockResolvedValue({ refusal: null, charge: null });
  resolver().mockResolvedValue(buildPolicy());
});

describe("gRPC OTLP: refusals counted against the key, on the Grpc surface", () => {
  test.each([
    [
      "switched off",
      { isEnabled: false },
      TelemetryIngestRefusalReason.KeyDisabled,
    ],
    [
      "expired",
      { expiresAt: new Date(Date.now() - 60_000) },
      TelemetryIngestRefusalReason.KeyExpired,
    ],
    [
      "a Browser key",
      {
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://shop.example.com"],
      },
      TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere,
    ],
  ])(
    "a key that is %s",
    async (
      _label: string,
      state: Partial<TelemetryIngestionKeyPolicy>,
      reason: TelemetryIngestRefusalReason,
    ) => {
      resolver().mockResolvedValue(buildPolicy(state));

      expect(
        await authenticateRequest(metadataWith(ObjectID.generate().toString())),
      ).toBeNull();
      expect(counted()).toEqual(one(reason, TelemetryIngestSurface.Grpc));
    },
  );

  test("a token that is no key counts nothing", async () => {
    resolver().mockResolvedValue(null);

    expect(
      await authenticateRequest(metadataWith(ObjectID.generate().toString())),
    ).toBeNull();
    expect(record.mock.calls).toHaveLength(0);
  });

  test("an accepted key counts nothing", async () => {
    expect(
      await authenticateRequest(metadataWith(ObjectID.generate().toString())),
    ).not.toBeNull();
    expect(record.mock.calls).toHaveLength(0);
  });

  test("an export over the key's ingestion rate is counted as that", async () => {
    const refusal: TelemetryIngestionBudgetRefusal = {
      kind: TelemetryIngestionBudgetRefusalKind.RateLimited,
      scope: TelemetryIngestionBudgetScope.IngestionKey,
      signal: ProductType.Traces,
      message: "Over the key's rate.",
      retryAfterSeconds: 3,
      resetsAt: new Date("2026-11-10T00:00:00Z"),
    };
    admit.mockResolvedValue({ refusal, charge: null });
    const queueFn: jest.Mock = jest.fn();
    const callback: jest.Mock = jest.fn();

    await handleExport(
      {
        request: { resourceSpans: [] },
        metadata: metadataWith(ObjectID.generate().toString()),
      } as never,
      callback as never,
      ProductType.Traces,
      queueFn as never,
    );

    expect(queueFn).not.toHaveBeenCalled();
    expect((callback.mock.calls[0]![0] as grpc.ServiceError).code).toBe(
      grpc.status.RESOURCE_EXHAUSTED,
    );
    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.KeyIngestionRate,
        TelemetryIngestSurface.Grpc,
      ),
    );
  });

  test.each([
    [
      "no way to pay",
      (): Error => {
        return new PaymentRequiredException("Payment required");
      },
      TelemetryIngestRefusalReason.PaymentRequired,
    ],
    [
      "a blocked project",
      (): Error => {
        return new ProjectBlockedException();
      },
      TelemetryIngestRefusalReason.ProjectBlocked,
    ],
  ])(
    "an export refused for %s is counted against the key the service noted",
    async (
      _label: string,
      makeError: () => Error,
      reason: TelemetryIngestRefusalReason,
    ) => {
      resolver().mockRejectedValue(notedBillingError(makeError));
      const callback: jest.Mock = jest.fn();

      await handleExport(
        {
          request: { resourceLogs: [] },
          metadata: metadataWith(ObjectID.generate().toString()),
        } as never,
        callback as never,
        ProductType.Logs,
        jest.fn() as never,
      );

      expect(callback).toHaveBeenCalledTimes(1);
      expect(counted()).toEqual(one(reason, TelemetryIngestSurface.Grpc));
    },
  );

  test("a billing exception without a noted key counts nothing", async () => {
    resolver().mockRejectedValue(
      new PaymentRequiredException("Payment required"),
    );

    await handleExport(
      {
        request: { resourceLogs: [] },
        metadata: metadataWith(ObjectID.generate().toString()),
      } as never,
      jest.fn() as never,
      ProductType.Logs,
      jest.fn() as never,
    );

    expect(record.mock.calls).toHaveLength(0);
  });
});

describe("MQTT CONNECT: refusals counted against the key, on the Mqtt surface", () => {
  test.each([
    [
      "switched off",
      { isEnabled: false },
      TelemetryIngestRefusalReason.KeyDisabled,
    ],
    [
      "expired",
      { expiresAt: new Date(Date.now() - 60_000) },
      TelemetryIngestRefusalReason.KeyExpired,
    ],
    [
      "a Browser key",
      {
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://shop.example.com"],
      },
      TelemetryIngestRefusalReason.BrowserKeyNotAllowedHere,
    ],
  ])(
    "a key that is %s",
    async (
      _label: string,
      state: Partial<TelemetryIngestionKeyPolicy>,
      reason: TelemetryIngestRefusalReason,
    ) => {
      resolver().mockResolvedValue(buildPolicy(state));

      expect(await mqttConnect(ObjectID.generate().toString())).toBe(false);
      expect(counted()).toEqual(one(reason, TelemetryIngestSurface.Mqtt));
    },
  );

  test("a token that is no key counts nothing", async () => {
    resolver().mockResolvedValue(null);

    expect(await mqttConnect(ObjectID.generate().toString())).toBe(false);
    expect(record.mock.calls).toHaveLength(0);
  });

  test("a CONNECT refused for billing is counted against the key the service noted", async () => {
    resolver().mockRejectedValue(
      notedBillingError((): Error => {
        return new PaymentRequiredException("Payment required");
      }),
    );

    expect(await mqttConnect(ObjectID.generate().toString())).toBe(false);
    expect(counted()).toEqual(
      one(
        TelemetryIngestRefusalReason.PaymentRequired,
        TelemetryIngestSurface.Mqtt,
      ),
    );
  });

  test("an accepted key counts nothing", async () => {
    expect(await mqttConnect(ObjectID.generate().toString())).toBe(true);
    expect(record.mock.calls).toHaveLength(0);
  });
});
