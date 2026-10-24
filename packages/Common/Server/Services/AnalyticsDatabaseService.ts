import { WorkflowHostname } from "../EnvironmentConfig";
import ClickhouseDatabase, {
  ClickhouseAppInstance,
  ClickhouseClient,
  ClickhouseIngestInstance,
  ClickhouseMigrationInstance,
} from "../Infrastructure/ClickhouseDatabase";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import ExistsBy from "../Types/AnalyticsDatabase/ExistsBy";
import CreateBy from "../Types/AnalyticsDatabase/CreateBy";
import CreateManyBy from "../Types/AnalyticsDatabase/CreateManyBy";
import DeleteBy from "../Types/AnalyticsDatabase/DeleteBy";
import FindBy from "../Types/AnalyticsDatabase/FindBy";
import FindOneBy from "../Types/AnalyticsDatabase/FindOneBy";
import FindOneByID from "../Types/AnalyticsDatabase/FindOneByID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  DatabaseTriggerType,
  OnCreate,
  OnDelete,
  OnFind,
  OnUpdate,
} from "../Types/AnalyticsDatabase/Hooks";
import ModelPermission, {
  CheckReadPermissionType,
} from "../Types/AnalyticsDatabase/ModelPermission";
import Select from "../Types/AnalyticsDatabase/Select";
import UpdateBy from "../Types/AnalyticsDatabase/UpdateBy";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../Utils/AnalyticsDatabase/StatementGenerator";
import {
  getQuerySettings,
  TimeoutOverflowMode,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import ClickhouseReadResult from "../Utils/AnalyticsDatabase/ClickhouseReadResult";
import {
  getDistributedDdlTaskTimeoutSeconds,
  getStorageTableName,
  onClusterClause,
} from "../Utils/AnalyticsDatabase/ClusterConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import Realtime from "../Utils/Realtime";
import {
  RealtimeReadAccess,
  RealtimeReader,
  normalizeRealtimeId,
} from "../Utils/Realtime/RealtimeReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../Utils/Telemetry/TelemetryReadScope";
import Query from "../Types/AnalyticsDatabase/Query";
import { OwnedThroughMetadata } from "../../Types/Database/AccessControl/OwnedThrough";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import StreamUtil from "../Utils/Stream";
import BaseService from "./BaseService";
import {
  ClickHouseSettings,
  ExecResult,
  ResponseJSON,
  ResultSet,
} from "@clickhouse/client";
import { nextInsertDedupToken } from "../Utils/AnalyticsDatabase/InsertDedupContext";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { WorkflowRoute } from "../../ServiceRoute";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionPropsUtil from "../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import Exception from "../../Types/Exception/Exception";
import ExceptionCode from "../../Types/Exception/ExceptionCode";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServerException from "../../Types/Exception/ServerException";
import QueryTimeoutException from "../../Types/Exception/QueryTimeoutException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Text from "../../Types/Text";
import Typeof from "../../Types/Typeof";
import API from "../../Utils/API";
import { Stream } from "node:stream";
import AggregateBy, {
  AggregateUtil,
} from "../Types/AnalyticsDatabase/AggregateBy";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import Sort from "../Types/AnalyticsDatabase/Sort";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import CallerPlan from "../Utils/Billing/CallerPlan";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import PlanGates from "../Types/Database/Permissions/PlanGates";

export type Results = ResultSet<"JSON">;
export type DbJSONResponse = ResponseJSON<{
  data?: Array<JSONObject>;
}>;

/*
 * Re-exported so callers outside Common (e.g. App data migrations) can type
 * per-call settings without depending on @clickhouse/client directly.
 */
export type { ClickHouseSettings } from "@clickhouse/client";

/**
 * Optional per-call knobs for `execute` / `executeQuery`, threaded into
 * `client.exec` / `client.query`. Long-running statements (e.g. the
 * telemetry V3 backfill's INSERT...SELECT chunks) need per-call
 * `clickhouse_settings` — notably `send_progress_in_http_headers`, which
 * keeps the HTTP socket non-idle so the client's `request_timeout`
 * (enforced as a socket *idle* timer, see ClickhouseConfig.ts) never
 * destroys a healthy request — and a deterministic `query_id` so a retry
 * can find a still-running or already-finished predecessor in
 * `system.processes` / `system.query_log`. Additive: callers that pass
 * nothing get the exact pre-existing behavior.
 */
export interface ClickhouseExecuteOptions {
  clickhouseSettings?: ClickHouseSettings | undefined;
  queryId?: string | undefined;
  /**
   * Route this statement through the dedicated migration pool
   * (ClickhouseMigrationInstance) instead of the App pool. The migration pool
   * has a much higher `request_timeout` (socket-idle ceiling) so a long DDL /
   * mutation / INSERT...SELECT is not destroyed at the App pool's 58s. Schema
   * sync and data migrations set this (via MigrationExecuteOptions); the read /
   * write hot path leaves it unset and keeps the 58s App pool.
   */
  useMigrationConnection?: boolean | undefined;
}

/**
 * Standard options for every schema-sync / data-migration statement. Two
 * layers of protection against the socket-idle `request_timeout` killing a
 * long migration:
 *   1. `useMigrationConnection` routes through ClickhouseMigrationInstance
 *      (30-minute idle ceiling) — reliable even for pure-DDL / ON CLUSTER
 *      coordination that streams no bytes at all.
 *   2. `send_progress_in_http_headers` makes the server emit periodic
 *      X-ClickHouse-Progress header lines for data-rewriting statements
 *      (MODIFY COLUMN rewrites, MATERIALIZE, INSERT...SELECT), keeping the
 *      socket non-idle so the request completes instead of timing out.
 * Pass this as the second arg to `execute` / `executeQuery` from migration
 * code. The schema-mutating helpers on this service default to it already.
 */
export const MigrationExecuteOptions: ClickhouseExecuteOptions = {
  useMigrationConnection: true,
  clickhouseSettings: {
    send_progress_in_http_headers: 1,
    /*
     * Emit a progress header every 10s — well under the App pool's 58s and the
     * migration pool's 30-minute idle ceiling.
     */
    http_headers_progress_interval_ms: "10000",
    /*
     * ON CLUSTER DDL is queued in Keeper and executed by each host's DDLWorker
     * sequentially, so on a busy or backlogged cluster a host can be healthy
     * yet not reach the task within the wait window. The server default output
     * mode (`throw`) turns that into TIMEOUT_EXCEEDED (code 159) and aborts
     * the whole migrate run — even though the task stays queued and the hosts
     * execute it in the background (until the DDL queue evicts it:
     * task_max_lifetime, one week, or falling more than max_tasks_in_queue
     * entries behind). `null_status_on_timeout` returns NULL for the hosts
     * that haven't finished yet instead of throwing, while a real DDL failure
     * on any host that did run it within the window still throws. Safe because
     * every schema statement here is idempotent (IF NOT EXISTS / OR REPLACE)
     * and, with the default `distributed_ddl.pool_size = 1`, later DDL queues
     * strictly behind earlier DDL on each host. Migrate.ts additionally warns
     * at end of run when the DDL queue still has unfinished tasks. Note these
     * options are also reused by runtime ALTER ... DELETE mutations (session
     * erasure / pin materialization); timeout-as-success is acceptable there
     * too since a mutation is durable once enqueued. Requires ClickHouse >=
     * 21.4 (older servers reject the setting as unknown).
     */
    distributed_ddl_output_mode: "null_status_on_timeout",
    /*
     * Int64 settings are typed as strings by @clickhouse/client. Read at
     * module load; env is static for the life of the process. The migration
     * pool's socket-idle ceiling scales with this value (ClickhouseConfig.ts)
     * so a raised wait isn't killed client-side.
     */
    distributed_ddl_task_timeout: String(getDistributedDdlTaskTimeoutSeconds()),
  },
};

/*
 * The insert-dedup ambient context lives in
 * Utils/AnalyticsDatabase/InsertDedupContext so that both this service and
 * TelemetryFanInWriter can consume deterministic tokens without an import
 * cycle. Re-exported here for existing callers.
 *
 * The ack mode is independent of tokening: TELEMETRY_WAIT_FOR_ASYNC_INSERT
 * (shouldWaitForAsyncInsert below) is applied to EVERY insertJsonRows call,
 * with or without a dedup token. Whether a telemetry queue job's writes
 * carry per-job tokens from this context is a separate policy decided in
 * the worker: the high-volume signals (traces/logs/metrics) run untokened
 * so the fan-in writer can merge them into cross-job INSERTs under minted
 * per-batch tokens — see shouldUseInsertDedup in
 * App/FeatureSet/Telemetry/Jobs/TelemetryIngest/ProcessTelemetry.ts.
 */
export {
  runWithInsertDedup,
  nextInsertDedupToken,
  type InsertDedupContextStore,
} from "../Utils/AnalyticsDatabase/InsertDedupContext";

/*
 * Ack mode for telemetry ClickHouse inserts.
 *
 * Default (false): wait_for_async_insert=0 — fire-and-forget. ClickHouse
 * acks as soon as the batch is accepted into its async-insert buffer and
 * owns flushing from there; inserts release their query slot almost
 * immediately. The trade: flush-time errors surface only in server logs
 * (system.asynchronous_inserts / part log), and a ClickHouse crash between
 * buffer-accept and flush loses that buffer even though callers were acked.
 *
 * Set TELEMETRY_WAIT_FOR_ASYNC_INSERT=true to make every tokened insert
 * wait for the durable flush before acking (ack-after-flush end to end
 * through the fan-in writer and writer tier) — at the cost of each waiting
 * insert holding a ClickHouse query slot until its buffer flushes.
 */
export function shouldWaitForAsyncInsert(): boolean {
  const raw: string | undefined =
    process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
  return raw === "true" || raw === "1";
}

/*
 * How long a count may run. Below the ClickHouse client's 58s
 * request_timeout, so the server answers (or refuses) before the client
 * gives up on it.
 */
const COUNT_MAX_EXECUTION_TIME_IN_SECONDS: number = 45;

/*
 * The names a paged find's statement gives its page bound
 * (AnalyticsDatabaseService.toSortKeyPageBound): the page's own sort-key
 * values with their in-page offset, and the sorted first `skip + limit`
 * values they are cut from. Two underscores, so no model column can ever
 * be shadowed by them (AnalyticsSortKeyPageBoundScope pins that).
 */
export const SORT_KEY_PAGE_BOUND_ALIAS: string = "__sortKeyPage";
export const SORT_KEY_PAGE_VALUES_ALIAS: string = "__sortKeyTopValues";

/*
 * What a paged find adds to its statement to read only the rows its page
 * can hold: a WITH clause in front of the SELECT, a condition on the
 * WHERE, and the OFFSET that replaces `skip`.
 */
export interface SortKeyPageBound {
  withClause: Statement;
  whereCondition: Statement;
  offset: Statement;
}

export default class AnalyticsDatabaseService<
  TBaseModel extends AnalyticsBaseModel,
> extends BaseService {
  public modelType!: { new (): TBaseModel };
  public database!: ClickhouseDatabase;
  public ingestDatabase!: ClickhouseDatabase;
  public migrationDatabase!: ClickhouseDatabase;
  public model!: TBaseModel;
  public databaseClient!: ClickhouseClient | null;
  public ingestDatabaseClient!: ClickhouseClient | null;
  public migrationDatabaseClient!: ClickhouseClient | null;
  public statementGenerator!: StatementGenerator<TBaseModel>;

  public constructor(data: {
    modelType: { new (): TBaseModel };
    database?: ClickhouseDatabase | undefined;
    ingestDatabase?: ClickhouseDatabase | undefined;
  }) {
    super();
    this.modelType = data.modelType;
    this.model = new this.modelType();
    if (data.database) {
      this.database = data.database; // used for testing.
    } else {
      this.database = ClickhouseAppInstance; // default database
    }

    if (data.ingestDatabase) {
      this.ingestDatabase = data.ingestDatabase;
    } else {
      this.ingestDatabase = ClickhouseIngestInstance;
    }

    /*
     * Migrations route through their own pool (higher socket-idle timeout) via
     * MigrationExecuteOptions. In tests `data.database` is the in-test instance,
     * so reuse it there to keep tests on a single mocked client.
     */
    this.migrationDatabase = data.database || ClickhouseMigrationInstance;

    this.databaseClient = this.database.getDataSource();
    this.ingestDatabaseClient = this.ingestDatabase.getDataSource();
    this.migrationDatabaseClient = this.migrationDatabase.getDataSource();

    this.statementGenerator = new StatementGenerator<TBaseModel>({
      modelType: this.modelType,
      database: this.database,
    });
  }

  @CaptureSpan()
  public async insertJsonRows(
    rows: Array<JSONObject>,
    options?: {
      /**
       * Explicit deduplication token for this insert. Overrides the
       * ambient runWithInsertDedup context. Callers must guarantee the
       * token is stable across retries of the same logical insert and
       * unique otherwise.
       */
      dedupToken?: string | undefined;
      /** Extra per-insert ClickHouse settings, merged last. */
      clickhouseSettings?: ClickHouseSettings | undefined;
    },
  ): Promise<void> {
    if (!rows || rows.length === 0) {
      return;
    }

    const client: ClickhouseClient = this.getIngestClient();

    const tableName: string = this.model.tableName;

    if (!tableName) {
      throw new Exception(
        ExceptionCode.BadDataException,
        "Analytics model table name not configured",
      );
    }

    let dedupToken: string | undefined = options?.dedupToken;

    if (!dedupToken) {
      dedupToken = nextInsertDedupToken(tableName);
    }

    const waitForAsyncInsert: 0 | 1 = shouldWaitForAsyncInsert() ? 1 : 0;

    let clickhouseSettings: ClickHouseSettings = {
      async_insert: 1,
      wait_for_async_insert: waitForAsyncInsert,
    };

    if (dedupToken) {
      /*
       * Dedup settings ride along in both ack modes. For async inserts
       * ClickHouse dedups by content hash of the insert body when
       * async_insert_deduplicate=1 (the explicit token is not yet honored
       * for async inserts — ClickHouse #52018), so byte-identical queue
       * retries are still dropped. The ack mode is a separate, deliberate
       * trade (see shouldWaitForAsyncInsert): by default ClickHouse owns
       * flushing and an ack means "accepted into the async-insert buffer";
       * with TELEMETRY_WAIT_FOR_ASYNC_INSERT=true the ack waits for the
       * durable flush instead.
       */
      clickhouseSettings = {
        async_insert: 1,
        wait_for_async_insert: waitForAsyncInsert,
        async_insert_deduplicate: 1,
        insert_deduplication_token: dedupToken,
      };
    }

    if (options?.clickhouseSettings) {
      clickhouseSettings = {
        ...clickhouseSettings,
        ...options.clickhouseSettings,
      };
    }

    try {
      await client.insert({
        table: tableName,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: clickhouseSettings,
      });

      logger.debug(
        `ClickHouse insert succeeded for table ${tableName} at ${OneUptimeDate.toString(OneUptimeDate.getCurrentDate())}`,
        { tableName } as LogAttributes,
      );
    } catch (error) {
      logger.error(
        `ClickHouse insert failed for table ${tableName} at ${OneUptimeDate.toString(OneUptimeDate.getCurrentDate())}`,
        { tableName } as LogAttributes,
      );
      logger.error(error, { tableName } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  public async doesColumnExistInDatabase(columnName: string): Promise<boolean> {
    const statement: string =
      this.statementGenerator.toDoesColumnExistStatement(columnName);

    const dbResult: ExecResult<Stream> = await this.execute(statement);

    const strResult: string = await StreamUtil.convertStreamToText(
      dbResult.stream,
    );

    return strResult.trim().length > 0;
  }

  @CaptureSpan()
  public async getColumnTypeInDatabase(
    column: AnalyticsTableColumn,
  ): Promise<TableColumnType | null> {
    if (!column) {
      return null;
    }

    const columnName: string = column.key;

    if (!(await this.doesColumnExistInDatabase(columnName))) {
      return null;
    }

    const statement: string =
      this.statementGenerator.getColumnTypesStatement(columnName);

    const dbResult: ExecResult<Stream> = await this.execute(statement);

    let strResult: string = await StreamUtil.convertStreamToText(
      dbResult.stream,
    );

    /*
     * Unwrap LowCardinality(...) first so dictionary-encoded columns
     * (e.g. LowCardinality(String), LowCardinality(Nullable(String)))
     * map back to their logical type instead of falling through to null.
     */
    if (strResult.includes("LowCardinality(")) {
      const inner: string = strResult.split("LowCardinality(")[1] as string;
      strResult = inner.substring(0, inner.lastIndexOf(")"));
    }

    // if strResult includes Nullable(type) then extract type.

    if (strResult.includes("Nullable")) {
      let type: string = strResult.split("Nullable(")[1] as string;
      type = type.split(")")[0] as string;
      strResult = type;
    }

    return (
      (this.statementGenerator.toTableColumnType(
        strResult.trim(),
      ) as TableColumnType) || null
    );
  }

  @CaptureSpan()
  public async countBy(countBy: CountBy<TBaseModel>): Promise<PositiveNumber> {
    try {
      /*
       * The same rewrite a findBy gets, and before the permission check for
       * the same reason: it turns client-only keys (a telemetry explorer's
       * `resourceFilters`) into the ones the statement compiler reads, and
       * the check refuses any key that is not a column. Without it, counting
       * the rows of a list narrowed by a resource facet failed outright.
       */
      if (!countBy.props?.ignoreHooks) {
        countBy = await this.onBeforeCount(countBy);
      }

      const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadPermission(
          this.modelType,
          countBy.query,
          null,
          countBy.props,
        );

      countBy.query = checkReadPermissionType.query;

      const countStatement: Statement = this.toCountStatement(countBy);

      let dbResult: ResultSet<"JSON">;

      try {
        dbResult = await this.executeQuery(countStatement);
      } catch (error) {
        throw this.toCountException(countBy, error);
      }

      logger.debug(`${this.model.tableName} Count Statement executed`, {
        tableName: this.model.tableName,
      } as LogAttributes);
      logger.debug(countStatement, {
        tableName: this.model.tableName,
      } as LogAttributes);

      let countPositive: PositiveNumber = new PositiveNumber(0);
      let hasCount: boolean = false;

      try {
        const resultInJSON: ResponseJSON<JSONObject> =
          await dbResult.json<JSONObject>();

        /*
         * count() is a UInt64, and whether it arrives as a JSON string or a
         * JSON number depends on the server's
         * output_format_json_quote_64bit_integers setting: ClickHouse
         * quoted 64-bit integers by default until 25.x flipped the default
         * to 0 (numbers). Accept both — a string-only check silently read
         * every count as 0 on modern servers, which (among other things)
         * meant telemetry monitors' Log/Span/Exception counts never crossed
         * their criteria thresholds.
         */
        const rawCount: unknown =
          resultInJSON.data && resultInJSON.data[0]
            ? resultInJSON.data[0]["count"]
            : undefined;

        if (typeof rawCount === "string" || typeof rawCount === "number") {
          countPositive = new PositiveNumber(rawCount);
          hasCount = true;
        }
      } catch (error) {
        /*
         * An exact count is a total a person reads, and one the time limit
         * stopped says so (see toCountException) — never "0". Any other
         * failure to read it fails below, as a count without a number.
         */
        if (
          countBy.exact &&
          AnalyticsDatabaseService.isQueryTimeoutError(error)
        ) {
          throw this.toCountException(countBy, error);
        }

        /*
         * The default count runs with timeout_overflow_mode='break', and
         * ClickHouse answers a count it broke off at max_execution_time with
         * an empty body (the aggregation has no partial row to emit). Its
         * callers — telemetry monitors' thresholds, the AI spike detector —
         * read that as "count unavailable", 0, as they always have.
         */
        if (!countBy.exact) {
          logger.warn(
            `${this.model.tableName} count query stopped before it finished, defaulting to 0`,
            { tableName: this.model.tableName } as LogAttributes,
          );
        }
      }

      /*
       * A 0 that stands for "no answer" is fine for a threshold, and wrong
       * for a total a person reads: "0 spans" over a list of spans.
       */
      if (countBy.exact && !hasCount) {
        throw new ServerException(
          `The ${this.model.singularName.toLowerCase()} count came back without a number.`,
        );
      }

      logger.debug(`Result: `, {
        tableName: this.model.tableName,
      } as LogAttributes);
      logger.debug(countPositive.toNumber(), {
        tableName: this.model.tableName,
      } as LogAttributes);

      countPositive = await this.onCountSuccess(countPositive);
      return countPositive;
    } catch (error) {
      await this.onCountError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  /**
   * Returns whether at least one row matches the query, without counting
   * every match. Prefer this over `countBy(...).toNumber() === 0` for
   * existence checks: `count()` scans every matching row, whereas this
   * issues `SELECT 1 ... LIMIT 1`, which lets ClickHouse short-circuit at
   * the first matching granule — dramatically cheaper on large tables
   * (Metric / Span / Log).
   */
  @CaptureSpan()
  public async existsBy(existsBy: ExistsBy<TBaseModel>): Promise<boolean> {
    try {
      const checkReadPermissionType: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadPermission(
          this.modelType,
          existsBy.query,
          null,
          existsBy.props,
        );

      existsBy.query = checkReadPermissionType.query;

      const existsStatement: Statement = this.toExistsStatement(existsBy);

      const dbResult: ResultSet<"JSON"> =
        await this.executeQuery(existsStatement);

      const resultInJSON: ResponseJSON<JSONObject> =
        await dbResult.json<JSONObject>();

      return Boolean(
        resultInJSON.data &&
          Array.isArray(resultInJSON.data) &&
          resultInJSON.data.length > 0,
      );
    } catch (error) {
      await this.onFindError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  @CaptureSpan()
  public async addColumnInDatabase(
    column: AnalyticsTableColumn,
  ): Promise<void> {
    const statement: Statement =
      this.statementGenerator.toAddColumnStatement(column);
    /*
     * Schema-sync / migration-only path: route through the migration pool so a
     * column add that backfills a DEFAULT/MATERIALIZED expression on a large
     * table is not destroyed at the App pool's 58s socket-idle timeout.
     */
    await this.execute(statement, MigrationExecuteOptions);

    // Add skip index separately (ClickHouse requires ADD INDEX as a separate ALTER statement)
    const indexStatement: Statement | null =
      this.statementGenerator.toAddSkipIndexStatement(column);
    if (indexStatement) {
      await this.execute(indexStatement, MigrationExecuteOptions);
    }
  }

  @CaptureSpan()
  public async dropColumnInDatabase(columnName: string): Promise<void> {
    /*
     * Drop any skip index associated with this column before dropping the column itself.
     * ClickHouse will reject a column drop if a skip index depends on it.
     */
    const column: AnalyticsTableColumn | undefined =
      this.model.tableColumns.find((col: AnalyticsTableColumn) => {
        return col.key === columnName;
      });

    if (column?.skipIndex) {
      await this.execute(
        this.statementGenerator.toDropSkipIndexStatement(column.skipIndex.name),
        MigrationExecuteOptions,
      );
    }

    await this.execute(
      this.statementGenerator.toDropColumnStatement(columnName),
      MigrationExecuteOptions,
    );
  }

  public async doesColumnExist(columnName: string): Promise<boolean> {
    // Columns live on the physical (local) storage table in cluster mode.
    const tableName: string = getStorageTableName(this.model.tableName);
    const result: { data: Array<JSONObject> } = await (
      await this.executeQuery(
        `SELECT count() as cnt FROM system.columns WHERE database = currentDatabase() AND table = '${tableName}' AND name = '${columnName}'`,
      )
    ).json();

    const rows: Array<JSONObject> = result.data || [];

    return rows.length > 0 && Number(rows[0]!["cnt"]) > 0;
  }

  public async getColumnCodec(columnName: string): Promise<string> {
    const tableName: string = getStorageTableName(this.model.tableName);
    const result: { data: Array<JSONObject> } = await (
      await this.executeQuery(
        `SELECT compression_codec FROM system.columns WHERE database = currentDatabase() AND table = '${tableName}' AND name = '${columnName}'`,
      )
    ).json();

    const rows: Array<JSONObject> = result.data || [];

    if (rows.length === 0) {
      return "";
    }

    return (rows[0]!["compression_codec"] as string) || "";
  }

  /**
   * The exact ClickHouse type string for a column as stored in the DB
   * (e.g. "String", "Nullable(Int32)", "LowCardinality(Nullable(String))").
   * Returns "" if the column does not exist. Used by migrations that need to
   * re-state a column's type in a MODIFY COLUMN without guessing it.
   */
  public async getColumnDatabaseType(columnName: string): Promise<string> {
    const tableName: string = getStorageTableName(this.model.tableName);
    const result: { data: Array<JSONObject> } = await (
      await this.executeQuery(
        `SELECT type FROM system.columns WHERE database = currentDatabase() AND table = '${tableName}' AND name = '${columnName}'`,
      )
    ).json();

    const rows: Array<JSONObject> = result.data || [];

    if (rows.length === 0) {
      return "";
    }

    return (rows[0]!["type"] as string) || "";
  }

  public async setColumnCodecIfNotSet(data: {
    columnName: string;
    columnType: string;
    codec: string;
    expectedCodecValue: string;
  }): Promise<void> {
    /*
     * MODIFY COLUMN on the local table; ReplicatedMergeTree fans the codec
     * change out to the other replicas through Keeper.
     */
    const tableName: string = getStorageTableName(this.model.tableName);
    const currentCodec: string = await this.getColumnCodec(data.columnName);

    if (currentCodec === data.expectedCodecValue) {
      logger.info(
        `${tableName}.${data.columnName} already has ${data.expectedCodecValue}, skipping`,
        { tableName } as LogAttributes,
      );
      return;
    }

    await this.execute(
      `ALTER TABLE ${tableName} MODIFY COLUMN ${data.columnName} ${data.columnType} CODEC(${data.codec}) SETTINGS mutations_sync=0`,
      MigrationExecuteOptions,
    );
    logger.info(
      `Applied ${data.codec} codec to ${tableName}.${data.columnName} (async)`,
      { tableName } as LogAttributes,
    );
  }

  @CaptureSpan()
  public async findBy(findBy: FindBy<TBaseModel>): Promise<Array<TBaseModel>> {
    return await this._findBy(findBy);
  }

  /**
   * Group telemetry rows by (primaryEntityId, primaryEntityType) for a project over a
   * time window, returning the row count and an estimate of the ingested
   * byte size (ClickHouse `byteSize(*)`, the uncompressed in-memory size of
   * each row's columns). This is the enumeration source for usage billing:
   * a single aggregation scan surfaces EVERY resource that emitted
   * telemetry — real Services, Hosts, Docker hosts, Kubernetes clusters,
   * Monitors and unattributed (primaryEntityId = projectId) — without needing a
   * Postgres row per resource. The caller decides which serviceTypes to
   * bill and how to attribute retention.
   */
  @CaptureSpan()
  public async groupTelemetryUsageByService(data: {
    projectId: ObjectID;
    timestampColumnName: keyof TBaseModel | string;
    startDate: Date;
    endDate: Date;
    /*
     * Row names left out of the scan entirely, for a table where OneUptime
     * writes its own rows under the same (primaryEntityId, primaryEntityType)
     * as the customer's, so the grouping cannot tell them apart and the
     * caller's entity-type exclusion cannot either - the session replay
     * budget series sit next to a RUM application's web vitals (see
     * TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES). Empty or absent leaves the
     * statement exactly as it was.
     */
    excludeNames?: Array<string> | undefined;
  }): Promise<
    Array<{
      primaryEntityId: string;
      primaryEntityType: string | null;
      rowCount: number;
      estimatedBytes: number;
    }>
  > {
    const timestampColumnName: string = data.timestampColumnName.toString();

    if (!this.model.getTableColumn(timestampColumnName)) {
      throw new BadDataException(
        `Invalid timestampColumnName: ${timestampColumnName}`,
      );
    }

    const excludeNames: Array<string> = data.excludeNames || [];

    /*
     * Names can only be excluded from a table whose `name` is a required
     * column. Without one ClickHouse fails on the unknown column mid-billing
     * run; with a Nullable one (Span's), `NULL NOT IN (...)` is not true, so
     * every unnamed row would silently drop out of the bill. Either way the
     * caller has a bug, so refuse before the scan.
     */
    if (
      excludeNames.length > 0 &&
      !this.model.getTableColumn("name")?.required
    ) {
      throw new BadDataException(
        `excludeNames needs a required name column, and ${this.model.tableName} has none`,
      );
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT primaryEntityId AS primaryEntityId, primaryEntityType AS primaryEntityType, count() AS rowCount, sum(byteSize(*)) AS estimatedBytes FROM ${databaseName}.${this.model.tableName} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND ${timestampColumnName} >= ${{
      type: TableColumnType.DateTime64,
      value: data.startDate,
    }} AND ${timestampColumnName} <= ${{
      type: TableColumnType.DateTime64,
      value: data.endDate,
    }}`;

    /*
     * Inside the WHERE, before the grouping, so an excluded row is never
     * counted or sized. The names travel as one Array(String) parameter,
     * never as SQL text.
     */
    if (excludeNames.length > 0) {
      statement.append(
        SQL` AND name NOT IN ${{
          type: TableColumnType.ArrayText,
          value: excludeNames,
        }}`,
      );
    }

    statement.append(SQL` GROUP BY primaryEntityId, primaryEntityType`);

    /*
     * Billing scan: deliberately NO timeout_overflow_mode='break'. A
     * partial aggregation here silently undercounts usage (rows that
     * weren't scanned before the cap simply never get billed). Failing
     * loudly lets the staging cron retry instead; the cap is raised to
     * compensate for the full-day scan on large projects.
     */
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 120 }));

    const dbResult: ResultSet<"JSON"> = await this.executeQuery(statement);
    const responseJSON: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();
    const items: Array<JSONObject> = responseJSON.data ? responseJSON.data : [];

    const results: Array<{
      primaryEntityId: string;
      primaryEntityType: string | null;
      rowCount: number;
      estimatedBytes: number;
    }> = [];

    for (const item of items) {
      const primaryEntityId: string = (item["primaryEntityId"] as string) || "";
      if (!primaryEntityId) {
        continue;
      }
      const serviceTypeRaw: unknown = item["primaryEntityType"];
      const primaryEntityType: string | null =
        typeof serviceTypeRaw === "string" && serviceTypeRaw.trim()
          ? serviceTypeRaw
          : null;
      results.push({
        primaryEntityId,
        primaryEntityType,
        rowCount: Number(item["rowCount"]) || 0,
        estimatedBytes: Number(item["estimatedBytes"]) || 0,
      });
    }

    return results;
  }

  /**
   * The UTC days (YYYY-MM-DD) in a window on which a project has at least
   * one row in this table. It reads only projectId and the timestamp, so it
   * costs a fraction of groupTelemetryUsageByService's byteSize(*) scan:
   * usage billing asks it which missed days are worth a full usage scan,
   * instead of scanning every day of its catch-up window for every project.
   */
  @CaptureSpan()
  public async getDaysWithRows(data: {
    projectId: ObjectID;
    timestampColumnName: keyof TBaseModel | string;
    startDate: Date;
    endDate: Date;
    // Rows never billed, left out as groupTelemetryUsageByService leaves them out.
    excludeNames?: Array<string> | undefined;
  }): Promise<Array<string>> {
    const timestampColumnName: string = data.timestampColumnName.toString();

    if (!this.model.getTableColumn(timestampColumnName)) {
      throw new BadDataException(
        `Invalid timestampColumnName: ${timestampColumnName}`,
      );
    }

    const excludeNames: Array<string> = data.excludeNames || [];

    // Same refusal, for the same reason, as groupTelemetryUsageByService.
    if (
      excludeNames.length > 0 &&
      !this.model.getTableColumn("name")?.required
    ) {
      throw new BadDataException(
        `excludeNames needs a required name column, and ${this.model.tableName} has none`,
      );
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT toString(toDate(${timestampColumnName}, 'UTC')) AS day FROM ${databaseName}.${this.model.tableName} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND ${timestampColumnName} >= ${{
      type: TableColumnType.DateTime64,
      value: data.startDate,
    }} AND ${timestampColumnName} <= ${{
      type: TableColumnType.DateTime64,
      value: data.endDate,
    }}`;

    if (excludeNames.length > 0) {
      statement.append(
        SQL` AND name NOT IN ${{
          type: TableColumnType.ArrayText,
          value: excludeNames,
        }}`,
      );
    }

    statement.append(SQL` GROUP BY day ORDER BY day`);

    /*
     * No timeout_overflow_mode='break', as on the usage scan: a partial
     * answer would hide a day that still needs billing.
     */
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 120 }));

    const dbResult: ResultSet<"JSON"> = await this.executeQuery(statement);
    const responseJSON: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();
    const items: Array<JSONObject> = responseJSON.data ? responseJSON.data : [];

    const days: Array<string> = [];

    for (const item of items) {
      const day: unknown = item["day"];

      if (typeof day === "string" && day) {
        days.push(day);
      }
    }

    return days;
  }

  @CaptureSpan()
  public async aggregateBy(
    aggregateBy: AggregateBy<TBaseModel>,
  ): Promise<AggregatedResult> {
    return await this._aggregateBy(aggregateBy);
  }

  private async _aggregateBy(
    aggregateBy: AggregateBy<TBaseModel>,
  ): Promise<AggregatedResult> {
    try {
      if (!aggregateBy.sort || Object.keys(aggregateBy.sort).length === 0) {
        aggregateBy.sort = {
          [aggregateBy.aggregationTimestampColumnName as keyof TBaseModel]:
            SortOrder.Descending,
        } as Sort<TBaseModel>;
      }

      if (!aggregateBy.limit) {
        aggregateBy.limit = 10;
      }

      if (!aggregateBy.aggregationType) {
        throw new BadDataException("aggregationType is required");
      }

      const allowedAggregationTypes: Array<string> =
        Object.values(AggregationType);
      if (!allowedAggregationTypes.includes(aggregateBy.aggregationType)) {
        throw new BadDataException(
          `Invalid aggregationType: ${aggregateBy.aggregationType}. Allowed values: ${allowedAggregationTypes.join(", ")}`,
        );
      }

      if (
        aggregateBy.aggregationInterval !== undefined &&
        !Object.values(AggregationInterval).includes(
          aggregateBy.aggregationInterval,
        )
      ) {
        throw new BadDataException(
          `Invalid aggregationInterval: ${aggregateBy.aggregationInterval}. Allowed values: ${Object.values(AggregationInterval).join(", ")}`,
        );
      }

      if (!aggregateBy.aggregationTimestampColumnName) {
        throw new BadDataException(
          "aggregationTimestampColumnName is required",
        );
      }

      if (!aggregateBy.aggregateColumnName) {
        throw new BadDataException("aggregateColumnName is required");
      }

      if (
        !this.model.getTableColumn(aggregateBy.aggregateColumnName.toString())
      ) {
        throw new BadDataException(
          `Invalid aggregateColumnName: ${aggregateBy.aggregateColumnName.toString()}`,
        );
      }

      if (
        !this.model.getTableColumn(
          aggregateBy.aggregationTimestampColumnName.toString(),
        )
      ) {
        throw new BadDataException(
          `Invalid aggregationTimestampColumnName: ${aggregateBy.aggregationTimestampColumnName.toString()}`,
        );
      }

      const result: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadPermission(
          this.modelType,
          aggregateBy.query,
          {
            [aggregateBy.aggregateColumnName]: true,
            [aggregateBy.aggregationTimestampColumnName]: true,
          } as Select<TBaseModel>,
          aggregateBy.props,
        );

      aggregateBy.query = result.query;

      const findStatement: {
        statement: Statement;
        columns: Array<string>;
      } = this.toAggregateStatement(aggregateBy);

      const dbResult: ResultSet<"JSON"> = await this.executeQuery(
        findStatement.statement,
      );

      logger.debug(`${this.model.tableName} Aggregate Statement executed`, {
        tableName: this.model.tableName,
      } as LogAttributes);

      const responseJSON: ResponseJSON<JSONObject> =
        await dbResult.json<JSONObject>();

      const items: Array<JSONObject> = responseJSON.data
        ? responseJSON.data
        : [];

      const aggregatedItems: Array<AggregatedModel> = [];

      // convert date column from string to date.

      const groupByColumnNames: Array<string> = aggregateBy.groupBy
        ? Object.keys(aggregateBy.groupBy)
        : [];

      /*
       * Attribute-key grouping returns the selected keys folded into a
       * single `attributes` map column (see MetricService); carry it
       * onto the aggregated rows so series splitters can read labels.
       */
      if (
        aggregateBy.groupByAttributeKeys &&
        aggregateBy.groupByAttributeKeys.length > 0 &&
        !groupByColumnNames.includes("attributes")
      ) {
        groupByColumnNames.push("attributes");
      }

      for (const item of items) {
        if (
          !(item as JSONObject)[
            aggregateBy.aggregationTimestampColumnName as string
          ]
        ) {
          continue;
        }

        // if value is of type string then convert it to number.

        if (
          typeof (item as JSONObject)[
            aggregateBy.aggregateColumnName as string
          ] === Typeof.String
        ) {
          (item as JSONObject)[aggregateBy.aggregateColumnName as string] =
            Number.parseFloat(
              (item as JSONObject)[
                aggregateBy.aggregateColumnName as string
              ] as string,
            );
        }

        /*
         * Preserve every group-by column on the aggregated row. The
         * previous implementation only copied the first column, which
         * silently dropped the rest when callers grouped by more than
         * one dimension (e.g. attributes + name). `AggregatedModel`'s
         * index signature already accepts arbitrary keys, so existing
         * single-column consumers still work.
         */
        const aggregatedModel: AggregatedModel = {
          timestamp: OneUptimeDate.fromString(
            (item as JSONObject)[
              aggregateBy.aggregationTimestampColumnName as string
            ] as string,
          ),
          value: (item as JSONObject)[
            aggregateBy.aggregateColumnName as string
          ] as number,
        };

        for (const groupByColumnName of groupByColumnNames) {
          aggregatedModel[groupByColumnName] = (item as JSONObject)[
            groupByColumnName
          ] as AggregatedModel[string];
        }

        aggregatedItems.push(aggregatedModel);
      }

      /*
       * Top-K statements (see MetricService) carry the pre-trim group
       * count as a constant `__total_groups` column on every row; lift
       * it off the first row into result metadata. The per-row copy
       * loop above only projects timestamp/value/group-by columns, so
       * the helper column never reaches the rows themselves.
       */
      let totalGroups: number | undefined = undefined;
      const firstItem: JSONObject | undefined = items[0];
      if (firstItem && firstItem["__total_groups"] !== undefined) {
        const parsedTotalGroups: number = Number(firstItem["__total_groups"]);
        if (Number.isFinite(parsedTotalGroups)) {
          totalGroups = parsedTotalGroups;
        }
      }

      /*
       * Truncation detection. Row-count == LIMIT is a heuristic (an
       * exactly-full window reads as truncated), but a false positive
       * only over-warns; the silent-data-loss case it exists to catch
       * (groups × buckets > limit dropping the oldest buckets) is
       * always flagged. Top-K truncation is exact: the ranking phase
       * counted every matching group.
       */
      const appliedLimit: number = Number(aggregateBy.limit);
      let truncated: boolean =
        Number.isFinite(appliedLimit) &&
        appliedLimit > 0 &&
        items.length >= appliedLimit;
      if (
        aggregateBy.topK &&
        totalGroups !== undefined &&
        totalGroups > aggregateBy.topK.count
      ) {
        truncated = true;
      }

      return {
        data: aggregatedItems,
        ...(totalGroups !== undefined ? { totalGroups } : {}),
        truncated,
      };
    } catch (error) {
      await this.onFindError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  private async _findBy(
    findBy: FindBy<TBaseModel>,
  ): Promise<Array<TBaseModel>> {
    try {
      if (!findBy.sort || Object.keys(findBy.sort).length === 0) {
        /*
         * Default sort uses the model's declared `defaultSortColumn`
         * (e.g. `time` for Log, `startTime` for Span) so the query
         * streams from the ClickHouse sort key. The historical
         * fallback of `createdAt` is not in the sort key on most
         * analytics tables, which triggered a full sort even on
         * small LIMITed queries.
         */
        const defaultSortColumn: string =
          this.model.defaultSortColumn || "createdAt";
        findBy.sort = {
          [defaultSortColumn]: SortOrder.Descending,
        } as any;

        if (!findBy.select) {
          findBy.select = {} as any;
        }
      }

      const onFind: OnFind<TBaseModel> = findBy.props.ignoreHooks
        ? { findBy, carryForward: [] }
        : await this.onBeforeFind(findBy);
      const onBeforeFind: FindBy<TBaseModel> = { ...onFind.findBy };
      const carryForward: any = onFind.carryForward;

      if (
        !onBeforeFind.select ||
        Object.keys(onBeforeFind.select).length === 0
      ) {
        onBeforeFind.select = {} as any;
      }

      /*
       * Derived aggregate targets deliberately omit AnalyticsBaseModel's
       * synthetic `_id`: the aggregation key is the row identity. Only force
       * `_id` into generic reads when the model actually declares it.
       */
      if (
        this.model.tableColumns.some(
          (column: AnalyticsTableColumn): boolean => {
            return column.key === "_id";
          },
        ) &&
        !(onBeforeFind.select as any)["_id"]
      ) {
        (onBeforeFind.select as any)["_id"] = true;
      }

      const result: CheckReadPermissionType<TBaseModel> =
        await ModelPermission.checkReadPermission(
          this.modelType,
          onBeforeFind.query,
          onBeforeFind.select || null,
          onBeforeFind.props,
        );

      onBeforeFind.query = result.query;
      onBeforeFind.select = result.select || undefined;

      if (!(onBeforeFind.skip instanceof PositiveNumber)) {
        onBeforeFind.skip = new PositiveNumber(onBeforeFind.skip);
      }

      if (!(onBeforeFind.limit instanceof PositiveNumber)) {
        onBeforeFind.limit = new PositiveNumber(onBeforeFind.limit);
      }

      const findStatement: {
        statement: Statement;
        columns: Array<string>;
      } = this.toFindStatement(onBeforeFind);

      const dbResult: ResultSet<"JSON"> = await this.executeQuery(
        findStatement.statement,
      );

      logger.debug(`${this.model.tableName} Find Statement executed`, {
        tableName: this.model.tableName,
      } as LogAttributes);
      logger.debug(findStatement.statement, {
        tableName: this.model.tableName,
      } as LogAttributes);

      const responseJSON: ResponseJSON<JSONObject> =
        await dbResult.json<JSONObject>();

      const jsonItems: Array<JSONObject> = responseJSON.data;

      let items: Array<TBaseModel> =
        AnalyticsBaseModel.fromJSONArray<TBaseModel>(jsonItems, this.modelType);

      if (!findBy.props.ignoreHooks) {
        items = await (
          await this.onFindSuccess({ findBy, carryForward }, items)
        ).carryForward;
      }

      return items;
    } catch (error) {
      await this.onFindError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  public convertSelectReturnedDataToJson(
    strResult: string,
    columns: string[],
  ): JSONObject[] {
    if (!strResult || !strResult.trim()) {
      return [];
    }

    const jsonItems: Array<JSONObject> = [];

    const rows: Array<string> = strResult.split("\n");

    for (const row of rows) {
      if (!row) {
        continue;
      }

      const jsonItem: JSONObject = {};
      const values: Array<string> = row.split("\t");

      for (let i: number = 0; i < columns.length; i++) {
        jsonItem[columns[i]!] = values[i];

        if (values[i] === "NULL") {
          jsonItem[columns[i]!] = null;
        }

        if (values[i] === "\\N") {
          jsonItem[columns[i]!] = null;
        }
      }

      jsonItems.push(jsonItem);
    }

    return jsonItems;
  }

  protected async onBeforeDelete(
    deleteBy: DeleteBy<TBaseModel>,
  ): Promise<OnDelete<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ deleteBy, carryForward: null });
  }

  protected async onBeforeUpdate(
    updateBy: UpdateBy<TBaseModel>,
  ): Promise<OnUpdate<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ updateBy, carryForward: null });
  }

  protected async onBeforeFind(
    findBy: FindBy<TBaseModel>,
  ): Promise<OnFind<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ findBy, carryForward: null });
  }

  /*
   * A place holder method used for overriding. A service whose onBeforeFind
   * rewrites the query must rewrite a count's query the same way, or the
   * count describes different rows than the list it is shown beside.
   */
  protected async onBeforeCount(
    countBy: CountBy<TBaseModel>,
  ): Promise<CountBy<TBaseModel>> {
    return Promise.resolve(countBy);
  }

  /*
   * Whether ClickHouse refused to finish a query in the time it was given:
   * TIMEOUT_EXCEEDED (159) once max_execution_time passes with
   * timeout_overflow_mode 'throw', TOO_SLOW (160) when the server estimates
   * up front that it would, or the QueryTimeoutException executeQuery turns
   * either into (see ClickhouseReadResult).
   */
  public static isQueryTimeoutError(error: unknown): boolean {
    return ClickhouseReadResult.isTimeLimitError(error);
  }

  /*
   * What a failed count query is rethrown as. An exact count that ran out of
   * time says so, and says what to do about it, rather than surfacing as an
   * unexplained database error: the explorers that show the total tell the
   * reader to narrow the window.
   */
  private toCountException(
    countBy: CountBy<TBaseModel>,
    error: unknown,
  ): unknown {
    if (countBy.exact && AnalyticsDatabaseService.isQueryTimeoutError(error)) {
      return new QueryTimeoutException(
        `Counting every matching ${this.model.singularName.toLowerCase()} took longer than ${COUNT_MAX_EXECUTION_TIME_IN_SECONDS} seconds. Narrow the time range or add a filter to get an exact total.`,
      );
    }

    return error;
  }

  /**
   * Read-side retention filter. TTL deletes rows by `retentionDate`, and
   * ClickHouse applies it only when it merges: on a table with
   * ttl_only_drop_parts=1 a part survives until EVERY row in it has
   * expired, and on the metric and log tables, whose TTL is rounded up
   * to the midnight after retentionDate (RetentionTtl), an expired row
   * survives until that midnight - up to a day. Either way rows past
   * their retention stay on disk (and were queryable) for a while. For
   * models that carry a retentionDate column, every centrally generated
   * read appends this predicate so expired rows become invisible the
   * moment they expire rather than when they are finally removed.
   *
   * Returns the raw SQL fragment (server-evaluated now(), no parameter)
   * or "" when the model has no retentionDate column.
   */
  protected getRetentionReadFilter(): string {
    if (!this.model.getTableColumn("retentionDate")) {
      return "";
    }
    return " AND retentionDate >= now()";
  }

  public toCountStatement(countBy: CountBy<TBaseModel>): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      countBy.query,
    );

    /* eslint-disable prettier/prettier */
    const statement: Statement = SQL`
            SELECT
                count(`;

    if (countBy.groupBy && Object.keys(countBy.groupBy).length > 0) {
      const groupByKey: string = Object.keys(countBy.groupBy)[0] as string;

      statement.append(SQL`DISTINCT ${groupByKey}`);
    }

    statement
      .append(
        SQL`) as count
            FROM ${databaseName}.${this.model.tableName}
            WHERE TRUE `,
      )
      .append(whereStatement)
      .append(this.getRetentionReadFilter());

    if (countBy.limit) {
      statement.append(SQL`
            LIMIT ${{
              value: Number(countBy.limit),
              type: TableColumnType.Number,
            }}
            `);
    }

    if (countBy.skip) {
      statement.append(SQL`
            OFFSET ${{
              value: Number(countBy.skip),
              type: TableColumnType.Number,
            }}
            `);
    }

    /*
     * Cap count query runtime below the ClickHouse client's 58s
     * request_timeout. Wide time-range queries on large tables (e.g. Span)
     * can scan billions of rows; without a cap the query runs until the
     * HTTP client disconnects, wasting ClickHouse resources. With 'break'
     * mode ClickHouse returns a partial (lower-bound) count rather than
     * throwing, which is acceptable for a threshold. It is not for an exact
     * count: a partial count printed as a total is a wrong total, so that
     * one fails instead (see countBy).
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: COUNT_MAX_EXECUTION_TIME_IN_SECONDS,
        timeoutOverflowMode: countBy.exact ? "throw" : "break",
      }),
    );

    logger.debug(`${this.model.tableName} Count Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return statement;
  }

  public toExistsStatement(existsBy: ExistsBy<TBaseModel>): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      existsBy.query,
    );

    /*
     * `SELECT 1 ... LIMIT 1` so ClickHouse stops at the first matching
     * row instead of scanning every match like count() does. The
     * max_execution_time cap is defense in depth; unlike the count and
     * find statements we deliberately do NOT set timeout_overflow_mode
     * = 'break' here, because a partial (empty) result would be read as
     * "does not exist" — a false negative that could, for example, let a
     * caller insert a duplicate. A LIMIT 1 over the sort key never gets
     * near this cap in practice; if it ever did, throwing is the safe
     * outcome.
     */
    /* eslint-disable prettier/prettier */
    const statement: Statement = SQL`
            SELECT 1 as existsFlag
            FROM ${databaseName}.${this.model.tableName}
            WHERE TRUE `
      .append(whereStatement)
      .append(this.getRetentionReadFilter());

    statement.append(SQL` LIMIT 1`);

    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 45 }));

    logger.debug(`${this.model.tableName} Exists Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return statement;
  }

  /**
   * The timeout_overflow_mode an aggregate statement carries: always
   * 'throw' (issue #4707).
   *
   * Charts used to keep a 'break' default on the understanding that it
   * returns the buckets counted so far. It does not: ClickHouse answers a
   * grouped read it breaks off at max_execution_time with an EMPTY body
   * (measured on 24.8 and 26.7), which failed the chart with a bare "Server
   * Error". Partial buckets that look complete would be no better — a
   * chart missing one end of its window draws a drop that never happened.
   * A chart that runs out of time now says so, the way the alerting callers
   * (the metric-monitor worker) already asked for with
   * `aggregateBy.timeoutOverflowMode = "throw"`.
   *
   * The field is still accepted and no longer needed. It is never passed
   * through: aggregateBy is deserialized wholesale from API clients and this
   * setting is emitted into SQL as a trusted literal (see
   * QuerySettingsHelper).
   */
  protected getTimeoutOverflowMode(
    _aggregateBy: AggregateBy<TBaseModel>,
  ): TimeoutOverflowMode {
    return "throw";
  }

  public toAggregateStatement(aggregateBy: AggregateBy<TBaseModel>): {
    statement: Statement;
    columns: Array<string>;
  } {
    /*
     * Attribute-key grouping needs model-specific SQL over a map column
     * (MetricService builds it); reaching this generic path with keys
     * set would silently return ungrouped results.
     */
    if (
      aggregateBy.groupByAttributeKeys &&
      aggregateBy.groupByAttributeKeys.length > 0
    ) {
      throw new BadDataException(
        `groupByAttributeKeys is not supported for ${this.model.tableName}.`,
      );
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const select: { statement: Statement; columns: Array<string> } =
      this.statementGenerator.toAggregateSelectStatement(aggregateBy);

    /*
     * The aggregate SELECT aliases expressions to real column names
     * (`sum(col) as col`, and `min(ts) as ts` under Total), so the WHERE
     * must table-qualify its column references — unqualified ones would
     * resolve to those aliases (ILLEGAL_AGGREGATION under Total; bucket-
     * snapped time filters otherwise). See toWhereStatement.
     */
    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      aggregateBy.query,
      { tableAlias: this.model.tableName },
    );

    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      aggregateBy.sort!,
    );

    const statement: Statement = SQL``;

    statement.append(SQL`SELECT `.append(select.statement));
    statement.append(SQL` FROM ${databaseName}.${this.model.tableName}`);
    statement
      .append(SQL` WHERE TRUE `)
      .append(whereStatement)
      .append(this.getRetentionReadFilter());

    /*
     * The time bucket is a grouping key only when we ARE bucketing by
     * time. For a `Total` (whole-window) aggregation the timestamp is
     * emitted as `min(...)` — an aggregate, not a group key — so it must
     * be left out of GROUP BY. When there is no group-by column either,
     * the GROUP BY clause is omitted entirely (a single global row).
     */
    const resolvedInterval: AggregationInterval =
      AggregateUtil.getAggregationInterval({
        startDate: aggregateBy.startTimestamp!,
        endDate: aggregateBy.endTimestamp!,
        aggregationInterval: aggregateBy.aggregationInterval,
      });
    const bucketByTime: boolean =
      !AggregateUtil.isTotalAggregation(resolvedInterval);
    const hasGroupBy: boolean = Boolean(
      aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0,
    );

    if (bucketByTime) {
      statement
        .append(SQL` GROUP BY `)
        .append(`${aggregateBy.aggregationTimestampColumnName.toString()}`);
      if (hasGroupBy) {
        statement
          .append(SQL` , `)
          .append(
            this.statementGenerator.toGroupByStatement(aggregateBy.groupBy!),
          );
      }
    } else if (hasGroupBy) {
      statement
        .append(SQL` GROUP BY `)
        .append(
          this.statementGenerator.toGroupByStatement(aggregateBy.groupBy!),
        );
    }

    /*
     * A group-less Total aggregation (`SELECT agg(...), min(ts) ...` with no
     * GROUP BY) returns exactly one row even over an empty window —
     * ClickHouse fills the aggregates with type defaults, so min(ts)
     * surfaces as a 1970 epoch point. Suppress that phantom row. This is a
     * no-op for every bucketed/grouped query (they only ever emit rows for
     * groups that actually have data).
     */
    if (!bucketByTime && !hasGroupBy) {
      statement.append(SQL` HAVING count() > 0`);
    }

    statement.append(SQL` ORDER BY `).append(sortStatement);

    statement.append(
      SQL` LIMIT ${{
        value: Number(aggregateBy.limit),
        type: TableColumnType.Number,
      }}`,
    );

    statement.append(SQL` OFFSET ${{
      value: Number(aggregateBy.skip),
      type: TableColumnType.Number,
    }}
        `);

    /*
     * Aggregation read-path settings.
     *
     * - max_execution_time=45: cap aggregate runtime below the
     *   ClickHouse client's 58s request_timeout, same as the count/find
     *   statements — a wide-window aggregate over a large table would
     *   otherwise run until the HTTP client disconnects. It stops with
     *   'throw', so a chart that runs out of time is told so — see
     *   getTimeoutOverflowMode.
     * - optimize_aggregation_in_order: when GROUP BY is a prefix of the
     *   sort key (we always group by a time bucket and the time column
     *   is at the tail of every analytics primary key), ClickHouse can
     *   stream rows in order and emit aggregates without an in-memory
     *   sort, which is a large speedup on wide time ranges.
     * - optimize_move_to_prewhere: PREWHERE is a default-on optimizer
     *   pass; we set it explicitly so the behavior is independent of
     *   server-side defaults.
     * - max_threads=4: caps per-query parallelism so a single dashboard
     *   load (which fans out to many aggregate calls) does not starve
     *   other tenants on the cluster. Per-query latency is essentially
     *   unchanged at 4 threads for the usual dashboard widget time
     *   ranges, but cluster headroom is preserved under burst.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: this.getTimeoutOverflowMode(aggregateBy),
        additionalSettings: {
          optimize_aggregation_in_order: 1,
          optimize_move_to_prewhere: 1,
          max_threads: 4,
        },
      }),
    );

    logger.debug(`${this.model.tableName} Aggregate Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return { statement, columns: select.columns };
  }

  /**
   * Append the unique `_id` as a final sort key so the ORDER BY is a TOTAL
   * order.
   *
   * `ORDER BY time DESC` alone is not: rows tying on `time` may come back
   * in any order, and ClickHouse is free to order them differently between
   * two executions of the same query (part order, thread scheduling and
   * `optimize_read_in_order` all feed into it). Paging with LIMIT/OFFSET on
   * top of a non-total order silently drops rows at page boundaries and
   * repeats others: a row that sat at offset 49 on page 1 can shift to
   * offset 50 before page 2 is fetched, so nobody ever sees it.
   *
   * Ties are the normal case, not an edge case — a service emitting a burst
   * of logs writes many rows with an identical timestamp.
   *
   * `_id` is stamped per row with `ObjectID.generateTimeOrdered()`, so it is
   * unique and its ordering agrees with time order.
   *
   * Two cases must NOT get the tiebreaker:
   * - GROUP BY queries, where `_id` is neither a grouping key nor an
   *   aggregate, so referencing it is an error.
   * - Models with no `_id` column: derived aggregate targets deliberately
   *   omit it because the aggregation key is the row identity (see _findBy).
   */
  private toPaginationStableSort(
    sort: Sort<TBaseModel>,
    options: { hasGroupBy: boolean },
  ): Sort<TBaseModel> {
    if (options.hasGroupBy) {
      return sort;
    }

    const sortKeys: Array<string> = Object.keys(sort || {});

    // Already a total order; adding `_id` again would be a no-op term.
    if (sortKeys.includes("_id")) {
      return sort;
    }

    const hasIdColumn: boolean = this.model.tableColumns.some(
      (column: AnalyticsTableColumn): boolean => {
        return column.key === "_id";
      },
    );

    if (!hasIdColumn) {
      return sort;
    }

    /*
     * Tie-break in the same direction as the last declared sort key, so a
     * newest-first list stays newest-first within a single timestamp.
     */
    const lastSortKey: string | undefined = sortKeys[sortKeys.length - 1];

    const direction: SortOrder =
      (lastSortKey
        ? ((sort as Record<string, SortOrder | undefined>)[lastSortKey] as
            | SortOrder
            | undefined)
        : undefined) ?? SortOrder.Descending;

    /*
     * `_id` is absent from `sort` (checked above), so spreading appends it
     * last and the caller's own keys keep their relative order.
     */
    return { ...sort, _id: direction } as Sort<TBaseModel>;
  }

  /**
   * Finds a sorted page without sorting every matching row, and without
   * reading the time range twice (issue #4710). Returns null where it cannot
   * help or cannot be proven exact; the find is then sent as written.
   *
   * ClickHouse reads in sorting-key order — and stops early — only when the
   * ORDER BY lines up with the table's physical key. The `_id` tiebreaker
   * appended by `toPaginationStableSort` is deliberately NOT a sorting-key
   * column, so it denies that plan: the engine reads every row matching the
   * WHERE, sorts the lot in memory, then discards all but one page. On the
   * Logs viewer that turned a 100-row page into a full-window scan and tripped
   * the 3 GiB `max_memory_usage` ceiling (Code 241, "Server Error").
   * Weakening the tiebreaker would bring back the skip/repeat paging bug it
   * fixes, so the find is split in two, inside one statement:
   *
   * 1. A narrow read of the leading sort key `k` alone, in key order, that
   *    stops after `skip + limit` matching rows. Sorted, those are the first
   *    `skip + limit` values of k with their repeats — a rank statistic of
   *    k's multiset, the same whichever of several tied rows the read kept.
   *    The scalar subquery hands on only what the page needs: its own
   *    values (positions skip + 1 onwards) and how many of the rows tied
   *    with its first value belong to earlier pages.
   * 2. The wide read, of the rows whose k is one of the page's values —
   *    the primary index skips every granule that holds none of them —
   *    sorted with the tiebreaker, skipping those earlier-page ties.
   *
   * Exact, ties included: in the unbounded order the rows at positions
   * skip + 1 .. skip + limit carry exactly the page's values, every row
   * whose k lies between the page's first and last value carries one of
   * them, and every row before the page that ties with its first value
   * sorts ahead of the page. So the rows step 2 reads, in tiebreaker
   * order, are a stretch of the unbounded order that starts with those
   * earlier-page ties and holds the whole page right after them.
   *
   * It reads no more than the unbounded find, plus the granules that hold
   * the page's own key values (their ties included). The bound it replaces
   * (`k >= min(top values)`) read the whole range a second time when a
   * filter matched few rows spread over it, and when nothing matched at
   * all — min() of no rows is the column default, 1970. Here a page past
   * the last match reads no granule in step 2. Those granules are the one
   * cost left: when a skip index narrows a rare filter to the few granules
   * that hold its matches, step 1 and step 2 both read them — no more than
   * the bound before #4710 read.
   *
   * Measured on ClickHouse 26.7, 16M rows shaped like LogItemV3, a 30-day
   * range, one page of 101: no match 32.0M rows read -> 16.0M (the
   * unbounded find: 16.0M); 60 matches 32.4M -> 17.0M; a 0.1% filter 10,000
   * rows deep 25.9M -> 16.2M; no filter 0.38M either way (unbounded:
   * 10.7M). The same on 24.8, through a Distributed table over two shards,
   * and with the older analyzer a server can still switch to
   * (enable_analyzer = 0). The real-ClickHouse suite (App
   * Tests/Telemetry/PagedFindBoundClickhouse) holds these.
   *
   * Two of the gates below keep it exact: no GROUP BY, whose input it would
   * cut, and no Nullable leading key, because a NULL is never IN a set and
   * the row would be dropped. The rest only decide where it pays.
   */
  private toSortKeyPageBound(
    findBy: FindBy<TBaseModel>,
    sort: Sort<TBaseModel>,
    options: { hasGroupBy: boolean; databaseName: string },
  ): SortKeyPageBound | null {
    /*
     * Under GROUP BY the predicate would restrict the aggregation INPUT
     * rather than the page, so it would change results. Mirrors the
     * tiebreaker's own exemption, leaving grouped finds byte-identical.
     */
    if (options.hasGroupBy) {
      return null;
    }

    /*
     * Without an `_id` column there is no off-key tiebreaker — the six
     * `includeBaseColumns: false` aggregate targets — so the ORDER BY is
     * already key-aligned and the bound would be pure overhead. Same
     * condition toPaginationStableSort bails on.
     */
    const hasIdColumn: boolean = this.model.tableColumns.some(
      (column: AnalyticsTableColumn): boolean => {
        return column.key === "_id";
      },
    );

    if (!hasIdColumn) {
      return null;
    }

    const leadingSortKey: string | undefined = Object.keys(sort || {})[0];

    if (!leadingSortKey) {
      return null;
    }

    /*
     * Only a column in the physical sorting key can be read in order, so
     * only there can the off-key `_id` term have cost anything. Off-key
     * leads (e.g. Log by `severityText`) already plan a bounded top-N and
     * an extra pass would be pure waste.
     */
    if (!this.model.sortKeys.includes(leadingSortKey)) {
      return null;
    }

    /*
     * A non-required column is `Nullable(...)` in the DDL. A NULL key is
     * never IN the page's values (and groupArray leaves it out of them),
     * so the bound would DROP those rows rather than narrow the scan.
     * Fail safe to the unbounded find.
     */
    const leadingSortColumn: AnalyticsTableColumn | null =
      this.model.getTableColumn(leadingSortKey);

    if (!leadingSortColumn || !leadingSortColumn.required) {
      return null;
    }

    /*
     * `findOneById` funnels a point lookup through `findOneBy` carrying the
     * model's default sort. At most one row can match, so bounding it would
     * double a query that has no ordering problem to begin with.
     */
    if ((findBy.query as Record<string, unknown> | undefined)?.["_id"]) {
      return null;
    }

    /*
     * The bound is built from LIMIT and OFFSET themselves: it reads the
     * first `skip + limit` key values and keeps positions skip + 1 onwards.
     * A page that is not a whole, positive number of rows from a whole,
     * non-negative offset (NaN from `new PositiveNumber(undefined)`,
     * Infinity, a fraction, LIMIT 0) is sent unbounded.
     */
    const limit: number = Number(findBy.limit);
    const skip: number = Number(findBy.skip);

    if (
      !Number.isSafeInteger(limit) ||
      !Number.isSafeInteger(skip) ||
      limit < 1 ||
      skip < 0
    ) {
      return null;
    }

    const isDescending: boolean =
      (sort as Record<string, SortOrder | undefined>)[leadingSortKey] !==
      SortOrder.Ascending;

    /*
     * The narrow read must see the same rows the wide one filters, so the
     * WHERE is regenerated rather than shared: appending one Statement in
     * two places would bind its parameters twice.
     */
    const narrowWhereStatement: Statement =
      this.statementGenerator.toWhereStatement(findBy.query);

    /*
     * One scalar subquery, named once, so the narrow read runs once though
     * both the WHERE and the OFFSET use it. The page's values and its
     * offset are worked out inside it, so the OFFSET is a plain number:
     * OFFSET takes only a constant, and ClickHouse does not fold a function
     * whose result is a constant over about 1 MiB into one — counting the
     * ties in a slice of 131,073 DateTime64 values outside the subquery
     * fails with "OFFSET expression must be constant".
     */
    const withClause: Statement = SQL`WITH (SELECT (arraySlice(`;
    withClause.append(SORT_KEY_PAGE_VALUES_ALIAS);
    withClause.append(
      SQL`, ${{ value: skip + 1, type: TableColumnType.Number }}), countEqual(arraySlice(`,
    );
    withClause.append(SORT_KEY_PAGE_VALUES_ALIAS);
    withClause.append(
      SQL`, 1, ${{ value: skip, type: TableColumnType.Number }}), `,
    );
    withClause.append(SORT_KEY_PAGE_VALUES_ALIAS);
    withClause.append(
      SQL`[${{ value: skip + 1, type: TableColumnType.Number }}])) FROM (SELECT `,
    );
    // Sorted in the page's own direction, so position 1 leads the page.
    withClause.append(isDescending ? "arrayReverseSort" : "arraySort");
    withClause.append(SQL`(groupArray(${leadingSortKey})) AS `);
    withClause.append(SORT_KEY_PAGE_VALUES_ALIAS);
    withClause.append(
      SQL` FROM (SELECT ${leadingSortKey} FROM ${options.databaseName}.${this.model.tableName} WHERE TRUE `,
    );
    withClause.append(narrowWhereStatement);
    withClause.append(this.getRetentionReadFilter());
    withClause.append(SQL` ORDER BY ${leadingSortKey} `);
    withClause.append(isDescending ? SQL`DESC` : SQL`ASC`);
    withClause.append(
      SQL` LIMIT ${{
        value: skip + limit,
        type: TableColumnType.Number,
      }}))) AS `,
    );
    withClause.append(SORT_KEY_PAGE_BOUND_ALIAS);
    withClause.append(" ");

    /*
     * GLOBAL IN, not IN, and not has(): the table is Distributed, and
     * GLOBAL builds the set once, where the find was sent, and hands it to
     * every shard as a table, so no shard works the page out over its own
     * rows. A set is what the primary index can use on every supported
     * ClickHouse; has() over an array constant prunes on 26.7 but not on
     * 24.8. An empty set (a page past the last match) selects no granule
     * at all.
     */
    const whereCondition: Statement = SQL` AND ${leadingSortKey} GLOBAL IN (SELECT arrayJoin(tupleElement(`;
    whereCondition.append(SORT_KEY_PAGE_BOUND_ALIAS);
    whereCondition.append(", 1)))");

    /*
     * ifNull, though the subquery always answers its one row: ClickHouse
     * types a scalar subquery Nullable (it could answer none), and OFFSET
     * takes no Nullable type. The analyzer ClickHouse uses by default
     * folds the value all the same; the older one, still chosen by a
     * server or profile that sets enable_analyzer = 0, refuses it on 26.7
     * ("Illegal type Nullable(UInt64) of OFFSET expression") and every
     * list would fail. The 0 is never used.
     */
    const offset: Statement = SQL`ifNull(tupleElement(`;
    offset.append(SORT_KEY_PAGE_BOUND_ALIAS);
    offset.append(", 2), 0)");

    return { withClause, whereCondition, offset };
  }

  public toFindStatement(findBy: FindBy<TBaseModel>): {
    statement: Statement;
    columns: Array<string>;
  } {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    let groupByStatement: Statement | null = null;

    if (findBy.groupBy && Object.keys(findBy.groupBy).length > 0) {
      // overwrite select object
      findBy.select = {
        ...findBy.groupBy,
      };

      groupByStatement = this.statementGenerator.toGroupByStatement(
        findBy.groupBy,
      );
    }

    const select: { statement: Statement; columns: Array<string> } =
      this.statementGenerator.toSelectStatement(findBy.select!);

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      findBy.query,
    );

    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      this.toPaginationStableSort(findBy.sort!, {
        hasGroupBy: Boolean(groupByStatement),
      }),
    );

    /*
     * Keeps the `_id` tiebreaker affordable: the page's rows are found by
     * their leading sort key first, and only those are read whole. Exact
     * by construction, so the ORDER BY above is untouched. Null whenever
     * the bound cannot help or cannot be proven exact (issue #4710).
     */
    const pageBound: SortKeyPageBound | null = this.toSortKeyPageBound(
      findBy,
      findBy.sort!,
      {
        hasGroupBy: Boolean(groupByStatement),
        databaseName: databaseName,
      },
    );

    const statement: Statement = SQL``;

    if (pageBound) {
      statement.append(pageBound.withClause);
    }

    statement.append(SQL`SELECT `.append(select.statement));
    statement.append(SQL` FROM ${databaseName}.${this.model.tableName}`);
    statement
      .append(SQL` WHERE TRUE `)
      .append(whereStatement)
      .append(this.getRetentionReadFilter());

    if (pageBound) {
      statement.append(pageBound.whereCondition);
    }

    if (groupByStatement) {
      statement.append(SQL` GROUP BY `).append(groupByStatement);
    }

    statement.append(SQL` ORDER BY `).append(sortStatement);

    statement.append(
      SQL` LIMIT ${{
        value: Number(findBy.limit),
        type: TableColumnType.Number,
      }}`,
    );

    /*
     * A bounded page skips only the rows of earlier pages that tie with
     * its first sort-key value: the bound already left out every row
     * ahead of those.
     */
    if (pageBound) {
      statement.append(SQL` OFFSET `).append(pageBound.offset).append(`
        `);
    } else {
      statement.append(SQL` OFFSET ${{
        value: Number(findBy.skip),
        type: TableColumnType.Number,
      }}
        `);
    }

    /*
     * Defense in depth: cap find-query runtime below the ClickHouse
     * client's 58s request_timeout. The LIMIT clause keeps most queries
     * fast, but complex WHERE filters (e.g. parentSpanId IS NULL) on
     * wide time ranges can still cause long scans.
     *
     * 'throw', so a find that runs out of time is reported as exactly that
     * (a QueryTimeoutException, see executeQuery). 'break' was meant to
     * return the rows found so far, but ClickHouse answers a read it breaks
     * off with an empty or cut-off body (measured on 24.8 and 26.7): the
     * explorers' lists failed with a bare "Server Error" (issue #4707). And
     * the rows found so far would not have been the page asked for — a
     * newest-first list missing its newest rows still looks complete.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "throw",
      }),
    );

    logger.debug(`${this.model.tableName} Find Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return { statement, columns: select.columns };
  }

  public toDeleteStatement(deleteBy: DeleteBy<TBaseModel>): Statement {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      deleteBy.query,
    );

    /*
     * Lightweight `DELETE FROM` cannot target a Distributed table and does not
     * accept `ON CLUSTER`, so deletes are an `ALTER TABLE <local> ON CLUSTER …
     * DELETE` mutation dispatched to every shard (and replicated within each
     * shard via Keeper). ALTER ... DELETE mutations are bounded by
     * `number_of_mutations_to_throw` (default 1000) — but deletes are rare here
     * (retention is handled by TTL), so the queue does not accumulate.
     */
    /* eslint-disable prettier/prettier */
    const localTableName: string = getStorageTableName(this.model.tableName);
    const statement: Statement = SQL`
            ALTER TABLE ${databaseName}.${localTableName}`
      .append(onClusterClause())
      .append(
        SQL`
            DELETE WHERE TRUE `,
      )
      .append(whereStatement);

    logger.debug(`${this.model.tableName} Delete Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return statement;
  }

  @CaptureSpan()
  public async findOneBy(
    findOneBy: FindOneBy<TBaseModel>,
  ): Promise<TBaseModel | null> {
    const findBy: FindBy<TBaseModel> = findOneBy as FindBy<TBaseModel>;
    findBy.limit = new PositiveNumber(1);
    findBy.skip = new PositiveNumber(0);

    const documents: Array<TBaseModel> = await this._findBy(findBy);

    if (documents && documents[0]) {
      return documents[0];
    }
    return null;
  }

  @CaptureSpan()
  public async deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<void> {
    return await this._deleteBy(deleteBy);
  }

  private async _deleteBy(deleteBy: DeleteBy<TBaseModel>): Promise<void> {
    try {
      // Refused before any hook runs; see assertCredentialCanWrite.
      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(
        deleteBy.props,
      );

      const onDelete: OnDelete<TBaseModel> = deleteBy.props.ignoreHooks
        ? { deleteBy, carryForward: [] }
        : await this.onBeforeDelete(deleteBy);

      const beforeDeleteBy: DeleteBy<TBaseModel> = onDelete.deleteBy;

      beforeDeleteBy.query = await ModelPermission.checkDeletePermission(
        this.modelType,
        beforeDeleteBy.query,
        deleteBy.props,
      );

      const select: Select<TBaseModel> = {};

      const tenantColumnName: string | null =
        this.getModel().getTenantColumn()?.key || null;

      if (tenantColumnName) {
        (select as any)[tenantColumnName] = true;
      }

      const deleteStatement: Statement = this.toDeleteStatement(beforeDeleteBy);

      await this.execute(deleteStatement);

      logger.debug(`${this.model.tableName} Delete Statement executed`, {
        tableName: this.model.tableName,
      } as LogAttributes);
      logger.debug(deleteStatement, {
        tableName: this.model.tableName,
      } as LogAttributes);
    } catch (error) {
      await this.onDeleteError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  @CaptureSpan()
  public async findOneById(
    findOneById: FindOneByID<TBaseModel>,
  ): Promise<TBaseModel | null> {
    if (!findOneById.id) {
      throw new BadDataException("findOneById.id is required");
    }

    return await this.findOneBy({
      query: {
        _id: findOneById.id,
      },
      select: findOneById.select || {},
      props: findOneById.props,
    });
  }

  @CaptureSpan()
  public async updateBy(updateBy: UpdateBy<TBaseModel>): Promise<void> {
    await this._updateBy(updateBy);
  }

  /*
   * Deletes the one row `id` names, when the delete reaches it, and answers
   * how many rows it reached: 1, or 0 for a row that is missing or not one
   * the caller may delete - the rows of resources their delete and read
   * grants both reach (ModelPermission.checkDeletePermission). A ClickHouse
   * delete does not say how many rows it removed, so the row is looked up
   * under the delete's own scope first (isReachedByWrite).
   */
  @CaptureSpan()
  public async deleteOneById(data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<number> {
    if (
      !(await this.isReachedByWrite({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Delete,
      }))
    ) {
      return 0;
    }

    await this.deleteBy({
      query: { _id: data.id.toString() } as Query<TBaseModel>,
      props: data.props,
    });

    return 1;
  }

  /*
   * Updates the one row `id` names, when the update reaches it, and answers
   * how many rows it reached: 1, or 0 for a row that is missing or not one
   * the caller may change (ModelPermission.checkUpdatePermissions), as
   * deleteOneById does.
   */
  @CaptureSpan()
  public async updateOneById(data: {
    id: ObjectID;
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
  }): Promise<number> {
    if (
      !(await this.isReachedByWrite({
        id: data.id,
        props: data.props,
        type: DatabaseRequestType.Update,
        data: data.data,
      }))
    ) {
      return 0;
    }

    await this.updateBy({
      query: { _id: data.id.toString() } as Query<TBaseModel>,
      data: data.data,
      props: data.props,
    });

    return 1;
  }

  /*
   * Whether an update or a delete by `props` reaches the row `id` names:
   * the row looked up under the scope the write itself runs with - the
   * caller's project, and the resources both the write's grants and the
   * read's reach. Refuses as the write would when the caller may not make
   * it on this table at all.
   */
  private async isReachedByWrite(data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType.Update | DatabaseRequestType.Delete;
    data?: TBaseModel | undefined;
  }): Promise<boolean> {
    const query: Query<TBaseModel> = {
      _id: data.id.toString(),
    } as Query<TBaseModel>;

    const scopedQuery: Query<TBaseModel> =
      data.type === DatabaseRequestType.Delete
        ? await ModelPermission.checkDeletePermission(
            this.modelType,
            query,
            data.props,
          )
        : await ModelPermission.checkUpdatePermissions(
            this.modelType,
            query,
            data.data || new this.modelType(),
            data.props,
          );

    return await this.existsBy({
      query: scopedQuery,
      props: { isRoot: true },
    });
  }

  /*
   * Why an update or a delete by id reached nothing (deleteOneById,
   * updateOneById), for a caller that asked for one row: a row the caller
   * may not read is answered as missing, with no word on whether it exists
   * (NotFoundException, 404); one they may read but not change or delete is
   * refused (NotAuthorizedException, 422) - as the database models answer
   * (DatabaseService.getUnwrittenByIdError).
   */
  public async getUnwrittenByIdError(data: {
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType.Update | DatabaseRequestType.Delete;
  }): Promise<Exception> {
    const name: string = this.model.singularName || "Record";

    let isReadable: boolean = false;

    try {
      isReadable = Boolean(
        await this.findOneById({
          id: data.id,
          select: { _id: true } as Select<TBaseModel>,
          props: data.props,
        }),
      );
    } catch (error) {
      /*
       * A read the caller may not make finds nothing for them either. Any
       * other failure is not an answer about the row, and is raised as it
       * is: a 404 would tell a client the row is gone.
       */
      if (
        !(error instanceof NotAuthorizedException) &&
        !(error instanceof NotFoundException)
      ) {
        throw error;
      }

      isReadable = false;
    }

    if (isReadable) {
      return new NotAuthorizedException(
        `You do not have permission to ${data.type} this ${name.toLowerCase()}.`,
      );
    }

    return new NotFoundException(`${name} not found.`);
  }

  private async _updateBy(updateBy: UpdateBy<TBaseModel>): Promise<void> {
    try {
      // Refused before any hook runs; see assertCredentialCanWrite.
      DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(
        updateBy.props,
      );

      const onUpdate: OnUpdate<TBaseModel> = updateBy.props.ignoreHooks
        ? { updateBy, carryForward: [] }
        : await this.onBeforeUpdate(updateBy);

      const beforeUpdateBy: UpdateBy<TBaseModel> = onUpdate.updateBy;

      beforeUpdateBy.query = await ModelPermission.checkUpdatePermissions(
        this.modelType,
        beforeUpdateBy.query,
        beforeUpdateBy.data,
        beforeUpdateBy.props,
      );

      const select: Select<TBaseModel> = {};

      const tenantColumnName: string | null =
        this.getModel().getTenantColumn()?.key || null;

      if (tenantColumnName) {
        (select as any)[tenantColumnName] = true;
      }

      const statement: Statement =
        this.statementGenerator.toUpdateStatement(beforeUpdateBy);

      await this.execute(statement);

      logger.debug(`${this.model.tableName} Update Statement executed`, {
        tableName: this.model.tableName,
      } as LogAttributes);
      logger.debug(statement, {
        tableName: this.model.tableName,
      } as LogAttributes);
    } catch (error) {
      await this.onUpdateError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  protected generateDefaultValues(data: TBaseModel): TBaseModel {
    const tableColumns: Array<AnalyticsTableColumn> = data.getTableColumns();

    for (const column of tableColumns) {
      if (column.forceGetDefaultValueOnCreate) {
        data.setColumnValue(column.key, column.forceGetDefaultValueOnCreate());
      }
    }

    return data;
  }

  public useDefaultDatabase(): void {
    this.database = ClickhouseAppInstance;
    this.databaseClient = this.database.getDataSource();
    this.ingestDatabase = ClickhouseIngestInstance;
    this.ingestDatabaseClient = this.ingestDatabase.getDataSource();
    this.migrationDatabase = ClickhouseMigrationInstance;
    this.migrationDatabaseClient = this.migrationDatabase.getDataSource();
  }

  @CaptureSpan()
  public async execute(
    statement: Statement | string,
    options?: ClickhouseExecuteOptions,
  ): Promise<ExecResult<Stream>> {
    const client: ClickhouseClient = options?.useMigrationConnection
      ? this.getMigrationClient()
      : this.getDatabaseClient();

    const query: string =
      statement instanceof Statement ? statement.query : statement;
    const queryParams: Record<string, unknown> | undefined =
      statement instanceof Statement ? statement.query_params : undefined;

    return (await client.exec({
      query: query,
      query_params: queryParams || (undefined as any), // undefined is not specified in the type for query_params, but its ok to pass undefined.
      ...(options?.clickhouseSettings
        ? { clickhouse_settings: options.clickhouseSettings }
        : {}),
      ...(options?.queryId ? { query_id: options.queryId } : {}),
    })) as ExecResult<Stream>;
  }

  /*
   * Runs a read and hands back its answer, whose json() only ever returns a
   * whole document (issue #4707, see ClickhouseReadResult). A read stopped at
   * its time limit throws a QueryTimeoutException — the API answers 504 with
   * "This query took longer than 45 seconds and was stopped before it
   * finished. Try a shorter time range or more specific filters." — instead
   * of a SyntaxError on an empty or cut-off body.
   */
  @CaptureSpan()
  public async executeQuery(
    statement: Statement | string,
    options?: ClickhouseExecuteOptions,
  ): Promise<ResultSet<"JSON">> {
    const client: ClickhouseClient = options?.useMigrationConnection
      ? this.getMigrationClient()
      : this.getDatabaseClient();

    const query: string =
      statement instanceof Statement ? statement.query : statement;
    const queryParams: Record<string, unknown> | undefined =
      statement instanceof Statement ? statement.query_params : undefined;

    const timeLimitInSeconds: number | undefined =
      ClickhouseReadResult.getTimeLimitInSeconds(
        query,
        options?.clickhouseSettings,
      );

    const clickhouseSettings: ClickHouseSettings | undefined =
      AnalyticsDatabaseService.getReadSettings({
        clickhouseSettings: options?.clickhouseSettings,
        hasTimeLimit: timeLimitInSeconds !== undefined,
        useMigrationConnection: Boolean(options?.useMigrationConnection),
      });

    let resultSet: ResultSet<"JSON">;

    try {
      resultSet = await client.query({
        query: query,
        format: "JSON",
        query_params: queryParams || (undefined as any), // undefined is not specified in the type for query_params, but its ok to pass undefined.
        ...(clickhouseSettings
          ? { clickhouse_settings: clickhouseSettings }
          : {}),
        ...(options?.queryId ? { query_id: options.queryId } : {}),
      });
    } catch (error) {
      throw ClickhouseReadResult.toReadError(error, {
        timeLimitInSeconds: timeLimitInSeconds,
      });
    }

    return ClickhouseReadResult.guard(resultSet, {
      timeLimitInSeconds: timeLimitInSeconds,
    });
  }

  /*
   * The per-call settings a read is sent with. A read with a time limit also
   * asks ClickHouse to hold its answer until the query is done
   * (http_wait_end_of_query): a read stopped part-way through then answers
   * with the error itself (408, TIMEOUT_EXCEEDED) instead of a 200 whose
   * rows end in a dropped connection, which the client can only report as
   * "aborted". It costs nothing a reader would notice — json() waits for the
   * whole body anyway — and ClickHouse keeps an answer over 1 MiB on disk
   * until it is sent. A read with no time limit streams as before, so a long
   * one keeps the client's 58 s idle timer fed, and a migration's statements
   * are left exactly as their caller sends them.
   */
  public static getReadSettings(data: {
    clickhouseSettings?: ClickHouseSettings | undefined;
    hasTimeLimit: boolean;
    useMigrationConnection: boolean;
  }): ClickHouseSettings | undefined {
    if (data.useMigrationConnection || !data.hasTimeLimit) {
      return data.clickhouseSettings;
    }

    return {
      http_wait_end_of_query: 1,
      ...(data.clickhouseSettings || {}),
    };
  }

  private getDatabaseClient(): ClickhouseClient {
    /*
     * Refresh the ClickHouse client lazily so services created before the
     * ClickHouse connection was established pick up the live client.
     */
    if (!this.database) {
      this.useDefaultDatabase();
    }

    if (!this.databaseClient && this.database) {
      this.databaseClient = this.database.getDataSource();
    }

    if (!this.databaseClient) {
      throw new Exception(
        ExceptionCode.DatabaseNotConnectedException,
        "ClickHouse client is not connected",
      );
    }

    return this.databaseClient;
  }

  private getIngestClient(): ClickhouseClient {
    if (!this.ingestDatabase) {
      this.useDefaultDatabase();
    }

    if (!this.ingestDatabaseClient && this.ingestDatabase) {
      this.ingestDatabaseClient = this.ingestDatabase.getDataSource();
    }

    if (!this.ingestDatabaseClient) {
      throw new Exception(
        ExceptionCode.DatabaseNotConnectedException,
        "ClickHouse ingest client is not connected",
      );
    }

    return this.ingestDatabaseClient;
  }

  private getMigrationClient(): ClickhouseClient {
    if (!this.migrationDatabase) {
      this.useDefaultDatabase();
    }

    if (!this.migrationDatabaseClient && this.migrationDatabase) {
      this.migrationDatabaseClient = this.migrationDatabase.getDataSource();
    }

    if (!this.migrationDatabaseClient) {
      throw new Exception(
        ExceptionCode.DatabaseNotConnectedException,
        "ClickHouse migration client is not connected",
      );
    }

    return this.migrationDatabaseClient;
  }

  protected async onUpdateSuccess(
    onUpdate: OnUpdate<TBaseModel>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve(onUpdate);
  }

  protected async onUpdateError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onDeleteSuccess(
    onDelete: OnDelete<TBaseModel>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve(onDelete);
  }

  protected async onDeleteError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onFindSuccess(
    onFind: OnFind<TBaseModel>,
    items: Array<TBaseModel>,
  ): Promise<OnFind<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({ ...onFind, carryForward: items });
  }

  protected async onFindError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onCountSuccess(
    count: PositiveNumber,
  ): Promise<PositiveNumber> {
    // A place holder method used for overriding.
    return Promise.resolve(count);
  }

  protected async onCountError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected async onCreateSuccess(
    _onCreate: OnCreate<TBaseModel>,
    createdItem: TBaseModel,
  ): Promise<TBaseModel> {
    // A place holder method used for overriding.
    return Promise.resolve(createdItem);
  }

  protected async onBeforeCreate(
    createBy: CreateBy<TBaseModel>,
  ): Promise<OnCreate<TBaseModel>> {
    // A place holder method used for overriding.
    return Promise.resolve({
      createBy: createBy as CreateBy<TBaseModel>,
      carryForward: undefined,
    });
  }

  private async _onBeforeCreate(
    createBy: CreateBy<TBaseModel>,
  ): Promise<OnCreate<TBaseModel>> {
    // Private method that runs before create.
    const projectIdColumn: string | null =
      this.model.getTenantColumn()?.key || null;

    if (projectIdColumn && createBy.props.tenantId) {
      (createBy.data as any)[projectIdColumn] = createBy.props.tenantId;
    }

    return await this.onBeforeCreate(createBy);
  }

  @CaptureSpan()
  public async createMany(
    createBy: CreateManyBy<TBaseModel>,
  ): Promise<Array<TBaseModel>> {
    // Refused before any hook runs; see assertCredentialCanWrite.
    DatabaseCommonInteractionPropsUtil.assertCredentialCanWrite(createBy.props);

    /*
     * The project's plan, read once when the props act in it without one and
     * a plan decides the create of any row of the batch (CallerPlan).
     */
    if (CallerPlan.isPlanMissing(createBy.props)) {
      if (
        createBy.items.some((item: TBaseModel): boolean => {
          return PlanGates.isAnalyticsPlanAtStake(
            this.model,
            DatabaseRequestType.Create,
            item,
          );
        })
      ) {
        createBy = {
          ...createBy,
          props: await CallerPlan.withPlan(createBy.props),
        };
      }
    }

    // add tenantId if present.
    const tenantColumnName: string | null =
      this.model.getTenantColumn()?.key || null;

    const items: Array<TBaseModel> = [];
    const carryForwards: Array<any> = [];

    for (const item of createBy.items) {
      let data: TBaseModel = item;

      const onCreate: OnCreate<TBaseModel> = createBy.props.ignoreHooks
        ? {
            createBy: {
              data: data,
              props: createBy.props,
            },
            carryForward: [],
          }
        : await this._onBeforeCreate({
            data: data,
            props: createBy.props,
          });

      data = onCreate.createBy.data;

      const carryForward: any = onCreate.carryForward;

      carryForwards.push(carryForward);

      if (tenantColumnName && createBy.props.tenantId) {
        data.setColumnValue(tenantColumnName, createBy.props.tenantId);
      }

      data = this.sanitizeCreate(data);
      data = this.generateDefaultValues(data);
      data = this.checkRequiredFields(data);

      if (!this.isValid(data)) {
        throw new BadDataException("Data is not valid");
      }

      // check total items by

      /*
       * What the hooks and the defaults wrote is held to the plan too: read
       * now if nothing the caller sent needed it (CallerPlan) - never refused
       * as a plan nobody could confirm.
       */
      if (
        CallerPlan.isPlanMissing(createBy.props) &&
        PlanGates.isAnalyticsPlanAtStake(
          this.model,
          DatabaseRequestType.Create,
          data,
        )
      ) {
        createBy = {
          ...createBy,
          props: await CallerPlan.withPlan(createBy.props),
        };
      }

      ModelPermission.checkCreatePermissions(
        this.modelType,
        data,
        createBy.props,
      );

      items.push(data);
    }

    try {
      const insertStatement: string = this.statementGenerator.toCreateStatement(
        { item: items },
      );

      await this.execute(insertStatement);

      logger.debug(`${this.model.tableName} Create Statement executed`, {
        tableName: this.model.tableName,
      } as LogAttributes);
      logger.debug(insertStatement, {
        tableName: this.model.tableName,
      } as LogAttributes);

      if (!createBy.props.ignoreHooks) {
        for (let i: number = 0; i < items.length; i++) {
          if (!items[i]) {
            continue;
          }

          items[i] = await this.onCreateSuccess(
            {
              createBy: {
                data: items[i]!,
                props: createBy.props,
              },
              carryForward: carryForwards[i],
            },
            items[i]!,
          );
        }
      }

      // hit workflow.;
      if (this.getModel().enableWorkflowOn?.create) {
        let tenantId: ObjectID | undefined = createBy.props.tenantId;

        for (const item of items) {
          if (!tenantId && this.getModel().getTenantColumn()) {
            tenantId = item.getColumnValue<ObjectID>(
              this.getModel().getTenantColumn()!.key,
            );
          }

          if (tenantId) {
            await this.onTrigger(item.id!, tenantId, "on-create");
          }
        }
      }

      // emit realtime events to the client.
      if (
        this.getModel().enableRealtimeEventsOn?.create &&
        this.model.getTenantColumn()
      ) {
        if (Realtime.isInitialized()) {
          const promises: Array<Promise<void>> = [];

          for (const item of items) {
            const tenantId: ObjectID | null = item.getTenantColumnValue();

            if (!tenantId) {
              continue;
            }

            /*
             * Who may hear about the row: see getRealtimeReadAccess, which
             * answers from the resource the row belongs to, sent with it.
             */
            promises.push(
              Realtime.emitModelEvent({
                modelId: item.id!,
                tenantId: tenantId,
                eventType: ModelEventType.Create,
                modelType: this.modelType,
                access: this.getRealtimeReadAccess(),
                ownerId: this.getRealtimeOwnerId(item),
              }),
            );
          }

          await Promise.allSettled(promises);
        } else {
          logger.warn(
            `Realtime is not initialized. Skipping emitModelEvent for ${
              this.getModel().tableName
            }`,
            { tableName: this.getModel().tableName } as LogAttributes,
          );
        }
      }

      return createBy.items;
    } catch (error) {
      await this.onCreateError(error as Exception);
      throw this.getException(error as Exception);
    }
  }

  @CaptureSpan()
  public async create(createBy: CreateBy<TBaseModel>): Promise<TBaseModel> {
    const items: Array<TBaseModel> = await this.createMany({
      props: createBy.props,
      items: [createBy.data],
    });

    const item: TBaseModel | undefined = items[0];

    if (!item) {
      throw new BadDataException("Item not created");
    }

    return item;
  }

  private sanitizeCreate<TBaseModel extends AnalyticsBaseModel>(
    data: TBaseModel,
  ): TBaseModel {
    if (!data.id) {
      data.id = ObjectID.generateTimeOrdered();
    }

    data.createdAt = OneUptimeDate.getCurrentDate();

    return data;
  }

  /*
   * Rethrow hook for the catch blocks below. MUST stay synchronous and
   * `never`-returning: the call sites use `throw this.getException(error)`,
   * so if this were `async` it would return a Promise that `throw` then
   * throws verbatim (never awaited) — the real exception is lost, callers up
   * the stack catch a bare Promise (surfacing as "[object Promise]"), and the
   * un-awaited rejection becomes an unhandled rejection. Throwing directly
   * propagates the original exception on the synchronous throw path.
   */
  protected getException(error: Exception): never {
    throw error;
  }

  protected async onCreateError(error: Exception): Promise<Exception> {
    // A place holder method used for overriding.
    return Promise.resolve(error);
  }

  protected isValid(data: TBaseModel): boolean {
    if (!data) {
      throw new BadDataException("Data cannot be null");
    }

    return true;
  }

  @CaptureSpan()
  public async onTrigger(
    id: ObjectID,
    projectId: ObjectID,
    triggerType: DatabaseTriggerType,
  ): Promise<void> {
    if (this.getModel().enableWorkflowOn) {
      /*
       * No route takes an analytics record's trigger yet, so nothing here
       * presents the cluster key: a route that takes it is one of the
       * cluster-key routes, and its caller presents the key to it alone.
       */
      API.post({
        url: new URL(
          Protocol.HTTP,
          WorkflowHostname,
          new Route(
            `/${WorkflowRoute.toString()}/analytics-model/${projectId.toString()}/${Text.pascalCaseToDashes(
              this.getModel().tableName!,
            )}/${triggerType}`,
          ),
        ),
        data: {
          _id: id.toString(),
        },
      }).catch((error: Error) => {
        logger.error(error, {
          projectId: projectId?.toString(),
          tableName: this.getModel().tableName,
        } as LogAttributes);
      });
    }
  }

  protected checkRequiredFields(data: TBaseModel): TBaseModel {
    // Check required fields.

    for (const columns of data.getRequiredColumns()) {
      const requiredField: string = columns.key;
      const value: unknown = (data as any)[requiredField];

      /*
       * A present value satisfies the requirement — including `false`, `0` and
       * `""`, which are all valid column values. Only a genuinely absent value
       * (null/undefined) triggers a default-fill or a validation error.
       *
       * This deliberately treats booleans like every other type. The previous
       * implementation special-cased booleans with `!val && val !== false`,
       * which can never be true for a real boolean, so it threw for EVERY
       * required boolean (both true and false) — making any required Boolean
       * column impossible to insert via createMany.
       */
      if (value !== null && value !== undefined) {
        continue;
      }

      if (data.isDefaultValueColumn(requiredField)) {
        // add default value.
        data.setColumnValue(
          requiredField,
          data.getDefaultValueForColumn(requiredField),
        );
      } else {
        throw new BadDataException(`${requiredField} is required`);
      }
    }

    return data;
  }

  public getModel(): TBaseModel {
    return this.model;
  }

  private realtimeReadAccess: RealtimeReadAccess | null = null;

  /*
   * The resource a row belongs to (@OwnedThrough), sent with its live
   * update for getRealtimeReadAccess to answer by. Undefined for a row that
   * names none, or a model with no owning resource.
   */
  public getRealtimeOwnerId(item: TBaseModel): string | undefined {
    const ownedThrough: OwnedThroughMetadata | undefined =
      this.getOwnedThrough();

    if (!ownedThrough) {
      return undefined;
    }

    const resourceId: unknown = item.getColumnValue(ownedThrough.fkColumn);

    return resourceId ? String(resourceId) : undefined;
  }

  /*
   * Who may hear about rows of this table (Realtime): whoever their read
   * lets read them. A telemetry row cannot be looked up by id cheaply, so
   * the read is asked the way a telemetry read applies it: the read check
   * itself (ModelPermission.checkReadPermission - the table, a block with
   * no labels, the plan), then the caller's read scope (getReadScope -
   * their label and Owned grants, less what a block with labels takes
   * away), against the resource each row belongs to (@OwnedThrough, sent
   * with the row's event: getRealtimeOwnerId). Both are worked out once
   * per reader and kept with them (RealtimeReader.remember), so the answer
   * needs no read of its own. One access per service, so the events of
   * every insert into the table merge into one delivery.
   *
   * A service that narrows its reads further on its own (onBeforeFind, or a
   * findBy of its own) is not modelled here, so nobody hears about its rows
   * rather than everybody.
   */
  public getRealtimeReadAccess(): RealtimeReadAccess {
    if (this.realtimeReadAccess) {
      return this.realtimeReadAccess;
    }

    const model: TBaseModel = this.getModel();
    const narrowsReadsOnItsOwn: boolean =
      !this.readsThroughThePermissionCheck();

    const getScope: (
      reader: RealtimeReader,
    ) => Promise<TelemetryReadScope | null> = (
      reader: RealtimeReader,
    ): Promise<TelemetryReadScope | null> => {
      return reader.remember(
        `analytics-read-scope:${model.tableName}`,
        (): Promise<TelemetryReadScope | null> => {
          return this.getRealtimeReadScope(reader.props);
        },
      );
    };

    this.realtimeReadAccess = {
      answersWithoutReading: true,
      readsEveryRecord: async (reader: RealtimeReader): Promise<boolean> => {
        if (narrowsReadsOnItsOwn) {
          return false;
        }

        const scope: TelemetryReadScope | null = await getScope(reader);

        return Boolean(scope && TelemetryReadScopeUtil.isProjectWide(scope));
      },
      getReadableIds: async (
        reader: RealtimeReader,
        modelIds: Array<ObjectID>,
        ownerIds?: ReadonlyMap<string, string> | undefined,
      ): Promise<Array<string>> => {
        if (narrowsReadsOnItsOwn) {
          return [];
        }

        const scope: TelemetryReadScope | null = await getScope(reader);

        if (!scope) {
          return [];
        }

        return modelIds
          .map((modelId: ObjectID): string => {
            return normalizeRealtimeId(modelId);
          })
          .filter((modelId: string): boolean => {
            /*
             * A row of a model with no owning resource is read with the
             * table, and one whose resource is empty (or not sent) matches
             * only a scope that reaches every resource - as the read's own
             * condition on the resource column does.
             */
            return TelemetryReadScopeUtil.isReadable(
              scope,
              ownerIds?.get(modelId) || "",
            );
          });
      },
    };

    return this.realtimeReadAccess;
  }

  private getOwnedThrough(): OwnedThroughMetadata | undefined {
    return (
      this.getModel() as unknown as { ownedThrough?: OwnedThroughMetadata }
    ).ownedThrough;
  }

  /*
   * The reader's telemetry read scope for this model, or null when their
   * read of it is refused.
   */
  private async getRealtimeReadScope(
    props: DatabaseCommonInteractionProps,
  ): Promise<TelemetryReadScope | null> {
    try {
      await ModelPermission.checkReadPermission(
        this.modelType,
        {} as Query<TBaseModel>,
        null,
        props,
      );

      return await ModelPermission.getReadScope(this.modelType, props);
    } catch (err) {
      logger.debug(err, {
        projectId: props.tenantId?.toString(),
      } as LogAttributes);
      return null;
    }
  }

  /*
   * Whether this service's reads are narrowed by the permission check
   * alone: it adds nothing in onBeforeFind and replaces no read.
   */
  private readsThroughThePermissionCheck(): boolean {
    const service: Record<string, unknown> = this as unknown as Record<
      string,
      unknown
    >;
    const base: Record<string, unknown> =
      AnalyticsDatabaseService.prototype as unknown as Record<string, unknown>;

    return [
      "findBy",
      "findOneBy",
      "findOneById",
      "onBeforeFind",
      "onFindSuccess",
    ].every((method: string): boolean => {
      return service[method] === base[method];
    });
  }
}
