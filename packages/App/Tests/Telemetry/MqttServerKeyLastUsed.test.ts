import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { AuthenticateError, Client, PublishPacket } from "aedes";
import { startMqttServer } from "../../FeatureSet/Telemetry/MqttServer";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import IoTDeviceCredentialService from "Common/Server/Services/IoTDeviceCredentialService";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import ProjectService from "Common/Server/Services/ProjectService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import logger from "Common/Server/Utils/Logger";
import TelemetryIngestionKeyLastUsed from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyLastUsed";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "Common/Types/Exception/ProjectBlockedException";
import ObjectID from "Common/Types/ObjectID";
import SecretDigest from "Common/Server/Utils/Telemetry/SecretDigest";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { TelemetryIngestShedError } from "Common/Server/Utils/Telemetry/TelemetryIngestShedding";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { TelemetryIngestRefusalReason } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";

/*
 * A KEY USED ONLY OVER MQTT SHOWS AS USED (issue #8020).
 *
 * An ingestion key's lastUsedAt is what "Last Used At" on the key's page and
 * in the keys list, and the telemetry guides' first-data wait, read. The HTTP
 * ingest middleware and the OTLP gRPC server stamp it through one helper,
 * TelemetryIngestionKeyLastUsed.stamp (#7887). The MQTT broker checked the key
 * at CONNECT, accepted its publishes, and never stamped it, so a gateway that
 * sent only over MQTT read "Never" however much it sent.
 *
 * This suite drives the authenticate and authorizePublish hooks
 * startMqttServer itself installs on the broker, through every way a publish
 * can end:
 *
 *   - accepted from a client that connected with a project-wide ingestion
 *     key: that key is stamped, through the shared helper, once per publish
 *     the queue takes, and only after the queue has taken it; the publish is
 *     answered without waiting for the write, or for its failure;
 *   - a CONNECT refused for its key (unknown, disabled, expired, a browser
 *     key, an unpaid project): nothing is stamped, at CONNECT or after;
 *   - a CONNECT that succeeds: nothing is stamped until something is
 *     published;
 *   - a publish that is refused (a blocked or unpaid project, the queue
 *     failing to take it), dropped (a malformed payload, a topic outside the
 *     scheme, ingest switched off) or skipped (a will replay for a client
 *     still connected): nothing is stamped;
 *   - a publish from a device credential: ingested, but nothing is stamped,
 *     because a device credential is not an ingestion key.
 *
 * The key service, billing, the device credential service and the queue are
 * replaced at the module boundary; aedes is a bare object the hooks are
 * attached to, and no port is bound.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
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
      getCurrentPolicyById: jest.fn(),
      markUsed: jest.fn(),
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
    default: { getCredentialContext: jest.fn(), markConnected: jest.fn() },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return { __esModule: true, default: { addMetricIngestJob: jest.fn() } };
  },
);

jest.mock("../../FeatureSet/Telemetry/Config", () => {
  return {
    MQTT_INGEST_ENABLED: true,
    MQTT_INGEST_PORT: 1883,
    MQTT_WEBSOCKET_PATH: "/mqtt",
  };
});

// The hooks the production code installs land on this bare object.
jest.mock("aedes", () => {
  const broker: Record<string, unknown> = { on: jest.fn() };
  return {
    __esModule: true,
    Aedes: {
      createBroker: async (): Promise<Record<string, unknown>> => {
        return broker;
      },
    },
    __broker: broker,
  };
});

// startMqttServer starts a raw TCP listener: give it one that binds nothing.
jest.mock("net", () => {
  return {
    ...(jest.requireActual("net") as Record<string, unknown>),
    createServer: (): Record<string, unknown> => {
      return { on: jest.fn(), listen: jest.fn() };
    },
  };
});

type MockFn = jest.Mock;

interface TestBroker {
  authenticate: (
    client: Client,
    username: string | undefined,
    password: Buffer | undefined,
    done: (error: AuthenticateError | null, success: boolean | null) => void,
  ) => void;
  authorizePublish: (
    client: Client | null,
    packet: PublishPacket,
    callback: (error?: Error | null) => void,
  ) => void;
}

interface ConnectOutcome {
  error: AuthenticateError | null;
  success: boolean | null;
}

interface TestClient {
  id: string;
  closed: boolean;
  close: MockFn;
}

const PROJECT_ID: ObjectID = ObjectID.generate();
const FLEET: string = "building-a";
const DEVICE: string = "sensor-001";
const TELEMETRY_TOPIC: string = `oneuptime/${FLEET}/${DEVICE}/telemetry`;
const TELEMETRY_PAYLOAD: string = JSON.stringify({
  metrics: { temperature: 21.5 },
});

let broker: TestBroker;
let stamp: jest.SpiedFunction<typeof TelemetryIngestionKeyLastUsed.stamp>;

const resolverMock: () => MockFn = (): MockFn => {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockFn;
};

const markUsedMock: () => MockFn = (): MockFn => {
  return TelemetryIngestionKeyService.markUsed as unknown as MockFn;
};

const currentPolicyMock: () => MockFn = (): MockFn => {
  return TelemetryIngestionKeyService.getCurrentPolicyById as unknown as MockFn;
};

/*
 * The key as it is now, as the broker asks it at CONNECT and on every
 * publish (issue #8147): the key the lookup by secret resolved, unchanged.
 * Nothing in this suite changes a key after it connects;
 * MqttServerKeyStopped.test.ts does.
 */
const keyAsResolved: (data: {
  ingestionKeyId: ObjectID;
}) => Promise<TelemetryIngestionKeyPolicy | null> = async (data: {
  ingestionKeyId: ObjectID;
}): Promise<TelemetryIngestionKeyPolicy | null> => {
  const results: Array<jest.MockResult<unknown>> = resolverMock().mock.results;

  for (let index: number = results.length - 1; index >= 0; index--) {
    const result: jest.MockResult<unknown> = results[index]!;

    if (result.type !== "return") {
      continue;
    }

    const policy: TelemetryIngestionKeyPolicy | null = await Promise.resolve(
      result.value as Promise<TelemetryIngestionKeyPolicy | null>,
    ).catch((): null => {
      return null;
    });

    if (
      policy &&
      policy.ingestionKeyId.toString() === data.ingestionKeyId.toString()
    ) {
      return policy;
    }
  }

  return null;
};

const queueMock: () => MockFn = (): MockFn => {
  return MetricsQueueService.addMetricIngestJob as unknown as MockFn;
};

const credentialMock: () => MockFn = (): MockFn => {
  return IoTDeviceCredentialService.getCredentialContext as unknown as MockFn;
};

const billingMock: () => MockFn = (): MockFn => {
  return PayAsYouGoBillingService.requirePayAsYouGo as unknown as MockFn;
};

type BuildPolicyFunction = (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => TelemetryIngestionKeyPolicy;

// A healthy Server key with an id of its own.
const buildPolicy: BuildPolicyFunction = (
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): TelemetryIngestionKeyPolicy => {
  return {
    ingestionKeyId: ObjectID.generate(),
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
};

const newClient: (id?: string) => TestClient = (
  id: string = "gateway-1",
): TestClient => {
  return { id, closed: false, close: jest.fn() };
};

// One CONNECT through the hook: the ingestion key rides the password.
const connect: (
  client: TestClient,
  password: string,
  username?: string,
) => Promise<ConnectOutcome> = (
  client: TestClient,
  password: string,
  username?: string,
): Promise<ConnectOutcome> => {
  return new Promise<ConnectOutcome>(
    (resolve: (outcome: ConnectOutcome) => void): void => {
      broker.authenticate(
        client as unknown as Client,
        username,
        Buffer.from(password, "utf8"),
        (error: AuthenticateError | null, success: boolean | null): void => {
          resolve({ error, success });
        },
      );
    },
  );
};

// Connect with a fresh key whose policy is `policy`.
const connectWithKey: (
  client: TestClient,
  policy: TelemetryIngestionKeyPolicy,
) => Promise<ConnectOutcome> = (
  client: TestClient,
  policy: TelemetryIngestionKeyPolicy,
): Promise<ConnectOutcome> => {
  resolverMock().mockResolvedValueOnce(policy);
  return connect(client, ObjectID.generate().toString());
};

interface PublishShape {
  topic?: string;
  payload?: string;
  // A Last Will carries the clientId it was stamped with at CONNECT.
  willOf?: string;
}

// One publish through the hook; resolves with what aedes was answered.
const publish: (
  client: TestClient | null,
  shape?: PublishShape,
) => Promise<Error | null | undefined> = (
  client: TestClient | null,
  shape: PublishShape = {},
): Promise<Error | null | undefined> => {
  const packet: PublishPacket & { clientId?: string } = {
    cmd: "publish",
    qos: 1,
    dup: false,
    retain: false,
    messageId: 1,
    topic: shape.topic ?? TELEMETRY_TOPIC,
    payload: Buffer.from(shape.payload ?? TELEMETRY_PAYLOAD, "utf8"),
  } as PublishPacket & { clientId?: string };

  if (shape.willOf) {
    packet.clientId = shape.willOf;
  }

  return new Promise<Error | null | undefined>(
    (resolve: (error: Error | null | undefined) => void): void => {
      broker.authorizePublish(
        client as unknown as Client | null,
        packet,
        resolve,
      );
    },
  );
};

// Lets fire-and-forget work (a rejected stamp and its .catch) run out.
const settle: () => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
};

const stampedKeyIds: () => Array<string> = (): Array<string> => {
  return stamp.mock.calls.map((call: [TelemetryIngestionKeyPolicy]): string => {
    return call[0].ingestionKeyId.toString();
  });
};

const expectNothingStamped: () => void = (): void => {
  expect(stamp).not.toHaveBeenCalled();
  expect(markUsedMock()).not.toHaveBeenCalled();
};

beforeAll(async () => {
  await startMqttServer();
  broker = (jest.requireMock("aedes") as { __broker: TestBroker }).__broker;
  expect(typeof broker.authenticate).toBe("function");
  expect(typeof broker.authorizePublish).toBe("function");

  // Calls through: the key service's (mocked) markUsed is still reached.
  stamp = jest.spyOn(TelemetryIngestionKeyLastUsed, "stamp");
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  // A CONNECT refused for its key is counted; that count has its own suites.
  jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {});
  resolverMock().mockReset().mockResolvedValue(null);
  currentPolicyMock().mockReset().mockImplementation(keyAsResolved);
  markUsedMock().mockReset().mockResolvedValue(undefined);
  queueMock().mockReset().mockResolvedValue(undefined);
  credentialMock().mockReset().mockResolvedValue(null);
  billingMock().mockReset().mockResolvedValue(undefined);
  (IoTDeviceCredentialService.markConnected as unknown as MockFn)
    .mockReset()
    .mockResolvedValue(undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("a publish the queue takes, from a client that connected with an ingestion key", () => {
  test("stamps that key once, through the shared helper, with the policy CONNECT resolved", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();
    const client: TestClient = newClient();

    expect((await connectWithKey(client, policy)).success).toBe(true);
    await expect(publish(client)).resolves.toBeNull();

    expect(queueMock()).toHaveBeenCalledTimes(1);
    expect(queueMock()).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID }),
    );
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(stamp).toHaveBeenCalledWith(policy);
    expect(markUsedMock()).toHaveBeenCalledTimes(1);
    expect(markUsedMock()).toHaveBeenCalledWith(policy.ingestionKeyId);
  });

  test("stamps only after the queue has taken the publish", async () => {
    const client: TestClient = newClient();
    expect((await connectWithKey(client, buildPolicy())).success).toBe(true);

    let queueSettled: boolean = false;
    let stampedBeforeQueueSettled: boolean | null = null;
    queueMock().mockImplementation(async (): Promise<void> => {
      await settle();
      queueSettled = true;
    });
    stamp.mockImplementationOnce((): void => {
      stampedBeforeQueueSettled = !queueSettled;
    });

    await expect(publish(client)).resolves.toBeNull();

    expect(stamp).toHaveBeenCalledTimes(1);
    expect(stampedBeforeQueueSettled).toBe(false);
    expect(queueMock().mock.invocationCallOrder[0]!).toBeLessThan(
      stamp.mock.invocationCallOrder[0]!,
    );
  });

  test("is answered without waiting for the write", async () => {
    const client: TestClient = newClient();
    expect((await connectWithKey(client, buildPolicy())).success).toBe(true);

    // A write that never finishes must not hold the publish.
    markUsedMock().mockReturnValue(new Promise<void>(() => {}));

    await expect(publish(client)).resolves.toBeNull();
    expect(markUsedMock()).toHaveBeenCalledTimes(1);
  });

  test("is still accepted when the write fails, and the failure is only logged", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();
    const client: TestClient = newClient();
    expect((await connectWithKey(client, policy)).success).toBe(true);

    markUsedMock().mockRejectedValue(new Error("Postgres is down"));

    await expect(publish(client)).resolves.toBeNull();
    await settle();

    expect(queueMock()).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(policy.ingestionKeyId.toString()),
    );
    expect(client.close).not.toHaveBeenCalled();
  });

  test("asks for a stamp on every publish: the key service throttles the write", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();
    const client: TestClient = newClient();
    expect((await connectWithKey(client, policy)).success).toBe(true);

    for (let i: number = 0; i < 3; i++) {
      await expect(publish(client)).resolves.toBeNull();
    }

    expect(queueMock()).toHaveBeenCalledTimes(3);
    expect(stampedKeyIds()).toEqual([
      policy.ingestionKeyId.toString(),
      policy.ingestionKeyId.toString(),
      policy.ingestionKeyId.toString(),
    ]);
  });

  test("stamps the key each client connected with, and no other", async () => {
    const first: TelemetryIngestionKeyPolicy = buildPolicy();
    const second: TelemetryIngestionKeyPolicy = buildPolicy();
    const firstClient: TestClient = newClient("gateway-1");
    const secondClient: TestClient = newClient("gateway-2");

    expect((await connectWithKey(firstClient, first)).success).toBe(true);
    expect((await connectWithKey(secondClient, second)).success).toBe(true);

    await expect(publish(secondClient)).resolves.toBeNull();
    await expect(publish(firstClient)).resolves.toBeNull();
    await expect(publish(secondClient)).resolves.toBeNull();

    expect(stampedKeyIds()).toEqual([
      second.ingestionKeyId.toString(),
      first.ingestionKeyId.toString(),
      second.ingestionKeyId.toString(),
    ]);
  });

  test("stamps a key presented in the username, for clients that only have that field", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();
    const client: TestClient = newClient();
    const secret: string = ObjectID.generate().toString();
    resolverMock().mockResolvedValueOnce(policy);

    const outcome: ConnectOutcome = await new Promise<ConnectOutcome>(
      (resolve: (outcome: ConnectOutcome) => void): void => {
        broker.authenticate(
          client as unknown as Client,
          secret,
          undefined,
          (error: AuthenticateError | null, success: boolean | null): void => {
            resolve({ error, success });
          },
        );
      },
    );

    expect(outcome.success).toBe(true);
    expect(resolverMock()).toHaveBeenCalledWith(secret);

    await expect(publish(client)).resolves.toBeNull();
    expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
  });

  test.each([
    {
      label: "a telemetry object",
      topic: TELEMETRY_TOPIC,
      payload: TELEMETRY_PAYLOAD,
    },
    {
      label: "a single metric on its own topic",
      topic: `oneuptime/${FLEET}/${DEVICE}/metrics/humidity`,
      payload: "48.2",
    },
    {
      label: "a status",
      topic: `oneuptime/${FLEET}/${DEVICE}/status`,
      payload: "online",
    },
  ])(
    "stamps for $label",
    async (shape: { label: string; topic: string; payload: string }) => {
      const policy: TelemetryIngestionKeyPolicy = buildPolicy();
      const client: TestClient = newClient();
      expect((await connectWithKey(client, policy)).success).toBe(true);

      await expect(
        publish(client, { topic: shape.topic, payload: shape.payload }),
      ).resolves.toBeNull();

      expect(queueMock()).toHaveBeenCalledTimes(1);
      expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
    },
  );

  test("stamps for the Last Will of a client that died: it is telemetry sent with the key", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();
    const client: TestClient = newClient();
    expect((await connectWithKey(client, policy)).success).toBe(true);

    client.closed = true;

    await expect(
      publish(client, {
        topic: `oneuptime/${FLEET}/${DEVICE}/status`,
        payload: "offline",
        willOf: client.id,
      }),
    ).resolves.toBeNull();

    expect(queueMock()).toHaveBeenCalledTimes(1);
    expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
  });
});

describe("a CONNECT is not a use", () => {
  test("a key that connects and publishes nothing is not stamped", async () => {
    expect((await connectWithKey(newClient(), buildPolicy())).success).toBe(
      true,
    );

    await settle();
    expectNothingStamped();
  });

  interface RefusedConnect {
    label: string;
    arrange: () => void;
  }

  const refusedConnects: Array<RefusedConnect> = [
    {
      label: "a token no key has",
      arrange: (): void => {
        resolverMock().mockResolvedValue(null);
      },
    },
    {
      label: "a disabled key",
      arrange: (): void => {
        resolverMock().mockResolvedValue(buildPolicy({ isEnabled: false }));
      },
    },
    {
      label: "an expired key",
      arrange: (): void => {
        resolverMock().mockResolvedValue(
          buildPolicy({ expiresAt: new Date(Date.now() - 60 * 1000) }),
        );
      },
    },
    {
      label: "a browser key, which MQTT refuses",
      arrange: (): void => {
        resolverMock().mockResolvedValue(
          buildPolicy({
            keyType: TelemetryIngestionKeyType.Browser,
            allowedOrigins: ["https://shop.example.com"],
          }),
        );
      },
    },
    {
      label: "a key of a project that has not set up payment",
      arrange: (): void => {
        resolverMock().mockRejectedValue(
          new PaymentRequiredException("Add a payment method."),
        );
      },
    },
    {
      label: "a key of a blocked project",
      arrange: (): void => {
        resolverMock().mockRejectedValue(new ProjectBlockedException());
      },
    },
    {
      label: "a key lookup that fails",
      arrange: (): void => {
        resolverMock().mockRejectedValue(new Error("Postgres is down"));
      },
    },
  ];

  test.each(refusedConnects)(
    "$label is refused at CONNECT, and stamped neither then nor on a publish after",
    async (refused: RefusedConnect) => {
      refused.arrange();
      const client: TestClient = newClient();

      const outcome: ConnectOutcome = await connect(
        client,
        ObjectID.generate().toString(),
      );
      expect(outcome.success).toBe(false);
      expect(outcome.error).not.toBeNull();

      // aedes would not let it publish; if it did, it is not authenticated.
      const error: Error | null | undefined = await publish(client);
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain("not authenticated");

      await settle();
      expect(queueMock()).not.toHaveBeenCalled();
      expectNothingStamped();
    },
  );
});

describe("a publish that is refused, dropped or skipped is not a use", () => {
  interface UnstampedPublish {
    label: string;
    arrange: (client: TestClient) => void;
    shape?: PublishShape;
    // Whether aedes is answered with an error, or the publish accepted.
    refused: boolean;
    // Whether the publish got as far as the queue (which failed to take it).
    reachesQueue: boolean;
  }

  const unstampedPublishes: Array<UnstampedPublish> = [
    {
      label: "a project a master admin blocked after CONNECT",
      arrange: (): void => {
        jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(true);
      },
      refused: true,
      reachesQueue: false,
    },
    {
      label: "a project whose payment setup lapsed after CONNECT",
      arrange: (): void => {
        billingMock().mockRejectedValue(
          new PaymentRequiredException("Add a payment method."),
        );
      },
      refused: true,
      reachesQueue: false,
    },
    {
      label: "a publish the queue rejects",
      arrange: (): void => {
        queueMock().mockRejectedValue(new Error("Redis is down"));
      },
      refused: true,
      reachesQueue: true,
    },
    {
      label: "a publish the queue throws on",
      arrange: (): void => {
        queueMock().mockImplementation(() => {
          throw new Error("Redis is down");
        });
      },
      refused: true,
      reachesQueue: true,
    },
    {
      label: "a payload that is not telemetry",
      arrange: (): void => {},
      shape: { payload: "not json" },
      refused: false,
      reachesQueue: false,
    },
    {
      label: "a payload with no numeric metric",
      arrange: (): void => {},
      shape: { payload: JSON.stringify({ metrics: { door: "open" } }) },
      refused: false,
      reachesQueue: false,
    },
    {
      label: "a topic outside oneuptime/<fleet>/<device>/...",
      arrange: (): void => {},
      shape: { topic: "factory/line-1/temperature" },
      refused: false,
      reachesQueue: false,
    },
    {
      label: "a publish while ingest is switched off for this server",
      arrange: (): void => {
        jest
          .spyOn(TelemetryIngestionDisabled, "isDisabled")
          .mockReturnValue(true);
      },
      refused: false,
      reachesQueue: false,
    },
    {
      label: "a will replay for a client that is still connected",
      arrange: (): void => {},
      shape: {
        topic: `oneuptime/${FLEET}/${DEVICE}/status`,
        payload: "offline",
        willOf: "gateway-1",
      },
      refused: false,
      reachesQueue: false,
    },
  ];

  test.each(unstampedPublishes)(
    "nothing is stamped for $label",
    async (unstamped: UnstampedPublish) => {
      const client: TestClient = newClient();
      expect((await connectWithKey(client, buildPolicy())).success).toBe(true);

      unstamped.arrange(client);

      const error: Error | null | undefined = await publish(
        client,
        unstamped.shape,
      );

      if (unstamped.refused) {
        expect(error).toBeInstanceOf(Error);
      } else {
        expect(error).toBeNull();
      }
      expect(queueMock()).toHaveBeenCalledTimes(unstamped.reachesQueue ? 1 : 0);

      await settle();
      expectNothingStamped();
    },
  );

  test("a broker-internal publish, with no client, stamps nothing", async () => {
    await expect(publish(null)).resolves.toBeNull();

    expect(queueMock()).not.toHaveBeenCalled();
    expectNothingStamped();
  });

  test("a refused publish does not stop the next accepted one from stamping", async () => {
    const policy: TelemetryIngestionKeyPolicy = buildPolicy();
    const client: TestClient = newClient();
    expect((await connectWithKey(client, policy)).success).toBe(true);

    queueMock().mockRejectedValueOnce(new Error("Redis is down"));
    expect(await publish(client)).toBeInstanceOf(Error);
    expect(stamp).not.toHaveBeenCalled();

    // The device retries; the retry is taken, and stamps.
    await expect(publish(client)).resolves.toBeNull();
    expect(stampedKeyIds()).toEqual([policy.ingestionKeyId.toString()]);
  });
});

describe("a device credential is not an ingestion key", () => {
  const credentialId: string = ObjectID.generate().toString();
  const secretKey: string = ObjectID.generate().toString();

  const arrangeCredential: () => void = (): void => {
    credentialMock().mockResolvedValue({
      credentialId,
      secretKeyDigest: SecretDigest.of(secretKey),
      projectId: PROJECT_ID.toString(),
      iotFleetId: ObjectID.generate().toString(),
      fleetName: FLEET,
      externalId: DEVICE,
    });
  };

  test("its accepted publish is ingested, and no key is stamped", async () => {
    arrangeCredential();
    const client: TestClient = newClient();

    expect((await connect(client, secretKey, credentialId)).success).toBe(true);
    // It never reaches the ingestion key lookup.
    expect(resolverMock()).not.toHaveBeenCalled();

    await expect(publish(client)).resolves.toBeNull();
    expect(queueMock()).toHaveBeenCalledTimes(1);

    await settle();
    expectNothingStamped();
  });

  test("its publish off its own device's topics is dropped, and no key is stamped", async () => {
    arrangeCredential();
    const client: TestClient = newClient();

    expect((await connect(client, secretKey, credentialId)).success).toBe(true);

    await expect(
      publish(client, { topic: `oneuptime/${FLEET}/another-device/telemetry` }),
    ).resolves.toBeNull();

    expect(queueMock()).not.toHaveBeenCalled();
    expectNothingStamped();
  });

  test("a revoked credential's publish closes the client, and no key is stamped", async () => {
    arrangeCredential();
    const client: TestClient = newClient();

    expect((await connect(client, secretKey, credentialId)).success).toBe(true);

    credentialMock().mockResolvedValue(null);

    await expect(publish(client)).resolves.toBeNull();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(queueMock()).not.toHaveBeenCalled();
    expectNothingStamped();
  });
});

/*
 * A publish the queue refuses while OneUptime catches up
 * (TelemetryIngestShedding, #11440): refused as any enqueue failure is -
 * MQTT 3.1.1 has no NACK, so the client is closed and retransmits - and
 * counted against the key the client connected with, under the metrics'
 * own surface, so the project's pages say it was refused while OneUptime
 * caught up.
 */
describe("a publish the queue refuses while OneUptime catches up", () => {
  const shedError: (
    kind: TelemetryIngestionBudgetRefusalKind,
  ) => TelemetryIngestShedError = (
    kind: TelemetryIngestionBudgetRefusalKind,
  ): TelemetryIngestShedError => {
    return new TelemetryIngestShedError({
      kind: kind,
      scope: TelemetryIngestionBudgetScope.Project,
      signal: ProductType.Metrics,
      message:
        "OneUptime has not yet stored the metrics this project already sent. Retry in 30 seconds.",
      retryAfterSeconds: 30,
      resetsAt: new Date("2026-11-28T12:00:30Z"),
    });
  };

  test.each([
    [
      TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
      TelemetryIngestRefusalReason.QueueBacklogged,
    ],
    [
      TelemetryIngestionBudgetRefusalKind.QueueFull,
      TelemetryIngestRefusalReason.QueueFull,
    ],
  ])(
    "%s: refused, counted against the key under the metrics' surface, and not a use",
    async (
      kind: TelemetryIngestionBudgetRefusalKind,
      reason: TelemetryIngestRefusalReason,
    ) => {
      const policy: TelemetryIngestionKeyPolicy = buildPolicy();
      const client: TestClient = newClient();

      expect((await connectWithKey(client, policy)).success).toBe(true);

      const refused: TelemetryIngestShedError = shedError(kind);
      queueMock().mockRejectedValue(refused);

      await expect(publish(client)).resolves.toBe(refused);

      expect(TelemetryIngestRefusalRecorder.record).toHaveBeenCalledTimes(1);
      expect(TelemetryIngestRefusalRecorder.record).toHaveBeenCalledWith({
        projectId: policy.projectId,
        ingestionKeyId: policy.ingestionKeyId,
        reason: reason,
        surface: TelemetryIngestSurface.OtelMetrics,
      });

      await settle();
      expectNothingStamped();
    },
  );

  test("any other failure of the queue is not counted as a refusal", async () => {
    const client: TestClient = newClient();

    expect((await connectWithKey(client, buildPolicy())).success).toBe(true);
    queueMock().mockRejectedValue(new Error("Redis is down"));

    await expect(publish(client)).resolves.toBeInstanceOf(Error);
    expect(TelemetryIngestRefusalRecorder.record).not.toHaveBeenCalled();
  });

  test("a device credential names no key, and is counted nowhere", async () => {
    const credentialId: string = ObjectID.generate().toString();
    const secretKey: string = ObjectID.generate().toString();

    credentialMock().mockResolvedValue({
      credentialId,
      secretKeyDigest: SecretDigest.of(secretKey),
      projectId: PROJECT_ID.toString(),
      iotFleetId: ObjectID.generate().toString(),
      fleetName: FLEET,
      externalId: DEVICE,
    });

    const client: TestClient = newClient();

    expect((await connect(client, secretKey, credentialId)).success).toBe(true);

    const refused: TelemetryIngestShedError = shedError(
      TelemetryIngestionBudgetRefusalKind.QueueBacklogged,
    );
    queueMock().mockRejectedValue(refused);

    await expect(publish(client)).resolves.toBe(refused);
    expect(TelemetryIngestRefusalRecorder.record).not.toHaveBeenCalled();
  });
});
