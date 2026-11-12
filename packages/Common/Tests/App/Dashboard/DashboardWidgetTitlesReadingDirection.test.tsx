import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import DashboardTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTableComponent";
import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardTraceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceTableComponent";
import DashboardNetworkMapComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardNetworkMapComponent";
import DashboardResourceHoneycomb, {
  HoneycombTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb";
import GaugeWidgetView, {
  GAUGE_BOUNDS_TEST_ID,
  GaugeWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/GaugeWidgetView";
import ValueWidgetView, {
  ValueWidgetViewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/ValueWidgetView";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardDataSourceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import DashboardNetworkMapComponent from "../../../Types/Dashboard/DashboardComponents/DashboardNetworkMapComponent";
import DashboardTableComponent, {
  TableColumnKind,
} from "../../../Types/Dashboard/DashboardComponents/DashboardTableComponent";
import DashboardTraceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTraceTableComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DataSourceTableResult, {
  DataSourceTableColumnType,
} from "../../../Types/DataSource/DataSourceTableResult";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
  LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME,
} from "../../../UI/Utils/LineDirection";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A DASHBOARD WIDGET'S TITLE, AND A TABLE WIDGET'S NAMES, ON AN ARABIC OR
 * PERSIAN BOARD (#6858, #6927).
 *
 * A widget's title is words someone wrote, in their language whatever the
 * board's, and most widgets cut it where the widget ends (truncate). On an
 * Arabic or Persian board an English title was cut at its start: "Buyers
 * who buy again (8 units, monthly range)" read "...y again (8 units,
 * monthly range)". The Funnel and User Retention widgets' title was the
 * one reported (ProductAnalyticsWidgetsInRtl); the Table, Data Source
 * Table, Gauge, SLO, Value and Network Map widgets cut theirs the same way,
 * and the Table and Trace Table widgets cut the names in their rows (a
 * service, a span) as the list widgets did (DashboardListWidgetNameCells),
 * as does a list's honeycomb in its tooltip.
 *
 * Each is rendered here for real: on an Arabic or Persian board an English
 * title or name reads left to right, so it is cut at its own end - lined
 * up on the board's side, or kept in the middle where it is centred; the
 * board's own words, and figures, are drawn as they were, and on a German
 * or English board everything is.
 */

type FetchResults = (data: unknown) => Promise<Array<AggregatedResult>>;
type ApiPost = (data: {
  url: unknown;
  data: JSONObject;
}) => Promise<{ data: JSONObject }>;
type FetchTable = (data: unknown) => Promise<DataSourceTableResult>;
type ListRequest = { query: JSONObject; limit: number };
type ListResponse = { data: Array<JSONObject>; count: number };

const fetchResultsMock: Mock<FetchResults> = jest.fn<FetchResults>();
const apiPostMock: Mock<ApiPost> = jest.fn<ApiPost>();
const fetchTableMock: Mock<FetchTable> = jest.fn<FetchTable>();
const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (data: { url: unknown; data: JSONObject }) => {
        return apiPostMock(data);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (request: ListRequest) => {
        return listMock(request);
      },
    },
  };
});

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("44444444-4444-4444-8444-444444444444");
      },
    },
  };
});

// The map's land outlines: none, and nothing to fetch.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldGeometry",
  () => {
    return {
      __esModule: true,
      getCachedGeometryFeatures: () => {
        return [];
      },
      loadGeometryFeatures: () => {
        return Promise.resolve([]);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return React.createElement("a", {}, props.children);
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/dashboard/resource";
          },
        };
      },
    },
  };
});

const ENGLISH_TITLE: string = "Checkout errors by service (EU West)";
const ARABIC_TITLE: string = "أخطاء الدفع حسب الخدمة";
const ENGLISH_SERVICE: string = "checkout-api-production";
const ARABIC_SERVICE: string = "خدمة الدفع";

const AR: Record<string, string> = readDashboardLocale("ar");

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-0000000000e1",
);
const DASHBOARD_ID: string = "d0000000-0000-4000-8000-0000000000e2";

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-10T10:00:00.000Z"),
    new Date("2026-11-10T11:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

const PUBLIC_DASHBOARD: PublicDashboardContext = {
  dashboardId: new ObjectID(DASHBOARD_ID),
  apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
  postJSON: async () => {
    throw new Error("Unexpected public request");
  },
  apiClient: {} as unknown as PublicDashboardContext["apiClient"],
};

function baseProps(): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "titled-widget",
    onComponentUpdate: (): void => {
      // The widgets never write back through this.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 400,
    dashboardComponentWidthInPx: 640,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    dashboardId: DASHBOARD_ID,
  };
}

/*
 * The body cells whose whole text is `text`, and the one element drawing
 * `text` with nothing else in it (a title).
 */
function cellsHolding(container: HTMLElement, text: string): Array<Element> {
  return Array.from(container.querySelectorAll("tbody td")).filter(
    (cell: Element): boolean => {
      return (cell.textContent || "").trim() === text;
    },
  );
}

function lineOf(text: string): HTMLElement {
  return screen.getByText((_content: string, element: Element | null) => {
    return (
      element !== null &&
      element.children.length === 0 &&
      (element.textContent || "").trim() === text
    );
  });
}

// What a reader of `language` sees: a one-line box cut at the English line's end.
function expectOneLineReadLeftToRight(element: Element | null): void {
  expect(element).toHaveAttribute("dir", "ltr");
  expect(element).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
}

function expectDrawnAsItWas(element: Element | null): void {
  expect(element).not.toHaveAttribute("dir");
  expect(element).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// A list's honeycomb watches its width; jsdom has no ResizeObserver.
class StillResizeObserver {
  public observe(): void {
    // Nothing resizes here.
  }

  public unobserve(): void {
    // Nothing to stop watching.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StillResizeObserver;

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: AR },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

beforeEach(async () => {
  fetchResultsMock.mockReset();
  apiPostMock.mockReset();
  fetchTableMock.mockReset();
  listMock.mockReset();
  window.localStorage.clear();
  setPublicDashboardContext(null);
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

describe("a metric Table widget: its title and the names in its rows", () => {
  function point(service: string, value: number): AggregatedModel {
    return {
      timestamp: new Date("2026-11-10T10:30:00.000Z"),
      value,
      attributes: { "service.name": service },
    } as unknown as AggregatedModel;
  }

  function tableComponent(title: string): DashboardTableComponent {
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
        tableTitle: title,
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

  async function drawTable(title: string): Promise<RenderResult> {
    fetchResultsMock.mockResolvedValue([
      {
        data: [point(ENGLISH_SERVICE, 12), point(ARABIC_SERVICE, 3)],
      } as AggregatedResult,
    ]);

    const result: RenderResult = render(
      <DashboardTableComponentElement
        {...baseProps()}
        component={tableComponent(title)}
      />,
    );

    await screen.findByText(ENGLISH_SERVICE);

    return result;
  }

  test.each(["ar", "fa"])(
    "on a %s board an English title and an English service read left to right; the figures are the board's",
    async (language: string) => {
      await inLanguage(language);
      const { container } = await drawTable(ENGLISH_TITLE);

      const title: HTMLElement = screen.getByRole("heading", {
        name: ENGLISH_TITLE,
      });

      expect(title.tagName).toBe("H3");
      expectOneLineReadLeftToRight(title);
      expectOneLineReadLeftToRight(
        cellsHolding(container, ENGLISH_SERVICE)[0] || null,
      );
      expectDrawnAsItWas(cellsHolding(container, ARABIC_SERVICE)[0] || null);

      // A metric's cell is a figure: written for its reader already.
      const rows: Array<Element> = Array.from(
        container.querySelectorAll("tbody tr"),
      );

      for (const row of rows) {
        const cells: Array<Element> = Array.from(row.querySelectorAll("td"));
        expect(cells[cells.length - 1]).not.toHaveAttribute("dir");
      }
    },
  );

  test("on an Arabic board an Arabic title is drawn as it was", async () => {
    await inLanguage("ar");
    await drawTable(ARABIC_TITLE);

    expectDrawnAsItWas(screen.getByRole("heading", { name: ARABIC_TITLE }));
  });

  test("on a German board the English title and names are drawn as they always were; an Arabic service reads right to left", async () => {
    await inLanguage("de");
    const { container } = await drawTable(ENGLISH_TITLE);

    const title: HTMLElement = screen.getByRole("heading", {
      name: ENGLISH_TITLE,
    });

    expectDrawnAsItWas(title);
    expect(title).toHaveClass("truncate");
    expectDrawnAsItWas(cellsHolding(container, ENGLISH_SERVICE)[0] || null);
    expect(cellsHolding(container, ARABIC_SERVICE)[0]).toHaveAttribute(
      "dir",
      "rtl",
    );
  });

  test("on a public dashboard - an English page - an English title is drawn as the page draws it, whatever its visitor reads", async () => {
    setPublicDashboardContext(PUBLIC_DASHBOARD);
    await inLanguage("ar");
    const { container } = await drawTable(ENGLISH_TITLE);

    expectDrawnAsItWas(screen.getByRole("heading", { name: ENGLISH_TITLE }));
    expectDrawnAsItWas(cellsHolding(container, ENGLISH_SERVICE)[0] || null);
  });
});

describe("a Data Source Table widget's title", () => {
  function dataSourceComponent(
    title: string,
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
        tableTitle: title,
        query: { dataSourceId: "ds-pg", query: "select 1" },
      } as DashboardDataSourceTableComponent["arguments"],
    };
  }

  async function drawDataSourceTable(title: string): Promise<void> {
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
      rows: [{ service: ENGLISH_SERVICE, errors: 12 }],
      truncated: false,
    });

    render(
      <DashboardDataSourceTableComponentElement
        {...baseProps()}
        component={dataSourceComponent(title)}
      />,
    );

    await screen.findByText(ENGLISH_SERVICE);
  }

  test.each(["ar", "fa"])(
    "on a %s board an English title reads left to right, cut at its own end",
    async (language: string) => {
      await inLanguage(language);
      await drawDataSourceTable(ENGLISH_TITLE);

      const title: HTMLElement = screen.getByRole("heading", {
        name: ENGLISH_TITLE,
      });

      expect(title.tagName).toBe("H3");
      expectOneLineReadLeftToRight(title);
    },
  );

  test("on an Arabic board an Arabic title, and on a German board an English one, are drawn as they were", async () => {
    await inLanguage("ar");
    await drawDataSourceTable(ARABIC_TITLE);
    expectDrawnAsItWas(screen.getByRole("heading", { name: ARABIC_TITLE }));
    cleanup();

    await inLanguage("de");
    await drawDataSourceTable(ENGLISH_TITLE);
    expectDrawnAsItWas(screen.getByRole("heading", { name: ENGLISH_TITLE }));
  });
});

describe("a Trace Table widget's groups", () => {
  function traceTableComponent(): DashboardTraceTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.TraceTable,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: {
        groupByAttribute: "name",
        topLimit: 10,
      } as DashboardTraceTableComponent["arguments"],
    };
  }

  function traceRow(name: string, count: number): JSONObject {
    return {
      groupValues: { name },
      count,
      errorCount: 1,
      avgDurationMs: 10,
      p50DurationMs: 9,
      p90DurationMs: 20,
      p95DurationMs: 25,
      p99DurationMs: 40,
      minDurationMs: 1,
      maxDurationMs: 80,
    };
  }

  async function drawTraceTable(): Promise<RenderResult> {
    apiPostMock.mockResolvedValue({
      data: {
        data: [
          traceRow("GET /api/checkout/cart", 120),
          traceRow(ARABIC_SERVICE, 30),
          traceRow("", 4),
        ],
      },
    });

    const result: RenderResult = render(
      <DashboardTraceTableComponentElement
        {...baseProps()}
        component={traceTableComponent()}
      />,
    );

    await screen.findByText("GET /api/checkout/cart");

    return result;
  }

  test.each(["ar", "fa"])(
    "on a %s board a span's English name reads left to right; the board's words and the counts are the board's",
    async (language: string) => {
      await inLanguage(language);
      const { container } = await drawTraceTable();

      expectOneLineReadLeftToRight(
        cellsHolding(container, "GET /api/checkout/cart")[0] || null,
      );
      expectDrawnAsItWas(cellsHolding(container, ARABIC_SERVICE)[0] || null);

      // A group with no value is named in the board's words.
      const emptyWord: string = readDashboardLocale(language)["(empty)"]!;
      expect(emptyWord).not.toBe("(empty)");
      expectDrawnAsItWas(cellsHolding(container, emptyWord)[0] || null);

      // The rank and the figures: no dir of their own.
      for (const row of Array.from(container.querySelectorAll("tbody tr"))) {
        const cells: Array<Element> = Array.from(row.querySelectorAll("td"));
        expect(cells[0]).not.toHaveAttribute("dir");
        for (const figure of cells.slice(2)) {
          expect(figure).not.toHaveAttribute("dir");
        }
      }
    },
  );

  test("on a German board a span's English name is drawn as it always was", async () => {
    await inLanguage("de");
    const { container } = await drawTraceTable();

    const cell: Element | undefined = cellsHolding(
      container,
      "GET /api/checkout/cart",
    )[0];

    expectDrawnAsItWas(cell || null);
    expect(cell).toHaveClass("max-w-[280px]", "truncate", "whitespace-nowrap");
  });
});

describe("a Gauge's title, centred over the gauge", () => {
  const GAUGE_PROPS: GaugeWidgetViewProps = {
    widthInPx: 400,
    heightInPx: 260,
    componentId: "gauge-a",
    isLoading: false,
    hasEverLoaded: true,
    error: null,
    value: 42,
    noDataMessage: "No data for this query",
    isConfigured: true,
    setupTitle: "Gauge",
    setupMessage: "Click to configure this gauge",
    title: ENGLISH_TITLE,
    rawUnit: "",
    metricName: "",
    minValue: 0,
    maxValue: 100,
    warningThreshold: undefined,
    criticalThreshold: undefined,
  };

  test.each(["ar", "fa"])(
    "on a %s board an English title reads left to right and stays in the middle",
    async (language: string) => {
      await inLanguage(language);
      render(<GaugeWidgetView {...GAUGE_PROPS} />);

      const title: HTMLElement = lineOf(ENGLISH_TITLE);

      expect(title).toHaveAttribute("dir", "ltr");
      expect(title).toHaveClass("truncate", "text-center", "w-full");
      expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test("on an Arabic board an Arabic title, and on a German board an English one, are drawn as they were", async () => {
    await inLanguage("ar");
    render(<GaugeWidgetView {...GAUGE_PROPS} title={ARABIC_TITLE} />);
    expectDrawnAsItWas(lineOf(ARABIC_TITLE));
    cleanup();

    await inLanguage("de");
    render(<GaugeWidgetView {...GAUGE_PROPS} />);
    expectDrawnAsItWas(lineOf(ENGLISH_TITLE));
    expect(lineOf(ENGLISH_TITLE)).toHaveClass("text-center");
  });

  /*
   * The arc fills from the left in every language, as a chart's time runs,
   * so its bounds under it are laid out left to right too: mirrored on an
   * Arabic board, "100" sat under the end the fill starts from. The bounds
   * are written in the board's digits: Persian's own on a Persian board
   * (#7094).
   */
  test.each([
    ["ar", ["0", "100"]],
    ["fa", ["۰", "۱۰۰"]],
    ["de", ["0", "100"]],
    ["en", ["0", "100"]],
  ])(
    "on a %s board the minimum sits under the arc's left end and the maximum under its right",
    async (language: string, expectedBounds: Array<string>) => {
      await inLanguage(language);
      render(<GaugeWidgetView {...GAUGE_PROPS} />);

      const bounds: HTMLElement = screen.getByTestId(GAUGE_BOUNDS_TEST_ID);

      expect(bounds).toHaveAttribute("dir", "ltr");
      expect(
        Array.from(bounds.children).map((bound: Element): string => {
          return bound.textContent || "";
        }),
      ).toEqual(expectedBounds);
    },
  );

  // It said "HEALTHY", "WARNING" or "CRITICAL" under every gauge.
  test.each([
    ["ar", 10, "Healthy"],
    ["fa", 50, "Warning"],
    ["de", 90, "Critical"],
  ])(
    "on a %s board the gauge's state at %s is the board's word for %s",
    async (language: string, value: number, state: string) => {
      await inLanguage(language);
      render(
        <GaugeWidgetView
          {...GAUGE_PROPS}
          value={value}
          warningThreshold={40}
          criticalThreshold={80}
        />,
      );

      const word: string | undefined = readDashboardLocale(language)[state];

      expect(word).toBeTruthy();
      expect(word).not.toBe(state);
      expect(screen.getByText(word as string)).toBeInTheDocument();
      expect(screen.queryByText(state)).not.toBeInTheDocument();
    },
  );

  test("on an English board the gauge's states read as they always did", async () => {
    for (const [value, state] of [
      [10, "Healthy"],
      [50, "Warning"],
      [90, "Critical"],
    ] as Array<[number, string]>) {
      render(
        <GaugeWidgetView
          {...GAUGE_PROPS}
          value={value}
          warningThreshold={40}
          criticalThreshold={80}
        />,
      );

      expect(screen.getByText(state)).toBeInTheDocument();
      cleanup();
    }
  });
});

describe("a Value widget's title over its states", () => {
  const VALUE_PROPS: ValueWidgetViewProps = {
    widthInPx: 400,
    heightInPx: 200,
    isEditMode: false,
    isLoading: false,
    hasEverLoaded: true,
    error: null,
    value: null,
    points: [],
    noDataMessage: "No data for this query",
    isConfigured: true,
    setupTitle: "Value",
    setupMessage: "Click to configure this widget",
    title: ENGLISH_TITLE,
    rawUnit: "",
    metricName: "",
    hideUnit: false,
    warningThreshold: undefined,
    criticalThreshold: undefined,
    trendDirection: undefined,
  };

  test.each(["ar", "fa"])(
    "on a %s board, with no data, an English title reads left to right and keeps its ... (as wide as its words)",
    async (language: string) => {
      await inLanguage(language);
      render(<ValueWidgetView {...VALUE_PROPS} />);

      const title: HTMLElement = lineOf(ENGLISH_TITLE);

      expect(title.tagName).toBe("P");
      expect(title).toHaveAttribute("dir", "ltr");
      expect(title).toHaveClass(
        "line-clamp-1",
        ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
      );
      expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    },
  );

  test("on a Persian board, before it is set up, its English title reads left to right too", async () => {
    await inLanguage("fa");
    render(<ValueWidgetView {...VALUE_PROPS} isConfigured={false} />);

    const title: HTMLElement = lineOf(ENGLISH_TITLE);

    expect(title).toHaveAttribute("dir", "ltr");
    expect(title).toHaveClass(
      ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
    );
  });

  test("on an Arabic board, untitled and not set up, the widget kind's name is the board's word, drawn as it was", async () => {
    await inLanguage("ar");
    render(
      <ValueWidgetView
        {...VALUE_PROPS}
        title={undefined}
        isConfigured={false}
      />,
    );

    expect(AR["Value"]).toBeTruthy();
    expectDrawnAsItWas(lineOf(AR["Value"]!));
  });

  test("on a German board the English title is drawn as it always was", async () => {
    await inLanguage("de");
    render(<ValueWidgetView {...VALUE_PROPS} />);

    expectDrawnAsItWas(lineOf(ENGLISH_TITLE));
    expect(lineOf(ENGLISH_TITLE)).not.toHaveClass(
      ...CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME.split(" "),
    );
  });
});

describe("a Network Map widget's title", () => {
  function networkMapComponent(
    title: string | undefined,
  ): DashboardNetworkMapComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.NetworkMap,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: { title: title },
    } as unknown as DashboardNetworkMapComponent;
  }

  async function drawMap(title: string | undefined): Promise<void> {
    listMock.mockResolvedValue({
      data: [
        {
          _id: ObjectID.generate().toString(),
          name: "Amsterdam edge",
          latitude: 52.37,
          longitude: 4.9,
          currentMonitorStatus: { name: "Operational" },
        },
      ],
      count: 1,
    });

    render(
      <DashboardNetworkMapComponentElement
        {...baseProps()}
        component={networkMapComponent(title)}
      />,
    );

    await screen.findByTestId("network-map-widget");
  }

  test.each(["ar", "fa"])(
    "on a %s board an English title reads left to right, cut at its own end",
    async (language: string) => {
      await inLanguage(language);
      await drawMap(ENGLISH_TITLE);

      const title: HTMLElement = lineOf(ENGLISH_TITLE);

      expect(title.tagName).toBe("SPAN");
      expectOneLineReadLeftToRight(title);
      // The sites' count beside it is the board's.
      expectDrawnAsItWas(screen.getByTestId("network-map-widget-summary"));
    },
  );

  /*
   * As plain as the title beside it, as a list's count is: gray-300 all but
   * vanished on a light board and outshone the title on a dark one.
   */
  test("the sites' count is drawn in its title's gray", async () => {
    await drawMap(ENGLISH_TITLE);

    const summary: HTMLElement = screen.getByTestId(
      "network-map-widget-summary",
    );

    expect(lineOf(ENGLISH_TITLE)).toHaveClass("text-gray-400");
    expect(summary).toHaveClass("text-gray-400");
    expect(summary).not.toHaveClass("text-gray-300");
  });

  test("on an Arabic board the widget's own name, in Arabic, is drawn as it was", async () => {
    await inLanguage("ar");
    await drawMap(undefined);

    expect(AR["Network Map"]).toBeTruthy();
    expectDrawnAsItWas(lineOf(AR["Network Map"]!));
  });
});

describe("a list's honeycomb: a tile's name over its tooltip", () => {
  const TILES: Array<HoneycombTile> = [
    {
      id: "pod-1",
      status: "Running",
      color: "#10b981",
      tooltip: {
        title: "checkout-api-production-7d9f8b6c4-x2x9z",
        details: [
          { label: "Namespace", value: "payments-production" },
          { label: "CPU", value: "12.5%" },
        ],
      },
    },
    {
      id: "pod-2",
      status: "Running",
      color: "#10b981",
      tooltip: {
        title: ARABIC_SERVICE,
        details: [{ label: "Namespace", value: ARABIC_TITLE }],
      },
    },
  ];

  function hoverTile(container: HTMLElement, index: number): HTMLElement {
    const tiles: Array<Element> = Array.from(
      container.querySelectorAll("div.select-none"),
    );

    fireEvent.mouseEnter(tiles[index]!);

    return document.querySelector("div.fixed.z-50") as HTMLElement;
  }

  test.each(["ar", "fa"])(
    "on a %s board an English tile's name and the names under it read left to right; a figure is the board's",
    async (language: string) => {
      await inLanguage(language);
      const { container } = render(
        <DashboardResourceHoneycomb tiles={TILES} />,
      );

      const tooltip: HTMLElement = hoverTile(container, 0);

      expectOneLineReadLeftToRight(
        within(tooltip).getByText("checkout-api-production-7d9f8b6c4-x2x9z"),
      );
      expectOneLineReadLeftToRight(
        within(tooltip).getByText("payments-production"),
      );
      expectDrawnAsItWas(within(tooltip).getByText("12.5%"));
    },
  );

  test("on an Arabic board an Arabic tile's name and names are drawn as they were", async () => {
    await inLanguage("ar");
    const { container } = render(<DashboardResourceHoneycomb tiles={TILES} />);

    const tooltip: HTMLElement = hoverTile(container, 1);

    expectDrawnAsItWas(within(tooltip).getByText(ARABIC_SERVICE));
    expectDrawnAsItWas(within(tooltip).getByText(ARABIC_TITLE));
  });

  test("on a German board an English tile's name is drawn as it always was", async () => {
    await inLanguage("de");
    const { container } = render(<DashboardResourceHoneycomb tiles={TILES} />);

    const tooltip: HTMLElement = hoverTile(container, 0);
    const title: HTMLElement = within(tooltip).getByText(
      "checkout-api-production-7d9f8b6c4-x2x9z",
    );

    expectDrawnAsItWas(title);
    expect(title).toHaveClass("truncate");
  });

  /*
   * A widget's card is overflow-hidden and transformed (scale), which makes
   * position:fixed relative to the card: drawn inside it, the tooltip was
   * cut off by the card, and on an Arabic or Persian board drawn past its
   * right edge, out of sight. It is drawn on the page's body.
   */
  test("the tooltip is drawn on the page's body, outside the widget's card, and goes with the pointer", async () => {
    await inLanguage("ar");
    const { container } = render(<DashboardResourceHoneycomb tiles={TILES} />);

    const tooltip: HTMLElement = hoverTile(container, 0);

    expect(tooltip).not.toBeNull();
    expect(tooltip.parentElement).toBe(document.body);
    expect(container.contains(tooltip)).toBe(false);

    fireEvent.mouseLeave(container.querySelectorAll("div.select-none")[0]!);

    expect(document.querySelector("div.fixed.z-50")).toBeNull();
  });

  /*
   * A Kubernetes pod list's tile, as the pod list widget builds it: its
   * phase, its namespace and cluster under it, and a link to the pod. On a
   * Persian board the tooltip's own words - Status, the phase, Cluster and
   * Click to open - read in Persian (#7088); what the tile names (the pod,
   * its namespace and cluster) is drawn as written, and so is the
   * Kubernetes kind Namespace, which the Persian Dashboard writes as
   * Kubernetes does.
   */
  const POD_TILE: HoneycombTile = {
    id: "pod-3",
    status: "Running",
    color: "#10b981",
    route: new Route("/dashboard/kubernetes/pod"),
    tooltip: {
      title: "checkout-api-7d9f8b6c4-x2x9z",
      details: [
        { label: "Namespace", value: "payments" },
        { label: "Cluster", value: "prod-eu-west" },
      ],
    },
  };

  const FA: Record<string, string> = readDashboardLocale("fa");
  const LATIN_LETTER: RegExp = /[A-Za-z]/;

  // The tooltip's words with what the tile names, and the kind, taken out.
  function tooltipOwnWords(tooltip: HTMLElement): string {
    let words: string = withoutIsolateMarks(tooltip.textContent || "");

    for (const named of [
      "checkout-api-7d9f8b6c4-x2x9z",
      "payments",
      "prod-eu-west",
      "Namespace",
    ]) {
      words = words.split(named).join("");
    }

    return words;
  }

  test("on a Persian board the tooltip's own words read in Persian: Status, the phase, Cluster and Click to open", async () => {
    await inLanguage("fa");
    const { container } = render(
      <DashboardResourceHoneycomb tiles={[POD_TILE]} />,
    );

    const tooltip: HTMLElement = hoverTile(container, 0);

    for (const key of ["Status", "Running", "Cluster", "Click to open"]) {
      expect({ key, worded: FA[key] !== key }).toEqual({ key, worded: true });
      expect(within(tooltip).getByText(FA[key] as string)).toBeTruthy();
    }

    expect(
      within(tooltip).getByText(FA["Click to open"] as string),
    ).toHaveTextContent("برای باز کردن کلیک کنید");
    expect(LATIN_LETTER.test(tooltipOwnWords(tooltip))).toBe(false);
  });

  test("on a Persian board the tooltip draws what the tile names as written", async () => {
    await inLanguage("fa");
    const { container } = render(
      <DashboardResourceHoneycomb tiles={[POD_TILE]} />,
    );

    const tooltip: HTMLElement = hoverTile(container, 0);

    expectOneLineReadLeftToRight(
      within(tooltip).getByText("checkout-api-7d9f8b6c4-x2x9z"),
    );
    expectOneLineReadLeftToRight(within(tooltip).getByText("payments"));
    expectOneLineReadLeftToRight(within(tooltip).getByText("prod-eu-west"));
    expect(within(tooltip).getByText("Namespace")).toBeTruthy();
  });

  test("a tile with no page to open says nothing about a click", async () => {
    await inLanguage("fa");
    const { container } = render(
      <DashboardResourceHoneycomb
        tiles={[{ ...POD_TILE, route: undefined }]}
      />,
    );

    const tooltip: HTMLElement = hoverTile(container, 0);

    expect(
      within(tooltip).queryByText(FA["Click to open"] as string),
    ).toBeNull();
  });

  test("on an English board the tooltip reads as it always did", async () => {
    await inLanguage("en");
    const { container } = render(
      <DashboardResourceHoneycomb tiles={[POD_TILE]} />,
    );

    const tooltip: HTMLElement = hoverTile(container, 0);

    for (const text of [
      "Status",
      "Running",
      "Namespace",
      "Cluster",
      "Click to open",
    ]) {
      expect(within(tooltip).getByText(text)).toBeTruthy();
    }
  });
});
