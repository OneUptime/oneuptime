/*
 * A key used only over MQTT shows as used, end to end against Postgres
 * (issue #8020).
 *
 * MqttServerKeyLastUsed.test.ts proves the MQTT broker stamps the key of a
 * publish the queue takes, and of nothing else, with the key service
 * replaced. Here the stamp is followed to the row. The PRODUCTION hooks -
 * the authenticate and authorizePublish startMqttServer() installs on the
 * broker - are driven with a real ingestion key: the real
 * TelemetryIngestionKeyService resolves it from Postgres at CONNECT (the
 * project's blocked and sample flags from its Project row), the real guard
 * admits or refuses it, and on each publish the queue takes, the real
 * markUsed - its per-process throttle and its hook-free UPDATE - writes
 * lastUsedAt:
 *
 *   - an accepted publish stamps its key's row, and no other, without
 *     touching updatedAt or version;
 *   - a CONNECT alone stamps nothing;
 *   - another publish inside the throttle window writes nothing more: one
 *     write per key per process, as on HTTP and gRPC;
 *   - an unknown, disabled, expired or browser key, a blocked or unpaid
 *     project, and a publish the queue fails to take are each refused as
 *     before, and no row is stamped.
 *
 * Replaced: aedes (a bare object the hooks are attached to: no port is
 * bound), the metrics queue (Redis), pay-as-you-go billing (the payment
 * provider; TelemetryPayAsYouGoBilling.test.ts covers it), the refusal
 * counter (TelemetryIngestionKeyRefusalPostgres.test.ts writes its rows) and
 * the logger.
 *
 * Opt in with RUN_POSTGRES_MQTT_KEY_LAST_USED_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check
 * (.github/workflows/postgres-schema-drift.yaml runs it). The tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from MQTT_KEY_LAST_USED_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from MQTT_KEY_LAST_USED_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */

// The queue hands jobs to Redis.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {},
    QueueName: { Telemetry: "Telemetry" },
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

import { AuthenticateError, Client, PublishPacket } from "aedes";
import { startMqttServer } from "../../FeatureSet/Telemetry/MqttServer";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import logger from "Common/Server/Utils/Logger";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { DataSource } from "Common/node_modules/typeorm";

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MQTT_KEY_LAST_USED_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

// MQTT 3.1.1 CONNACK return code 4 - bad user name or password.
const CONNACK_BAD_USERNAME_OR_PASSWORD: number = 4;

const DASHES: RegExp = /-/g;

const TOPIC: string = "oneuptime/building-a/sensor-001/telemetry";
const PAYLOAD: string = JSON.stringify({ metrics: { temperature: 21.5 } });

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

interface TestClient {
  id: string;
  closed: boolean;
  close: jest.Mock;
}

interface ConnectOutcome {
  error: AuthenticateError | null;
  success: boolean | null;
}

interface KeyFixture {
  id: string;
  secretKey: string;
}

interface KeyColumns {
  projectId?: string;
  keyType?: TelemetryIngestionKeyType;
  isEnabled?: boolean;
  expiresAt?: Date | null;
  allowedOrigins?: Array<string> | null;
}

interface KeyRow {
  lastUsedAt: Date | null;
  updatedAt: Date;
  version: number;
}

/*
 * One way a key's telemetry is refused at CONNECT. `arrange` makes the key
 * it is sent with (null: no key has the token) and whatever else the case
 * needs.
 */
interface RefusedConnectCase {
  label: string;
  arrange: () => Promise<KeyFixture | null>;
}

describePostgres("a key used only over MQTT (Postgres)", () => {
  const schema: string = `mqtt_key_last_used_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  // The project the keys belong to, and one a master admin blocked.
  const projectId: string = ObjectID.generate().toString();
  const blockedProjectId: string = ObjectID.generate().toString();

  let database: DataSource;
  let broker: TestBroker;

  // The UPDATEs markUsed started, so a test can wait for them to land.
  let stampWrites: Array<Promise<void>> = [];

  const markUsed: (ingestionKeyId: ObjectID) => Promise<void> =
    TelemetryIngestionKeyService.markUsed.bind(TelemetryIngestionKeyService);

  function getQueueMock(): jest.Mock {
    return MetricsQueueService.addMetricIngestJob as unknown as jest.Mock;
  }

  function silenceLogger(): void {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["MQTT_KEY_LAST_USED_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["MQTT_KEY_LAST_USED_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MQTT_KEY_LAST_USED_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["Project", "TelemetryIngestionKey"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what the path reads; keys stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT c.table_name, c.column_name FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.is_nullable = 'NO'
           AND NOT EXISTS (
             SELECT 1 FROM information_schema.table_constraints t
             JOIN information_schema.key_column_usage k
               ON k.constraint_name = t.constraint_name
              AND k.table_schema = t.table_schema
             WHERE t.constraint_type = 'PRIMARY KEY'
               AND t.table_schema = c.table_schema
               AND k.table_name = c.table_name
               AND k.column_name = c.column_name
           )`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "isBlocked", "isSampleProject")
       VALUES ($1, 'Gateways', false, false), ($2, 'Blocked', true, false)`,
      [projectId, blockedProjectId],
    );

    silenceLogger();

    // startMqttServer installs its hooks exactly as in production.
    await startMqttServer();
    broker = (jest.requireMock("aedes") as { __broker: TestBroker }).__broker;
    expect(typeof broker.authenticate).toBe("function");
    expect(typeof broker.authorizePublish).toBe("function");

    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    silenceLogger();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    // Each test starts with no keys, so any stamp found is its own.
    await database.query(`DELETE FROM "${schema}"."TelemetryIngestionKey"`);

    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
    jest
      .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
      .mockResolvedValue(undefined);
    jest
      .spyOn(TelemetryIngestRefusalRecorder, "record")
      .mockImplementation(() => {});

    getQueueMock().mockReset().mockResolvedValue(undefined);

    // The real markUsed - throttle and UPDATE - with each write kept.
    stampWrites = [];
    jest
      .spyOn(TelemetryIngestionKeyService, "markUsed")
      .mockImplementation((ingestionKeyId: ObjectID): Promise<void> => {
        const write: Promise<void> = markUsed(ingestionKeyId);
        stampWrites.push(write);
        return write;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function insertKey(columns: KeyColumns = {}): Promise<KeyFixture> {
    const key: KeyFixture = {
      id: ObjectID.generate().toString(),
      secretKey: ObjectID.generate().toString(),
    };

    await database.query(
      `INSERT INTO "${schema}"."TelemetryIngestionKey"
         ("_id", "projectId", "name", "secretKey", "keyType", "isEnabled", "expiresAt", "allowedOrigins", "createdAt", "updatedAt", "version")
       VALUES ($1, $2, 'MQTT gateway', $3, $4, $5, $6, $7, '2026-11-01T09:00:00Z', '2026-11-01T09:00:00Z', 1)`,
      [
        key.id,
        columns.projectId || projectId,
        key.secretKey,
        columns.keyType || TelemetryIngestionKeyType.Server,
        columns.isEnabled ?? true,
        columns.expiresAt ?? null,
        columns.allowedOrigins ? JSON.stringify(columns.allowedOrigins) : null,
      ],
    );

    return key;
  }

  async function readKey(key: KeyFixture): Promise<KeyRow> {
    const rows: Array<KeyRow> = await database.query(
      `SELECT "lastUsedAt", "updatedAt", "version" FROM "${schema}"."TelemetryIngestionKey" WHERE "_id" = $1`,
      [key.id],
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  // Every key whose lastUsedAt is set, whoever set it.
  async function stampedKeyIds(): Promise<Array<string>> {
    const rows: Array<{ _id: string }> = await database.query(
      `SELECT "_id" FROM "${schema}"."TelemetryIngestionKey" WHERE "lastUsedAt" IS NOT NULL ORDER BY "_id"`,
    );

    return rows.map((row: { _id: string }): string => {
      return row._id;
    });
  }

  function newClient(): TestClient {
    return { id: "gateway-1", closed: false, close: jest.fn() };
  }

  // A CONNECT with the key in the password, as the IoT guide says.
  function connect(
    client: TestClient,
    key: KeyFixture | null,
  ): Promise<ConnectOutcome> {
    const secret: string = key ? key.secretKey : ObjectID.generate().toString();

    return new Promise<ConnectOutcome>(
      (resolve: (outcome: ConnectOutcome) => void): void => {
        broker.authenticate(
          client as unknown as Client,
          undefined,
          Buffer.from(secret, "utf8"),
          (error: AuthenticateError | null, success: boolean | null): void => {
            resolve({ error, success });
          },
        );
      },
    );
  }

  function publish(client: TestClient): Promise<Error | null | undefined> {
    const packet: PublishPacket = {
      cmd: "publish",
      qos: 1,
      dup: false,
      retain: false,
      messageId: 1,
      topic: TOPIC,
      payload: Buffer.from(PAYLOAD, "utf8"),
    } as PublishPacket;

    return new Promise<Error | null | undefined>(
      (resolve: (error: Error | null | undefined) => void): void => {
        broker.authorizePublish(client as unknown as Client, packet, resolve);
      },
    );
  }

  // The stamp is fire and forget: the publish is answered before it lands.
  async function stampWritesDone(): Promise<void> {
    await Promise.all(stampWrites);
  }

  function stampsAsked(): Array<string> {
    return (
      TelemetryIngestionKeyService.markUsed as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string => {
      return String(call[0]);
    });
  }

  test("an accepted publish stamps its key's row, and no other, at the time it was taken, leaving updatedAt and version as they were", async () => {
    const key: KeyFixture = await insertKey();
    const otherKey: KeyFixture = await insertKey();
    const before: KeyRow = await readKey(key);

    expect(before.lastUsedAt).toBeNull();

    const client: TestClient = newClient();
    expect(await connect(client, key)).toEqual({ error: null, success: true });

    // Connecting is not sending.
    expect(stampsAsked()).toEqual([]);

    const sentAt: number = Date.now();
    await expect(publish(client)).resolves.toBeNull();
    expect(getQueueMock()).toHaveBeenCalledTimes(1);

    await stampWritesDone();
    const answeredAt: number = Date.now();

    expect(stampsAsked()).toEqual([key.id]);

    const after: KeyRow = await readKey(key);
    expect(after.lastUsedAt).toBeInstanceOf(Date);
    expect(after.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(sentAt);
    expect(after.lastUsedAt!.getTime()).toBeLessThanOrEqual(answeredAt);

    // A liveness stamp, not an edit: nothing watching updatedAt sees it.
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.version).toBe(before.version);

    expect(await stampedKeyIds()).toEqual([key.id]);
    expect((await readKey(otherKey)).lastUsedAt).toBeNull();
  });

  test("a key that connects and publishes nothing is not stamped", async () => {
    const key: KeyFixture = await insertKey();

    expect(await connect(newClient(), key)).toEqual({
      error: null,
      success: true,
    });

    await stampWritesDone();

    expect(stampsAsked()).toEqual([]);
    expect(await stampedKeyIds()).toEqual([]);
  });

  test("another publish inside the throttle window writes nothing more: one write per key per process, as on HTTP and gRPC", async () => {
    const key: KeyFixture = await insertKey();
    const client: TestClient = newClient();
    expect((await connect(client, key)).success).toBe(true);

    await expect(publish(client)).resolves.toBeNull();
    await stampWritesDone();
    expect((await readKey(key)).lastUsedAt).toBeInstanceOf(Date);

    // Marked, so a second write would show.
    const marker: Date = new Date("2026-11-02T00:00:00.000Z");
    await database.query(
      `UPDATE "${schema}"."TelemetryIngestionKey" SET "lastUsedAt" = $2 WHERE "_id" = $1`,
      [key.id, marker],
    );

    await expect(publish(client)).resolves.toBeNull();
    await stampWritesDone();

    // Both publishes were taken and asked for the stamp; one wrote it.
    expect(getQueueMock()).toHaveBeenCalledTimes(2);
    expect(stampsAsked()).toEqual([key.id, key.id]);
    expect((await readKey(key)).lastUsedAt!.getTime()).toBe(marker.getTime());
  });

  const refusedConnects: Array<RefusedConnectCase> = [
    {
      label: "a token no key has",
      arrange: async (): Promise<KeyFixture | null> => {
        // A key the project does have, to show nothing else is stamped.
        await insertKey();
        return null;
      },
    },
    {
      label: "a disabled key",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({ isEnabled: false });
      },
    },
    {
      label: "an expired key",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) });
      },
    },
    {
      label: "a browser key, which MQTT refuses",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: ["https://shop.example.com"],
        });
      },
    },
    {
      label: "a key of a blocked project",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({ projectId: blockedProjectId });
      },
    },
    {
      label: "a key of a project that has not set up payment",
      arrange: (): Promise<KeyFixture> => {
        jest
          .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
          .mockRejectedValue(
            new PaymentRequiredException("Add a payment method."),
          );
        return insertKey();
      },
    },
  ];

  test.each(refusedConnects)(
    "nothing is stamped for $label, refused at CONNECT",
    async (refused: RefusedConnectCase) => {
      const key: KeyFixture | null = await refused.arrange();
      const client: TestClient = newClient();

      const outcome: ConnectOutcome = await connect(client, key);

      expect(outcome.success).toBe(false);
      expect(outcome.error?.returnCode).toBe(CONNACK_BAD_USERNAME_OR_PASSWORD);

      // aedes would not let it publish; if it did, it is not authenticated.
      expect(await publish(client)).toBeInstanceOf(Error);
      expect(getQueueMock()).not.toHaveBeenCalled();

      await stampWritesDone();

      expect(stampsAsked()).toEqual([]);
      expect(await stampedKeyIds()).toEqual([]);
      if (key) {
        expect((await readKey(key)).lastUsedAt).toBeNull();
      }
    },
  );

  test("nothing is stamped for a publish the queue fails to take", async () => {
    const key: KeyFixture = await insertKey();
    const client: TestClient = newClient();
    expect((await connect(client, key)).success).toBe(true);

    getQueueMock().mockRejectedValue(new Error("Redis is down"));

    expect(await publish(client)).toBeInstanceOf(Error);
    expect(getQueueMock()).toHaveBeenCalledTimes(1);

    await stampWritesDone();

    expect(stampsAsked()).toEqual([]);
    expect((await readKey(key)).lastUsedAt).toBeNull();
  });
});
