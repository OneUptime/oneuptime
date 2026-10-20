import { describe, expect, test } from "@jest/globals";
import { DashboardWidgetSortDirection } from "Common/Types/Dashboard/DashboardWidgetSort";
import {
  DataSourceTableRow,
  sortDataSourceTableRows,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/DataSourceWidget";

/*
 * A Data Source table sorts the rows its query returned (issue #5082),
 * before it trims them to Max Rows: numbers by value, text the way a
 * person reads it ("server2" before "server10", case aside), rows with no
 * value at the bottom both ways, and rows that tie in the query's order.
 */

const ASC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Ascending;
const DESC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Descending;

function names(rows: Array<DataSourceTableRow>): Array<unknown> {
  return rows.map((row: DataSourceTableRow): unknown => {
    return row["name"];
  });
}

const ROWS: Array<DataSourceTableRow> = [
  { name: "server10", errors: 4, region: "eu" },
  { name: "Server2", errors: 12, region: "us" },
  { name: "server1", errors: null, region: "eu" },
  { name: "api", errors: 12, region: "" },
  { name: "worker", errors: 0, region: "us" },
];

describe("sortDataSourceTableRows", () => {
  test("without a column the rows stay in the query's order", () => {
    expect(sortDataSourceTableRows(ROWS, null, DESC)).toBe(ROWS);
    expect(sortDataSourceTableRows(ROWS, "", ASC)).toBe(ROWS);
    expect(sortDataSourceTableRows(ROWS, undefined, ASC)).toBe(ROWS);
  });

  test("numbers sort by value, ties in the query's order, no value last", () => {
    expect(names(sortDataSourceTableRows(ROWS, "errors", DESC))).toEqual([
      "Server2",
      "api",
      "server10",
      "worker",
      "server1",
    ]);
    expect(names(sortDataSourceTableRows(ROWS, "errors", ASC))).toEqual([
      "worker",
      "server10",
      "Server2",
      "api",
      "server1",
    ]);
  });

  test("text sorts the way a person reads it: numbers inside it by value, case aside", () => {
    expect(names(sortDataSourceTableRows(ROWS, "name", ASC))).toEqual([
      "api",
      "server1",
      "Server2",
      "server10",
      "worker",
    ]);
    expect(names(sortDataSourceTableRows(ROWS, "name", DESC))).toEqual([
      "worker",
      "server10",
      "Server2",
      "server1",
      "api",
    ]);
  });

  test("an empty value stays at the bottom both ways", () => {
    expect(names(sortDataSourceTableRows(ROWS, "region", ASC)).pop()).toBe(
      "api",
    );
    expect(names(sortDataSourceTableRows(ROWS, "region", DESC)).pop()).toBe(
      "api",
    );
  });

  test("a column no row has keeps the query's order", () => {
    expect(names(sortDataSourceTableRows(ROWS, "latency", DESC))).toEqual(
      names(ROWS),
    );
  });

  test("the rows handed in are not changed", () => {
    const before: Array<unknown> = names(ROWS);

    sortDataSourceTableRows(ROWS, "errors", DESC);

    expect(names(ROWS)).toEqual(before);
  });
});
