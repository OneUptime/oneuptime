import DataMigrationBase from "./DataMigrationBase";
import { withSessionReplayErasureLock } from "../Utils/SessionReplayErasureLock";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import AnalyticsDatabaseService, {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import {
  getClickhouseClusterName,
  getStorageTableName,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import logger from "Common/Server/Utils/Logger";
import {
  ProductAnalyticsRetentionBucket,
  ProductAnalyticsRetentionChoice,
  buildProductAnalyticsRetentionBuckets,
  buildProductAnalyticsRetentionWheres,
  readProductAnalyticsRetentionChoices,
} from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsRetention";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "Common/Types/JSON";
import {
  MAX_PRODUCT_ANALYTICS_RETENTION_MONTHS,
  getProductAnalyticsRetentionCutoff,
} from "Common/Types/Rum/ProductAnalytics";

/*
 * Issue #6624: after an upgrade, the product analytics Users and Sessions
 * pages started empty. RumProductAnalyticsSessionV1 and
 * RumProductAnalyticsUserV1 are filled by materialized views on
 * RumSessionV1, and a view only sees the rows inserted after it exists -
 * yet RumSessionV1 still holds every recording kept under the application's
 * replay retention. This copies those recordings' sessions in, once, with
 * each view's own SELECT, so the pages count back to the oldest recording
 * still kept and their "Counting started on" note moves back with them.
 *
 * WHAT IS COPIED. The sessions that started before the cut-off: the moment
 * the first run of this migration started, which boot or the migrate Job
 * reaches only after creating the views. A session the views filed too (it
 * started before the cut-off and was written to after the view existed) is
 * filed again, and folds into the row it has: every column of both tables
 * is a max, a min, a union, a uniq or an argMax state, so the same session
 * filed twice is counted once, as the views' own repeated writes are.
 * What a table no longer keeps is not copied: rows past the longest
 * retention (the tables' TTL) and an application's rows older than its own
 * retention (Rum:EnforceProductAnalyticsRetention), with the same buckets
 * that job deletes by.
 *
 * DAY BY DAY, NEWEST FIRST. RumSessionV1 is partitioned by day; each of its
 * days is two INSERT ... SELECTs (the person-month table, then the session
 * table), each reading that one partition, written through the Distributed
 * tables (which shard by their own keys), bounded by max_execution_time,
 * acknowledged by every shard before it returns (insert_distributed_sync)
 * and named by a query_id of its own, so a retry that finds its predecessor
 * still running is refused rather than running beside it. Newest first, so
 * while it runs, the pages count every day from the note's date to now -
 * the note moves back a day at a time and nothing in between is missing.
 *
 * PROGRESS. Kept in Valkey: the cut-off, and the oldest day done. A run
 * that stops part way (a pod restarted) is retried by the runner, keeps the
 * first run's cut-off and starts at the day after the last one done; a
 * second run of a finished one copies nothing. Without the progress (Valkey
 * lost it) a run starts over with a later cut-off, which is safe: what it
 * copies again folds into what is there.
 *
 * NEVER AN ERASED SESSION. An erasure request (Rum:ProcessSessionErasureRequests)
 * tombstones a subject's sessions and queues ALTER ... DELETE mutations,
 * which rewrite only the parts that exist when they are queued. A day copied
 * while a delete of RumSessionV1 had not landed, or while the job was
 * running, could write an erased session's rows into a part its delete
 * never sees. So each day is copied while holding the erasure job's own run
 * lock (no erasure starts or runs meanwhile), and only once no delete of
 * RumSessionV1 is unfinished on any node: every session an erasure removed
 * is then gone from the source, and every one it has still to remove is
 * removed by its later run - by id, by the user's key, or with the whole
 * application or date range - from the product analytics rows this wrote
 * before it. A delete that does not land within DELETE_WAIT_MS fails the
 * run (the runner tries again on the next boot) rather than copy around it.
 * Without Valkey there is no lock, and no day is copied.
 *
 * Cluster-aware (`runsInClusterMode` left at true): the analytics schema is
 * always a cluster, and a migration that opted out would be baselined and
 * never reach an existing install. An install with no RUM tables has
 * nothing to copy, and is done.
 */

export const PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME: string =
  "BackfillProductAnalyticsFromKeptSessions";

/*
 * Server-side cap on one day's INSERT ... SELECT: the migration pool's
 * 30-minute socket-idle ceiling, which ClickhouseConfig prescribes pairing
 * with max_execution_time.
 */
export const PRODUCT_ANALYTICS_BACKFILL_MAX_EXECUTION_TIME_IN_SECONDS: number = 1800;

// How long a day waits for the deletes of RumSessionV1 to land.
export const PRODUCT_ANALYTICS_BACKFILL_DELETE_WAIT_MS: number = 30 * 60 * 1000;

// How often it looks again while one has not.
export const PRODUCT_ANALYTICS_BACKFILL_DELETE_POLL_MS: number = 5000;

/*
 * How long a day waits for a run of the erasure job to give its lock back:
 * longer than the job's own 60-minute time limit.
 */
export const PRODUCT_ANALYTICS_BACKFILL_LOCK_WAIT_MS: number = 90 * 60 * 1000;

// How long the progress stays in Valkey after its last write.
export const PRODUCT_ANALYTICS_BACKFILL_PROGRESS_TTL_SECONDS: number =
  30 * 24 * 60 * 60;

/*
 * RumSessionV1 partitions by toYYYYMMDD(startTime), so system.parts names
 * each partition as eight digits ("20260716"). Anything else means the
 * scheme changed: refuse to guess rather than copy the wrong slices.
 */
const DAY_PARTITION: RegExp = /^[0-9]{8}$/;

// The source, and how its partitions are named.
const SOURCE_TABLE: string = AnalyticsTableName.RumSession;
const SOURCE_PARTITION_KEY: string = "toYYYYMMDD(startTime)";

/* A table the backfill fills, and the view that fills it. */
export interface ProductAnalyticsBackfillTarget {
  tableName: AnalyticsTableName;
  view: MaterializedView;
  service: AnalyticsDatabaseService<AnalyticsBaseModel>;
}

function viewOf(model: AnalyticsBaseModel): MaterializedView {
  const view: MaterializedView | undefined = model.materializedViews[0];

  if (!view) {
    throw new Error(`${model.tableName} declares no materialized view`);
  }

  return view;
}

/*
 * The person-month table first, then the session table: a day whose
 * session rows were written has its person rows too.
 */
export function getProductAnalyticsBackfillTargets(): Array<ProductAnalyticsBackfillTarget> {
  return [
    {
      tableName: AnalyticsTableName.RumProductAnalyticsUser,
      view: viewOf(new RumProductAnalyticsUser()),
      service:
        RumProductAnalyticsUserService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
    },
    {
      tableName: AnalyticsTableName.RumProductAnalyticsSession,
      view: viewOf(new RumProductAnalyticsSession()),
      service:
        RumProductAnalyticsSessionService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
    },
  ];
}

/* A view's SELECT, cut where the backfill adds its WHERE. */
export interface ProductAnalyticsBackfillSelect {
  // The columns it fills, in its order.
  columns: Array<string>;
  // "SELECT ...\nFROM RumSessionV1\n".
  head: string;
  // The view's own WHERE condition, if it has one.
  where: string | null;
  // "GROUP BY ...".
  tail: string;
}

const AS_MARKER: string = "\nAS\n";
const FROM_MARKER: string = `\nFROM ${SOURCE_TABLE}\n`;
const COLUMN_ALIAS: RegExp = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const BARE_COLUMN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

/*
 * A view's own SELECT, verbatim, so the copy files a session exactly as the
 * view does and the two never drift. The models write their views as
 * "CREATE ... TO <table>\nAS\nSELECT\n  <one column a line>\nFROM
 * RumSessionV1\n[WHERE ...\n]GROUP BY ...": anything else is refused.
 */
export function readProductAnalyticsBackfillSelect(
  view: MaterializedView,
): ProductAnalyticsBackfillSelect {
  const asIndex: number = view.query.indexOf(AS_MARKER);

  if (asIndex === -1) {
    throw new Error(
      `${view.name} has no "AS" line; refusing to guess its SELECT`,
    );
  }

  const select: string = view.query.substring(asIndex + AS_MARKER.length);
  const fromIndex: number = select.indexOf(FROM_MARKER);

  if (!select.startsWith("SELECT\n") || fromIndex === -1) {
    throw new Error(
      `${view.name} does not read "FROM ${SOURCE_TABLE}" on a line of its own; refusing to guess its SELECT`,
    );
  }

  const columns: Array<string> = select
    .substring("SELECT\n".length, fromIndex)
    .split("\n")
    .map((line: string): string => {
      const item: string = line.trim().replace(/,$/, "");
      const alias: RegExpMatchArray | null = item.match(COLUMN_ALIAS);

      if (alias) {
        return alias[1]!;
      }

      if (BARE_COLUMN.test(item)) {
        return item;
      }

      throw new Error(
        `${view.name} selects "${item}" with no name; refusing to guess the column it fills`,
      );
    });

  const head: string = select.substring(0, fromIndex + FROM_MARKER.length);
  let rest: string = select.substring(fromIndex + FROM_MARKER.length);
  let where: string | null = null;

  if (rest.startsWith("WHERE ")) {
    const lineEnd: number = rest.indexOf("\n");

    if (lineEnd === -1) {
      throw new Error(`${view.name} has no GROUP BY after its WHERE`);
    }

    where = rest.substring("WHERE ".length, lineEnd);
    rest = rest.substring(lineEnd + 1);
  }

  if (!rest.startsWith("GROUP BY ")) {
    throw new Error(
      `${view.name} has no GROUP BY after FROM ${SOURCE_TABLE}; refusing to guess its SELECT`,
    );
  }

  return { columns: columns, head: head, where: where, tail: rest };
}

/*
 * What every target keeps of a day: rows within the longest retention (the
 * TTL's), and of an application only those within its own - the rows the
 * retention job would delete are never copied.
 */
export function buildProductAnalyticsBackfillKeepClause(data: {
  buckets: Array<ProductAnalyticsRetentionBucket>;
  floor: Date;
}): Statement {
  const keep: Statement = SQL`startTime >= ${{
    type: TableColumnType.DateTime64,
    value: data.floor,
  }}`;

  for (const bucket of data.buckets) {
    for (const where of buildProductAnalyticsRetentionWheres({
      table: {
        timeColumn: "startTime",
        timeType: TableColumnType.DateTime64,
      },
      bucket: bucket,
    })) {
      keep.append(" AND NOT (").append(where).append(")");
    }
  }

  return keep;
}

/*
 * One target's copy of one day: the view's SELECT over that partition of
 * RumSessionV1, the sessions that started before the cut-off, what the
 * tables keep - and the view's own WHERE after - into the Distributed
 * table, its columns named in the SELECT's order.
 */
export function buildProductAnalyticsBackfillInsert(data: {
  target: ProductAnalyticsBackfillTarget;
  partition: string;
  cutoff: Date;
  keep: Statement;
}): Statement {
  if (!DAY_PARTITION.test(data.partition)) {
    throw new Error(
      `"${data.partition}" is not a day partition of ${SOURCE_TABLE}; refusing to copy it`,
    );
  }

  const select: ProductAnalyticsBackfillSelect =
    readProductAnalyticsBackfillSelect(data.target.view);

  const statement: Statement = SQL``;
  statement.append(
    `INSERT INTO ${data.target.tableName} (${select.columns.join(", ")})\n`,
  );
  statement.append(select.head);
  statement.append(
    `WHERE ${SOURCE_PARTITION_KEY} = ${data.partition} AND startTime < `,
  );
  statement.append(
    SQL`${{
      type: TableColumnType.DateTime64,
      value: data.cutoff,
    }}`,
  );
  statement.append(" AND (").append(data.keep).append(")");

  if (select.where) {
    statement.append(` AND (${select.where})`);
  }

  statement.append(`\n${select.tail}`);

  return statement;
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/*
 * The days RumSessionV1 holds from the floor to the cut-off, newest first,
 * on every node: system.parts is a node's own, so it is read through
 * clusterAllReplicas, which misses no replica's parts.
 */
export function buildProductAnalyticsBackfillPartitionsQuery(data: {
  databaseName: string;
  floor: Date;
  cutoff: Date;
}): Statement {
  const statement: Statement = SQL``;
  statement.append(
    `SELECT DISTINCT partition AS paPartition FROM clusterAllReplicas(${quote(getClickhouseClusterName())}, system.parts) WHERE database = ${quote(data.databaseName)} AND table = ${quote(getStorageTableName(SOURCE_TABLE))} AND active AND partition >= toString(toYYYYMMDD(`,
  );
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.floor }}`,
  );
  statement.append(")) AND partition <= toString(toYYYYMMDD(");
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.cutoff }}`,
  );
  statement.append(")) ORDER BY paPartition DESC");

  return statement;
}

/*
 * The deletes of RumSessionV1 not yet landed on some node, and one of them
 * (and why it is failing, if it is): an erasure's ALTER ... DELETE, or a
 * lightweight DELETE. ClickHouse 24 writes the command bare, 26 in
 * brackets.
 */
export function buildProductAnalyticsBackfillPendingDeletesQuery(data: {
  databaseName: string;
}): string {
  return `SELECT toUInt64(count()) AS paPending, any(mutation_id) AS paMutation, any(latest_fail_reason) AS paFailure FROM clusterAllReplicas(${quote(getClickhouseClusterName())}, system.mutations) WHERE database = ${quote(data.databaseName)} AND table = ${quote(getStorageTableName(SOURCE_TABLE))} AND NOT is_done AND (position(command, 'DELETE WHERE') > 0 OR position(command, '_row_exists') > 0)`;
}

/* Where a run left off. */
export interface ProductAnalyticsBackfillState {
  // The first run's cut-off; null before one started.
  cutoff: Date | null;
  // The oldest day copied: every day from it to the cut-off's is done.
  doneThrough: string | null;
}

export interface ProductAnalyticsBackfillProgress {
  read: () => Promise<ProductAnalyticsBackfillState>;
  writeCutoff: (cutoff: Date) => Promise<void>;
  writeDoneThrough: (partition: string) => Promise<void>;
}

export function getProductAnalyticsBackfillProgressKey(
  migrationName: string,
  field: "cutoff" | "done-through",
): string {
  return `product-analytics-backfill:${migrationName}:${field}`;
}

/* The progress, in Valkey. Without a connection it refuses rather than guess. */
export function getValkeyProductAnalyticsBackfillProgress(
  migrationName: string,
): ProductAnalyticsBackfillProgress {
  const client: () => ClientType = (): ClientType => {
    const connected: ClientType | null = Redis.getClient();

    if (!connected || !Redis.isConnected()) {
      throw new Error(
        `${migrationName}: Valkey is not connected; its progress cannot be read or kept`,
      );
    }

    return connected;
  };

  const write: (
    field: "cutoff" | "done-through",
    value: string,
  ) => Promise<void> = async (
    field: "cutoff" | "done-through",
    value: string,
  ): Promise<void> => {
    await client().set(
      getProductAnalyticsBackfillProgressKey(migrationName, field),
      value,
      "EX",
      PRODUCT_ANALYTICS_BACKFILL_PROGRESS_TTL_SECONDS,
    );
  };

  return {
    read: async (): Promise<ProductAnalyticsBackfillState> => {
      const [cutoff, doneThrough]: [string | null, string | null] =
        await Promise.all([
          client().get(
            getProductAnalyticsBackfillProgressKey(migrationName, "cutoff"),
          ),
          client().get(
            getProductAnalyticsBackfillProgressKey(
              migrationName,
              "done-through",
            ),
          ),
        ]);

      const cutoffDate: Date | null = cutoff ? new Date(cutoff) : null;

      return {
        cutoff: cutoffDate && !isNaN(cutoffDate.getTime()) ? cutoffDate : null,
        doneThrough:
          doneThrough && DAY_PARTITION.test(doneThrough) ? doneThrough : null,
      };
    },
    writeCutoff: async (cutoff: Date): Promise<void> => {
      await write("cutoff", cutoff.toISOString());
    },
    writeDoneThrough: async (partition: string): Promise<void> => {
      await write("done-through", partition);
    },
  };
}

/* What the backfill runs with: tests hand their own in. */
export interface ProductAnalyticsBackfillEnvironment {
  now: () => Date;
  progress: ProductAnalyticsBackfillProgress;
  // Runs `work` while no session replay erasure can start or run.
  withoutErasures: <T>(work: () => Promise<T>) => Promise<T>;
  retentionChoices: () => Promise<Array<ProductAnalyticsRetentionChoice>>;
  sleep: (ms: number) => Promise<void>;
  deleteWaitMs: number;
}

function sleepFor(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}

export function getDefaultProductAnalyticsBackfillEnvironment(
  migrationName: string,
): ProductAnalyticsBackfillEnvironment {
  return {
    now: (): Date => {
      return new Date();
    },
    progress: getValkeyProductAnalyticsBackfillProgress(migrationName),
    withoutErasures: <T>(work: () => Promise<T>): Promise<T> => {
      return withSessionReplayErasureLock<T>({
        holder: migrationName,
        waitMs: PRODUCT_ANALYTICS_BACKFILL_LOCK_WAIT_MS,
        work: work,
      });
    },
    retentionChoices: readProductAnalyticsRetentionChoices,
    sleep: sleepFor,
    deleteWaitMs: PRODUCT_ANALYTICS_BACKFILL_DELETE_WAIT_MS,
  };
}

interface ClickhouseJsonResultSet {
  json: () => Promise<{ data: Array<JSONObject> }>;
}

// What a run did.
export interface ProductAnalyticsBackfillResult {
  cutoff: Date;
  daysCopied: Array<string>;
  daysAlreadyDone: number;
}

export default class BackfillProductAnalyticsFromKeptSessions extends DataMigrationBase {
  private readonly environment: ProductAnalyticsBackfillEnvironment;

  public lastResult: ProductAnalyticsBackfillResult | null = null;

  public constructor(
    environment?: Partial<ProductAnalyticsBackfillEnvironment> | undefined,
  ) {
    super(PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME);

    this.environment = {
      ...getDefaultProductAnalyticsBackfillEnvironment(
        PRODUCT_ANALYTICS_BACKFILL_MIGRATION_NAME,
      ),
      ...(environment || {}),
    };
  }

  /*
   * Runs in cluster mode: the analytics schema is always a cluster, and
   * `false` would have the runner record this as done without running it.
   */
  public override runsInClusterMode(): boolean {
    return true;
  }

  private get service(): AnalyticsDatabaseService<AnalyticsBaseModel> {
    return RumProductAnalyticsSessionService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;
  }

  private getDatabaseName(): string {
    const databaseName: string | undefined =
      this.service.database.getDatasourceOptions().database;

    if (!databaseName) {
      throw new Error("ClickHouse database name is not configured");
    }

    return databaseName;
  }

  private async readRows(
    statement: Statement | string,
  ): Promise<Array<JSONObject>> {
    const resultSet: ClickhouseJsonResultSet = (await this.service.executeQuery(
      statement,
      MigrationExecuteOptions,
    )) as unknown as ClickhouseJsonResultSet;

    return (await resultSet.json()).data || [];
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const rows: Array<JSONObject> = await this.readRows(
      `EXISTS TABLE ${tableName}`,
    );
    const row: JSONObject | undefined = rows[0];

    return row ? Number(Object.values(row)[0]) === 1 : false;
  }

  public override async migrate(): Promise<void> {
    const targets: Array<ProductAnalyticsBackfillTarget> =
      getProductAnalyticsBackfillTargets();

    for (const tableName of [
      SOURCE_TABLE,
      ...targets.map((target: ProductAnalyticsBackfillTarget): string => {
        return target.tableName;
      }),
    ]) {
      /*
       * Boot and the migrate Job create every table before data migrations
       * run, so a missing one is an install with no RUM tables: nothing to
       * copy, nothing to copy into.
       */
      if (!(await this.tableExists(tableName))) {
        logger.info(
          `${this.name}: ${tableName} does not exist; nothing to backfill.`,
        );
        return;
      }
    }

    const environment: ProductAnalyticsBackfillEnvironment = this.environment;
    const state: ProductAnalyticsBackfillState =
      await environment.progress.read();
    const cutoff: Date = state.cutoff || environment.now();

    if (!state.cutoff) {
      await environment.progress.writeCutoff(cutoff);
    }

    const now: Date = environment.now();
    const floor: Date = getProductAnalyticsRetentionCutoff(
      MAX_PRODUCT_ANALYTICS_RETENTION_MONTHS,
      now,
    );
    const keep: Statement = buildProductAnalyticsBackfillKeepClause({
      buckets: buildProductAnalyticsRetentionBuckets({
        choices: await environment.retentionChoices(),
        now: now,
      }),
      floor: floor,
    });

    const partitions: Array<string> = await this.listPartitions({
      floor: floor,
      cutoff: cutoff,
    });

    const result: ProductAnalyticsBackfillResult = {
      cutoff: cutoff,
      daysCopied: [],
      daysAlreadyDone: 0,
    };

    for (const partition of partitions) {
      if (state.doneThrough && partition >= state.doneThrough) {
        result.daysAlreadyDone++;
        continue;
      }

      await this.copyDay({
        targets: targets,
        partition: partition,
        cutoff: cutoff,
        keep: keep,
      });

      await environment.progress.writeDoneThrough(partition);
      result.daysCopied.push(partition);
    }

    this.lastResult = result;

    logger.info(
      `${this.name}: copied ${result.daysCopied.length} day(s) of kept sessions into product analytics (${result.daysAlreadyDone} done before), up to ${cutoff.toISOString()}.`,
    );
  }

  private async listPartitions(data: {
    floor: Date;
    cutoff: Date;
  }): Promise<Array<string>> {
    const rows: Array<JSONObject> = await this.readRows(
      buildProductAnalyticsBackfillPartitionsQuery({
        databaseName: this.getDatabaseName(),
        floor: data.floor,
        cutoff: data.cutoff,
      }),
    );

    return rows.map((row: JSONObject): string => {
      const partition: string = String(row["paPartition"] ?? "");

      if (!DAY_PARTITION.test(partition)) {
        throw new Error(
          `${this.name}: unexpected ${SOURCE_TABLE} partition "${partition}" (expected ${SOURCE_PARTITION_KEY}); refusing to copy blind`,
        );
      }

      return partition;
    });
  }

  /*
   * Waits until no delete of RumSessionV1 is unfinished on any node, or
   * throws once one has not landed for the environment's wait.
   */
  private async waitForSourceDeletes(): Promise<void> {
    const giveUpAt: number = Date.now() + this.environment.deleteWaitMs;
    const query: string = buildProductAnalyticsBackfillPendingDeletesQuery({
      databaseName: this.getDatabaseName(),
    });

    for (;;) {
      const row: JSONObject | undefined = (await this.readRows(query))[0];
      const pending: number = Number(row?.["paPending"] || 0);

      if (pending === 0) {
        return;
      }

      if (Date.now() >= giveUpAt) {
        const failure: string = String(row?.["paFailure"] || "");

        throw new Error(
          `${this.name}: ${pending} delete(s) of ${SOURCE_TABLE} have not landed (mutation ${String(row?.["paMutation"] || "")}${failure ? `, failing: ${failure}` : ""}); no session an erasure may still be removing is copied. The next run tries again.`,
        );
      }

      await this.environment.sleep(PRODUCT_ANALYTICS_BACKFILL_DELETE_POLL_MS);
    }
  }

  private async copyDay(data: {
    targets: Array<ProductAnalyticsBackfillTarget>;
    partition: string;
    cutoff: Date;
    keep: Statement;
  }): Promise<void> {
    // Outside the lock first, so no erasure waits while deletes land.
    await this.waitForSourceDeletes();

    await this.environment.withoutErasures(async (): Promise<void> => {
      // An erasure that ran in between: its deletes, landed too.
      await this.waitForSourceDeletes();

      for (const target of data.targets) {
        await target.service.execute(
          buildProductAnalyticsBackfillInsert({
            target: target,
            partition: data.partition,
            cutoff: data.cutoff,
            keep: data.keep,
          }),
          this.getInsertOptions(target, data.partition),
        );
      }
    });
  }

  private getInsertOptions(
    target: ProductAnalyticsBackfillTarget,
    partition: string,
  ): ClickhouseExecuteOptions {
    return {
      ...MigrationExecuteOptions,
      queryId: `${this.name}:${target.tableName}:${partition}`,
      clickhouseSettings: {
        ...MigrationExecuteOptions.clickhouseSettings,
        max_execution_time:
          PRODUCT_ANALYTICS_BACKFILL_MAX_EXECUTION_TIME_IN_SECONDS,
        /*
         * Returns once every shard has written its share: the default
         * background send could still lose rows after a day is recorded
         * as done.
         */
        insert_distributed_sync: 1,
        /*
         * The session view groups by RumSessionV1's own sort key, so a day
         * is folded as it is read, in little memory.
         */
        optimize_aggregation_in_order: 1,
      },
    };
  }

  public override async rollback(): Promise<void> {
    // What it copied is what the views would have filed; nothing to undo.
    return;
  }
}
