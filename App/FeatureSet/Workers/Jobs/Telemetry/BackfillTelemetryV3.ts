import { EVERY_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import ClickHouseMigrationUtil, {
  ChunkedCopyResult,
  SweepResult,
  TelemetrySignalCopyPair,
} from "../../DataMigrations/ClickHouseMigrationUtil";
import DataMigrations from "../../DataMigrations/Index";
import DataMigrationBase from "../../DataMigrations/DataMigrationBase";
import DataMigrationService from "Common/Server/Services/DataMigrationService";
import DataMigration from "Common/Models/DatabaseModels/DataMigration";
import logger from "Common/Server/Utils/Logger";

/*
 * Telemetry:BackfillTelemetryV3
 *
 * Owns the historical V2 -> V3 telemetry copy that the
 * MigrateTelemetryToV3PrimaryEntityId boot migration deliberately does NOT
 * run inline (it is hours-to-days of work at production scale and used to
 * block the migration runner — and, before the chunked engine, kept
 * re-copying whole partitions after 58s client-side socket timeouts,
 * duplicating rows and double-firing the metric MVs).
 *
 * Every minute (with an in-process re-entrancy guard, since a single chunk
 * can run for many minutes) it:
 *   1. Waits until the boot migration chain has fully completed — copying
 *      while later migrations drop/rebuild the metric MVs would lose
 *      rollup aggregates for the rows copied in that window.
 *   2. For each of the 6 signal-table pairs whose V2 table exists:
 *      enumerates (partition × month) chunks, and copies unmarked ones
 *      through ClickHouseMigrationUtil.copyTableChunked — deterministic
 *      ORDER BY + per-chunk dedup token (retries dedup block-by-block,
 *      including the MV fan-out), HTTP progress-header keepalive, and
 *      system.processes / system.query_log recovery so a chunk is never
 *      run twice concurrently nor re-run after it already committed.
 *      New chunks stop being STARTED ~50s into a tick; in-flight chunks
 *      finish (the guard keeps later ticks out until then).
 *   3. Once every chunk of a pair is marked, runs the count-guard tail
 *      sweep (rolling-deploy stragglers old-code pods wrote to V2 after a
 *      chunk was copied), writes the pair's '__completed__' marker, and —
 *      once all pairs carry it — the tick becomes an in-process-cached
 *      no-op forever. Fresh installs (no V2 tables) complete on the first
 *      tick.
 */

const PAIRS: Array<TelemetrySignalCopyPair> =
  ClickHouseMigrationUtil.getTelemetrySignalCopyPairs();

/** Stop STARTING new chunks this long into a tick (chunks may run minutes past it). */
const TICK_BUDGET_IN_MS: number = 50 * 1000;

let isTickRunning: boolean = false;
let migrationChainDone: boolean = false;
const completedSourceTables: Set<string> = new Set();

/**
 * True once the LAST migration of the boot chain is recorded executed —
 * i.e. the whole chain (V3 DDL, MV rebuilds, codec/column ALTERs) is done
 * and nothing will drop/recreate the tables this cron writes through.
 * Cached after the first positive answer.
 */
async function isMigrationChainCompleted(): Promise<boolean> {
  if (migrationChainDone) {
    return true;
  }

  const lastMigration: DataMigrationBase | undefined =
    DataMigrations[DataMigrations.length - 1];

  if (!lastMigration) {
    migrationChainDone = true;
    return true;
  }

  const executed: DataMigration | null = await DataMigrationService.findOneBy({
    query: {
      name: lastMigration.name,
      executed: true,
    },
    props: {
      isRoot: true,
    },
  });

  migrationChainDone = Boolean(executed);
  return migrationChainDone;
}

async function isPairReady(pair: TelemetrySignalCopyPair): Promise<boolean> {
  if (!(await ClickHouseMigrationUtil.tableExists(pair.destinationTable))) {
    logger.warn(
      `BackfillTelemetryV3: ${pair.destinationTable} does not exist yet — skipping ${pair.sourceTable} this tick.`,
    );
    return false;
  }

  /*
   * MVs only aggregate rows inserted AFTER they exist — copying history
   * before they are attached would permanently skip its rollups.
   */
  for (const view of pair.requiredViews) {
    const createQuery: string | null =
      await ClickHouseMigrationUtil.getCreateQuery(view);
    if (!createQuery || !createQuery.includes(pair.destinationTable)) {
      logger.warn(
        `BackfillTelemetryV3: required view ${view} missing or not reading ${pair.destinationTable} — skipping ${pair.sourceTable} this tick.`,
      );
      return false;
    }
  }

  return true;
}

async function processPair(
  pair: TelemetrySignalCopyPair,
  deadlineAtInMs: number,
): Promise<void> {
  if (!(await ClickHouseMigrationUtil.tableExists(pair.sourceTable))) {
    // Fresh install — nothing will ever need copying for this pair.
    await ClickHouseMigrationUtil.markTableCompleted(pair.sourceTable);
    completedSourceTables.add(pair.sourceTable);
    logger.info(
      `BackfillTelemetryV3: ${pair.sourceTable} not present (fresh install) — marked completed.`,
    );
    return;
  }

  if (!(await isPairReady(pair))) {
    return;
  }

  const result: ChunkedCopyResult =
    await ClickHouseMigrationUtil.copyTableChunked({
      sourceTable: pair.sourceTable,
      destinationTable: pair.destinationTable,
      timeColumn: pair.timeColumn,
      destinationSortKeys: pair.destinationSortKeys,
      renameMap: pair.renameMap,
      logPrefix: "BackfillTelemetryV3",
      deadlineAtInMs: deadlineAtInMs,
    });

  const chunksDone: number =
    result.chunksAlreadyCopied +
    result.chunksCopiedNow +
    result.chunksRecovered;

  logger.info(
    `BackfillTelemetryV3: ${pair.sourceTable} -> ${pair.destinationTable}: ${chunksDone}/${result.totalChunks} chunks done (${result.chunksCopiedNow} copied this tick, ${result.chunksRecovered} recovered, ${result.chunksSkippedStillRunning} still running, deadline ${result.deadlineReached ? "reached" : "not reached"}).`,
  );

  for (const error of result.errors) {
    logger.error(`BackfillTelemetryV3: ${error}`);
  }

  const fullyCopied: boolean =
    chunksDone === result.totalChunks &&
    !result.deadlineReached &&
    result.chunksSkippedStillRunning === 0 &&
    result.errors.length === 0;

  if (!fullyCopied) {
    return;
  }

  // Every chunk is marked — run the one-time tail sweep, then complete.
  const sweep: SweepResult = await ClickHouseMigrationUtil.sweepTableChunked({
    sourceTable: pair.sourceTable,
    destinationTable: pair.destinationTable,
    timeColumn: pair.timeColumn,
    destinationSortKeys: pair.destinationSortKeys,
    renameMap: pair.renameMap,
    logPrefix: "BackfillTelemetryV3",
  });

  if (sweep.errors.length > 0) {
    for (const error of sweep.errors) {
      logger.error(`BackfillTelemetryV3: sweep: ${error}`);
    }
    return; // retried next tick — the count guard makes re-sweeping safe.
  }

  await ClickHouseMigrationUtil.markTableCompleted(pair.sourceTable);
  completedSourceTables.add(pair.sourceTable);
  logger.info(
    `BackfillTelemetryV3: ${pair.sourceTable} backfill COMPLETE (tail sweep re-copied ${sweep.chunksSwept} grown chunk(s)).`,
  );
}

async function runTick(): Promise<void> {
  // Steady state after full completion: zero queries, forever.
  if (
    PAIRS.every((pair: TelemetrySignalCopyPair) => {
      return completedSourceTables.has(pair.sourceTable);
    })
  ) {
    return;
  }

  if (!(await isMigrationChainCompleted())) {
    logger.debug(
      "BackfillTelemetryV3: boot migration chain not finished yet — waiting.",
    );
    return;
  }

  await ClickHouseMigrationUtil.ensureCopyProgressTable();

  // Pick up completions recorded by other pods / previous processes.
  const completed: Set<string> =
    await ClickHouseMigrationUtil.getCompletedTables();
  for (const tableName of completed) {
    completedSourceTables.add(tableName);
  }

  const deadlineAtInMs: number = Date.now() + TICK_BUDGET_IN_MS;

  for (const pair of PAIRS) {
    if (completedSourceTables.has(pair.sourceTable)) {
      continue;
    }

    await processPair(pair, deadlineAtInMs);

    if (Date.now() >= deadlineAtInMs) {
      break; // budget exhausted — remaining pairs continue next tick.
    }
  }
}

RunCron(
  "Telemetry:BackfillTelemetryV3",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: true,
    /*
     * A single chunk INSERT can legitimately run for many minutes; the
     * generous timeout keeps BullMQ from flagging healthy long ticks.
     * Even when it fires, the tick keeps running to completion in-process
     * (runJobWithTimeout only rejects the race) and the re-entrancy guard
     * keeps subsequent ticks out until it finishes.
     */
    timeoutInMS: 60 * 60 * 1000,
  },
  async () => {
    if (isTickRunning) {
      logger.debug(
        "BackfillTelemetryV3: previous tick still running — skipping.",
      );
      return;
    }

    isTickRunning = true;
    try {
      await runTick();
    } catch (err) {
      logger.error("BackfillTelemetryV3: tick failed:");
      logger.error(err as Error);
    } finally {
      isTickRunning = false;
    }
  },
);
