import {
  LineageColumnTrail,
  followLineageColumn,
} from "../../../Types/DataObservability/DataLineageColumnTrail";
import {
  DataAlertLineageAnswer,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageNode,
} from "../../../Types/DataObservability/DataTableLineage";

/*
 * WHAT AN INVESTIGATION OF A COLUMN CHECK'S ALERT IS TOLD OF ITS COLUMN.
 *
 * An alert from a check on one column - a null rate, a distinct count on
 * orders.customer_id - asks first which columns feed that column, and
 * which columns it feeds. The alert's lineage is read with the columns
 * each arrow carries (DataAlertLineage), and the column is followed up and
 * down it as the alert's page follows it (followLineageColumn): each table
 * on its way with the column there - renamed on the way, or several where
 * it is built from several - nearest first, a few each way and the rest
 * counted, and whether an arrow on its way names no columns, so the column
 * may come from or go further than is told.
 *
 * Lines of a list, after the lineage's own (describeDataAlertLineage);
 * none for an alert from no column check.
 */

// The most tables told each way; the rest are counted.
export const MAX_DATA_ALERT_COLUMN_TABLES_TOLD: number = 5;

// The most columns told on one table; the rest are counted.
export const MAX_DATA_ALERT_COLUMNS_TOLD_PER_TABLE: number = 5;

// The longest column or table name told: a source may name one at length.
export const MAX_DATA_ALERT_COLUMN_NAME_LENGTH: number = 120;
export const MAX_DATA_ALERT_COLUMN_TABLE_NAME_LENGTH: number = 200;

// A table on the column's way, with the columns there that it is.
interface ColumnStop {
  node: DataTableLineageNode;
  columns: Array<string>;
}

function clip(value: string, length: number): string {
  const text: string = value.replace(/\s+/g, " ").trim();

  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// "a", "a and b", "a, b and c".
function listOf(items: Array<string>): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// One table on the way: its columns there, where it is, and how far.
function describeStop(data: {
  stop: ColumnStop;
  isUpstream: boolean;
  focusDatabase: string | null;
}): string {
  const columns: Array<string> = data.stop.columns
    .slice(0, MAX_DATA_ALERT_COLUMNS_TOLD_PER_TABLE)
    .map((column: string): string => {
      return clip(column, MAX_DATA_ALERT_COLUMN_NAME_LENGTH);
    });
  const untold: number = data.stop.columns.length - columns.length;
  const database: string | null = data.stop.node.database || null;
  const elsewhere: string =
    database && database !== data.focusDatabase
      ? `, in ${clip(database, MAX_DATA_ALERT_COLUMN_TABLE_NAME_LENGTH)}`
      : "";

  return `${listOf([
    ...columns,
    ...(untold > 0 ? [plural(untold, "more column", "more columns")] : []),
  ])} of ${clip(
    data.stop.node.name,
    MAX_DATA_ALERT_COLUMN_TABLE_NAME_LENGTH,
  )}${elsewhere}, ${plural(Math.abs(data.stop.node.depth), "step", "steps")} ${
    data.isUpstream ? "up" : "down"
  }`;
}

// One way of the column, nearest first; null when no table on it is named.
function describeWay(data: {
  stops: Array<ColumnStop>;
  isUpstream: boolean;
  focusDatabase: string | null;
}): string | null {
  if (data.stops.length === 0) {
    return null;
  }

  const told: Array<ColumnStop> = [...data.stops]
    .sort((a: ColumnStop, b: ColumnStop): number => {
      return (
        Math.abs(a.node.depth) - Math.abs(b.node.depth) ||
        compareText(a.node.name, b.node.name)
      );
    })
    .slice(0, MAX_DATA_ALERT_COLUMN_TABLES_TOLD);
  const untold: number = data.stops.length - told.length;

  return `  ${data.isUpstream ? "Where it comes from" : "Where it goes"}: ${told
    .map((stop: ColumnStop): string => {
      return describeStop({
        stop,
        isUpstream: data.isUpstream,
        focusDatabase: data.focusDatabase,
      });
    })
    .join("; ")}${
    untold > 0
      ? `; and ${plural(untold, "more table", "more tables")} further ${
          data.isUpstream ? "up" : "down"
        }`
      : ""
  }.`;
}

/*
 * Where the column a column check's alert reads comes from and where it
 * goes, as the alert's lineage names them (DataAlertLineageAnswer.column).
 */
export function describeDataAlertColumn(
  answer: DataAlertLineageAnswer,
): Array<string> {
  const lineage: DataTableLineage | null = answer.lineage;
  const column: string | null = answer.column ? answer.column.trim() : null;

  if (!lineage || !column) {
    return [];
  }

  const trail: LineageColumnTrail = followLineageColumn(lineage, column);
  const byId: Map<string, DataTableLineageNode> = new Map();

  for (const node of lineage.nodes) {
    byId.set(node.id, node);
  }

  const upstream: Array<ColumnStop> = [];
  const downstream: Array<ColumnStop> = [];

  for (const [nodeId, columns] of trail.columns) {
    const node: DataTableLineageNode | undefined = byId.get(nodeId);

    if (!node || nodeId === lineage.focusNodeId) {
      continue;
    }

    (node.side === DataLineageSide.Upstream ? upstream : downstream).push({
      node,
      columns,
    });
  }

  const focusDatabase: string | null =
    byId.get(lineage.focusNodeId)?.database || null;
  const named: string = clip(column, MAX_DATA_ALERT_COLUMN_NAME_LENGTH);

  if (upstream.length + downstream.length === 0) {
    return [
      `- The check behind this alert reads the column ${named}: no lineage source names the columns it is built from or the columns built from it${
        trail.mayGoFurther
          ? ", and some arrows into or out of its table do not say which columns they carry"
          : ""
      }.`,
    ];
  }

  const lines: Array<string> = [
    `- The check behind this alert reads the column ${named}. Followed up and down its lineage, as the lineage's sources name its columns:`,
  ];

  for (const isUpstream of [true, false]) {
    const line: string | null = describeWay({
      stops: isUpstream ? upstream : downstream,
      isUpstream,
      focusDatabase,
    });

    if (line) {
      lines.push(line);
    }
  }

  if (trail.mayGoFurther) {
    lines.push(
      "  Some arrows on its way do not say which columns they carry, so it may come from or go further than this.",
    );
  }

  return lines;
}
