import {
  DataCheckType,
  MAX_SEGMENTS_PER_CHECK,
} from "../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
  DATABASE_AGENT_MAX_WARNINGS,
  DatabaseAgentCheckValue,
  DatabaseAgentColumn,
  DatabaseAgentEngine,
  DatabaseAgentLineageEdge,
  DatabaseAgentTable,
} from "./DatabaseAgentWork";
import { getDatabaseAgentCatalogKey } from "./DatabaseAgentStatements";

/*
 * WHAT A DATABASE AGENT MAKES OF THE ROWS ITS STATEMENTS RETURN: a catalog's
 * tables and columns, a check's numbers, a freshness column's newest time -
 * as OneUptime's workers and probes read the same rows
 * (Server/Utils/DataObservability/TableHealthCollector, DataCheckResults),
 * which DatabaseAgentStatementsParity holds. Pure, and copied byte for byte
 * into the agent.
 */

// The longest column name and type kept, as a table's columns are stored.
export const DATABASE_AGENT_MAX_COLUMN_NAME_LENGTH: number = 256;
export const DATABASE_AGENT_MAX_COLUMN_TYPE_LENGTH: number = 128;
// PostgreSQL allows 1,600 columns in a table; nothing real has more.
export const DATABASE_AGENT_MAX_COLUMNS_PER_TABLE: number = 1600;

// The segment a NULL segment value is reported as, and the longest one.
export const DATABASE_AGENT_EMPTY_SEGMENT: string = "(empty)";
export const DATABASE_AGENT_MAX_SEGMENT_LENGTH: number = 200;

// A whole, non-negative number, or null for anything else.
export function readDatabaseAgentCount(value: unknown): number | null {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim().length > 0
          ? Number(value)
          : NaN;

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return Math.floor(number);
}

export function readDatabaseAgentNumber(value: unknown): number | null {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim().length > 0
          ? Number(value)
          : NaN;

  return Number.isFinite(number) ? number : null;
}

export function readDatabaseAgentSegment(value: unknown): string {
  if (value === null || value === undefined) {
    return DATABASE_AGENT_EMPTY_SEGMENT;
  }

  const text: string = (
    value instanceof Date ? value.toISOString() : String(value)
  ).trim();

  return (text || DATABASE_AGENT_EMPTY_SEGMENT).slice(
    0,
    DATABASE_AGENT_MAX_SEGMENT_LENGTH,
  );
}

// The values in the rows a check's statement returned.
export function readDatabaseAgentCheckRows(data: {
  type: DataCheckType;
  isSegmented: boolean;
  rows: Array<Record<string, unknown>>;
}): Array<DatabaseAgentCheckValue> {
  const rows: Array<Record<string, unknown>> = data.rows.slice(
    0,
    MAX_SEGMENTS_PER_CHECK,
  );

  if (data.type === DataCheckType.CustomSql) {
    if (data.isSegmented) {
      return rows.flatMap((row: Record<string, unknown>) => {
        const cells: Array<unknown> = Object.values(row);
        const value: number | null = readDatabaseAgentNumber(cells[1]);

        return value === null
          ? []
          : [{ segment: readDatabaseAgentSegment(cells[0]), value }];
      });
    }

    for (const cell of Object.values(rows[0] || {})) {
      const value: number | null = readDatabaseAgentNumber(cell);

      if (value !== null) {
        return [{ segment: null, value }];
      }
    }

    return [];
  }

  if (data.isSegmented) {
    return rows.flatMap((row: Record<string, unknown>) => {
      const value: number | null = readDatabaseAgentNumber(row["value"]);

      return value === null
        ? []
        : [{ segment: readDatabaseAgentSegment(row["segment"]), value }];
    });
  }

  // A percentage of no rows is NULL: nothing to report, not 0.
  const value: number | null = readDatabaseAgentNumber(rows[0]?.["value"]);

  return value === null ? [] : [{ segment: null, value }];
}

// How long ago a freshness column's newest value was, or null when it says nothing usable.
export function readDatabaseAgentFreshnessAge(
  value: unknown,
  now: Date,
): number | null {
  const time: number =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string" && value.trim().length > 0
        ? Date.parse(value)
        : NaN;

  if (!Number.isFinite(time)) {
    return null;
  }

  // A time in the future is a clock's or a writer's mistake: the table changed just now.
  return Math.max(0, Math.floor((now.getTime() - time) / 1000));
}

// A PostgreSQL relation's kind code, as a data asset kind.
export function readPostgresRelationKind(
  relkind: unknown,
): DataAssetKind | null {
  switch (String(relkind ?? "")) {
    case "r":
      return DataAssetKind.Table;
    case "p":
      return DataAssetKind.PartitionedTable;
    case "v":
      return DataAssetKind.View;
    case "m":
      return DataAssetKind.MaterializedView;
    case "f":
      return DataAssetKind.ForeignTable;
    default:
      return null;
  }
}

// A MySQL table's type, as a data asset kind: SYSTEM VIEW and SEQUENCE are no data.
export function readMySqlTableKind(tableType: unknown): DataAssetKind | null {
  switch (String(tableType ?? "").toUpperCase()) {
    case "BASE TABLE":
      return DataAssetKind.Table;
    case "VIEW":
      return DataAssetKind.View;
    default:
      return null;
  }
}

function readText(value: unknown, maxLength: number): string {
  return String(value ?? "").slice(0, maxLength);
}

function readNullable(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return String(value ?? "")
    .trim()
    .toUpperCase()
    .startsWith("Y");
}

export interface DatabaseAgentColumnRow {
  schema: string;
  table: string;
  column: DatabaseAgentColumn;
}

// One row of a catalog's column list; null when it names no table or column.
export function readDatabaseAgentColumnRow(
  row: Record<string, unknown>,
): DatabaseAgentColumnRow | null {
  const schema: string = readText(
    row["table_schema"],
    DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
  );
  const table: string = readText(
    row["table_name"],
    DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
  );
  const name: string = readText(
    row["column_name"],
    DATABASE_AGENT_MAX_COLUMN_NAME_LENGTH,
  );

  if (!table || !name) {
    return null;
  }

  const position: number | null = readDatabaseAgentCount(
    row["ordinal_position"],
  );

  return {
    schema,
    table,
    column: {
      name,
      dataType: readText(
        row["data_type"],
        DATABASE_AGENT_MAX_COLUMN_TYPE_LENGTH,
      )
        .trim()
        .toLowerCase(),
      isNullable: readNullable(row["is_nullable"]),
      position: position && position > 0 ? position : 1,
    },
  };
}

/*
 * A PostgreSQL catalog read's table rows, as tables: on a replica the
 * counters are the primary's to keep, so they are left unknown.
 */
export function readPostgresTableRows(
  rows: Array<Record<string, unknown>>,
  isReplica: boolean,
): Array<Omit<DatabaseAgentTable, "columns">> {
  const tables: Array<Omit<DatabaseAgentTable, "columns">> = [];

  for (const row of rows) {
    const kind: DataAssetKind | null = readPostgresRelationKind(row["relkind"]);
    const name: string = readText(
      row["table_name"],
      DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
    );

    if (!kind || !name) {
      continue;
    }

    tables.push({
      schema: readText(
        row["table_schema"],
        DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
      ),
      name,
      kind,
      estimatedRows: readDatabaseAgentCount(row["estimated_rows"]),
      sizeInBytes: readDatabaseAgentCount(row["size_bytes"]),
      writeCount: isReplica ? null : readDatabaseAgentCount(row["write_count"]),
      secondsSinceChange: null,
      readCount: isReplica ? null : readDatabaseAgentCount(row["read_count"]),
      secondsSinceRead: null,
    });
  }

  return tables;
}

/*
 * A MySQL catalog read's table rows, as tables, with the write and read
 * counters performance_schema keeps for each (by "schema\u0000table").
 */
export function readMySqlTableRows(
  rows: Array<Record<string, unknown>>,
  counters: Map<string, { writes: number | null; reads: number | null }>,
): Array<Omit<DatabaseAgentTable, "columns">> {
  const tables: Array<Omit<DatabaseAgentTable, "columns">> = [];

  for (const row of rows) {
    const kind: DataAssetKind | null = readMySqlTableKind(row["table_type"]);
    const schema: string = readText(
      row["table_schema"],
      DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
    );
    const name: string = readText(
      row["table_name"],
      DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
    );

    if (!kind || !name) {
      continue;
    }

    const isTable: boolean = kind === DataAssetKind.Table;
    const counted: { writes: number | null; reads: number | null } | undefined =
      counters.get(getDatabaseAgentCatalogKey(schema, name));

    tables.push({
      schema,
      name,
      kind,
      estimatedRows: isTable
        ? readDatabaseAgentCount(row["estimated_rows"])
        : null,
      sizeInBytes: isTable ? readDatabaseAgentCount(row["size_bytes"]) : null,
      writeCount: counted?.writes ?? null,
      secondsSinceChange: isTable
        ? readDatabaseAgentCount(row["seconds_since_change"])
        : null,
      readCount: counted?.reads ?? null,
      secondsSinceRead: null,
    });
  }

  return tables;
}

// performance_schema's counter rows, by "schema\u0000table".
export function readMySqlCounterRows(
  rows: Array<Record<string, unknown>>,
): Map<string, { writes: number | null; reads: number | null }> {
  const counters: Map<string, { writes: number | null; reads: number | null }> =
    new Map();

  for (const row of rows) {
    counters.set(
      getDatabaseAgentCatalogKey(
        String(row["table_schema"] ?? ""),
        String(row["table_name"] ?? ""),
      ),
      {
        writes: readDatabaseAgentCount(row["write_count"]),
        reads: readDatabaseAgentCount(row["read_count"]),
      },
    );
  }

  return counters;
}

// A view's tables, as edges: a view selecting from itself is none.
export function readDatabaseAgentViewLineage(
  rows: Array<Record<string, unknown>>,
): Array<DatabaseAgentLineageEdge> {
  const edges: Array<DatabaseAgentLineageEdge> = [];

  for (const row of rows) {
    const upstreamSchema: string = readText(
      row["upstream_schema"],
      DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
    );
    const upstreamTable: string = readText(
      row["upstream_table"],
      DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
    );
    const downstreamSchema: string = readText(
      row["downstream_schema"],
      DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
    );
    const downstreamTable: string = readText(
      row["downstream_table"],
      DATABASE_AGENT_MAX_IDENTIFIER_LENGTH,
    );

    if (
      !upstreamTable ||
      !downstreamTable ||
      (upstreamSchema === downstreamSchema && upstreamTable === downstreamTable)
    ) {
      continue;
    }

    edges.push({
      source: "View Definition",
      upstreamDatabase: null,
      upstreamSchema,
      upstreamTable,
      downstreamSchema,
      downstreamTable,
      secondsSinceSeen: null,
      seenBy: null,
    });
  }

  return edges;
}

function readExclusions(exclusions: Array<string>): Set<string> {
  return new Set(
    exclusions
      .map((exclusion: string) => {
        return exclusion.trim().toLowerCase();
      })
      .filter((exclusion: string) => {
        return exclusion.length > 0;
      }),
  );
}

export function isDatabaseAgentTableExcluded(
  schema: string,
  table: string,
  excluded: Set<string>,
): boolean {
  const lowerSchema: string = schema.toLowerCase();
  const lowerTable: string = table.toLowerCase();

  return (
    excluded.has(lowerSchema) ||
    excluded.has(lowerTable) ||
    excluded.has(`${lowerSchema}.${lowerTable}`)
  );
}

export interface DatabaseAgentCatalogTables {
  tables: Array<DatabaseAgentTable>;
  isComplete: boolean;
  warnings: Array<string>;
}

/*
 * Puts a catalog read together, as the workers do (assembleSnapshot): each
 * table with its columns, the store's exclusions left out. When the column
 * list was cut at its limit, the last table it reached may have only some
 * of its columns and the ones after it none, so their columns are unknown
 * (null), never an empty list a comparison would read as every column
 * dropped.
 */
export function assembleDatabaseAgentTables(data: {
  engine: DatabaseAgentEngine;
  tables: Array<Omit<DatabaseAgentTable, "columns">>;
  columns: Array<DatabaseAgentColumnRow>;
  maxTables: number;
  maxColumns: number;
  exclusions: Array<string>;
}): DatabaseAgentCatalogTables {
  const excluded: Set<string> = readExclusions(data.exclusions);
  const columnsCut: boolean = data.columns.length >= data.maxColumns;
  const columnsByTable: Map<string, Array<DatabaseAgentColumn>> = new Map();
  let lastKey: string | null = null;

  for (const raw of data.columns) {
    const key: string = getDatabaseAgentCatalogKey(raw.schema, raw.table);
    const list: Array<DatabaseAgentColumn> = columnsByTable.get(key) || [];

    if (list.length < DATABASE_AGENT_MAX_COLUMNS_PER_TABLE) {
      list.push(raw.column);
    }

    columnsByTable.set(key, list);
    lastKey = key;
  }

  if (columnsCut && lastKey) {
    columnsByTable.delete(lastKey);
  }

  const tables: Array<DatabaseAgentTable> = [];

  for (const raw of data.tables) {
    if (isDatabaseAgentTableExcluded(raw.schema, raw.name, excluded)) {
      continue;
    }

    const columns: Array<DatabaseAgentColumn> | undefined = columnsByTable.get(
      getDatabaseAgentCatalogKey(raw.schema, raw.name),
    );

    tables.push({
      ...raw,
      columns: columns
        ? columns.sort((a: DatabaseAgentColumn, b: DatabaseAgentColumn) => {
            return a.position - b.position;
          })
        : columnsCut
          ? null
          : [],
    });
  }

  const warnings: Array<string> = [];

  if (data.tables.length >= data.maxTables) {
    warnings.push(
      `Only the first ${data.maxTables} tables were collected; add exclusions to watch the rest.`,
    );
  }

  if (columnsCut) {
    warnings.push(
      `Only the first ${data.maxColumns} columns were read; schema changes of the tables after them are not compared.`,
    );
  }

  return {
    tables,
    isComplete: data.tables.length < data.maxTables,
    warnings: warnings.slice(0, DATABASE_AGENT_MAX_WARNINGS),
  };
}

// The edges between tables a collection kept: none with an excluded table at either end.
export function filterDatabaseAgentLineage(
  edges: Array<DatabaseAgentLineageEdge>,
  exclusions: Array<string>,
): Array<DatabaseAgentLineageEdge> {
  const excluded: Set<string> = readExclusions(exclusions);

  return edges.filter((edge: DatabaseAgentLineageEdge): boolean => {
    return (
      !isDatabaseAgentTableExcluded(
        edge.downstreamSchema,
        edge.downstreamTable,
        excluded,
      ) &&
      !isDatabaseAgentTableExcluded(
        edge.upstreamSchema,
        edge.upstreamTable,
        excluded,
      )
    );
  });
}
