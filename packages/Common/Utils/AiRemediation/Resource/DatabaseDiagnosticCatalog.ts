/*
 * The db catalog: the CLOSED set of diagnostic operations OneUptime AI may
 * run against a database server through the Database AI agent, the grammar
 * that reads a `db` argv into exactly one of them, and which engine supports
 * what.
 *
 * `db` is not a real CLI and never runs text the model wrote. A command is
 *
 *   db <operation> [argument] [--flag value | --flag=value]...
 *
 * and the agent's DatabaseExecutor maps the parsed operation to a query it
 * owns (the `implementation` notes below), through the engine's Node driver
 * (pg, mysql2, ioredis, mongodb), in a read-only session with a statement
 * timeout. Free SQL, Redis commands, Mongo shell code and scripts are
 * unavailable on purpose: a SQL policy is not tractable (a SELECT can call
 * a function that writes, take locks or read a secret), a catalog is.
 *
 * The grammar is deliberately strict, the way KubectlPolicy reads pflag —
 * so a flag or value the policy refuses can never hide inside one it
 * allows:
 *   - the operation is argv[1], spelled exactly (lowercase, dashes);
 *   - flags are LONG only (`--limit 20` or `--limit=20`); a single-dash
 *     word is refused, so there are no short-flag clusters to unpack;
 *   - every flag takes a value; `--flag value` never takes a value that
 *     starts with "-" (it would be another flag the check would skip), and
 *     `--flag=` with nothing after it is refused;
 *   - a flag the operation does not take, an unknown flag, a flag given
 *     twice, a value outside its type or bounds, a missing or extra
 *     argument: all refused;
 *   - "--" ends the flags (what follows is the argument), as in any CLI;
 *   - values are typed: whole numbers with bounds and no leading zeros,
 *     identifiers [A-Za-z0-9_.$-] (not starting with "-"), fixed choices,
 *     setting names, numeric session ids.
 * The parse yields a canonical argv (operation, argument, then flags in
 * catalog order as `--flag value`), which re-parses to itself; the policy
 * returns it as the command's args, so what the agent receives, what a
 * human approves and what the executor runs are one thing.
 *
 * Tiers: every operation is Read except cancel-query (SafeWrite: it
 * cancels one session's running statement and the session stays
 * connected) and terminate-session (RiskyWrite: it disconnects one session
 * and rolls back its open transaction). A write's target is
 * `session:<id>`. Nothing else changes the database.
 *
 * Engines: PostgreSQL, MySQL (MariaDB and Percona too), Redis (Valkey,
 * KeyDB and Dragonfly too) and MongoDB. The policy tiers an operation
 * without knowing the engine; the executor refuses one its engine does not
 * support (getDatabaseEngineRefusal), and the guides can be written for one
 * engine (getDatabaseReadCommandGuide(engine)).
 *
 * Part of the import-closed resource policy directory the resource AI agent
 * carries a byte-identical copy of (see ResourceCommandPolicyCore): pure,
 * total (nothing here throws), relative imports of that set only.
 */

import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";

// The program every database command starts with.
export const DATABASE_PROGRAM: string = "db";

// The engine families the Database AI agent can talk to.
export enum DatabaseEngine {
  PostgreSQL = "postgresql",
  MySQL = "mysql",
  Redis = "redis",
  MongoDB = "mongodb",
}

export const ALL_DATABASE_ENGINES: ReadonlyArray<DatabaseEngine> = [
  DatabaseEngine.PostgreSQL,
  DatabaseEngine.MySQL,
  DatabaseEngine.Redis,
  DatabaseEngine.MongoDB,
];

export const DATABASE_ENGINE_DISPLAY_NAMES: Readonly<
  Record<DatabaseEngine, string>
> = {
  [DatabaseEngine.PostgreSQL]: "PostgreSQL",
  [DatabaseEngine.MySQL]: "MySQL/MariaDB",
  [DatabaseEngine.Redis]: "Redis",
  [DatabaseEngine.MongoDB]: "MongoDB",
};

/*
 * DATABASE_SYSTEM spellings (the Database Agent's normalize_engine, and the
 * semconv `db.system.name` values) read as each family. A fork or drop-in
 * speaks its family's protocol and diagnostic views.
 */
const DATABASE_ENGINE_ALIASES: Readonly<Record<string, DatabaseEngine>> = {
  postgresql: DatabaseEngine.PostgreSQL,
  postgres: DatabaseEngine.PostgreSQL,
  pg: DatabaseEngine.PostgreSQL,
  pgsql: DatabaseEngine.PostgreSQL,
  mysql: DatabaseEngine.MySQL,
  mariadb: DatabaseEngine.MySQL,
  percona: DatabaseEngine.MySQL,
  redis: DatabaseEngine.Redis,
  valkey: DatabaseEngine.Redis,
  keydb: DatabaseEngine.Redis,
  dragonfly: DatabaseEngine.Redis,
  dragonflydb: DatabaseEngine.Redis,
  mongodb: DatabaseEngine.MongoDB,
  mongo: DatabaseEngine.MongoDB,
};

/*
 * The engine family a DATABASE_SYSTEM value (or posture detail) names, or
 * null for anything else — SQL Server, Oracle, Elasticsearch and memcached
 * included: the catalog has no operations for them.
 */
export function parseDatabaseEngine(value: unknown): DatabaseEngine | null {
  if (typeof value !== "string") {
    return null;
  }

  const folded: string = value.trim().toLowerCase();

  if (
    !folded ||
    !Object.prototype.hasOwnProperty.call(DATABASE_ENGINE_ALIASES, folded)
  ) {
    return null;
  }

  return DATABASE_ENGINE_ALIASES[folded] || null;
}

// How a parameter's value is read.
export enum DatabaseParamKind {
  // A whole number within [minimum, maximum], written without leading zeros.
  Integer = "Integer",
  // A user, database or schema name: [A-Za-z0-9_.$-]{1,128}, not starting with "-".
  Identifier = "Identifier",
  // One of a fixed set of words, compared exactly.
  Choice = "Choice",
  // A server setting's name: [A-Za-z0-9_.-]{1,64}, not starting with "-" or ".", never a credential setting.
  SettingName = "SettingName",
  // A session, connection, client or operation id: a positive whole number.
  SessionId = "SessionId",
}

export interface DatabaseParamSpec {
  // The flag's name without dashes, or the argument's placeholder ("name", "section", "id").
  name: string;
  kind: DatabaseParamKind;
  // How the guide writes the value ("N", "NAME", "SECTION", "ID").
  valueLabel: string;
  description: string;
  // Integer only.
  minimum?: number | undefined;
  maximum?: number | undefined;
  // What the executor uses when the flag is not given (Integer only).
  defaultValue?: number | undefined;
  // Choice only: every value accepted on some engine.
  choices?: ReadonlyArray<string> | undefined;
  // Choice only: the values each engine accepts, when they differ by engine.
  choicesByEngine?:
    | Readonly<Partial<Record<DatabaseEngine, ReadonlyArray<string>>>>
    | undefined;
  // The engines it applies to; absent means every engine the operation supports.
  engines?: ReadonlyArray<DatabaseEngine> | undefined;
}

export interface DatabaseArgumentSpec extends DatabaseParamSpec {
  required: boolean;
}

export interface DatabaseOperationSpec {
  // Canonical name: lowercase words joined by dashes.
  name: string;
  // Other spellings that name the same operation.
  aliases: ReadonlyArray<string>;
  tier: ResourceCommandTier;
  // One line: what it shows or does (for the guides and the policy's reason).
  summary: string;
  engines: ReadonlyArray<DatabaseEngine>;
  // What the agent runs on each engine it supports (for the executor and the guides).
  implementation: Readonly<Partial<Record<DatabaseEngine, string>>>;
  // The one positional argument it takes, if any.
  argument: DatabaseArgumentSpec | null;
  // The flags it takes, in canonical order.
  flags: ReadonlyArray<DatabaseParamSpec>;
}

export const DATABASE_MAX_ROW_LIMIT: number = 200;
export const DATABASE_DEFAULT_ROW_LIMIT: number = 50;
export const DATABASE_MAX_MIN_SECONDS: number = 86400;
export const DATABASE_MAX_IDENTIFIER_LENGTH: number = 128;
export const DATABASE_MAX_SETTING_NAME_LENGTH: number = 64;
// Fifteen digits: every id fits a JavaScript number exactly.
export const DATABASE_MAX_SESSION_ID_DIGITS: number = 15;

const ALL_ENGINES: ReadonlyArray<DatabaseEngine> = ALL_DATABASE_ENGINES;
const SQL_AND_MONGO: ReadonlyArray<DatabaseEngine> = [
  DatabaseEngine.PostgreSQL,
  DatabaseEngine.MySQL,
  DatabaseEngine.MongoDB,
];

function limitFlag(defaultValue: number): DatabaseParamSpec {
  return {
    name: "limit",
    kind: DatabaseParamKind.Integer,
    valueLabel: "N",
    description: `at most N rows (1-${DATABASE_MAX_ROW_LIMIT}, default ${defaultValue})`,
    minimum: 1,
    maximum: DATABASE_MAX_ROW_LIMIT,
    defaultValue,
  };
}

const SESSION_STATES: ReadonlyArray<string> = [
  "active",
  "idle",
  "idle-in-transaction",
];

/*
 * Redis INFO sections worth reading while investigating. `all` and
 * `everything` are left out (use the sections), and so is nothing that
 * would print a credential: INFO never prints requirepass or masterauth.
 */
export const REDIS_INFO_SECTIONS: ReadonlyArray<string> = [
  "server",
  "clients",
  "memory",
  "persistence",
  "stats",
  "replication",
  "cpu",
  "commandstats",
  "latencystats",
  "errorstats",
  "cluster",
  "keyspace",
  "modules",
];

// MongoDB serverStatus top-level sections, exactly as serverStatus names them.
export const MONGODB_SERVER_STATUS_SECTIONS: ReadonlyArray<string> = [
  "asserts",
  "connections",
  "extra_info",
  "flowControl",
  "globalLock",
  "locks",
  "logicalSessionRecordCache",
  "mem",
  "metrics",
  "network",
  "opLatencies",
  "opcounters",
  "opcountersRepl",
  "repl",
  "storageEngine",
  "tcmalloc",
  "transactions",
  "wiredTiger",
];

function uniqueWords(
  lists: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<string> {
  const seen: Array<string> = [];

  for (const list of lists) {
    for (const word of list) {
      if (!seen.includes(word)) {
        seen.push(word);
      }
    }
  }

  return seen;
}

const SESSION_ID_ARGUMENT: DatabaseArgumentSpec = {
  name: "id",
  kind: DatabaseParamKind.SessionId,
  valueLabel: "ID",
  description:
    "the numeric id `db sessions` prints: the PostgreSQL pid, the MySQL processlist id, the Redis client id or the MongoDB opid",
  required: true,
};

/*
 * The whole catalog. Order is the guides' order: health first, then who is
 * doing what, then where the space and time go, then settings and engine
 * internals, then the two changes.
 */
export const DATABASE_DIAGNOSTIC_OPERATIONS: ReadonlyArray<DatabaseOperationSpec> =
  [
    {
      name: "ping",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "checks that the server answers",
      engines: ALL_ENGINES,
      implementation: {
        [DatabaseEngine.PostgreSQL]: "SELECT 1",
        [DatabaseEngine.MySQL]: "SELECT 1",
        [DatabaseEngine.Redis]: "PING",
        [DatabaseEngine.MongoDB]: "{ ping: 1 } on admin",
      },
      argument: null,
      flags: [],
    },
    {
      name: "version",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "shows the server's version and build",
      engines: ALL_ENGINES,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "SELECT version(), current_setting('server_version')",
        [DatabaseEngine.MySQL]: "SELECT VERSION(), @@version_comment",
        [DatabaseEngine.Redis]:
          "INFO server (redis_version, redis_mode, os, uptime_in_seconds)",
        [DatabaseEngine.MongoDB]: "buildInfo (version, gitVersion, modules)",
      },
      argument: null,
      flags: [],
    },
    {
      name: "sessions",
      aliases: ["current-ops"],
      tier: ResourceCommandTier.Read,
      summary:
        "lists the sessions (connections, clients or operations) and what each one is running",
      engines: ALL_ENGINES,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_stat_activity (pid, usename, datname, application_name, client_addr, state, wait_event_type, wait_event, backend_start, xact_start, query_start, query), without the agent's own backend",
        [DatabaseEngine.MySQL]:
          "information_schema.PROCESSLIST (ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO), without the agent's own connection",
        [DatabaseEngine.Redis]:
          "CLIENT LIST (id, addr, name, age, idle, db, cmd, user)",
        [DatabaseEngine.MongoDB]:
          "$currentOp with allUsers (opid, active, secs_running, ns, op, command, client, appName, effectiveUsers); idle connections only for --state idle",
      },
      argument: null,
      flags: [
        limitFlag(DATABASE_DEFAULT_ROW_LIMIT),
        {
          name: "state",
          kind: DatabaseParamKind.Choice,
          valueLabel: SESSION_STATES.join("|"),
          description: "only sessions in this state",
          choices: SESSION_STATES,
          engines: SQL_AND_MONGO,
        },
        {
          name: "user",
          kind: DatabaseParamKind.Identifier,
          valueLabel: "NAME",
          description: "only this user's sessions",
        },
        {
          name: "database",
          kind: DatabaseParamKind.Identifier,
          valueLabel: "NAME",
          description:
            "only sessions on this database (a Redis database number)",
        },
      ],
    },
    {
      name: "long-queries",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "lists the statements that have been running for at least --min-seconds, longest first",
      engines: SQL_AND_MONGO,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_stat_activity where state <> 'idle' and now() - query_start >= min-seconds",
        [DatabaseEngine.MySQL]:
          "information_schema.PROCESSLIST where COMMAND <> 'Sleep' and TIME >= min-seconds",
        [DatabaseEngine.MongoDB]:
          "$currentOp with active: true and secs_running >= min-seconds",
      },
      argument: null,
      flags: [
        {
          name: "min-seconds",
          kind: DatabaseParamKind.Integer,
          valueLabel: "N",
          description: `running at least N seconds (0-${DATABASE_MAX_MIN_SECONDS}, default 5)`,
          minimum: 0,
          maximum: DATABASE_MAX_MIN_SECONDS,
          defaultValue: 5,
        },
        limitFlag(DATABASE_DEFAULT_ROW_LIMIT),
      ],
    },
    {
      name: "blocking",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "shows which sessions are blocked and which session blocks them",
      engines: SQL_AND_MONGO,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_stat_activity joined with pg_blocking_pids(pid)",
        [DatabaseEngine.MySQL]:
          "sys.innodb_lock_waits (performance_schema.data_lock_waits; information_schema.INNODB_LOCK_WAITS on MariaDB)",
        [DatabaseEngine.MongoDB]:
          "$currentOp with waitingForLock: true, with each operation's locks",
      },
      argument: null,
      flags: [limitFlag(DATABASE_DEFAULT_ROW_LIMIT)],
    },
    {
      name: "locks",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "lists the locks held and awaited, with their sessions",
      engines: SQL_AND_MONGO,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_locks joined with pg_stat_activity (locktype, relation, mode, granted, pid)",
        [DatabaseEngine.MySQL]:
          "performance_schema.data_locks (information_schema.INNODB_LOCKS on MariaDB)",
        [DatabaseEngine.MongoDB]: "$currentOp with each operation's locks",
      },
      argument: null,
      flags: [limitFlag(DATABASE_DEFAULT_ROW_LIMIT)],
    },
    {
      name: "replication",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "shows the replication role, replicas and lag",
      engines: ALL_ENGINES,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_is_in_recovery(), pg_stat_replication and pg_replication_slots on a primary, pg_stat_wal_receiver and replay lag on a standby",
        [DatabaseEngine.MySQL]:
          "SHOW REPLICA STATUS (SHOW SLAVE STATUS before MySQL 8.0.22 and on MariaDB) and SHOW BINARY LOG STATUS / SHOW MASTER STATUS",
        [DatabaseEngine.Redis]: "INFO replication",
        [DatabaseEngine.MongoDB]:
          "replSetGetStatus (members, state, optime lag); says so when the server is not in a replica set",
      },
      argument: null,
      flags: [],
    },
    {
      name: "connections",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "counts connections by state, user and database against the connection limit",
      engines: ALL_ENGINES,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_stat_activity grouped by state, usename, datname, with max_connections",
        [DatabaseEngine.MySQL]:
          "information_schema.PROCESSLIST grouped by USER, DB, COMMAND, with Threads_connected and max_connections",
        [DatabaseEngine.Redis]:
          "INFO clients and CLIENT LIST grouped by user and db, with maxclients",
        [DatabaseEngine.MongoDB]:
          "serverStatus.connections, and $currentOp grouped by client application",
      },
      argument: null,
      flags: [],
    },
    {
      name: "database-sizes",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "lists each database's size on disk, largest first",
      engines: SQL_AND_MONGO,
      implementation: {
        [DatabaseEngine.PostgreSQL]: "pg_database_size() of every database",
        [DatabaseEngine.MySQL]:
          "information_schema.TABLES summed per TABLE_SCHEMA",
        [DatabaseEngine.MongoDB]: "listDatabases (sizeOnDisk)",
      },
      argument: null,
      flags: [],
    },
    {
      name: "table-sizes",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "lists the largest tables (collections on MongoDB) with their index sizes and row counts",
      engines: SQL_AND_MONGO,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_total_relation_size, pg_relation_size and pg_indexes_size per table of the connected database (--database must name it)",
        [DatabaseEngine.MySQL]:
          "information_schema.TABLES (DATA_LENGTH, INDEX_LENGTH, TABLE_ROWS)",
        [DatabaseEngine.MongoDB]:
          "$collStats storageStats (size, storageSize, totalIndexSize, count) per collection of --database",
      },
      argument: null,
      flags: [
        {
          name: "database",
          kind: DatabaseParamKind.Identifier,
          valueLabel: "NAME",
          description: "the database (schema on MySQL) to look in",
        },
        limitFlag(DATABASE_DEFAULT_ROW_LIMIT),
      ],
    },
    {
      name: "top-statements",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "lists the statements that took the most total time, with calls and mean time; their text is normalized, without values",
      engines: [DatabaseEngine.PostgreSQL, DatabaseEngine.MySQL],
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_stat_statements ordered by total_exec_time (says so when the extension is not installed)",
        [DatabaseEngine.MySQL]:
          "performance_schema.events_statements_summary_by_digest ordered by SUM_TIMER_WAIT",
      },
      argument: null,
      flags: [limitFlag(20)],
    },
    {
      name: "settings",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "shows one server setting, or every setting when no name is given (credential settings are never shown)",
      engines: ALL_ENGINES,
      implementation: {
        [DatabaseEngine.PostgreSQL]:
          "pg_settings (name, setting, unit, source, pending_restart)",
        [DatabaseEngine.MySQL]: "SHOW GLOBAL VARIABLES",
        [DatabaseEngine.Redis]:
          "CONFIG GET NAME (every parameter when no name is given)",
        [DatabaseEngine.MongoDB]:
          "getParameter NAME (allParameters when no name is given)",
      },
      argument: {
        name: "name",
        kind: DatabaseParamKind.SettingName,
        valueLabel: "NAME",
        description:
          "the setting's exact name (work_mem, max_connections, maxmemory-policy, ...)",
        required: false,
      },
      flags: [],
    },
    {
      name: "slowlog",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "shows the most recent slow commands the server logged",
      engines: [DatabaseEngine.Redis, DatabaseEngine.MySQL],
      implementation: {
        [DatabaseEngine.Redis]: "SLOWLOG GET N",
        [DatabaseEngine.MySQL]:
          "mysql.slow_log (only when log_output includes TABLE; says so otherwise)",
      },
      argument: null,
      flags: [limitFlag(20)],
    },
    {
      name: "info",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "shows the server's INFO / serverStatus report, or one section of it",
      engines: [DatabaseEngine.Redis, DatabaseEngine.MongoDB],
      implementation: {
        [DatabaseEngine.Redis]: "INFO [SECTION]",
        [DatabaseEngine.MongoDB]:
          "serverStatus, or one top-level section of it",
      },
      argument: {
        name: "section",
        kind: DatabaseParamKind.Choice,
        valueLabel: "SECTION",
        description: "one section of the report",
        choices: uniqueWords([
          REDIS_INFO_SECTIONS,
          MONGODB_SERVER_STATUS_SECTIONS,
        ]),
        choicesByEngine: {
          [DatabaseEngine.Redis]: REDIS_INFO_SECTIONS,
          [DatabaseEngine.MongoDB]: MONGODB_SERVER_STATUS_SECTIONS,
        },
        required: false,
      },
      flags: [],
    },
    {
      name: "innodb-status",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "shows InnoDB's status report: latest deadlock, transactions, buffer pool, I/O",
      engines: [DatabaseEngine.MySQL],
      implementation: {
        [DatabaseEngine.MySQL]: "SHOW ENGINE INNODB STATUS",
      },
      argument: null,
      flags: [],
    },
    {
      name: "memory",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary: "shows memory use, limits and fragmentation or cache pressure",
      engines: [DatabaseEngine.Redis, DatabaseEngine.MongoDB],
      implementation: {
        [DatabaseEngine.Redis]: "INFO memory and MEMORY STATS",
        [DatabaseEngine.MongoDB]: "serverStatus mem and wiredTiger.cache",
      },
      argument: null,
      flags: [],
    },
    {
      name: "keyspace",
      aliases: [],
      tier: ResourceCommandTier.Read,
      summary:
        "shows the key count, expiring keys and average TTL of each database",
      engines: [DatabaseEngine.Redis],
      implementation: {
        [DatabaseEngine.Redis]: "INFO keyspace and DBSIZE",
      },
      argument: null,
      flags: [],
    },
    {
      name: "cancel-query",
      aliases: [],
      tier: ResourceCommandTier.SafeWrite,
      summary:
        "cancels the statement one session is running; the session stays connected and its client can retry",
      engines: SQL_AND_MONGO,
      implementation: {
        [DatabaseEngine.PostgreSQL]: "SELECT pg_cancel_backend(ID)",
        [DatabaseEngine.MySQL]: "KILL QUERY ID",
        [DatabaseEngine.MongoDB]: "killOp { op: ID }",
      },
      argument: SESSION_ID_ARGUMENT,
      flags: [],
    },
    {
      name: "terminate-session",
      aliases: [],
      tier: ResourceCommandTier.RiskyWrite,
      summary:
        "disconnects one session, rolling back its open transaction; its client must reconnect",
      engines: [
        DatabaseEngine.PostgreSQL,
        DatabaseEngine.MySQL,
        DatabaseEngine.Redis,
      ],
      implementation: {
        [DatabaseEngine.PostgreSQL]: "SELECT pg_terminate_backend(ID)",
        [DatabaseEngine.MySQL]: "KILL CONNECTION ID",
        [DatabaseEngine.Redis]: "CLIENT KILL ID ID",
      },
      argument: SESSION_ID_ARGUMENT,
      flags: [],
    },
  ];

// The canonical operation names, in catalog order.
export const DATABASE_OPERATION_NAMES: ReadonlyArray<string> =
  DATABASE_DIAGNOSTIC_OPERATIONS.map((operation: DatabaseOperationSpec) => {
    return operation.name;
  });

// The operation a word names exactly (canonical name or alias), or null.
export function getDatabaseOperation(
  word: unknown,
): DatabaseOperationSpec | null {
  if (typeof word !== "string" || !word) {
    return null;
  }

  for (const operation of DATABASE_DIAGNOSTIC_OPERATIONS) {
    if (operation.name === word || operation.aliases.includes(word)) {
      return operation;
    }
  }

  return null;
}

/*
 * Setting names that hold (or name) a credential: Redis requirepass and
 * masterauth, MySQL/PostgreSQL password settings, anything with a secret or
 * token in its name. `db settings` refuses them by name, and the executor
 * leaves them out when it lists every setting.
 */
const CREDENTIAL_SETTING_NAME_REGEX: RegExp =
  /pass|pwd|secret|token|credential|masterauth|private[-_.]?key|api[-_.]?key|keyfile|key[-_.]?file/i;

export function isDatabaseCredentialSettingName(name: unknown): boolean {
  return typeof name === "string" && CREDENTIAL_SETTING_NAME_REGEX.test(name);
}

// A parameter's value, as the executor receives it.
export type DatabaseParamValue = string | number;

// One `db` command, read.
export interface ParsedDatabaseCommand {
  operation: DatabaseOperationSpec;
  // The argument's value (a number for a session id), or null.
  argument: DatabaseParamValue | null;
  // Each given flag's value by flag name (numbers for Integer flags).
  flags: Record<string, DatabaseParamValue>;
  // The canonical argv WITHOUT the program: operation, argument, flags in catalog order.
  canonicalArgs: Array<string>;
}

export type DatabaseCommandParse =
  | { ok: true; command: ParsedDatabaseCommand }
  | { ok: false; errorMessage: string };

const INTEGER_REGEX: RegExp = /^(?:0|[1-9][0-9]{0,8})$/;
const IDENTIFIER_REGEX: RegExp = /^[A-Za-z0-9_.$][A-Za-z0-9_.$-]{0,127}$/;
const SETTING_NAME_REGEX: RegExp = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const SESSION_ID_REGEX: RegExp = /^[1-9][0-9]{0,14}$/;
const FLAG_NAME_REGEX: RegExp = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// The longest word quoted back in a refusal.
const MAX_QUOTED_WORD_LENGTH: number = 64;

// A word as a refusal quotes it: JSON-escaped, and cut when it is long.
function quoteWord(word: string): string {
  const shown: string =
    word.length > MAX_QUOTED_WORD_LENGTH
      ? `${word.slice(0, MAX_QUOTED_WORD_LENGTH)}...`
      : word;

  return JSON.stringify(shown);
}

function joinWords(words: ReadonlyArray<string>, conjunction: string): string {
  if (words.length <= 1) {
    return words.join("");
  }

  return `${words.slice(0, -1).join(", ")} ${conjunction} ${
    words[words.length - 1]
  }`;
}

// "db sessions [--limit N] [--state active|idle|...] ..." for one operation.
export function describeDatabaseOperationUsage(
  operation: DatabaseOperationSpec,
  engine: DatabaseEngine | null = null,
): string {
  const words: Array<string> = [DATABASE_PROGRAM, operation.name];

  if (operation.argument) {
    const label: string = describeValueLabel(operation.argument, engine);
    words.push(operation.argument.required ? label : `[${label}]`);
  }

  for (const flag of operation.flags) {
    if (engine && flag.engines && !flag.engines.includes(engine)) {
      continue;
    }

    words.push(`[--${flag.name} ${describeValueLabel(flag, engine)}]`);
  }

  return words.join(" ");
}

function describeValueLabel(
  param: DatabaseParamSpec,
  engine: DatabaseEngine | null,
): string {
  if (param.kind !== DatabaseParamKind.Choice) {
    return param.valueLabel;
  }

  const choices: ReadonlyArray<string> = choicesFor(param, engine);

  // A long list reads better in the parameter's description.
  return choices.length <= 4 ? choices.join("|") : param.valueLabel;
}

function choicesFor(
  param: DatabaseParamSpec,
  engine: DatabaseEngine | null,
): ReadonlyArray<string> {
  if (engine && param.choicesByEngine && param.choicesByEngine[engine]) {
    return param.choicesByEngine[engine] || [];
  }

  return param.choices || [];
}

// "takes --limit, --state, --user and --database" / "takes no flags".
function describeFlags(operation: DatabaseOperationSpec): string {
  if (operation.flags.length === 0) {
    return `db ${operation.name} takes no flags`;
  }

  return `db ${operation.name} takes ${joinWords(
    operation.flags.map((flag: DatabaseParamSpec): string => {
      return `--${flag.name}`;
    }),
    "and",
  )}`;
}

function operationList(): string {
  const reads: Array<string> = [];
  const writes: Array<string> = [];

  for (const operation of DATABASE_DIAGNOSTIC_OPERATIONS) {
    const names: string = [operation.name, ...operation.aliases].join(", ");

    if (operation.tier === ResourceCommandTier.Read) {
      reads.push(names);
    } else {
      writes.push(names);
    }
  }

  return `the db operations are ${reads.join(", ")} (read-only) and ${joinWords(
    writes,
    "and",
  )} (changes)`;
}

/*
 * Words a model reaches for that would run text it wrote: SQL, a Redis
 * command, Mongo shell code, a script. None exists, whatever the spelling.
 */
const FREE_TEXT_OPERATIONS: ReadonlyArray<string> = [
  "sql",
  "query",
  "queries",
  "exec",
  "execute",
  "eval",
  "evalsha",
  "script",
  "run",
  "shell",
  "raw",
  "command",
  "cmd",
  "statement",
  "select",
  "explain",
  "call",
  "function",
  "psql",
  "mysql",
  "mongosh",
  "mongo",
  "redis-cli",
  "cli",
  "console",
  "aggregate",
  "find",
];

/*
 * Words for changes the catalog does not have. The agent changes nothing
 * but one session at a time.
 */
const CHANGE_OPERATIONS: ReadonlyArray<string> = [
  "config",
  "config-set",
  "set",
  "set-setting",
  "alter",
  "alter-system",
  "reload",
  "flushall",
  "flushdb",
  "flush",
  "shutdown",
  "restart",
  "drop",
  "truncate",
  "delete",
  "del",
  "unlink",
  "insert",
  "update",
  "create",
  "grant",
  "revoke",
  "vacuum",
  "analyze",
  "reindex",
  "optimize",
  "repair",
  "save",
  "bgsave",
  "bgrewriteaof",
  "replicaof",
  "slaveof",
  "failover",
  "stepdown",
  "migrate",
  "expire",
  "debug",
  "acl",
  "client",
  "module",
  "compact",
  "kill-all",
];

// Words for the two changes the catalog does have, spelled another way.
const SESSION_CHANGE_SPELLINGS: ReadonlyArray<string> = [
  "kill",
  "killop",
  "kill-op",
  "kill-query",
  "cancel",
  "cancel-backend",
  "pg-cancel-backend",
  "terminate",
  "terminate-backend",
  "pg-terminate-backend",
  "kill-session",
  "kill-connection",
  "disconnect",
  "client-kill",
];

// Why the word is not an operation, and what to write instead.
function describeUnknownOperation(word: string): string {
  const folded: string = word.toLowerCase().replace(/_/g, "-");
  const exact: DatabaseOperationSpec | null = getDatabaseOperation(folded);

  if (exact) {
    return `${quoteWord(word)} is not a db operation; operations are lowercase words joined by dashes, so write "db ${exact.name}"`;
  }

  if (SESSION_CHANGE_SPELLINGS.includes(folded)) {
    return `${quoteWord(word)} is not a db operation: to stop one session's running statement write "db cancel-query ID", to disconnect it write "db terminate-session ID" (ID is the number db sessions prints)`;
  }

  if (FREE_TEXT_OPERATIONS.includes(folded)) {
    return `${quoteWord(word)} is not a db operation: db never runs SQL, database commands or scripts the model writes, only operations from its fixed catalog; ${operationList()}`;
  }

  if (CHANGE_OPERATIONS.includes(folded)) {
    return `${quoteWord(word)} is not a db operation: the only changes db makes are cancel-query and terminate-session (one session at a time); settings, data, schema, replication and the server itself are never changed; ${operationList()}`;
  }

  return `${quoteWord(word)} is not a db operation; ${operationList()}`;
}

/*
 * Flags a real database CLI takes to pick the server, the login or TLS. The
 * agent connects with its own configuration only, so none exists here.
 */
const CONNECTION_FLAGS: ReadonlyArray<string> = [
  "host",
  "hostname",
  "port",
  "socket",
  "password",
  "pass",
  "pwd",
  "username",
  "login",
  "login-path",
  "uri",
  "url",
  "dsn",
  "conn",
  "connection",
  "connection-string",
  "auth",
  "authentication-database",
  "auth-source",
  "tls",
  "ssl",
  "ssl-mode",
  "sslmode",
  "cert",
  "key",
  "ca",
  "config",
  "config-file",
  "defaults-file",
  "defaults-extra-file",
  "init-command",
  "server",
  "cluster",
  "role",
];

// Why a value is not what the parameter takes; null when it is.
function describeValueProblem(
  param: DatabaseParamSpec,
  value: string,
  shownName: string,
): string | null {
  switch (param.kind) {
    case DatabaseParamKind.Integer: {
      const minimum: number = param.minimum === undefined ? 0 : param.minimum;
      const maximum: number =
        param.maximum === undefined ? DATABASE_MAX_ROW_LIMIT : param.maximum;

      if (INTEGER_REGEX.test(value)) {
        const parsed: number = Number(value);

        if (parsed >= minimum && parsed <= maximum) {
          return null;
        }
      }

      return `${shownName} must be a whole number from ${minimum} to ${maximum}, written without leading zeros (got ${quoteWord(value)})`;
    }

    case DatabaseParamKind.Identifier:
      return IDENTIFIER_REGEX.test(value)
        ? null
        : `${shownName} must be a name of 1-${DATABASE_MAX_IDENTIFIER_LENGTH} letters, digits and _ . $ - that does not start with "-" (got ${quoteWord(value)})`;

    case DatabaseParamKind.Choice: {
      const choices: ReadonlyArray<string> = param.choices || [];

      if (choices.includes(value)) {
        return null;
      }

      const folded: string | undefined = choices.find(
        (choice: string): boolean => {
          return choice.toLowerCase() === value.toLowerCase();
        },
      );

      return folded
        ? `${shownName} is case-sensitive: write ${quoteWord(folded)} (got ${quoteWord(value)})`
        : `${shownName} must be one of ${choices.join(", ")} (got ${quoteWord(value)})`;
    }

    case DatabaseParamKind.SettingName:
      if (!SETTING_NAME_REGEX.test(value)) {
        return `${shownName} must be one setting's exact name: 1-${DATABASE_MAX_SETTING_NAME_LENGTH} letters, digits and _ . - (no wildcards; got ${quoteWord(value)})`;
      }

      return isDatabaseCredentialSettingName(value)
        ? `${quoteWord(value)} is a credential setting, and db never reads credentials`
        : null;

    case DatabaseParamKind.SessionId:
      if (SESSION_ID_REGEX.test(value)) {
        return null;
      }

      return value.startsWith("session:")
        ? `${shownName} is the bare number: write ${quoteWord(value.slice("session:".length))}, not ${quoteWord(value)}`
        : `${shownName} must be the numeric session id db sessions prints: a positive whole number of at most ${DATABASE_MAX_SESSION_ID_DIGITS} digits, without leading zeros (got ${quoteWord(value)})`;

    default:
      return `${shownName} has a type db does not know`;
  }
}

function toParamValue(
  param: DatabaseParamSpec,
  value: string,
): DatabaseParamValue {
  return param.kind === DatabaseParamKind.Integer ||
    param.kind === DatabaseParamKind.SessionId
    ? Number(value)
    : value;
}

function refuse(errorMessage: string): DatabaseCommandParse {
  return { ok: false, errorMessage };
}

/*
 * Read one `db` argv (argv[0] is the program) into one catalog operation,
 * or say why it is not one. Total: anything that is not an array of
 * strings, however malformed, is refused, never thrown on.
 */
export function parseDatabaseCommand(argv: unknown): DatabaseCommandParse {
  if (!Array.isArray(argv) || argv.length === 0) {
    return refuse("empty command");
  }

  if (
    argv.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return refuse("every word of the command must be a string");
  }

  const words: Array<string> = argv as Array<string>;

  if (words[0] !== DATABASE_PROGRAM) {
    return refuse(
      `a database command starts with "${DATABASE_PROGRAM}" (got ${quoteWord(words[0] || "")})`,
    );
  }

  const operationWord: string | undefined = words[1];

  if (operationWord === undefined || operationWord === "") {
    return refuse(
      `name an operation: "db <operation> [argument] [--flag value]"; ${operationList()}`,
    );
  }

  if (operationWord.startsWith("-")) {
    return refuse(
      `the operation comes right after "db", before any flag (got ${quoteWord(operationWord)}); ${operationList()}`,
    );
  }

  const operation: DatabaseOperationSpec | null =
    getDatabaseOperation(operationWord);

  if (!operation) {
    return refuse(describeUnknownOperation(operationWord));
  }

  const usage: string = `usage: ${describeDatabaseOperationUsage(operation)}`;
  const flags: Record<string, DatabaseParamValue> = {};
  const given: Array<string> = [];
  let argument: DatabaseParamValue | null = null;
  let argumentWord: string | null = null;
  let afterDoubleDash: boolean = false;

  for (let i: number = 2; i < words.length; i++) {
    const word: string = words[i]!;

    if (!afterDoubleDash && word === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (!afterDoubleDash && word.startsWith("-") && word !== "-") {
      if (!word.startsWith("--")) {
        return refuse(
          `db takes long flags only, written like "--limit 20" or "--limit=20"; ${quoteWord(word)} is not one (${describeFlags(operation)}; ${usage})`,
        );
      }

      const equals: number = word.indexOf("=");
      const rawName: string =
        equals >= 0 ? word.slice(2, equals) : word.slice(2);

      if (!FLAG_NAME_REGEX.test(rawName)) {
        const lower: string = rawName.toLowerCase().replace(/_/g, "-");
        const known: DatabaseParamSpec | undefined = operation.flags.find(
          (flag: DatabaseParamSpec): boolean => {
            return flag.name === lower;
          },
        );

        return refuse(
          known
            ? `flags are lowercase words joined by dashes: write --${known.name}, not ${quoteWord(`--${rawName}`)}`
            : `${quoteWord(word)} is not a flag db knows (${describeFlags(operation)}; ${usage})`,
        );
      }

      const flag: DatabaseParamSpec | undefined = operation.flags.find(
        (candidate: DatabaseParamSpec): boolean => {
          return candidate.name === rawName;
        },
      );

      if (!flag) {
        if (CONNECTION_FLAGS.includes(rawName)) {
          return refuse(
            `--${rawName} is not available: the Database AI agent connects to its own database with its own configuration, so a command cannot choose the server, the login or TLS (${describeFlags(operation)})`,
          );
        }

        return refuse(
          `${describeFlags(operation)}, not --${rawName} (${usage})`,
        );
      }

      if (given.includes(flag.name)) {
        return refuse(
          `--${flag.name} is given more than once; give each flag once (${usage})`,
        );
      }

      let value: string;

      if (equals >= 0) {
        value = word.slice(equals + 1);
      } else {
        const next: string | undefined = words[i + 1];

        // Never take a flag-looking word as a value: it would skip that flag's check.
        if (next === undefined || next.startsWith("-")) {
          return refuse(
            `--${flag.name} needs a value${
              next === undefined
                ? ""
                : `, but the next word is ${quoteWord(next)}`
            } (${usage})`,
          );
        }

        value = next;
        i++;
      }

      if (value === "") {
        return refuse(`--${flag.name} needs a value (${usage})`);
      }

      const problem: string | null = describeValueProblem(
        flag,
        value,
        `--${flag.name}`,
      );

      if (problem) {
        return refuse(problem);
      }

      given.push(flag.name);
      flags[flag.name] = toParamValue(flag, value);
      continue;
    }

    // A positional word: the operation's one argument.
    if (!operation.argument) {
      return refuse(
        `db ${operation.name} takes no argument (got ${quoteWord(word)}; ${usage})`,
      );
    }

    if (argumentWord !== null) {
      return refuse(
        `db ${operation.name} takes one ${operation.argument.valueLabel}, but got ${quoteWord(argumentWord)} and ${quoteWord(word)} (${usage})`,
      );
    }

    const problem: string | null = describeValueProblem(
      operation.argument,
      word,
      operation.argument.valueLabel,
    );

    if (problem) {
      return refuse(`${problem} (${usage})`);
    }

    argumentWord = word;
    argument = toParamValue(operation.argument, word);
  }

  if (
    operation.argument &&
    operation.argument.required &&
    argumentWord === null
  ) {
    return refuse(
      `db ${operation.name} needs ${operation.argument.valueLabel}: ${operation.argument.description} (${usage})`,
    );
  }

  const canonicalArgs: Array<string> = [operation.name];

  if (argumentWord !== null) {
    canonicalArgs.push(argumentWord);
  }

  for (const flag of operation.flags) {
    if (Object.prototype.hasOwnProperty.call(flags, flag.name)) {
      canonicalArgs.push(`--${flag.name}`, String(flags[flag.name]));
    }
  }

  return {
    ok: true,
    command: { operation, argument, flags, canonicalArgs },
  };
}

/*
 * Why this engine cannot run the parsed command, or null when it can: an
 * unknown engine, an operation the engine lacks, a flag that does not apply
 * to it, a choice it does not have. The executor asks this before it runs
 * anything; the policy does not (it tiers without knowing the engine).
 */
export function getDatabaseEngineRefusal(
  command: ParsedDatabaseCommand,
  engineValue: unknown,
): string | null {
  const engine: DatabaseEngine | null = parseDatabaseEngine(engineValue);

  if (!engine) {
    return `the Database AI agent does not know the engine ${quoteWord(
      typeof engineValue === "string" ? engineValue : String(engineValue),
    )}: it runs its catalog on ${joinWords(
      ALL_DATABASE_ENGINES.map((known: DatabaseEngine): string => {
        return DATABASE_ENGINE_DISPLAY_NAMES[known];
      }),
      "and",
    )}`;
  }

  const name: string = DATABASE_ENGINE_DISPLAY_NAMES[engine];

  if (!command || !command.operation) {
    return "the command could not be read";
  }

  const operation: DatabaseOperationSpec = command.operation;

  if (!operation.engines.includes(engine)) {
    return `db ${operation.name} is not available on ${name}; on ${name} the operations are ${getDatabaseOperationsForEngine(
      engine,
    )
      .map((candidate: DatabaseOperationSpec): string => {
        return candidate.name;
      })
      .join(", ")}`;
  }

  for (const flag of operation.flags) {
    if (
      Object.prototype.hasOwnProperty.call(command.flags || {}, flag.name) &&
      flag.engines &&
      !flag.engines.includes(engine)
    ) {
      return `--${flag.name} is not available for db ${operation.name} on ${name}`;
    }
  }

  if (
    operation.argument &&
    operation.argument.kind === DatabaseParamKind.Choice &&
    command.argument !== null &&
    command.argument !== undefined
  ) {
    const choices: ReadonlyArray<string> = choicesFor(
      operation.argument,
      engine,
    );

    if (!choices.includes(String(command.argument))) {
      return `${quoteWord(String(command.argument))} is not a ${operation.argument.valueLabel} on ${name}; ${name} has ${choices.join(", ")}`;
    }
  }

  return null;
}

// The operations one engine supports, in catalog order.
export function getDatabaseOperationsForEngine(
  engine: DatabaseEngine,
): Array<DatabaseOperationSpec> {
  return DATABASE_DIAGNOSTIC_OPERATIONS.filter(
    (operation: DatabaseOperationSpec): boolean => {
      return operation.engines.includes(engine);
    },
  );
}

function engineTag(
  engines: ReadonlyArray<DatabaseEngine>,
  engine: DatabaseEngine | null,
): string {
  if (engine || engines.length === ALL_DATABASE_ENGINES.length) {
    return "";
  }

  return ` (${engines
    .map((candidate: DatabaseEngine): string => {
      return DATABASE_ENGINE_DISPLAY_NAMES[candidate];
    })
    .join(", ")})`;
}

// Notes on the flags and choices that apply to only some engines, or have a long list.
function paramNotes(
  operation: DatabaseOperationSpec,
  engine: DatabaseEngine | null,
): string {
  const notes: Array<string> = [];

  for (const flag of operation.flags) {
    if (!engine && flag.engines) {
      notes.push(
        `--${flag.name} on ${flag.engines
          .map((candidate: DatabaseEngine): string => {
            return DATABASE_ENGINE_DISPLAY_NAMES[candidate];
          })
          .join(", ")} only`,
      );
    }
  }

  const argumentSpec: DatabaseArgumentSpec | null = operation.argument;

  if (
    argumentSpec &&
    argumentSpec.kind === DatabaseParamKind.Choice &&
    choicesFor(argumentSpec, engine).length > 4
  ) {
    if (engine) {
      notes.push(
        `${argumentSpec.valueLabel}: ${choicesFor(argumentSpec, engine).join(", ")}`,
      );
    } else if (argumentSpec.choicesByEngine) {
      for (const candidate of ALL_DATABASE_ENGINES) {
        const choices: ReadonlyArray<string> | undefined =
          argumentSpec.choicesByEngine[candidate];

        if (choices) {
          notes.push(
            `${DATABASE_ENGINE_DISPLAY_NAMES[candidate]} ${argumentSpec.valueLabel}: ${choices.join(", ")}`,
          );
        }
      }
    }
  }

  return notes.length ? `; ${notes.join("; ")}` : "";
}

function operationBullet(
  operation: DatabaseOperationSpec,
  engine: DatabaseEngine | null,
): string {
  const aliases: string = operation.aliases.length
    ? ` (also \`${operation.aliases
        .map((alias: string): string => {
          return `db ${alias}`;
        })
        .join("`, `")}\`)`
    : "";

  return `- \`${describeDatabaseOperationUsage(operation, engine)}\`${aliases}: ${
    operation.summary
  }${engineTag(operation.engines, engine)}${paramNotes(operation, engine)}.`;
}

function guideOperations(
  engine: DatabaseEngine | null,
  isRead: boolean,
): Array<DatabaseOperationSpec> {
  return DATABASE_DIAGNOSTIC_OPERATIONS.filter(
    (operation: DatabaseOperationSpec): boolean => {
      return (
        (operation.tier === ResourceCommandTier.Read) === isRead &&
        (!engine || operation.engines.includes(engine))
      );
    },
  );
}

/*
 * The read cheat-sheet for the investigation tool: compact markdown
 * bullets. With an engine (a DATABASE_SYSTEM value such as "postgresql" or
 * "mariadb"), only what that engine supports; otherwise every operation,
 * tagged with the engines it runs on.
 */
export function getDatabaseReadCommandGuide(engineValue?: unknown): string {
  const engine: DatabaseEngine | null = parseDatabaseEngine(engineValue);
  const where: string = engine
    ? ` on this ${DATABASE_ENGINE_DISPLAY_NAMES[engine]} server`
    : "";

  return [
    `- \`db\` runs one operation from a fixed diagnostic catalog${where} — never SQL, database commands or scripts you write: \`db <operation> [argument] [--flag value]\`, long flags only (\`--limit 20\` or \`--limit=20\`), each flag once.`,
    ...guideOperations(engine, true).map(
      (operation: DatabaseOperationSpec): string => {
        return operationBullet(operation, engine);
      },
    ),
    "- Query text in results is normalized: string and number literals show as ? (credentials are never shown).",
  ].join("\n");
}

/*
 * The write cheat-sheet for the remediation tools: the two changes, their
 * tiers and targets, and what never changes.
 */
export function getDatabaseWriteCommandGuide(engineValue?: unknown): string {
  const engine: DatabaseEngine | null = parseDatabaseEngine(engineValue);
  const lines: Array<string> = [];

  for (const operation of guideOperations(engine, false)) {
    const tier: string =
      operation.tier === ResourceCommandTier.SafeWrite
        ? "safe: may run without approval in Automatic mode"
        : "risky: needs approval unless allowlisted or approvals are bypassed";

    lines.push(
      `- \`${describeDatabaseOperationUsage(operation, engine)}\` (${tier}): ${
        operation.summary
      }${engineTag(operation.engines, engine)}.`,
    );
  }

  if (lines.length === 0) {
    lines.push(
      `- No changes: db makes no change on ${
        engine ? DATABASE_ENGINE_DISPLAY_NAMES[engine] : "this engine"
      }.`,
    );
  } else {
    lines.push(
      `- ID is the number \`db sessions\` prints (${SESSION_ID_ARGUMENT.description.replace(
        /^the numeric id `db sessions` prints: /,
        "",
      )}); the change's target is \`session:ID\`, one session per command.`,
    );
  }

  lines.push(
    "- Nothing else changes the database: no SQL, no setting changes (ALTER SYSTEM, SET GLOBAL, CONFIG SET), no FLUSHALL/FLUSHDB, no SHUTDOWN, no schema, data, user or replication changes.",
  );

  return lines.join("\n");
}
