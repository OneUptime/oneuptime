import {
  afterEach,
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
  AUDIT_LOG_EXPORT_FILE_WAIT_IN_SECONDS,
  AUDIT_LOG_EXPORT_MAX_BATCHES_PER_RUN,
  AUDIT_LOG_EXPORT_PLAN_REQUIRED_MESSAGE,
  AUDIT_LOG_EXPORT_RETRY_DELAYS_IN_MS,
  AUDIT_LOG_EXPORT_SETTLE_IN_SECONDS,
  AuditLogExportLock,
  AuditLogExportRunResult,
  AuditLogExporterSummary,
  getAuditLogExportBackoffInMinutes,
} from "../../../Server/AuditLogExport/AuditLogExporter";
import AuditLogExportDestinationRegistry from "../../../Server/AuditLogExport/Destinations/DestinationRegistry";
import { AuditLogExportDeliveryError } from "../../../Server/AuditLogExport/Destinations/Types";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { SemaphoreMutex } from "Common/Server/Infrastructure/Semaphore";
import AuditLogExportService from "Common/Server/Services/AuditLogExportService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AuditLogExportDestinationDefinition,
  getAuditLogExportDestinationDefinition,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import AuditLogExportSettingsUtil from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import { AuditLogExportRecord } from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { PROJECT_A, PROJECT_B } from "./AuditLogExportTestData";
import {
  createInMemoryAuditLog,
  InMemoryAuditLog,
} from "./Fakes/InMemoryAuditLog";
import {
  InMemoryExports,
  newStoredExport,
  StoredExport,
  useInMemoryExports,
} from "./Fakes/InMemoryExports";
import RecordingDestination from "./Fakes/RecordingDestination";

/*
 * The exporter's rules, one at a time, against an in-memory audit log with
 * the ClickHouse read's semantics and in-memory exports with the
 * compare-and-set's: what is read (Export From, the settle time, the
 * cursor, the project), how it is batched (entries, bytes, the file wait),
 * what a delivery that fails leaves behind (no cursor move, the error, the
 * backoff), and when nothing runs at all (the license, the plan, a lock
 * another worker holds). AuditLogExporterPostgres runs the same exporter
 * on the real AuditLogExport table.
 */

const NOW: Date = new Date("2026-10-24T12:00:00.000Z");

function secondsBefore(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

const webhookExport: (overrides?: Partial<StoredExport>) => StoredExport = (
  overrides: Partial<StoredExport> = {},
): StoredExport => {
  return newStoredExport({
    destinationType: AuditLogExportDestinationType.Webhook,
    config: { url: "https://93.184.216.34/audit" },
    projectId: PROJECT_A,
    ...overrides,
  });
};

const s3Export: (overrides?: Partial<StoredExport>) => StoredExport = (
  overrides: Partial<StoredExport> = {},
): StoredExport => {
  return newStoredExport({
    destinationType: AuditLogExportDestinationType.AmazonS3,
    config: {
      bucket: "acme-audit-logs",
      region: "eu-west-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    },
    secrets: { secretAccessKey: "secret" },
    projectId: PROJECT_A,
    ...overrides,
  });
};

// A lock that is always free, recording what it was asked.
function freeLock(): AuditLogExportLock & {
  acquired: Array<string>;
  released: number;
  keepAnswers: Array<boolean>;
} {
  const lock: AuditLogExportLock & {
    acquired: Array<string>;
    released: number;
    keepAnswers: Array<boolean>;
  } = {
    acquired: [],
    released: 0,
    keepAnswers: [],
    acquire: async (exportId: string): Promise<SemaphoreMutex | null> => {
      lock.acquired.push(exportId);
      return {} as SemaphoreMutex;
    },
    keep: async (): Promise<boolean> => {
      return lock.keepAnswers.length > 0 ? lock.keepAnswers.shift()! : true;
    },
    release: async (): Promise<void> => {
      lock.released++;
    },
  };

  return lock;
}

describe("the audit log exporter", () => {
  let auditLog: InMemoryAuditLog;
  let webhook: RecordingDestination;
  let s3: RecordingDestination;
  let sleeps: Array<number>;
  let clock: Date;

  const exporter: (lock?: AuditLogExportLock) => AuditLogExporter = (
    lock: AuditLogExportLock = freeLock(),
  ): AuditLogExporter => {
    return new AuditLogExporter({
      reader: auditLog.reader,
      lock,
      now: (): Date => {
        return clock;
      },
      sleep: async (delayInMs: number): Promise<void> => {
        sleeps.push(delayInMs);
      },
    });
  };

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);

    auditLog = createInMemoryAuditLog();
    webhook = new RecordingDestination();
    s3 = new RecordingDestination();
    sleeps = [];
    clock = NOW;

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
    jest.restoreAllMocks();
    AuditLogExportDestinationRegistry.reset();
    uninstallEnterpriseModule();
  });

  describe("what is read", () => {
    test("every entry from Export From on, a minute settled, oldest first", async () => {
      const row: StoredExport = webhookExport({
        startsAt: new Date("2026-10-24T11:00:00.000Z"),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);

      auditLog.add({ createdAt: "2026-10-24T10:59:59.000Z" });
      const first: string = String(
        auditLog.add({ createdAt: "2026-10-24T11:00:00.000Z" })["_id"],
      );
      const second: string = String(
        auditLog.add({ createdAt: secondsBefore(120) })["_id"],
      );
      // Still settling: left for the next run.
      auditLog.add({ createdAt: secondsBefore(30) });

      await exporter().exportAll();

      expect(webhook.deliveredIds()).toEqual([first, second]);
      expect(auditLog.reads[0]!.until.toISOString()).toBe(
        new Date(
          NOW.getTime() - AUDIT_LOG_EXPORT_SETTLE_IN_SECONDS * 1000,
        ).toISOString(),
      );

      const stored: StoredExport = exports.get(row._id);

      expect(stored.cursorEntryId).toBe(second);
      expect(stored.cursorCreatedAt!.toISOString()).toBe(secondsBefore(120));
      expect(stored.exportedEntryCount).toBe(2);
      expect(stored.lastExportedAt!.toISOString()).toBe(NOW.toISOString());
    });

    test("the next run goes on after the cursor, sending nothing twice", async () => {
      const row: StoredExport = webhookExport();
      useInMemoryExports([row]);

      auditLog.add({ createdAt: secondsBefore(300) });
      await exporter().exportAll();

      const later: string = String(
        auditLog.add({ createdAt: secondsBefore(200) })["_id"],
      );
      clock = new Date(NOW.getTime() + 60 * 1000);
      await exporter().exportAll();

      expect(webhook.batches).toHaveLength(2);
      expect(
        webhook.batches[1]!.records.map((record: AuditLogExportRecord) => {
          return record.id;
        }),
      ).toEqual([later]);
      expect(new Set(webhook.deliveredIds()).size).toBe(2);
    });

    test("entries recorded in the same second are ordered by id and each sent once, across runs", async () => {
      const row: StoredExport = webhookExport();
      useInMemoryExports([row]);

      const sameSecond: string = secondsBefore(600);
      const ids: Array<string> = [];

      for (let index: number = 0; index < 7; index++) {
        ids.push(String(auditLog.add({ createdAt: sameSecond })["_id"]));
      }

      // Three entries per batch and one batch per run, so the cursor stops mid-second.
      const definition: AuditLogExportDestinationDefinition =
        getAuditLogExportDestinationDefinition(
          AuditLogExportDestinationType.Webhook,
        )!;
      jest
        .spyOn(AuditLogExportSettingsUtil, "getDefinitionOrThrow")
        .mockReturnValue({ ...definition, maxEntriesPerBatch: 3 });

      const lock: ReturnType<typeof freeLock> = freeLock();
      lock.keepAnswers.push(false, false, false);

      for (let run: number = 0; run < 3; run++) {
        await exporter(lock).exportAll();
        clock = new Date(clock.getTime() + 60 * 1000);
      }

      const sorted: Array<string> = [...ids].sort();

      expect(webhook.deliveredIds()).toEqual(sorted);
      expect(
        webhook.batches.map((batch: { records: Array<unknown> }): number => {
          return batch.records.length;
        }),
      ).toEqual([3, 3, 1]);
      // The second run read from the middle of that second.
      expect(auditLog.reads[1]!.after).toEqual({
        createdAt: new Date(sameSecond),
        id: sorted[2],
      });
    });

    test("a project's export reads its project only; the instance's reads every project", async () => {
      const projectExport: StoredExport = webhookExport({
        projectId: PROJECT_A,
      });
      const instanceExport: StoredExport = s3Export({
        projectId: null,
        name: "Every project",
      });
      useInMemoryExports([projectExport, instanceExport]);

      const a: string = String(
        auditLog.add({ createdAt: secondsBefore(900), projectId: PROJECT_A })[
          "_id"
        ],
      );
      const b: string = String(
        auditLog.add({ createdAt: secondsBefore(890), projectId: PROJECT_B })[
          "_id"
        ],
      );

      await exporter().exportAll();

      expect(webhook.deliveredIds()).toEqual([a]);
      expect(s3.deliveredIds()).toEqual([a, b]);
      expect(
        auditLog.reads.map((read: { projectId: string | null }) => {
          return read.projectId;
        }),
      ).toEqual(expect.arrayContaining([PROJECT_A, null]));
    });

    test("an export whose Export From is still ahead of the settled time reads nothing", async () => {
      useInMemoryExports([
        webhookExport({ startsAt: new Date(NOW.getTime() - 10 * 1000) }),
      ]);
      auditLog.add({ createdAt: secondsBefore(5) });

      await exporter().exportAll();

      expect(auditLog.reads).toHaveLength(0);
      expect(webhook.batches).toHaveLength(0);
    });
  });

  describe("how it is batched", () => {
    test("a stream gets batches of at most its entry limit", async () => {
      useInMemoryExports([webhookExport()]);

      for (let index: number = 0; index < 1200; index++) {
        auditLog.add({
          createdAt: secondsBefore(3600 - Math.floor(index / 10)),
        });
      }

      await exporter().exportAll();

      expect(
        webhook.batches.map((batch: { records: Array<unknown> }): number => {
          return batch.records.length;
        }),
      ).toEqual([500, 500, 200]);
      expect(new Set(webhook.deliveredIds()).size).toBe(1200);
    });

    test("a batch stops before the byte limit, and an entry larger than it goes alone", async () => {
      useInMemoryExports([webhookExport()]);

      const big: string = "x".repeat(400 * 1024);

      for (let index: number = 0; index < 4; index++) {
        auditLog.add({
          createdAt: secondsBefore(600 - index),
          changes: [{ field: "description", newValue: big }],
        });
      }
      auditLog.add({
        createdAt: secondsBefore(500),
        changes: [
          { field: "description", newValue: "x".repeat(2 * 1024 * 1024) },
        ],
      });

      await exporter().exportAll();

      // 512 KB per webhook batch: one 400 KB entry each, and the 2 MB one alone.
      expect(
        webhook.batches.map((batch: { records: Array<unknown> }): number => {
          return batch.records.length;
        }),
      ).toEqual([1, 1, 1, 1, 1]);
    });

    test("a file destination waits for a fuller batch while its first entry is young", async () => {
      const row: StoredExport = s3Export();
      useInMemoryExports([row]);

      auditLog.add({ createdAt: secondsBefore(120) });

      const summary: AuditLogExporterSummary = await exporter().exportAll();

      expect(s3.batches).toHaveLength(0);
      expect(summary.exports[0]!.waitingForMore).toBe(true);

      // Five minutes after its first entry, the file is written.
      clock = new Date(
        NOW.getTime() + AUDIT_LOG_EXPORT_FILE_WAIT_IN_SECONDS * 1000,
      );
      await exporter().exportAll();

      expect(s3.batches).toHaveLength(1);
    });

    test("a full batch is written at once, however young", async () => {
      useInMemoryExports([s3Export()]);

      for (let index: number = 0; index < 5001; index++) {
        auditLog.add({ createdAt: secondsBefore(90) });
      }

      await exporter().exportAll();

      expect(s3.batches.length).toBeGreaterThanOrEqual(1);
      expect(s3.batches[0]!.records).toHaveLength(5000);
    });

    test("a backfill's old entries are written at once", async () => {
      useInMemoryExports([
        s3Export({ startsAt: new Date("2026-09-01T00:00:00.000Z") }),
      ]);

      auditLog.add({ createdAt: "2026-09-15T08:00:00.000Z" });

      await exporter().exportAll();

      expect(s3.batches).toHaveLength(1);
      expect(s3.batches[0]!.firstCreatedAt.toISOString()).toBe(
        "2026-09-15T08:00:00.000Z",
      );
    });

    test("a batch's id is its first entry's, and it is never a test", async () => {
      useInMemoryExports([webhookExport()]);
      const first: string = String(
        auditLog.add({ createdAt: secondsBefore(300) })["_id"],
      );
      auditLog.add({ createdAt: secondsBefore(299) });

      await exporter().exportAll();

      expect(webhook.batches[0]!.id).toBe(first);
      expect(webhook.batches[0]!.isTest).toBe(false);
    });

    test("one run sends at most its batch limit; the next run goes on", async () => {
      useInMemoryExports([webhookExport()]);

      for (
        let index: number = 0;
        index < (AUDIT_LOG_EXPORT_MAX_BATCHES_PER_RUN + 2) * 500;
        index++
      ) {
        auditLog.add({
          createdAt: secondsBefore(36000 - Math.floor(index / 50)),
        });
      }

      await exporter().exportAll();
      expect(webhook.batches).toHaveLength(
        AUDIT_LOG_EXPORT_MAX_BATCHES_PER_RUN,
      );

      await exporter().exportAll();
      expect(webhook.batches).toHaveLength(
        AUDIT_LOG_EXPORT_MAX_BATCHES_PER_RUN + 2,
      );
      expect(new Set(webhook.deliveredIds()).size).toBe(
        (AUDIT_LOG_EXPORT_MAX_BATCHES_PER_RUN + 2) * 500,
      );
    });
  });

  describe("a destination that fails", () => {
    test("a failure trying again can help is tried three times, one and four seconds apart", async () => {
      useInMemoryExports([webhookExport()]);
      auditLog.add({ createdAt: secondsBefore(300) });

      webhook.failNext(
        2,
        new AuditLogExportDeliveryError("busy", { retryable: true }),
      );

      await exporter().exportAll();

      expect(webhook.attempts).toBe(3);
      expect(webhook.batches).toHaveLength(1);
      expect(sleeps).toEqual([...AUDIT_LOG_EXPORT_RETRY_DELAYS_IN_MS]);
    });

    test("after the third failure the cursor stays, and the export says why, since when, and when it tries again", async () => {
      const row: StoredExport = webhookExport();
      const exports: InMemoryExports = useInMemoryExports([row]);
      auditLog.add({ createdAt: secondsBefore(300) });

      webhook.failNext(
        3,
        new AuditLogExportDeliveryError(
          "The webhook endpoint is busy or failing (HTTP 503).",
          { retryable: true, status: 503 },
        ),
      );

      const summary: AuditLogExporterSummary = await exporter().exportAll();
      const stored: StoredExport = exports.get(row._id);

      expect(summary.exports[0]!.failure).toBe(
        "The webhook endpoint is busy or failing (HTTP 503).",
      );
      expect(stored.cursorCreatedAt).toBeNull();
      expect(stored.exportedEntryCount).toBe(0);
      expect(stored.lastError).toBe(
        "The webhook endpoint is busy or failing (HTTP 503).",
      );
      expect(stored.failingSince!.toISOString()).toBe(NOW.toISOString());
      expect(stored.consecutiveFailureCount).toBe(1);
      expect(stored.nextAttemptAt!.toISOString()).toBe(
        new Date(NOW.getTime() + 60 * 1000).toISOString(),
      );
      expect(exports.compareAndSets).toHaveLength(0);
    });

    test("a refused setting is not tried again in the same run", async () => {
      useInMemoryExports([webhookExport()]);
      auditLog.add({ createdAt: secondsBefore(300) });

      webhook.failNext(
        1,
        new AuditLogExportDeliveryError("refused the credential (HTTP 401)", {
          retryable: false,
          status: 401,
        }),
      );

      await exporter().exportAll();

      expect(webhook.attempts).toBe(1);
      expect(sleeps).toEqual([]);
    });

    test("an export waiting out its backoff is not run, and runs once it is due", async () => {
      const row: StoredExport = webhookExport({
        lastError: "busy",
        failingSince: new Date(NOW.getTime() - 10 * 60 * 1000),
        consecutiveFailureCount: 3,
        nextAttemptAt: new Date(NOW.getTime() + 4 * 60 * 1000),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      auditLog.add({ createdAt: secondsBefore(900) });

      await exporter().exportAll();
      expect(webhook.attempts).toBe(0);

      clock = new Date(NOW.getTime() + 4 * 60 * 1000);
      await exporter().exportAll();

      const stored: StoredExport = exports.get(row._id);

      expect(webhook.batches).toHaveLength(1);
      // A success clears the failure state.
      expect(stored.lastError).toBeNull();
      expect(stored.failingSince).toBeNull();
      expect(stored.consecutiveFailureCount).toBe(0);
      expect(stored.nextAttemptAt).toBeNull();
    });

    test("failures in a row keep their first time and back off further", async () => {
      const row: StoredExport = webhookExport();
      const exports: InMemoryExports = useInMemoryExports([row]);
      auditLog.add({ createdAt: secondsBefore(300) });

      const refused: AuditLogExportDeliveryError =
        new AuditLogExportDeliveryError("refused", { retryable: false });
      webhook.failNext(2, refused);

      await exporter().exportAll();
      clock = exports.get(row._id).nextAttemptAt!;
      await exporter().exportAll();

      const stored: StoredExport = exports.get(row._id);

      expect(stored.failingSince!.toISOString()).toBe(NOW.toISOString());
      expect(stored.consecutiveFailureCount).toBe(2);
      expect(stored.nextAttemptAt!.getTime() - clock.getTime()).toBe(
        2 * 60 * 1000,
      );
    });

    test("the wait between tries doubles up to an hour", () => {
      expect(
        [1, 2, 3, 4, 5, 6, 7, 8, 50, 0].map(getAuditLogExportBackoffInMinutes),
      ).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60, 1]);
    });

    test("an error that is not a delivery error is recorded too, never thrown out of the run", async () => {
      const row: StoredExport = webhookExport();
      const exports: InMemoryExports = useInMemoryExports([row]);
      auditLog.add({ createdAt: secondsBefore(300) });

      webhook.failNext(1, new Error("Something unexpected"));

      await expect(exporter().exportAll()).resolves.toBeDefined();
      expect(exports.get(row._id).lastError).toBe("Something unexpected");
    });

    test("one failing export never holds back the others", async () => {
      const failing: StoredExport = webhookExport();
      const healthy: StoredExport = s3Export({
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
      });
      useInMemoryExports([failing, healthy]);
      auditLog.add({ createdAt: "2026-10-23T00:00:00.000Z" });

      webhook.failNext(
        3,
        new AuditLogExportDeliveryError("busy", { retryable: true }),
      );

      await exporter().exportAll();

      expect(s3.batches).toHaveLength(1);
    });
  });

  describe("when the cursor moves elsewhere", () => {
    test("the run stops when someone else moved the cursor: it never writes over theirs", async () => {
      const row: StoredExport = webhookExport();
      const exports: InMemoryExports = useInMemoryExports([row]);

      for (let index: number = 0; index < 1000; index++) {
        auditLog.add({ createdAt: secondsBefore(900) });
      }

      // As the first batch is delivered, the export is started again from another date.
      const deliver: typeof webhook.deliver = webhook.deliver.bind(webhook);
      jest
        .spyOn(webhook, "deliver")
        .mockImplementation(
          async (delivery: Parameters<typeof webhook.deliver>[0]) => {
            const receipt: { location: string } = await deliver(delivery);
            exports.moveCursor(row._id, null);
            exports.get(row._id).cursorEntryId =
              "ffffffff-ffff-4fff-8fff-ffffffffffff";
            exports.get(row._id).cursorCreatedAt = new Date(
              "2026-01-01T00:00:00Z",
            );
            return receipt;
          },
        );

      const summary: AuditLogExporterSummary = await exporter().exportAll();

      expect(summary.exports[0]!.batches).toBe(1);
      expect(exports.compareAndSets).toEqual([{ id: row._id, wrote: false }]);
      expect(exports.get(row._id).cursorEntryId).toBe(
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      );
    });

    test("an export another worker is sending is left to it", async () => {
      useInMemoryExports([webhookExport()]);
      auditLog.add({ createdAt: secondsBefore(300) });

      const summary: AuditLogExporterSummary = await exporter({
        acquire: async (): Promise<SemaphoreMutex | null> => {
          return null;
        },
        keep: async (): Promise<boolean> => {
          return true;
        },
        release: async (): Promise<void> => {
          return undefined;
        },
      }).exportAll();

      expect(summary.exports[0]!.skipped).toBe("locked");
      expect(webhook.attempts).toBe(0);
    });

    test("a lock that ran out stops the run after the batch it is on", async () => {
      useInMemoryExports([webhookExport()]);

      for (let index: number = 0; index < 1500; index++) {
        auditLog.add({ createdAt: secondsBefore(900) });
      }

      const lock: ReturnType<typeof freeLock> = freeLock();
      lock.keepAnswers.push(false);

      await exporter(lock).exportAll();

      expect(webhook.batches).toHaveLength(1);
      expect(lock.released).toBe(1);
    });

    test("the lock is given back even when the export fails", async () => {
      useInMemoryExports([webhookExport()]);
      auditLog.add({ createdAt: secondsBefore(300) });
      webhook.failNext(
        1,
        new AuditLogExportDeliveryError("no", { retryable: false }),
      );

      const lock: ReturnType<typeof freeLock> = freeLock();
      await exporter(lock).exportAll();

      expect(lock.released).toBe(1);
    });
  });

  describe("when nothing runs", () => {
    test("without a license that includes audit logs, nothing is read or sent", async () => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired", {
          expiresAt: new Date("2025-01-01T00:00:00.000Z"),
        }),
      });
      useInMemoryExports([webhookExport()]);
      auditLog.add({ createdAt: secondsBefore(300) });

      const summary: AuditLogExporterSummary = await exporter().exportAll();

      expect(summary.skipped).toBe("license");
      expect(auditLog.reads).toHaveLength(0);
    });

    test("the Community Edition exports nothing", async () => {
      uninstallEnterpriseModule();
      expect(AuditLogExporter.isExportingActive()).toBe(false);
    });

    test("a paused export is not run", async () => {
      useInMemoryExports([webhookExport({ isEnabled: false })]);
      auditLog.add({ createdAt: secondsBefore(300) });

      await exporter().exportAll();

      expect(webhook.attempts).toBe(0);
    });

    test("on OneUptime Cloud, a project below the Enterprise plan is not exported, and says why once", async () => {
      setTestBillingEnabled(true);

      const row: StoredExport = webhookExport();
      const exports: InMemoryExports = useInMemoryExports([row]);
      auditLog.add({ createdAt: secondsBefore(300) });

      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementation((async () => {
          const project: Project = new Project();
          project.planName = PlanType.Scale;
          return project;
        }) as never);

      const first: AuditLogExporterSummary = await exporter().exportAll();
      await exporter().exportAll();

      expect(first.exports[0]!.skipped).toBe("plan");
      expect(webhook.attempts).toBe(0);
      expect(exports.get(row._id).lastError).toBe(
        AUDIT_LOG_EXPORT_PLAN_REQUIRED_MESSAGE,
      );
      // Written once, not every minute.
      expect(
        AuditLogExportService.updateColumnsByIdWithoutHooks,
      ).toHaveBeenCalledTimes(1);
      expect(ProjectService.findOneById).toHaveBeenCalled();
    });

    test("on OneUptime Cloud, a project on the Enterprise plan is exported, and the instance's export needs no plan", async () => {
      setTestBillingEnabled(true);

      useInMemoryExports([webhookExport(), s3Export({ projectId: null })]);
      auditLog.add({ createdAt: secondsBefore(900) });

      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementation((async () => {
          const project: Project = new Project();
          project.planName = PlanType.Enterprise;
          return project;
        }) as never);

      await exporter().exportAll();

      expect(webhook.batches).toHaveLength(1);
      expect(s3.batches).toHaveLength(1);
    });
  });

  describe("toBatch", () => {
    test("leaves out rows it cannot place, and keeps the rest in order", () => {
      const rows: Array<Record<string, unknown>> = [
        { _id: "", createdAt: "2026-10-24 09:00:00" },
        {
          _id: ObjectID.generate().toString(),
          createdAt: "2026-10-24 09:00:01",
        },
        { _id: ObjectID.generate().toString() },
        {
          _id: ObjectID.generate().toString(),
          createdAt: "2026-10-24 09:00:02",
        },
      ];

      expect(
        AuditLogExporter.toBatch({
          rows: rows as never,
          maxBytes: 1024 * 1024,
        }).map((record: AuditLogExportRecord): string => {
          return record.createdAt;
        }),
      ).toEqual(["2026-10-24T09:00:01.000Z", "2026-10-24T09:00:02.000Z"]);
    });
  });

  describe("sendTest", () => {
    test("sends one entry marked as a test, with the export scope's egress policy", async () => {
      const destination: RecordingDestination = new RecordingDestination();

      await AuditLogExporter.sendTest({
        settings: {
          type: AuditLogExportDestinationType.Webhook,
          config: { url: "https://93.184.216.34/audit" },
          secrets: {},
        },
        isInstanceExport: true,
        projectId: null,
        destination,
        now: NOW,
      });

      const delivered: RunResultDelivery = destination.deliveries[0]!;

      expect(delivered.batch.isTest).toBe(true);
      expect(delivered.batch.records).toHaveLength(1);
      expect(delivered.batch.records[0]!.action).toBe("Test");
      expect(delivered.batch.records[0]!.createdAt).toBe(NOW.toISOString());
      expect(delivered.egress.blockPrivateAddresses).toBe(false);
    });

    test("a project's test keeps the project's egress policy and names the project", async () => {
      const destination: RecordingDestination = new RecordingDestination();

      await AuditLogExporter.sendTest({
        settings: {
          type: AuditLogExportDestinationType.Webhook,
          config: { url: "https://93.184.216.34/audit" },
          secrets: {},
        },
        isInstanceExport: false,
        projectId: new ObjectID(PROJECT_A),
        destination,
      });

      const delivered: RunResultDelivery = destination.deliveries[0]!;

      expect(delivered.egress.blockPrivateAddresses).toBeUndefined();
      expect(delivered.batch.records[0]!.projectId).toBe(PROJECT_A);
    });

    test("a test's failure is the destination's own, untouched", async () => {
      const destination: RecordingDestination = new RecordingDestination();
      destination.failNext(
        1,
        new AuditLogExportDeliveryError(
          "Amazon S3 did not let this access key write.",
          {
            retryable: false,
          },
        ),
      );

      await expect(
        AuditLogExporter.sendTest({
          settings: {
            type: AuditLogExportDestinationType.Webhook,
            config: { url: "https://93.184.216.34/audit" },
            secrets: {},
          },
          isInstanceExport: false,
          projectId: null,
          destination,
        }),
      ).rejects.toThrow("Amazon S3 did not let this access key write.");
      expect(destination.attempts).toBe(1);
    });
  });
});

type RunResultDelivery = RecordingDestination["deliveries"][number];

// Keeps the result type in use where a test reads only some of it.
export type { AuditLogExportRunResult };
