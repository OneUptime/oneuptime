/*
 * WHICH COLUMN OF A TABLE FEEDS WHICH COLUMN OF ANOTHER.
 *
 * A lineage edge says one table feeds another; these say which columns, when
 * something names them: Snowflake's access history, and OpenLineage's column
 * lineage facet from Spark, dbt and Airflow. They are kept on the edge, so
 * a table's page can say where each column comes from and what it feeds.
 */

export interface DataColumnMapping {
  upstreamColumn: string;
  downstreamColumn: string;
}

export const MAX_COLUMN_MAPPINGS_PER_EDGE: number = 500;

const MAX_COLUMN_NAME_LENGTH: number = 240;

function readName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_COLUMN_NAME_LENGTH)
    : "";
}

function keyOf(mapping: DataColumnMapping): string {
  return `${mapping.upstreamColumn}\u0000${mapping.downstreamColumn}`;
}

// A stored or sent list, strictly: well-formed pairs, one of each, in a stable order.
export function readColumnMappings(value: unknown): Array<DataColumnMapping> {
  if (!Array.isArray(value)) {
    return [];
  }

  const byKey: Map<string, DataColumnMapping> = new Map();

  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const item: Record<string, unknown> = raw as Record<string, unknown>;
    const mapping: DataColumnMapping = {
      upstreamColumn: readName(item["upstreamColumn"]),
      downstreamColumn: readName(item["downstreamColumn"]),
    };

    if (mapping.upstreamColumn && mapping.downstreamColumn) {
      byKey.set(keyOf(mapping), mapping);
    }
  }

  return Array.from(byKey.values())
    .sort((a: DataColumnMapping, b: DataColumnMapping): number => {
      return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0;
    })
    .slice(0, MAX_COLUMN_MAPPINGS_PER_EDGE);
}

export function mergeColumnMappings(
  first: unknown,
  second: unknown,
): Array<DataColumnMapping> {
  return readColumnMappings([
    ...(Array.isArray(first) ? first : []),
    ...(Array.isArray(second) ? second : []),
  ]);
}

// Whether a merge said anything the kept list did not.
export function isSameColumnMappings(first: unknown, second: unknown): boolean {
  return (
    JSON.stringify(readColumnMappings(first)) ===
    JSON.stringify(readColumnMappings(second))
  );
}
