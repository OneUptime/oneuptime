/**
 * A dashboard list or table widget's sort (issue #5082): how it is written
 * ("status:desc"), read back, worded, and what a click on a column header
 * does - the first direction, the other way, then back to the widget's own
 * order. Every sortable widget, the widget settings and the public
 * dashboard's server read these.
 */

import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
  DASHBOARD_WIDGET_SORT_MAX_LENGTH,
  DASHBOARD_WIDGET_SORT_REQUEST_FIELD,
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
  findDashboardWidgetSortColumn,
  formatDashboardWidgetSortChoice,
  getDashboardWidgetSortDirectionLabel,
  getDashboardWidgetSortFirstDirection,
  getNextDashboardWidgetSortPick,
  isDashboardWidgetSortDirection,
  isSameDashboardWidgetSortChoice,
  parseDashboardWidgetSortChoice,
  readDashboardWidgetSortChoiceForColumns,
  reverseDashboardWidgetSortDirection,
} from "../../../Types/Dashboard/DashboardWidgetSort";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

const ASC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Ascending;
const DESC: DashboardWidgetSortDirection =
  DashboardWidgetSortDirection.Descending;

const NAME: DashboardWidgetSortColumnInfo = {
  key: "name",
  title: "Name",
  kind: DashboardWidgetSortKind.Text,
};

const STATUS: DashboardWidgetSortColumnInfo = {
  key: "status",
  title: "Status",
  kind: DashboardWidgetSortKind.Status,
};

const CREATED: DashboardWidgetSortColumnInfo = {
  key: "created",
  title: "Created",
  kind: DashboardWidgetSortKind.Date,
};

const CPU: DashboardWidgetSortColumnInfo = {
  key: "cpu",
  title: "CPU",
  kind: DashboardWidgetSortKind.Number,
};

const BUDGET: DashboardWidgetSortColumnInfo = {
  key: "errorBudget",
  title: "Error Budget",
  kind: DashboardWidgetSortKind.Number,
  firstDirection: ASC,
};

const COLUMNS: Array<DashboardWidgetSortColumnInfo> = [
  NAME,
  STATUS,
  CREATED,
  CPU,
  BUDGET,
];

function choice(
  column: string,
  direction: DashboardWidgetSortDirection,
): DashboardWidgetSortChoice {
  return { column, direction };
}

describe("where a sort is kept", () => {
  test("a widget keeps its own sort under arguments.sort, and a public request names a pick as widgetSort", () => {
    expect(DASHBOARD_WIDGET_SORT_ARGUMENT).toBe("sort");
    expect(DASHBOARD_WIDGET_SORT_REQUEST_FIELD).toBe("widgetSort");
  });
});

describe("reading a written sort", () => {
  test.each([
    ["status:desc", choice("status", DESC)],
    ["name:asc", choice("name", ASC)],
    // Directions are read in any case and with spaces around them.
    ["name:ASC", choice("name", ASC)],
    ["name: Desc ", choice("name", DESC)],
    // The column is everything before the LAST colon.
    ["col:7d8a1c2e:desc", choice("col:7d8a1c2e", DESC)],
    ["attr:0:asc", choice("attr:0", ASC)],
    ["legacy:q:a:desc", choice("legacy:q:a", DESC)],
    // A Data Source column's own name, spaces and all.
    ["Total Revenue:asc", choice("Total Revenue", ASC)],
  ])("%j reads as %j", (value: string, expected: DashboardWidgetSortChoice) => {
    expect(parseDashboardWidgetSortChoice(value)).toEqual(expected);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty text", ""],
    ["a number", 5],
    ["an object", { column: "name", direction: "asc" }],
    ["a list", ["name", "asc"]],
    ["no direction", "name"],
    ["a colon only", ":"],
    ["no column", ":asc"],
    ["a column of spaces", "   :asc"],
    ["an unknown direction", "name:up"],
    ["a direction word other than asc or desc", "name:ascending"],
    ["a trailing colon", "name:"],
    ["a database order", "ASC"],
  ])("%s reads as no sort", (_what: string, value: unknown) => {
    expect(parseDashboardWidgetSortChoice(value)).toBeNull();
  });

  test("a value longer than any sort a widget can hold is not looked at", () => {
    const column: string = "c".repeat(DASHBOARD_WIDGET_SORT_MAX_LENGTH);

    expect(parseDashboardWidgetSortChoice(`${column}:asc`)).toBeNull();
    expect(
      parseDashboardWidgetSortChoice(
        `${"c".repeat(DASHBOARD_WIDGET_SORT_MAX_LENGTH - 4)}:asc`,
      ),
    ).toEqual(choice("c".repeat(DASHBOARD_WIDGET_SORT_MAX_LENGTH - 4), ASC));
  });

  test("400,000 characters of colons are read in no time", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(parseDashboardWidgetSortChoice(":".repeat(400000))).toBeNull();
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("written and read back, a sort is the same sort", () => {
    for (const written of [
      choice("status", DESC),
      choice("name", ASC),
      choice("col:abc", DESC),
      choice("Total Revenue", ASC),
    ]) {
      expect(
        parseDashboardWidgetSortChoice(
          formatDashboardWidgetSortChoice(written),
        ),
      ).toEqual(written);
    }

    expect(formatDashboardWidgetSortChoice(choice("status", DESC))).toBe(
      "status:desc",
    );
  });

  test("only asc and desc are directions", () => {
    expect(isDashboardWidgetSortDirection("asc")).toBe(true);
    expect(isDashboardWidgetSortDirection("desc")).toBe(true);
    expect(isDashboardWidgetSortDirection("ASC")).toBe(false);
    expect(isDashboardWidgetSortDirection("Ascending")).toBe(false);
    expect(isDashboardWidgetSortDirection(undefined)).toBe(false);
  });
});

describe("a sort read through one widget's columns", () => {
  test("names one of the widget's columns, or reads as none", () => {
    expect(
      readDashboardWidgetSortChoiceForColumns("status:desc", COLUMNS),
    ).toEqual(choice("status", DESC));
    expect(
      readDashboardWidgetSortChoiceForColumns("severity:desc", COLUMNS),
    ).toBeNull();
    expect(
      readDashboardWidgetSortChoiceForColumns("status:sideways", COLUMNS),
    ).toBeNull();
    expect(
      readDashboardWidgetSortChoiceForColumns("status:desc", []),
    ).toBeNull();
  });

  test("finds a column by its key, never by its words", () => {
    expect(findDashboardWidgetSortColumn(COLUMNS, "status")).toBe(STATUS);
    expect(findDashboardWidgetSortColumn(COLUMNS, "Status")).toBeNull();
    expect(findDashboardWidgetSortColumn(COLUMNS, null)).toBeNull();
    expect(findDashboardWidgetSortColumn(COLUMNS, "")).toBeNull();
  });
});

describe("the first direction and the words for each", () => {
  test("a first click puts the rows that need someone first: A to Z, worst, newest, highest", () => {
    expect(getDashboardWidgetSortFirstDirection(NAME)).toBe(ASC);
    expect(getDashboardWidgetSortFirstDirection(STATUS)).toBe(DESC);
    expect(getDashboardWidgetSortFirstDirection(CREATED)).toBe(DESC);
    expect(getDashboardWidgetSortFirstDirection(CPU)).toBe(DESC);
  });

  test("a column whose lowest value is its worst says so", () => {
    expect(getDashboardWidgetSortFirstDirection(BUDGET)).toBe(ASC);
  });

  test.each([
    [DashboardWidgetSortKind.Status, DESC, "Worst first"],
    [DashboardWidgetSortKind.Status, ASC, "Best first"],
    [DashboardWidgetSortKind.Date, DESC, "Newest first"],
    [DashboardWidgetSortKind.Date, ASC, "Oldest first"],
    [DashboardWidgetSortKind.Number, DESC, "Highest first"],
    [DashboardWidgetSortKind.Number, ASC, "Lowest first"],
    [DashboardWidgetSortKind.Text, ASC, "A to Z"],
    [DashboardWidgetSortKind.Text, DESC, "Z to A"],
  ])(
    "%s %s reads %j",
    (
      kind: DashboardWidgetSortKind,
      direction: DashboardWidgetSortDirection,
      words: string,
    ) => {
      expect(getDashboardWidgetSortDirectionLabel(kind, direction)).toBe(words);
    },
  );

  test("each direction has one reverse", () => {
    expect(reverseDashboardWidgetSortDirection(ASC)).toBe(DESC);
    expect(reverseDashboardWidgetSortDirection(DESC)).toBe(ASC);
  });

  test("two sorts are the same when column and direction are", () => {
    expect(
      isSameDashboardWidgetSortChoice(choice("a", ASC), choice("a", ASC)),
    ).toBe(true);
    expect(
      isSameDashboardWidgetSortChoice(choice("a", ASC), choice("a", DESC)),
    ).toBe(false);
    expect(
      isSameDashboardWidgetSortChoice(choice("a", ASC), choice("b", ASC)),
    ).toBe(false);
    expect(isSameDashboardWidgetSortChoice(null, null)).toBe(true);
    expect(isSameDashboardWidgetSortChoice(choice("a", ASC), null)).toBe(false);
    expect(isSameDashboardWidgetSortChoice(undefined, choice("a", ASC))).toBe(
      false,
    );
  });
});

/*
 * Clicks on one header, from the widget's own sort: each click hands the
 * pick it leaves to the next, and the order shown is the pick, else the
 * widget's own sort.
 */
function clickThrough(data: {
  column: DashboardWidgetSortColumnInfo;
  widgetSort: DashboardWidgetSortChoice | null;
  clicks: number;
  pick?: DashboardWidgetSortChoice | null;
}): Array<DashboardWidgetSortChoice | null> {
  const shown: Array<DashboardWidgetSortChoice | null> = [];
  let pick: DashboardWidgetSortChoice | null = data.pick || null;

  for (let index: number = 0; index < data.clicks; index++) {
    pick = getNextDashboardWidgetSortPick({
      column: data.column,
      current: pick || data.widgetSort,
      widgetSort: data.widgetSort,
    });
    shown.push(pick || data.widgetSort);
  }

  return shown;
}

describe("a click on a column header", () => {
  test("cycles worst first, best first, then back to the widget's own order", () => {
    expect(
      clickThrough({
        column: STATUS,
        widgetSort: choice("name", ASC),
        clicks: 4,
      }),
    ).toEqual([
      choice("status", DESC),
      choice("status", ASC),
      choice("name", ASC),
      choice("status", DESC),
    ]);
  });

  test("on a text column cycles A to Z, Z to A, then back", () => {
    expect(
      clickThrough({
        column: NAME,
        widgetSort: choice("status", DESC),
        clicks: 3,
      }),
    ).toEqual([
      choice("name", ASC),
      choice("name", DESC),
      choice("status", DESC),
    ]);
  });

  test("the third click forgets the pick: it leaves none", () => {
    let pick: DashboardWidgetSortChoice | null = null;
    const widgetSort: DashboardWidgetSortChoice = choice("name", ASC);

    for (let index: number = 0; index < 3; index++) {
      pick = getNextDashboardWidgetSortPick({
        column: CPU,
        current: pick || widgetSort,
        widgetSort,
      });
    }

    expect(pick).toBeNull();
  });

  test("on the column the widget already sorts by, turns it round and back", () => {
    // The widget's own sort is Status, worst first.
    expect(
      clickThrough({
        column: STATUS,
        widgetSort: choice("status", DESC),
        clicks: 3,
      }),
    ).toEqual([
      choice("status", ASC),
      choice("status", DESC),
      choice("status", ASC),
    ]);
  });

  test("on a column the widget sorts the other way from its first, turns it to its first and back", () => {
    // Saved best first: the click goes to worst first, then back to best.
    expect(
      clickThrough({
        column: STATUS,
        widgetSort: choice("status", ASC),
        clicks: 3,
      }),
    ).toEqual([
      choice("status", DESC),
      choice("status", ASC),
      choice("status", DESC),
    ]);
  });

  test("never keeps a pick that only repeats the widget's own sort", () => {
    const widgetSort: DashboardWidgetSortChoice = choice("status", DESC);

    // From a pick on another column, a click on Status lands on its own sort.
    expect(
      getNextDashboardWidgetSortPick({
        column: STATUS,
        current: choice("name", ASC),
        widgetSort,
      }),
    ).toBeNull();
  });

  test("a widget with no order of its own (a Data Source table) goes back to the query's order", () => {
    expect(clickThrough({ column: CPU, widgetSort: null, clicks: 4 })).toEqual([
      choice("cpu", DESC),
      choice("cpu", ASC),
      null,
      choice("cpu", DESC),
    ]);
  });

  test("a column whose first click is lowest starts there", () => {
    expect(
      clickThrough({
        column: BUDGET,
        widgetSort: choice("name", ASC),
        clicks: 3,
      }),
    ).toEqual([
      choice("errorBudget", ASC),
      choice("errorBudget", DESC),
      choice("name", ASC),
    ]);
  });

  test("a click on another column from a pick starts that column over", () => {
    expect(
      getNextDashboardWidgetSortPick({
        column: CREATED,
        current: choice("status", ASC),
        widgetSort: choice("name", ASC),
      }),
    ).toEqual(choice("created", DESC));
  });
});
