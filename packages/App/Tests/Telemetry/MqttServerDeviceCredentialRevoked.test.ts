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
import CacheGenerations from "Common/Server/Infrastructure/CacheGenerations";
import IoTDeviceCredentialService, {
  Service as IoTDeviceCredentialServiceClass,
} from "Common/Server/Services/IoTDeviceCredentialService";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import ProjectService from "Common/Server/Services/ProjectService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import logger from "Common/Server/Utils/Logger";
import Model from "Common/Models/DatabaseModels/IoTDeviceCredential";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import ObjectID from "Common/Types/ObjectID";

/*
 * A REVOKED DEVICE CREDENTIAL CUTS ITS DEVICE OFF WITHIN SECONDS ON EVERY
 * SERVER, AND THE BROKER KEEPS NO DEVICE SECRET (issue #8371).
 *
 * A device connects with its credential's id as the MQTT username and its
 * secret as the password, and the broker checks the credential again on
 * every publish (IoTDeviceCredentialService.getCredentialContext). That
 * check used to be cached per process for a minute and cleared only where
 * the change was made, so a device whose credential was switched off or
 * deleted from the dashboard - served by another server - kept publishing
 * for up to a minute; and the cache held each device's raw secret.
 *
 * Here the broker runs on the real credential service (the module every
 * import gets, "the broker's server"), and the dashboard's change is made
 * through a second instance of the same class ("the dashboard's server"):
 * two servers sharing one table of credentials, as Postgres, and one map,
 * as Redis. The clock is Date.now, moved by hand. aedes is a bare object
 * the production hooks land on; no port is bound.
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

// A device credential is not an ingestion key: the broker never asks.
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

// Redis, as a map that can be taken down.
jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  const store: Map<string, string> = new Map();
  const state: { isDown: boolean } = { isDown: false };

  return {
    __esModule: true,
    default: {
      getString: jest.fn(
        async (namespace: string, key: string): Promise<string | null> => {
          if (state.isDown) {
            throw new Error("Cache is not connected");
          }
          return store.get(`${namespace}:${key}`) ?? null;
        },
      ),
      setString: jest.fn(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<void> => {
          if (state.isDown) {
            throw new Error("Cache is not connected");
          }
          store.set(`${namespace}:${key}`, value);
        },
      ),
    },
    __redis: { store, state },
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

const CONNACK_BAD_USERNAME_OR_PASSWORD: number = 4;
const POSITIVE_TTL_MS: number = 60 * 1000;

const PROJECT_ID: ObjectID = ObjectID.generate();
const FLEET: string = "building-a";
const DEVICE: string = "sensor-001";
const TELEMETRY_TOPIC: string = `oneuptime/${FLEET}/${DEVICE}/telemetry`;
const STATUS_TOPIC: string = `oneuptime/${FLEET}/${DEVICE}/status`;
const TELEMETRY_PAYLOAD: string = JSON.stringify({
  metrics: { temperature: 21.5 },
});

const redis: { store: Map<string, string>; state: { isDown: boolean } } = (
  jest.requireMock("Common/Server/Infrastructure/GlobalCache") as {
    __redis: { store: Map<string, string>; state: { isDown: boolean } };
  }
).__redis;

/*
 * ---------------------------------------------------------------------------
 * The credentials, as Postgres holds them, and the two servers reading them.
 * ---------------------------------------------------------------------------
 */

interface Row {
  id: string;
  secretKey: ObjectID;
  isEnabled: boolean;
}

let table: Map<string, Row> = new Map();
let clock: number = 0;

const readRow: (findOneBy: unknown) => Promise<Model | null> = async (
  findOneBy: unknown,
): Promise<Model | null> => {
  const id: string = String(
    (findOneBy as { query: { _id: ObjectID } }).query._id,
  ).toLowerCase();
  const row: Row | undefined = table.get(id);

  if (!row) {
    return null;
  }

  const fleet: IoTFleet = new IoTFleet(ObjectID.generate());
  fleet.name = FLEET;

  return Object.assign(new Model(new ObjectID(row.id)), {
    projectId: PROJECT_ID,
    iotFleetId: fleet.id,
    externalId: DEVICE,
    secretKey: row.secretKey,
    isEnabled: row.isEnabled,
    iotFleet: fleet,
  }) as Model;
};

// The broker's server is the service every import gets.
const brokerServer: IoTDeviceCredentialServiceClass =
  IoTDeviceCredentialService;

// The server the dashboard's change goes through.
let dashboardServer: IoTDeviceCredentialServiceClass;

interface HookInternals {
  onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
  onUpdateSuccess: (
    onUpdate: unknown,
    ids: Array<ObjectID>,
  ) => Promise<unknown>;
  onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
  onDeleteSuccess: (
    onDelete: unknown,
    ids: Array<ObjectID>,
  ) => Promise<unknown>;
  contextCache: { clear: () => void; store: Map<string, unknown> };
  generations: { clear: () => void };
}

const hooksOf: (server: IoTDeviceCredentialServiceClass) => HookInternals = (
  server: IoTDeviceCredentialServiceClass,
): HookInternals => {
  return server as unknown as HookInternals;
};

interface CredentialFixture {
  id: string;
  secret: string;
}

const createCredential: () => CredentialFixture = (): CredentialFixture => {
  const id: string = ObjectID.generate().toString().toLowerCase();
  const secret: string = ObjectID.generate().toString();

  table.set(id, { id, secretKey: new ObjectID(secret), isEnabled: true });

  return { id, secret };
};

const rowOf: (credential: CredentialFixture) => Row = (
  credential: CredentialFixture,
): Row => {
  const row: Row | undefined = table.get(credential.id);
  expect(row).toBeDefined();
  return row!;
};

// Through the dashboard's server, as DatabaseService runs an update.
const updateOnDashboard: (
  credential: CredentialFixture,
  data: Partial<Row>,
) => Promise<void> = async (
  credential: CredentialFixture,
  data: Partial<Row>,
): Promise<void> => {
  const updateBy: Record<string, unknown> = {
    query: { _id: credential.id },
    data: {},
    props: { isRoot: true },
  };

  await hooksOf(dashboardServer).onBeforeUpdate(updateBy);
  Object.assign(rowOf(credential), data);
  await hooksOf(dashboardServer).onUpdateSuccess(
    { updateBy, carryForward: null },
    [new ObjectID(credential.id)],
  );
};

const deleteOnDashboard: (
  credential: CredentialFixture,
) => Promise<void> = async (credential: CredentialFixture): Promise<void> => {
  const deleteBy: Record<string, unknown> = {
    query: { _id: credential.id },
    props: { isRoot: true },
  };

  await hooksOf(dashboardServer).onBeforeDelete(deleteBy);
  table.delete(credential.id);
  await hooksOf(dashboardServer).onDeleteSuccess(
    { deleteBy, carryForward: null },
    [new ObjectID(credential.id)],
  );
};

/*
 * ---------------------------------------------------------------------------
 * Driving the broker.
 * ---------------------------------------------------------------------------
 */

let broker: TestBroker;
let brokerReads: jest.SpiedFunction<typeof brokerServer.findOneBy>;

const queueMock: () => MockFn = (): MockFn => {
  return MetricsQueueService.addMetricIngestJob as unknown as MockFn;
};

const newClient: (id?: string) => TestClient = (
  id: string = "device-1",
): TestClient => {
  const client: TestClient = { id, closed: false, close: jest.fn() };

  client.close.mockImplementation((): void => {
    client.closed = true;
  });

  return client;
};

const connect: (
  client: TestClient,
  username: string,
  password: string,
) => Promise<ConnectOutcome> = (
  client: TestClient,
  username: string,
  password: string,
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

const publish: (
  client: TestClient,
  topic?: string,
  payload?: string,
) => Promise<Error | null | undefined> = (
  client: TestClient,
  topic: string = TELEMETRY_TOPIC,
  payload: string = TELEMETRY_PAYLOAD,
): Promise<Error | null | undefined> => {
  const packet: PublishPacket = {
    cmd: "publish",
    qos: 1,
    dup: false,
    retain: false,
    messageId: 1,
    topic,
    payload: Buffer.from(payload, "utf8"),
  } as PublishPacket;

  return new Promise<Error | null | undefined>(
    (resolve: (error: Error | null | undefined) => void): void => {
      broker.authorizePublish(client as unknown as Client, packet, resolve);
    },
  );
};

// A device connected with its credential, whose first publish was taken.
const openSession: (
  credential: CredentialFixture,
) => Promise<TestClient> = async (
  credential: CredentialFixture,
): Promise<TestClient> => {
  const client: TestClient = newClient();

  expect(await connect(client, credential.id, credential.secret)).toEqual({
    error: null,
    success: true,
  });
  await expect(publish(client)).resolves.toBeNull();
  expect(queueMock()).toHaveBeenCalledTimes(1);
  queueMock().mockClear();

  return client;
};

const expectCutOff: (client: TestClient) => void = (
  client: TestClient,
): void => {
  expect(client.close).toHaveBeenCalledTimes(1);
  expect(queueMock()).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    `MQTT: closing client "${client.id}" — device credential was revoked or deleted.`,
    { service: "telemetry" },
  );
};

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

  table = new Map();
  redis.store.clear();
  redis.state.isDown = false;
  clock = 1_800_000_000_000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clock;
  });

  // Each test starts both servers with nothing kept.
  hooksOf(brokerServer).contextCache.clear();
  hooksOf(brokerServer).generations.clear();
  brokerReads = jest
    .spyOn(brokerServer, "findOneBy")
    .mockImplementation(readRow as unknown as typeof brokerServer.findOneBy);
  jest
    .spyOn(brokerServer, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  dashboardServer = new IoTDeviceCredentialServiceClass();
  jest
    .spyOn(dashboardServer, "findOneBy")
    .mockImplementation(readRow as unknown as typeof dashboardServer.findOneBy);

  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  queueMock().mockReset().mockResolvedValue(undefined);
  (PayAsYouGoBillingService.requirePayAsYouGo as unknown as MockFn)
    .mockReset()
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("CONNECT with a device credential", () => {
  test("is accepted with the credential's secret, in any case, and the device's publishes are ingested", async () => {
    const credential: CredentialFixture = createCredential();

    for (const password of [
      credential.secret,
      credential.secret.toUpperCase(),
    ]) {
      const client: TestClient = newClient();
      expect(await connect(client, credential.id, password)).toEqual({
        error: null,
        success: true,
      });
      await expect(publish(client)).resolves.toBeNull();
    }

    expect(queueMock()).toHaveBeenCalledTimes(2);
    expect(
      TelemetryIngestionKeyService.getPolicyFromSecretKey,
    ).not.toHaveBeenCalled();
  });

  test.each([
    [
      "another uuid",
      (): string => {
        return ObjectID.generate().toString();
      },
    ],
    [
      "the credential's id",
      (): string => {
        return "";
      },
    ],
    [
      "no uuid at all",
      (): string => {
        return "hunter2";
      },
    ],
  ])(
    "is refused with rc=4 for a password that is %s, not the secret",
    async (_label: string, passwordOf: () => string) => {
      const credential: CredentialFixture = createCredential();
      const password: string = passwordOf() || credential.id;

      const outcome: ConnectOutcome = await connect(
        newClient(),
        credential.id,
        password,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error?.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);
    },
  );

  test("is refused with another credential's secret", async () => {
    const credential: CredentialFixture = createCredential();
    const other: CredentialFixture = createCredential();

    const outcome: ConnectOutcome = await connect(
      newClient(),
      credential.id,
      other.secret,
    );

    expect(outcome.error?.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);
  });

  test("leaves no device secret in what the broker's service keeps, or in the log", async () => {
    const credential: CredentialFixture = createCredential();
    const client: TestClient = await openSession(credential);
    await expect(publish(client)).resolves.toBeNull();

    const kept: string = JSON.stringify(
      Array.from(hooksOf(brokerServer).contextCache.store.entries()),
    ).toLowerCase();

    expect(kept).toContain(credential.id);
    expect(kept).not.toContain(credential.secret.toLowerCase());
    expect(logTranscript().toLowerCase()).not.toContain(
      credential.secret.toLowerCase(),
    );
  });
});

describe.each([
  {
    label: "switched off",
    revoke: async (credential: CredentialFixture): Promise<void> => {
      await updateOnDashboard(credential, { isEnabled: false });
    },
  },
  {
    label: "deleted",
    revoke: async (credential: CredentialFixture): Promise<void> => {
      await deleteOnDashboard(credential);
    },
  },
  {
    label: "given another secret",
    revoke: async (credential: CredentialFixture): Promise<void> => {
      await updateOnDashboard(credential, { secretKey: ObjectID.generate() });
    },
  },
])(
  "a device credential $label on the dashboard's server",
  (scenario: {
    label: string;
    revoke: (credential: CredentialFixture) => Promise<void>;
  }) => {
    test("cuts the device off on the broker's server within CacheGenerations.SHARED_READ_TTL_MS, ingesting nothing - not after a minute", async () => {
      const credential: CredentialFixture = createCredential();
      const client: TestClient = await openSession(credential);
      const connectedAt: number = clock;

      clock += 100;
      await scenario.revoke(credential);
      const revokedAt: number = clock;

      clock = revokedAt + CacheGenerations.SHARED_READ_TTL_MS + 1;
      await expect(publish(client)).resolves.toBeNull();

      expectCutOff(client);
      expect(clock).toBeLessThan(connectedAt + POSITIVE_TTL_MS);
    });

    test("refuses the device when it connects again, with rc=4", async () => {
      const credential: CredentialFixture = createCredential();
      await openSession(credential);

      await scenario.revoke(credential);
      clock += CacheGenerations.SHARED_READ_TTL_MS + 1;

      const outcome: ConnectOutcome = await connect(
        newClient("device-1-again"),
        credential.id,
        credential.secret,
      );

      expect(outcome.success).toBe(false);
      expect(outcome.error?.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);
    });

    test("does not ingest the Last Will aedes publishes as it closes the client", async () => {
      const credential: CredentialFixture = createCredential();
      const client: TestClient = await openSession(credential);

      await scenario.revoke(credential);
      clock += CacheGenerations.SHARED_READ_TTL_MS + 1;
      await expect(publish(client)).resolves.toBeNull();
      expect(client.closed).toBe(true);

      await expect(
        publish(client, STATUS_TOPIC, "offline"),
      ).resolves.toBeNull();
      expect(queueMock()).not.toHaveBeenCalled();
    });

    test("while Redis is down, is still cut off - within a minute", async () => {
      const credential: CredentialFixture = createCredential();
      redis.state.isDown = true;
      const client: TestClient = await openSession(credential);
      const connectedAt: number = clock;

      clock += 100;
      await scenario.revoke(credential);

      // Inside the minute, the broker's server may still go by its read...
      clock = connectedAt + POSITIVE_TTL_MS;
      await expect(publish(client)).resolves.toBeNull();
      expect(client.close).not.toHaveBeenCalled();
      queueMock().mockClear();

      // ...and never after it.
      clock = connectedAt + POSITIVE_TTL_MS + 1;
      await expect(publish(client)).resolves.toBeNull();
      expectCutOff(client);
    });
  },
);

describe("a device credential that is not changed", () => {
  test("keeps its device publishing, reading Postgres once for hundreds of publishes", async () => {
    const credential: CredentialFixture = createCredential();
    const client: TestClient = await openSession(credential);
    const readsAfterConnect: number = brokerReads.mock.calls.length;

    for (let index: number = 0; index < 500; index++) {
      clock += 100;
      await expect(publish(client)).resolves.toBeNull();
    }

    expect(client.close).not.toHaveBeenCalled();
    expect(queueMock()).toHaveBeenCalledTimes(500);
    expect(brokerReads.mock.calls.length).toBe(readsAfterConnect);
    expect(readsAfterConnect).toBe(1);
  });

  test("is not cut off by a change to another credential", async () => {
    const credential: CredentialFixture = createCredential();
    const other: CredentialFixture = createCredential();
    const client: TestClient = await openSession(credential);

    await updateOnDashboard(other, { isEnabled: false });
    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;

    await expect(publish(client)).resolves.toBeNull();
    expect(client.close).not.toHaveBeenCalled();
    expect(queueMock()).toHaveBeenCalledTimes(1);
  });

  test("is not cut off by an edit that changes nothing a device holds", async () => {
    const credential: CredentialFixture = createCredential();
    const client: TestClient = await openSession(credential);

    await updateOnDashboard(credential, {});
    clock += CacheGenerations.SHARED_READ_TTL_MS + 1;

    await expect(publish(client)).resolves.toBeNull();
    expect(client.close).not.toHaveBeenCalled();
    expect(queueMock()).toHaveBeenCalledTimes(1);
  });
});

describe("what the IoT Devices page says", () => {
  const repositoryRoot: string = path.resolve(__dirname, "../../../..");

  test("a revoked device is cut off within a few seconds, and within a minute while a server cannot reach the cache", () => {
    expect(CacheGenerations.SHARED_READ_TTL_MS).toBe(1000);
    expect(
      fs.readFileSync(
        path.join(
          repositoryRoot,
          "packages/App/FeatureSet/Docs/Content/en/telemetry/iot-devices.md",
        ),
        "utf8",
      ),
    ).toContain(
      "turn its **Enabled** switch off, or delete it, and a connected device is cut off within a few seconds.",
    );
  });
});
