import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import PaymentRequiredException from "Common/Types/Exception/PaymentRequiredException";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * Query console (OneUptime Enterprise Edition)
 *
 * Master-admin ad-hoc query execution against the three datastores backing
 * this instance (Postgres, ClickHouse, Redis). This is a power tool for operators who already hold the datastore credentials, so it
 * deliberately allows arbitrary statements — but defends the instance with:
 *   - read-only by default (an explicit opt-in is required to run writes / DDL),
 *   - hard row caps + per-cell size caps on the data returned,
 *   - server-side statement / execution timeouts, and
 *   - an always-blocked denylist for catastrophic Redis admin commands.
 * Unlike the support bundle, results are returned VERBATIM (not
 * credential-scrubbed): the operator is intentionally inspecting their own data,
 * and scrubbing would defeat the purpose of a query console.
 *
 * Served by the enterprise module's admin-health router (see ./Index.ts),
 * next to the live Health dashboards (./HealthDashboards.ts), mounted at
 * /api/admin/health ahead of core's router, which answers these three paths
 * with 402 when this module is not loaded.
 * ---------------------------------------------------------------------------
 */

export const QUERY_CONSOLE_NOT_ON_CLOUD_MESSAGE: string =
  "The OneUptime Health query console is not available on OneUptime Cloud. " +
  "It runs statements directly against the datastores behind the instance, so it is offered on self-hosted OneUptime Enterprise Edition only.";

// Hard ceiling on rows returned to the console, regardless of the requested limit.
export const QUERY_MAX_ROWS: number = 1000;
export const QUERY_DEFAULT_ROWS: number = 100;
// Per-cell string cap so a single huge value can't bloat the response.
export const QUERY_MAX_CELL_LENGTH: number = 10000;
// Wall-clock caps for the executed statement.
const QUERY_PG_TIMEOUT_MS: number = 30000;
const QUERY_CH_TIMEOUT_SECONDS: number = 30;
const QUERY_REDIS_TIMEOUT_MS: number = 15000;
export const QUERY_REDIS_MAX_COMMANDS: number = 50;

export type QueryEngine = "postgres" | "clickhouse" | "redis";

export const QUERY_CONSOLE_ENGINES: ReadonlyArray<QueryEngine> = [
  "postgres",
  "clickhouse",
  "redis",
];

/*
 * The console runs arbitrary statements against the datastores behind the
 * instance. On OneUptime Cloud (billing on) those are shared production
 * datastores, so the console is refused there whatever the license says.
 * Everywhere else it needs the Enterprise Edition with a license that covers
 * instance health. Throws PaymentRequiredException (402) otherwise.
 */
export async function assertQueryConsoleAvailable(): Promise<void> {
  if (IsBillingEnabled) {
    throw new PaymentRequiredException(QUERY_CONSOLE_NOT_ON_CLOUD_MESSAGE);
  }

  await EnterpriseEdition.assertFeatureAvailable(
    EnterpriseFeature.InstanceHealth,
  );
}

// Clamp a requested row limit into [1, QUERY_MAX_ROWS]; default QUERY_DEFAULT_ROWS.
export function resolveRowLimit(value: unknown): number {
  const parsed: number = Number(value);

  if (!isFinite(parsed) || parsed <= 0) {
    return QUERY_DEFAULT_ROWS;
  }

  return Math.min(Math.floor(parsed), QUERY_MAX_ROWS);
}

// A short, safe-to-show error message for a failed query (capped, never thrown).
function getQueryErrorMessage(err: unknown): string {
  let message: string = "Query failed.";

  if (err instanceof Error && err.message) {
    message = err.message;
  } else if (typeof err === "string" && err) {
    message = err;
  }

  return message.length > 4000 ? `${message.substring(0, 4000)}…` : message;
}

// Convert one DB cell into a JSON-safe, size-capped value for the response.
export function toQueryCell(value: unknown): JSONValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    const hex: string = value.toString("hex");
    return hex.length > QUERY_MAX_CELL_LENGTH
      ? `0x${hex.substring(0, QUERY_MAX_CELL_LENGTH)}… (truncated)`
      : `0x${hex}`;
  }

  if (typeof value === "string") {
    return value.length > QUERY_MAX_CELL_LENGTH
      ? `${value.substring(0, QUERY_MAX_CELL_LENGTH)}… (truncated)`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  // Objects / arrays (jsonb, Postgres arrays, nested ClickHouse types) — serialize once, capped.
  try {
    const serialized: string = JSON.stringify(value);

    if (serialized.length > QUERY_MAX_CELL_LENGTH) {
      return `${serialized.substring(0, QUERY_MAX_CELL_LENGTH)}… (truncated)`;
    }

    return JSON.parse(serialized) as JSONValue;
  } catch {
    return String(value);
  }
}

// Collect column names across a set of row objects, preserving first-seen order.
function deriveColumns(rows: Array<Record<string, unknown>>): Array<string> {
  const columns: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
  }

  return columns;
}

// Project an array of row objects onto an ordered column list, with JSON-safe cells.
function rowsToCells(
  rows: Array<Record<string, unknown>>,
  columns: Array<string>,
): JSONArray {
  return rows.map((row: Record<string, unknown>): JSONObject => {
    const out: JSONObject = {};

    for (const column of columns) {
      out[column] = toQueryCell(row ? row[column] : null);
    }

    return out;
  });
}

// Race a promise against a timeout so a hung datastore call can't pin the request.
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        reject(new Error(label));
      }, ms);

      promise
        .then((value: T): void => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err: Error): void => {
          clearTimeout(timer);
          reject(err);
        });
    },
  );
}

/*
 * Strip leading line (--) and block comments + whitespace so statement
 * classification sees the real first keyword.
 */
function stripLeadingSqlComments(sql: string): string {
  let trimmed: string = sql.trim();
  let previousLength: number = -1;

  while (trimmed.length !== previousLength) {
    previousLength = trimmed.length;
    trimmed = trimmed
      .replace(/^--[^\n]*\n?/, "")
      .replace(/^\/\*[\s\S]*?\*\//, "")
      .trim();
  }

  return trimmed;
}

export function firstSqlKeyword(sql: string): string {
  return (
    stripLeadingSqlComments(sql)
      .replace(/^\(+/, "")
      .split(/[\s(;]/)[0]
      ?.toUpperCase() || ""
  );
}

const POSTGRES_READ_KEYWORDS: Set<string> = new Set([
  "SELECT",
  "WITH",
  "TABLE",
  "VALUES",
  "SHOW",
  "EXPLAIN",
]);

// Statements whose row stream we can safely page through a server-side cursor.
const POSTGRES_CURSORABLE_KEYWORDS: Set<string> = new Set([
  "SELECT",
  "WITH",
  "TABLE",
  "VALUES",
]);

/*
 * Host-level escape hatches a query console must never expose, even in write
 * mode: COPY ... TO/FROM PROGRAM (arbitrary command execution on the DB host),
 * COPY to/from a server file, large-object / server-file IO, and dblink. This is
 * a best-effort textual blocklist — the real defence is connecting the console
 * with a least-privilege Postgres role — but it stops the obvious one-liners.
 */
const POSTGRES_BLOCKED_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcopy\b[\s\S]*?\bprogram\b/i, label: "COPY ... PROGRAM" },
  {
    pattern: /\bcopy\b[\s\S]*?\b(?:to|from)\b\s*'/i,
    label: "COPY to/from a server file",
  },
  { pattern: /\blo_export\s*\(/i, label: "lo_export" },
  { pattern: /\blo_import\s*\(/i, label: "lo_import" },
  { pattern: /\bpg_read_file\s*\(/i, label: "pg_read_file" },
  { pattern: /\bpg_read_binary_file\s*\(/i, label: "pg_read_binary_file" },
  { pattern: /\bpg_ls_dir\s*\(/i, label: "pg_ls_dir" },
  { pattern: /\bpg_stat_file\s*\(/i, label: "pg_stat_file" },
  { pattern: /\bdblink\w*\s*\(/i, label: "dblink" },
];

export function assertPostgresStatementAllowed(sql: string): void {
  for (const blocked of POSTGRES_BLOCKED_PATTERNS) {
    if (blocked.pattern.test(sql)) {
      throw new BadDataException(
        `${blocked.label} is blocked in the query console because it can act on the database host. Use psql directly if you genuinely need it.`,
      );
    }
  }
}

/*
 * Run an arbitrary SQL statement against Postgres. Read-only mode wraps it in a
 * `READ ONLY` transaction (rolled back afterwards) so it cannot mutate the
 * database; write mode commits. For plain read queries in read-only mode we page
 * the result through a server-side cursor (`DECLARE ... FETCH FORWARD n`) so a
 * huge SELECT can never buffer an unbounded result set into the app process. A
 * `SET LOCAL statement_timeout` bounds the wall-clock. Note: read-only prevents
 * DATABASE mutation but is not a full sandbox against a privileged connecting
 * role — assertPostgresStatementAllowed() blocks the obvious host-level escapes.
 * Column metadata is derived from the returned rows; duplicate column names
 * collapse to the last value.
 */
async function runPostgresQuery(
  sql: string,
  readOnly: boolean,
  rowLimit: number,
): Promise<JSONObject> {
  assertPostgresStatementAllowed(sql);

  const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
    PostgresAppInstance.getDataSource();

  if (!dataSource) {
    throw new BadDataException("Postgres is not connected on this instance.");
  }

  const firstKeyword: string = firstSqlKeyword(sql);
  const isRead: boolean = POSTGRES_READ_KEYWORDS.has(firstKeyword);
  /*
   * Cursor paging is only safe for pure read queries (a data-modifying CTE
   * cannot back a cursor), so we restrict it to read-only mode.
   */
  const useCursor: boolean =
    readOnly && POSTGRES_CURSORABLE_KEYWORDS.has(firstKeyword);

  const startedAt: number = Date.now();
  const queryRunner: ReturnType<typeof dataSource.createQueryRunner> =
    dataSource.createQueryRunner();

  try {
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // READ ONLY must precede any data-accessing statement in the transaction.
      if (readOnly) {
        await queryRunner.query("SET TRANSACTION READ ONLY");
      }

      await queryRunner.query(
        `SET LOCAL statement_timeout = ${QUERY_PG_TIMEOUT_MS}`,
      );

      let records: Array<Record<string, unknown>> = [];
      let affected: number | null = null;

      if (useCursor) {
        // Strip a trailing ';' so it sits cleanly inside the DECLARE.
        const inner: string = sql.trim().replace(/;\s*$/, "");
        await queryRunner.query(
          `DECLARE oneuptime_console_cursor NO SCROLL CURSOR FOR ${inner}`,
        );
        const fetched: { records?: Array<Record<string, unknown>> } =
          await queryRunner.query(
            `FETCH FORWARD ${rowLimit + 1} FROM oneuptime_console_cursor`,
            undefined,
            true,
          );
        records = Array.isArray(fetched?.records) ? fetched.records : [];
        await queryRunner.query("CLOSE oneuptime_console_cursor");
      } else {
        const result: {
          records?: Array<Record<string, unknown>>;
          affected?: number;
        } = await queryRunner.query(sql, undefined, true);
        records = Array.isArray(result?.records) ? result.records : [];
        affected =
          typeof result?.affected === "number" ? result.affected : null;
      }

      // Read-only changes nothing, so roll back; writes commit.
      if (readOnly) {
        await queryRunner.rollbackTransaction();
      } else {
        await queryRunner.commitTransaction();
      }

      const limited: Array<Record<string, unknown>> = records.slice(
        0,
        rowLimit,
      );
      const columns: Array<string> = deriveColumns(limited);
      const rows: JSONArray = rowsToCells(limited, columns);
      const truncated: boolean = records.length > rowLimit;

      let message: string | null = null;
      if (!isRead && rows.length === 0) {
        message =
          affected !== null
            ? `Statement executed. ${affected} row(s) affected.`
            : "Statement(s) executed successfully.";
      }

      return {
        engine: "postgres",
        columns,
        rows,
        rowsReturned: rows.length,
        /*
         * With cursor paging we only fetched up to rowLimit+1, so rely on
         * `truncated` rather than reporting a real (unknown) total.
         */
        totalRows: useCursor ? rows.length : records.length,
        affectedRows: isRead ? null : affected,
        truncated,
        readOnly,
        executionTimeMs: Date.now() - startedAt,
        message,
      };
    } catch (innerErr) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw innerErr;
    }
  } finally {
    await queryRunner.release();
  }
}

/*
 * The leading keywords that identify a ClickHouse read statement. Anything else
 * is treated as a write / DDL and is only allowed when read-only mode is off.
 */
const CLICKHOUSE_READ_KEYWORDS: Set<string> = new Set([
  "SELECT",
  "WITH",
  "SHOW",
  "DESC",
  "DESCRIBE",
  "EXPLAIN",
  "EXISTS",
]);

export function clickhouseStatementIsRead(sql: string): boolean {
  return CLICKHOUSE_READ_KEYWORDS.has(firstSqlKeyword(sql));
}

/*
 * Run an arbitrary statement against ClickHouse. Reads go through query() in
 * JSON format (which gives us typed column metadata); writes / DDL go through
 * command(). Read-only mode additionally pins `readonly = 2` (read queries only,
 * but still allows the row/time-limit settings below to be applied) and rejects
 * anything that isn't a recognised read statement. max_execution_time and
 * max_result_rows bound the work and the result set server-side.
 */
async function runClickhouseQuery(
  sql: string,
  readOnly: boolean,
  rowLimit: number,
): Promise<JSONObject> {
  const client: ReturnType<typeof ClickhouseAppInstance.getDataSource> =
    ClickhouseAppInstance.getDataSource();

  if (!client) {
    throw new BadDataException("ClickHouse is not connected on this instance.");
  }

  const startedAt: number = Date.now();
  const isRead: boolean = clickhouseStatementIsRead(sql);

  if (readOnly && !isRead) {
    throw new BadDataException(
      "This looks like a write or DDL statement. Turn off read-only mode to run it.",
    );
  }

  if (isRead) {
    const resultSet: Awaited<ReturnType<typeof client.query>> =
      await client.query({
        query: sql,
        format: "JSON",
        clickhouse_settings: {
          max_execution_time: QUERY_CH_TIMEOUT_SECONDS,
          max_result_rows: String(rowLimit + 1),
          result_overflow_mode: "break",
          ...(readOnly ? { readonly: "2" } : {}),
        },
      });

    const json: {
      meta?: Array<{ name: string; type: string }>;
      data?: Array<Record<string, unknown>>;
    } = (await resultSet.json()) as {
      meta?: Array<{ name: string; type: string }>;
      data?: Array<Record<string, unknown>>;
    };

    const meta: Array<{ name: string; type: string }> = json.meta || [];
    const allRows: Array<Record<string, unknown>> = json.data || [];
    const limited: Array<Record<string, unknown>> = allRows.slice(0, rowLimit);
    const columns: Array<string> = meta.length
      ? meta.map((column: { name: string }): string => {
          return String(column.name);
        })
      : deriveColumns(limited);
    const rows: JSONArray = rowsToCells(limited, columns);

    return {
      engine: "clickhouse",
      columns,
      columnTypes: meta.map(
        (column: { name: string; type: string }): JSONObject => {
          return { name: String(column.name), type: String(column.type) };
        },
      ),
      rows,
      rowsReturned: rows.length,
      totalRows: allRows.length,
      truncated: allRows.length > rowLimit,
      readOnly,
      executionTimeMs: Date.now() - startedAt,
      message: null,
    };
  }

  await client.command({
    query: sql,
    clickhouse_settings: { max_execution_time: QUERY_CH_TIMEOUT_SECONDS },
  });

  return {
    engine: "clickhouse",
    columns: [],
    columnTypes: [],
    rows: [],
    rowsReturned: 0,
    totalRows: 0,
    truncated: false,
    readOnly,
    executionTimeMs: Date.now() - startedAt,
    message: "Statement executed successfully.",
  };
}

/*
 * Redis commands that are ALWAYS refused from the console, in either mode —
 * server-destroying, server-config, replication-altering or connection-blocking
 * commands that have no place in an ad-hoc query tool. `redis-cli` remains the
 * escape hatch for these.
 */
export const REDIS_ALWAYS_BLOCKED: Set<string> = new Set([
  "SHUTDOWN",
  "DEBUG",
  "MONITOR",
  "SYNC",
  "PSYNC",
  "SUBSCRIBE",
  "PSUBSCRIBE",
  "SSUBSCRIBE",
  "FLUSHALL",
  "FLUSHDB",
  "SWAPDB",
  "REPLICAOF",
  "SLAVEOF",
  "FAILOVER",
  "SAVE",
  "BGSAVE",
  "BGREWRITEAOF",
  "CLUSTER",
  "MIGRATE",
  "RESET",
  "CONFIG",
  "ACL",
  /*
   * Connection-scoped / DB-switching commands: even on a dedicated console
   * connection these have no place in an ad-hoc query tool, and SELECT/CLIENT
   * would change the connection's selected DB or reply state.
   */
  "SELECT",
  "CLIENT",
  // Server-side scripting — arbitrary code execution against Redis.
  "EVAL",
  "EVALSHA",
  "EVAL_RO",
  "EVALSHA_RO",
  "FCALL",
  "FCALL_RO",
  "SCRIPT",
  "FUNCTION",
  "BLPOP",
  "BRPOP",
  "BLMOVE",
  "BRPOPLPUSH",
  "BLMPOP",
  "BZPOPMIN",
  "BZPOPMAX",
  "BZMPOP",
  "WAIT",
]);

/*
 * Redis read-only commands the console permits when read-only mode is on. A
 * curated allow-list (rather than a write denylist) so a command we have not
 * vetted defaults to "blocked in read-only mode".
 */
export const REDIS_READONLY_ALLOWED: Set<string> = new Set([
  "GET",
  "MGET",
  "STRLEN",
  "GETRANGE",
  "SUBSTR",
  "EXISTS",
  "TYPE",
  "TTL",
  "PTTL",
  "EXPIRETIME",
  "PEXPIRETIME",
  "OBJECT",
  "DUMP",
  "RANDOMKEY",
  "KEYS",
  "SCAN",
  "DBSIZE",
  "HGET",
  "HMGET",
  "HGETALL",
  "HKEYS",
  "HVALS",
  "HLEN",
  "HEXISTS",
  "HSTRLEN",
  "HSCAN",
  "HRANDFIELD",
  "LRANGE",
  "LINDEX",
  "LLEN",
  "LPOS",
  "SMEMBERS",
  "SISMEMBER",
  "SMISMEMBER",
  "SCARD",
  "SSCAN",
  "SRANDMEMBER",
  "SINTER",
  "SUNION",
  "SDIFF",
  "ZRANGE",
  "ZRANGEBYSCORE",
  "ZRANGEBYLEX",
  "ZREVRANGE",
  "ZREVRANGEBYSCORE",
  "ZREVRANGEBYLEX",
  "ZSCORE",
  "ZMSCORE",
  "ZCARD",
  "ZCOUNT",
  "ZRANK",
  "ZREVRANK",
  "ZSCAN",
  "ZRANDMEMBER",
  "ZLEXCOUNT",
  "XRANGE",
  "XREVRANGE",
  "XLEN",
  "XINFO",
  "XPENDING",
  "GETBIT",
  "BITCOUNT",
  "BITPOS",
  "GEOPOS",
  "GEODIST",
  "GEOSEARCH",
  "GEOHASH",
  "PFCOUNT",
  "MEMORY",
  "INFO",
  "PING",
  "ECHO",
  "TIME",
  "LASTSAVE",
  "COMMAND",
  "LOLWUT",
]);

// Tokenise one Redis command line into command + args, respecting quotes.
export function parseRedisCommandLine(line: string): Array<string> {
  const tokens: Array<string> = [];
  const tokenPattern: RegExp = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  let match: RegExpExecArray | null = null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1].replace(/\\(.)/g, "$1"));
    } else if (match[2] !== undefined) {
      tokens.push(match[2].replace(/\\(.)/g, "$1"));
    } else if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }

  return tokens;
}

// MEMORY is allow-listed for its read subcommands; these are the safe ones.
const REDIS_MEMORY_READONLY_SUBCOMMANDS: Set<string> = new Set([
  "USAGE",
  "STATS",
  "DOCTOR",
  "MALLOC-STATS",
]);

/*
 * Run one or more Redis commands (one per non-comment line, redis-cli style).
 * Each command is checked against the always-blocked denylist and, in read-only
 * mode, the read-only allow-list. A failure on one line is reported inline
 * without aborting the rest of the batch.
 *
 * Commands run on a DEDICATED, disposable connection (a duplicate of the app's
 * client) — never the shared singleton — so a stateful command can't corrupt the
 * cache/session/queue traffic on the app connection, and a slow command that
 * times out can't head-of-line-block it. After a timeout we recycle the
 * connection (the abandoned command may still be running on it) so the remaining
 * lines in the batch run on a fresh connection.
 */
async function runRedisCommands(
  input: string,
  readOnly: boolean,
): Promise<JSONObject> {
  const baseClient: ReturnType<typeof Redis.getClient> = Redis.getClient();

  if (!baseClient || !Redis.isConnected()) {
    throw new BadDataException("Valkey is not connected on this instance.");
  }

  const lines: Array<string> = input
    .split(/\r?\n/)
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0 && !line.startsWith("#");
    });

  if (lines.length === 0) {
    throw new BadDataException("No Valkey command provided.");
  }

  if (lines.length > QUERY_REDIS_MAX_COMMANDS) {
    throw new BadDataException(
      `Too many commands — a maximum of ${QUERY_REDIS_MAX_COMMANDS} commands can be run at once.`,
    );
  }

  const startedAt: number = Date.now();
  const results: JSONArray = [];
  const timeoutMessage: string = `Valkey command timed out after ${QUERY_REDIS_TIMEOUT_MS}ms`;

  let consoleClient: NonNullable<ReturnType<typeof Redis.getClient>> =
    baseClient.duplicate();

  try {
    for (const line of lines) {
      const tokens: Array<string> = parseRedisCommandLine(line);

      if (tokens.length === 0) {
        continue;
      }

      const command: string = tokens[0]!.toUpperCase();
      const args: Array<string> = tokens.slice(1);

      if (REDIS_ALWAYS_BLOCKED.has(command)) {
        results.push({
          command: line,
          ok: false,
          error: `The ${command} command is not allowed from the query console. Use redis-cli for this operation.`,
        });
        continue;
      }

      if (readOnly && !REDIS_READONLY_ALLOWED.has(command)) {
        results.push({
          command: line,
          ok: false,
          error: `${command} is not a permitted read-only command. Turn off read-only mode to run write commands.`,
        });
        continue;
      }

      // MEMORY PURGE (and any non-read MEMORY subcommand) mutates server state.
      if (
        readOnly &&
        command === "MEMORY" &&
        !REDIS_MEMORY_READONLY_SUBCOMMANDS.has((args[0] || "").toUpperCase())
      ) {
        results.push({
          command: line,
          ok: false,
          error: `MEMORY ${(args[0] || "").toUpperCase()} is not a permitted read-only subcommand. Turn off read-only mode to run it.`,
        });
        continue;
      }

      try {
        const reply: unknown = await withTimeout(
          consoleClient.call(command, ...args),
          QUERY_REDIS_TIMEOUT_MS,
          timeoutMessage,
        );

        results.push({ command: line, ok: true, reply: toQueryCell(reply) });
      } catch (err) {
        results.push({
          command: line,
          ok: false,
          error: getQueryErrorMessage(err),
        });

        /*
         * The timed-out command may still be executing on this connection — drop
         * it and start fresh so the rest of the batch isn't blocked behind it.
         */
        if (err instanceof Error && err.message === timeoutMessage) {
          consoleClient.disconnect();
          consoleClient = baseClient.duplicate();
        }
      }
    }
  } finally {
    consoleClient.disconnect();
  }

  return {
    engine: "redis",
    results,
    commandsRun: results.length,
    readOnly,
    executionTimeMs: Date.now() - startedAt,
  };
}

// Shared handler: validate, dispatch to the engine runner, and shape the response.
async function handleQueryRequest(
  engine: QueryEngine,
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> {
  try {
    await assertQueryConsoleAvailable();

    const body: JSONObject = (req.body || {}) as JSONObject;
    const query: string = (body["query"] ?? "").toString();

    if (!query.trim()) {
      throw new BadDataException("A query is required.");
    }

    const readOnly: boolean = body["readOnly"] !== false;
    const rowLimit: number = resolveRowLimit(body["maxRows"]);

    const startedAt: number = Date.now();

    try {
      let data: JSONObject;

      if (engine === "postgres") {
        data = await runPostgresQuery(query, readOnly, rowLimit);
      } else if (engine === "clickhouse") {
        data = await runClickhouseQuery(query, readOnly, rowLimit);
      } else {
        data = await runRedisCommands(query, readOnly);
      }

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        ...data,
      });
    } catch (queryErr) {
      // Surface the datastore error inline (200) so the console can render it.
      return Response.sendJsonObjectResponse(req, res, {
        success: false,
        engine,
        readOnly,
        error: getQueryErrorMessage(queryErr),
        executionTimeMs: Date.now() - startedAt,
      });
    }
  } catch (err) {
    return next(err);
  }
}

/*
 * The three console routes. Routes only - no router.use() layer - because the
 * router they are registered on is mounted at /api/admin/health AHEAD of
 * core's AdminHealth router: a path-less middleware there would run for every
 * core health request too.
 *
 * They stay on the JWT-only master-admin middleware (never the static master
 * API key), so a leaked key cannot run queries headlessly.
 */
export function registerQueryConsoleRoutes(router: ExpressRouter): void {
  for (const engine of QUERY_CONSOLE_ENGINES) {
    router.post(
      `/query/${engine}`,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        return handleQueryRequest(engine, req, res, next);
      },
    );
  }
}

// A router serving the console alone.
export function createQueryConsoleRouter(): ExpressRouter {
  const router: ExpressRouter = Express.getRouter();
  registerQueryConsoleRoutes(router);
  return router;
}
