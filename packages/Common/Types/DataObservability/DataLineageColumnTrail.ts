import { DataColumnMapping } from "./DataColumnLineage";
import {
  DataLineageEdgeKind,
  DataTableLineage,
  DataTableLineageEdge,
} from "./DataTableLineage";

/*
 * FOLLOWING ONE COLUMN UP AND DOWN A LINEAGE DRAWING.
 *
 * A table's drawing read with its columns (withColumns) says on each arrow
 * between two tables which columns of one feed which of the other, where
 * its sources name them. Picking one of the table's columns follows it:
 * up the arrows into the table to the columns it is built from, and down
 * the arrows out of it to the columns built from it, as far as the drawing
 * goes. The diagram picks its way out as an alert's ways are, each card on
 * it naming the column there - renamed on the way, or several, where it is
 * built from or feeds several (LineageGraphModel); a data alert from a
 * check on one column opens with that column followed, and its AI
 * investigation is told the same way in words (DataAlertColumnLineage).
 */

export interface LineageColumnTrail {
  // The column followed, as the table names it.
  column: string;
  // By card on its way: the columns there that it is, as the arrows name them.
  columns: Map<string, Array<string>>;
  // The arrows it goes along.
  edgeIds: Set<string>;
  /*
   * An arrow into or out of a card on its way says nothing of its columns:
   * the column may go on along it, further than is picked out.
   */
  mayGoFurther: boolean;
}

/*
 * Columns are matched whatever their case: two sources may write one
 * column's name differently (Snowflake keeps unquoted names in capitals;
 * a Spark or dbt job may name them as its code does).
 */
export function getLineageColumnKey(name: string): string {
  return name.trim().toLowerCase();
}

/*
 * The columns of the drawing's own table that can be followed: those an
 * arrow into or out of it names, in the table's own order (`columnOrder`,
 * as its last collection read them) and then by name, each named as the
 * table names it. Empty when no arrow next to it names a column: nothing
 * to pick.
 */
export function getLineageColumnChoices(
  lineage: DataTableLineage,
  columnOrder: ReadonlyArray<string> = [],
): Array<string> {
  const focus: string = lineage.focusNodeId;
  const named: Map<string, string> = new Map();
  const name: (column: string) => void = (column: string): void => {
    const key: string = getLineageColumnKey(column);

    if (key && !named.has(key)) {
      named.set(key, column.trim());
    }
  };

  for (const edge of lineage.edges) {
    if (edge.kind !== DataLineageEdgeKind.Feeds || !edge.columnMappings) {
      continue;
    }

    for (const mapping of edge.columnMappings) {
      if (edge.target === focus) {
        name(mapping.downstreamColumn);
      }

      if (edge.source === focus) {
        name(mapping.upstreamColumn);
      }
    }
  }

  const order: Map<string, number> = new Map();

  columnOrder.forEach((column: string, index: number): void => {
    const key: string = getLineageColumnKey(column);

    if (!order.has(key)) {
      order.set(key, index);

      // As the table names it.
      if (named.has(key)) {
        named.set(key, column);
      }
    }
  });

  const placeOf: (key: string) => number = (key: string): number => {
    return order.get(key) ?? Number.MAX_SAFE_INTEGER;
  };

  return Array.from(named.keys())
    .sort((a: string, b: string): number => {
      return placeOf(a) - placeOf(b) || compareText(a, b);
    })
    .map((key: string): string => {
      return named.get(key)!;
    });
}

/*
 * Where one column of the drawing's own table comes from and where it
 * goes. Up: along each arrow into a card on its way whose columns name
 * the column there, to the columns of the table before it that feed it -
 * another name when it was renamed on the way, several when it is built
 * from several. Down: along each arrow out, to the columns it feeds. Each
 * way is followed on its own - a column that feeds the table is not
 * followed down into the other tables it feeds - and each table's column
 * once, so a cycle ends.
 */
export function followLineageColumn(
  lineage: DataTableLineage,
  column: string,
): LineageColumnTrail {
  const focus: string = lineage.focusNodeId;
  const into: Map<string, Array<DataTableLineageEdge>> = new Map();
  const out: Map<string, Array<DataTableLineageEdge>> = new Map();

  for (const edge of lineage.edges) {
    if (edge.kind !== DataLineageEdgeKind.Feeds) {
      continue;
    }

    into.set(edge.target, [...(into.get(edge.target) || []), edge]);
    out.set(edge.source, [...(out.get(edge.source) || []), edge]);
  }

  const trail: LineageColumnTrail = {
    column,
    columns: new Map(),
    edgeIds: new Set(),
    mayGoFurther: false,
  };
  const addColumn: (nodeId: string, name: string) => void = (
    nodeId: string,
    name: string,
  ): void => {
    const names: Array<string> = trail.columns.get(nodeId) || [];

    if (
      !names.some((known: string): boolean => {
        return getLineageColumnKey(known) === getLineageColumnKey(name);
      })
    ) {
      names.push(name);
    }

    trail.columns.set(nodeId, names);
  };

  if (!getLineageColumnKey(column)) {
    return trail;
  }

  addColumn(focus, column);

  for (const isUpstream of [true, false]) {
    const visited: Set<string> = new Set([
      `${focus}\u0000${getLineageColumnKey(column)}`,
    ]);
    const queue: Array<{ nodeId: string; name: string }> = [
      { nodeId: focus, name: column },
    ];

    for (let index: number = 0; index < queue.length; index++) {
      const here: { nodeId: string; name: string } = queue[index]!;
      const arrows: Array<DataTableLineageEdge> =
        (isUpstream ? into : out).get(here.nodeId) || [];

      for (const edge of arrows) {
        const mappings: Array<DataColumnMapping> = edge.columnMappings || [];

        // Its sources named no columns: it may carry this one.
        if (mappings.length === 0) {
          trail.mayGoFurther = true;
          continue;
        }

        for (const mapping of mappings) {
          const own: string = isUpstream
            ? mapping.downstreamColumn
            : mapping.upstreamColumn;

          if (getLineageColumnKey(own) !== getLineageColumnKey(here.name)) {
            continue;
          }

          const next: { nodeId: string; name: string } = {
            nodeId: isUpstream ? edge.source : edge.target,
            name: isUpstream
              ? mapping.upstreamColumn
              : mapping.downstreamColumn,
          };
          const key: string = `${next.nodeId}\u0000${getLineageColumnKey(next.name)}`;

          trail.edgeIds.add(edge.id);
          addColumn(next.nodeId, next.name);

          if (!visited.has(key)) {
            visited.add(key);
            queue.push(next);
          }
        }
      }
    }
  }

  return trail;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
