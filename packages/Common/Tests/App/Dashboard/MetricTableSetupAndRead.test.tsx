import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import React from "react";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

/*
 * THE METRIC TABLE, BEFORE AND AFTER A COLUMN NAMES A METRIC (issue #7329).
 *
 * A new metric Table has one column, with no metric picked. It was read
 * anyway - the metrics read asked for no metric - and, read or not, the
 * table said "Add a metric column with a Metric Name to start populating
 * the table." in English, in pale gray, wherever it was drawn: on a
 * reader's board and a public dashboard, to people who cannot add one.
 * And an older table whose first column stored no aggregation stopped
 * there: "Pick an aggregation for your first metric column.", under a
 * picker that showed Avg.
 *
 * Here the real widget is drawn with the metrics read standing in:
 *
 *   - no column names a metric: nothing is read, and the table says what
 *     it needs as every widget's setup state - its icon, its title, a line
 *     for where it is drawn - in the reader's language;
 *   - a column with a metric and no aggregation is read as its average and
 *     drawn, and the stored widget is left as it was;
 *   - a column just added beside one that works, with no metric yet, is
 *     left out of the read: the others, and the formulas, keep their own
 *     values in their own columns;
 *   - a read that fails says why in every widget's error line.
 */

type FetchResults = (data: {
  metricViewData: {
    queryConfigs: Array<{
      metricAliasData: { metricVariable?: string };
      metricQueryData: {
        filterData: { metricName?: unknown; aggegationType?: unknown };
      };
    }>;
    formulaConfigs: Array<unknown>;
  };
}) => Promise<Array<AggregatedResult>>;

const fetchResultsMock: Mock<FetchResults> = jest.fn<FetchResults>();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (data: Parameters<FetchResults>[0]) => {
          return fetchResultsMock(data);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

import DashboardTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { DASHBOARD_WIDGET_ERROR_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetError";
import {
  DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
  DASHBOARD_WIDGET_SETUP_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
  DASHBOARD_WIDGET_SETUP_NAME_CLASS_NAME,
  DashboardWidgetPlace,
  DashboardWidgetSetupNeed,
  getDashboardWidgetSetupLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardTableComponent, {
  TableColumn,
  TableColumnKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import DashboardTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTableComponent";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000007329",
);

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-13T09:00:00.000Z"),
    new Date("2026-11-13T10:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const OLD_LINES: RegExp =
  /Add a metric column|Metric Name|Pick an aggregation|populating/;

function baseProps(isEditMode: boolean = false): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: isEditMode,
    isSelected: false,
    key: "metric-table",
    onComponentUpdate: (): void => {
      // The table never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 400,
    dashboardComponentWidthInPx: 800,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    dashboardId: "d0000000-0000-4000-8000-000000007329",
  };
}

// The table as the widget picker adds it: one column, no metric picked.
function newTable(): DashboardTableComponent {
  return {
    ...DashboardTableComponentUtil.getDefaultComponent(),
    componentId: COMPONENT_ID,
  };
}

function tableWith(
  columns: Array<TableColumn>,
  extra: Partial<DashboardTableComponent["arguments"]> = {},
): DashboardTableComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Table,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: {
      columns: columns,
      groupByAttributes: [{ key: "service.name", header: "Service" }],
      maxRows: 25,
      ...extra,
    } as DashboardTableComponent["arguments"],
  };
}

const REQUESTS: TableColumn = {
  id: "requests",
  variable: "a",
  header: "Requests",
  kind: TableColumnKind.Metric,
  metricName: "http.requests",
  aggregation: MetricsAggregationType.Sum,
  decimals: 0,
};

// A column whose aggregation was never stored: an older table's.
const LATENCY_NOT_AGGREGATED: TableColumn = {
  id: "latency",
  variable: "a",
  header: "Latency",
  kind: TableColumnKind.Metric,
  metricName: "http.latency",
  decimals: 0,
};

// A column just added, no metric picked yet.
const JUST_ADDED: TableColumn = {
  id: "just-added",
  variable: "b",
  header: "Just added",
  kind: TableColumnKind.Metric,
  metricName: undefined,
  aggregation: MetricsAggregationType.Avg,
  decimals: 0,
};

const DOUBLED: TableColumn = {
  id: "doubled",
  variable: "c",
  header: "Doubled",
  kind: TableColumnKind.Formula,
  formula: "a * 2",
  decimals: 0,
};

function point(service: string, value: number): AggregatedModel {
  return {
    timestamp: new Date("2026-11-13T09:30:00.000Z"),
    value,
    attributes: { "service.name": service },
  } as unknown as AggregatedModel;
}

/*
 * Answers the way MetricUtil.fetchResults does: one result per query
 * asked, in order, then one per formula. Each query's value is its metric
 * read for checkout (12 requests, 340 ms), each formula's twice the first.
 */
const VALUE_BY_METRIC: Record<string, number> = {
  "http.requests": 12,
  "http.latency": 340,
};

function answerTheRead(): void {
  fetchResultsMock.mockImplementation(
    async (data: Parameters<FetchResults>[0]) => {
      const results: Array<AggregatedResult> =
        data.metricViewData.queryConfigs.map(
          (config: {
            metricQueryData: { filterData: { metricName?: unknown } };
          }): AggregatedResult => {
            const value: number | undefined =
              VALUE_BY_METRIC[
                String(config.metricQueryData.filterData.metricName)
              ];

            return {
              data: value === undefined ? [] : [point("checkout", value)],
            } as AggregatedResult;
          },
        );

      // Each formula answers 24, after the queries, as the read answers.
      results.push(
        ...data.metricViewData.formulaConfigs.map((): AggregatedResult => {
          return { data: [point("checkout", 24)] } as AggregatedResult;
        }),
      );

      return results;
    },
  );
}

// The table's header cells' words, in the order drawn.
function headerWords(): Array<string> {
  return Array.from(document.querySelectorAll("thead th")).map(
    (cell: Element): string => {
      return (cell.textContent || "").trim();
    },
  );
}

// The cells of the row whose first cell is `group`, by their header.
function rowByHeader(group: string): Record<string, string> {
  const headers: Array<string> = headerWords();
  const row: Element | undefined = Array.from(
    document.querySelectorAll("tbody tr"),
  ).find((candidate: Element): boolean => {
    return (candidate.querySelector("td")?.textContent || "").trim() === group;
  });

  expect(row).toBeDefined();

  const cells: Array<string> = Array.from(row!.querySelectorAll("td")).map(
    (cell: Element): string => {
      return (cell.textContent || "").trim();
    },
  );
  const byHeader: Record<string, string> = {};

  headers.forEach((header: string, index: number) => {
    byHeader[header] = cells[index] || "";
  });

  return byHeader;
}

async function speak(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function inLanguage(english: string, language: string): string {
  return language === "en"
    ? english
    : (readDashboardLocale(language)[english] as string);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  fetchResultsMock.mockReset();
  answerTheRead();
  window.localStorage.clear();
  await speak("en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("a new Table, whose one column names no metric yet", () => {
  test.each([
    ["en", false, DashboardWidgetPlace.Board],
    ["en", true, DashboardWidgetPlace.EditedBoard],
    ["de", false, DashboardWidgetPlace.Board],
    ["de", true, DashboardWidgetPlace.EditedBoard],
    ["ar", false, DashboardWidgetPlace.Board],
    ["ar", true, DashboardWidgetPlace.EditedBoard],
    ["fa", false, DashboardWidgetPlace.Board],
  ])(
    "in %s, edit mode %s: reads nothing, and says what it needs as a setup state",
    async (
      language: string,
      isEditMode: boolean,
      place: DashboardWidgetPlace,
    ) => {
      await speak(language);

      render(
        <DashboardTableComponentElement
          {...baseProps(isEditMode)}
          component={newTable()}
        />,
      );

      const line: HTMLElement = await screen.findByTestId(
        DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
      );
      const expected: string = inLanguage(
        getDashboardWidgetSetupLine(
          DashboardWidgetSetupNeed.MetricColumn,
          place,
        ),
        language,
      );

      expect(expected).toBeTruthy();
      expect(line).toHaveTextContent(expected);
      expect(line.className).toBe(DASHBOARD_WIDGET_SETUP_LINE_CLASS_NAME);
      expect(line).toHaveClass("text-gray-500", "text-center");
      expect(line).not.toHaveClass("text-gray-400");

      // Under the widget's name - "Table", in the reader's words - and its icon.
      const name: Element | null = line.previousElementSibling;

      expect(name).not.toBeNull();
      expect(name).toHaveTextContent(inLanguage("Table", language));
      expect(name!.className).toContain(DASHBOARD_WIDGET_SETUP_NAME_CLASS_NAME);
      expect(
        line.parentElement!.querySelector(".bg-indigo-50 svg"),
      ).not.toBeNull();

      // Only the board being edited is asked for a click.
      if (place === DashboardWidgetPlace.Board) {
        expect(document.body.textContent || "").not.toMatch(/click/i);
        expect(document.body.textContent || "").not.toContain(
          inLanguage(
            getDashboardWidgetSetupLine(
              DashboardWidgetSetupNeed.MetricColumn,
              DashboardWidgetPlace.EditedBoard,
            ),
            language,
          ),
        );
      }

      expect(document.body.textContent || "").not.toMatch(OLD_LINES);
      expect(
        screen.queryByTestId(DASHBOARD_WIDGET_ERROR_TEST_ID),
      ).not.toBeInTheDocument();
      expect(document.querySelector("table")).toBeNull();
      expect(fetchResultsMock).not.toHaveBeenCalled();
    },
  );

  test("a table with a title is named by it", async () => {
    const table: DashboardTableComponent = newTable();

    table.arguments = { ...table.arguments, tableTitle: "Checkout services" };

    render(
      <DashboardTableComponentElement {...baseProps()} component={table} />,
    );

    const line: HTMLElement = await screen.findByTestId(
      DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
    );

    expect(line.previousElementSibling).toHaveTextContent("Checkout services");
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("a column whose metric name is only spaces names no metric either", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableWith([{ ...REQUESTS, metricName: "   " }])}
      />,
    );

    expect(
      await screen.findByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).toHaveTextContent("No metric column set up yet.");
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("a metric picked: the table reads it and draws it; cleared again: the setup state, and no old error", async () => {
    fetchResultsMock.mockRejectedValueOnce(new Error("metrics store busy"));

    const view: RenderResult = render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableWith([REQUESTS])}
      />,
    );

    expect(await screen.findByText("metrics store busy")).toBeInTheDocument();

    view.rerender(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableWith([{ ...REQUESTS, metricName: undefined }])}
      />,
    );

    expect(
      await screen.findByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).toHaveTextContent("No metric column set up yet.");
    expect(screen.queryByText("metrics store busy")).not.toBeInTheDocument();
    expect(fetchResultsMock).toHaveBeenCalledTimes(1);

    view.rerender(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableWith([REQUESTS])}
      />,
    );

    await waitFor(() => {
      expect(rowByHeader("checkout")["Requests"]).toBe("12");
    });
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("a column with a metric and no aggregation is read as its average", () => {
  test("it is read, as Avg, and drawn; the stored widget is left as it was", async () => {
    const table: DashboardTableComponent = tableWith([LATENCY_NOT_AGGREGATED]);
    const stored: string = JSON.stringify(table);

    render(
      <DashboardTableComponentElement {...baseProps()} component={table} />,
    );

    await waitFor(() => {
      expect(rowByHeader("checkout")["Latency"]).toBe("340");
    });

    expect(fetchResultsMock).toHaveBeenCalled();

    const asked: Parameters<FetchResults>[0] =
      fetchResultsMock.mock.calls[0]![0];

    expect(asked.metricViewData.queryConfigs).toHaveLength(1);
    expect(
      asked.metricViewData.queryConfigs[0]!.metricQueryData.filterData,
    ).toEqual(
      expect.objectContaining({
        metricName: "http.latency",
        aggegationType: MetricsAggregationType.Avg,
      }),
    );
    expect(document.body.textContent || "").not.toMatch(OLD_LINES);
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_ERROR_TEST_ID),
    ).not.toBeInTheDocument();
    expect(JSON.stringify(table)).toBe(stored);
  });

  test("a picked aggregation is read as picked", async () => {
    render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableWith([REQUESTS])}
      />,
    );

    await waitFor(() => {
      expect(rowByHeader("checkout")["Requests"]).toBe("12");
    });

    expect(
      fetchResultsMock.mock.calls[0]![0].metricViewData.queryConfigs[0]!
        .metricQueryData.filterData.aggegationType,
    ).toBe(MetricsAggregationType.Sum);
  });

  test("an older table's first query with no aggregation is read as its average, not stopped", async () => {
    const table: DashboardTableComponent = {
      ...tableWith([]),
      arguments: {
        metricQueryConfig: {
          metricAliasData: {
            metricVariable: "a",
            title: "Latency",
            description: undefined,
            legend: "Latency",
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: { metricName: "http.latency" },
            groupByAttributeKeys: ["service.name"],
          },
        },
        maxRows: 25,
      } as unknown as DashboardTableComponent["arguments"],
    };
    const stored: string = JSON.stringify(table);

    render(
      <DashboardTableComponentElement {...baseProps()} component={table} />,
    );

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(document.body.textContent || "").toContain("340");
    });

    expect(
      fetchResultsMock.mock.calls[0]![0].metricViewData.queryConfigs[0]!
        .metricQueryData.filterData,
    ).toEqual({
      metricName: "http.latency",
      aggegationType: MetricsAggregationType.Avg,
    });
    expect(document.body.textContent || "").not.toMatch(OLD_LINES);
    expect(JSON.stringify(table)).toBe(stored);
  });
});

describe("a column just added beside one that works", () => {
  test("is left out of the read; every other column and the formula keep their own values", async () => {
    const table: DashboardTableComponent = tableWith([
      REQUESTS,
      JUST_ADDED,
      DOUBLED,
    ]);
    const stored: string = JSON.stringify(table);

    render(
      <DashboardTableComponentElement {...baseProps()} component={table} />,
    );

    await waitFor(() => {
      expect(rowByHeader("checkout")["Requests"]).toBe("12");
    });

    const asked: Parameters<FetchResults>[0] =
      fetchResultsMock.mock.calls[0]![0];

    // Only the column that names a metric is asked for, then the formula.
    expect(
      asked.metricViewData.queryConfigs.map(
        (config: { metricAliasData: { metricVariable?: string } }) => {
          return config.metricAliasData.metricVariable;
        },
      ),
    ).toEqual(["a"]);
    expect(asked.metricViewData.formulaConfigs).toHaveLength(1);

    const row: Record<string, string> = rowByHeader("checkout");

    expect(row["Requests"]).toBe("12");
    // The formula's value stays in the formula's column.
    expect(row["Doubled"]).toBe("24");
    // And the new column holds no value at all, none of another's.
    expect(row).toHaveProperty("Just added");
    expect(row["Just added"]).not.toMatch(/\d/);
    expect(
      screen.queryByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
    ).not.toBeInTheDocument();
    expect(JSON.stringify(table)).toBe(stored);
  });
});

describe("a read that fails says why, in every widget's error line", () => {
  test.each([["en"], ["de"], ["ar"]])(
    "in %s: a time range with no start or end, in the reader's words",
    async (language: string) => {
      await speak(language);

      render(
        <DashboardTableComponentElement
          {...baseProps()}
          dashboardStartAndEndDate={{
            range: TimeRange.CUSTOM,
            startAndEndDate: {
              startValue: null,
              endValue: null,
            } as unknown as InBetween<Date>,
          }}
          component={tableWith([REQUESTS])}
        />,
      );

      const line: HTMLElement = await screen.findByTestId(
        DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
      );

      expect(line).toHaveTextContent(
        inLanguage("Please select a valid start and end date.", language),
      );
      expect(line.className).toBe(DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME);
      expect(line).not.toHaveClass("text-gray-400");
      expect(line).not.toHaveClass("max-w-48");
      expect(
        within(screen.getByTestId(DASHBOARD_WIDGET_ERROR_TEST_ID)).getByTestId(
          DASHBOARD_WIDGET_ERROR_LINE_TEST_ID,
        ),
      ).toBe(line);
      expect(fetchResultsMock).not.toHaveBeenCalled();
    },
  );
});
