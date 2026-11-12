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
import {
  act,
  cleanup,
  RenderResult,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #7160: A WIDGET THAT IS NOT SET UP YET SAYS WHAT TO DO ONLY WHERE IT
 * CAN BE DONE.
 *
 * A widget with nothing picked yet - no metric, no query, no SLO, no saved
 * funnel - drew "Click to configure metric" and the like wherever it was
 * drawn. A click opens its settings only on the board being edited. Drawn
 * in the widget settings dialog's Live Preview, or on a board out of edit
 * mode (a reader's, a public dashboard's, a playlist's), a click there does
 * nothing.
 *
 * Every widget that has a setup state is opened here, as it is when it is
 * just added (each kind's default), in the three places it is drawn - the
 * Live Preview, a board out of edit mode, the board being edited - and on
 * a public dashboard, in English, German and Arabic, and the line it draws
 * is read:
 *
 *   - on the board being edited: a click, which does open its settings;
 *   - in the Live Preview: the settings below it, and no click;
 *   - on a board out of edit mode, and a public dashboard: what is
 *     missing, and nothing to do.
 */

jest.setTimeout(240000);

const fetchResultsMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const fetchTimeSeriesMock: MockFunction = getJestMockFunction();
const fetchTableMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

// A widget not set up yet reads nothing: each read is a mock that says so.
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return react.createElement("div", { "data-testid": "metric-charts" });
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
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
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return String(error);
      },
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

// The settings form is not under test; the preview above it is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import ObjectID from "../../../Types/ObjectID";
import DashboardChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardChartComponent";
import DashboardDataSourceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceGaugeComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceValueComponent";
import DashboardGaugeComponentUtil from "../../../Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardProductAnalyticsFunnelComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsFunnelComponent";
import DashboardProductAnalyticsRetentionComponentUtil from "../../../Utils/Dashboard/Components/DashboardProductAnalyticsRetentionComponent";
import DashboardSloComponentUtil from "../../../Utils/Dashboard/Components/DashboardSloComponent";
import DashboardValueComponentUtil from "../../../Utils/Dashboard/Components/DashboardValueComponent";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
  DASHBOARD_WIDGET_SETUP_LINES,
  DashboardWidgetPlace,
  DashboardWidgetSetupNeed,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetSetupCopy";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import {
  PREVIEW_WIDGET_ID,
  PreviewResizeObserver,
  boardCard,
  drawWidgetOnBoard,
  openWidgetSettings,
  previewBox,
  widgetOnBoard,
} from "./WidgetPreviewHarness";

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

interface WidgetKind {
  // The widget, as the toolbar adds it: nothing picked yet.
  type: DashboardComponentType;
  build: () => DashboardBaseComponent;
  need: DashboardWidgetSetupNeed;
  // What a public dashboard draws in its place, when it draws none.
  notOnPublicDashboards?: string | undefined;
}

const EXTERNAL_DATA_SOURCES: string =
  "External data sources are not available on public dashboards.";

/*
 * Every widget that draws a setup state, as the widget picker adds it -
 * each kind's own default, which has nothing picked yet.
 */
const WIDGET_KINDS: ReadonlyArray<WidgetKind> = [
  {
    type: DashboardComponentType.Value,
    build: () => {
      return DashboardValueComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Metric,
  },
  {
    type: DashboardComponentType.Gauge,
    build: () => {
      return DashboardGaugeComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Metric,
  },
  {
    type: DashboardComponentType.Chart,
    build: () => {
      return DashboardChartComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Metric,
  },
  {
    type: DashboardComponentType.DataSourceValue,
    build: () => {
      return DashboardDataSourceValueComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Query,
    notOnPublicDashboards: EXTERNAL_DATA_SOURCES,
  },
  {
    type: DashboardComponentType.DataSourceGauge,
    build: () => {
      return DashboardDataSourceGaugeComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Query,
    notOnPublicDashboards: EXTERNAL_DATA_SOURCES,
  },
  {
    type: DashboardComponentType.DataSourceTable,
    build: () => {
      return DashboardDataSourceTableComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Query,
    notOnPublicDashboards: EXTERNAL_DATA_SOURCES,
  },
  {
    type: DashboardComponentType.DataSourceChart,
    build: () => {
      return DashboardDataSourceChartComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Query,
    notOnPublicDashboards: EXTERNAL_DATA_SOURCES,
  },
  {
    type: DashboardComponentType.Slo,
    build: () => {
      return DashboardSloComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.Slo,
  },
  {
    type: DashboardComponentType.ProductAnalyticsFunnel,
    build: () => {
      return DashboardProductAnalyticsFunnelComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.SavedFunnel,
    notOnPublicDashboards: "Funnels are not available on public dashboards.",
  },
  {
    type: DashboardComponentType.ProductAnalyticsRetention,
    build: () => {
      return DashboardProductAnalyticsRetentionComponentUtil.getDefaultComponent();
    },
    need: DashboardWidgetSetupNeed.SavedRetentionTable,
    notOnPublicDashboards:
      "Retention tables are not available on public dashboards.",
  },
];

// The widget as the board holds it: the harness's id, so its dialog finds it.
function widgetOf(kind: WidgetKind): DashboardBaseComponent {
  return { ...kind.build(), componentId: PREVIEW_WIDGET_ID };
}

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar"];

// A line as `language`'s Dashboard draws it.
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

function lineFor(
  kind: WidgetKind,
  place: DashboardWidgetPlace,
  language: string,
): string {
  return inLanguage(DASHBOARD_WIDGET_SETUP_LINES[kind.need][place], language);
}

// The setup line a part of the page draws, once the widget has settled.
async function setupLineIn(part: () => HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    return within(part()).getByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID);
  });
}

// Each one sentence: nothing of another place's line, in no language.
const ENGLISH_CLICK: RegExp = /click/i;

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    PreviewResizeObserver;

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
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
  fetchResultsMock.mockResolvedValue([]);
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0 });
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(null);
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockResolvedValue({ data: [] });
  fetchTimeSeriesMock.mockReset();
  fetchTableMock.mockReset();
  postMock.mockReset();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
  jest.restoreAllMocks();
});

async function speak(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// A widget not set up yet asks nothing of anything that reads data.
function expectNothingRead(kind: WidgetKind): void {
  expect({
    widget: kind.type,
    metrics: fetchResultsMock.mock.calls.length,
    timeSeries: fetchTimeSeriesMock.mock.calls.length,
    tables: fetchTableMock.mock.calls.length,
    savedViews: getItemMock.mock.calls.length,
    posts: postMock.mock.calls.length,
  }).toEqual({
    widget: kind.type,
    metrics: 0,
    timeSeries: 0,
    tables: 0,
    savedViews: 0,
    posts: 0,
  });
}

const CASES: Array<[string, string, WidgetKind]> = LANGUAGES.flatMap(
  (language: string): Array<[string, string, WidgetKind]> => {
    return WIDGET_KINDS.map(
      (kind: WidgetKind): [string, string, WidgetKind] => {
        return [kind.type, language, kind];
      },
    );
  },
);

describe("the widget settings dialog's Live Preview: the settings below, never a click", () => {
  test.each(CASES)(
    "%s in %s",
    async (_type: string, language: string, kind: WidgetKind) => {
      await speak(language);
      openWidgetSettings(widgetOf(kind));

      const line: HTMLElement = await setupLineIn(previewBox);

      expect(line).toHaveTextContent(
        lineFor(kind, DashboardWidgetPlace.SettingsPreview, language),
      );

      // Nothing in the preview says to click, in any language.
      for (const other of [
        DashboardWidgetPlace.EditedBoard,
        DashboardWidgetPlace.Board,
      ]) {
        const otherLine: string = lineFor(kind, other, language);

        if (otherLine !== line.textContent) {
          expect(previewBox().textContent || "").not.toContain(otherLine);
        }
      }

      expect(previewBox().textContent || "").not.toMatch(ENGLISH_CLICK);
      expectNothingRead(kind);
    },
  );
});

describe("a board out of edit mode: what is missing, and nothing to do", () => {
  test.each(CASES)(
    "%s in %s",
    async (_type: string, language: string, kind: WidgetKind) => {
      await speak(language);
      drawWidgetOnBoard(widgetOf(kind));

      const line: HTMLElement = await setupLineIn(boardCard);

      expect(line).toHaveTextContent(
        lineFor(kind, DashboardWidgetPlace.Board, language),
      );
      expect(boardCard().textContent || "").not.toContain(
        lineFor(kind, DashboardWidgetPlace.EditedBoard, language),
      );
      expect(boardCard().textContent || "").not.toContain(
        lineFor(kind, DashboardWidgetPlace.SettingsPreview, language),
      );
      expect(boardCard().textContent || "").not.toMatch(ENGLISH_CLICK);
      expectNothingRead(kind);
    },
  );
});

describe("the board being edited: a click opens the settings, so the line may ask for one", () => {
  test.each(CASES)(
    "%s in %s",
    async (_type: string, language: string, kind: WidgetKind) => {
      await speak(language);
      drawWidgetOnBoard(widgetOf(kind), { isEditMode: true });

      const line: HTMLElement = await setupLineIn(boardCard);

      expect(line).toHaveTextContent(
        lineFor(kind, DashboardWidgetPlace.EditedBoard, language),
      );
      expect(boardCard().textContent || "").not.toContain(
        lineFor(kind, DashboardWidgetPlace.Board, language),
      );
      expectNothingRead(kind);
    },
  );
});

describe("a public dashboard: a visitor is told what is missing, or why the widget is not drawn", () => {
  test.each(CASES)(
    "%s in %s",
    async (_type: string, language: string, kind: WidgetKind) => {
      await speak(language);
      setPublicDashboardContext({
        dashboardId: new ObjectID("d0000000-0000-4000-8000-000000007160"),
      } as unknown as PublicDashboardContext);

      drawWidgetOnBoard(widgetOf(kind));

      if (kind.notOnPublicDashboards) {
        expect(
          await within(boardCard()).findByText(
            inLanguage(kind.notOnPublicDashboards, language),
          ),
        ).toBeInTheDocument();
        expect(
          within(boardCard()).queryByTestId(
            DASHBOARD_WIDGET_SETUP_LINE_TEST_ID,
          ),
        ).not.toBeInTheDocument();
      } else {
        const line: HTMLElement = await setupLineIn(boardCard);

        expect(line).toHaveTextContent(
          lineFor(kind, DashboardWidgetPlace.Board, language),
        );
      }

      expect(boardCard().textContent || "").not.toMatch(ENGLISH_CLICK);
      expectNothingRead(kind);
    },
  );
});

/*
 * The line is the only thing a widget that is not set up yet has to say,
 * so it is drawn to be read: gray-500 (4.5:1 on the widget), as the Value
 * widget's and every public placeholder's already were, never the
 * gray-400 (2.5:1) the Gauge, Chart, Data Source and SLO widgets drew it
 * in. And a name above it that wraps in a narrow tile is centred over it,
 * never flush to one side.
 */
describe("every widget's setup line is dark enough to read, under a centred name", () => {
  const SINGLE_LINE: RegExp = /\b(?:truncate|line-clamp-1)\b/;

  test.each(
    WIDGET_KINDS.map((kind: WidgetKind): [string, WidgetKind] => {
      return [kind.type, kind];
    }),
  )("%s", async (_type: string, kind: WidgetKind) => {
    for (const isEditMode of [false, true]) {
      drawWidgetOnBoard(widgetOf(kind), { isEditMode });

      const line: HTMLElement = await setupLineIn(boardCard);

      expect({
        widget: kind.type,
        isEditMode,
        className: line.className,
      }).toEqual({
        widget: kind.type,
        isEditMode,
        className: expect.stringContaining("text-gray-500"),
      });
      expect(line).not.toHaveClass("text-gray-400");
      expect(line).toHaveClass("text-center");

      const name: Element | null = line.previousElementSibling;

      if (name && name.tagName === "P") {
        expect({
          widget: kind.type,
          name: name.textContent,
          centredOrOneLine:
            name.classList.contains("text-center") ||
            SINGLE_LINE.test(name.className),
        }).toEqual({
          widget: kind.type,
          name: name.textContent,
          centredOrOneLine: true,
        });
      }

      cleanup();
    }
  });
});

describe("one widget, as its board goes in and out of edit mode, says each place's line", () => {
  test.each(
    WIDGET_KINDS.map((kind: WidgetKind): [string, WidgetKind] => {
      return [kind.type, kind];
    }),
  )(
    "%s: out of edit mode, edited, then out of edit mode again",
    async (_type: string, kind: WidgetKind) => {
      const widget: DashboardBaseComponent = widgetOf(kind);
      const result: RenderResult = drawWidgetOnBoard(widget);

      expect(await setupLineIn(boardCard)).toHaveTextContent(
        lineFor(kind, DashboardWidgetPlace.Board, "en"),
      );

      /*
       * The same widget, in place, as its board is edited: a widget that
       * kept its line behind a memo that let isEditMode go by would keep
       * telling an editor nothing is picked, and a reader to click.
       */
      result.rerender(widgetOnBoard(widget, { isEditMode: true }));

      await waitFor(() => {
        expect(
          within(boardCard()).getByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
        ).toHaveTextContent(
          lineFor(kind, DashboardWidgetPlace.EditedBoard, "en"),
        );
      });

      result.rerender(widgetOnBoard(widget, { isEditMode: false }));

      await waitFor(() => {
        expect(
          within(boardCard()).getByTestId(DASHBOARD_WIDGET_SETUP_LINE_TEST_ID),
        ).toHaveTextContent(lineFor(kind, DashboardWidgetPlace.Board, "en"));
      });
      expectNothingRead(kind);
    },
  );
});

describe("the Chart widget's old lines are gone", () => {
  /*
   * "Please select a metric. Click here to add a metric." and "Please
   * select a aggregation. Click here to add a aggregation." were the
   * chart's error text, drawn as written in every language.
   */
  test.each(
    LANGUAGES.map((language: string) => {
      return [language];
    }),
  )("in %s, in every place", async (language: string) => {
    await speak(language);

    const chart: WidgetKind = WIDGET_KINDS.find((kind: WidgetKind) => {
      return kind.type === DashboardComponentType.Chart;
    }) as WidgetKind;

    openWidgetSettings(widgetOf(chart));
    await setupLineIn(previewBox);
    expect(previewBox().textContent || "").not.toMatch(
      /Please select|Click here|a aggregation/,
    );
    cleanup();

    for (const isEditMode of [false, true]) {
      drawWidgetOnBoard(widgetOf(chart), { isEditMode });
      await setupLineIn(boardCard);
      expect(boardCard().textContent || "").not.toMatch(
        /Please select|Click here|a aggregation/,
      );
      cleanup();
    }
  });
});
