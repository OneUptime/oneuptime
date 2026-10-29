import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import {
  DashboardWidgetListSortColumn,
  getDashboardWidgetSortColumns,
  getDashboardWidgetSortComponentTypes,
} from "Common/Utils/Dashboard/DashboardWidgetSorts";
import {
  DASHBOARD_WIDGET_SORT_ARROW_TEST_ID,
  DASHBOARD_WIDGET_SORT_HEADER_TEST_ID_PREFIX,
  DashboardWidgetSortCopy,
  getDashboardWidgetSortDirectionWords,
  getDashboardWidgetSortHeaderTestId,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSortCopy";

/*
 * Issue #5082's wiring: every list widget's column headers, the sort
 * registry its kind keeps (Common/Utils/Dashboard/DashboardWidgetSorts),
 * the header everyone draws and the routes that read the order.
 *
 * The behaviour is tested where it lives (Common/Tests: the vocabulary,
 * the registry, the hook, the widgets driven through the DOM, the public
 * route and Postgres itself). What is left is a widget naming its columns
 * the way the registry does, and a break there leaves no trace: a header
 * that names a column the registry lacks draws as plain text, and a
 * registry column no header names can only be reached from the settings.
 * So the sources are read, comments stripped first.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");

const WIDGETS_DIR: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Components";

// Each block comment, from its opener to the next closer, as one space.
function withoutBlockComments(code: string): string {
  const parts: Array<string> = [];
  let at: number = 0;
  let open: number = code.indexOf("/*");

  while (open >= 0) {
    const close: number = code.indexOf("*/", open + 2);

    if (close < 0) {
      break;
    }

    parts.push(code.slice(at, open));
    at = close + 2;
    open = code.indexOf("/*", at);
  }

  parts.push(code.slice(at));

  return parts.join(" ");
}

const LINE_COMMENT: RegExp = /(^|[^:])\/\/.*$/gm;
const WHITESPACE_RUN: RegExp = /\s+/g;

function readCode(relative: string): string {
  return withoutBlockComments(
    fs.readFileSync(path.join(PACKAGES, relative), "utf8"),
  )
    .replace(LINE_COMMENT, "$1 ")
    .replace(WHITESPACE_RUN, " ");
}

/*
 * A list widget's column: `{ label: "Pod", widthPct: "40%", sortKey: "name" }`,
 * with alignRight, then fitContent, before sortKey where a column has them.
 */
const COLUMN_ENTRY: RegExp =
  /\{ label: "([^"]+)", widthPct: "[^"]+"(?:, alignRight: true)?(?:, fitContent: true)?(?:, sortKey: "([^"]+)")?,? \}/g;

// A trace table's metric header: `{ key: "count", label: "Requests" }`.
const METRIC_HEADER_ENTRY: RegExp = /\{ key: "([^"]+)", label: "([^"]+)" \}/g;

interface WidgetColumn {
  label: string;
  sortKey: string | undefined;
}

function columnsOf(code: string): Array<WidgetColumn> {
  const start: number = code.indexOf(
    "const COLUMNS: Array<ResourceListColumn> = [",
  );

  expect(start).toBeGreaterThanOrEqual(0);

  const end: number = code.indexOf("];", start);
  const block: string = code.slice(start, end);

  return Array.from(block.matchAll(COLUMN_ENTRY)).map(
    (match: RegExpMatchArray): WidgetColumn => {
      return { label: match[1] as string, sortKey: match[2] };
    },
  );
}

function enumKeyOf(type: DashboardComponentType): string {
  const entry: [string, string] | undefined = Object.entries(
    DashboardComponentType,
  ).find(([, value]: [string, string]): boolean => {
    return value === type;
  });

  expect(entry).toBeDefined();
  return entry![0];
}

function widgetSource(type: DashboardComponentType): string {
  return readCode(`${WIDGETS_DIR}/Dashboard${enumKeyOf(type)}Component.tsx`);
}

const LIST_TYPES: Array<DashboardComponentType> =
  getDashboardWidgetSortComponentTypes().filter(
    (type: DashboardComponentType): boolean => {
      return type !== DashboardComponentType.TraceTable;
    },
  );

describe("every list widget's headers are its kind's sortable columns", () => {
  test("the registry knows thirty-odd list widgets, and the trace table", () => {
    expect(LIST_TYPES.length).toBeGreaterThanOrEqual(35);
    expect(getDashboardWidgetSortComponentTypes()).toContain(
      DashboardComponentType.TraceTable,
    );
  });

  test.each(
    LIST_TYPES.map((type: DashboardComponentType) => {
      return [type];
    }),
  )(
    "%s names every registry column in a header, under the registry's title",
    (type: DashboardComponentType) => {
      const columns: Array<WidgetColumn> = columnsOf(widgetSource(type));
      const registry: Array<DashboardWidgetListSortColumn> =
        getDashboardWidgetSortColumns(type);

      const sortKeys: Array<string> = columns
        .map((column: WidgetColumn): string => {
          return column.sortKey || "";
        })
        .filter(Boolean);

      // Every registry column is reachable from a header, once.
      expect([...sortKeys].sort()).toEqual(
        registry
          .map((column: DashboardWidgetListSortColumn): string => {
            return column.key;
          })
          .sort(),
      );

      // And each header says what the Sort setting's choices say.
      for (const column of columns) {
        if (!column.sortKey) {
          continue;
        }

        expect({
          type,
          sortKey: column.sortKey,
          title: registry.find(
            (candidate: DashboardWidgetListSortColumn): boolean => {
              return candidate.key === column.sortKey;
            },
          )?.title,
        }).toEqual({ type, sortKey: column.sortKey, title: column.label });
      }
    },
  );

  test.each(
    LIST_TYPES.map((type: DashboardComponentType) => {
      return [type];
    }),
  )(
    "%s hands its sort to the shared header, from its own kind's registry",
    (type: DashboardComponentType) => {
      const code: string = widgetSource(type);

      const isOwnRead: boolean =
        code.includes(
          `useDashboardListWidgetSort( props, DashboardComponentType.${enumKeyOf(type)}, )`,
        ) && code.includes("sort={widgetSort.listSort}");

      const isSharedBase: boolean =
        code.includes(
          `componentType={DashboardComponentType.${enumKeyOf(type)}}`,
        ) && code.includes("widgetProps={props}");

      expect({ type, wired: isOwnRead || isSharedBase }).toEqual({
        type,
        wired: true,
      });
    },
  );

  test("a column the server cannot order the whole list by is plain text", () => {
    const unsorted: Record<string, Array<string>> = {};

    for (const type of LIST_TYPES) {
      unsorted[type] = columnsOf(widgetSource(type))
        .filter((column: WidgetColumn): boolean => {
          return !column.sortKey;
        })
        .map((column: WidgetColumn): string => {
          return column.label;
        });
    }

    // A ratio, a pair of figures, an identifier, free text, a list.
    expect(unsorted[DashboardComponentType.SecurityEventsList]).toEqual([
      "Message",
    ]);
    expect(unsorted[DashboardComponentType.HostList]).toEqual(["CPU / Mem"]);
    expect(unsorted[DashboardComponentType.CephOsdList]).toEqual(["Used"]);
    expect(unsorted[DashboardComponentType.KubernetesNodeList]).toEqual([
      "Pressure",
    ]);
    expect(unsorted[DashboardComponentType.MonitorList]).toEqual([]);
    expect(unsorted[DashboardComponentType.IncidentList]).toEqual([]);
  });
});

describe("the trace table's headers", () => {
  const code: string = readCode(
    `${WIDGETS_DIR}/DashboardTraceTableComponent.tsx`,
  );

  test("are its registry columns, in its order, with the group column named by the dimension", () => {
    const start: number = code.indexOf("const METRIC_HEADERS");
    const block: string = code.slice(start, code.indexOf("];", start));
    const headers: Array<[string, string]> = Array.from(
      block.matchAll(METRIC_HEADER_ENTRY),
    ).map((match: RegExpMatchArray): [string, string] => {
      return [match[1] as string, match[2] as string];
    });

    expect(headers).toEqual(
      getDashboardWidgetSortColumns(DashboardComponentType.TraceTable)
        .filter((column: DashboardWidgetListSortColumn): boolean => {
          return column.key !== "group";
        })
        .map((column: DashboardWidgetListSortColumn): [string, string] => {
          return [column.key, column.title];
        }),
    );

    expect(code).toContain(
      'column.key === "group" ? { ...column, title: dimensionLabel(groupByAttribute || "") } : column',
    );
  });

  test("sends its order to the server, which ranks the groups by it", () => {
    expect(code).toContain("sort: widgetSort.sort,");
    expect(readCode(`${WIDGETS_DIR}/TraceTableData.ts`)).toContain(
      'requestData["tableSort"] = {',
    );
  });
});

describe("one registry for the browser and the public route", () => {
  test("the public route builds its order and select from the stored widget, and reads only the viewer's pick", () => {
    const policy: string = readCode(
      "Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts",
    );
    const route: string = readCode("Common/Server/API/DashboardAPI.ts");

    expect(policy).toContain("getDashboardWidgetListSort(");
    expect(policy).toContain("withDashboardWidgetListSortSelect(");
    expect(route).toContain("req.body[DASHBOARD_WIDGET_SORT_REQUEST_FIELD]");
    expect(route).toContain("getDashboardWidgetListReadSteps({");
    expect(route).toContain("readDashboardWidgetListInSteps<");
  });

  test("a dashboard write is held to every widget's sort", () => {
    expect(readCode("Common/Server/Services/DashboardService.ts")).toContain(
      "getDashboardWidgetSortsProblem(",
    );
  });

  test("both dashboard shells hand the widgets the dashboard their picks are kept for", () => {
    expect(
      readCode(
        "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx",
      ),
    ).toContain("dashboardId={props.dashboardId.toString()}");
    expect(
      readCode(
        "App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx",
      ),
    ).toContain("dashboardId={props.dashboardId.toString()}");
    expect(
      readCode(
        "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index.tsx",
      ),
    ).toContain("dashboardId={props.dashboardId}");
  });

  test("the settings preview sets the widget's own sort, and reports a table's columns", () => {
    const modal: string = readCode(
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal.tsx",
    );

    expect(modal).toContain("onWidgetSortChange={setPreviewWidgetSort}");
    expect(modal).toContain(
      "onWidgetSortColumnsChange={setPreviewSortColumns}",
    );
    expect(modal).toContain("widgetSortColumns={previewSortColumns}");
  });
});

describe("the header's words", () => {
  test("say the column's way, in the words each kind of column is read in", () => {
    const words: Array<string> = [];

    for (const kind of [
      DashboardWidgetSortKind.Status,
      DashboardWidgetSortKind.Date,
      DashboardWidgetSortKind.Number,
      DashboardWidgetSortKind.Text,
    ]) {
      for (const direction of [
        DashboardWidgetSortDirection.Descending,
        DashboardWidgetSortDirection.Ascending,
      ]) {
        words.push(getDashboardWidgetSortDirectionWords(kind, direction));
      }
    }

    expect(words).toEqual([
      "Worst first",
      "Best first",
      "Newest first",
      "Oldest first",
      "Highest first",
      "Lowest first",
      "Z to A",
      "A to Z",
    ]);
    expect(DashboardWidgetSortCopy.sortedHint).toBe("Sorted: {{direction}}");
    expect(DashboardWidgetSortCopy.sortHint).toBe("Sort: {{direction}}");
  });

  test("name each header by its column, for the tests and the E2E suite", () => {
    expect(DASHBOARD_WIDGET_SORT_HEADER_TEST_ID_PREFIX).toBe(
      "dashboard-widget-sort-",
    );
    expect(getDashboardWidgetSortHeaderTestId("status")).toBe(
      "dashboard-widget-sort-status",
    );
    expect(DASHBOARD_WIDGET_SORT_ARROW_TEST_ID).toBe(
      "dashboard-widget-sort-arrow",
    );
  });
});

describe("the header in the dark theme", () => {
  const header: string = readCode(
    `${WIDGETS_DIR}/DashboardSortableColumnHeader.tsx`,
  );
  const theme: string = fs.readFileSync(
    path.join(PACKAGES, "Common/UI/Styles/Theme.css"),
    "utf8",
  );

  test.each([
    ["text-gray-700", ".text-gray-700"],
    ["hover:text-gray-700", '[class~="hover:text-gray-700"]'],
    ["text-gray-400", ".text-gray-400"],
    ["text-indigo-500", ".text-indigo-500"],
    [
      "focus-visible:ring-indigo-500",
      '[class*="focus-visible:ring-indigo-"]:focus-visible',
    ],
  ])(
    "draws %s, which the dark theme repaints",
    (className: string, darkSelector: string) => {
      expect(header).toContain(className);
      expect(theme).toContain(darkSelector);
    },
  );

  test("draws no light-only hover or focus ground", () => {
    // Theme.css has no dark rule for these; a header must not use them.
    expect(header).not.toContain("focus-visible:bg-gray-50");
    expect(header).not.toContain("hover:bg-gray-50");
  });

  test("the Sort setting's tip is drawn in a grey the dark theme repaints", () => {
    const editor: string = readCode(
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/WidgetSortEditor.tsx",
    );

    // Readable on white (gray-400 is not), and repainted in the dark theme.
    expect(editor).toContain('<p className="mt-2 text-xs text-gray-500">');
    expect(editor).not.toContain("text-gray-400");
    expect(theme).toContain("html.dark :is(.text-gray-500, .text-slate-500)");
  });
});

/*
 * A sortable header must not make a widget's table wider than its plain
 * header did (#5122's UI review): a narrow widget's columns are as wide as
 * their words, and a table that fitted its widget still fits it. The real
 * layout is measured in a browser (E2E DashboardWidgetSort: "the headers
 * take no more room than plain ones"); these are the rules that keep it.
 */
describe("the header's layout", () => {
  const header: string = readCode(
    `${WIDGETS_DIR}/DashboardSortableColumnHeader.tsx`,
  );

  test("its words wrap where a plain header's do, never cut to one line", () => {
    expect(header).toContain("<span>{label}</span>");
    expect(header).not.toContain("truncate");
    expect(header).not.toContain("whitespace-nowrap");
  });

  test("the arrow and the hint hang from a point of no width in the line, hidden from screen readers", () => {
    expect(header).toContain(
      '<span aria-hidden="true" className="relative inline-block h-3 w-0 align-middle" >',
    );
    // Each is drawn whole inside the cell's 12px padding: 2px off, 12px wide.
    expect(header).toContain("absolute -top-px h-3 w-3");
    expect(header).toContain('props.alignRight ? "right-0.5" : "left-0.5"');
    // No arrow takes room beside the words.
    expect(header).not.toContain("ml-1");
    expect(header).not.toContain("flex-none");
  });

  test("a column aligned right puts them before its first word, so no table draws past its edge", () => {
    /*
     * The sort button's words: a plain header draws its label in a span of
     * its own too (an edge a person drags reads it), before the button.
     */
    const button: number = header.indexOf("<button");
    const before: number = header.indexOf(
      "{props.alignRight ? indicator : <></>}",
    );
    const words: number = header.indexOf("<span>{label}</span>", button);
    const after: number = header.indexOf(
      "{props.alignRight ? <></> : indicator}",
    );

    expect(button).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(button);

    expect(before).toBeGreaterThan(0);
    expect(words).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(words);
    expect(header).toContain('props.alignRight ? "text-right" : "text-left"');
    expect(header).not.toContain("justify-end");
  });

  test("the button clips what hangs past the cell", () => {
    expect(header).toContain("group/sort block w-full overflow-hidden");
  });

  test("a list's column as wide as its cells is drawn on one line, its width the least", () => {
    const base: string = readCode(
      `${WIDGETS_DIR}/DashboardResourceListBase.tsx`,
    );

    expect(base).toContain('const FIT_CONTENT_WIDTH: string = "1%";');
    expect(base).toContain(
      "widthPct={c.fitContent ? FIT_CONTENT_WIDTH : c.widthPct}",
    );
    expect(base).toContain(
      'className={c.fitContent ? "whitespace-nowrap" : undefined}',
    );
  });
});

describe("the security events table", () => {
  const code: string = readCode(
    `${WIDGETS_DIR}/DashboardSecurityEventsListComponent.tsx`,
  );

  test("draws one line per event: the time and the severity as wide as they need", () => {
    expect(code).toContain(
      '{ label: "Time", widthPct: "22%", fitContent: true, sortKey: "time" }',
    );
    expect(code).toContain(
      '{ label: "Severity", widthPct: "12%", fitContent: true, sortKey: "severity", }',
    );
    expect(code).toContain(
      'className="whitespace-nowrap px-3 py-1.5 text-xs text-gray-500 tabular-nums"',
    );
    expect(code).toContain(
      '<td className="whitespace-nowrap px-3 py-1.5" title={severity}>',
    );
  });

  test("cuts the class, the message and the host short, whole on hover", () => {
    for (const value of ["className", "message", "host"]) {
      expect(code).toContain(`title={${value}} > {${value} || "—"}`);
    }

    expect(code.split("max-w-0 truncate px-3 py-1.5").length - 1).toBe(3);
  });
});

describe("React-free modules App's tests and the server read", () => {
  test.each([
    [`${WIDGETS_DIR}/DashboardWidgetSortCopy.ts`],
    [
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/WidgetSortOptions.ts",
    ],
    ["Common/Types/Dashboard/DashboardWidgetSort.ts"],
    ["Common/Utils/Dashboard/DashboardWidgetSorts.ts"],
  ])("%s imports no React", (relative: string) => {
    expect(readCode(relative)).not.toContain('from "react"');
  });
});
