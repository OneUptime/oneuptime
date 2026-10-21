import DataSourceQueryConfig from "Common/Types/DataSource/DataSourceQueryConfig";
import { DashboardWidgetSortDirection } from "Common/Types/Dashboard/DashboardWidgetSort";
import { JSONValue } from "Common/Types/JSON";

export type DataSourceTableRow = { [key: string]: JSONValue };

/*
 * A Data Source table's rows sorted by one of its columns (issue #5082), as
 * a header click or the widget's own sort asks: numbers by value, anything
 * else as text - in the reader's language, with numbers inside text read as
 * numbers ("node2" before "node10"). Rows with no value in the column stay
 * at the bottom both ways, and equal rows keep the query's order. A new
 * list; the rows handed in are not reordered.
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
 * Shared "has the user actually finished configuring this?" test for the
 * external Data Source widgets. A widget is seeded with a blank query card
 * so the editor opens on something, so presence of the object proves
 * nothing — both a source and query text have to be there before the widget
 * is worth firing a request for.
 */
export function isDataSourceQueryConfigured(
  queryConfig: DataSourceQueryConfig | undefined,
): boolean {
  if (!queryConfig) {
    return false;
  }

  return (
    isNonBlankString(queryConfig.dataSourceId) &&
    isNonBlankString(queryConfig.query)
  );
}

/*
 * Both fields are typed `string`, but they are read back out of the
 * dashboard's JSONB column, so a row written by an older build or edited by
 * hand really can hand us a number, an object, or null. This runs during
 * render of every Data Source widget — calling .trim() on whatever arrived
 * would take the whole dashboard down over one malformed widget.
 */
function isNonBlankString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/*
 * The configured subset of a chart widget's query list, in order. Chart
 * widgets hold several queries and any of them can be half-filled while the
 * user is still typing, so the renderer runs the ones that are ready and
 * ignores the rest rather than erroring the whole widget.
 */
export function getConfiguredDataSourceQueries(
  queryConfigs: Array<DataSourceQueryConfig> | undefined,
): Array<DataSourceQueryConfig> {
  return (queryConfigs || []).filter((config: DataSourceQueryConfig) => {
    return isDataSourceQueryConfigured(config);
  });
}
