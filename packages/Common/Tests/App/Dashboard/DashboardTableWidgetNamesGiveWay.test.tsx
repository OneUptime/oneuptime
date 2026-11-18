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
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import DashboardTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  DashboardWidgetIdContext,
  WIDGET_TABLE_NAME_LINE_CLASS_NAME,
  WIDGET_TABLE_TEXT_CELL_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetColumns";
import DashboardTableComponent, {
  TableColumnKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardDataSourceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DataSourceTableResult, {
  DataSourceTableColumnType,
} from "../../../Types/DataSource/DataSourceTableResult";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { COLUMN_RESIZE_HANDLE_TEST_ID } from "../../../UI/Components/Table/ColumnResize/ColumnResizeLayout";
import { getSizedColumnsCss } from "../../../UI/Components/Table/ColumnResize/ColumnWidths";
import User from "../../../UI/Utils/User";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A TABLE WIDGET'S LONG GROUP NAME GIVES WAY TO ITS NUMBERS (#7524).
 *
 * On a phone, a metric Table whose group column held one long name showed
 * only that column: its cells were cut short to one line (truncate), a
 * line that may not break is as wide at its least as at its most, and the
 * browser's table layout made the column as wide as the name - the whole
 * widget at 390px. The Errors column, the number the widget exists for,
 * sat past the edge, and the long name itself was not cut.
 *
 * A group's name is drawn in a box of its own now: it may break between
 * any two letters, so the column can give way, and shows its first line
 * only, ending in "..." (WIDGET_TABLE_NAME_LINE_CLASS_NAME). A name that
 * fits is drawn as it was. This suite holds the cells' shape; the browser
 * suite (packages/E2E/DashboardTableThresholds) draws a long name at
 * 390px and reads that its numbers stay inside the widget.
 */

type FetchResults = (data: unknown) => Promise<Array<AggregatedResult>>;
type FetchTable = (data: unknown) => Promise<DataSourceTableResult>;

const fetchResultsMock: Mock<FetchResults> = jest.fn<FetchResults>();
const fetchTableMock: Mock<FetchTable> = jest.fn<FetchTable>();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (data: unknown) => {
          return fetchResultsMock(data);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/DataSourceQuery",
  () => {
    return {
      __esModule: true,
      default: {
        fetchTable: (data: unknown) => {
          return fetchTableMock(data);
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

const LONG_NAME: string = "payments-webhook-consumer-eu-west-production";
const SHORT_NAME: string = "checkout";
const PERSON: string = "8a3b0c3e-0000-4000-8000-000000007524";
const WIDGET_ID: string = "widget-errors-by-service";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000007524",
);

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-12T09:00:00.000Z"),
    new Date("2026-11-12T10:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function baseProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "table-on-a-phone",
    onComponentUpdate: (): void => {
      // A table never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 390,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 390,
    dashboardCanvasHeightInPx: 844,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 358,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    dashboardId: "d0000000-0000-4000-8000-000000007524",
  };
}

function point(service: unknown, value: number): AggregatedModel {
  return {
    timestamp: new Date("2026-11-12T09:30:00.000Z"),
    value,
    attributes: { "service.name": service },
  } as unknown as AggregatedModel;
}

function tableComponent(): DashboardTableComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Table,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: {
      columns: [
        {
          id: "errors",
          variable: "a",
          header: "Errors",
          kind: TableColumnKind.Metric,
          metricName: "http.server.errors",
          aggregation: MetricsAggregationType.Sum,
        },
      ],
      groupByAttributes: [{ key: "service.name", header: "Service" }],
      maxRows: 25,
    } as DashboardTableComponent["arguments"],
  };
}

function dataSourceComponent(): DashboardDataSourceTableComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceTable,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: {
      query: { dataSourceId: "ds-pg", query: "select 1" },
    } as DashboardDataSourceTableComponent["arguments"],
  };
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

async function renderMetricTable(
  widgetId: string | null = null,
): Promise<RenderResult> {
  const result: RenderResult = render(
    <DashboardWidgetIdContext.Provider value={widgetId}>
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent()}
      />
    </DashboardWidgetIdContext.Provider>,
  );

  await screen.findByText(LONG_NAME);

  return result;
}

// The body cell whose words are `name`.
function groupCell(name: string): HTMLElement {
  const cell: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>("tbody td"),
  ).find((candidate: HTMLElement): boolean => {
    return (candidate.textContent || "").trim() === name;
  });

  expect(cell).toBeDefined();

  return cell as HTMLElement;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  fetchResultsMock.mockReset();
  fetchTableMock.mockReset();
  window.localStorage.clear();
  jest.spyOn(User, "getUserId").mockImplementation((): ObjectID => {
    return new ObjectID(PERSON);
  });
  fetchResultsMock.mockResolvedValue([
    {
      data: [point(LONG_NAME, 12), point(SHORT_NAME, 3), point([], 4)],
    } as AggregatedResult,
  ]);
  fetchTableMock.mockResolvedValue({
    columns: [
      {
        key: "service",
        title: "Service",
        type: DataSourceTableColumnType.Text,
      },
      {
        key: "errors",
        title: "Errors",
        type: DataSourceTableColumnType.Number,
      },
    ],
    rows: [
      { service: LONG_NAME, errors: 12 },
      { service: SHORT_NAME, errors: 3 },
    ],
    truncated: false,
  });
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("a metric Table's group cell", () => {
  test("draws its name in a box that may break anywhere and shows one line", async () => {
    await renderMetricTable();

    const cell: HTMLElement = groupCell(LONG_NAME);
    const box: Element | null = cell.firstElementChild;

    expect(box?.tagName).toBe("DIV");
    expect(box?.textContent).toBe(LONG_NAME);

    for (const className of WIDGET_TABLE_NAME_LINE_CLASS_NAME.split(" ")) {
      expect(box).toHaveClass(className);
    }

    expect(WIDGET_TABLE_NAME_LINE_CLASS_NAME.split(" ")).toEqual([
      "line-clamp-1",
      "whitespace-normal",
      "break-all",
    ]);
  });

  /*
   * A cell that may not break its line (truncate's white-space: nowrap) is
   * as wide at its least as its name: the cause, held out of the cell
   * itself, where the box inside it would inherit it.
   */
  test("the cell itself no longer keeps its line from breaking", async () => {
    await renderMetricTable();

    for (const name of [LONG_NAME, SHORT_NAME]) {
      const cell: HTMLElement = groupCell(name);

      expect(cell).not.toHaveClass("truncate");
      expect(cell).not.toHaveClass("whitespace-nowrap");
    }
  });

  test("the whole name is one hover away, where its line is cut", async () => {
    await renderMetricTable();

    expect(groupCell(LONG_NAME)).toHaveAttribute("title", LONG_NAME);
    expect(groupCell(SHORT_NAME)).toHaveAttribute("title", SHORT_NAME);
  });

  test("a group with no value: the reader's word, in its gray, inside the same box", async () => {
    await inLanguage("de");
    await renderMetricTable();

    const word: string = readDashboardLocale("de")["(unset)"] as string;
    const cell: HTMLElement = groupCell(word);

    expect(cell.firstElementChild?.tagName).toBe("DIV");
    expect(cell.querySelector("div > span.text-gray-500")).toHaveTextContent(
      word,
    );
    expect(cell).not.toHaveAttribute("title");
  });

  test.each(["ar", "fa"])(
    "on a %s board an English name reads left to right, so it is cut at its own end",
    async (language: string) => {
      await inLanguage(language);
      await renderMetricTable();

      const cell: HTMLElement = groupCell(LONG_NAME);

      expect(cell).toHaveAttribute("dir", "ltr");
      expect(cell.firstElementChild).toHaveClass("line-clamp-1");
    },
  );

  test("the value cells keep their alignment and figures", async () => {
    await renderMetricTable();

    const row: HTMLElement = groupCell(LONG_NAME).closest("tr") as HTMLElement;
    const valueCell: HTMLElement = row.querySelectorAll("td")[1] as HTMLElement;

    expect(valueCell).toHaveTextContent("12");
    expect(valueCell.className).toMatch(/text-(right|end)/);
    expect(valueCell.className).toMatch(/tabular-nums|whitespace-nowrap/);
  });

  /*
   * A column a person sized keeps its width: the sized column's rules
   * (getSizedColumnsCss) are written for its value boxes, "td > div", and
   * the name's box is that box - so the rules reach it, and it fills the
   * width the person gave the column whatever its name.
   */
  test("a column a person sized keeps its width: its rules reach the name's box", async () => {
    const { container } = await renderMetricTable(WIDGET_ID);

    const edge: HTMLElement | null = container.querySelector(
      `[data-testid="${COLUMN_RESIZE_HANDLE_TEST_ID}"]`,
    );

    expect(edge).not.toBeNull();

    act(() => {
      fireEvent.keyDown(edge as HTMLElement, { key: "ArrowRight" });
    });
    act(() => {
      fireEvent.keyUp(edge as HTMLElement, { key: "ArrowRight" });
    });

    const rules: string = Array.from(
      document.querySelectorAll("style[data-column-widths-style]"),
    )
      .map((style: Element): string => {
        return style.textContent || "";
      })
      .join("\n");

    expect(rules).toContain(
      "> tbody > tr > td:nth-child(1) > div { max-width: none; min-width: 0; contain: inline-size;",
    );

    // The name's box is the cell's first child: the box those rules size.
    expect(groupCell(LONG_NAME).firstElementChild?.tagName).toBe("DIV");
    expect(
      getSizedColumnsCss({
        scope: "scope",
        cellNumbers: [1],
        clipsValueBoxes: true,
      }),
    ).toContain("td:nth-child(1) > div");
  });
});

describe("a Data Source Table's text cell", () => {
  test("lets a word too long for its column break, and a number keep its line", async () => {
    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps()}
        component={dataSourceComponent()}
      />,
    );

    await screen.findByText(LONG_NAME);

    const text: HTMLElement = groupCell(LONG_NAME);
    const row: HTMLElement = text.closest("tr") as HTMLElement;
    const number: HTMLElement = row.querySelectorAll("td")[1] as HTMLElement;

    expect(WIDGET_TABLE_TEXT_CELL_CLASS_NAME).toBe("[overflow-wrap:anywhere]");
    expect(text).toHaveClass(WIDGET_TABLE_TEXT_CELL_CLASS_NAME);
    expect(number).not.toHaveClass(WIDGET_TABLE_TEXT_CELL_CLASS_NAME);
    expect(number).toHaveClass("tabular-nums");
  });
});

describe("the tables' source", () => {
  const COMPONENTS_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components",
  );

  test("the metric Table draws its group names in the box that gives way", () => {
    const source: string = fs.readFileSync(
      path.join(COMPONENTS_DIR, "DashboardTableComponent.tsx"),
      "utf8",
    );

    expect(source).toContain("className={WIDGET_TABLE_NAME_LINE_CLASS_NAME}");
    // No group cell cut short the old way, which kept the column as wide as its name.
    expect(source).not.toContain(
      'className="px-3 py-2 text-gray-700 text-xs truncate"',
    );
  });
});
