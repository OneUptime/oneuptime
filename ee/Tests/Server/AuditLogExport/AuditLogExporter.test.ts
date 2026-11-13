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
import {
  AuditLogExportFailureNotice,
  AuditLogExportFailureNotification,
  AuditLogExportNotifier,
} from "../../../Server/AuditLogExport/AuditLogExportNotifications";
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
import {
  AUDIT_LOG_EXPORT_SCHEMA_VERSIONS,
  AuditLogExportRecord,
  AuditLogExportSchemaVersion,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
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
 * backoff), when the entries a failing export has not sent are deleted
 * (the stamps on them, #6563), and when nothing runs at all (the license,
 * the plan, a lock another worker holds). AuditLogExporterPostgres runs the
 * same exporter on the real AuditLogExport table.
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

  /*
   * #6563: each entry is deleted on the retentionDate the recorder stamped
   * on it, from the retention its project had then. A failing export reads
   * the soonest of those stamps among the entries it has not sent, and
   * hands it to its notifier with the email that is due, whatever the
   * project's retention is now. The emails' words and moments are
   * AuditLogExportNotifications.test.ts's; this is what the exporter reads
   * for them, and when.
   */
  describe("when the entries a failing export has not sent are deleted", () => {
    const MINUTE: number = 60 * 1000;
    const HOUR: number = 60 * MINUTE;
    const DAY: number = 24 * HOUR;

    let told: Array<AuditLogExportFailureNotification & { at: Date }>;
    // The project's retention as it is now.
    let retentionNow: number;

    const telling: AuditLogExportNotifier = {
      getRetentionInDays: async (): Promise<number> => {
        return retentionNow;
      },
      notifyFailure: async (
        data: AuditLogExportFailureNotification,
      ): Promise<void> => {
        told.push({ ...data, at: clock });
      },
    };

    const failingExporter: () => AuditLogExporter = (): AuditLogExporter => {
      return new AuditLogExporter({
        reader: auditLog.reader,
        lock: freeLock(),
        now: (): Date => {
          return clock;
        },
        sleep: async (delayInMs: number): Promise<void> => {
          sleeps.push(delayInMs);
        },
        notifier: telling,
      });
    };

    const notices: () => Array<AuditLogExportFailureNotice> =
      (): Array<AuditLogExportFailureNotice> => {
        return told.map(
          (
            data: AuditLogExportFailureNotification,
          ): AuditLogExportFailureNotice => {
            return data.notice;
          },
        );
      };

    // Every try the export asks for, up to `until`.
    const tryUntil: (
      exports: InMemoryExports,
      row: StoredExport,
      until: Date,
    ) => Promise<void> = async (
      exports: InMemoryExports,
      row: StoredExport,
      until: Date,
    ): Promise<void> => {
      for (;;) {
        await failingExporter().exportAll();

        const next: Date | null = exports.get(row._id).nextAttemptAt;

        if (!next || next.getTime() > until.getTime()) {
          return;
        }

        clock = next;
      }
    };

    const recorded: (data: {
      secondsAgo: number;
      retentionInDays?: number | undefined;
      retentionDate?: Date | undefined;
      projectId?: string | undefined;
    }) => string = (data: {
      secondsAgo: number;
      retentionInDays?: number | undefined;
      retentionDate?: Date | undefined;
      projectId?: string | undefined;
    }): string => {
      return String(
        auditLog.add({
          createdAt: secondsBefore(data.secondsAgo),
          retentionInDays: data.retentionInDays,
          retentionDate: data.retentionDate,
          projectId: data.projectId,
        })["_id"],
      );
    };

    beforeEach(() => {
      told = [];
      retentionNow = 7;
      webhook.failNext(
        100_000,
        new AuditLogExportDeliveryError("refused the key (HTTP 401)", {
          retryable: false,
          status: 401,
        }),
      );
      s3.failNext(
        100_000,
        new AuditLogExportDeliveryError("AccessDenied (HTTP 403)", {
          retryable: false,
          status: 403,
        }),
      );
    });

    test("only once an email can be due, it reads the soonest stamp of the entries after the export's cursor, its project's only, up to the try", async () => {
      // Sent before the failures began, and stamped to go sooner than anything waiting.
      const sent: string = recorded({
        secondsAgo: 900,
        retentionDate: new Date(NOW.getTime() + DAY),
      });
      const waiting: string = recorded({ secondsAgo: 600, retentionInDays: 7 });
      recorded({ secondsAgo: 300, retentionInDays: 30 });
      // Another project's, after the cursor and stamped sooner: not this export's.
      recorded({
        secondsAgo: 400,
        projectId: PROJECT_B,
        retentionDate: new Date(NOW.getTime() + 2 * DAY),
      });
      const row: StoredExport = webhookExport({
        startsAt: new Date(NOW.getTime() - HOUR),
        cursorCreatedAt: new Date(secondsBefore(900)),
        cursorEntryId: sent,
      });
      const exports: InMemoryExports = useInMemoryExports([row]);

      await tryUntil(exports, row, new Date(NOW.getTime() + 29 * MINUTE));

      // No email can be due in the first 30 minutes: nothing read for one.
      expect(auditLog.soonestReads).toEqual([]);

      await tryUntil(exports, row, new Date(NOW.getTime() + 2 * HOUR));

      expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
      expect(told[0]!.entriesLostAt!.toISOString()).toBe(
        auditLog.stampOf(waiting).toISOString(),
      );
      expect(auditLog.soonestReads.length).toBeGreaterThan(0);

      for (const read of auditLog.soonestReads) {
        expect(read.until.getTime()).toBeGreaterThanOrEqual(
          NOW.getTime() + 30 * MINUTE,
        );
        expect({ ...read, until: null }).toEqual({
          projectId: PROJECT_A,
          startsAt: new Date(NOW.getTime() - HOUR),
          until: null,
          after: { createdAt: new Date(secondsBefore(900)), id: sent },
        });
      }
    });

    test("lengthened from 7 days to 30 while entries wait: the notifier is handed their own 7-day stamp, and 'losing entries' comes 24 hours before it", async () => {
      retentionNow = 30;
      const first: string = recorded({ secondsAgo: 300, retentionInDays: 7 });
      recorded({ secondsAgo: 240, retentionInDays: 7 });
      const row: StoredExport = webhookExport({
        startsAt: new Date(NOW.getTime() - HOUR),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      const stamped: Date = auditLog.stampOf(first);
      const losingAt: number = stamped.getTime() - 24 * HOUR;

      await tryUntil(exports, row, new Date(losingAt - 1));

      expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);

      await tryUntil(exports, row, new Date(losingAt + HOUR));

      expect(notices()).toEqual([
        AuditLogExportFailureNotice.Failing,
        AuditLogExportFailureNotice.LosingEntries,
      ]);
      expect(told[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
      expect(told[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
      expect(told[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
      // The retention as it is now travels with it, for the email's other words.
      expect(told[1]!.retentionInDays).toBe(30);
    });

    test("shortened from 30 days to 7 while entries wait: no 'losing entries' when a week would have ended, and one 24 hours before their 30-day stamp", async () => {
      retentionNow = 7;
      const first: string = recorded({ secondsAgo: 300, retentionInDays: 30 });
      const row: StoredExport = webhookExport({
        startsAt: new Date(NOW.getTime() - HOUR),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      const stamped: Date = auditLog.stampOf(first);
      const losingAt: number = stamped.getTime() - 24 * HOUR;

      // Past where the 7 days the project keeps now would have put it.
      await tryUntil(exports, row, new Date(NOW.getTime() + 8 * DAY));

      expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);

      await tryUntil(exports, row, new Date(losingAt + HOUR));

      expect(notices()).toEqual([
        AuditLogExportFailureNotice.Failing,
        AuditLogExportFailureNotice.LosingEntries,
      ]);
      expect(told[1]!.at.getTime()).toBeGreaterThanOrEqual(losingAt);
      expect(told[1]!.at.getTime() - losingAt).toBeLessThanOrEqual(HOUR);
      expect(told[1]!.entriesLostAt!.toISOString()).toBe(stamped.toISOString());
    });

    test("the instance's export: the soonest stamp among every project's entries waiting, a newer one from a project that keeps them a week", async () => {
      recorded({ secondsAgo: 600, retentionInDays: 30, projectId: PROJECT_A });
      const soonest: string = recorded({
        secondsAgo: 300,
        retentionInDays: 7,
        projectId: PROJECT_B,
      });
      const row: StoredExport = s3Export({
        projectId: null,
        startsAt: new Date(NOW.getTime() - HOUR),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);

      await tryUntil(exports, row, new Date(NOW.getTime() + 2 * HOUR));

      expect(notices()).toEqual([AuditLogExportFailureNotice.Failing]);
      // The oldest entry is A's; the first to go is B's.
      expect(told[0]!.oldestUnsentAt!.toISOString()).toBe(secondsBefore(600));
      expect(told[0]!.entriesLostAt!.toISOString()).toBe(
        auditLog.stampOf(soonest).toISOString(),
      );
      expect(
        auditLog.soonestReads.every((read: { projectId: string | null }) => {
          return read.projectId === null;
        }),
      ).toBe(true);
    });

    /*
     * #7185: the first entry waiting can be past its stamp already - the
     * audit log drops a whole part only once every entry in it has passed
     * its own - and the email must then say entries are being lost rather
     * than "fix the destination before" a date in the past. It can tell
     * only from the time of the try, which the exporter hands on with the
     * moment: the clock the try ran on, never the one the email is sent on.
     */
    test("an entry past its own stamp: the notifier is handed that stamp with the try's own time, which it has passed", async () => {
      retentionNow = 30;
      // Recorded nine days ago with a week's retention: past its stamp, not dropped yet.
      const expired: string = recorded({
        secondsAgo: 9 * 24 * 60 * 60,
        retentionInDays: 7,
      });
      recorded({ secondsAgo: 300, retentionInDays: 30 });
      const row: StoredExport = webhookExport({
        startsAt: new Date(NOW.getTime() - 30 * DAY),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);

      await tryUntil(exports, row, new Date(NOW.getTime() + 2 * HOUR));

      expect(notices()).toEqual([AuditLogExportFailureNotice.LosingEntries]);
      expect(told[0]!.entriesLostAt!.toISOString()).toBe(
        auditLog.stampOf(expired).toISOString(),
      );
      // The try it was due on, the first 30 minutes in: its own clock, not today's.
      expect(told[0]!.now.toISOString()).toBe(told[0]!.at.toISOString());
      expect(told[0]!.now.getTime()).toBeGreaterThanOrEqual(
        NOW.getTime() + 30 * MINUTE,
      );
      expect(told[0]!.now.getTime()).toBeLessThan(NOW.getTime() + HOUR);
      expect(told[0]!.entriesLostAt!.getTime()).toBeLessThan(
        told[0]!.now.getTime(),
      );
    });

    test("every notification carries the time of the try it was due on, a date still ahead of it included", async () => {
      const first: string = recorded({ secondsAgo: 300, retentionInDays: 7 });
      const row: StoredExport = webhookExport({
        startsAt: new Date(NOW.getTime() - HOUR),
      });
      const exports: InMemoryExports = useInMemoryExports([row]);
      const losingAt: number = auditLog.stampOf(first).getTime() - 24 * HOUR;

      await tryUntil(exports, row, new Date(losingAt + HOUR));

      expect(notices()).toEqual([
        AuditLogExportFailureNotice.Failing,
        AuditLogExportFailureNotice.LosingEntries,
      ]);

      for (const notification of told) {
        expect(notification.now.toISOString()).toBe(
          notification.at.toISOString(),
        );
        // A day ahead, or more: the email keeps "will start losing entries".
        expect(
          notification.entriesLostAt!.getTime() - notification.now.getTime(),
        ).toBeGreaterThanOrEqual(23 * HOUR);
      }
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

  /*
   * Issue #6247: each export sends the record version it says. One saved
   * before version 2 existed keeps version 1 (the column's default), so
   * whatever reads it keeps working; version 2 adds each change's summary
   * lines - a workflow save's steps - and changes nothing else.
   */
  describe("the record version each export sends", () => {
    const WORKFLOW_SAVE: Record<string, unknown> = {
      field: "graph",
      oldValue: "1 step and no connections",
      newValue: "2 steps and 1 connection",
      summary: [
        'Added "Log" (log-1)',
        'Connected "Manual" (manual-1) to "Log" (log-1)',
      ],
    };

    function sentChanges(): Array<unknown> {
      return webhook.batches.flatMap(
        (batch: { records: Array<AuditLogExportRecord> }) => {
          return batch.records.flatMap((record: AuditLogExportRecord) => {
            return record.changes;
          });
        },
      );
    }

    function sentVersions(): Array<number> {
      return webhook.batches.flatMap(
        (batch: { records: Array<AuditLogExportRecord> }) => {
          return batch.records.map((record: AuditLogExportRecord): number => {
            return record.schemaVersion;
          });
        },
      );
    }

    test("an export saved before version 2 sends version 1, as it always did", async () => {
      useInMemoryExports([webhookExport({ schemaVersion: 1 })]);
      auditLog.add({
        createdAt: secondsBefore(120),
        changes: [WORKFLOW_SAVE as never],
      });

      await exporter().exportAll();

      expect(sentVersions()).toEqual([1]);
      expect(sentChanges()).toEqual([
        {
          field: "graph",
          oldValue: "1 step and no connections",
          newValue: "2 steps and 1 connection",
        },
      ]);
    });

    test("a version 2 export sends what changed in the workflow's steps", async () => {
      useInMemoryExports([webhookExport({ schemaVersion: 2 })]);
      auditLog.add({
        createdAt: secondsBefore(120),
        changes: [
          WORKFLOW_SAVE as never,
          { field: "name", oldValue: "Page", newValue: "Page the team" },
        ],
      });

      await exporter().exportAll();

      expect(sentVersions()).toEqual([2]);
      expect(sentChanges()).toEqual([
        WORKFLOW_SAVE,
        {
          field: "name",
          oldValue: "Page",
          newValue: "Page the team",
          summary: null,
        },
      ]);
    });

    test("a version the row holds that this release does not know is sent as version 1", async () => {
      for (const schemaVersion of [0, 3, Number.NaN]) {
        jest.restoreAllMocks();
        webhook.batches.length = 0;
        useInMemoryExports([webhookExport({ schemaVersion })]);
        auditLog.add({ createdAt: secondsBefore(120) });

        await exporter().exportAll();

        expect([schemaVersion, new Set(sentVersions())]).toEqual([
          schemaVersion,
          new Set([1]),
        ]);
      }
    });

    test("switched to version 2, an export sends it from its next batch; what was delivered stays as sent", async () => {
      const row: StoredExport = webhookExport({ schemaVersion: 1 });
      useInMemoryExports([row]);
      auditLog.add({
        createdAt: secondsBefore(300),
        changes: [WORKFLOW_SAVE as never],
      });

      await exporter().exportAll();

      row.schemaVersion = 2;
      auditLog.add({
        createdAt: secondsBefore(120),
        changes: [WORKFLOW_SAVE as never],
      });

      await exporter().exportAll();

      expect(sentVersions()).toEqual([1, 2]);
      expect(
        (sentChanges() as Array<Record<string, unknown>>).map(
          (change: Record<string, unknown>): unknown => {
            return change["summary"];
          },
        ),
      ).toEqual([undefined, WORKFLOW_SAVE["summary"]]);
    });

    test("a file destination writes each line in the export's version too", async () => {
      for (const schemaVersion of AUDIT_LOG_EXPORT_SCHEMA_VERSIONS) {
        jest.restoreAllMocks();
        s3.batches.length = 0;
        useInMemoryExports([
          s3Export({
            schemaVersion,
            startsAt: new Date("2026-10-24T00:00:00.000Z"),
          }),
        ]);
        // Old enough for a file to be written at once.
        auditLog.add({
          createdAt: "2026-10-24T08:00:00.000Z",
          changes: [WORKFLOW_SAVE as never],
        });

        await exporter().exportAll();

        const record: AuditLogExportRecord = s3.batches[0]!.records[0]!;

        expect(record.schemaVersion).toBe(schemaVersion);
        expect(
          Object.prototype.hasOwnProperty.call(record.changes[0], "summary"),
        ).toBe(schemaVersion === 2);
      }
    });
  });

  describe("toBatch", () => {
    test("in a version, every record is that version; with none named, version 1", () => {
      const rows: Array<Record<string, unknown>> = [
        {
          _id: ObjectID.generate().toString(),
          createdAt: "2026-10-24 09:00:01",
          changes: JSON.stringify([
            { field: "graph", summary: ['Added "Log" (log-1)'] },
          ]),
        },
      ];

      for (const schemaVersion of [
        ...AUDIT_LOG_EXPORT_SCHEMA_VERSIONS,
        undefined,
      ] as Array<AuditLogExportSchemaVersion | undefined>) {
        const batch: Array<AuditLogExportRecord> = AuditLogExporter.toBatch({
          rows: rows as never,
          maxBytes: 1024 * 1024,
          schemaVersion,
        });

        expect(batch[0]!.schemaVersion).toBe(schemaVersion || 1);
        expect(batch[0]!.changes[0]!.summary).toEqual(
          schemaVersion === 2 ? ['Added "Log" (log-1)'] : undefined,
        );
      }
    });

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

    test("a test arrives in the version the export sends, the first when none is named", async () => {
      for (const schemaVersion of [
        ...AUDIT_LOG_EXPORT_SCHEMA_VERSIONS,
        undefined,
      ] as Array<AuditLogExportSchemaVersion | undefined>) {
        const destination: RecordingDestination = new RecordingDestination();

        await AuditLogExporter.sendTest({
          settings: {
            type: AuditLogExportDestinationType.Webhook,
            config: { url: "https://93.184.216.34/audit" },
            secrets: {},
          },
          isInstanceExport: true,
          projectId: null,
          schemaVersion,
          destination,
          now: NOW,
        });

        expect(destination.deliveries[0]!.batch.records[0]!.schemaVersion).toBe(
          schemaVersion || 1,
        );
      }
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
