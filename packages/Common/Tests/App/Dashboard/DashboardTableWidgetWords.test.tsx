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
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import DashboardTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
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
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A TABLE'S WORDS, ON EVERY BOARD (#7091, #7092).
 *
 * A metric Table grouped by an attribute drew "(unset)" for a group whose
 * attribute holds nothing - in English on every board. It is the reader's
 * word now: "(nicht gesetzt)" on a German board.
 *
 * And a Table's or a Data Source Table's description was a plain
 * paragraph: on an Arabic or Persian board an English description ran
 * from the right, its full stop at its start and each wrapped line ragged
 * where it starts. It is drawn as a widget's line now: an English one
 * there reads left to right, each of its lines from its own start, the
 * box at the board's start (it wraps, so it is lined up by its width, not
 * by its end). An Arabic description there, and every description on a
 * German or English board, is drawn as it was.
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

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000007091",
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

const UNSET: string = "(unset)";
const TRUNCATED: string = "(truncated)";
const ENGLISH_TRUNCATED_WORD: RegExp = /truncated/i;
const ENGLISH_DESCRIPTION: string =
  "Errors per service, over the dashboard's window.";
const ARABIC_DESCRIPTION: string = "الأخطاء لكل خدمة خلال نافذة اللوحة.";
/*
 * A description's classes on a board that reads its words' way: as they
 * were, and whitespace-normal - a paragraph's own white-space, written out
 * so its line knows it wraps (lined up by its width, not by its end, where
 * it reads the other way).
 */
const DESCRIPTION_CLASS_NAME: string =
  "mt-0.5 text-xs text-gray-400 whitespace-normal";

function baseProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "worded-table",
    onComponentUpdate: (): void => {
      // A table never writes back through this.
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
    dashboardId: "d0000000-0000-4000-8000-000000007091",
  };
}

// A point of the metric, its service attribute as given.
function point(service: unknown, value: number): AggregatedModel {
  return {
    timestamp: new Date("2026-11-12T09:30:00.000Z"),
    value,
    attributes: { "service.name": service },
  } as unknown as AggregatedModel;
}

function tableComponent(
  widgetArguments: JSONObject = {},
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
      ...widgetArguments,
    } as DashboardTableComponent["arguments"],
  };
}

function dataSourceComponent(
  widgetArguments: JSONObject = {},
): DashboardDataSourceTableComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.DataSourceTable,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: {
      query: { dataSourceId: "ds-pg", query: "select 1" },
      ...widgetArguments,
    } as DashboardDataSourceTableComponent["arguments"],
  };
}

const TABLE_RESULT: DataSourceTableResult = {
  columns: [
    { key: "service", title: "Service", type: DataSourceTableColumnType.Text },
    { key: "errors", title: "Errors", type: DataSourceTableColumnType.Number },
  ],
  rows: [
    { service: "checkout", errors: 12 },
    { service: "search", errors: 3 },
  ],
  truncated: false,
};

// The first cell of each body row, in the order drawn.
function firstCells(): Array<HTMLElement> {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (row: Element): HTMLElement => {
      return row.querySelector("td") as HTMLElement;
    },
  );
}

async function renderMetricTable(
  widgetArguments: JSONObject = {},
): Promise<void> {
  render(
    <DashboardTableComponentElement
      {...baseProps()}
      component={tableComponent(widgetArguments)}
    />,
  );

  await screen.findByText("checkout");
}

async function renderDataSourceTable(
  widgetArguments: JSONObject = {},
): Promise<void> {
  render(
    <DashboardDataSourceTableComponentElement
      {...baseProps()}
      component={dataSourceComponent(widgetArguments)}
    />,
  );

  await screen.findByText("checkout");
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
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
  fetchResultsMock.mockResolvedValue([
    {
      /*
       * A service attribute that holds an empty list: the one group the
       * Table draws as unset (a point without the attribute is dropped).
       */
      data: [point("checkout", 12), point([], 4), point("search", 3)],
    } as AggregatedResult,
  ]);
  fetchTableMock.mockResolvedValue(TABLE_RESULT);
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("a metric Table's group whose attribute holds nothing", () => {
  // The cell that says the group's attribute holds nothing.
  function unsetCell(word: string): HTMLElement {
    const cells: Array<HTMLElement> = firstCells().filter(
      (cell: HTMLElement): boolean => {
        return (cell.textContent || "").trim() === word;
      },
    );

    expect(cells).toHaveLength(1);

    return cells[0]!;
  }

  test("an English board says (unset), as it always did, in the gray a table draws a missing value in", async () => {
    await renderMetricTable();

    const cell: HTMLElement = unsetCell(UNSET);
    const word: HTMLElement = cell.querySelector("span") as HTMLElement;

    expect(word).toHaveTextContent(UNSET);
    // TableEmptyValue's gray: gray-300 was 1.5:1 on a light card.
    expect(word).toHaveClass("text-gray-400");
    expect(word).not.toHaveClass("text-gray-300");
  });

  test("a German board says (nicht gesetzt)", async () => {
    await inLanguage("de");
    await renderMetricTable();

    unsetCell("(nicht gesetzt)");
    expect(document.body).not.toHaveTextContent(UNSET);
  });

  test.each(["fa", "ar"])(
    "a %s board says its own word for it, and reads it its own way",
    async (language: string) => {
      const word: string = readDashboardLocale(language)[UNSET]!;

      await inLanguage(language);
      await renderMetricTable();

      const cell: HTMLElement = unsetCell(word);

      expect(word).not.toBe(UNSET);
      expect(document.body).not.toHaveTextContent(UNSET);
      // An empty value decides nothing: the cell is the board's.
      expect(cell).not.toHaveAttribute("dir");
    },
  );

  test("every Dashboard language says its own word for it", async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        worded: isWordedInDashboardLocale(UNSET, language),
      }).toEqual({ language, worded: true });

      await inLanguage(language);
      await renderMetricTable();

      unsetCell(readDashboardLocale(language)[UNSET]!);
      cleanup();
    }
  });

  test("a group whose attribute holds a value shows the value, on every board", async () => {
    for (const language of ["en", "de", "fa", "ar"]) {
      await inLanguage(language);
      await renderMetricTable();

      const values: Array<string> = firstCells().map(
        (cell: HTMLElement): string => {
          return (cell.textContent || "").trim();
        },
      );

      expect(values).toContain("checkout");
      expect(values).toContain("search");
      cleanup();
    }
  });
});

// A table widget with a description, and how to draw it.
interface DescribedTable {
  widget: string;
  draw: (widgetArguments?: JSONObject) => Promise<void>;
}

const DESCRIBED_TABLES: Array<DescribedTable> = [
  {
    widget: "a metric Table",
    draw: renderMetricTable,
  },
  {
    widget: "a Data Source Table",
    draw: renderDataSourceTable,
  },
];

describe.each(DESCRIBED_TABLES)(
  "$widget's description",
  ({ draw }: DescribedTable) => {
    function descriptionOf(text: string): HTMLElement {
      const description: HTMLElement = screen.getByText(text);

      expect(description.tagName).toBe("P");

      return description;
    }

    test.each(["ar", "fa"])(
      "on a %s board an English description reads left to right, each of its lines from its own start",
      async (language: string) => {
        await inLanguage(language);
        await draw({
          tableTitle: "Checkout errors",
          tableDescription: ENGLISH_DESCRIPTION,
        });

        const description: HTMLElement = descriptionOf(ENGLISH_DESCRIPTION);

        expect(description).toHaveAttribute("dir", "ltr");
        // It wraps: lined up by its width at the board's start, not by its end.
        expect(description).toHaveClass(
          "whitespace-normal",
          CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
        );
        expect(description).not.toHaveClass(
          LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
        );
        expect(description).not.toHaveClass("truncate");
      },
    );

    test("on an Arabic board an Arabic description is drawn as it was", async () => {
      await inLanguage("ar");
      await draw({
        tableTitle: "Checkout errors",
        tableDescription: ARABIC_DESCRIPTION,
      });

      const description: HTMLElement = descriptionOf(ARABIC_DESCRIPTION);

      expect(description).not.toHaveAttribute("dir");
      expect(description.className).toBe(DESCRIPTION_CLASS_NAME);
    });

    test.each(["de", "en"])(
      "on a %s board an English description is drawn as it always was",
      async (language: string) => {
        await inLanguage(language);
        await draw({
          tableTitle: "Checkout errors",
          tableDescription: ENGLISH_DESCRIPTION,
        });

        const description: HTMLElement = descriptionOf(ENGLISH_DESCRIPTION);

        expect(description).not.toHaveAttribute("dir");
        expect(description.className).toBe(DESCRIPTION_CLASS_NAME);
      },
    );

    test("on a German board an Arabic description reads right to left", async () => {
      await inLanguage("de");
      await draw({
        tableTitle: "Checkout errors",
        tableDescription: ARABIC_DESCRIPTION,
      });

      expect(descriptionOf(ARABIC_DESCRIPTION)).toHaveAttribute("dir", "rtl");
    });

    test("a description alone, with no title, is drawn the same way", async () => {
      await inLanguage("fa");
      await draw({ tableDescription: ENGLISH_DESCRIPTION });

      expect(descriptionOf(ENGLISH_DESCRIPTION)).toHaveAttribute("dir", "ltr");
    });

    test("no description, no paragraph", async () => {
      await inLanguage("ar");
      await draw({ tableTitle: "Checkout errors" });

      expect(document.querySelector("p")).toBeNull();
    });
  },
);

/*
 * A Data Source Table whose query returned more rows than it keeps says so
 * after its count: "2 rows (truncated)". The mark was English in fourteen
 * of the Dashboard's languages ("2 Zeilen (truncated)" on a German board).
 */
describe("a Data Source Table cut short", () => {
  // The count beside the table's title, with the mark after it.
  function countLine(): HTMLElement {
    const line: HTMLElement | undefined = Array.from(
      document.querySelectorAll("span"),
    ).find((span: HTMLSpanElement): boolean => {
      return span.classList.contains("tabular-nums");
    });

    expect(line).toBeDefined();

    return line!;
  }

  beforeEach(() => {
    fetchTableMock.mockResolvedValue({ ...TABLE_RESULT, truncated: true });
  });

  test("an English board says the rows were truncated, as it always did", async () => {
    await renderDataSourceTable();

    expect(countLine()).toHaveTextContent("2 rows (truncated)");
  });

  test("a German board says (gekürzt)", async () => {
    await inLanguage("de");
    await renderDataSourceTable();

    expect(countLine()).toHaveTextContent("2 Zeilen (gekürzt)");
    expect(document.body).not.toHaveTextContent(TRUNCATED);
  });

  test("a table that kept every row says nothing of it", async () => {
    fetchTableMock.mockResolvedValue(TABLE_RESULT);
    await inLanguage("de");
    await renderDataSourceTable();

    expect(countLine()).toHaveTextContent("2 Zeilen");
    expect(countLine()).not.toHaveTextContent("(gekürzt)");
  });

  test("every Dashboard language says it in its own words", async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const word: string = readDashboardLocale(language)[TRUNCATED] || "";

      expect({
        language,
        worded: isWordedInDashboardLocale(TRUNCATED, language),
        english: ENGLISH_TRUNCATED_WORD.test(word),
      }).toEqual({ language, worded: true, english: false });

      await inLanguage(language);
      await renderDataSourceTable();

      expect(countLine()).toHaveTextContent(word);
      expect(document.body).not.toHaveTextContent(ENGLISH_TRUNCATED_WORD);
      cleanup();
    }
  });

  test("the check finds the English word wherever it is left", () => {
    // The negative control: the English mark, as fourteen languages held it.
    expect(
      ENGLISH_TRUNCATED_WORD.test(readDashboardLocale("en")[TRUNCATED]!),
    ).toBe(true);
    expect(ENGLISH_TRUNCATED_WORD.test("2 Zeilen (truncated)")).toBe(true);
    expect(ENGLISH_TRUNCATED_WORD.test("2 Zeilen (gekürzt)")).toBe(false);
  });
});
