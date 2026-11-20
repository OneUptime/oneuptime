import { DashboardWidgetSortDirection } from "../../Types/Dashboard/DashboardWidgetSort";
import { JSONValue } from "../../Types/JSON";

export type DataSourceTableRow = { [key: string]: JSONValue };

/*
 * A Data Source table's rows sorted by one of its columns (issue #5082), as
 * a header click or the widget's own sort asks: numbers by value, anything
 * else as text - in the reader's language, with numbers inside text read as
 * numbers ("node2" before "node10"). Rows with no value in the column stay
 * at the bottom both ways, and equal rows keep the query's order. A new
 * list; the rows handed in are not reordered.
 *
 * The table widget sorts what it draws with it, and a public dashboard's
 * route sorts with it before it keeps the widget's Max Rows (issue
 * #10226), so both keep the same rows.
 */
export function sortDataSourceTableRows(
  rows: Array<DataSourceTableRow>,
  columnKey: string | null | undefined,
  direction: DashboardWidgetSortDirection,
): Array<DataSourceTableRow> {
  if (!columnKey) {
    return rows;
  }

  const sign: number =
    direction === DashboardWidgetSortDirection.Descending ? -1 : 1;

  return rows
    .map((row: DataSourceTableRow, index: number) => {
      return { row, index };
    })
    .sort(
      (
        a: { row: DataSourceTableRow; index: number },
        b: { row: DataSourceTableRow; index: number },
      ): number => {
        const aValue: JSONValue = a.row[columnKey] ?? null;
        const bValue: JSONValue = b.row[columnKey] ?? null;
        const aMissing: boolean = aValue === null || aValue === "";
        const bMissing: boolean = bValue === null || bValue === "";

        if (aMissing || bMissing) {
          if (aMissing && bMissing) {
            return a.index - b.index;
          }

          return aMissing ? 1 : -1;
        }

        const compared: number =
          typeof aValue === "number" && typeof bValue === "number"
            ? aValue - bValue
            : String(aValue).localeCompare(String(bValue), undefined, {
                numeric: true,
                sensitivity: "base",
              });

        return compared !== 0 ? compared * sign : a.index - b.index;
      },
    )
    .map((entry: { row: DataSourceTableRow; index: number }) => {
      return entry.row;
    });
}

/*
 * The rows a table draws once they are sorted: every one, or its first
 * `maxRows` - applied AFTER sorting, so "top 10 by this column" means what
 * it says. No cap, or one of 0 or less, keeps every row. The widget draws
 * what this keeps, and a public dashboard's route sends only what this
 * keeps (issue #10226), so the two can never disagree about a stored value
 * of another type: it is read the one way here.
 */
export function capDataSourceTableRows(
  rows: Array<DataSourceTableRow>,
  maxRows: unknown,
): Array<DataSourceTableRow> {
  if (maxRows === undefined || maxRows === null || (maxRows as number) <= 0) {
    return rows;
  }

  return rows.slice(0, maxRows as number);
}
