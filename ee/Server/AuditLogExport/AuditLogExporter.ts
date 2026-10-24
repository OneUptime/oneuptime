import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
/*
 * IsBillingEnabled is read inside function bodies only: the compiled CommonJS
 * reads the live module binding at call time, which is what lets a test pin
 * billing by mocking EnvironmentConfig.
 */
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import AuditLogExportService, {
  Service as AuditLogExportServiceClass,
} from "Common/Server/Services/AuditLogExportService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import AuditLogExportSettingsUtil, {
  AuditLogExportSettings,
} from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import { EgressGuardOptions } from "Common/Server/Utils/DataSource/EgressGuard";
import logger from "Common/Server/Utils/Logger";
import ConnectorErrorMessage from "Common/Server/Utils/SecurityEvent/ConnectorErrorMessage";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import Project from "Common/Models/DatabaseModels/Project";
import {
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationKind,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import {
  AuditLogExportRecord,
  buildAuditLogExportTestRecord,
  serializeAuditLogExportRecord,
  toAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AuditLogExportDestinationRegistry from "./Destinations/DestinationRegistry";
import {
  AuditLogExportBatch,
  AuditLogExportDeliveryError,
  AuditLogExportDeliveryReceipt,
  AuditLogExportDestination,
} from "./Destinations/Types";

/*
 * THE AUDIT LOG EXPORTER: every minute, each enabled export is sent what
 * was recorded since its cursor, a batch at a time, oldest first.
 *
 * WHAT. Every entry recorded from the export's Export From on: its
 * project's entries, or every project's for an instance export. One JSON
 * object per entry (AuditLogExportRecord, schemaVersion 1).
 *
 * HOW OFTEN. A stream (webhook, syslog) is sent each batch as soon as it is
 * read, so entries arrive about a minute after they are recorded. A file
 * destination waits until a batch is full or its first entry is five
 * minutes old, so a quiet project writes a file every few minutes rather
 * than one per entry.
 *
 * NOTHING LOST, NOTHING SENT TWICE. The cursor is the last entry delivered
 * - its createdAt and its _id - kept on the export's row in Postgres, so a
 * restart, a deploy or another worker goes on exactly where the last
 * delivery ended:
 *
 *   - entries are read in (createdAt, _id) order, after the cursor, and only
 *     up to a minute ago (AUDIT_LOG_EXPORT_SETTLE_IN_SECONDS): an entry
 *     still being written is read by the next batch rather than falling
 *     behind the cursor;
 *   - one export is sent by one worker at a time (a Valkey lock per export);
 *   - the cursor moves only after the destination took the batch, and only
 *     if it is still where this run read it from (a compare-and-set): an
 *     export restarted from another date, or one a second worker reached,
 *     is never moved backwards or over;
 *   - a batch read again - after a delivery whose cursor could not be
 *     saved - is the same batch: a file destination writes the same file
 *     name (the first entry's), a stream gets the same X-OneUptime-Batch-Id,
 *     and every entry carries its own id. Delivery is at least once, and a
 *     repeat can always be recognised.
 *
 * A DESTINATION THAT IS DOWN. A delivery is tried three times (one and four
 * seconds apart) when trying again can help - a timeout, a 5xx, a rate
 * limit - and once when it cannot (a refused key, a bucket that does not
 * exist). Then the export records why (lastError, in words that say what to
 * change), since when it fails (failingSince) and when it tries again
 * (nextAttemptAt): one minute, then two, four... up to an hour between
 * tries. Nothing queues up anywhere: the entries wait in the audit log
 * itself, and the next successful delivery catches up, oldest first. An
 * entry older than its project's audit log retention is deleted before it
 * can be sent, which is the only way one is lost - the page says so.
 *
 * WHEN IT STOPS. Without the Enterprise Edition (self-hosted: a license
 * that includes audit logs) nothing is exported, as nothing is recorded; on
 * OneUptime Cloud a project's export runs only while the project is on the
 * Enterprise plan.
 */

// Entries younger than this are left for the next batch.
export const AUDIT_LOG_EXPORT_SETTLE_IN_SECONDS: number = 60;

// How long a file destination waits for a batch to fill.
export const AUDIT_LOG_EXPORT_FILE_WAIT_IN_SECONDS: number = 5 * 60;

// The most batches one export is sent in one run.
export const AUDIT_LOG_EXPORT_MAX_BATCHES_PER_RUN: number = 20;

// How long one run goes on starting new batches.
export const AUDIT_LOG_EXPORT_RUN_BUDGET_IN_MS: number = 4 * 60 * 1000;

// Exports sent at the same time in one run.
export const AUDIT_LOG_EXPORT_CONCURRENCY: number = 4;

export const AUDIT_LOG_EXPORT_DELIVERY_ATTEMPTS: number = 3;
export const AUDIT_LOG_EXPORT_RETRY_DELAYS_IN_MS: ReadonlyArray<number> = [
  1000, 4000,
];

// The longest wait between two tries of a failing destination.
export const AUDIT_LOG_EXPORT_MAX_BACKOFF_IN_MINUTES: number = 60;

/*
 * How long the lock of one export lasts each time it is kept: longer than
 * one batch can take (three tries of a minute each), and kept between
 * batches.
 */
export const AUDIT_LOG_EXPORT_LOCK_TIMEOUT_IN_MS: number = 6 * 60 * 1000;

export const AUDIT_LOG_EXPORT_PLAN_REQUIRED_MESSAGE: string =
  "Audit log export needs the Enterprise plan. It resumes, from where it stopped, when the project is back on the Enterprise plan.";

// Minutes to wait after the n-th failure in a row: 1, 2, 4, 8, 16, 32, 60, 60...
export function getAuditLogExportBackoffInMinutes(
  consecutiveFailures: number,
): number {
  const failures: number = Math.max(1, Math.trunc(consecutiveFailures));

  if (failures > 7) {
    return AUDIT_LOG_EXPORT_MAX_BACKOFF_IN_MINUTES;
  }

  return Math.min(
    AUDIT_LOG_EXPORT_MAX_BACKOFF_IN_MINUTES,
    Math.pow(2, failures - 1),
  );
}

// Where the audit log is read from: AuditLogService (ClickHouse) by default.
export type AuditLogExportEntryReader = Pick<
  typeof AuditLogService,
  "findEntriesForExport"
>;

// The lock that keeps one export to one worker; Valkey by default.
export interface AuditLogExportLock {
  acquire(exportId: string): Promise<SemaphoreMutex | null>;
  keep(mutex: SemaphoreMutex): Promise<boolean>;
  release(mutex: SemaphoreMutex): Promise<void>;
}

export const valkeyAuditLogExportLock: AuditLogExportLock = {
  acquire: async (exportId: string): Promise<SemaphoreMutex | null> => {
    try {
      return await Semaphore.lock({
        namespace: "AuditLogExport",
        key: exportId,
        lockTimeout: AUDIT_LOG_EXPORT_LOCK_TIMEOUT_IN_MS,
        acquireAttemptsLimit: 1,
        // Kept between batches (keep), never on a timer.
        refreshInterval: 0,
      });
    } catch {
      // Another worker is sending this export.
      return null;
    }
  },
  keep: async (mutex: SemaphoreMutex): Promise<boolean> => {
    try {
      return await Semaphore.keepLock(mutex);
    } catch {
      return false;
    }
  },
  release: async (mutex: SemaphoreMutex): Promise<void> => {
    await Semaphore.release(mutex).catch((): void => {
      // The lock runs out on its own.
    });
  },
};

export interface AuditLogExportRunResult {
  exportId: string;
  delivered: number;
  batches: number;
  // Why it stopped with a failure, or "".
  failure: string;
  // A file destination waiting for its batch to fill.
  waitingForMore: boolean;
  // Why nothing was tried: "locked", "plan", or "".
  skipped: string;
}

export interface AuditLogExporterSummary {
  // Why the run did nothing at all, or "".
  skipped: string;
  exports: Array<AuditLogExportRunResult>;
}

type SleepFunction = (delayInMs: number) => Promise<void>;

const defaultSleep: SleepFunction = (delayInMs: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, delayInMs);
  });
};

export interface AuditLogExporterOptions {
  reader?: AuditLogExportEntryReader | undefined;
  lock?: AuditLogExportLock | undefined;
  now?: (() => Date) | undefined;
  sleep?: SleepFunction | undefined;
}

// The export's columns every run reads.
const EXPORT_SELECT: Record<string, boolean> = {
  _id: true,
  projectId: true,
  name: true,
  destinationType: true,
  config: true,
  secrets: true,
  isEnabled: true,
  startsAt: true,
  createdAt: true,
  cursorCreatedAt: true,
  cursorEntryId: true,
  exportedEntryCount: true,
  lastError: true,
  failingSince: true,
  consecutiveFailureCount: true,
  nextAttemptAt: true,
};

export default class AuditLogExporter {
  private readonly reader: AuditLogExportEntryReader;
  private readonly lock: AuditLogExportLock;
  private readonly now: () => Date;
  private readonly sleep: SleepFunction;

  public constructor(options: AuditLogExporterOptions = {}) {
    this.reader = options.reader || AuditLogService;
    this.lock = options.lock || valkeyAuditLogExportLock;
    this.now =
      options.now ||
      ((): Date => {
        return OneUptimeDate.getCurrentDate();
      });
    this.sleep = options.sleep || defaultSleep;
  }

  /*
   * Whether exports run at all here: self-hosted, while the license covers
   * audit logs (as recording does); with billing on, always - each
   * project's plan is asked on its own.
   */
  public static isExportingActive(): boolean {
    if (IsBillingEnabled) {
      return true;
    }

    return EnterpriseEdition.isFeatureActive(EnterpriseFeature.AuditLogs);
  }

  // The job's run: every enabled export that is due.
  public async exportAll(): Promise<AuditLogExporterSummary> {
    if (!AuditLogExporter.isExportingActive()) {
      return { skipped: "license", exports: [] };
    }

    const startedAt: Date = this.now();
    const deadline: number =
      startedAt.getTime() + AUDIT_LOG_EXPORT_RUN_BUDGET_IN_MS;

    const exports: Array<AuditLogExport> = await AuditLogExportService.findAllBy(
      {
        query: { isEnabled: true },
        select: { _id: true, nextAttemptAt: true },
        sort: { _id: SortOrder.Ascending },
        props: { isRoot: true },
      },
    );

    const due: Array<AuditLogExport> = exports.filter(
      (item: AuditLogExport): boolean => {
        return (
          !item.nextAttemptAt ||
          new Date(item.nextAttemptAt).getTime() <= startedAt.getTime()
        );
      },
    );

    const results: Array<AuditLogExportRunResult> = [];
    const queue: Array<AuditLogExport> = [...due];
    const planCache: Map<string, boolean> = new Map<string, boolean>();

    const worker: () => Promise<void> = async (): Promise<void> => {
      for (;;) {
        const next: AuditLogExport | undefined = queue.shift();

        if (!next || !next.id || this.now().getTime() >= deadline) {
          return;
        }

        try {
          results.push(
            await this.exportWithLock({
              exportId: next.id,
              deadline,
              planCache,
            }),
          );
        } catch (error) {
          logger.error(
            `AuditLogExport: export ${next.id.toString()} failed unexpectedly:`,
          );
          logger.error(error);
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(AUDIT_LOG_EXPORT_CONCURRENCY, due.length) },
        (): Promise<void> => {
          return worker();
        },
      ),
    );

    return { skipped: "", exports: results };
  }

  // One export, by one worker at a time.
  public async exportWithLock(data: {
    exportId: ObjectID;
    deadline: number;
    planCache?: Map<string, boolean> | undefined;
  }): Promise<AuditLogExportRunResult> {
    const mutex: SemaphoreMutex | null = await this.lock.acquire(
      data.exportId.toString(),
    );

    if (!mutex) {
      return AuditLogExporter.emptyResult(data.exportId, "locked");
    }

    try {
      // Read again under the lock: the cursor another worker left is the one to go on from.
      const item: AuditLogExport | null =
        await AuditLogExportService.findOneById({
          id: data.exportId,
          select: EXPORT_SELECT,
          props: { isRoot: true },
        });

      if (!item || !item.isEnabled) {
        return AuditLogExporter.emptyResult(data.exportId, "disabled");
      }

      return await this.exportOne({
        item,
        deadline: data.deadline,
        mutex,
        planCache: data.planCache || new Map<string, boolean>(),
      });
    } finally {
      await this.lock.release(mutex);
    }
  }

  private static emptyResult(
    exportId: ObjectID,
    skipped: string,
  ): AuditLogExportRunResult {
    return {
      exportId: exportId.toString(),
      delivered: 0,
      batches: 0,
      failure: "",
      waitingForMore: false,
      skipped,
    };
  }

  private async isOnEnterprisePlan(
    projectId: ObjectID,
    planCache: Map<string, boolean>,
  ): Promise<boolean> {
    const key: string = projectId.toString();
    const cached: boolean | undefined = planCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { _id: true, planName: true },
      props: { isRoot: true },
    });

    const isOnPlan: boolean = project?.planName === PlanType.Enterprise;
    planCache.set(key, isOnPlan);

    return isOnPlan;
  }

  public async exportOne(data: {
    item: AuditLogExport;
    deadline: number;
    mutex?: SemaphoreMutex | undefined;
    planCache?: Map<string, boolean> | undefined;
  }): Promise<AuditLogExportRunResult> {
    const item: AuditLogExport = data.item;
    const exportId: ObjectID = item.id!;
    const result: AuditLogExportRunResult = AuditLogExporter.emptyResult(
      exportId,
      "",
    );

    if (
      IsBillingEnabled &&
      item.projectId &&
      !(await this.isOnEnterprisePlan(
        item.projectId,
        data.planCache || new Map<string, boolean>(),
      ))
    ) {
      result.skipped = "plan";

      if (item.lastError !== AUDIT_LOG_EXPORT_PLAN_REQUIRED_MESSAGE) {
        await this.writeBookkeeping(exportId, {
          lastError: AUDIT_LOG_EXPORT_PLAN_REQUIRED_MESSAGE,
        });
      }

      return result;
    }

    let settings: AuditLogExportSettings;
    let definition: AuditLogExportDestinationDefinition;
    let destination: AuditLogExportDestination;

    try {
      settings = await AuditLogExportService.getSettings(item);
      definition = AuditLogExportSettingsUtil.getDefinitionOrThrow(
        settings.type,
      );
      destination = AuditLogExportDestinationRegistry.getDestination(
        settings.type,
      );
    } catch (error) {
      result.failure = ConnectorErrorMessage.toMessage(error);
      await this.recordFailure(item, result.failure);
      return result;
    }

    const egress: EgressGuardOptions = AuditLogExportSettingsUtil.getEgressOptions(
      {
        isInstanceExport: AuditLogExportServiceClass.isInstanceExport(item),
        targetLabel: definition.title,
      },
    );

    const startsAt: Date = new Date(
      item.startsAt || item.createdAt || this.now(),
    );

    let cursor: { createdAt: Date; id: ObjectID } | null =
      item.cursorCreatedAt && item.cursorEntryId
        ? {
            createdAt: new Date(item.cursorCreatedAt),
            id: new ObjectID(item.cursorEntryId.toString()),
          }
        : null;
    let exportedEntryCount: number = item.exportedEntryCount || 0;

    while (
      result.batches < AUDIT_LOG_EXPORT_MAX_BATCHES_PER_RUN &&
      this.now().getTime() < data.deadline
    ) {
      const now: Date = this.now();
      const until: Date = OneUptimeDate.addRemoveSeconds(
        now,
        -AUDIT_LOG_EXPORT_SETTLE_IN_SECONDS,
      );

      if (until.getTime() < startsAt.getTime()) {
        break;
      }

      const rows: Array<JSONObject> = await this.reader.findEntriesForExport({
        projectId: item.projectId || null,
        startsAt,
        until,
        after: cursor,
        limit: definition.maxEntriesPerBatch,
      });

      if (rows.length === 0) {
        break;
      }

      const records: Array<AuditLogExportRecord> = AuditLogExporter.toBatch({
        rows,
        maxBytes: definition.maxBytesPerBatch,
      });

      const first: AuditLogExportRecord | undefined = records[0];
      const last: AuditLogExportRecord | undefined =
        records[records.length - 1];

      if (!first || !last) {
        break;
      }

      const isEverythingAvailable: boolean =
        rows.length < definition.maxEntriesPerBatch &&
        records.length === rows.length;

      if (
        definition.kind === AuditLogExportDestinationKind.Files &&
        isEverythingAvailable &&
        now.getTime() - new Date(first.createdAt).getTime() <
          AUDIT_LOG_EXPORT_FILE_WAIT_IN_SECONDS * 1000
      ) {
        result.waitingForMore = true;
        break;
      }

      const batch: AuditLogExportBatch = {
        id: first.id,
        records,
        firstCreatedAt: new Date(first.createdAt),
        isTest: false,
      };

      try {
        await this.deliverWithRetries(destination, {
          settings,
          batch,
          egress,
        });
      } catch (error) {
        result.failure = ConnectorErrorMessage.toMessage(error);
        await this.recordFailure(item, result.failure);
        return result;
      }

      const nextCursor: { createdAt: Date; id: ObjectID } = {
        createdAt: new Date(last.createdAt),
        id: new ObjectID(last.id),
      };
      const deliveredAt: Date = this.now();

      const isStillOurs: boolean =
        await AuditLogExportService.compareAndSetColumnsByIdWithoutHooks({
          id: exportId,
          expectedData: {
            cursorCreatedAt: (cursor ? cursor.createdAt : null) as Date,
            cursorEntryId: (cursor ? cursor.id : null) as ObjectID,
          },
          data: {
            cursorCreatedAt: nextCursor.createdAt,
            cursorEntryId: nextCursor.id,
            exportedEntryCount: exportedEntryCount + records.length,
            lastExportedAt: deliveredAt,
            lastAttemptAt: deliveredAt,
            lastError: null as unknown as string,
            failingSince: null as unknown as Date,
            consecutiveFailureCount: 0,
            nextAttemptAt: null as unknown as Date,
          },
        });

      result.batches += 1;
      result.delivered += records.length;

      if (!isStillOurs) {
        /*
         * Someone moved the cursor since this run read it: the export was
         * started again from another date, or another worker sent it. The
         * batch was delivered (and is recognisable by its id); this run
         * stops rather than write over theirs.
         */
        return result;
      }

      cursor = nextCursor;
      exportedEntryCount += records.length;

      if (data.mutex && !(await this.lock.keep(data.mutex))) {
        // The lock ran out: another worker may have the export now.
        return result;
      }
    }

    return result;
  }

  /*
   * The batch from what was read: every valid entry, in order, up to the
   * destination's byte limit - always at least one, so an entry larger
   * than the limit on its own still goes, alone.
   */
  public static toBatch(data: {
    rows: Array<JSONObject>;
    maxBytes: number;
  }): Array<AuditLogExportRecord> {
    const records: Array<AuditLogExportRecord> = [];
    let bytes: number = 0;

    for (const row of data.rows) {
      const record: AuditLogExportRecord | null = toAuditLogExportRecord(row);

      if (!record) {
        continue;
      }

      const size: number =
        Buffer.byteLength(serializeAuditLogExportRecord(record), "utf8") + 1;

      if (records.length > 0 && bytes + size > data.maxBytes) {
        break;
      }

      records.push(record);
      bytes += size;
    }

    return records;
  }

  private async deliverWithRetries(
    destination: AuditLogExportDestination,
    delivery: Parameters<AuditLogExportDestination["deliver"]>[0],
  ): Promise<AuditLogExportDeliveryReceipt> {
    for (
      let attempt: number = 1;
      attempt <= AUDIT_LOG_EXPORT_DELIVERY_ATTEMPTS;
      attempt++
    ) {
      try {
        return await destination.deliver(delivery);
      } catch (error) {
        const isRetryable: boolean =
          error instanceof AuditLogExportDeliveryError && error.retryable;

        if (!isRetryable || attempt >= AUDIT_LOG_EXPORT_DELIVERY_ATTEMPTS) {
          throw error;
        }

        await this.sleep(
          AUDIT_LOG_EXPORT_RETRY_DELAYS_IN_MS[attempt - 1] ||
            AUDIT_LOG_EXPORT_RETRY_DELAYS_IN_MS[
              AUDIT_LOG_EXPORT_RETRY_DELAYS_IN_MS.length - 1
            ]!,
        );
      }
    }

    // The loop returns or throws on its last attempt.
    throw new AuditLogExportDeliveryError("The delivery was not attempted.", {
      retryable: true,
    });
  }

  // A failure, the time it is tried again, and since when it fails: never throws.
  private async recordFailure(
    item: AuditLogExport,
    message: string,
  ): Promise<void> {
    const now: Date = this.now();
    const failures: number = (item.consecutiveFailureCount || 0) + 1;

    await this.writeBookkeeping(item.id!, {
      lastAttemptAt: now,
      lastError: message,
      failingSince: item.failingSince ? new Date(item.failingSince) : now,
      consecutiveFailureCount: failures,
      nextAttemptAt: OneUptimeDate.addRemoveMinutes(
        now,
        getAuditLogExportBackoffInMinutes(failures),
      ),
    });
  }

  private async writeBookkeeping(
    exportId: ObjectID,
    data: {
      lastAttemptAt?: Date;
      lastError?: string;
      failingSince?: Date;
      consecutiveFailureCount?: number;
      nextAttemptAt?: Date;
    },
  ): Promise<void> {
    await ConnectorErrorMessage.recordFailure({
      label: `AuditLogExport: export ${exportId.toString()}`,
      write: async (): Promise<void> => {
        await AuditLogExportService.updateColumnsByIdWithoutHooks({
          id: exportId,
          data,
        });
      },
    });
  }

  /*
   * One test entry, sent with settings that may never have been saved, so
   * a person setting a destination up sees it arrive in its real shape
   * before anything real is sent. A file destination writes it to one fixed
   * name in the folder (overwritten by every test). Tried once: the person
   * is waiting for the answer.
   */
  public static async sendTest(data: {
    settings: AuditLogExportSettings;
    isInstanceExport: boolean;
    projectId: ObjectID | null;
    destination?: AuditLogExportDestination | undefined;
    now?: Date | undefined;
  }): Promise<AuditLogExportDeliveryReceipt> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const definition: AuditLogExportDestinationDefinition =
      AuditLogExportSettingsUtil.getDefinitionOrThrow(data.settings.type);
    const destination: AuditLogExportDestination =
      data.destination ||
      AuditLogExportDestinationRegistry.getDestination(data.settings.type);
    const record: AuditLogExportRecord = buildAuditLogExportTestRecord({
      now,
      id: ObjectID.generate().toString(),
      projectId: data.projectId ? data.projectId.toString() : null,
    });

    return destination.deliver({
      settings: data.settings,
      batch: {
        id: record.id,
        records: [record],
        firstCreatedAt: now,
        isTest: true,
      },
      egress: AuditLogExportSettingsUtil.getEgressOptions({
        isInstanceExport: data.isInstanceExport,
        targetLabel: definition.title,
      }),
    });
  }
}
