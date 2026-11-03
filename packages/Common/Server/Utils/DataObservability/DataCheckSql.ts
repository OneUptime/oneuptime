import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DataCheckType,
  MAX_ACCEPTED_VALUES,
  MAX_SEGMENTS_PER_CHECK,
} from "../../../Types/DataObservability/DataCheckType";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";

/*
 * THE ONE STATEMENT A DATA CHECK RUNS.
 *
 * Every check is a single aggregate over one table - grouped by a column
 * when it has a segment - so only numbers leave the database, never a row.
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
}

export interface DataCheckStatement {
  sql: string;
  // In order, for the engine's placeholders: $1 (PostgreSQL), ? (MySQL), @p0 (SQL Server).
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
      return `\`${name.replace(/`/g, "``")}\``;
    case "sqlserver":
      return `[${name.replace(/\]/g, "]]")}]`;
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

function tableReference(
  engine: DatabaseEngine,
  schemaName: string,
  tableName: string,
): string {
  // MySQL's schema is its database; the session's database is the store's.
  return schemaName
    ? `${quoteIdentifier(engine, schemaName)}.${quoteIdentifier(engine, tableName)}`
    : quoteIdentifier(engine, tableName);
}

function placeholder(engine: DatabaseEngine, index: number): string {
  switch (engine) {
    case "mysql":
      return "?";
    case "sqlserver":
      // The session binds @p0, @p1, ... (TableHealthCollector).
      return `@p${index - 1}`;
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
    case DataCheckType.InvalidPercent: {
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

      return `100.0 * SUM(CASE WHEN ${column} IS NOT NULL AND ${asText(engine, column)} NOT IN (${placeholders.join(", ")}) THEN 1 ELSE 0 END) / NULLIF(COUNT(${column}), 0)`;
    }
    case DataCheckType.FormatMismatchPercent: {
      const pattern: string = (target.pattern || "").slice(
        0,
        MAX_PATTERN_LENGTH,
      );

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
          : `${asText(engine, column)} !~ ${placeholder(engine, params.length)}`;

      return `100.0 * SUM(CASE WHEN ${column} IS NOT NULL AND ${mismatch} THEN 1 ELSE 0 END) / NULLIF(COUNT(${column}), 0)`;
    }
    default:
      throw new BadDataException(
        `${target.type} is not a check on one column.`,
      );
  }
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
  const params: Array<string> = [];
  const table: string = tableReference(
    engine,
    target.schemaName,
    target.tableName,
  );
  const segment: string | null = target.segmentColumn
    ? quoteIdentifier(engine, target.segmentColumn)
    : null;

  if (target.type === DataCheckType.CustomSql) {
    const sql: string = checkCustomSql(target.customSql || "");
    const limit: string =
      engine === "sqlserver"
        ? `SELECT TOP ${MAX_SEGMENTS_PER_CHECK} * FROM (${sql}) AS oneuptime_check`
        : `SELECT * FROM (${sql}) AS oneuptime_check LIMIT ${MAX_SEGMENTS_PER_CHECK}`;

    return { sql: limit, params, isSegmented: Boolean(target.segmentColumn) };
  }

  if (target.type === DataCheckType.OrphanCount) {
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
    const from: string = `${table} AS checked LEFT JOIN ${reference} AS referenced ON checked.${column} = referenced.${referenceColumn}`;
    const where: string = `checked.${column} IS NOT NULL AND referenced.${referenceColumn} IS NULL`;

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
      sql: `SELECT COUNT(*) AS value FROM ${from} WHERE ${where}`,
      params,
      isSegmented: false,
    };
  }

  const value: string = valueExpression(engine, target, params);

  if (segment) {
    return {
      sql: withSegments({ engine, value, from: table, segment }),
      params,
      isSegmented: true,
    };
  }

  return {
    sql: `SELECT ${value} AS value FROM ${table}`,
    params,
    isSegmented: false,
  };
}
