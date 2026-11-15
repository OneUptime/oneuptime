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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A WIDGET THAT READ AND FOUND NOTHING SAYS SO IN THE SHARED LOOK (#8038).
 *
 * PR #7990 (#7329, #7330, #7331) gave a widget's "not set up yet" and
 * "something went wrong" states one look: its icon in a soft circle over a
 * gray-500 line, centred and balanced. A widget that read fine and found
 * nothing - a time range or filters with no data in them - was left as it
 * was: bare words in gray-400 (2.5:1 on white) with no icon. The Log Chart,
 * the Trace Chart and Table, the Security Events Flow, the Data Source
 * Table and the Log Stream each drew it so, and so did a list in honeycomb
 * view and the Network Map, whose line was English on every board.
 *
 * Here each real widget is drawn with its read standing in, answering
 * nothing, in English, German, Arabic and Persian: each draws its own icon
 * over the shared no-data line (DashboardWidgetEmpty), in the reader's
 * words, gray-500 and never gray-400 - readable on a light board, and on a
 * dark one, where Theme.css draws gray-500 in its text-subtle.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const fetchTimeSeriesMock: MockFunction = getJestMockFunction();
const fetchTableMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
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
        fetchTimeSeries: (...args: Array<unknown>) => {
          return fetchTimeSeriesMock(...args);
        },
        fetchTable: (...args: Array<unknown>) => {
          return fetchTableMock(...args);
        },
        getAttributeKeys: (): Array<string> => {
          return [];
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getList: (...args: Array<unknown>) => {
        return modelGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import DashboardDataSourceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardLogChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogChartComponent";
import DashboardLogStreamComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogStreamComponent";
import DashboardNetworkMapComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardNetworkMapComponent";
import DashboardSecurityEventsFlowComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardTraceChartComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceTableComponent";
import DashboardResourceListBase from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceListBase";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardWidgetEmpty, {
  DASHBOARD_WIDGET_EMPTY_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetEmpty";
import {
  DASHBOARD_WIDGET_ERROR_TEST_ID,
  DASHBOARD_WIDGET_STATE_ICON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetError";
import {
  DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME,
  DASHBOARD_WIDGET_EMPTY_LINE_TEST_ID,
  DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME,
  DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardDataSourceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import DashboardLogChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { DataSourceTableColumnType } from "../../../Types/DataSource/DataSourceTableResult";
import IconProp from "../../../Types/Icon/IconProp";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";
import DashboardDataSourceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardLogChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardLogChartComponent";
import DashboardLogStreamComponentUtil from "../../../Utils/Dashboard/Components/DashboardLogStreamComponent";
import DashboardNetworkMapComponentUtil from "../../../Utils/Dashboard/Components/DashboardNetworkMapComponent";
import DashboardSecurityEventsFlowComponentUtil from "../../../Utils/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardTraceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTraceTableComponent";
import {
  AA_TEXT_CONTRAST,
  contrastOf,
  contrastRatio,
} from "../../Helpers/TailwindContrast";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000008038",
);

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-000000008038",
);

const BOARD_RANGE: RangeStartAndEndDateTime = {
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

// The look the no-data lines were drawn in before, and never are now.
const PALE: RegExp = /\btext-gray-400\b/;

const NETWORK_MAP_EMPTY: string =
  "No network sites with coordinates. Add latitude and longitude to a site to pin it on the map.";

const onReset: MockFunction = getJestMockFunction();

function baseProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "empty-widget",
    onComponentUpdate: (): void => {
      // No widget writes back through this here.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 390,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    dashboardId: "d0000000-0000-4000-8000-000000008038",
    ...overrides,
  };
}

function withArguments(
  component: DashboardBaseComponent,
  widgetArguments: Record<string, unknown>,
): DashboardBaseComponent {
  return {
    ...component,
    componentId: COMPONENT_ID,
    arguments: {
      ...(component.arguments as Record<string, unknown>),
      ...widgetArguments,
    } as DashboardBaseComponent["arguments"],
  };
}

interface Widget {
  name: string;
  // Its no-data sentence, in English: a key of the Dashboard's locales.
  sentence: string;
  // The icon its error shows, and its no-data line now does.
  icon: IconProp;
  component: () => DashboardBaseComponent;
  element: React.FunctionComponent<any>;
}

/*
 * Every widget whose no-data line was the old pale box, each set up so it
 * reads (a query, a group) and answered with nothing.
 */
const WIDGETS: ReadonlyArray<Widget> = [
  {
    name: "Log Chart",
    sentence: "No logs for the selected time range and filters",
    icon: IconProp.Logs,
    component: () => {
      return withArguments(
        DashboardLogChartComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: DashboardLogChartComponentElement,
  },
  {
    name: "Trace Chart",
    sentence: "No data for the selected time range",
    icon: IconProp.Waterfall,
    component: () => {
      return withArguments(
        DashboardTraceChartComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: DashboardTraceChartComponentElement,
  },
  {
    name: "Trace Table",
    sentence: "No data for the selected time range",
    icon: IconProp.Waterfall,
    component: () => {
      return withArguments(
        DashboardTraceTableComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: DashboardTraceTableComponentElement,
  },
  {
    name: "Security Events Flow",
    sentence: "No security events for the selected time range and filters",
    icon: IconProp.ShieldExclamation,
    component: () => {
      return withArguments(
        DashboardSecurityEventsFlowComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: DashboardSecurityEventsFlowComponentElement,
  },
  {
    name: "Data Source Table",
    sentence: "No rows returned.",
    icon: IconProp.TableCells,
    component: () => {
      return withArguments(
        DashboardDataSourceTableComponentUtil.getDefaultComponent(),
        { query: { id: "q1", dataSourceId: "ds-pg", query: "select 1" } },
      );
    },
    element: DashboardDataSourceTableComponentElement,
  },
  {
    name: "Log Stream",
    sentence: "No logs found",
    icon: IconProp.List,
    component: () => {
      return withArguments(
        DashboardLogStreamComponentUtil.getDefaultComponent(),
        {},
      );
    },
    element: DashboardLogStreamComponentElement,
  },
  {
    name: "Network Map",
    sentence: NETWORK_MAP_EMPTY,
    icon: IconProp.Map,
    component: () => {
      return withArguments(
        DashboardNetworkMapComponentUtil.getDefaultComponent(),
        { viewMode: "map" },
      );
    },
    element: DashboardNetworkMapComponentElement,
  },
];

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

async function speak(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function inLanguage(english: string, language: string): string {
  if (language === "en") {
    return english;
  }

  const words: string | undefined = readDashboardLocale(language)[english];

  expect({ language, english, worded: Boolean(words) }).toEqual({
    language,
    english,
    worded: true,
  });

  return words as string;
}

// The icon an IconProp draws, as the shared circle draws it.
function iconMarkup(icon: IconProp): string {
  const drawn: ReturnType<typeof render> = render(
    <DashboardWidgetEmpty icon={icon} message="x" />,
  );
  const markup: string = within(drawn.container).getByTestId(
    DASHBOARD_WIDGET_STATE_ICON_TEST_ID,
  ).innerHTML;

  drawn.unmount();

  return markup;
}

/*
 * The widget's no-data line, inside its no-data state, under its own
 * icon, in the shared readable look.
 */
async function emptyLine(widget: Widget): Promise<HTMLElement> {
  const line: HTMLElement = await screen.findByTestId(
    DASHBOARD_WIDGET_EMPTY_LINE_TEST_ID,
  );
  const state: HTMLElement = screen.getByTestId(DASHBOARD_WIDGET_EMPTY_TEST_ID);

  expect(within(state).getByTestId(DASHBOARD_WIDGET_EMPTY_LINE_TEST_ID)).toBe(
    line,
  );

  const icon: HTMLElement = within(state).getByTestId(
    DASHBOARD_WIDGET_STATE_ICON_TEST_ID,
  );

  // Its own icon, in the soft gray circle its error shows.
  expect(icon.querySelector("svg")).not.toBeNull();
  expect(icon.querySelector(".bg-gray-50")).not.toBeNull();
  expect(icon).not.toContainElement(line);
  expect({ widget: widget.name, icon: icon.innerHTML }).toEqual({
    widget: widget.name,
    icon: iconMarkup(widget.icon),
  });

  // The line is the shared one: readable, centred, balanced, not too wide.
  expect({ widget: widget.name, className: line.className }).toEqual({
    widget: widget.name,
    className: DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME,
  });
  expect(line).toHaveClass(
    "text-xs",
    "text-gray-500",
    "text-center",
    "text-balance",
    "max-w-xs",
  );
  expect(line.className).not.toMatch(PALE);
  expect(contrastOf(line)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);

  // Never an error: the widget read, and found nothing.
  expect(screen.queryByTestId(DASHBOARD_WIDGET_ERROR_TEST_ID)).toBeNull();

  return line;
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
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
  for (const mock of [
    fetchResultsMock,
    fetchTimeSeriesMock,
    fetchTableMock,
    postMock,
    analyticsGetListMock,
    modelGetListMock,
    onReset,
  ]) {
    mock.mockReset();
  }

  // Every read answers, with nothing in it.
  fetchResultsMock.mockResolvedValue([]);
  fetchTimeSeriesMock.mockResolvedValue({ data: [] });
  fetchTableMock.mockResolvedValue({ columns: [], rows: [], truncated: false });
  postMock.mockResolvedValue({ data: {} });
  analyticsGetListMock.mockResolvedValue({ data: [], count: 0 });
  modelGetListMock.mockResolvedValue({ data: [], count: 0 });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  window.localStorage.clear();
  await speak("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("a widget whose read found nothing: its icon over the shared line, in the reader's words", () => {
  const cases: Array<[string, string, Widget]> = LANGUAGES.flatMap(
    (language: string): Array<[string, string, Widget]> => {
      return WIDGETS.map((widget: Widget): [string, string, Widget] => {
        return [widget.name, language, widget];
      });
    },
  );

  test.each(cases)(
    "%s in %s",
    async (_name: string, language: string, widget: Widget) => {
      await speak(language);

      render(
        <widget.element {...baseProps()} component={widget.component()} />,
      );

      const line: HTMLElement = await emptyLine(widget);

      expect(line.textContent).toBe(inLanguage(widget.sentence, language));

      if (language !== "en") {
        expect(line.textContent || "").not.toContain(widget.sentence);
      }

      // No bare pale words anywhere in the widget either.
      for (const element of Array.from(
        document.body.querySelectorAll("div, p, td, span"),
      )) {
        if ((element.textContent || "").trim() === line.textContent) {
          expect(element.className).not.toMatch(PALE);
        }
      }
    },
  );
});

describe("the Log Chart's empty state still takes the double-click that undoes a zoom", () => {
  test("on the line and on the icon over it", async () => {
    render(
      <DashboardLogChartComponentElement
        {...baseProps({
          isDashboardTimeRangeZoomed: true,
          onDashboardTimeRangeReset: onReset as unknown as () => void,
          onDashboardTimeRangeSelect: (): void => {
            // A drag is not made here.
          },
        })}
        component={WIDGETS[0]!.component() as DashboardLogChartComponent}
      />,
    );

    const line: HTMLElement = await emptyLine(WIDGETS[0]!);

    fireEvent.doubleClick(line);
    expect(onReset).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(
      screen.getByTestId(DASHBOARD_WIDGET_STATE_ICON_TEST_ID),
    );
    expect(onReset).toHaveBeenCalledTimes(2);
  });
});

/*
 * A query that names its columns and returns no row drew its headers over
 * nothing at all: the table keeps its headers, over the readable no-data
 * row a list draws.
 */
describe("a Data Source Table whose query returns columns and no rows", () => {
  test.each(
    LANGUAGES.map((language: string) => {
      return [language];
    }),
  )(
    "in %s: its headers over a readable no-data row",
    async (language: string) => {
      await speak(language);
      fetchTableMock.mockResolvedValue({
        columns: [
          {
            key: "service",
            title: "service",
            type: DataSourceTableColumnType.Text,
          },
          {
            key: "errors",
            title: "errors",
            type: DataSourceTableColumnType.Number,
          },
        ],
        rows: [],
        truncated: false,
      });

      render(
        <DashboardDataSourceTableComponentElement
          {...baseProps()}
          component={
            WIDGETS[4]!.component() as DashboardDataSourceTableComponent
          }
        />,
      );

      const cell: HTMLElement = await screen.findByText(
        inLanguage("No rows returned.", language),
      );

      expect(cell.tagName).toBe("TD");
      expect(cell).toHaveAttribute("colspan", "2");
      expect(cell.className).toBe(DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME);
      expect(cell.className).not.toMatch(PALE);
      expect(contrastOf(cell)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
      // The query's own column names stay over it, as written.
      expect(
        screen.getAllByRole("columnheader").map((header: HTMLElement) => {
          return header.textContent;
        }),
      ).toEqual(["service", "errors"]);
    },
  );
});

describe("a list widget with no rows", () => {
  function drawList(viewMode: "list" | "honeycomb"): void {
    render(
      <DashboardResourceListBase
        title="Fleet"
        countLabel={{ one: "{{count}} host", other: "{{count}} hosts" }}
        columns={[{ label: "Host", widthPct: "100%" }]}
        count={0}
        isLoading={false}
        error={null}
        isEmpty={true}
        emptyMessage="No storage array hardware found"
        emptyIcon={IconProp.CPUChip}
        viewMode={viewMode}
        honeycombTiles={[]}
      />,
    );
  }

  test.each(
    LANGUAGES.map((language: string) => {
      return [language];
    }),
  )(
    "in honeycomb view, in %s: the list's icon over the shared line",
    async (language: string) => {
      await speak(language);
      drawList("honeycomb");

      const line: HTMLElement = await emptyLine({
        name: "Honeycomb",
        sentence: "No storage array hardware found",
        icon: IconProp.CPUChip,
        component: () => {
          throw new Error("Drawn directly.");
        },
        element: DashboardResourceListBase,
      });

      expect(line.textContent).toBe(
        inLanguage("No storage array hardware found", language),
      );
    },
  );

  test.each(
    LANGUAGES.map((language: string) => {
      return [language];
    }),
  )(
    "in list view, in %s: a readable row under the headers it keeps",
    async (language: string) => {
      await speak(language);
      drawList("list");

      const cell: HTMLElement = screen.getByText(
        inLanguage("No storage array hardware found", language),
      );

      expect(cell.tagName).toBe("TD");
      expect(cell.className).toBe(DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME);
      expect(cell).toHaveClass("text-gray-500", "text-center");
      expect(cell.className).not.toMatch(PALE);
      expect(contrastOf(cell)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
      // The headers stay, so it is a row, not the widget's state.
      expect(screen.getAllByRole("columnheader")).toHaveLength(1);
      expect(screen.queryByTestId(DASHBOARD_WIDGET_EMPTY_TEST_ID)).toBeNull();
    },
  );
});

describe("the no-data line in both themes", () => {
  const THEME_CSS: string = fs
    .readFileSync(
      path.resolve(__dirname, "../../../UI/Styles/Theme.css"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  // A custom property's value in the dark theme's block.
  function darkToken(name: string): string {
    const block: string =
      THEME_CSS.match(/html\.dark\s*\{([\s\S]*?)\}/)?.[1] || "";
    const value: string | undefined = block.match(
      new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`),
    )?.[1];

    expect({ name, value }).toEqual({ name, value: expect.any(String) });

    return value as string;
  }

  test("is the setup and error lines' look, and no paler", () => {
    expect(DASHBOARD_WIDGET_EMPTY_LINE_CLASS_NAME).toBe(
      DASHBOARD_WIDGET_ERROR_LINE_CLASS_NAME,
    );
    expect(DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME).toMatch(/\btext-gray-500\b/);
    expect(DASHBOARD_WIDGET_EMPTY_ROW_CLASS_NAME).not.toMatch(PALE);
  });

  test("gray-500 is remapped for the dark theme, to a token that reads on the dark card", () => {
    // Theme.css draws gray-500 in its text-subtle under html.dark.
    expect(THEME_CSS).toMatch(
      /html\.dark :is\(\.text-gray-500, \.text-slate-500\)\s*\{\s*color: var\(--ou-text-subtle\);/,
    );

    const subtle: string = darkToken("ou-text-subtle");
    const card: string = darkToken("ou-surface-primary");
    const softer: string = darkToken("ou-surface-secondary");

    expect(contrastRatio(subtle, card)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    );
    expect(contrastRatio(subtle, softer)).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    );
  });

  test("its icon's circle and the icon are remapped too", () => {
    expect(THEME_CSS).toContain("html.dark :is(.bg-gray-50, .bg-slate-50)");
    expect(THEME_CSS).toMatch(
      /html\.dark :is\(\.text-gray-400, \.text-slate-400\)/,
    );
  });
});
