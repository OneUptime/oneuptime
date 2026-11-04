import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DataCheckType,
  FAILING_ROW_CHECK_TYPES,
  isSampleableCheckType,
  MAX_ACCEPTED_VALUES,
  MAX_FAILING_ROWS,
  MAX_SEGMENTS_PER_CHECK,
} from "../../../Types/DataObservability/DataCheckType";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";
import {
  buildMongoCheckStatement,
  buildMongoLatestStatement,
} from "./MongoDbChecks";

/*
 * THE ONE STATEMENT A DATA CHECK RUNS.
 *
 * Every check is a single aggregate over one table - grouped by a column
 * when it has a segment - so only numbers leave the database, never a row.
 * The one exception is a project's own choice: it can keep a masked sample of
 * failing rows (buildDataCheckSampleStatement).
 * Names are quoted the engine's way (a name is data, never SQL); values a
 * check compares with (accepted values, a pattern) are bound parameters.
 * Custom SQL is the person's own read, wrapped so that it can only be read
 * from, in a read-only transaction with a statement timeout
 * (DataCheckRunner).
 */

export interface DataCheckTarget {
  type: DataCheckType;
  schemaName: string;
  tableName: string;
  columnName?: string | null | undefined;
  segmentColumn?: string | null | undefined;
  acceptedValues?: Array<string> | null | undefined;
  pattern?: string | null | undefined;
  referenceSchemaName?: string | null | undefined;
  referenceTableName?: string | null | undefined;
  referenceColumnName?: string | null | undefined;
  customSql?: string | null | undefined;
  // Read this percent of the rows instead of all of them.
  samplePercent?: number | null | undefined;
}

export interface DataCheckStatement {
  sql: string;
  /*
   * In order, for the engine's placeholders: $1 (PostgreSQL), ? (MySQL,
   * Snowflake, BigQuery), @p0 (SQL Server), {p1:String} (ClickHouse), :p1
   * (Databricks).
   */
  params: Array<string>;
  // Whether the statement reads one row per segment.
  isSegmented: boolean;
}

// The longest custom query kept.
export const MAX_CUSTOM_SQL_LENGTH: number = 10_000;

const MAX_PATTERN_LENGTH: number = 500;

// A custom query reads: it starts with SELECT or WITH.
const READ_START: RegExp = /^\s*(select|with)\b/i;

// Words a read never needs: each changes data, or runs something that could.
const WRITE_WORDS: RegExp =
  /\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|call|copy|into)\b/i;
const MAX_ACCEPTED_VALUE_LENGTH: number = 500;

export function quoteIdentifier(engine: DatabaseEngine, name: string): string {
  if (!name || name.length > 240 || name.includes("\u0000")) {
    throw new BadDataException(
      `"${name.slice(0, 50)}" is not a name a check can read.`,
    );
  }

  switch (engine) {
    case "mysql":
    case "databricks":
      return `\`${name.replace(/`/g, "``")}\``;
    case "bigquery":
    case "clickhouse":
      return `\`${name.replace(/[`\\]/g, "\\$&")}\``;
    case "sqlserver":
      return `[${name.replace(/\]/g, "]]")}]`;
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

export function tableReference(
  engine: DatabaseEngine,
  schemaName: string,
  tableName: string,
): string {
  // MySQL's schema is its database; the session's database is the store's.
  return schemaName
    ? `${quoteIdentifier(engine, schemaName)}.${quoteIdentifier(engine, tableName)}`
    : quoteIdentifier(engine, tableName);
}

/*
 * A table's alias: Oracle takes none of AS before one, and VALUE is one of
 * its words, so its value column is named in quotes.
 */
function aliasOf(engine: DatabaseEngine, name: string): string {
  return engine === "oracle" ? ` ${name}` : ` AS ${name}`;
}

function valueAlias(engine: DatabaseEngine): string {
  return engine === "oracle" ? '"value"' : "value";
}

function placeholder(engine: DatabaseEngine, index: number): string {
  switch (engine) {
    // MySQL, Snowflake's SQL API and BigQuery's bind by position; Athena's are written in, quoted (AthenaApi).
    case "mysql":
    case "snowflake":
    case "bigquery":
    case "athena":
      return "?";
    case "sqlserver":
      // The session binds @p0, @p1, ... (TableHealthCollector).
      return `@p${index - 1}`;
    // Query parameters of the HTTP interface (ClickHouseHttpApi).
    case "clickhouse":
      return `{p${index}:String}`;
    // Named parameters of the SQL Statement Execution API (DatabricksApi).
    case "databricks":
      return `:p${index}`;
    // The oracledb driver binds :1, :2, ... by position.
    case "oracle":
      return `:${index}`;
    default:
      return `$${index}`;
  }
}

function asText(engine: DatabaseEngine, expression: string): string {
  switch (engine) {
    case "mysql":
      return `CAST(${expression} AS CHAR)`;
    case "sqlserver":
      return `CAST(${expression} AS NVARCHAR(4000))`;
    case "bigquery":
    case "databricks":
      return `CAST(${expression} AS STRING)`;
    case "athena":
      return `CAST(${expression} AS VARCHAR)`;
    case "oracle":
      return `CAST(${expression} AS VARCHAR2(4000))`;
    // A NULL stays NULL: CAST to String would refuse it.
    case "clickhouse":
      return `toString(${expression})`;
    default:
      return `CAST(${expression} AS TEXT)`;
  }
}

function asNumber(engine: DatabaseEngine, expression: string): string {
  switch (engine) {
    case "mysql":
      return `(${expression}) + 0`;
    case "sqlserver":
      return `CAST(${expression} AS FLOAT)`;
    case "bigquery":
      return `CAST(${expression} AS FLOAT64)`;
    case "databricks":
    case "athena":
      return `CAST(${expression} AS DOUBLE)`;
    case "oracle":
      return `CAST(${expression} AS BINARY_DOUBLE)`;
    case "clickhouse":
      return `toFloat64(${expression})`;
    default:
      return `CAST(${expression} AS DOUBLE PRECISION)`;
  }
}

function requireColumn(target: DataCheckTarget): string {
  if (!target.columnName) {
    throw new BadDataException(`A ${target.type} check needs a column.`);
  }

  return target.columnName;
}

/*
 * The rows an Invalid Percent or a Format Mismatch Percent check counts: what
 * its percentage adds up, and what a sample of its failing rows selects.
 */
function violation(
  engine: DatabaseEngine,
  target: DataCheckTarget,
  params: Array<string>,
): string {
  const column: string = quoteIdentifier(engine, requireColumn(target));

  if (target.type === DataCheckType.InvalidPercent) {
    const values: Array<string> = (target.acceptedValues || [])
      .filter((value: string) => {
        return typeof value === "string";
      })
      .slice(0, MAX_ACCEPTED_VALUES);

    if (values.length === 0) {
      throw new BadDataException(
        "An Invalid Percent check needs at least one accepted value.",
      );
    }

    const placeholders: Array<string> = values.map((value: string) => {
      params.push(value.slice(0, MAX_ACCEPTED_VALUE_LENGTH));
      return placeholder(engine, params.length);
    });

    return `${column} IS NOT NULL AND ${asText(engine, column)} NOT IN (${placeholders.join(", ")})`;
  }

  const pattern: string = (target.pattern || "").slice(0, MAX_PATTERN_LENGTH);

  if (!pattern) {
    throw new BadDataException(
      "A Format Mismatch Percent check needs a pattern.",
    );
  }

  if (engine === "sqlserver") {
    throw new BadDataException(
      "SQL Server has no regular expressions: use an Invalid Percent check, or Custom SQL with LIKE.",
    );
  }

  params.push(pattern);

  const mismatch: string =
    engine === "mysql"
      ? `${asText(engine, column)} NOT REGEXP ${placeholder(engine, params.length)}`
      : engine === "snowflake"
        ? // REGEXP_LIKE matches the whole value; the others search it.
          `REGEXP_INSTR(${asText(engine, column)}, ${placeholder(engine, params.length)}) = 0`
        : engine === "bigquery"
          ? `NOT REGEXP_CONTAINS(${asText(engine, column)}, ${placeholder(engine, params.length)})`
          : engine === "clickhouse"
            ? `NOT match(${asText(engine, column)}, ${placeholder(engine, params.length)})`
            : engine === "databricks"
              ? `NOT (${asText(engine, column)} RLIKE ${placeholder(engine, params.length)})`
              : engine === "athena" || engine === "oracle"
                ? `NOT ${engine === "oracle" ? "REGEXP_LIKE" : "regexp_like"}(${asText(engine, column)}, ${placeholder(engine, params.length)})`
                : `${asText(engine, column)} !~ ${placeholder(engine, params.length)}`;

  return `${column} IS NOT NULL AND ${mismatch}`;
}

/*
 * Reading a share of a table's rows, the engine's own way. Where it can skip
 * whole pages of a table it does, which is what makes this cheaper; MySQL,
 * Redshift and ClickHouse have only a filter on a random number, which spares
 * the work on the rows but still reads them. A view takes only the filter's
 * kind of sampling on some engines, and refuses the others: its check says so.
 */
function sampleOf(
  engine: DatabaseEngine,
  table: string,
  percent: number | null | undefined,
): { from: string; where?: string | undefined } {
  if (!percent || percent <= 0 || percent >= 100) {
    return { from: table };
  }

  switch (engine) {
    case "postgresql":
      return { from: `${table} TABLESAMPLE SYSTEM (${percent})` };
    case "sqlserver":
    case "databricks":
      return { from: `${table} TABLESAMPLE (${percent} PERCENT)` };
    case "oracle":
      return { from: `${table} SAMPLE (${percent})` };
    case "snowflake":
      return { from: `${table} SAMPLE BERNOULLI (${percent})` };
    case "bigquery":
      return { from: `${table} TABLESAMPLE SYSTEM (${percent} PERCENT)` };
    case "athena":
      return { from: `${table} TABLESAMPLE BERNOULLI (${percent})` };
    case "mysql":
      return { from: table, where: `RAND() < ${percent / 100}` };
    case "clickhouse":
      return {
        from: table,
        where: `rand() % 10000 < ${Math.round(percent * 100)}`,
      };
    default:
      return { from: table, where: `RANDOM() < ${percent / 100}` };
  }
}

// A value of the check's own: one aggregate over the table's rows.
function valueExpression(
  engine: DatabaseEngine,
  target: DataCheckTarget,
  params: Array<string>,
): string {
  if (target.type === DataCheckType.RowCount) {
    return "COUNT(*)";
  }

  const column: string = quoteIdentifier(engine, requireColumn(target));

  switch (target.type) {
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
      return `100.0 * SUM(CASE WHEN ${violation(engine, target, params)} THEN 1 ELSE 0 END) / NULLIF(COUNT(${column}), 0)`;
    default:
      throw new BadDataException(
        `${target.type} is not a check on one column.`,
      );
  }
}

// The rows of an Orphan Count check: a value with no row to refer to.
function orphansOf(
  engine: DatabaseEngine,
  target: DataCheckTarget,
  table: string,
): { from: string; where: string } {
  const column: string = quoteIdentifier(engine, requireColumn(target));

  if (!target.referenceTableName || !target.referenceColumnName) {
    throw new BadDataException(
      "An Orphan Count check needs the table and column it refers to.",
    );
  }

  const reference: string = tableReference(
    engine,
    target.referenceSchemaName || "",
    target.referenceTableName,
  );
  const referenceColumn: string = quoteIdentifier(
    engine,
    target.referenceColumnName,
  );

  /*
   * ClickHouse fills a LEFT JOIN's missing side with default values, not
   * NULL, so a value with no row to refer to is one NOT IN the other's.
   */
  return engine === "clickhouse"
    ? {
        from: `${table} AS checked`,
        where: `checked.${column} IS NOT NULL AND checked.${column} NOT IN (SELECT ${referenceColumn} FROM ${reference})`,
      }
    : {
        from: `${table}${aliasOf(engine, "checked")} LEFT JOIN ${reference}${aliasOf(engine, "referenced")} ON checked.${column} = referenced.${referenceColumn}`,
        where: `checked.${column} IS NOT NULL AND referenced.${referenceColumn} IS NULL`,
      };
}

function withSegments(data: {
  engine: DatabaseEngine;
  value: string;
  from: string;
  where?: string | undefined;
  segment: string;
}): string {
  const where: string = data.where ? ` WHERE ${data.where}` : "";
  const segmentText: string = asText(data.engine, data.segment);

  if (data.engine === "sqlserver") {
    return `SELECT TOP ${MAX_SEGMENTS_PER_CHECK} ${segmentText} AS segment, ${data.value} AS value FROM ${data.from}${where} GROUP BY ${data.segment} ORDER BY COUNT(*) DESC`;
  }

  if (data.engine === "oracle") {
    return `SELECT ${segmentText} AS "segment", ${data.value} AS "value" FROM ${data.from}${where} GROUP BY ${data.segment} ORDER BY COUNT(*) DESC FETCH FIRST ${MAX_SEGMENTS_PER_CHECK} ROWS ONLY`;
  }

  return `SELECT ${segmentText} AS segment, ${data.value} AS value FROM ${data.from}${where} GROUP BY ${data.segment} ORDER BY COUNT(*) DESC LIMIT ${MAX_SEGMENTS_PER_CHECK}`;
}

/*
 * A custom query must be one SELECT (or WITH): no second statement after a
 * semicolon outside a string, and none of the words that change data. The
 * read-only transaction it runs in is what stops a write; this only says
 * why a query was refused before it is sent.
 */
export function checkCustomSql(value: string): string {
  const sql: string = value.trim().replace(/;\s*$/, "");

  if (!sql) {
    throw new BadDataException("Custom SQL needs a query.");
  }

  if (sql.length > MAX_CUSTOM_SQL_LENGTH) {
    throw new BadDataException("Custom SQL is too long.");
  }

  const withoutStrings: string = sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  if (withoutStrings.includes(";")) {
    throw new BadDataException("Custom SQL must be a single query.");
  }

  if (!READ_START.test(withoutStrings)) {
    throw new BadDataException("Custom SQL must start with SELECT or WITH.");
  }

  if (WRITE_WORDS.test(withoutStrings)) {
    throw new BadDataException("Custom SQL may only read.");
  }

  return sql;
}

export function buildDataCheckStatement(
  engine: DatabaseEngine,
  target: DataCheckTarget,
): DataCheckStatement {
  // MongoDB has no SQL: an aggregation pipeline (MongoDbChecks).
  if (engine === "mongodb") {
    return buildMongoCheckStatement(target);
  }

  const params: Array<string> = [];
  const table: string = tableReference(
    engine,
    target.schemaName,
    target.tableName,
  );
  const segment: string | null = target.segmentColumn
    ? quoteIdentifier(engine, target.segmentColumn)
    : null;

  // A query's rows are the failures: they are counted, and only the count is read.
  if (target.type === DataCheckType.FailingRows) {
    return {
      sql: `SELECT COUNT(*) AS ${valueAlias(engine)} FROM (${checkCustomSql(target.customSql || "")})${aliasOf(engine, "oneuptime_check")}`,
      params,
      isSegmented: false,
    };
  }

  if (target.type === DataCheckType.CustomSql) {
    const sql: string = checkCustomSql(target.customSql || "");
    const limit: string =
      engine === "sqlserver"
        ? `SELECT TOP ${MAX_SEGMENTS_PER_CHECK} * FROM (${sql}) AS oneuptime_check`
        : engine === "oracle"
          ? `SELECT * FROM (${sql}) oneuptime_check FETCH FIRST ${MAX_SEGMENTS_PER_CHECK} ROWS ONLY`
          : `SELECT * FROM (${sql}) AS oneuptime_check LIMIT ${MAX_SEGMENTS_PER_CHECK}`;

    return { sql: limit, params, isSegmented: Boolean(target.segmentColumn) };
  }

  if (target.type === DataCheckType.OrphanCount) {
    const { from, where }: { from: string; where: string } = orphansOf(
      engine,
      target,
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
      sql: `SELECT COUNT(*) AS ${valueAlias(engine)} FROM ${from} WHERE ${where}`,
      params,
      isSegmented: false,
    };
  }

  const value: string = valueExpression(engine, target, params);
  const { from, where }: { from: string; where?: string | undefined } =
    sampleOf(
      engine,
      table,
      isSampleableCheckType(target.type) ? target.samplePercent : null,
    );

  if (segment) {
    return {
      sql: withSegments({ engine, value, from, where, segment }),
      params,
      isSegmented: true,
    };
  }

  return {
    sql: `SELECT ${value} AS ${valueAlias(engine)} FROM ${from}${where ? ` WHERE ${where}` : ""}`,
    params,
    isSegmented: false,
  };
}

function limited(data: {
  engine: DatabaseEngine;
  select: string;
  from: string;
  where?: string | undefined;
}): string {
  const where: string = data.where ? ` WHERE ${data.where}` : "";

  if (data.engine === "sqlserver") {
    return `SELECT TOP ${MAX_FAILING_ROWS} ${data.select} FROM ${data.from}${where}`;
  }

  if (data.engine === "oracle") {
    return `SELECT ${data.select} FROM ${data.from}${where} FETCH FIRST ${MAX_FAILING_ROWS} ROWS ONLY`;
  }

  return `SELECT ${data.select} FROM ${data.from}${where} LIMIT ${MAX_FAILING_ROWS}`;
}

/*
 * A few of the rows a check found failing, for a project that chose to keep
 * them, masked where they are read (DataCheckFailingRows). A check that
 * reads a rate names the failing column alone; a query's rows are whatever it
 * selects. None on MongoDB, whose checks end in a number by construction.
 */
export function buildDataCheckSampleStatement(
  engine: DatabaseEngine,
  target: DataCheckTarget,
): { sql: string; params: Array<string> } | null {
  if (engine === "mongodb" || !FAILING_ROW_CHECK_TYPES.includes(target.type)) {
    return null;
  }

  const params: Array<string> = [];

  if (target.type === DataCheckType.FailingRows) {
    return {
      sql: limited({
        engine,
        select: "*",
        from: `(${checkCustomSql(target.customSql || "")})${aliasOf(engine, "oneuptime_check")}`,
      }),
      params,
    };
  }

  const table: string = tableReference(
    engine,
    target.schemaName,
    target.tableName,
  );
  const column: string = quoteIdentifier(engine, requireColumn(target));

  if (target.type === DataCheckType.OrphanCount) {
    const { from, where }: { from: string; where: string } = orphansOf(
      engine,
      target,
      table,
    );

    return {
      sql: limited({ engine, select: `checked.${column}`, from, where }),
      params,
    };
  }

  return {
    sql: limited({
      engine,
      select: column,
      from: table,
      where: violation(engine, target, params),
    }),
    params,
  };
}

/*
 * The newest value of a table's freshness column: the time its data says it
 * was last written, for a table whose catalog cannot say or says it wrongly.
 */
export function buildFreshnessStatement(
  engine: DatabaseEngine,
  target: { schemaName: string; tableName: string; columnName: string },
): { sql: string; params: Array<string> } {
  if (engine === "mongodb") {
    return buildMongoLatestStatement(target);
  }

  return {
    sql: `SELECT MAX(${quoteIdentifier(engine, target.columnName)}) AS ${valueAlias(engine)} FROM ${tableReference(engine, target.schemaName, target.tableName)}`,
    params: [],
  };
}
