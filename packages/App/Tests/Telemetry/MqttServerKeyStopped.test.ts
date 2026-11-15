import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
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
import TelemetryIngestionKeySecretDigest from "Common/Server/Utils/Telemetry/TelemetryIngestionKeySecretDigest";
import TelemetryIngestRefusalRecorder, {
  TelemetryIngestRefusalRecord,
} from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import ObjectID from "Common/Types/ObjectID";
import { TelemetryIngestRefusalReason } from "Common/Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";

/*
 * A STOPPED INGESTION KEY STOPS AN MQTT SESSION THAT CONNECTED WITH IT
 * (issue #8147).
 *
 * The broker checked a project-wide ingestion key once, at CONNECT, and
 * trusted the session for as long as it stayed open. MQTT sessions are kept
 * open by keep-alive pings for days or weeks, so a key that was switched
 * off, went past its Expires At, was deleted or was given a new secret kept
 * publishing over a session that connected before - while the docs promise
 * that turning a leaked key off stops it.
 *
 * Now every publish asks the key service for the key as it is now
 * (getCurrentPolicyById: by the key's id and a digest of the secret the
 * session presented, served from a cache a few seconds long - the service's
 * own suite, TelemetryIngestionKeyCurrentState.test.ts, holds it to that)
 * and closes the client once the key may no longer send. CONNECT asks it
 * too, so a client that reconnects is refused with rc=4 at once rather than
 * after the lookup by secret's minute.
 *
 * Here the key service is a fake that behaves as the real one's contract
 * says: a table of keys, looked up by secret at CONNECT and by id and
 * secret digest afterwards. Each way a key stops is driven through an open
 * session, a session that reconnects, and a valid key that must keep
 * working. aedes is a bare object the production hooks land on; no port is
 * bound.
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

// MQTT 3.1.1 CONNACK return codes.
const CONNACK_SERVER_UNAVAILABLE: number = 3;
const CONNACK_BAD_USERNAME_OR_PASSWORD: number = 4;

const PROJECT_ID: ObjectID = ObjectID.generate();
const FLEET: string = "building-a";
const DEVICE: string = "sensor-001";
const TELEMETRY_TOPIC: string = `oneuptime/${FLEET}/${DEVICE}/telemetry`;
const STATUS_TOPIC: string = `oneuptime/${FLEET}/${DEVICE}/status`;
const TELEMETRY_PAYLOAD: string = JSON.stringify({
  metrics: { temperature: 21.5 },
});

/*
 * ---------------------------------------------------------------------------
 * The fake key service: a table of keys, as Postgres would hold them.
 * ---------------------------------------------------------------------------
 */

interface StoredKey {
  policy: TelemetryIngestionKeyPolicy;
  secret: string;
}

// The keys, by id. A deleted key is gone from here.
let storedKeys: Map<string, StoredKey> = new Map();

/*
 * What a server that did not make a change still answers for a secret: the
 * lookup by secret is kept for a minute (POSITIVE_TTL_MS) on every server
 * but the one that made the change. While set, the lookup answers what it
 * answered before.
 */
let secretLookupsAreStale: boolean = false;
let rememberedSecretLookups: Map<string, TelemetryIngestionKeyPolicy | null> =
  new Map();

const copyPolicy: (
  policy: TelemetryIngestionKeyPolicy,
) => TelemetryIngestionKeyPolicy = (
  policy: TelemetryIngestionKeyPolicy,
): TelemetryIngestionKeyPolicy => {
  return {
    ...policy,
    allowedOrigins: [...policy.allowedOrigins],
  };
};

const lookUpBySecret: (
  secret: string,
) => Promise<TelemetryIngestionKeyPolicy | null> = async (
  secret: string,
): Promise<TelemetryIngestionKeyPolicy | null> => {
  const normalized: string = secret.trim().toLowerCase();

  if (secretLookupsAreStale && rememberedSecretLookups.has(normalized)) {
    return rememberedSecretLookups.get(normalized) || null;
  }

  for (const stored of storedKeys.values()) {
    if (stored.secret.toLowerCase() === normalized) {
      const policy: TelemetryIngestionKeyPolicy = copyPolicy(stored.policy);
      rememberedSecretLookups.set(normalized, policy);
      return copyPolicy(policy);
    }
  }

  rememberedSecretLookups.set(normalized, null);
  return null;
};

// As the real getCurrentPolicyById: by id, and only for the current secret.
const lookUpCurrent: (data: {
  ingestionKeyId: ObjectID;
  secretKeyDigest: string;
}) => Promise<TelemetryIngestionKeyPolicy | null> = async (data: {
  ingestionKeyId: ObjectID;
  secretKeyDigest: string;
}): Promise<TelemetryIngestionKeyPolicy | null> => {
  const stored: StoredKey | undefined = storedKeys.get(
    data.ingestionKeyId.toString(),
  );

  if (
    !stored ||
    !TelemetryIngestionKeySecretDigest.matches(
      TelemetryIngestionKeySecretDigest.of(stored.secret),
      data.secretKeyDigest,
    )
  ) {
    return null;
  }

  return copyPolicy(stored.policy);
};

interface KeyFixture {
  id: ObjectID;
  secret: string;
}

const createKey: (
  overrides?: Partial<TelemetryIngestionKeyPolicy>,
) => KeyFixture = (
  overrides: Partial<TelemetryIngestionKeyPolicy> = {},
): KeyFixture => {
  const id: ObjectID = ObjectID.generate();
  const secret: string = ObjectID.generate().toString();

  storedKeys.set(id.toString(), {
    secret,
    policy: {
      ingestionKeyId: id,
      projectId: PROJECT_ID,
      keyType: TelemetryIngestionKeyType.Server,
      allowedOrigins: [],
      pinnedServiceName: null,
      isEnabled: true,
      expiresAt: null,
      requestsPerMinuteLimit: null,
      ingestionBudgets: null,
      ...overrides,
    },
  });

  return { id, secret };
};

const storedKey: (key: KeyFixture) => StoredKey = (
  key: KeyFixture,
): StoredKey => {
  const stored: StoredKey | undefined = storedKeys.get(key.id.toString());
  expect(stored).toBeDefined();
  return stored!;
};

/*
 * Each way a key stops, as the dashboard does it: Enabled off, Expires At
 * passed, Delete Ingestion Key, Reset Secret Key.
 */
interface KeyStop {
  label: string;
  stop: (key: KeyFixture) => void;
  // What the refusal is counted as against the key, or null: not counted.
  countedAs: TelemetryIngestRefusalReason | null;
  // What the log line says, after the key id.
  logged: string;
}

const KEY_STOPS: Array<KeyStop> = [
  {
    label: "switched off",
    stop: (key: KeyFixture): void => {
      storedKey(key).policy.isEnabled = false;
    },
    countedAs: TelemetryIngestRefusalReason.KeyDisabled,
    logged: "refused — disabled",
  },
  {
    label: "past its expiry",
    stop: (key: KeyFixture): void => {
      storedKey(key).policy.expiresAt = new Date(Date.now() - 1000);
    },
    countedAs: TelemetryIngestRefusalReason.KeyExpired,
    logged: "refused — expired",
  },
  {
    label: "deleted",
    stop: (key: KeyFixture): void => {
      storedKeys.delete(key.id.toString());
    },
    // The secret the client holds opens no key: nothing to count it against.
    countedAs: null,
    logged: "refused — it was deleted, or its secret was reset",
  },
  {
    label: "given a new secret",
    stop: (key: KeyFixture): void => {
      storedKey(key).secret = ObjectID.generate().toString();
    },
    // As a token no key has at CONNECT: not counted.
    countedAs: null,
    logged: "refused — it was deleted, or its secret was reset",
  },
];

/*
 * ---------------------------------------------------------------------------
 * Driving the broker.
 * ---------------------------------------------------------------------------
 */

let broker: TestBroker;
let stamp: jest.SpiedFunction<typeof TelemetryIngestionKeyLastUsed.stamp>;
let record: jest.SpiedFunction<typeof TelemetryIngestRefusalRecorder.record>;

const resolverMock: () => MockFn = (): MockFn => {
  return TelemetryIngestionKeyService.getPolicyFromSecretKey as unknown as MockFn;
};

const currentPolicyMock: () => MockFn = (): MockFn => {
  return TelemetryIngestionKeyService.getCurrentPolicyById as unknown as MockFn;
};

const queueMock: () => MockFn = (): MockFn => {
  return MetricsQueueService.addMetricIngestJob as unknown as MockFn;
};

const newClient: (id?: string) => TestClient = (
  id: string = "gateway-1",
): TestClient => {
  const client: TestClient = {
    id,
    closed: false,
    close: jest.fn(),
  };

  // As aedes: closing a client marks it closed.
  client.close.mockImplementation((): void => {
    client.closed = true;
  });

  return client;
};

interface ConnectShape {
  // Where the key rides: the password (the default) or the username.
  inUsername?: boolean;
}

const connect: (
  client: TestClient,
  secret: string,
  shape?: ConnectShape,
) => Promise<ConnectOutcome> = (
  client: TestClient,
  secret: string,
  shape: ConnectShape = {},
): Promise<ConnectOutcome> => {
  return new Promise<ConnectOutcome>(
    (resolve: (outcome: ConnectOutcome) => void): void => {
      broker.authenticate(
        client as unknown as Client,
        shape.inUsername ? secret : undefined,
        shape.inUsername ? undefined : Buffer.from(secret, "utf8"),
        (error: AuthenticateError | null, success: boolean | null): void => {
          resolve({ error, success });
        },
      );
    },
  );
};

interface PublishShape {
  topic?: string;
  payload?: string;
  // A Last Will carries the clientId it was stamped with at CONNECT.
  willOf?: string;
}

const publish: (
  client: TestClient,
  shape?: PublishShape,
) => Promise<Error | null | undefined> = (
  client: TestClient,
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
      broker.authorizePublish(client as unknown as Client, packet, resolve);
    },
  );
};

// A session that connected with `key` and had one publish taken.
const openSession: (
  key: KeyFixture,
  id?: string,
) => Promise<TestClient> = async (
  key: KeyFixture,
  id?: string,
): Promise<TestClient> => {
  const client: TestClient = newClient(id);

  expect(await connect(client, key.secret)).toEqual({
    error: null,
    success: true,
  });
  await expect(publish(client)).resolves.toBeNull();

  return client;
};

// Lets fire-and-forget work run out.
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

const counted: () => Array<Record<string, string>> = (): Array<
  Record<string, string>
> => {
  return record.mock.calls.map(
    (call: [TelemetryIngestRefusalRecord]): Record<string, string> => {
      return {
        project: call[0].projectId.toString(),
        key: call[0].ingestionKeyId.toString(),
        reason: call[0].reason,
        surface: String(call[0].surface),
      };
    },
  );
};

const expectCountedAs: (
  key: KeyFixture,
  reason: TelemetryIngestRefusalReason | null,
) => void = (
  key: KeyFixture,
  reason: TelemetryIngestRefusalReason | null,
): void => {
  expect(counted()).toEqual(
    reason
      ? [
          {
            project: PROJECT_ID.toString(),
            key: key.id.toString(),
            reason,
            surface: TelemetryIngestSurface.Mqtt,
          },
        ]
      : [],
  );
};

// Every line logged at any level, as one string.
const logTranscript: () => string = (): string => {
  return (["error", "warn", "info", "debug"] as const)
    .map((level: "error" | "warn" | "info" | "debug"): string => {
      return JSON.stringify((logger[level] as unknown as MockFn).mock.calls);
    })
    .join("\n");
};

beforeAll(async () => {
  await startMqttServer();
  broker = (jest.requireMock("aedes") as { __broker: TestBroker }).__broker;
  expect(typeof broker.authenticate).toBe("function");
  expect(typeof broker.authorizePublish).toBe("function");
});

beforeEach(() => {
  jest.clearAllMocks();

  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined;
    });
  }

  storedKeys = new Map();
  secretLookupsAreStale = false;
  rememberedSecretLookups = new Map();

  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  record = jest
    .spyOn(TelemetryIngestRefusalRecorder, "record")
    .mockImplementation(() => {});
  stamp = jest.spyOn(TelemetryIngestionKeyLastUsed, "stamp");

  resolverMock().mockReset().mockImplementation(lookUpBySecret);
  currentPolicyMock().mockReset().mockImplementation(lookUpCurrent);
  (TelemetryIngestionKeyService.markUsed as unknown as MockFn)
    .mockReset()
    .mockResolvedValue(undefined);
  queueMock().mockReset().mockResolvedValue(undefined);
  (PayAsYouGoBillingService.requirePayAsYouGo as unknown as MockFn)
    .mockReset()
    .mockResolvedValue(undefined);
  (IoTDeviceCredentialService.getCredentialContext as unknown as MockFn)
    .mockReset()
    .mockResolvedValue(null);
  (IoTDeviceCredentialService.markConnected as unknown as MockFn)
    .mockReset()
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe.each(KEY_STOPS)("a key $label", (keyStop: KeyStop) => {
  describe("with a session open on it", () => {
    test("closes the session on its next publish, and ingests and stamps nothing", async () => {
      const key: KeyFixture = createKey();
      const client: TestClient = await openSession(key);

      // The publish before the stop was taken, and stamped.
      expect(queueMock()).toHaveBeenCalledTimes(1);
      expect(stampedKeyIds()).toEqual([key.id.toString()]);
      queueMock().mockClear();
      stamp.mockClear();
      (TelemetryIngestionKeyService.markUsed as unknown as MockFn).mockClear();

      keyStop.stop(key);

      /*
       * Accepted and dropped, as a revoked device credential is: an error
       * would only make the client retransmit the message into a broker
       * that closes it anyway.
       */
      await expect(publish(client)).resolves.toBeNull();

      expect(client.close).toHaveBeenCalledTimes(1);
      expect(queueMock()).not.toHaveBeenCalled();
      await settle();
      expect(stamp).not.toHaveBeenCalled();
      expect(TelemetryIngestionKeyService.markUsed).not.toHaveBeenCalled();
    });

    test("is counted against the key only when the key still exists, and logs the key id and why, never the secret", async () => {
      const key: KeyFixture = createKey();
      const client: TestClient = await openSession(key);

      keyStop.stop(key);
      await expect(publish(client)).resolves.toBeNull();

      expectCountedAs(key, keyStop.countedAs);
      expect(logger.warn).toHaveBeenCalledWith(
        `MQTT: ingestion key ${key.id.toString()} ${keyStop.logged}.`,
        { service: "telemetry" },
      );
      expect(logger.warn).toHaveBeenCalledWith(
        `MQTT: closing client "${client.id}" — the ingestion key it connected with can no longer send.`,
        { service: "telemetry" },
      );
      expect(logTranscript()).not.toContain(key.secret);
    });

    test("the Last Will aedes publishes as it closes the client is not ingested, checked or counted again", async () => {
      const key: KeyFixture = createKey();
      const client: TestClient = await openSession(key);

      keyStop.stop(key);
      await expect(publish(client)).resolves.toBeNull();
      expect(client.closed).toBe(true);

      const checksBefore: number = currentPolicyMock().mock.calls.length;
      queueMock().mockClear();

      await expect(
        publish(client, {
          topic: STATUS_TOPIC,
          payload: "offline",
          willOf: client.id,
        }),
      ).resolves.toBeNull();

      // And neither is anything else it still had on the wire.
      await expect(publish(client)).resolves.toBeNull();

      expect(queueMock()).not.toHaveBeenCalled();
      expect(currentPolicyMock().mock.calls.length).toBe(checksBefore);
      expect(client.close).toHaveBeenCalledTimes(1);
      expectCountedAs(key, keyStop.countedAs);
      await settle();
      expect(stampedKeyIds()).toEqual([key.id.toString()]);
    });

    test("closes every session on the key, and no session on another key", async () => {
      const key: KeyFixture = createKey();
      const otherKey: KeyFixture = createKey();
      const first: TestClient = await openSession(key, "gateway-1");
      const second: TestClient = await openSession(key, "gateway-2");
      const other: TestClient = await openSession(otherKey, "gateway-3");

      keyStop.stop(key);
      queueMock().mockClear();
      stamp.mockClear();

      await expect(publish(first)).resolves.toBeNull();
      await expect(publish(other)).resolves.toBeNull();
      await expect(publish(second)).resolves.toBeNull();

      expect(first.close).toHaveBeenCalledTimes(1);
      expect(second.close).toHaveBeenCalledTimes(1);
      expect(other.close).not.toHaveBeenCalled();
      expect(queueMock()).toHaveBeenCalledTimes(1);
      await settle();
      expect(stampedKeyIds()).toEqual([otherKey.id.toString()]);
    });

    test("stops a session that connected with the key in its username too", async () => {
      const key: KeyFixture = createKey();
      const client: TestClient = newClient();

      expect(
        (await connect(client, key.secret, { inUsername: true })).success,
      ).toBe(true);
      await expect(publish(client)).resolves.toBeNull();

      keyStop.stop(key);

      await expect(publish(client)).resolves.toBeNull();
      expect(client.close).toHaveBeenCalledTimes(1);
      expect(queueMock()).toHaveBeenCalledTimes(1);
    });
  });

  describe("with a session that reconnects", () => {
    test("is refused at CONNECT with rc=4 once the lookup by secret knows", async () => {
      const key: KeyFixture = createKey();
      const client: TestClient = await openSession(key);

      keyStop.stop(key);
      await expect(publish(client)).resolves.toBeNull();
      expect(client.close).toHaveBeenCalledTimes(1);
      record.mockClear();

      const reconnected: TestClient = newClient();
      const outcome: ConnectOutcome = await connect(reconnected, key.secret);

      expect(outcome.success).toBe(false);
      expect(outcome.error?.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);
      expect(outcome.error?.message).not.toContain(key.secret);
      expectCountedAs(key, keyStop.countedAs);

      // aedes would not let it publish; if it did, it is not authenticated.
      const error: Error | null | undefined = await publish(reconnected);
      expect(error?.message).toContain("not authenticated");
      expect(queueMock()).toHaveBeenCalledTimes(1);
    });

    test("is refused at CONNECT with rc=4 while the lookup by secret still answers what it did before the stop", async () => {
      /*
       * A server that did not make the change keeps its lookup by secret for
       * a minute. Asked only that, a gateway thrown off on its publish would
       * reconnect straight back into a session; the key as it is now is
       * asked at CONNECT too.
       */
      const key: KeyFixture = createKey();
      const client: TestClient = await openSession(key);

      secretLookupsAreStale = true;
      keyStop.stop(key);
      await expect(publish(client)).resolves.toBeNull();
      record.mockClear();

      // The lookup by secret still admits the key...
      await expect(lookUpBySecret(key.secret)).resolves.not.toBeNull();

      // ...and the CONNECT is refused all the same.
      const reconnected: TestClient = newClient();
      const outcome: ConnectOutcome = await connect(reconnected, key.secret);

      expect(outcome.success).toBe(false);
      expect(outcome.error?.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);
      expectCountedAs(key, keyStop.countedAs);
      expect(currentPolicyMock()).toHaveBeenLastCalledWith({
        ingestionKeyId: key.id,
        secretKeyDigest: TelemetryIngestionKeySecretDigest.of(key.secret),
      });
    });
  });
});

describe("a key given a new secret", () => {
  test("lets a session that reconnects with the new secret publish, and stamps it", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = await openSession(key);

    const newSecret: string = ObjectID.generate().toString();
    storedKey(key).secret = newSecret;

    await expect(publish(client)).resolves.toBeNull();
    expect(client.close).toHaveBeenCalledTimes(1);
    queueMock().mockClear();
    stamp.mockClear();

    const reconnected: TestClient = newClient();
    expect(await connect(reconnected, newSecret)).toEqual({
      error: null,
      success: true,
    });

    await expect(publish(reconnected)).resolves.toBeNull();
    await expect(publish(reconnected)).resolves.toBeNull();

    expect(reconnected.close).not.toHaveBeenCalled();
    expect(queueMock()).toHaveBeenCalledTimes(2);
    expect(stampedKeyIds()).toEqual([key.id.toString(), key.id.toString()]);
  });
});

describe("a key that is still valid", () => {
  test("keeps publishing, and each publish asks for the key as it is now", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = await openSession(key);
    currentPolicyMock().mockClear();

    for (let index: number = 0; index < 5; index++) {
      await expect(publish(client)).resolves.toBeNull();
    }

    expect(client.close).not.toHaveBeenCalled();
    expect(queueMock()).toHaveBeenCalledTimes(6);
    expect(currentPolicyMock()).toHaveBeenCalledTimes(5);
    expect(record).not.toHaveBeenCalled();
    expect(stampedKeyIds()).toHaveLength(6);
  });

  test("is asked for by its id and a digest of the secret, never the secret", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = newClient();

    expect((await connect(client, key.secret)).success).toBe(true);
    await expect(publish(client)).resolves.toBeNull();

    // Once at CONNECT, once for the publish.
    expect(currentPolicyMock()).toHaveBeenCalledTimes(2);

    for (const call of currentPolicyMock().mock.calls) {
      expect(call).toEqual([
        {
          ingestionKeyId: key.id,
          secretKeyDigest: TelemetryIngestionKeySecretDigest.of(key.secret),
        },
      ]);
    }

    expect(JSON.stringify(currentPolicyMock().mock.calls)).not.toContain(
      key.secret,
    );
  });

  test("keeps publishing when the key was presented in capitals: Postgres compares uuids without case", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = newClient();

    expect((await connect(client, key.secret.toUpperCase())).success).toBe(
      true,
    );

    await expect(publish(client)).resolves.toBeNull();
    await expect(publish(client)).resolves.toBeNull();

    expect(client.close).not.toHaveBeenCalled();
    expect(queueMock()).toHaveBeenCalledTimes(2);
  });

  test("keeps publishing after an edit that does not stop it, and after being switched off and back on", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = await openSession(key);

    storedKey(key).policy.requestsPerMinuteLimit = 100;
    storedKey(key).policy.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await expect(publish(client)).resolves.toBeNull();

    // Off and on again before the session's next publish.
    storedKey(key).policy.isEnabled = false;
    storedKey(key).policy.isEnabled = true;
    await expect(publish(client)).resolves.toBeNull();

    expect(client.close).not.toHaveBeenCalled();
    expect(queueMock()).toHaveBeenCalledTimes(3);
    expect(record).not.toHaveBeenCalled();
  });

  test("the Last Will of a client that died for another reason is still ingested", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = await openSession(key);
    queueMock().mockClear();

    client.closed = true;

    await expect(
      publish(client, {
        topic: STATUS_TOPIC,
        payload: "offline",
        willOf: client.id,
      }),
    ).resolves.toBeNull();

    expect(queueMock()).toHaveBeenCalledTimes(1);
  });

  test("stops at its Expires At with no edit at all: the expiry is compared on every publish", async () => {
    const realNow: () => number = Date.now;
    const connectedAt: number = realNow();
    const key: KeyFixture = createKey({
      expiresAt: new Date(connectedAt + 10 * 60 * 1000),
    });
    const client: TestClient = await openSession(key);

    // Nine minutes on: still valid.
    jest.spyOn(Date, "now").mockReturnValue(connectedAt + 9 * 60 * 1000);
    await expect(publish(client)).resolves.toBeNull();
    expect(client.close).not.toHaveBeenCalled();

    // Eleven minutes on: past it.
    jest.spyOn(Date, "now").mockReturnValue(connectedAt + 11 * 60 * 1000);
    await expect(publish(client)).resolves.toBeNull();

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(queueMock()).toHaveBeenCalledTimes(2);
    expectCountedAs(key, TelemetryIngestRefusalReason.KeyExpired);
  });
});

describe("a key the lookup by secret admits but that is stopped now", () => {
  test.each(KEY_STOPS)(
    "a key $label is refused at CONNECT with rc=4",
    async (keyStop: KeyStop) => {
      const key: KeyFixture = createKey();

      // The lookup by secret remembers the key from before it stopped.
      await lookUpBySecret(key.secret);
      secretLookupsAreStale = true;
      keyStop.stop(key);

      const client: TestClient = newClient("gateway-1");
      const outcome: ConnectOutcome = await connect(client, key.secret);

      expect(outcome.success).toBe(false);
      expect(outcome.error?.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);
      // Refused, so its clientId is not namespaced into a session.
      expect(client.id).toBe("gateway-1");
      expectCountedAs(key, keyStop.countedAs);
      expect(logTranscript()).not.toContain(key.secret);
    },
  );

  test("a key that now names another project is refused, and the session closed", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = await openSession(key);

    storedKey(key).policy.projectId = ObjectID.generate();

    await expect(publish(client)).resolves.toBeNull();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(queueMock()).toHaveBeenCalledTimes(1);
  });
});

describe("when the key cannot be looked up", () => {
  test("a publish is answered with the error, so aedes drops the connection, and nothing is ingested", async () => {
    const key: KeyFixture = createKey();
    const client: TestClient = await openSession(key);
    queueMock().mockClear();
    stamp.mockClear();

    currentPolicyMock().mockRejectedValue(new Error("Postgres is down"));

    const error: Error | null | undefined = await publish(client);

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("Postgres is down");
    expect(queueMock()).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    await settle();
    expect(stamp).not.toHaveBeenCalled();

    // Not a stop: once the lookup answers again, the session publishes.
    currentPolicyMock().mockImplementation(lookUpCurrent);
    await expect(publish(client)).resolves.toBeNull();
    expect(queueMock()).toHaveBeenCalledTimes(1);
  });

  test("a CONNECT is answered rc=3, server unavailable, so the device retries later", async () => {
    const key: KeyFixture = createKey();
    currentPolicyMock().mockRejectedValue(new Error("Postgres is down"));

    const outcome: ConnectOutcome = await connect(newClient(), key.secret);

    expect(outcome.success).toBe(false);
    expect(outcome.error?.returnCode).toBe(CONNACK_SERVER_UNAVAILABLE);
    expect(record).not.toHaveBeenCalled();
  });
});

describe("a session on a device credential", () => {
  test("is not asked about any ingestion key", async () => {
    const credentialId: string = ObjectID.generate().toString();
    const secretKey: string = ObjectID.generate().toString();

    (
      IoTDeviceCredentialService.getCredentialContext as unknown as MockFn
    ).mockResolvedValue({
      credentialId,
      secretKey,
      projectId: PROJECT_ID.toString(),
      iotFleetId: ObjectID.generate().toString(),
      fleetName: FLEET,
      externalId: DEVICE,
    });

    const client: TestClient = newClient();
    expect(
      await new Promise<ConnectOutcome>(
        (resolve: (outcome: ConnectOutcome) => void): void => {
          broker.authenticate(
            client as unknown as Client,
            credentialId,
            Buffer.from(secretKey, "utf8"),
            (
              error: AuthenticateError | null,
              success: boolean | null,
            ): void => {
              resolve({ error, success });
            },
          );
        },
      ),
    ).toEqual({ error: null, success: true });

    await expect(publish(client)).resolves.toBeNull();
    await expect(publish(client)).resolves.toBeNull();

    expect(queueMock()).toHaveBeenCalledTimes(2);
    expect(resolverMock()).not.toHaveBeenCalled();
    expect(currentPolicyMock()).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
  });
});

describe("what the IoT and Ingestion Keys pages say", () => {
  const repositoryRoot: string = path.resolve(__dirname, "../../../..");

  const read: (relativePath: string) => string = (
    relativePath: string,
  ): string => {
    return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
  };

  const keyService: string = read(
    "packages/Common/Server/Services/TelemetryIngestionKeyService.ts",
  );
  const cacheGenerations: string = read(
    "packages/Common/Server/Infrastructure/CacheGenerations.ts",
  );

  test("a session on a stopped key is cut off within a few seconds: the bound is five seconds, and a change through Redis reaches every server within one", () => {
    expect(keyService).toContain(
      "export const CURRENT_STATE_FRESH_MS: number = 5 * 1000;",
    );
    expect(cacheGenerations).toContain(
      "public static readonly SHARED_READ_TTL_MS: number = 1_000;",
    );

    expect(
      read("packages/App/FeatureSet/Docs/Content/en/telemetry/iot-devices.md"),
    ).toContain(
      "OneUptime refuses bad credentials at CONNECT with return code 4 (bad username or password), so a misconfigured device fails loudly. Browser keys are refused over MQTT. A client that connected with the ingestion key is cut off within a few seconds once the key is turned off, expires, has its secret reset or is deleted, and is refused when it connects again.",
    );
    expect(
      read(
        "packages/App/FeatureSet/Docs/Content/en/telemetry/ingestion-keys.md",
      ),
    ).toContain(
      "An MQTT client that connected with the key is cut off within a few seconds.",
    );
  });
});
