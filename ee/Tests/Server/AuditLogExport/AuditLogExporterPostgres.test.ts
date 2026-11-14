import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import AuditLogExporter, {
  AuditLogExportLock,
} from "../../../Server/AuditLogExport/AuditLogExporter";
import {
  AuditLogExportFailureNotice,
  AuditLogExportFailureNotification,
  AuditLogExportNotifier,
} from "../../../Server/AuditLogExport/AuditLogExportNotifications";
import AuditLogExportDestinationRegistry from "../../../Server/AuditLogExport/Destinations/DestinationRegistry";
import { AuditLogExportDeliveryError } from "../../../Server/AuditLogExport/Destinations/Types";
import Entities from "Common/Models/DatabaseModels/Index";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import { SemaphoreMutex } from "Common/Server/Infrastructure/Semaphore";
import AuditLogExportService from "Common/Server/Services/AuditLogExportService";
import logger from "Common/Server/Utils/Logger";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { AuditLogExportRecord } from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
/*
 * The typeorm copy Common's services run on (see TeamComplianceStatusPostgres).
 */
import { DataSource, Logger } from "Common/node_modules/typeorm";
import { PROJECT_A, PROJECT_B } from "./AuditLogExportTestData";
import {
  createInMemoryAuditLog,
  InMemoryAuditLog,
} from "./Fakes/InMemoryAuditLog";
import RecordingDestination from "./Fakes/RecordingDestination";

/*
 * THE EXPORTER ON A MIGRATED POSTGRES: exports created through the real
 * AuditLogExportService, sent by the real AuditLogExporter, their cursor
 * and failure state written by the real hook-free writes - the
 * compare-and-set UPDATE included - and read back from the table.
 *
 *   - the cursor survives a restart: a new exporter goes on from it, and
 *     nothing is sent twice;
 *   - two exporters on one export (a lock that did not hold) never move
 *     the cursor backwards or count an entry twice;
 *   - a project's export reads its project only, the instance's every one;
 *   - a failure leaves the cursor and writes why, since when and when next;
 *   - a failure that lasts is told once: the try before, as the table
 *     remembers it, is what keeps the email from going again; when the
 *     entries waiting are deleted is read from their own stamps, after the
 *     cursor the table remembers (#6563);
 *   - a new Export From, saved through the service, starts again from it;
 *   - deleting a project deletes its exports (the migrated foreign key).
 *
 * The audit log entries come from an in-memory audit log with the ClickHouse
 * read's semantics; App's AuditLogExportReadClickhouse runs that read on a
 * real ClickHouse.
 *
 * Opt in with RUN_POSTGRES_AUDIT_LOG_EXPORT_TESTS=true against a database
 * the registered migrations have been applied to, e.g. from ee/:
 *
 *   RUN_POSTGRES_AUDIT_LOG_EXPORT_TESTS=true \
 *   AUDIT_LOG_EXPORT_TEST_DATABASE_HOST=127.0.0.1 \
 *   AUDIT_LOG_EXPORT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest \
 *     Tests/Server/AuditLogExport/AuditLogExporterPostgres.test.ts \
 *     --selectProjects server --runInBand --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * of the tables involved, the export's foreign keys among them; the schema
 * is dropped afterwards. Every statement Postgres rejects fails the test.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_AUDIT_LOG_EXPORT_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["Project", "User", "AuditLogExport"];

type SqlRow = Record<string, unknown>;

class FailedQueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const freeLock: AuditLogExportLock = {
  acquire: async (): Promise<SemaphoreMutex | null> => {
    return {} as SemaphoreMutex;
  },
  keep: async (): Promise<boolean> => {
    return true;
  },
  release: async (): Promise<void> => {
    return undefined;
  },
};

describePostgres("the audit log exporter against a migrated Postgres", () => {
  const schema: string = `audit_log_export_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;

  const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
  let database: DataSource;
  let auditLog: InMemoryAuditLog;
  let webhook: RecordingDestination;
  let s3: RecordingDestination;
  let clock: Date;

  const exporter: (
    lock?: AuditLogExportLock,
    notifier?: AuditLogExportNotifier,
  ) => AuditLogExporter = (
    lock: AuditLogExportLock = freeLock,
    notifier?: AuditLogExportNotifier,
  ): AuditLogExporter => {
    return new AuditLogExporter({
      reader: auditLog.reader,
      lock,
      now: (): Date => {
        return clock;
      },
      sleep: async (): Promise<void> => {
        return undefined;
      },
      notifier,
    });
  };

  async function insert(table: string, row: SqlRow): Promise<void> {
    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        return row[column];
      }),
    );
  }

  async function storedRow(id: ObjectID): Promise<SqlRow> {
    const rows: Array<SqlRow> = await database.query(
      `SELECT * FROM "${schema}"."AuditLogExport" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  async function createExport(data: {
    projectId: string | null;
    destinationType: AuditLogExportDestinationType;
    startsAt?: Date | undefined;
  }): Promise<ObjectID> {
    const item: AuditLogExport = new AuditLogExport();
    item.name = `Export ${ObjectID.generate().toString().slice(0, 8)}`;
    item.destinationType = data.destinationType;
    item.config =
      data.destinationType === AuditLogExportDestinationType.Webhook
        ? { url: "https://93.184.216.34/audit" }
        : {
            bucket: "acme-audit-logs",
            region: "eu-west-1",
            accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          };
    item.secrets = JSON.stringify(
      data.destinationType === AuditLogExportDestinationType.Webhook
        ? {}
        : { secretAccessKey: "a-secret-access-key" },
    );

    if (data.startsAt) {
      item.startsAt = data.startsAt;
    }

    const created: AuditLogExport = await AuditLogExportService.create({
      data: item,
      props: data.projectId
        ? { ...ROOT, tenantId: new ObjectID(data.projectId) }
        : ROOT,
    });

    return created.id!;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["AUDIT_LOG_EXPORT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["AUDIT_LOG_EXPORT_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AUDIT_LOG_EXPORT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      logging: ["error"],
      logger: failedQueries,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();

    const foreignKeys: Array<{
      table: string;
      name: string;
      definition: string;
    }> = await database.query(
      `SELECT t.relname AS "table",
              c.conname AS "name",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = 'AuditLogExport' AND c.contype = 'f'`,
    );

    // The migration made the table: no clone without it.
    expect(foreignKeys.length).toBe(3);

    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const foreignKey of foreignKeys) {
      await database.query(
        `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition
          .split("REFERENCES public.")
          .join("REFERENCES ")}`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest
      .spyOn(AuditLogExportService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(AuditLogExportService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    // The service's clock is the exporter's: Export From is never "in the future" of it.
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
      return clock;
    });
  }, 300000);

  beforeEach(async () => {
    failedQueries.failures = [];
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    await database.query(
      [...TABLES]
        .reverse()
        .map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
        .join("; "),
    );

    for (const [id, name] of [
      [PROJECT_A, "Project A"],
      [PROJECT_B, "Project B"],
    ] as Array<[string, string]>) {
      await insert("Project", {
        _id: id,
        name,
        slug: `project-${id}`,
        version: 1,
      });
    }

    auditLog = createInMemoryAuditLog();
    webhook = new RecordingDestination();
    s3 = new RecordingDestination();
    clock = new Date("2026-10-24T12:00:00.000Z");

    AuditLogExportDestinationRegistry.setDestination(
      AuditLogExportDestinationType.Webhook,
      webhook,
    );
    AuditLogExportDestinationRegistry.setDestination(
      AuditLogExportDestinationType.AmazonS3,
      s3,
    );
  });

  afterEach(() => {
    AuditLogExportDestinationRegistry.reset();
    uninstallEnterpriseModule();
    // A failed statement fails the test, even if a caller swallowed it.
    expect(failedQueries.failures).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  }, 300000);

  test("a new export starts from the moment it is saved, with nothing exported", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
    });
    const row: SqlRow = await storedRow(id);

    expect(row["projectId"]).toBe(PROJECT_A);
    expect(row["isEnabled"]).toBe(true);
    expect(row["startsAt"]).toBeInstanceOf(Date);
    expect(row["cursorCreatedAt"]).toBeNull();
    expect(row["cursorEntryId"]).toBeNull();
    expect(row["exportedEntryCount"]).toBe(0);
    expect(row["consecutiveFailureCount"]).toBe(0);
  });

  test("the cursor survives a restart: a new exporter goes on from it, sending nothing twice", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T10:00:00.000Z"),
    });

    const first: string = String(
      auditLog.add({ createdAt: "2026-10-24T10:30:00.000Z" })["_id"],
    );
    await exporter().exportAll();

    const afterFirst: SqlRow = await storedRow(id);

    expect(afterFirst["cursorEntryId"]).toBe(first);
    expect((afterFirst["cursorCreatedAt"] as Date).toISOString()).toBe(
      "2026-10-24T10:30:00.000Z",
    );
    expect(afterFirst["exportedEntryCount"]).toBe(1);
    expect((afterFirst["lastExportedAt"] as Date).toISOString()).toBe(
      clock.toISOString(),
    );

    const second: string = String(
      auditLog.add({
        createdAt: "2026-10-24T10:30:00.000Z",
        id: "ffffffff-0000-4000-8000-000000000001",
      })["_id"],
    );
    const third: string = String(
      auditLog.add({ createdAt: "2026-10-24T11:00:00.000Z" })["_id"],
    );

    // A fresh exporter: a restart, or another worker.
    clock = new Date("2026-10-24T12:01:00.000Z");
    await exporter().exportAll();

    expect(webhook.deliveredIds()).toEqual([first, second, third]);
    expect((await storedRow(id))["exportedEntryCount"]).toBe(3);
  });

  test("two exporters on one export never move the cursor backwards or count twice", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T09:00:00.000Z"),
    });

    const ids: Array<string> = [];

    for (let index: number = 0; index < 1200; index++) {
      ids.push(
        String(
          auditLog.add({
            createdAt: new Date(
              Date.parse("2026-10-24T10:00:00.000Z") + index * 1000,
            ).toISOString(),
          })["_id"],
        ),
      );
    }

    // As if the lock did not hold: both run at once.
    await Promise.all([exporter().exportAll(), exporter().exportAll()]);
    await exporter().exportAll();

    const row: SqlRow = await storedRow(id);

    expect(row["cursorEntryId"]).toBe(ids[ids.length - 1]);
    expect(row["exportedEntryCount"]).toBe(1200);
    // Every entry arrived; a repeat is possible (at least once), a gap is not.
    expect(new Set(webhook.deliveredIds())).toEqual(new Set(ids));
  });

  test("a project's export reads its project only; the instance's reads every project", async () => {
    const projectExport: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T09:00:00.000Z"),
    });
    const instanceExport: ObjectID = await createExport({
      projectId: null,
      destinationType: AuditLogExportDestinationType.AmazonS3,
      startsAt: new Date("2026-10-24T09:00:00.000Z"),
    });

    expect((await storedRow(instanceExport))["projectId"]).toBeNull();

    const a: string = String(
      auditLog.add({
        createdAt: "2026-10-24T10:00:00.000Z",
        projectId: PROJECT_A,
      })["_id"],
    );
    const b: string = String(
      auditLog.add({
        createdAt: "2026-10-24T10:00:01.000Z",
        projectId: PROJECT_B,
      })["_id"],
    );

    await exporter().exportAll();

    expect(webhook.deliveredIds()).toEqual([a]);
    expect(s3.deliveredIds()).toEqual([a, b]);
    expect((await storedRow(projectExport))["exportedEntryCount"]).toBe(1);
    expect((await storedRow(instanceExport))["exportedEntryCount"]).toBe(2);
  });

  test("a failure leaves the cursor, and writes why, since when and when it tries again", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T09:00:00.000Z"),
    });
    auditLog.add({ createdAt: "2026-10-24T10:00:00.000Z" });

    webhook.failNext(
      1,
      new AuditLogExportDeliveryError(
        "The webhook endpoint refused the credential (HTTP 401).",
        { retryable: false, status: 401 },
      ),
    );

    await exporter().exportAll();

    const row: SqlRow = await storedRow(id);

    expect(row["cursorCreatedAt"]).toBeNull();
    expect(row["lastError"]).toBe(
      "The webhook endpoint refused the credential (HTTP 401).",
    );
    expect((row["failingSince"] as Date).toISOString()).toBe(
      clock.toISOString(),
    );
    expect(row["consecutiveFailureCount"]).toBe(1);
    expect((row["nextAttemptAt"] as Date).toISOString()).toBe(
      new Date(clock.getTime() + 60 * 1000).toISOString(),
    );

    // Saving new settings tries again at once; the next success clears it all.
    await AuditLogExportService.updateOneById({
      id,
      data: { config: { url: "https://93.184.216.35/audit" } } as never,
      props: ROOT,
    });

    const saved: SqlRow = await storedRow(id);

    expect(saved["nextAttemptAt"]).toBeNull();
    expect(saved["consecutiveFailureCount"]).toBe(0);

    await exporter().exportAll();

    const recovered: SqlRow = await storedRow(id);

    expect(recovered["lastError"]).toBeNull();
    expect(recovered["failingSince"]).toBeNull();
    expect(recovered["exportedEntryCount"]).toBe(1);
  });

  test("a failure that lasts is told once, from the try the table remembers", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T09:00:00.000Z"),
    });
    const entry: string = String(
      auditLog.add({ createdAt: "2026-10-24T10:00:00.000Z" })["_id"],
    );
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError(
        "The webhook endpoint refused the credential (HTTP 401).",
        { retryable: false, status: 401 },
      ),
    );

    const told: Array<AuditLogExportFailureNotification> = [];
    const notifier: AuditLogExportNotifier = {
      getRetentionInDays: async (): Promise<number> => {
        return 7;
      },
      notifyFailure: async (
        data: AuditLogExportFailureNotification,
      ): Promise<void> => {
        told.push(data);
      },
    };
    const startedAt: number = clock.getTime();
    let tries: number = 0;

    // Each try it asks for within two hours: at 0, 1, 3, 7, 15, 31 and 63 minutes.
    for (;;) {
      await exporter(freeLock, notifier).exportAll();
      tries++;

      const next: Date = (await storedRow(id))["nextAttemptAt"] as Date;

      if (next.getTime() > startedAt + 2 * 60 * 60 * 1000) {
        break;
      }

      clock = next;
    }

    expect(tries).toBe(7);
    expect(
      told.map(
        (
          data: AuditLogExportFailureNotification,
        ): AuditLogExportFailureNotice => {
          return data.notice;
        },
      ),
    ).toEqual([AuditLogExportFailureNotice.Failing]);
    expect(told[0]!.failingSince.toISOString()).toBe(
      new Date(startedAt).toISOString(),
    );
    expect(told[0]!.oldestUnsentAt!.toISOString()).toBe(
      "2026-10-24T10:00:00.000Z",
    );
    // When it is deleted: the stamp on the entry itself.
    expect(told[0]!.entriesLostAt!.toISOString()).toBe(
      auditLog.stampOf(entry).toISOString(),
    );
    expect((await storedRow(id))["consecutiveFailureCount"]).toBe(7);
    // Read only once an email can be due: the tries 31 and 63 minutes in.
    expect(
      auditLog.soonestReads.map((read: { until: Date }): string => {
        return read.until.toISOString();
      }),
    ).toEqual([
      new Date(startedAt + 31 * 60 * 1000).toISOString(),
      new Date(startedAt + 63 * 60 * 1000).toISOString(),
    ]);
  });

  test("the stamps are read after the cursor the table remembers: an entry already sent, stamped sooner, does not count, nor the retention as it is now", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T09:00:00.000Z"),
    });
    // Sent before the failures begin, and stamped to go sooner than anything waiting.
    const sent: string = String(
      auditLog.add({
        createdAt: "2026-10-24T09:30:00.000Z",
        retentionDate: new Date("2026-10-25T00:00:00.000Z"),
      })["_id"],
    );

    await exporter().exportAll();

    expect(webhook.deliveredIds()).toEqual([sent]);
    expect((await storedRow(id))["cursorEntryId"]).toBe(sent);

    // Recorded with a week's retention; the project keeps 30 days from then on.
    const waiting: string = String(
      auditLog.add({
        createdAt: "2026-10-24T12:30:00.000Z",
        retentionInDays: 7,
      })["_id"],
    );
    // Another project's, stamped sooner still: not this export's.
    auditLog.add({
      createdAt: "2026-10-24T12:40:00.000Z",
      projectId: PROJECT_B,
      retentionDate: new Date("2026-10-26T00:00:00.000Z"),
    });

    clock = new Date("2026-10-24T13:00:00.000Z");
    webhook.failNext(
      10_000,
      new AuditLogExportDeliveryError(
        "The webhook endpoint refused the credential (HTTP 401).",
        { retryable: false, status: 401 },
      ),
    );

    const told: Array<AuditLogExportFailureNotification> = [];
    const notifier: AuditLogExportNotifier = {
      getRetentionInDays: async (): Promise<number> => {
        return 30;
      },
      notifyFailure: async (
        data: AuditLogExportFailureNotification,
      ): Promise<void> => {
        told.push(data);
      },
    };
    const startedAt: number = clock.getTime();

    for (;;) {
      await exporter(freeLock, notifier).exportAll();

      const next: Date = (await storedRow(id))["nextAttemptAt"] as Date;

      if (next.getTime() > startedAt + 2 * 60 * 60 * 1000) {
        break;
      }

      clock = next;
    }

    expect(
      told.map(
        (
          data: AuditLogExportFailureNotification,
        ): AuditLogExportFailureNotice => {
          return data.notice;
        },
      ),
    ).toEqual([AuditLogExportFailureNotice.Failing]);
    expect(told[0]!.retentionInDays).toBe(30);
    expect(told[0]!.oldestUnsentAt!.toISOString()).toBe(
      "2026-10-24T12:30:00.000Z",
    );
    // Its own week, not the 30 days the project keeps now, nor the sent entry's stamp.
    expect(told[0]!.entriesLostAt!.toISOString()).toBe(
      auditLog.stampOf(waiting).toISOString(),
    );
    expect(auditLog.soonestReads.length).toBeGreaterThan(0);

    for (const read of auditLog.soonestReads) {
      expect({ ...read, until: null }).toEqual({
        projectId: PROJECT_A,
        startsAt: new Date("2026-10-24T09:00:00.000Z"),
        until: null,
        after: { createdAt: new Date("2026-10-24T09:30:00.000Z"), id: sent },
      });
    }
  });

  test("a new Export From, saved through the service, starts the export again from it", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T10:00:00.000Z"),
    });
    const old: string = String(
      auditLog.add({ createdAt: "2026-10-24T09:30:00.000Z" })["_id"],
    );
    const recent: string = String(
      auditLog.add({ createdAt: "2026-10-24T10:30:00.000Z" })["_id"],
    );

    await exporter().exportAll();
    expect(webhook.deliveredIds()).toEqual([recent]);

    await AuditLogExportService.updateOneById({
      id,
      data: { startsAt: new Date("2026-10-24T09:00:00.000Z") },
      props: ROOT,
    });

    const reset: SqlRow = await storedRow(id);

    expect(reset["cursorCreatedAt"]).toBeNull();
    expect(reset["cursorEntryId"]).toBeNull();

    await exporter().exportAll();

    expect(webhook.deliveredIds()).toEqual([recent, old, recent]);
  });

  /*
   * Issue #6247, on the real table: a new export is saved sending the
   * newest record version; one saved before there was a choice holds the
   * column's default - what the migration gave every such row - is sent as
   * version 1, and switched through the service sends version 2 from its
   * next batch.
   */
  test("a new export sends the newest record version; one saved before holds the column's default, 1, until it is switched", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T10:00:00.000Z"),
    });
    const workflowSave: JSONObject = {
      field: "graph",
      oldValue: "1 step and no connections",
      newValue: "2 steps and 1 connection",
      summary: ['Added "Log" (log-1)'],
    };

    expect((await storedRow(id))["schemaVersion"]).toBe(2);

    // As the migration left every export saved before it.
    await database.query(
      `UPDATE "${schema}"."AuditLogExport" SET "schemaVersion" = DEFAULT WHERE "_id" = $1`,
      [id.toString()],
    );
    expect((await storedRow(id))["schemaVersion"]).toBe(1);

    auditLog.add({
      createdAt: "2026-10-24T10:30:00.000Z",
      changes: [workflowSave],
    });
    await exporter().exportAll();

    const first: AuditLogExportRecord = webhook.batches[0]!.records[0]!;

    expect(first.schemaVersion).toBe(1);
    expect(first.changes[0]).not.toHaveProperty("summary");

    await AuditLogExportService.updateOneById({
      id,
      data: { schemaVersion: 2 },
      props: { ...ROOT, tenantId: new ObjectID(PROJECT_A) },
    });
    expect((await storedRow(id))["schemaVersion"]).toBe(2);

    auditLog.add({
      createdAt: "2026-10-24T10:31:00.000Z",
      changes: [workflowSave],
    });
    await exporter().exportAll();

    const last: AuditLogExportRecord =
      webhook.batches[webhook.batches.length - 1]!.records[0]!;

    expect(last.schemaVersion).toBe(2);
    expect(last.changes[0]!.summary).toEqual(['Added "Log" (log-1)']);
  });

  test("a paused export keeps its place and is not sent", async () => {
    const id: ObjectID = await createExport({
      projectId: PROJECT_A,
      destinationType: AuditLogExportDestinationType.Webhook,
      startsAt: new Date("2026-10-24T09:00:00.000Z"),
    });
    auditLog.add({ createdAt: "2026-10-24T10:00:00.000Z" });

    await AuditLogExportService.updateOneById({
      id,
      data: { isEnabled: false },
      props: ROOT,
    });
    await exporter().exportAll();

    expect(webhook.batches).toHaveLength(0);

    await AuditLogExportService.updateOneById({
      id,
      data: { isEnabled: true },
      props: ROOT,
    });
    await exporter().exportAll();

    expect(webhook.batches).toHaveLength(1);
  });

  test("deleting a project deletes its exports, and leaves the instance's", async () => {
    const projectExport: ObjectID = await createExport({
      projectId: PROJECT_B,
      destinationType: AuditLogExportDestinationType.Webhook,
    });
    const instanceExport: ObjectID = await createExport({
      projectId: null,
      destinationType: AuditLogExportDestinationType.Webhook,
    });

    await database.query(`DELETE FROM "${schema}"."Project" WHERE "_id" = $1`, [
      PROJECT_B,
    ]);

    expect(await storedRow(projectExport)).toBeUndefined();
    expect(await storedRow(instanceExport)).toBeDefined();
  });
});
