import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceClass,
} from "Common/Server/Services/SecurityEventConnectionService";
import Encryption from "Common/Server/Utils/Encryption";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import MoveGoogleSecOpsConnectionsToSecurityEventConnections, {
  GOOGLE_SECOPS_PROVIDER_DETAIL_KEYS,
  INTERRUPTED_RUN_ERROR,
  LegacyGoogleSecOpsConnectionRow,
  LegacyGoogleSecOpsRunRow,
  RUN_HISTORY_COPY_LIMIT,
  RUN_INSERT_BATCH_SIZE,
  RunHistoryInsert,
  UNKNOWN_SEVERITY,
  UNTITLED_DETECTION_TITLE,
  buildRunHistoryInsert,
  isSecurityConnectorTestReport,
  isTransientDatabaseError,
  mapLegacyCheckStatus,
  toCheckKey,
  transformLegacyLastPollResult,
  transformLegacyRunResult,
  unwrapHashedStringEnvelope,
} from "../../../FeatureSet/Workers/DataMigrations/MoveGoogleSecOpsConnectionsToSecurityEventConnections";
import fs from "fs";
import path from "path";

/*
 * Google SecOps connections move from their own table into Security Event
 * Connections. This is a customer's live integration: a connection that is
 * not carried over, or carried over with an unreadable key, or resumed from
 * the wrong place, is an outage or a pile of duplicate detections.
 *
 * No Postgres here. The services, Encryption and the logger are replaced,
 * and the repository's manager.query is a small fake that answers the four
 * statements the migration issues (table probe, connection read, run read,
 * and the writes it records). What is pinned: registration, every column's
 * mapping, the key's re-encryption shape, idempotency under a racing
 * runner, per-connection isolation, the run history SQL, and the pure
 * result transforms the dashboard depends on.
 */
jest.mock("Common/Server/Services/SecurityEventConnectionService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      create: jest.fn(),
      getRepository: jest.fn(),
    },
    Service: { validateSettings: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Encryption", () => {
  return {
    __esModule: true,
    default: { decrypt: jest.fn() },
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
    },
  };
});

const MIGRATION_NAME: string =
  "MoveGoogleSecOpsConnectionsToSecurityEventConnections";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

interface ServiceMock {
  findOneById: jest.Mock;
  create: jest.Mock;
  getRepository: jest.Mock;
}

const service: ServiceMock =
  SecurityEventConnectionService as unknown as ServiceMock;

const serviceClass: { validateSettings: jest.Mock } =
  SecurityEventConnectionServiceClass as unknown as {
    validateSettings: jest.Mock;
  };

const encryption: { decrypt: jest.Mock } = Encryption as unknown as {
  decrypt: jest.Mock;
};

const mockedLogger: {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} = logger as unknown as {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const SECOND_CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_ID: string = "44444444-4444-4444-8444-444444444444";
const DELETER_ID: string = "55555555-5555-4555-8555-555555555555";
const RUN_ID: string = "66666666-6666-4666-8666-666666666666";

const CIPHERTEXT: string = "U2FsdGVkX1+legacyServiceAccountCiphertext==";
const SECOND_CIPHERTEXT: string = "U2FsdGVkX1+secondServiceAccountCiphertext==";

/*
 * A key as a customer pastes it: pretty-printed, with a PEM whose newlines
 * must survive byte for byte, or Google rejects the signature.
 */
const SERVICE_ACCOUNT_JSON: string = JSON.stringify(
  {
    type: "service_account",
    project_id: "acme-secops",
    client_email: "poller@acme-secops.iam.gserviceaccount.com",
    private_key:
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n",
    token_uri: "https://oauth2.googleapis.com/token",
  },
  null,
  2,
);

const SECOND_SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  client_email: "second@acme-secops.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nSECONDKEYBODY\n-----END PRIVATE KEY-----\n",
});

const RUN_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "projectId",
  "securityEventConnectionId",
  "requestedByUserId",
  "type",
  "status",
  "startedAt",
  "completedAt",
  "request",
  "result",
  "error",
];

interface ExecutedStatement {
  sql: string;
  parameters: Array<unknown>;
}

interface FakeDatabase {
  hasConnectionTable: boolean;
  hasRunTable: boolean;
  connections: Array<LegacyGoogleSecOpsConnectionRow>;
  runsByConnection: Record<string, Array<LegacyGoogleSecOpsRunRow>>;
  statements: Array<ExecutedStatement>;
  failWhen: ((statement: ExecutedStatement) => Error | null) | null;
}

let database: FakeDatabase;

function legacyPollResult(overrides: JSONObject = {}): JSONObject {
  return {
    type: "poll",
    runId: RUN_ID,
    status: "success",
    startedAt: "2026-09-14T10:00:05.000Z",
    completedAt: "2026-09-14T10:01:00.000Z",
    durationMs: 55000,
    windowStart: "2026-09-14T09:54:00.000Z",
    windowEnd: "2026-09-14T10:00:00.000Z",
    includeNonAlertingDetections: false,
    basis: "created-time",
    sourceCounts: { ruleDetections: 3, curatedDetections: 1, alertsView: 2 },
    creationLag: { measured: 4, lateCount: 1, maxLagMinutes: 42 },
    fetchedCount: 6,
    ingestedCount: 5,
    duplicateCount: 1,
    rejectedCount: 0,
    failedCount: 0,
    complete: true,
    requestCount: 4,
    warnings: ["Curated detections are not readable by this key."],
    samples: [
      {
        id: "de_1",
        ruleName: "Suspicious login",
        detectionTime: "2026-09-14T09:10:00.000Z",
        createdTime: "2026-09-14T09:55:00.000Z",
        isAlert: true,
      },
    ],
    checks: [
      {
        name: "Read rule detections by created time",
        status: "success",
        durationMs: 120,
        message: "Read 3 rule detections.",
      },
      {
        name: "Read curated rule detections by created time",
        status: "warn",
        durationMs: 80,
        message: "HTTP 403",
      },
      {
        name: "Read alerts view by detection time",
        status: "failed",
        durationMs: 30,
        message: "HTTP 500",
      },
    ],
    chunkMinutes: 6,
    nextChunkMinutes: 12,
    forcedAdvance: false,
    ...overrides,
  };
}

function legacyTestReport(): JSONObject {
  return {
    provider: "google-secops",
    status: "warn",
    startedAt: "2026-09-14T08:00:00.000Z",
    completedAt: "2026-09-14T08:00:01.000Z",
    durationMs: 900,
    summary:
      "Google SecOps is reachable, but only the other selection has data.",
    checks: [
      {
        key: "configuration",
        name: "Check the configuration",
        status: "pass",
        durationMs: 1,
        message: "The region, instance resource name and key are well formed.",
      },
      {
        key: "detections-available",
        name: "Detections available",
        status: "warn",
        durationMs: 400,
        message: "No alerts in the last 7 days.",
        remediation: "Select Detections under Data to import.",
      },
    ],
    counts: { scope: "alerts", alertsViewLast24h: 0, alertsViewLast7d: 0 },
    samples: [{ id: "a1", title: "Suspicious login", severity: "High" }],
  };
}

function legacyConnection(
  overrides: Partial<LegacyGoogleSecOpsConnectionRow> = {},
): LegacyGoogleSecOpsConnectionRow {
  return {
    _id: CONNECTION_ID,
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-14T10:01:00.000Z"),
    projectId: PROJECT_ID,
    name: "Chronicle production",
    region: "eu",
    instanceResourceName:
      "projects/acme-secops/locations/eu/instances/0f1e2d3c-instance",
    serviceAccountJson: CIPHERTEXT,
    isEnabled: true,
    pollIntervalInMinutes: 15,
    includeNonAlertingDetections: false,
    lastSuccessfulPollAt: new Date("2026-09-14T10:01:00.000Z"),
    lastEventIngestedAt: new Date("2026-09-14T09:55:00.000Z"),
    lastPollResult: legacyPollResult(),
    lastPolledAt: new Date("2026-09-14T10:00:05.000Z"),
    cursor: "2026-09-14T10:00:00.000Z",
    lastError: null,
    createdByUserId: USER_ID,
    deletedByUserId: null,
    ...overrides,
  };
}

function legacyRun(
  overrides: Partial<LegacyGoogleSecOpsRunRow> = {},
): LegacyGoogleSecOpsRunRow {
  return {
    _id: RUN_ID,
    createdAt: new Date("2026-09-14T10:00:00.000Z"),
    updatedAt: new Date("2026-09-14T10:01:00.000Z"),
    requestedByUserId: USER_ID,
    type: "poll",
    status: "success",
    startedAt: new Date("2026-09-14T10:00:05.000Z"),
    completedAt: new Date("2026-09-14T10:01:00.000Z"),
    request: { type: "poll", scheduled: true },
    result: legacyPollResult(),
    error: "",
    ...overrides,
  };
}

// A run _id derived from a number, so a long history has unique ids.
function runIdFor(index: number): string {
  return `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`;
}

function installFakeDatabase(): jest.Mock {
  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters?: unknown): Promise<unknown> => {
      const statement: ExecutedStatement = {
        sql: String(sql),
        parameters: Array.isArray(parameters) ? parameters : [],
      };

      database.statements.push(statement);

      const failure: Error | null = database.failWhen
        ? database.failWhen(statement)
        : null;

      if (failure) {
        throw failure;
      }

      if (statement.sql.includes("to_regclass")) {
        return [
          {
            hasConnectionTable: database.hasConnectionTable,
            hasRunTable: database.hasRunTable,
          },
        ];
      }

      if (statement.sql.includes('FROM "GoogleSecOpsConnectionRun"')) {
        const runs: Array<LegacyGoogleSecOpsRunRow> =
          database.runsByConnection[String(statement.parameters[0])] || [];
        return runs.slice(0, Number(statement.parameters[1]));
      }

      if (statement.sql.includes('FROM "GoogleSecOpsConnection"')) {
        return database.connections;
      }

      return [];
    },
  ) as unknown as jest.Mock;

  service.getRepository.mockReturnValue({ manager: { query } });

  return query;
}

async function runMigration(): Promise<void> {
  await new MoveGoogleSecOpsConnectionsToSecurityEventConnections().migrate();
}

function statementsContaining(fragment: string): Array<ExecutedStatement> {
  return database.statements.filter((statement: ExecutedStatement) => {
    return statement.sql.includes(fragment);
  });
}

function createdConnections(): Array<SecurityEventConnection> {
  return service.create.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: SecurityEventConnection }).data;
  });
}

function disabledConnectionIds(): Array<unknown> {
  return statementsContaining('UPDATE "GoogleSecOpsConnection"').map(
    (statement: ExecutedStatement) => {
      return statement.parameters[0];
    },
  );
}

// The rows an INSERT bound, as column -> value, in the order they were bound.
function rowsOf(statement: ExecutedStatement): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (
    let start: number = 0;
    start < statement.parameters.length;
    start += RUN_COLUMNS.length
  ) {
    const row: Record<string, unknown> = {};

    RUN_COLUMNS.forEach((column: string, index: number) => {
      row[column] = statement.parameters[start + index];
    });

    rows.push(row);
  }

  return rows;
}

function insertedRuns(): Array<Record<string, unknown>> {
  return statementsContaining(
    'INSERT INTO "SecurityEventConnectionRun"',
  ).flatMap((statement: ExecutedStatement) => {
    return rowsOf(statement);
  });
}

function everythingLogged(): string {
  return [
    mockedLogger.debug,
    mockedLogger.info,
    mockedLogger.warn,
    mockedLogger.error,
  ]
    .flatMap((mock: jest.Mock) => {
      return mock.mock.calls.flat();
    })
    .map((argument: unknown): string => {
      return argument instanceof Error ? argument.message : String(argument);
    })
    .join("\n");
}

function uniqueViolation(): Error {
  // The shape QueryFailedError has: pg's fields hoisted, and kept on driverError.
  return Object.assign(
    new Error(
      'duplicate key value violates unique constraint "PK_0f0e1fe86bb4ce002fb97c6761f"',
    ),
    { code: "23505", driverError: { code: "23505" } },
  );
}

// A QueryFailedError-shaped failure carrying the given SQLSTATE.
function postgresError(code: string, message: string = "query failed"): Error {
  return Object.assign(new Error(message), {
    code,
    driverError: { code, message },
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  database = {
    hasConnectionTable: true,
    hasRunTable: true,
    connections: [legacyConnection()],
    runsByConnection: {},
    statements: [],
    failWhen: null,
  };

  installFakeDatabase();

  service.findOneById.mockResolvedValue(null);
  service.create.mockImplementation(
    async (createBy: unknown): Promise<unknown> => {
      return (createBy as { data: SecurityEventConnection }).data;
    },
  );
  serviceClass.validateSettings.mockResolvedValue({});
  encryption.decrypt.mockImplementation(
    async (value: unknown): Promise<string> => {
      if (value === CIPHERTEXT) {
        return SERVICE_ACCOUNT_JSON;
      }

      if (value === SECOND_CIPHERTEXT) {
        return SECOND_SERVICE_ACCOUNT_JSON;
      }

      return "";
    },
  );
});

describe("MoveGoogleSecOpsConnectionsToSecurityEventConnections", () => {
  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    /*
     * The runner decides what to run by position. Pinned is the index this
     * migration was appended at, directly after the HashedString repair it
     * depends on for readable keys; appending later migrations leaves it
     * alone, inserting one above it does not.
     */
    const REGISTERED_POSITION: number = 111;

    test("was appended at the end of the list, right after RepairHashedStringEnvelopeSecrets", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(REGISTERED_POSITION);
      expect(instantiations[REGISTERED_POSITION - 1]).toBe(
        "RepairHashedStringEnvelopeSecrets",
      );
      expect(instantiations.length).toBeGreaterThan(REGISTERED_POSITION);
    });

    test("is registered exactly once", () => {
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(
        new MoveGoogleSecOpsConnectionsToSecurityEventConnections().name,
      ).toBe(MIGRATION_NAME);
    });

    test("is a Postgres migration, so it also runs on clustered ClickHouse installs", () => {
      expect(
        new MoveGoogleSecOpsConnectionsToSecurityEventConnections().runsInClusterMode(),
      ).toBe(true);
    });

    test("rollback is a no-op: the legacy rows were never removed", async () => {
      await expect(
        new MoveGoogleSecOpsConnectionsToSecurityEventConnections().rollback(),
      ).resolves.toBeUndefined();
      expect(database.statements).toEqual([]);
    });
  });

  describe("finding the legacy tables", () => {
    test("probes both legacy tables with to_regclass before reading anything", async () => {
      await runMigration();

      const probe: ExecutedStatement = database.statements[0]!;

      expect(probe.sql).toContain(`to_regclass('"GoogleSecOpsConnection"')`);
      expect(probe.sql).toContain(`to_regclass('"GoogleSecOpsConnectionRun"')`);
      expect(probe.sql).toContain('AS "hasConnectionTable"');
      expect(probe.sql).toContain('AS "hasRunTable"');
    });

    test("returns quietly, touching nothing, when the legacy connection table does not exist", async () => {
      database.hasConnectionTable = false;
      database.hasRunTable = false;

      await expect(runMigration()).resolves.toBeUndefined();

      expect(database.statements).toHaveLength(1);
      expect(service.findOneById).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(mockedLogger.error).not.toHaveBeenCalled();
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });

    test("returns quietly when the table exists but holds no connections", async () => {
      database.connections = [];

      await runMigration();

      expect(service.create).not.toHaveBeenCalled();
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });

    test("still moves connections when the run table is missing, without reading or writing runs", async () => {
      database.hasRunTable = false;
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];

      await runMigration();

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(disabledConnectionIds()).toEqual([CONNECTION_ID]);
      expect(statementsContaining('FROM "GoogleSecOpsConnectionRun"')).toEqual(
        [],
      );
      expect(
        statementsContaining('INSERT INTO "SecurityEventConnectionRun"'),
      ).toEqual([]);
    });

    test("reads only live connections, in a stable order", async () => {
      await runMigration();

      const read: Array<ExecutedStatement> = statementsContaining(
        'FROM "GoogleSecOpsConnection" ',
      );

      expect(read).toHaveLength(1);
      expect(read[0]!.sql).toContain('WHERE "deletedAt" IS NULL');
      expect(read[0]!.sql).toContain('ORDER BY "_id"');

      for (const column of [
        "_id",
        "createdAt",
        "updatedAt",
        "projectId",
        "name",
        "region",
        "instanceResourceName",
        "serviceAccountJson",
        "isEnabled",
        "pollIntervalInMinutes",
        "includeNonAlertingDetections",
        "lastSuccessfulPollAt",
        "lastEventIngestedAt",
        "lastPollResult",
        "lastPolledAt",
        "cursor",
        "lastError",
        "createdByUserId",
        "deletedByUserId",
      ]) {
        expect(read[0]!.sql).toContain(`"${column}"`);
      }
    });
  });

  describe("the copied connection", () => {
    test("maps every column of the legacy row", async () => {
      database.connections = [
        legacyConnection({
          lastError: "Google SecOps alerts fetch failed with HTTP 500.",
          deletedByUserId: DELETER_ID,
        }),
      ];

      await runMigration();

      expect(service.create).toHaveBeenCalledTimes(1);

      const created: SecurityEventConnection = createdConnections()[0]!;

      expect(created).toBeInstanceOf(SecurityEventConnection);
      expect(created.id?.toString()).toBe(CONNECTION_ID);
      expect(created.createdAt).toEqual(new Date("2026-03-01T10:00:00.000Z"));
      expect(created.updatedAt).toEqual(new Date("2026-09-14T10:01:00.000Z"));
      expect(created.projectId?.toString()).toBe(PROJECT_ID);
      expect(created.name).toBe("Chronicle production");
      expect(created.description).toBeUndefined();
      expect(created.provider).toBe(
        SecurityEventConnectorProvider.GoogleSecOps,
      );
      expect(created.provider).toBe("google-secops");
      expect(created.config).toEqual({
        region: "eu",
        instanceResourceName:
          "projects/acme-secops/locations/eu/instances/0f1e2d3c-instance",
      });
      expect(created.isEnabled).toBe(true);
      expect(created.pollIntervalInMinutes).toBe(15);
      expect(created.alertingOnly).toBe(true);
      expect(created.cursor).toBe("2026-09-14T10:00:00.000Z");
      expect(created.lastPolledAt).toEqual(
        new Date("2026-09-14T10:00:05.000Z"),
      );
      expect(created.lastSuccessfulPollAt).toEqual(
        new Date("2026-09-14T10:01:00.000Z"),
      );
      expect(created.lastEventIngestedAt).toEqual(
        new Date("2026-09-14T09:55:00.000Z"),
      );
      expect(created.lastError).toBe(
        "Google SecOps alerts fetch failed with HTTP 500.",
      );
      expect(created.createdByUserId?.toString()).toBe(USER_ID);
      expect(created.deletedByUserId?.toString()).toBe(DELETER_ID);
      expect(created.lastPollResult).toEqual(
        transformLegacyLastPollResult(
          legacyPollResult(),
          "2026-09-14T10:00:00.000Z",
        ),
      );
      expect(created.lastPollResult?.["provider"]).toBe("google-secops");
    });

    test("is created as root with hooks off, so today's stricter rules cannot drop it", async () => {
      await runMigration();

      expect(service.create).toHaveBeenCalledWith({
        data: expect.any(SecurityEventConnection),
        props: { isRoot: true, ignoreHooks: true },
      });
    });

    test("accepts timestamps the driver hands back as strings", async () => {
      database.connections = [
        legacyConnection({
          createdAt: "2026-03-01T10:00:00.000Z",
          lastPolledAt: "2026-09-14T10:00:05.000Z",
          lastSuccessfulPollAt: null,
          lastEventIngestedAt: "not a date",
        }),
      ];

      await runMigration();

      const created: SecurityEventConnection = createdConnections()[0]!;

      expect(created.createdAt).toEqual(new Date("2026-03-01T10:00:00.000Z"));
      expect(created.lastPolledAt).toEqual(
        new Date("2026-09-14T10:00:05.000Z"),
      );
      expect(created.lastSuccessfulPollAt).toBeUndefined();
      expect(created.lastEventIngestedAt).toBeUndefined();
    });

    test("leaves never-set bookkeeping unset rather than inventing values", async () => {
      database.connections = [
        legacyConnection({
          cursor: null,
          lastPolledAt: null,
          lastSuccessfulPollAt: null,
          lastEventIngestedAt: null,
          lastPollResult: null,
          lastError: null,
          createdByUserId: null,
          pollIntervalInMinutes: null,
        }),
      ];

      await runMigration();

      const created: SecurityEventConnection = createdConnections()[0]!;

      expect(created.cursor).toBeUndefined();
      expect(created.lastPolledAt).toBeUndefined();
      expect(created.lastSuccessfulPollAt).toBeUndefined();
      expect(created.lastEventIngestedAt).toBeUndefined();
      expect(created.lastPollResult).toBeUndefined();
      expect(created.lastError).toBeUndefined();
      expect(created.createdByUserId).toBeUndefined();
      expect(created.pollIntervalInMinutes).toBeUndefined();
    });

    test("a disabled legacy connection stays disabled", async () => {
      database.connections = [legacyConnection({ isEnabled: false })];

      await runMigration();

      expect(createdConnections()[0]!.isEnabled).toBe(false);
    });

    test.each<[string, boolean | null, boolean]>([
      ["alerts only (the default)", false, true],
      ["alerts and detections", true, false],
      ["an unset scope, read as the default", null, true],
    ])(
      "alertingOnly is the inverse of includeNonAlertingDetections: %s",
      async (
        _label: string,
        includeNonAlertingDetections: boolean | null,
        alertingOnly: boolean,
      ) => {
        database.connections = [
          legacyConnection({ includeNonAlertingDetections }),
        ];

        await runMigration();

        expect(createdConnections()[0]!.alertingOnly).toBe(alertingOnly);
        expect(serviceClass.validateSettings).toHaveBeenCalledWith(
          expect.objectContaining({ alertingOnly }),
        );
      },
    );
  });

  describe("the service account key", () => {
    test("is re-encrypted as one JSON STRING holding exactly the decrypted key", async () => {
      await runMigration();

      expect(encryption.decrypt).toHaveBeenCalledWith(CIPHERTEXT);

      const secrets: unknown = createdConnections()[0]!.secrets;

      /*
       * An object here would be encrypted key by key on this hook-free
       * create and could never be read back.
       */
      expect(typeof secrets).toBe("string");

      const parsed: JSONObject = JSON.parse(secrets as string) as JSONObject;

      expect(Object.keys(parsed)).toEqual(["serviceAccountJson"]);
      expect(parsed["serviceAccountJson"]).toBe(SERVICE_ACCOUNT_JSON);
      expect(typeof parsed["serviceAccountJson"]).toBe("string");
    });

    test("unwraps a HashedString envelope before decrypting", async () => {
      database.connections = [
        legacyConnection({
          serviceAccountJson: JSON.stringify({
            _type: "HashedString",
            value: CIPHERTEXT,
          }),
        }),
      ];

      await runMigration();

      expect(encryption.decrypt).toHaveBeenCalledWith(CIPHERTEXT);
      expect(service.create).toHaveBeenCalledTimes(1);
    });

    test("is validated against today's rules with the decrypted key, before the create", async () => {
      await runMigration();

      expect(serviceClass.validateSettings).toHaveBeenCalledWith({
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        config: {
          region: "eu",
          instanceResourceName:
            "projects/acme-secops/locations/eu/instances/0f1e2d3c-instance",
        },
        secrets: { serviceAccountJson: SERVICE_ACCOUNT_JSON },
        alertingOnly: true,
        requireRequiredSecrets: true,
      });
      expect(
        serviceClass.validateSettings.mock.invocationCallOrder[0],
      ).toBeLessThan(service.create.mock.invocationCallOrder[0]!);
    });

    test("a connection that fails today's validation is still copied, with a warning naming it", async () => {
      serviceClass.validateSettings.mockRejectedValue(
        new BadDataException(
          "Region eu does not match the location in the instance resource name.",
        ),
      );

      await runMigration();

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(disabledConnectionIds()).toEqual([CONNECTION_ID]);
      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);

      const warning: string = String(mockedLogger.warn.mock.calls[0]![0]);

      expect(warning).toContain(CONNECTION_ID);
      expect(warning).toContain("does not match the location");
      expect(mockedLogger.error).not.toHaveBeenCalled();
    });

    test.each<[string, (value: unknown) => Promise<string>]>([
      [
        "decrypts to nothing (a different ENCRYPTION_SECRET)",
        async (): Promise<string> => {
          return "";
        },
      ],
      [
        "decrypts to whitespace",
        async (): Promise<string> => {
          return "  \n";
        },
      ],
      [
        "throws while decrypting",
        async (): Promise<string> => {
          throw new Error("Malformed UTF-8 data");
        },
      ],
    ])(
      "a key that %s skips that connection, and the next one is still moved",
      async (_label: string, decrypt: (value: unknown) => Promise<string>) => {
        database.connections = [
          legacyConnection(),
          legacyConnection({
            _id: SECOND_CONNECTION_ID,
            serviceAccountJson: SECOND_CIPHERTEXT,
          }),
        ];
        encryption.decrypt.mockImplementation(
          async (value: unknown): Promise<string> => {
            if (value === SECOND_CIPHERTEXT) {
              return SECOND_SERVICE_ACCOUNT_JSON;
            }

            return decrypt(value);
          },
        );
        database.runsByConnection[CONNECTION_ID] = [legacyRun()];

        await expect(runMigration()).resolves.toBeUndefined();

        // Never a connection with an empty key.
        expect(
          createdConnections().map((connection: SecurityEventConnection) => {
            return connection.id?.toString();
          }),
        ).toEqual([SECOND_CONNECTION_ID]);

        // The skipped one is left exactly as it was, still enabled.
        expect(disabledConnectionIds()).toEqual([SECOND_CONNECTION_ID]);
        expect(insertedRuns()).toEqual([]);

        expect(mockedLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(
            `skipped Google SecOps connection ${CONNECTION_ID}`,
          ),
        );
      },
    );

    test("a row with no stored key is skipped without calling decrypt", async () => {
      database.connections = [legacyConnection({ serviceAccountJson: null })];

      await runMigration();

      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(disabledConnectionIds()).toEqual([]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("has no stored service account key"),
      );
    });

    test("never writes the key, or any part of it, to the log", async () => {
      database.connections = [
        legacyConnection(),
        legacyConnection({
          _id: SECOND_CONNECTION_ID,
          serviceAccountJson: SECOND_CIPHERTEXT,
        }),
      ];
      serviceClass.validateSettings.mockRejectedValue(
        new BadDataException("Service account JSON is not valid JSON."),
      );
      service.create.mockRejectedValueOnce(
        postgresError("40P01", "deadlock detected"),
      );

      let thrown: string = "";

      try {
        await runMigration();
      } catch (err) {
        thrown = err instanceof Error ? err.message : String(err);
      }

      // The runner records this message, and the health page shows it.
      expect(thrown).toContain(CONNECTION_ID);

      const logged: string = `${everythingLogged()}\n${thrown}`;

      expect(logged).not.toContain("PRIVATE KEY");
      expect(logged).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
      expect(logged).not.toContain("SECONDKEYBODY");
      expect(logged).not.toContain(CIPHERTEXT);
    });
  });

  describe("idempotency", () => {
    test("a connection that was already copied is not created again, but its runs are copied and the legacy row disabled", async () => {
      service.findOneById.mockResolvedValue(new SecurityEventConnection());
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];

      await runMigration();

      expect(service.findOneById).toHaveBeenCalledWith({
        id: expect.anything(),
        select: { _id: true },
        props: { isRoot: true },
      });
      expect(
        (
          service.findOneById.mock.calls[0]![0] as {
            id: { toString: () => string };
          }
        ).id.toString(),
      ).toBe(CONNECTION_ID);
      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(serviceClass.validateSettings).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(insertedRuns()).toHaveLength(1);
      expect(disabledConnectionIds()).toEqual([CONNECTION_ID]);
    });

    test.each<[string, () => Error]>([
      ["as the driver raises it", uniqueViolation],
      [
        "after DatabaseService translated it",
        (): Error => {
          return Object.assign(
            new BadDataException("A record with this value already exists."),
            { postgresErrorCode: "23505" },
          );
        },
      ],
    ])(
      "a unique violation from a racing runner (%s) counts as already copied",
      async (_label: string, makeError: () => Error) => {
        service.create.mockRejectedValue(makeError());
        database.runsByConnection[CONNECTION_ID] = [legacyRun()];

        await expect(runMigration()).resolves.toBeUndefined();

        expect(mockedLogger.error).not.toHaveBeenCalled();
        expect(insertedRuns()).toHaveLength(1);
        expect(disabledConnectionIds()).toEqual([CONNECTION_ID]);
        expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
          "0 Google SecOps connection(s) copied to Security Event Connections, 1 already copied",
        );
      },
    );

    test("the legacy row is disabled only after its copy exists", async () => {
      await runMigration();

      const disable: number = database.statements.findIndex(
        (statement: ExecutedStatement) => {
          return statement.sql.startsWith('UPDATE "GoogleSecOpsConnection"');
        },
      );

      expect(disable).toBeGreaterThan(-1);
      expect(database.statements[disable]!.sql).toBe(
        'UPDATE "GoogleSecOpsConnection" SET "isEnabled" = false WHERE "_id" = $1',
      );
      expect(database.statements[disable]!.parameters).toEqual([CONNECTION_ID]);

      /*
       * Each query call records exactly one statement, so the statement's
       * index is its call's index. Disabling first would leave a window with
       * neither copy polling, and a failed create would strand the customer
       * with a disabled legacy row and nothing else.
       */
      const query: jest.Mock = (
        service.getRepository.mock.results[0]!.value as {
          manager: { query: jest.Mock };
        }
      ).manager.query;

      expect(service.create).toHaveBeenCalledTimes(1);
      expect(query.mock.invocationCallOrder[disable]!).toBeGreaterThan(
        service.create.mock.invocationCallOrder[0]!,
      );
    });
  });

  /*
   * migrate() throwing is how this migration gets retried: the runner does
   * not record a migration that threw as executed. Recording one that left a
   * connection behind is permanent, and that connection silently stops
   * importing. Throwing on a failure that repeats on every retry halts every
   * later data migration for good. So: transient -> throw after trying every
   * connection; deterministic -> log and carry on.
   */
  describe("failures: every connection is attempted, and only a failure a retry can fix is thrown", () => {
    test("a transient create failure (deadlock) still moves the next connection, then rejects naming the one left behind", async () => {
      database.connections = [
        legacyConnection(),
        legacyConnection({
          _id: SECOND_CONNECTION_ID,
          serviceAccountJson: SECOND_CIPHERTEXT,
        }),
      ];
      service.create.mockRejectedValueOnce(postgresError("40P01"));

      const outcome: Promise<void> = runMigration();

      await expect(outcome).rejects.toThrow(CONNECTION_ID);
      await expect(outcome).rejects.toThrow("transient database error");
      await expect(outcome).rejects.not.toThrow(SECOND_CONNECTION_ID);

      expect(service.create).toHaveBeenCalledTimes(2);
      expect(
        createdConnections().map((connection: SecurityEventConnection) => {
          return connection.id?.toString();
        }),
      ).toEqual([CONNECTION_ID, SECOND_CONNECTION_ID]);

      // The one that failed keeps polling from the legacy row until the retry.
      expect(disabledConnectionIds()).toEqual([SECOND_CONNECTION_ID]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `could not move Google SecOps connection ${CONNECTION_ID} because of a transient database error`,
        ),
      );
      expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
        "1 Google SecOps connection(s) copied to Security Event Connections, 0 already copied, 0 skipped because no usable service account key could be read, 1 failed.",
      );
    });

    test("the retry after a transient failure finishes the move without copying anything twice", async () => {
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];
      service.create.mockRejectedValueOnce(postgresError("57P01"));

      await expect(runMigration()).rejects.toThrow(CONNECTION_ID);
      expect(disabledConnectionIds()).toEqual([]);
      expect(insertedRuns()).toEqual([]);

      // The next migrate Job or boot runs it again, this time without a failure.
      await expect(runMigration()).resolves.toBeUndefined();

      expect(service.create).toHaveBeenCalledTimes(2);
      expect(disabledConnectionIds()).toEqual([CONNECTION_ID]);
      expect(insertedRuns()).toHaveLength(1);
    });

    test("a deterministic create failure (BadDataException) is logged, leaves that legacy row enabled, moves the next connection, and resolves", async () => {
      database.connections = [
        legacyConnection(),
        legacyConnection({
          _id: SECOND_CONNECTION_ID,
          serviceAccountJson: SECOND_CIPHERTEXT,
        }),
      ];
      service.create.mockRejectedValueOnce(
        new BadDataException("projectId is required"),
      );

      await expect(runMigration()).resolves.toBeUndefined();

      expect(service.create).toHaveBeenCalledTimes(2);
      expect(disabledConnectionIds()).toEqual([SECOND_CONNECTION_ID]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        `MoveGoogleSecOpsConnectionsToSecurityEventConnections: could not move Google SecOps connection ${CONNECTION_ID}; it stays in the GoogleSecOpsConnection table:`,
      );
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.any(BadDataException),
      );
      expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
        "1 Google SecOps connection(s) copied to Security Event Connections, 0 already copied, 0 skipped because no usable service account key could be read, 1 failed.",
      );
    });

    test("a transient existence check failure is isolated to its connection, then rejects naming it", async () => {
      database.connections = [
        legacyConnection(),
        legacyConnection({
          _id: SECOND_CONNECTION_ID,
          serviceAccountJson: SECOND_CIPHERTEXT,
        }),
      ];
      service.findOneById.mockRejectedValueOnce(
        new Error("Connection terminated unexpectedly"),
      );

      await expect(runMigration()).rejects.toThrow(CONNECTION_ID);

      expect(
        createdConnections().map((connection: SecurityEventConnection) => {
          return connection.id?.toString();
        }),
      ).toEqual([SECOND_CONNECTION_ID]);
      expect(disabledConnectionIds()).toEqual([SECOND_CONNECTION_ID]);
    });

    test("a transient failure disabling the legacy row rejects, though the copy was created", async () => {
      database.failWhen = (statement: ExecutedStatement): Error | null => {
        return statement.sql.startsWith('UPDATE "GoogleSecOpsConnection"')
          ? postgresError("08006")
          : null;
      };

      await expect(runMigration()).rejects.toThrow(CONNECTION_ID);

      // The retry finds the copy, so it only disables and copies runs.
      expect(service.create).toHaveBeenCalledTimes(1);
    });

    test("a deterministic run history failure is logged, but the connection stays copied and disabled, the next one is moved, and it resolves", async () => {
      database.connections = [
        legacyConnection(),
        legacyConnection({
          _id: SECOND_CONNECTION_ID,
          serviceAccountJson: SECOND_CIPHERTEXT,
        }),
      ];
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];
      database.runsByConnection[SECOND_CONNECTION_ID] = [
        legacyRun({ _id: runIdFor(1) }),
      ];
      database.failWhen = (statement: ExecutedStatement): Error | null => {
        return statement.sql.startsWith(
          'INSERT INTO "SecurityEventConnectionRun"',
        ) &&
          rowsOf(statement)[0]!["securityEventConnectionId"] === CONNECTION_ID
          ? postgresError("22P02", "invalid input syntax for type json")
          : null;
      };

      await expect(runMigration()).resolves.toBeUndefined();

      expect(service.create).toHaveBeenCalledTimes(2);
      expect(disabledConnectionIds()).toEqual([
        CONNECTION_ID,
        SECOND_CONNECTION_ID,
      ]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        `MoveGoogleSecOpsConnectionsToSecurityEventConnections: copied Google SecOps connection ${CONNECTION_ID}, but not its run history:`,
      );
      expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
        "2 Google SecOps connection(s) copied to Security Event Connections, 0 already copied, 0 skipped because no usable service account key could be read, 0 failed. 1 run(s) of history carried over",
      );
    });

    test("a transient run history failure counts the connection as copied, still moves the next one, then rejects naming it so its runs are copied on the retry", async () => {
      database.connections = [
        legacyConnection(),
        legacyConnection({
          _id: SECOND_CONNECTION_ID,
          serviceAccountJson: SECOND_CIPHERTEXT,
        }),
      ];
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];
      database.runsByConnection[SECOND_CONNECTION_ID] = [
        legacyRun({ _id: runIdFor(1) }),
      ];
      database.failWhen = (statement: ExecutedStatement): Error | null => {
        return statement.sql.startsWith(
          'INSERT INTO "SecurityEventConnectionRun"',
        ) &&
          rowsOf(statement)[0]!["securityEventConnectionId"] === CONNECTION_ID
          ? postgresError(
              "57014",
              "canceling statement due to statement timeout",
            )
          : null;
      };

      const outcome: Promise<void> = runMigration();

      await expect(outcome).rejects.toThrow(
        `the run history of Google SecOps connection(s) ${CONNECTION_ID} was not fully copied`,
      );
      await expect(outcome).rejects.not.toThrow(SECOND_CONNECTION_ID);

      expect(service.create).toHaveBeenCalledTimes(2);
      expect(disabledConnectionIds()).toEqual([
        CONNECTION_ID,
        SECOND_CONNECTION_ID,
      ]);
      // Attempted for both; the fake records a statement before failing it.
      expect(
        insertedRuns().map((row: Record<string, unknown>) => {
          return row["_id"];
        }),
      ).toEqual([RUN_ID, runIdFor(1)]);
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          `copied Google SecOps connection ${CONNECTION_ID}, but not its run history`,
        ),
      );
      expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
        "2 Google SecOps connection(s) copied to Security Event Connections, 0 already copied, 0 skipped because no usable service account key could be read, 0 failed.",
      );

      /*
       * The retry: both copies exist, so nothing is created again, and each
       * connection's runs are offered again with ON CONFLICT DO NOTHING,
       * which skips the ones the first attempt already inserted.
       */
      database.failWhen = null;
      database.statements = [];
      service.findOneById.mockResolvedValue(new SecurityEventConnection());

      await expect(runMigration()).resolves.toBeUndefined();

      expect(service.create).toHaveBeenCalledTimes(2);
      expect(disabledConnectionIds()).toEqual([
        CONNECTION_ID,
        SECOND_CONNECTION_ID,
      ]);

      const retried: Array<ExecutedStatement> = statementsContaining(
        'INSERT INTO "SecurityEventConnectionRun"',
      );

      expect(
        retried.map((statement: ExecutedStatement): unknown => {
          return rowsOf(statement)[0]!["_id"];
        }),
      ).toEqual([RUN_ID, runIdFor(1)]);

      for (const statement of retried) {
        expect(statement.sql.endsWith('ON CONFLICT ("_id") DO NOTHING')).toBe(
          true,
        );
      }
    });

    test("a skipped connection (no usable key) never makes it reject", async () => {
      encryption.decrypt.mockResolvedValue("");

      await expect(runMigration()).resolves.toBeUndefined();

      expect(service.create).not.toHaveBeenCalled();
    });

    test("a failing table probe is logged and rethrown, and nothing is created", async () => {
      database.failWhen = (statement: ExecutedStatement): Error | null => {
        return statement.sql.includes("to_regclass")
          ? new Error("Connection terminated unexpectedly")
          : null;
      };

      await expect(runMigration()).rejects.toThrow(
        "Connection terminated unexpectedly",
      );

      expect(service.findOneById).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(mockedLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "could not read the Google SecOps connections to move",
        ),
      );
    });

    test("a failing connection read is logged and rethrown even when it is not transient, and nothing is created", async () => {
      database.failWhen = (statement: ExecutedStatement): Error | null => {
        return statement.sql.includes('FROM "GoogleSecOpsConnection" ')
          ? new Error("permission denied for table GoogleSecOpsConnection")
          : null;
      };

      await expect(runMigration()).rejects.toThrow(
        "permission denied for table GoogleSecOpsConnection",
      );

      expect(service.create).not.toHaveBeenCalled();
      expect(disabledConnectionIds()).toEqual([]);
      expect(mockedLogger.error).toHaveBeenCalledTimes(2);
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });

    test("a missing repository is logged and rethrown", async () => {
      service.getRepository.mockImplementation(() => {
        throw new Error("DataSource is not initialized");
      });

      await expect(runMigration()).rejects.toThrow(
        "DataSource is not initialized",
      );

      expect(service.create).not.toHaveBeenCalled();
      expect(mockedLogger.error).toHaveBeenCalled();
    });
  });

  describe("run history", () => {
    test("reads the most recent runs of this connection only, capped, newest first", async () => {
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];

      await runMigration();

      const read: Array<ExecutedStatement> = statementsContaining(
        'FROM "GoogleSecOpsConnectionRun"',
      );

      expect(read).toHaveLength(1);
      expect(read[0]!.sql).toContain('WHERE "googleSecOpsConnectionId" = $1');
      expect(read[0]!.sql).toContain('"deletedAt" IS NULL');
      expect(read[0]!.sql).toContain('ORDER BY "createdAt" DESC, "_id" DESC');
      expect(read[0]!.sql).toContain("LIMIT $2");
      expect(read[0]!.parameters).toEqual([CONNECTION_ID, 500]);
      expect(RUN_HISTORY_COPY_LIMIT).toBe(500);
    });

    test("inserts with ON CONFLICT DO NOTHING, supplying version, into the copied connection", async () => {
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];

      await runMigration();

      const inserts: Array<ExecutedStatement> = statementsContaining(
        'INSERT INTO "SecurityEventConnectionRun"',
      );

      expect(inserts).toHaveLength(1);
      expect(inserts[0]!.sql).toBe(
        'INSERT INTO "SecurityEventConnectionRun" ("_id", "createdAt", "updatedAt", "version", "projectId", "securityEventConnectionId", "requestedByUserId", "type", "status", "startedAt", "completedAt", "request", "result", "error") VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13) ON CONFLICT ("_id") DO NOTHING',
      );

      const row: Record<string, unknown> = rowsOf(inserts[0]!)[0]!;

      expect(row).toEqual({
        _id: RUN_ID,
        createdAt: new Date("2026-09-14T10:00:00.000Z"),
        updatedAt: new Date("2026-09-14T10:01:00.000Z"),
        projectId: PROJECT_ID,
        securityEventConnectionId: CONNECTION_ID,
        requestedByUserId: USER_ID,
        type: "poll",
        status: "success",
        startedAt: new Date("2026-09-14T10:00:05.000Z"),
        completedAt: new Date("2026-09-14T10:01:00.000Z"),
        request: JSON.stringify({ type: "poll", scheduled: true }),
        result: JSON.stringify(transformLegacyRunResult(legacyPollResult())),
        error: "",
      });
    });

    test("copies at most 500 runs, in batches of 50, one statement per batch", async () => {
      database.runsByConnection[CONNECTION_ID] = Array.from(
        { length: 620 },
        (_value: unknown, index: number): LegacyGoogleSecOpsRunRow => {
          return legacyRun({ _id: runIdFor(index) });
        },
      );

      await runMigration();

      const inserts: Array<ExecutedStatement> = statementsContaining(
        'INSERT INTO "SecurityEventConnectionRun"',
      );

      expect(RUN_INSERT_BATCH_SIZE).toBe(50);
      expect(inserts).toHaveLength(10);

      for (const insert of inserts) {
        expect(insert.parameters).toHaveLength(50 * RUN_COLUMNS.length);
        expect(insert.sql.match(/ON CONFLICT/g)).toHaveLength(1);

        // Every bound value has exactly one placeholder, in order.
        const placeholders: Array<number> = Array.from(
          insert.sql.matchAll(/\$(\d+)/g),
        ).map((match: RegExpMatchArray): number => {
          return Number(match[1]);
        });

        expect(placeholders).toEqual(
          Array.from(
            { length: insert.parameters.length },
            (_value: unknown, index: number): number => {
              return index + 1;
            },
          ),
        );
      }

      const copiedIds: Array<unknown> = insertedRuns().map(
        (row: Record<string, unknown>) => {
          return row["_id"];
        },
      );

      expect(copiedIds).toHaveLength(500);
      expect(new Set(copiedIds).size).toBe(500);
      expect(copiedIds[0]).toBe(runIdFor(0));
      expect(copiedIds[499]).toBe(runIdFor(499));
      expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
        "500 run(s) of history carried over (at most the 500 most recent per connection)",
      );
    });

    test("a remainder smaller than a batch is its own statement", async () => {
      database.runsByConnection[CONNECTION_ID] = Array.from(
        { length: 53 },
        (_value: unknown, index: number): LegacyGoogleSecOpsRunRow => {
          return legacyRun({ _id: runIdFor(index) });
        },
      );

      await runMigration();

      expect(
        statementsContaining('INSERT INTO "SecurityEventConnectionRun"').map(
          (statement: ExecutedStatement) => {
            return rowsOf(statement).length;
          },
        ),
      ).toEqual([50, 3]);
    });

    test("a connection with no runs issues no insert", async () => {
      await runMigration();

      expect(
        statementsContaining('INSERT INTO "SecurityEventConnectionRun"'),
      ).toEqual([]);
    });

    test.each(["queued", "running"])(
      "a %s run may still be finished by an old worker, so it is copied as failed with a message that claims no outcome",
      async (status: string) => {
        database.runsByConnection[CONNECTION_ID] = [
          legacyRun({
            status,
            completedAt: null,
            result: null,
            error: "",
          }),
        ];
        const before: number = Date.now();

        await runMigration();

        const row: Record<string, unknown> = insertedRuns()[0]!;

        expect(row["status"]).toBe("failed");
        expect(row["error"]).toBe(INTERRUPTED_RUN_ERROR);
        expect(INTERRUPTED_RUN_ERROR).toBe(
          "This operation was still in progress when Google SecOps moved to Security Event Connections, so its outcome was not recorded here. Check the imported security events before running it again.",
        );

        /*
         * An old worker can still finish this run and import its events, so
         * the history must not say it was interrupted, nor ask for a re-run
         * that could import the same window a second time.
         */
        expect(String(row["error"])).not.toContain("Interrupted");
        expect(String(row["error"])).not.toContain("Run it again");
        expect(row["completedAt"]).toBeInstanceOf(Date);
        expect((row["completedAt"] as Date).getTime()).toBeGreaterThanOrEqual(
          before,
        );
        expect((row["completedAt"] as Date).getTime()).toBeLessThanOrEqual(
          Date.now(),
        );
        expect(row["startedAt"]).toEqual(new Date("2026-09-14T10:00:05.000Z"));
        expect(row["result"]).toBeNull();
      },
    );

    test.each(["success", "empty", "partial", "failed"])(
      "a finished %s run keeps its status, completion time and error",
      async (status: string) => {
        database.runsByConnection[CONNECTION_ID] = [
          legacyRun({
            status,
            error: status === "failed" ? "Read permission denied" : "",
          }),
        ];

        await runMigration();

        const row: Record<string, unknown> = insertedRuns()[0]!;

        expect(row["status"]).toBe(status);
        expect(row["completedAt"]).toEqual(
          new Date("2026-09-14T10:01:00.000Z"),
        );
        expect(row["error"]).toBe(
          status === "failed" ? "Read permission denied" : "",
        );
      },
    );

    test("a synchronous test run keeps its report as it was, and its request", async () => {
      database.runsByConnection[CONNECTION_ID] = [
        legacyRun({
          type: "test",
          request: { type: "test", synchronous: true },
          result: legacyTestReport(),
          requestedByUserId: null,
        }),
      ];

      await runMigration();

      const row: Record<string, unknown> = insertedRuns()[0]!;

      expect(row["type"]).toBe("test");
      expect(row["request"]).toBe(
        JSON.stringify({ type: "test", synchronous: true }),
      );
      expect(JSON.parse(row["result"] as string)).toEqual(legacyTestReport());
      expect(row["requestedByUserId"]).toBeNull();
    });

    test("a run whose updatedAt is missing falls back to its createdAt (the column is NOT NULL)", async () => {
      database.runsByConnection[CONNECTION_ID] = [
        legacyRun({ updatedAt: null, request: null }),
      ];

      await runMigration();

      const row: Record<string, unknown> = insertedRuns()[0]!;

      expect(row["updatedAt"]).toEqual(new Date("2026-09-14T10:00:00.000Z"));
      expect(row["request"]).toBeNull();
    });

    test("runs of a skipped connection are never read", async () => {
      encryption.decrypt.mockResolvedValue("");
      database.runsByConnection[CONNECTION_ID] = [legacyRun()];

      await runMigration();

      expect(statementsContaining('FROM "GoogleSecOpsConnectionRun"')).toEqual(
        [],
      );
    });
  });

  describe("buildRunHistoryInsert", () => {
    test("binds each run's values in column order and attaches them to the given connection and project", () => {
      const insert: RunHistoryInsert = buildRunHistoryInsert({
        runs: [
          legacyRun(),
          legacyRun({ _id: runIdFor(2), status: "queued" }),
          legacyRun({
            _id: runIdFor(3),
            status: "running",
            completedAt: null,
            error: null,
          }),
        ],
        connectionId: CONNECTION_ID,
        projectId: PROJECT_ID,
        migratedAt: new Date("2026-09-15T08:00:00.000Z"),
      });

      expect(insert.sql).toContain(
        "VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13), ($14, $15, $16, 1, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25::jsonb, $26)",
      );

      const rows: Array<Record<string, unknown>> = rowsOf({
        sql: insert.sql,
        parameters: insert.parameters,
      });

      expect(rows).toHaveLength(3);
      expect(rows[0]!["status"]).toBe("success");
      expect(rows[0]!["error"]).toBe("");

      for (const inProgress of [rows[1]!, rows[2]!]) {
        expect(inProgress["status"]).toBe("failed");
        expect(inProgress["completedAt"]).toEqual(
          new Date("2026-09-15T08:00:00.000Z"),
        );
        expect(inProgress["error"]).toBe(INTERRUPTED_RUN_ERROR);
      }

      expect(rows[1]!["_id"]).toBe(runIdFor(2));
      expect(rows[2]!["_id"]).toBe(runIdFor(3));

      for (const value of insert.parameters) {
        expect(String(value)).not.toContain("Interrupted");
        expect(String(value)).not.toContain("Run it again");
      }

      for (const row of rows) {
        expect(row["securityEventConnectionId"]).toBe(CONNECTION_ID);
        expect(row["projectId"]).toBe(PROJECT_ID);
      }
    });
  });

  describe("isTransientDatabaseError", () => {
    test.each<[string]>([
      ["08000"],
      ["08001"],
      ["08003"],
      ["08004"],
      ["08006"],
      ["08P01"],
      ["40001"],
      ["40P01"],
      ["57014"],
      ["57P01"],
      ["57P02"],
      ["57P03"],
      ["53300"],
      ["53400"],
    ])(
      "SQLSTATE %s is transient, on the error, on its driverError, or both",
      (code: string) => {
        expect(isTransientDatabaseError(postgresError(code))).toBe(true);
        expect(
          isTransientDatabaseError(
            Object.assign(new Error("failed"), { code }),
          ),
        ).toBe(true);
        expect(
          isTransientDatabaseError(
            Object.assign(new Error("failed"), { driverError: { code } }),
          ),
        ).toBe(true);
      },
    );

    test.each<[string]>([["ECONNRESET"], ["ETIMEDOUT"], ["ECONNREFUSED"]])(
      "socket code %s is transient",
      (code: string) => {
        expect(
          isTransientDatabaseError(
            Object.assign(new Error("socket error"), { code }),
          ),
        ).toBe(true);
      },
    );

    test.each<[string]>([
      ["Connection terminated unexpectedly"],
      ["Connection terminated due to connection timeout"],
      ["timeout exceeded when trying to connect"],
      ["read ECONNRESET"],
      ["connect ETIMEDOUT 10.0.0.5:5432"],
      ["connect ECONNREFUSED 127.0.0.1:5432"],
    ])(
      "the driver message %j is transient without any code",
      (message: string) => {
        expect(isTransientDatabaseError(new Error(message))).toBe(true);
        expect(
          isTransientDatabaseError(
            Object.assign(new Error("failed"), { driverError: { message } }),
          ),
        ).toBe(true);
      },
    );

    test.each<[string, unknown]>([
      ["a unique violation", postgresError("23505")],
      ["a foreign key violation", postgresError("23503")],
      ["invalid JSON input", postgresError("22P02")],
      ["an undefined table", postgresError("42P01")],
      [
        "a permission error",
        postgresError(
          "42501",
          "permission denied for table GoogleSecOpsConnection",
        ),
      ],
      [
        "a BadDataException, whose code is numeric",
        new BadDataException("projectId is required"),
      ],
      ["a numeric code", Object.assign(new Error("failed"), { code: 40001 })],
      [
        "a code that is only the class 08 prefix",
        Object.assign(new Error("failed"), { code: "08" }),
      ],
      [
        "a lower-case look-alike SQLSTATE",
        Object.assign(new Error("failed"), { code: "40p01" }),
      ],
      [
        "a message that is no driver or socket failure, with no SQLSTATE",
        new Error("deadlock detected"),
      ],
      ["an object with neither a code nor a message", {}],
      [
        "a driverError that is not an object",
        Object.assign(new Error("failed"), { driverError: "08006" }),
      ],
    ])("%s is not transient", (_label: string, error: unknown) => {
      expect(isTransientDatabaseError(error)).toBe(false);
    });

    test.each<[string, unknown]>([
      ["null", null],
      ["undefined", undefined],
      ["string", "Connection terminated unexpectedly"],
      ["number", 40001],
      ["boolean", true],
    ])("a thrown %s is not transient", (_label: string, error: unknown) => {
      expect(isTransientDatabaseError(error)).toBe(false);
    });

    test("never throws, even for a value whose fields throw when read", () => {
      const hostile: object = new Proxy(
        {},
        {
          get: (): never => {
            throw new Error("unreadable");
          },
        },
      );

      expect(isTransientDatabaseError(hostile)).toBe(false);
    });
  });

  describe("transformLegacyRunResult", () => {
    test("null and undefined stay null", () => {
      expect(transformLegacyRunResult(null)).toBeNull();
      expect(transformLegacyRunResult(undefined)).toBeNull();
    });

    test("a value that is not an object is left alone", () => {
      expect(transformLegacyRunResult("text")).toBe("text");
      expect(transformLegacyRunResult([1, 2])).toEqual([1, 2]);
    });

    test("a stored test report is kept exactly as it is", () => {
      const report: JSONObject = legacyTestReport();

      expect(isSecurityConnectorTestReport(report)).toBe(true);
      expect(transformLegacyRunResult(report)).toBe(report);
      expect(transformLegacyRunResult(report)).toEqual(legacyTestReport());
    });

    test.each<[string, JSONObject]>([
      ["no summary", { ...legacyTestReport(), summary: undefined as never }],
      ["no provider", { ...legacyTestReport(), provider: undefined as never }],
      [
        "an unkeyed check",
        {
          ...legacyTestReport(),
          checks: [{ name: "Read", status: "success" }],
        },
      ],
      ["no checks", { provider: "google-secops", summary: "ok" }],
    ])(
      "something with %s is not mistaken for a test report",
      (_label: string, value: JSONObject) => {
        expect(
          isSecurityConnectorTestReport(JSON.parse(JSON.stringify(value))),
        ).toBe(false);
      },
    );

    test("a poll result gets the provider and the legacy event attribute, and keeps every generic field", () => {
      const transformed: JSONObject = transformLegacyRunResult(
        legacyPollResult({ error: "partial read", eventTimeStart: "a" }),
      ) as JSONObject;

      expect(transformed["provider"]).toBe("google-secops");
      expect(transformed["eventAttributeKey"]).toBe(
        LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE,
      );
      expect(transformed["eventAttributeKey"]).toBe(
        "oneuptime.google_secops.connection_id",
      );

      for (const key of [
        "type",
        "runId",
        "status",
        "startedAt",
        "completedAt",
        "durationMs",
        "windowStart",
        "windowEnd",
        "fetchedCount",
        "ingestedCount",
        "duplicateCount",
        "rejectedCount",
        "failedCount",
        "complete",
        "requestCount",
        "warnings",
        "chunkMinutes",
        "nextChunkMinutes",
        "forcedAdvance",
        "error",
        "eventTimeStart",
      ]) {
        expect(transformed[key]).toEqual(
          legacyPollResult({ error: "partial read", eventTimeStart: "a" })[key],
        );
      }
    });

    test("moves the Google-only fields under providerDetails", () => {
      const transformed: JSONObject = transformLegacyRunResult(
        legacyPollResult({ includeNonAlertingDetections: true }),
      ) as JSONObject;

      expect(GOOGLE_SECOPS_PROVIDER_DETAIL_KEYS).toEqual([
        "includeNonAlertingDetections",
        "basis",
        "sourceCounts",
        "creationLag",
      ]);
      expect(transformed["providerDetails"]).toEqual({
        includeNonAlertingDetections: true,
        basis: "created-time",
        sourceCounts: {
          ruleDetections: 3,
          curatedDetections: 1,
          alertsView: 2,
        },
        creationLag: { measured: 4, lateCount: 1, maxLagMinutes: 42 },
      });

      for (const key of GOOGLE_SECOPS_PROVIDER_DETAIL_KEYS) {
        expect(Object.keys(transformed)).not.toContain(key);
      }
    });

    test("adds no providerDetails when there is nothing to put there", () => {
      const legacy: JSONObject = legacyPollResult();

      for (const key of GOOGLE_SECOPS_PROVIDER_DETAIL_KEYS) {
        delete legacy[key];
      }

      expect(
        Object.keys(transformLegacyRunResult(legacy) as JSONObject),
      ).not.toContain("providerDetails");
    });

    test("maps checks to keyed generic checks, so a failed step no longer renders as passed", () => {
      const transformed: JSONObject = transformLegacyRunResult(
        legacyPollResult(),
      ) as JSONObject;

      expect(transformed["checks"]).toEqual([
        {
          key: "read-rule-detections-by-created-time",
          name: "Read rule detections by created time",
          status: "pass",
          durationMs: 120,
          message: "Read 3 rule detections.",
        },
        {
          key: "read-curated-rule-detections-by-created-time",
          name: "Read curated rule detections by created time",
          status: "warn",
          durationMs: 80,
          message: "HTTP 403",
        },
        {
          key: "read-alerts-view-by-detection-time",
          name: "Read alerts view by detection time",
          status: "fail",
          durationMs: 30,
          message: "HTTP 500",
        },
      ]);
    });

    test("fills in what a malformed check is missing", () => {
      const transformed: JSONObject = transformLegacyRunResult(
        legacyPollResult({
          checks: [{ status: "success" }, "not a check"] as never,
        }),
      ) as JSONObject;

      expect(transformed["checks"]).toEqual([
        {
          key: "check-1",
          name: "",
          status: "pass",
          durationMs: 0,
          message: "",
        },
        "not a check",
      ]);
    });

    test.each<[unknown, string]>([
      ["success", "pass"],
      ["failed", "fail"],
      ["warn", "warn"],
      ["pass", "pass"],
      ["fail", "fail"],
      ["skip", "skip"],
      ["SUCCESS", "skip"],
      ["cancelled", "skip"],
      [undefined, "skip"],
      [1, "skip"],
    ])("check status %j becomes %s", (legacy: unknown, generic: string) => {
      expect(mapLegacyCheckStatus(legacy)).toBe(generic);
    });

    test.each<[string, string]>([
      [
        "Read rule detections by created time",
        "read-rule-detections-by-created-time",
      ],
      [
        "Read alerts view by detection time",
        "read-alerts-view-by-detection-time",
      ],
      ["  Authenticate with Google (JWT)  ", "authenticate-with-google-jwt"],
      ["", ""],
    ])("check name %j is keyed as %j", (name: string, key: string) => {
      expect(toCheckKey(name)).toBe(key);
    });

    test("maps samples to titled generic samples", () => {
      const transformed: JSONObject = transformLegacyRunResult(
        legacyPollResult({
          samples: [
            {
              id: "de_1",
              ruleName: "Suspicious login",
              detectionTime: "2026-09-14T09:10:00.000Z",
              createdTime: "2026-09-14T09:55:00.000Z",
              isAlert: true,
            },
            { id: "de_2", ruleName: "", isAlert: false },
            { id: 3, severity: "High", isAlert: "yes" },
          ] as never,
        }),
      ) as JSONObject;

      expect(transformed["samples"]).toEqual([
        {
          id: "de_1",
          title: "Suspicious login",
          severity: UNKNOWN_SEVERITY,
          createdTime: "2026-09-14T09:55:00.000Z",
          eventTime: "2026-09-14T09:10:00.000Z",
          isAlert: true,
        },
        {
          id: "de_2",
          title: UNTITLED_DETECTION_TITLE,
          severity: "Unknown",
          isAlert: false,
        },
        {
          id: "3",
          title: "Untitled detection",
          severity: "High",
        },
      ]);
    });

    test("never changes the stored value it was given", () => {
      const legacy: JSONObject = legacyPollResult();
      const snapshot: string = JSON.stringify(legacy);

      transformLegacyRunResult(legacy);
      transformLegacyLastPollResult(legacy, "2026-09-14T09:54:00.000Z");

      expect(JSON.stringify(legacy)).toBe(snapshot);
    });

    test("is idempotent: transforming a transformed result changes nothing", () => {
      const once: unknown = transformLegacyRunResult(legacyPollResult());

      expect(transformLegacyRunResult(once)).toEqual(once);
    });
  });

  describe("transformLegacyLastPollResult: resuming after a forced advance", () => {
    const CURSOR: string = "2026-09-14T10:00:00.000Z";

    test("a forced advance that skipped up to the cursor resumes at the cursor with no overlap", () => {
      const transformed: JSONObject = transformLegacyLastPollResult(
        legacyPollResult({
          forcedAdvance: true,
          windowStart: "2026-09-14T09:59:00.000Z",
          windowEnd: CURSOR,
        }),
        CURSOR,
      ) as JSONObject;

      expect(transformed["overlapFloor"]).toBe(CURSOR);
      expect(transformed["provider"]).toBe("google-secops");
    });

    test("a poll that already started at the cursor resumes there too, forced or not", () => {
      const transformed: JSONObject = transformLegacyLastPollResult(
        legacyPollResult({
          forcedAdvance: false,
          windowStart: CURSOR,
          windowEnd: "2026-09-14T10:05:00.000Z",
        }),
        CURSOR,
      ) as JSONObject;

      expect(transformed["overlapFloor"]).toBe(CURSOR);
    });

    test("times are compared as instants, and the floor is written as the generic poller writes it", () => {
      const transformed: JSONObject = transformLegacyLastPollResult(
        legacyPollResult({
          forcedAdvance: true,
          windowEnd: "2026-09-14T12:00:00+02:00",
        }),
        "2026-09-14T10:00:00Z",
      ) as JSONObject;

      expect(transformed["overlapFloor"]).toBe("2026-09-14T10:00:00.000Z");
    });

    test.each<[string, JSONObject, string | null]>([
      [
        "an ordinary poll whose window neither ends nor starts at the cursor",
        {},
        CURSOR,
      ],
      [
        "a forced advance whose window end is not the cursor",
        { forcedAdvance: true, windowEnd: "2026-09-14T09:59:00.000Z" },
        CURSOR,
      ],
      [
        "a window ending at the cursor without a forced advance",
        { forcedAdvance: false, windowEnd: CURSOR },
        CURSOR,
      ],
      [
        "no saved cursor",
        { forcedAdvance: true, windowEnd: CURSOR, windowStart: CURSOR },
        null,
      ],
      [
        "an unreadable cursor",
        { forcedAdvance: true, windowEnd: "garbage" },
        "garbage",
      ],
      [
        "a result that is not a poll",
        { type: "backfill", forcedAdvance: true, windowEnd: CURSOR },
        CURSOR,
      ],
    ])(
      "sets no floor for %s",
      (_label: string, overrides: JSONObject, cursor: string | null) => {
        const transformed: JSONObject = transformLegacyLastPollResult(
          legacyPollResult(overrides),
          cursor,
        ) as JSONObject;

        expect(Object.keys(transformed)).not.toContain("overlapFloor");
      },
    );

    test("a floor already present is kept", () => {
      const transformed: JSONObject = transformLegacyLastPollResult(
        legacyPollResult({
          forcedAdvance: true,
          windowEnd: CURSOR,
          overlapFloor: "2026-09-14T09:58:00.000Z",
        }),
        CURSOR,
      ) as JSONObject;

      expect(transformed["overlapFloor"]).toBe("2026-09-14T09:58:00.000Z");
    });

    test("no stored result stays null", () => {
      expect(transformLegacyLastPollResult(null, CURSOR)).toBeNull();
    });
  });

  describe("unwrapHashedStringEnvelope", () => {
    test.each<[string, string, string]>([
      ["a plain ciphertext", CIPHERTEXT, CIPHERTEXT],
      [
        "an envelope holding a string",
        JSON.stringify({ _type: "HashedString", value: CIPHERTEXT }),
        CIPHERTEXT,
      ],
      [
        "an envelope holding something else",
        JSON.stringify({ _type: "HashedString", value: 42 }),
        JSON.stringify({ _type: "HashedString", value: 42 }),
      ],
      [
        "JSON of another type",
        JSON.stringify({ _type: "ObjectID", value: CIPHERTEXT }),
        JSON.stringify({ _type: "ObjectID", value: CIPHERTEXT }),
      ],
      ["text that only starts like JSON", "{not json", "{not json"],
    ])("%s", (_label: string, stored: string, expected: string) => {
      expect(unwrapHashedStringEnvelope(stored)).toBe(expected);
    });
  });
});
