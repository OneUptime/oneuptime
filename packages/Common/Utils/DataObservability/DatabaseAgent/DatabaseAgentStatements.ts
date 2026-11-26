import {
  DataCheckType,
  MAX_ACCEPTED_VALUES,
  MAX_SEGMENTS_PER_CHECK,
  isColumnCheckType,
  isQueryCheckType,
  isSampleableCheckType,
} from "../../../Types/DataObservability/DataCheckType";
import {
  DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH,
  DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
  DATABASE_AGENT_MAX_PATTERN_LENGTH,
  DATABASE_AGENT_MAX_VALUE_LENGTH,
  DatabaseAgentCheck,
  DatabaseAgentEngine,
  DatabaseAgentFreshnessRead,
} from "./DatabaseAgentWork";

/*
 * THE QUERY SHAPES DATA OBSERVABILITY READS A POSTGRESQL OR MYSQL DATABASE
 * WITH: every statement there is, and nothing else.
 *
 *   - the catalog: tables and views with their row estimates, sizes and
 *     read and write counters, their columns, how long the counters have
 *     counted, which views select from which tables, and how busy the
 *     server is - fixed statements, whose only value is a limit, bound;
 *   - a check: one aggregate over one table of the catalog (a share of
 *     empty values, a count, a sum ...), built here from its type and the
 *     names it reads, each name quoted as the engine quotes a name and every
 *     value it compares with bound - or, where the agent's owner turned it
 *     on, the person's own Custom SQL, wrapped so that only its rows are
 *     counted or limited;
 *   - a freshness column: the newest value of one column of one table.
 *
 * OneUptime's workers and probes read the catalog with these same
 * statements (Server/Utils/DataObservability/TableHealthCollector), and
 * their checks come out of the server's builder (DataCheckSql) as exactly
 * the statements built here: DatabaseAgentStatementsParity holds both.
 * The Database Agent (agents/ResourceAIAgent) runs these from its own
 * byte-for-byte copy of this file, so the shapes it runs are decided on
 * the agent. Every statement it runs is a read, in a read-only transaction
 * with a time limit (the agent's DataObservability collector).
 */

// A share of empty values of no rows is NULL: reported as nothing, never 0.
export const DATABASE_AGENT_VALUE_ALIAS: string = "value";

/*
 * Why a check was not run, in a sentence: a name it reads is not in the
 * catalog, its type needs what it lacks, or the agent's owner did not turn
 * Custom SQL on. Thrown by the builders; the collector reports it as the
 * check's error.
 */
export class DatabaseAgentRefusal extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DatabaseAgentRefusal";
  }
}

export const CUSTOM_SQL_OFF_REFUSAL: string =
  "This Database Agent runs no Custom SQL: its owner has not turned it on (ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL=true in its environment). The check's other types run as usual.";

/*
 * ---------------------------------------------------------------------------
 * The catalog
 * ---------------------------------------------------------------------------
 */

// The relations a PostgreSQL catalog read lists: tables, views, partitioned and foreign tables.
export const POSTGRES_RELATION_FILTER: string = `c.relkind IN ('r', 'v', 'm', 'p', 'f')
      AND NOT c.relispartition
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_toast%'
      AND n.nspname NOT LIKE 'pg\\_temp\\_%'`;

/*
 * Every relation with its row estimate, size and read and write counters,
 * at most $1 of them. Sizing every relation is the costly part, so a read
 * that fails with sizes is tried once more without them.
 */
export function getPostgresTablesSql(withSizes: boolean): string {
  const size: string = withSizes
    ? `CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(pg_catalog.pg_total_relation_size(i.inhrelid))
            FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') THEN pg_catalog.pg_total_relation_size(c.oid)
          ELSE NULL
        END::bigint`
    : "NULL::bigint";

  return `SELECT n.nspname AS table_schema, c.relname AS table_name, c.relkind AS relkind,
        CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(GREATEST(COALESCE(cs.n_live_tup, child.reltuples), 0))
            FROM pg_catalog.pg_inherits i
            JOIN pg_catalog.pg_class child ON child.oid = i.inhrelid
            LEFT JOIN pg_catalog.pg_stat_user_tables cs ON cs.relid = child.oid
            WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') THEN GREATEST(COALESCE(s.n_live_tup, c.reltuples), 0)
          ELSE NULL
        END::bigint AS estimated_rows,
        ${size} AS size_bytes,
        CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(COALESCE(cs.n_tup_ins, 0) + COALESCE(cs.n_tup_upd, 0) + COALESCE(cs.n_tup_del, 0))
            FROM pg_catalog.pg_inherits i
            JOIN pg_catalog.pg_stat_user_tables cs ON cs.relid = i.inhrelid
            WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') AND s.relid IS NOT NULL
            THEN COALESCE(s.n_tup_ins, 0) + COALESCE(s.n_tup_upd, 0) + COALESCE(s.n_tup_del, 0)
          ELSE NULL
        END::bigint AS write_count,
        CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(COALESCE(cs.seq_scan, 0) + COALESCE(cs.idx_scan, 0))
            FROM pg_catalog.pg_inherits i
            JOIN pg_catalog.pg_stat_user_tables cs ON cs.relid = i.inhrelid
            WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') AND s.relid IS NOT NULL
            THEN COALESCE(s.seq_scan, 0) + COALESCE(s.idx_scan, 0)
          ELSE NULL
        END::bigint AS read_count
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
      WHERE ${POSTGRES_RELATION_FILTER}
      ORDER BY n.nspname, c.relname
      LIMIT $1`;
}

export const POSTGRES_RECOVERY_SQL: string =
  "SELECT pg_catalog.pg_is_in_recovery() AS in_recovery";

/*
 * The counters count since the database's statistics were reset; a restart
 * before PostgreSQL 15 lost them too, so the later of the two.
 */
export const POSTGRES_STATS_RESET_SQL: string = `SELECT EXTRACT(EPOCH FROM (now() - GREATEST(COALESCE(d.stats_reset, pg_catalog.pg_postmaster_start_time()), pg_catalog.pg_postmaster_start_time())))::bigint AS seconds
          FROM pg_catalog.pg_stat_database d WHERE d.datname = pg_catalog.current_database()`;

// Every column of every relation listed, at most $1 of them.
export const POSTGRES_COLUMNS_SQL: string = `SELECT n.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          NOT a.attnotnull AS is_nullable, a.attnum AS ordinal_position
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attnum > 0 AND NOT a.attisdropped
          AND ${POSTGRES_RELATION_FILTER}
        ORDER BY n.nspname, c.relname, a.attnum
        LIMIT $1`;

/*
 * A view's tables, PostgreSQL's and Redshift's alike: its rewrite rule
 * depends on each table and view it selects from (pg_depend). A Redshift
 * late-binding view (WITH NO SCHEMA BINDING) records none. At most $1.
 */
export function getPostgresViewLineageSql(schemaFilter: string): string {
  return `SELECT DISTINCT sn.nspname AS upstream_schema, sc.relname AS upstream_table,
      vn.nspname AS downstream_schema, vc.relname AS downstream_table
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class vc ON vc.oid = r.ev_class
    JOIN pg_catalog.pg_namespace vn ON vn.oid = vc.relnamespace
    JOIN pg_catalog.pg_class sc ON sc.oid = d.refobjid
    JOIN pg_catalog.pg_namespace sn ON sn.oid = sc.relnamespace
    WHERE vc.relkind IN ('v', 'm')
      AND sc.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND sc.oid <> vc.oid
      AND vn.nspname ${schemaFilter}
      AND vn.nspname NOT LIKE 'pg\\_%'
    ORDER BY 3, 4, 1, 2
    LIMIT $1`;
}

export const POSTGRES_VIEW_LINEAGE_SQL: string = getPostgresViewLineageSql(
  "NOT IN ('pg_catalog', 'information_schema')",
);

// Half of its connections working at once is a server a check should leave alone.
export const POSTGRES_BUSY_SQL: string = `SELECT COUNT(*) FILTER (WHERE state = 'active' AND pid <> pg_catalog.pg_backend_pid()) AS active,
        pg_catalog.current_setting('max_connections')::int AS max_connections
       FROM pg_catalog.pg_stat_activity`;

export const MYSQL_SCHEMA_FILTER: string = `NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')`;

// Every table and view of the session's database, at most ? of them.
export const MYSQL_TABLES_SQL: string = `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
          TABLE_ROWS AS estimated_rows,
          CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) ELSE NULL END AS size_bytes,
          CASE WHEN UPDATE_TIME IS NULL THEN NULL ELSE TIMESTAMPDIFF(SECOND, UPDATE_TIME, NOW()) END AS seconds_since_change
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA ${MYSQL_SCHEMA_FILTER}
          AND (DATABASE() IS NULL OR TABLE_SCHEMA = DATABASE())
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        LIMIT ?`;

// Each table's write and read counters, from performance_schema.
export const MYSQL_COUNTERS_SQL: string = `SELECT OBJECT_SCHEMA AS table_schema, OBJECT_NAME AS table_name,
            COUNT_INSERT + COUNT_UPDATE + COUNT_DELETE AS write_count,
            COUNT_READ AS read_count
          FROM performance_schema.table_io_waits_summary_by_table
          WHERE OBJECT_TYPE = 'TABLE'
            AND OBJECT_SCHEMA ${MYSQL_SCHEMA_FILTER}
            AND (DATABASE() IS NULL OR OBJECT_SCHEMA = DATABASE())`;

// performance_schema counts since the server started.
export const MYSQL_UPTIME_SQL: string = `SELECT VARIABLE_VALUE AS seconds FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime'`;

// Every column of every table listed, at most ? of them.
export const MYSQL_COLUMNS_SQL: string = `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
          COLUMN_TYPE AS data_type, IS_NULLABLE AS is_nullable, ORDINAL_POSITION AS ordinal_position
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA ${MYSQL_SCHEMA_FILTER}
          AND (DATABASE() IS NULL OR TABLE_SCHEMA = DATABASE())
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        LIMIT ?`;

// Each view's tables (MySQL 8.0.13 and later; MariaDB keeps none), at most ?.
export const MYSQL_VIEW_LINEAGE_SQL: string = `SELECT VIEW_SCHEMA AS downstream_schema, VIEW_NAME AS downstream_table,
            TABLE_SCHEMA AS upstream_schema, TABLE_NAME AS upstream_table
          FROM information_schema.VIEW_TABLE_USAGE
          WHERE VIEW_SCHEMA ${MYSQL_SCHEMA_FILTER}
            AND (DATABASE() IS NULL OR VIEW_SCHEMA = DATABASE())
          ORDER BY VIEW_SCHEMA, VIEW_NAME, TABLE_SCHEMA, TABLE_NAME
          LIMIT ?`;

export const MYSQL_THREADS_RUNNING_SQL: string =
  "SHOW GLOBAL STATUS LIKE 'Threads_running'";
export const MYSQL_MAX_CONNECTIONS_SQL: string =
  "SELECT @@max_connections AS max_connections";

/*
 * ---------------------------------------------------------------------------
 * A check
 * ---------------------------------------------------------------------------
 */

export interface DatabaseAgentStatement {
  sql: string;
  // In order, for the engine's placeholders: $1 (PostgreSQL), ? (MySQL).
  params: Array<string>;
  // Whether the statement reads one row per segment.
  isSegmented: boolean;
}

// A name as the engine quotes one: a name is data, never SQL.
export function quoteDatabaseAgentIdentifier(
  engine: DatabaseAgentEngine,
  name: string,
): string {
  if (
    !name ||
    name.length > DATABASE_AGENT_MAX_IDENTIFIER_LENGTH ||
    name.includes("\u0000")
  ) {
    throw new DatabaseAgentRefusal(
      `"${name.slice(0, 50)}" is not a name a check can read.`,
    );
  }

  return engine === "mysql"
    ? `\`${name.replace(/`/g, "``")}\``
    : `"${name.replace(/"/g, '""')}"`;
}

// MySQL's schema is its database; the session's database is the store's.
export function getDatabaseAgentTableReference(
  engine: DatabaseAgentEngine,
  schemaName: string,
  tableName: string,
): string {
  return schemaName
    ? `${quoteDatabaseAgentIdentifier(engine, schemaName)}.${quoteDatabaseAgentIdentifier(engine, tableName)}`
    : quoteDatabaseAgentIdentifier(engine, tableName);
}

function placeholder(engine: DatabaseAgentEngine, index: number): string {
  return engine === "mysql" ? "?" : `$${index}`;
}

function asText(engine: DatabaseAgentEngine, expression: string): string {
  return engine === "mysql"
    ? `CAST(${expression} AS CHAR)`
    : `CAST(${expression} AS TEXT)`;
}

function asNumber(engine: DatabaseAgentEngine, expression: string): string {
  return engine === "mysql"
    ? `(${expression}) + 0`
    : `CAST(${expression} AS DOUBLE PRECISION)`;
}

function requireColumn(check: DatabaseAgentCheck): string {
  if (!check.columnName) {
    throw new DatabaseAgentRefusal(`A ${check.type} check needs a column.`);
  }

  return check.columnName;
}

// The rows an Invalid Percent or a Format Mismatch Percent check counts.
function violation(
  engine: DatabaseAgentEngine,
  check: DatabaseAgentCheck,
  params: Array<string>,
): string {
  const column: string = quoteDatabaseAgentIdentifier(
    engine,
    requireColumn(check),
  );

  if (check.type === DataCheckType.InvalidPercent) {
    const values: Array<string> = (check.acceptedValues || [])
      .filter((value: string) => {
        return typeof value === "string";
      })
      .slice(0, MAX_ACCEPTED_VALUES);

    if (values.length === 0) {
      throw new DatabaseAgentRefusal(
        "An Invalid Percent check needs at least one accepted value.",
      );
    }

    const placeholders: Array<string> = values.map((value: string) => {
      params.push(value.slice(0, DATABASE_AGENT_MAX_VALUE_LENGTH));
      return placeholder(engine, params.length);
    });

    return `${column} IS NOT NULL AND ${asText(engine, column)} NOT IN (${placeholders.join(", ")})`;
  }

  const pattern: string = (check.pattern || "").slice(
    0,
    DATABASE_AGENT_MAX_PATTERN_LENGTH,
  );

  if (!pattern) {
    throw new DatabaseAgentRefusal(
      "A Format Mismatch Percent check needs a pattern.",
    );
  }

  params.push(pattern);

  const mismatch: string =
    engine === "mysql"
      ? `${asText(engine, column)} NOT REGEXP ${placeholder(engine, params.length)}`
      : `${asText(engine, column)} !~ ${placeholder(engine, params.length)}`;

  return `${column} IS NOT NULL AND ${mismatch}`;
}

/*
 * Reading a share of a table's rows, the engine's own way: PostgreSQL skips
 * whole pages; MySQL has only a filter on a random number.
 */
function sampleOf(
  engine: DatabaseAgentEngine,
  table: string,
  percent: number | null | undefined,
): { from: string; where?: string | undefined } {
  if (!percent || percent <= 0 || percent >= 100) {
    return { from: table };
  }

  return engine === "mysql"
    ? { from: table, where: `RAND() < ${percent / 100}` }
    : { from: `${table} TABLESAMPLE SYSTEM (${percent})` };
}

// A value of the check's own: one aggregate over the table's rows.
function valueExpression(
  engine: DatabaseAgentEngine,
  check: DatabaseAgentCheck,
  params: Array<string>,
): string {
  if (check.type === DataCheckType.RowCount) {
    return "COUNT(*)";
  }

  const column: string = quoteDatabaseAgentIdentifier(
    engine,
    requireColumn(check),
  );

  switch (check.type) {
    case DataCheckType.NullPercent:
      return `100.0 * SUM(CASE WHEN ${column} IS NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)`;
    case DataCheckType.DuplicatePercent:
      return `100.0 * (COUNT(${column}) - COUNT(DISTINCT ${column})) / NULLIF(COUNT(${column}), 0)`;
    case DataCheckType.DistinctCount:
      return `COUNT(DISTINCT ${column})`;
    case DataCheckType.Minimum:
      return asNumber(engine, `MIN(${column})`);
    case DataCheckType.Maximum:
      return asNumber(engine, `MAX(${column})`);
    case DataCheckType.Average:
      return `AVG(${asNumber(engine, column)})`;
    // No rows add up to 0, so a sum is never empty: a reconciliation compares it.
    case DataCheckType.Sum:
      return `COALESCE(SUM(${asNumber(engine, column)}), 0)`;
    case DataCheckType.InvalidPercent:
    case DataCheckType.FormatMismatchPercent:
      return `100.0 * SUM(CASE WHEN ${violation(engine, check, params)} THEN 1 ELSE 0 END) / NULLIF(COUNT(${column}), 0)`;
    default:
      throw new DatabaseAgentRefusal(
        `${check.type} is not a check on one column.`,
      );
  }
}

// The rows of an Orphan Count check: a value with no row to refer to.
function orphansOf(
  engine: DatabaseAgentEngine,
  check: DatabaseAgentCheck,
  table: string,
): { from: string; where: string } {
  const column: string = quoteDatabaseAgentIdentifier(
    engine,
    requireColumn(check),
  );

  if (!check.referenceTableName || !check.referenceColumnName) {
    throw new DatabaseAgentRefusal(
      "An Orphan Count check needs the table and column it refers to.",
    );
  }

  const reference: string = getDatabaseAgentTableReference(
    engine,
    check.referenceSchemaName || "",
    check.referenceTableName,
  );
  const referenceColumn: string = quoteDatabaseAgentIdentifier(
    engine,
    check.referenceColumnName,
  );

  return {
    from: `${table} AS checked LEFT JOIN ${reference} AS referenced ON checked.${column} = referenced.${referenceColumn}`,
    where: `checked.${column} IS NOT NULL AND referenced.${referenceColumn} IS NULL`,
  };
}

function withSegments(data: {
  engine: DatabaseAgentEngine;
  value: string;
  from: string;
  where?: string | undefined;
  segment: string;
}): string {
  const where: string = data.where ? ` WHERE ${data.where}` : "";

  return `SELECT ${asText(data.engine, data.segment)} AS segment, ${data.value} AS value FROM ${data.from}${where} GROUP BY ${data.segment} ORDER BY COUNT(*) DESC LIMIT ${MAX_SEGMENTS_PER_CHECK}`;
}

// A custom query reads: it starts with SELECT or WITH.
const READ_START: RegExp = /^\s*(select|with)\b/i;

// Words a read never needs: each changes data, or runs something that could.
const WRITE_WORDS: RegExp =
  /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|call|copy|into)\b/i;

/*
 * A custom query must be one SELECT (or WITH): no second statement after a
 * semicolon outside a string, and none of the words that change data. The
 * read-only transaction it runs in is what stops a write; this says why a
 * query was refused before it is sent. The same rule the server reads a
 * query by when it is saved (DataCheckSql.checkCustomSql).
 */
export function checkDatabaseAgentCustomSql(value: string): string {
  const sql: string = value.trim().replace(/;\s*$/, "");

  if (!sql) {
    throw new DatabaseAgentRefusal("Write the query the check runs.");
  }

  if (sql.length > DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH) {
    throw new DatabaseAgentRefusal(
      `The query is longer than ${DATABASE_AGENT_MAX_CUSTOM_SQL_LENGTH} characters.`,
    );
  }

  const withoutStrings: string = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  if (withoutStrings.includes(";")) {
    throw new DatabaseAgentRefusal(
      "The query must be one statement: nothing after a semicolon.",
    );
  }

  if (!READ_START.test(withoutStrings)) {
    throw new DatabaseAgentRefusal(
      "The query must read: start it with SELECT or WITH.",
    );
  }

  if (WRITE_WORDS.test(withoutStrings)) {
    throw new DatabaseAgentRefusal(
      "The query may only read: it holds a word that changes data or runs something.",
    );
  }

  return sql;
}

/*
 * The one statement a check runs, built on the agent. A Custom SQL or a
 * Failing Rows check is built only when the agent's owner allows Custom SQL;
 * every other type is one of the fixed shapes above, its names quoted and
 * its values bound. What it reads is judged against the catalog first
 * (getDatabaseAgentCheckRefusal).
 */
export function buildDatabaseAgentCheckStatement(
  engine: DatabaseAgentEngine,
  check: DatabaseAgentCheck,
  options: { allowsCustomSql: boolean },
): DatabaseAgentStatement {
  const params: Array<string> = [];
  const table: string = getDatabaseAgentTableReference(
    engine,
    check.schemaName,
    check.tableName,
  );
  const segment: string | null = check.segmentColumn
    ? quoteDatabaseAgentIdentifier(engine, check.segmentColumn)
    : null;

  if (isQueryCheckType(check.type) && !options.allowsCustomSql) {
    throw new DatabaseAgentRefusal(CUSTOM_SQL_OFF_REFUSAL);
  }

  // A query's rows are the failures: they are counted, and only the count is read.
  if (check.type === DataCheckType.FailingRows) {
    return {
      sql: `SELECT COUNT(*) AS ${DATABASE_AGENT_VALUE_ALIAS} FROM (${checkDatabaseAgentCustomSql(check.customSql || "")}) AS oneuptime_check`,
      params,
      isSegmented: false,
    };
  }

  if (check.type === DataCheckType.CustomSql) {
    const sql: string = checkDatabaseAgentCustomSql(check.customSql || "");

    return {
      sql: `SELECT * FROM (${sql}) AS oneuptime_check LIMIT ${MAX_SEGMENTS_PER_CHECK}`,
      params,
      isSegmented: Boolean(check.segmentColumn),
    };
  }

  if (check.type === DataCheckType.OrphanCount) {
    const { from, where }: { from: string; where: string } = orphansOf(
      engine,
      check,
      table,
    );

    if (segment) {
      return {
        sql: withSegments({
          engine,
          value: "COUNT(*)",
          from,
          where,
          segment: `checked.${segment}`,
        }),
        params,
        isSegmented: true,
      };
    }

    return {
      sql: `SELECT COUNT(*) AS ${DATABASE_AGENT_VALUE_ALIAS} FROM ${from} WHERE ${where}`,
      params,
      isSegmented: false,
    };
  }

  const value: string = valueExpression(engine, check, params);
  const { from, where }: { from: string; where?: string | undefined } =
    sampleOf(
      engine,
      table,
      isSampleableCheckType(check.type) ? check.samplePercent : null,
    );

  if (segment) {
    return {
      sql: withSegments({ engine, value, from, where, segment }),
      params,
      isSegmented: true,
    };
  }

  return {
    sql: `SELECT ${value} AS ${DATABASE_AGENT_VALUE_ALIAS} FROM ${from}${where ? ` WHERE ${where}` : ""}`,
    params,
    isSegmented: false,
  };
}

/*
 * The newest value of a table's freshness column: the time its data says it
 * was last written, for a table whose catalog cannot say.
 */
export function buildDatabaseAgentFreshnessStatement(
  engine: DatabaseAgentEngine,
  read: Pick<
    DatabaseAgentFreshnessRead,
    "schemaName" | "tableName" | "columnName"
  >,
): { sql: string; params: Array<string> } {
  return {
    sql: `SELECT MAX(${quoteDatabaseAgentIdentifier(engine, read.columnName)}) AS ${DATABASE_AGENT_VALUE_ALIAS} FROM ${getDatabaseAgentTableReference(engine, read.schemaName, read.tableName)}`,
    params: [],
  };
}

/*
 * ---------------------------------------------------------------------------
 * Judged against the catalog the agent has just read
 * ---------------------------------------------------------------------------
 */

// The catalog as a check is judged against: each table's columns, by "schema\u0000table".
export type DatabaseAgentCatalog = Map<string, Set<string> | null>;

export function getDatabaseAgentCatalogKey(
  schemaName: string,
  tableName: string,
): string {
  return `${schemaName}\u0000${tableName}`;
}

function describeTable(schemaName: string, tableName: string): string {
  return schemaName ? `${schemaName}.${tableName}` : tableName;
}

/*
 * Why a check may not run here, or null when it may: every table it reads
 * is one this collection listed, and every column one that table has. A
 * table whose column list was cut (null) is read by name only. A Custom
 * SQL or Failing Rows check names no table it is held to: it runs only
 * where Custom SQL is allowed, and is refused otherwise.
 */
export function getDatabaseAgentCheckRefusal(
  check: DatabaseAgentCheck,
  catalog: DatabaseAgentCatalog,
  options: { allowsCustomSql: boolean },
): string | null {
  if (isQueryCheckType(check.type)) {
    return options.allowsCustomSql ? null : CUSTOM_SQL_OFF_REFUSAL;
  }

  const tableKey: string = getDatabaseAgentCatalogKey(
    check.schemaName,
    check.tableName,
  );

  if (!catalog.has(tableKey)) {
    return `The table ${describeTable(check.schemaName, check.tableName)} is not in this database's catalog as the Database Agent read it, so the check was not run.`;
  }

  const columns: Set<string> | null = catalog.get(tableKey) || null;
  const named: Array<string | null> = [
    isColumnCheckType(check.type) ? check.columnName : null,
    check.segmentColumn,
  ];

  for (const column of named) {
    if (column && columns && !columns.has(column)) {
      return `The column ${column} is not in ${describeTable(check.schemaName, check.tableName)} as the Database Agent read it, so the check was not run.`;
    }
  }

  if (check.type === DataCheckType.OrphanCount) {
    if (!check.referenceTableName || !check.referenceColumnName) {
      return "An Orphan Count check needs the table and column it refers to.";
    }

    const referenceKey: string = getDatabaseAgentCatalogKey(
      check.referenceSchemaName || "",
      check.referenceTableName,
    );

    if (!catalog.has(referenceKey)) {
      return `The table ${describeTable(check.referenceSchemaName || "", check.referenceTableName)} is not in this database's catalog as the Database Agent read it, so the check was not run.`;
    }

    const referenceColumns: Set<string> | null =
      catalog.get(referenceKey) || null;

    if (
      referenceColumns &&
      !referenceColumns.has(check.referenceColumnName)
    ) {
      return `The column ${check.referenceColumnName} is not in ${describeTable(check.referenceSchemaName || "", check.referenceTableName)} as the Database Agent read it, so the check was not run.`;
    }
  }

  return null;
}

// Why a freshness column may not be read, or null when it may.
export function getDatabaseAgentFreshnessRefusal(
  read: DatabaseAgentFreshnessRead,
  catalog: DatabaseAgentCatalog,
): string | null {
  const tableKey: string = getDatabaseAgentCatalogKey(
    read.schemaName,
    read.tableName,
  );

  if (!catalog.has(tableKey)) {
    return `The table ${describeTable(read.schemaName, read.tableName)} is not in this database's catalog as the Database Agent read it.`;
  }

  const columns: Set<string> | null = catalog.get(tableKey) || null;

  if (columns && !columns.has(read.columnName)) {
    return `The column ${read.columnName} is not in ${describeTable(read.schemaName, read.tableName)} as the Database Agent read it.`;
  }

  return null;
}
