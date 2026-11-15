/*
 * A key used only over OTLP/gRPC shows as used, end to end against Postgres
 * (issue #7887).
 *
 * GrpcServerKeyLastUsed.test.ts proves the gRPC server stamps the key of an
 * accepted export, and of nothing else, with the key service replaced. Here
 * the stamp is followed to the row. The PRODUCTION server - startGrpcServer()
 * itself - listens on an ephemeral loopback port, a real @grpc/grpc-js client
 * sends a real OTLP logs export with an ingestion key, the real
 * TelemetryIngestionKeyService resolves that key from Postgres (the project's
 * blocked and sample flags from its Project row), the real guard admits or
 * refuses it, and the real markUsed - its per-process throttle and its
 * hook-free UPDATE - writes lastUsedAt:
 *
 *   - an accepted export stamps its key's row, and no other, without
 *     touching updatedAt or version;
 *   - another export inside the throttle window writes nothing more: one
 *     write per key per process, as on HTTP;
 *   - an unknown, disabled, expired or browser key, a blocked or unpaid
 *     project, a used-up budget and an export the queue fails to take are
 *     each answered as before, and no row is stamped.
 *
 * Replaced: the per-signal queue services (Redis), the ingestion budget gate
 * (its settings and counters live in GlobalConfig and Redis), pay-as-you-go
 * billing (the payment provider; TelemetryPayAsYouGoBilling.test.ts covers
 * it), the refusal counter (TelemetryIngestionKeyRefusalPostgres.test.ts
 * writes its rows) and the logger.
 *
 * Opt in with RUN_POSTGRES_GRPC_KEY_LAST_USED_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check
 * (.github/workflows/postgres-schema-drift.yaml runs it). The tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from GRPC_KEY_LAST_USED_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from GRPC_KEY_LAST_USED_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */

// The queues hand jobs to Redis.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {},
    QueueName: { Telemetry: "Telemetry" },
  };
});
jest.mock("../../FeatureSet/Telemetry/Services/Queue/LogsQueueService", () => {
  return { __esModule: true, default: { addLogIngestJob: jest.fn() } };
});
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return { __esModule: true, default: { addMetricIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/ProfilesQueueService",
  () => {
    return { __esModule: true, default: { addProfileIngestJob: jest.fn() } };
  },
);
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService",
  () => {
    return { __esModule: true, default: { addTraceIngestJob: jest.fn() } };
  },
);

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  OTLP_PROTO_LOADER_OPTIONS,
  startGrpcServer,
} from "../../FeatureSet/Telemetry/GrpcServer";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import logger from "Common/Server/Utils/Logger";
import TelemetryIngestionBudget, {
  TelemetryIngestionBudgetAdmission,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestRefusalRecorder from "Common/Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import { DataSource } from "Common/node_modules/typeorm";
import path from "path";

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_GRPC_KEY_LAST_USED_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

// Generous, but far below the jest timeout, so a hang fails as a status.
const CALL_DEADLINE_MS: number = 10000;

const DASHES: RegExp = /-/g;

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

const SERVICE_NAME: string = "grpc-only-collector";

// A small but real OTLP logs export, as a collector's otlp exporter sends it.
const LOGS_EXPORT: Record<string, unknown> = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: SERVICE_NAME } },
        ],
      },
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: "1763078400000000000",
              severityNumber: "SEVERITY_NUMBER_INFO",
              severityText: "INFO",
              body: { stringValue: "first log over gRPC" },
            },
          ],
        },
      ],
    },
  ],
};

const ADMITTED: TelemetryIngestionBudgetAdmission = {
  refusal: null,
  charge: null,
};

type ExportCallback = (
  error: grpc.ServiceError | null,
  response?: Record<string, unknown>,
) => void;

interface OtlpLogsClient extends grpc.Client {
  Export: (
    request: Record<string, unknown>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: ExportCallback,
  ) => grpc.ClientUnaryCall;
}

// What the exporter was answered.
interface ExportAnswer {
  code: grpc.status;
  details: string;
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
 * One way an export ends without being accepted. `arrange` makes the key it
 * is sent with (null: no key has the token) and whatever else the case
 * needs; `code` is what the exporter is answered, checked so each case is
 * known to have reached the branch it names.
 */
interface RefusedCase {
  label: string;
  arrange: () => Promise<KeyFixture | null>;
  code: grpc.status;
  // Whether the export got as far as the queue (which failed to take it).
  reachesQueue: boolean;
}

describePostgres("a key used only over OTLP/gRPC (Postgres)", () => {
  const schema: string = `grpc_key_last_used_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;

  // The project the keys belong to, and one a master admin blocked.
  const projectId: string = ObjectID.generate().toString();
  const blockedProjectId: string = ObjectID.generate().toString();

  let database: DataSource;
  let server: grpc.Server | null = null;
  let client: OtlpLogsClient | null = null;

  // The UPDATEs markUsed started, so a test can wait for them to land.
  let stampWrites: Array<Promise<void>> = [];

  const markUsed: (ingestionKeyId: ObjectID) => Promise<void> =
    TelemetryIngestionKeyService.markUsed.bind(TelemetryIngestionKeyService);

  function getQueueMock(): jest.Mock {
    return LogsQueueService.addLogIngestJob as unknown as jest.Mock;
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
      host: process.env["GRPC_KEY_LAST_USED_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["GRPC_KEY_LAST_USED_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["GRPC_KEY_LAST_USED_TEST_DATABASE_NAME"] ||
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
       VALUES ($1, 'Collector', false, false), ($2, 'Blocked', true, false)`,
      [projectId, blockedProjectId],
    );

    silenceLogger();

    /*
     * startGrpcServer builds and registers everything exactly as in
     * production; only its listen address is redirected, from port 4317 on
     * every interface to an ephemeral loopback port.
     */
    const realBindAsync: grpc.Server["bindAsync"] =
      grpc.Server.prototype.bindAsync;
    const bindSpy: jest.SpyInstance = jest.spyOn(
      grpc.Server.prototype,
      "bindAsync",
    );
    const bound: Promise<number> = new Promise<number>(
      (
        resolve: (port: number) => void,
        reject: (error: Error) => void,
      ): void => {
        bindSpy.mockImplementation(function (
          this: grpc.Server,
          address: string,
          credentials: grpc.ServerCredentials,
          productionCallback: (error: Error | null, port: number) => void,
        ): void {
          expect(address).toBe("0.0.0.0:4317");
          realBindAsync.call(
            this,
            "127.0.0.1:0",
            credentials,
            (error: Error | null, port: number): void => {
              productionCallback(error, port);
              if (error) {
                reject(error);
                return;
              }
              resolve(port);
            },
          );
        });
      },
    );

    startGrpcServer();
    const port: number = await bound;
    server = bindSpy.mock.contexts[0] as grpc.Server;

    const definition: protoLoader.PackageDefinition = protoLoader.loadSync(
      path.join(PROTO_DIR, "logs_service.proto"),
      OTLP_PROTO_LOADER_OPTIONS,
    );
    let node: unknown = grpc.loadPackageDefinition(definition);
    for (const key of [
      "opentelemetry",
      "proto",
      "collector",
      "logs",
      "v1",
      "LogsService",
    ]) {
      node = (node as Record<string, unknown>)[key];
    }
    const LogsClient: grpc.ServiceClientConstructor =
      node as grpc.ServiceClientConstructor;
    client = new LogsClient(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
    ) as unknown as OtlpLogsClient;

    jest.restoreAllMocks();
  });

  afterAll(async () => {
    client?.close();

    const running: grpc.Server | null = server;
    if (running) {
      await new Promise<void>((resolve: () => void): void => {
        running.tryShutdown((error?: Error): void => {
          if (error) {
            running.forceShutdown();
          }
          resolve();
        });
      });
    }

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
    jest.spyOn(TelemetryIngestionBudget, "admit").mockResolvedValue(ADMITTED);
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
       VALUES ($1, $2, 'OTel Collector', $3, $4, $5, $6, $7, '2026-11-01T09:00:00Z', '2026-11-01T09:00:00Z', 1)`,
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

  function exportLogs(key: KeyFixture | null): Promise<ExportAnswer> {
    const metadata: grpc.Metadata = new grpc.Metadata();
    metadata.set("x-oneuptime-service-name", SERVICE_NAME);
    metadata.set(
      "x-oneuptime-token",
      key ? key.secretKey : ObjectID.generate().toString(),
    );

    return new Promise<ExportAnswer>(
      (resolve: (answer: ExportAnswer) => void): void => {
        client!.Export(
          LOGS_EXPORT,
          metadata,
          { deadline: Date.now() + CALL_DEADLINE_MS },
          (error: grpc.ServiceError | null): void => {
            resolve({
              code: error ? error.code : grpc.status.OK,
              details: error ? error.details : "",
            });
          },
        );
      },
    );
  }

  // The stamp is fire and forget: the exporter is answered before it lands.
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

  test("an accepted export stamps its key's row, and no other, at the time it was accepted, leaving updatedAt and version as they were", async () => {
    const key: KeyFixture = await insertKey();
    const otherKey: KeyFixture = await insertKey();
    const before: KeyRow = await readKey(key);

    expect(before.lastUsedAt).toBeNull();

    const sentAt: number = Date.now();
    const answer: ExportAnswer = await exportLogs(key);

    expect(answer).toEqual({ code: grpc.status.OK, details: "" });
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

  test("another export inside the throttle window writes nothing more: one write per key per process, as on HTTP", async () => {
    const key: KeyFixture = await insertKey();

    expect((await exportLogs(key)).code).toBe(grpc.status.OK);
    await stampWritesDone();
    expect((await readKey(key)).lastUsedAt).toBeInstanceOf(Date);

    // Marked, so a second write would show.
    const marker: Date = new Date("2026-11-02T00:00:00.000Z");
    await database.query(
      `UPDATE "${schema}"."TelemetryIngestionKey" SET "lastUsedAt" = $2 WHERE "_id" = $1`,
      [key.id, marker],
    );

    expect((await exportLogs(key)).code).toBe(grpc.status.OK);
    await stampWritesDone();

    // Both exports were accepted and asked for the stamp; one wrote it.
    expect(getQueueMock()).toHaveBeenCalledTimes(2);
    expect(stampsAsked()).toEqual([key.id, key.id]);
    expect((await readKey(key)).lastUsedAt!.getTime()).toBe(marker.getTime());
  });

  const refusedCases: Array<RefusedCase> = [
    {
      label: "a token no key has",
      arrange: async (): Promise<KeyFixture | null> => {
        // A key the project does have, to show nothing else is stamped.
        await insertKey();
        return null;
      },
      code: grpc.status.UNAUTHENTICATED,
      reachesQueue: false,
    },
    {
      label: "a disabled key",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({ isEnabled: false });
      },
      code: grpc.status.PERMISSION_DENIED,
      reachesQueue: false,
    },
    {
      label: "an expired key",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) });
      },
      code: grpc.status.UNAUTHENTICATED,
      reachesQueue: false,
    },
    {
      label: "a browser key, which no browser can send over gRPC",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: ["https://shop.example.com"],
        });
      },
      code: grpc.status.PERMISSION_DENIED,
      reachesQueue: false,
    },
    {
      label: "a key of a blocked project",
      arrange: (): Promise<KeyFixture> => {
        return insertKey({ projectId: blockedProjectId });
      },
      code: grpc.status.PERMISSION_DENIED,
      reachesQueue: false,
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
      code: grpc.status.PERMISSION_DENIED,
      reachesQueue: false,
    },
    {
      label: "a key whose project has used up its daily logs budget",
      arrange: (): Promise<KeyFixture> => {
        jest.spyOn(TelemetryIngestionBudget, "admit").mockResolvedValue({
          refusal: {
            kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
            scope: TelemetryIngestionBudgetScope.Project,
            signal: ProductType.Logs,
            message: "The project's daily logs budget is used up.",
            retryAfterSeconds: null,
            resetsAt: new Date(Date.now() + 60 * 60 * 1000),
          },
          charge: null,
        });
        return insertKey();
      },
      code: grpc.status.RESOURCE_EXHAUSTED,
      reachesQueue: false,
    },
    {
      label: "an export the queue fails to take",
      arrange: (): Promise<KeyFixture> => {
        getQueueMock().mockRejectedValue(new Error("Redis is down"));
        return insertKey();
      },
      code: grpc.status.UNAVAILABLE,
      reachesQueue: true,
    },
  ];

  test.each(refusedCases)(
    "nothing is stamped for $label",
    async (refused: RefusedCase) => {
      const key: KeyFixture | null = await refused.arrange();

      const answer: ExportAnswer = await exportLogs(key);

      expect(answer.code).toBe(refused.code);
      expect(getQueueMock()).toHaveBeenCalledTimes(
        refused.reachesQueue ? 1 : 0,
      );

      await stampWritesDone();

      expect(stampsAsked()).toEqual([]);
      expect(await stampedKeyIds()).toEqual([]);
      if (key) {
        expect((await readKey(key)).lastUsedAt).toBeNull();
      }
    },
  );
});
