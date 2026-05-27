import MonitorLogService from "../../Services/MonitorLogService";
import GlobalConfigService from "../../Services/GlobalConfigService";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import DataToProcess from "./DataToProcess";

/*
 * Maximum rows held in memory before we force a flush, and the
 * maximum time we hold a row in the buffer before flushing.
 *
 * Sizing rationale: 10,000 rows at a few KB each is ~tens of MB
 * of peak heap per process, which is fine for the API/worker
 * processes that run monitor probes. 5 seconds is a tight enough
 * worst-case latency that the dashboard "last log" view feels
 * live, and loose enough that even a single very chatty monitor
 * coalesces dozens to thousands of inserts into one.
 *
 * The legacy implementation called MonitorLogService.insertJsonRows
 * with a one-element array per monitor probe, fire-and-forget.
 * ClickHouse's async_insert deduplicates these into part files,
 * but every call still pays an HTTP round-trip and the
 * @clickhouse/client pool can saturate when probe traffic spikes
 * (e.g. a 10k-monitor project running concurrent probes). Batching
 * collapses N round-trips into N / 10_000 (size-bounded) or
 * N / (5s × per-second-rate) (time-bounded), whichever comes first.
 */
const MONITOR_LOG_FLUSH_BATCH_SIZE: number = 10_000;
const MONITOR_LOG_FLUSH_INTERVAL_MS: number = 5_000;

export default class MonitorLogUtil {
  // Default retention in days if GlobalConfig is not set
  private static readonly DEFAULT_RETENTION_DAYS: number = 1;

  // Cached retention value to avoid querying GlobalConfig on every monitor check
  private static cachedRetentionDays: number | null = null;
  private static lastCacheRefresh: Date | null = null;
  private static readonly CACHE_TTL_MS: number = 5 * 60 * 1000; // 5 minutes

  /*
   * In-process write buffer for MonitorLog rows. Rows accumulate
   * here until either MONITOR_LOG_FLUSH_BATCH_SIZE rows arrive
   * (size trigger) or MONITOR_LOG_FLUSH_INTERVAL_MS elapses since
   * the first row entered an empty buffer (time trigger),
   * whichever comes first. On graceful shutdown the SIGTERM /
   * SIGINT hook below drains the buffer before the process exits.
   */
  private static buffer: Array<JSONObject> = [];
  private static flushTimer: NodeJS.Timeout | null = null;
  private static shutdownHooksRegistered: boolean = false;

  private static async getRetentionDays(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();

    // Return cached value if still fresh
    if (
      this.cachedRetentionDays !== null &&
      this.lastCacheRefresh !== null &&
      now.getTime() - this.lastCacheRefresh.getTime() < this.CACHE_TTL_MS
    ) {
      return this.cachedRetentionDays;
    }

    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          props: {
            isRoot: true,
          },
          select: {
            monitorLogRetentionInDays: true,
          },
        });

      if (
        globalConfig &&
        globalConfig.monitorLogRetentionInDays !== undefined &&
        globalConfig.monitorLogRetentionInDays !== null &&
        globalConfig.monitorLogRetentionInDays > 0
      ) {
        this.cachedRetentionDays = globalConfig.monitorLogRetentionInDays;
      } else {
        this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      }

      this.lastCacheRefresh = now;
    } catch (error) {
      logger.error(
        "Error fetching monitor log retention config, using default:",
      );
      logger.error(error);
      this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      this.lastCacheRefresh = now;
    }

    return this.cachedRetentionDays;
  }

  public static saveMonitorLog(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    dataToProcess: DataToProcess;
  }): void {
    if (!data.monitorId) {
      return;
    }

    if (!data.projectId) {
      return;
    }

    if (!data.dataToProcess) {
      return;
    }

    // Fire-and-forget: fetch retention config then enqueue
    this.getRetentionDays()
      .then((retentionDays: number) => {
        const logIngestionDate: Date = OneUptimeDate.getCurrentDate();
        const logTimestamp: string =
          OneUptimeDate.toClickhouseDateTime(logIngestionDate);

        const retentionDate: Date = OneUptimeDate.addRemoveDays(
          logIngestionDate,
          retentionDays,
        );

        const monitorLogRow: JSONObject = {
          _id: ObjectID.generate().toString(),
          createdAt: logTimestamp,
          updatedAt: logTimestamp,
          projectId: data.projectId.toString(),
          monitorId: data.monitorId.toString(),
          time: logTimestamp,
          logBody: JSON.parse(JSON.stringify(data.dataToProcess)),
          retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
        };

        this.enqueueRow(monitorLogRow);
      })
      .catch((err: Error) => {
        logger.error(err);
      });
  }

  /*
   * Append a row to the buffer, then decide whether to flush
   * immediately (size threshold) or schedule the timed flush
   * (first row in an empty buffer). The timer is intentionally
   * NOT reset on every row — we want strict "at most 5 s of
   * staleness", not "at most 5 s of idle". Resetting per-row
   * could indefinitely delay flush under steady ingest.
   */
  private static enqueueRow(row: JSONObject): void {
    this.ensureShutdownHooks();

    this.buffer.push(row);

    if (this.buffer.length >= MONITOR_LOG_FLUSH_BATCH_SIZE) {
      // Size trigger — flush immediately.
      this.triggerFlush();
      return;
    }

    if (!this.flushTimer && this.buffer.length === 1) {
      // First row in an empty buffer — start the time-based flush.
      this.flushTimer = setTimeout(() => {
        this.triggerFlush();
      }, MONITOR_LOG_FLUSH_INTERVAL_MS);
    }
  }

  /*
   * Synchronous fire-and-forget flush used by the normal hot
   * path: callers must not be blocked waiting for ClickHouse.
   * Swap the buffer out first so new arrivals during the network
   * round-trip land in a fresh array and are not double-flushed.
   */
  private static triggerFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const toFlush: Array<JSONObject> = this.buffer;
    this.buffer = [];

    MonitorLogService.insertJsonRows(toFlush).catch((err: Error) => {
      logger.error(
        `MonitorLog batch insert failed for ${toFlush.length} rows; batch dropped.`,
      );
      logger.error(err);
    });
  }

  /*
   * Awaitable flush used by the SIGTERM / SIGINT shutdown hook
   * so we don't lose buffered rows when Kubernetes / Docker
   * sends the process to bed. Errors are logged but swallowed —
   * a failing flush must not block the rest of the shutdown
   * chain (other handlers may still need to run).
   */
  private static async flushAndWait(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) {
      return;
    }

    const toFlush: Array<JSONObject> = this.buffer;
    this.buffer = [];

    try {
      await MonitorLogService.insertJsonRows(toFlush);
    } catch (err) {
      logger.error(
        `MonitorLog shutdown flush failed for ${toFlush.length} rows; batch dropped.`,
      );
      logger.error(err);
    }
  }

  /*
   * Register SIGTERM / SIGINT handlers exactly once, lazily on
   * first ingest. We avoid registering at module-load time so
   * tooling that imports this file (e.g. migration runners,
   * CLI scripts) doesn't end up with stray process listeners.
   */
  private static ensureShutdownHooks(): void {
    if (this.shutdownHooksRegistered) {
      return;
    }
    this.shutdownHooksRegistered = true;

    const flushOnShutdown: () => Promise<void> = async (): Promise<void> => {
      try {
        await this.flushAndWait();
      } catch (err) {
        logger.error("Error flushing MonitorLog buffer on shutdown:");
        logger.error(err);
      }
    };

    process.on("SIGTERM", flushOnShutdown);
    process.on("SIGINT", flushOnShutdown);
  }
}
