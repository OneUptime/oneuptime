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
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A DASHBOARD'S SLO WIDGETS IN THE READER'S LANGUAGE (#6778, #6695).
 *
 * The single-SLO widget drew three of its texts in English in every
 * Dashboard language - its title's metric ("Error Budget Remaining"), "Not
 * evaluated yet", and the line under the error budget ("12 min remaining",
 * "−5 min over budget") - and every figure with an English decimal point.
 * The SLO list widget drew its target line ("target 99.9%") and a new SLO's
 * "Not Evaluated" as written.
 *
 * Both widgets are rendered for real here, over the Dashboard's shipped
 * locale files, in German and Arabic: for each metric, before the first
 * evaluation, with budget left and over budget. The SLO's name stays as it
 * was written in every language.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const lineChartMock: MockFunction = getJestMockFunction();
const honeycombMock: MockFunction = getJestMockFunction();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

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

// recharts draws nothing in jsdom: what matters is what the widget hands it.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      lineChartMock(props);
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

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
            return "/dashboard/slos/view";
          },
        };
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        honeycombMock(props);
        return React.createElement("div", { "data-testid": "honeycomb" });
      },
    };
  },
);

import DashboardSloComponentElement, {
  SLO_WIDGET_LEGEND_ROW_IN_PX,
  SLO_WIDGET_TILE_VALUE_TEST_ID,
  SLO_WIDGET_TITLE_NAME_TEST_ID,
  SLO_WIDGET_TITLE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent";
import {
  PROPORTIONAL_NUMBERS_CLASS_NAME,
  TABULAR_NUMBERS_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetDigits";
import DashboardSloListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloListComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardSloListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardSloListComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { getNumberLocale } from "../../../Types/DateLanguage";
import { ObjectType } from "../../../Types/JSON";
import { ReferenceLineLabelPlacement } from "../../../UI/Components/Charts/Types/ReferenceLineProps";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { SLO_LIST_DEFAULT_MAX_ROWS } from "../../../Utils/Slo/SloListWidgetFormat";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import {
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

const EN: Record<string, string> = readDashboardLocale("en");
const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");
const FA: Record<string, string> = readDashboardLocale("fa");

const NO_BREAK_SPACE: string = "\u00A0";
// U+200E, either side of a burn rate's sign on a page read right to left.
const LEFT_TO_RIGHT_MARK: string = String.fromCharCode(0x200e);
const SLO_NAME: string = "Checkout availability";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-08-10T00:00:00.000Z"),
    new Date("2026-08-10T06:00:00.000Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

// "99,9 %": German's decimal comma and the no-break space before its sign.
function germanPercent(figure: string): string {
  return `${figure}${NO_BREAK_SPACE}%`;
}

// A percentage as Arabic's Intl writes it: Latin digits, its own marks.
function arabicPercent(value: number): string {
  return new Intl.NumberFormat(getNumberLocale("ar"), {
    style: "percent",
    maximumFractionDigits: 3,
  }).format(value / 100);
}

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

type SloOverrides = {
  [K in keyof ServiceLevelObjective]?: ServiceLevelObjective[K] | null;
};

function buildSlo(overrides: SloOverrides = {}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.name = SLO_NAME;
  slo.targetPercentage = 99.9;
  slo.currentSliPercentage = 99.95;
  slo.errorBudgetRemainingPercentage = 42.5;
  slo.errorBudgetRemainingSeconds = 3600;
  slo.currentBurnRate = 1.25;
  slo.sloStatus = SloStatus.Healthy;
  return Object.assign(slo, overrides);
}

// The state columns the worker writes, still NULL before its first run.
const NOT_EVALUATED: SloOverrides = {
  currentSliPercentage: null,
  errorBudgetRemainingPercentage: null,
  errorBudgetRemainingSeconds: null,
  currentBurnRate: null,
  sloStatus: null,
};

const OVER_BUDGET: SloOverrides = {
  currentSliPercentage: 99.5,
  errorBudgetRemainingPercentage: -12.46,
  errorBudgetRemainingSeconds: -2520,
  currentBurnRate: 3,
  sloStatus: SloStatus.BudgetExhausted,
};

function baseProps(heightInPx: number): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "slo-widget",
    onComponentUpdate: (): void => {
      // The widgets never write back through this.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: heightInPx,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
  };
}

async function renderWidget(data: {
  metric: SloWidgetMetric;
  displayType?: SloWidgetDisplayType;
  slo: ServiceLevelObjective;
  // The title someone gave the widget; it holds the SLO's name here.
  widgetTitle?: string;
}): Promise<RenderResult> {
  getItemMock.mockResolvedValue(data.slo);

  const component: DashboardSloComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Slo,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 3,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 2,
    minHeightInDashboardUnits: 2,
    arguments: {
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: data.metric,
      displayType: data.displayType || SloWidgetDisplayType.Tile,
      widgetTitle: data.widgetTitle,
    },
  } as unknown as DashboardSloComponent;

  const result: RenderResult = render(
    <DashboardSloComponentElement {...baseProps(320)} component={component} />,
  );
  const sloName: string = data.slo.name || SLO_NAME;

  await screen.findByText((_content: string, element: Element | null) => {
    return Boolean(
      element?.textContent?.includes(sloName) && element.children.length === 0,
    );
  });

  return result;
}

/*
 * A widget with no SLO picked yet: its title - the one someone gave it, or
 * the widget kind's name - over the notice that says to pick one.
 */
async function renderUnpicked(widgetTitle?: string): Promise<RenderResult> {
  const component: DashboardSloComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Slo,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 3,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 2,
    minHeightInDashboardUnits: 2,
    arguments: {
      sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
      displayType: SloWidgetDisplayType.Tile,
      widgetTitle: widgetTitle,
    },
  } as unknown as DashboardSloComponent;

  const result: RenderResult = render(
    <DashboardSloComponentElement {...baseProps(320)} component={component} />,
  );

  // On a board out of edit mode: what is missing (issue #7160).
  await screen.findByText(
    i18next.language === "en"
      ? "No SLO picked yet."
      : (readDashboardLocale(i18next.language)["No SLO picked yet."] as string),
  );

  return result;
}

// The title an unpicked widget draws over its notice.
const UNPICKED_TITLE: string = "Checkout availability (EU West)";

// The tile's title: the box of no children of its own that names the SLO.
function tileTitleOf(container: HTMLElement): Element | undefined {
  return Array.from(container.querySelectorAll("div")).find(
    (element: Element): boolean => {
      return (
        element.children.length === 0 &&
        (element.textContent || "").includes(SLO_NAME)
      );
    },
  );
}

// The widget's title, read whole: one line, or the name and the words beside it.
function titleText(): string {
  return withoutIsolateMarks(
    screen.getByTestId(SLO_WIDGET_TITLE_TEST_ID).textContent || "",
  );
}

// Every text the widget draws in an element of its own, as drawn.
function drawnTexts(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("div, span, td, p"))
    .filter((element: Element): boolean => {
      return (
        element.children.length === 0 &&
        Boolean((element.textContent || "").trim())
      );
    })
    .map((element: Element): string => {
      return element.textContent || "";
    });
}

// The English the widgets drew in every language before (#6778).
const ENGLISH_WORDS: RegExp =
  /Not evaluated yet|Not Evaluated|min remaining|over budget|target |Error Budget Remaining|Burn Rate/;

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      fa: { translation: FA },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  jest.clearAllMocks();
  aggregateMock.mockResolvedValue({ data: [] });
  await inLanguage("de");
});

afterEach(() => {
  cleanup();
});

describe("the SLO widget's tile in German", () => {
  test("SLI: the label, the figure and the target line are German; the name as written", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.Sli,
      slo: buildSlo(),
    });

    expect(drawnTexts(container)).toEqual(
      expect.arrayContaining([
        `${SLO_NAME} · SLI`,
        germanPercent("99,95"),
        `${worded(DE, "target {{target}}", { target: germanPercent("99,9") })}`,
      ]),
    );
    expect(drawnTexts(container).join("\n")).not.toMatch(ENGLISH_WORDS);
  });

  test("Error budget with budget left: the German label, figure and minutes left", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(),
    });

    expect(drawnTexts(container)).toEqual(
      expect.arrayContaining([
        `${SLO_NAME} · ${worded(DE, "Error Budget Remaining")}`,
        germanPercent("42,5"),
        worded(DE, "{{count}} min remaining", { count: "60" }),
      ]),
    );
    expect(drawnTexts(container).join("\n")).not.toMatch(ENGLISH_WORDS);
  });

  test("Error budget over budget: how far over, in a German sentence with no minus", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(OVER_BUDGET),
    });

    expect(drawnTexts(container)).toEqual(
      expect.arrayContaining([
        germanPercent("-12,5"),
        worded(DE, "−{{count}} min over budget", { count: "42" }),
      ]),
    );
    expect(drawnTexts(container).join("\n")).not.toMatch(ENGLISH_WORDS);
  });

  test("Burn rate: the German label and a decimal comma", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.BurnRate,
      slo: buildSlo(),
    });

    expect(drawnTexts(container)).toEqual(
      expect.arrayContaining([
        `${SLO_NAME} · ${worded(DE, "Burn Rate")}`,
        "1,25×",
      ]),
    );
    expect(drawnTexts(container).join("\n")).not.toMatch(ENGLISH_WORDS);
  });

  test.each([
    [SloWidgetMetric.Sli, "SLI"],
    [SloWidgetMetric.ErrorBudgetRemaining, "Error Budget Remaining"],
    [SloWidgetMetric.BurnRate, "Burn Rate"],
  ])(
    '%s before the first evaluation: "Not evaluated yet" in German, no line under it',
    async (metric: SloWidgetMetric, label: string) => {
      const { container } = await renderWidget({
        metric: metric,
        slo: buildSlo(NOT_EVALUATED),
      });

      const texts: Array<string> = drawnTexts(container);

      expect(texts).toEqual(
        expect.arrayContaining([
          `${SLO_NAME} · ${DE[label]}`,
          worded(DE, "Not evaluated yet"),
        ]),
      );
      expect(texts.join("\n")).not.toMatch(ENGLISH_WORDS);
      /*
       * No grey "Unbekannt" pill under it: "Noch nicht ausgewertet"
       * already says all there is to say.
       */
      expect(screen.queryByTestId("pill-text")).not.toBeInTheDocument();
      expect(texts).not.toContain(worded(DE, "Unknown"));
    },
  );

  test("a paused SLO not evaluated yet keeps its status pill: it says why", async () => {
    await renderWidget({
      metric: SloWidgetMetric.Sli,
      slo: buildSlo({ ...NOT_EVALUATED, sloStatus: SloStatus.Paused }),
    });

    expect(screen.getByTestId("pill-text")).toHaveTextContent(
      worded(DE, "Paused"),
    );
  });

  test("an evaluated SLO's tile keeps its status pill", async () => {
    await renderWidget({
      metric: SloWidgetMetric.Sli,
      slo: buildSlo(),
    });

    expect(screen.getByTestId("pill-text")).toHaveTextContent(
      worded(DE, "Healthy"),
    );
  });

  test("a title cut to the tile reads whole on hover", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(),
    });

    const title: Element | undefined = tileTitleOf(container);

    expect(title).toHaveClass("truncate");
    expect(title).toHaveAttribute(
      "title",
      `${SLO_NAME} · ${worded(DE, "Error Budget Remaining")}`,
    );
    // German reads the way the English name does: drawn as it always was.
    expect(title).not.toHaveAttribute("dir");
    expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("no SLO picked yet: an English title over the notice is drawn as it always was", async () => {
    await renderUnpicked(UNPICKED_TITLE);

    const title: HTMLElement = screen.getByText(UNPICKED_TITLE);

    expect(title.tagName).toBe("P");
    expect(title).not.toHaveAttribute("dir");
    expect(title.className).toBe(
      "text-xs font-medium text-gray-500 truncate max-w-full",
    );
  });
});

describe("the SLO widget's tile in Arabic", () => {
  beforeEach(async () => {
    await inLanguage("ar");
  });

  test("SLI: the English name in a box of its own in the Arabic title; Latin digits", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.Sli,
      slo: buildSlo(),
    });

    const texts: Array<string> = drawnTexts(container);

    expect(titleText()).toBe(`${SLO_NAME} · SLI`);
    expect(screen.getByTestId(SLO_WIDGET_TITLE_NAME_TEST_ID).textContent).toBe(
      SLO_NAME,
    );
    // The whole title under the pointer, the name set apart in it.
    expect(
      screen.getByTestId(SLO_WIDGET_TITLE_TEST_ID).getAttribute("title"),
    ).toContain(isolated(SLO_NAME));
    expect(texts).toEqual(
      expect.arrayContaining([
        arabicPercent(99.95),
        worded(AR, "target {{target}}", { target: arabicPercent(99.9) }),
      ]),
    );
    expect(texts.join("\n")).not.toMatch(ENGLISH_WORDS);
    expect(texts.join("\n")).not.toMatch(/[٠-٩]/);
  });

  test("Error budget with budget left and over budget", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(),
    });

    let texts: Array<string> = drawnTexts(container);

    expect(titleText()).toBe(
      `${SLO_NAME} · ${worded(AR, "Error Budget Remaining")}`,
    );
    expect(texts).toEqual(
      expect.arrayContaining([
        arabicPercent(42.5),
        worded(AR, "{{count}} min remaining", { count: "60" }),
      ]),
    );
    expect(texts.join("\n")).not.toMatch(ENGLISH_WORDS);

    cleanup();
    const over: RenderResult = await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(OVER_BUDGET),
    });

    texts = drawnTexts(over.container);

    expect(texts).toEqual(
      expect.arrayContaining([
        worded(AR, "−{{count}} min over budget", { count: "42" }),
      ]),
    );
    // An overage is said in words, never with a minus sign.
    expect(
      texts.find((text: string) => {
        return text.includes(AR["−{{count}} min over budget"]!.split(" ")[0]!);
      }),
    ).not.toContain("−");
  });

  test("Burn rate: the sign stays after its figure, held there by left-to-right marks", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.BurnRate,
      slo: buildSlo(),
    });

    /*
     * A bare "×" at the end of a figure read right to left was drawn
     * before it: "×1.25".
     */
    expect(drawnTexts(container)).toEqual(
      expect.arrayContaining([
        `1.25${LEFT_TO_RIGHT_MARK}×${LEFT_TO_RIGHT_MARK}`,
      ]),
    );
  });

  /*
   * The tile's title is centred over it and cut where the tile ends
   * (#6858): a title someone wrote in English reads left to right, so it
   * is cut at its own end, and stays in the middle. The board's own
   * sentence around the SLO's name reads the board's way, and the English
   * name in it is a box of its own: drawn as one line read right to left,
   * it lost its start where the tile cut it, and the metric after it.
   */
  test("a title someone wrote in English reads left to right, cut at its own end, and stays centred", async () => {
    const widgetTitle: string = `${SLO_NAME} (EU West, 30 days)`;
    const { container } = await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(),
      widgetTitle: widgetTitle,
    });

    const title: Element | undefined = tileTitleOf(container);

    expect(title).toHaveTextContent(widgetTitle);
    expect(title).toHaveAttribute("dir", "ltr");
    expect(title).toHaveClass("truncate", "text-center");
    expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
    expect(title).toHaveAttribute("title", widgetTitle);
  });

  test("the board's own title: the English name in a box of its own, cut at its own end, the Arabic words beside it, centred", async () => {
    await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(),
    });

    const whole: string = `${SLO_NAME} · ${worded(AR, "Error Budget Remaining")}`;
    const title: HTMLElement = screen.getByTestId(SLO_WIDGET_TITLE_TEST_ID);
    const name: HTMLElement = screen.getByTestId(SLO_WIDGET_TITLE_NAME_TEST_ID);
    const words: Element | null = title.lastElementChild;

    expect(titleText()).toBe(whole);
    // A row across the tile, in its middle, the board's way; whole on hover.
    expect(title).not.toHaveAttribute("dir");
    expect(title).toHaveClass("flex", "w-full", "justify-center");
    expect(withoutIsolateMarks(title.getAttribute("title") || "")).toBe(whole);
    // The name first, read its own way: cut at its own end, and last.
    expect(title.firstElementChild).toBe(name);
    expect(name.textContent).toBe(SLO_NAME);
    expect(name).toHaveAttribute("dir", "ltr");
    expect(name).toHaveClass("truncate", "shrink-0", "max-w-full");
    // The board's words beside it, cut first, their spaces kept.
    expect(words).not.toBe(name);
    expect(words).not.toHaveAttribute("dir");
    expect(withoutIsolateMarks(words?.textContent || "")).toBe(
      ` · ${worded(AR, "Error Budget Remaining")}`,
    );
    expect(words).toHaveClass("min-w-0", "text-ellipsis", "whitespace-pre");
  });

  test("Persian: the English name in a box of its own, the bullet and the Persian words beside it", async () => {
    await inLanguage("fa");
    await renderWidget({
      metric: SloWidgetMetric.BurnRate,
      slo: buildSlo(),
    });

    expect(titleText()).toBe(`${SLO_NAME} • ${worded(FA, "Burn Rate")}`);
    expect(screen.getByTestId(SLO_WIDGET_TITLE_NAME_TEST_ID)).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  test("a chart with no history in its range: the notice's title draws the name in a box of its own too", async () => {
    await renderWidget({
      metric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
      slo: buildSlo(),
    });

    const title: HTMLElement = screen.getByTestId(SLO_WIDGET_TITLE_TEST_ID);

    expect(lineChartMock).not.toHaveBeenCalled();
    expect(title.tagName).toBe("P");
    expect(titleText()).toBe(`${SLO_NAME} · SLI`);
    expect(screen.getByTestId(SLO_WIDGET_TITLE_NAME_TEST_ID)).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(withoutIsolateMarks(title.getAttribute("title") || "")).toBe(
      `${SLO_NAME} · SLI`,
    );
  });

  /*
   * Before an SLO is picked the widget draws its title over a notice, cut
   * where the tile ends too: an English one reads its own way, so it is
   * cut at its own end (#6858).
   */
  test("no SLO picked yet: an English title over the notice reads left to right, cut at its own end", async () => {
    await renderUnpicked(UNPICKED_TITLE);

    const title: HTMLElement = screen.getByText(UNPICKED_TITLE);

    expect(title.tagName).toBe("P");
    expect(title).toHaveAttribute("dir", "ltr");
    expect(title).toHaveClass("truncate", LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("no SLO picked yet and untitled: the widget kind's name - the board's word - is drawn as it was", async () => {
    await renderUnpicked(undefined);

    const title: HTMLElement = screen.getByText(worded(AR, "SLO Widget"));

    expect(title.tagName).toBe("P");
    expect(title).not.toHaveAttribute("dir");
    expect(title).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
  });

  test("Burn rate before the first evaluation", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.BurnRate,
      slo: buildSlo(NOT_EVALUATED),
    });

    const texts: Array<string> = drawnTexts(container);

    expect(texts).toEqual(
      expect.arrayContaining([worded(AR, "Not evaluated yet")]),
    );
    expect(titleText()).toBe(`${SLO_NAME} · ${worded(AR, "Burn Rate")}`);
    expect(texts.join("\n")).not.toMatch(ENGLISH_WORDS);
  });
});

/*
 * Vazirmatn's Persian digits at one width are each as wide as its widest:
 * "۹۹٫۹۵٪" read "۹ ۹٫۹ ۵٪". A tile's figure in Persian digits takes each
 * digit's own width, as the Gauge and the Value widget beside it do; Latin
 * digits keep one width.
 */
describe("the SLO tile's figure, each digit at its width", () => {
  test("a Persian board's figure takes each digit's own width", async () => {
    await inLanguage("fa");
    await renderWidget({ metric: SloWidgetMetric.Sli, slo: buildSlo() });

    const figure: HTMLElement = screen.getByTestId(
      SLO_WIDGET_TILE_VALUE_TEST_ID,
    );

    expect(figure.textContent).toBe("۹۹٫۹۵٪");
    expect(figure).toHaveClass(PROPORTIONAL_NUMBERS_CLASS_NAME);
    expect(figure).not.toHaveClass(TABULAR_NUMBERS_CLASS_NAME);
  });

  test.each(["en", "de", "ar"])(
    "a %s board's, in Latin digits, keeps one width as it always did",
    async (language: string) => {
      await inLanguage(language);
      await renderWidget({ metric: SloWidgetMetric.Sli, slo: buildSlo() });

      const figure: HTMLElement = screen.getByTestId(
        SLO_WIDGET_TILE_VALUE_TEST_ID,
      );

      expect(figure).toHaveClass(TABULAR_NUMBERS_CLASS_NAME);
      expect(figure).not.toHaveClass(PROPORTIONAL_NUMBERS_CLASS_NAME);
    },
  );
});

describe("the SLO widget in English reads as it always did", () => {
  beforeEach(async () => {
    await inLanguage("en");
  });

  test("the title, figure and line, word for word", async () => {
    const budget: RenderResult = await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(OVER_BUDGET),
    });

    expect(drawnTexts(budget.container)).toEqual(
      expect.arrayContaining([
        `${SLO_NAME} · Error Budget Remaining`,
        "-12.5%",
        "−42 min over budget",
      ]),
    );

    cleanup();
    const sli: RenderResult = await renderWidget({
      metric: SloWidgetMetric.Sli,
      slo: buildSlo(NOT_EVALUATED),
    });

    expect(drawnTexts(sli.container)).toEqual(
      expect.arrayContaining([`${SLO_NAME} · SLI`, "Not evaluated yet"]),
    );
  });

  test("an English name's title is one line, drawn as it always was", async () => {
    await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      slo: buildSlo(),
    });

    const title: HTMLElement = screen.getByTestId(SLO_WIDGET_TITLE_TEST_ID);

    expect(title.textContent).toBe(`${SLO_NAME} · Error Budget Remaining`);
    expect(title.children).toHaveLength(0);
    expect(title).not.toHaveAttribute("dir");
    expect(title.className).toBe(
      "text-[11px] font-medium text-gray-400 truncate uppercase tracking-wider w-full text-center",
    );
  });

  /*
   * The other way round (#6858): an Arabic name on an English board is a
   * box of its own, read right to left, so it too is cut at its own end.
   */
  test("an Arabic name: a box of its own, read right to left, before the English words", async () => {
    const arabicName: string = "واجهة الدفع";

    await renderWidget({
      metric: SloWidgetMetric.BurnRate,
      slo: buildSlo({ name: arabicName }),
    });

    const title: HTMLElement = screen.getByTestId(SLO_WIDGET_TITLE_TEST_ID);
    const name: HTMLElement = screen.getByTestId(SLO_WIDGET_TITLE_NAME_TEST_ID);

    expect(titleText()).toBe(`${arabicName} · Burn Rate`);
    expect(title.firstElementChild).toBe(name);
    expect(name).toHaveAttribute("dir", "rtl");
    expect(name).toHaveClass("truncate", "shrink-0");
    expect(title.lastElementChild?.textContent).toBe(" · Burn Rate");
  });
});

describe("the SLO widget's chart in the reader's figures", () => {
  type ChartProps = {
    data: Array<{ seriesName: string }>;
    yAxis: { options: { formatter: (value: number) => string } };
    referenceLines?: Array<{ value: number; label?: string }> | undefined;
    referenceLineLabelPlacement?: ReferenceLineLabelPlacement | undefined;
    isReferenceLineLegendCentered?: boolean | undefined;
    heightInPx?: number | undefined;
  };

  // The widget's height, less its title and status rows (renderWidget's 320 px).
  const PLOT_HEIGHT_IN_PX: number = 320 - 58;

  function lastChart(): ChartProps {
    const calls: Array<Array<unknown>> = lineChartMock.mock.calls;

    expect(calls.length).toBeGreaterThan(0);

    return calls[calls.length - 1]![0] as ChartProps;
  }

  beforeEach(() => {
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: "2026-08-10T00:00:00.000Z", value: 99.95 },
        { timestamp: "2026-08-10T00:05:00.000Z", value: 99.8 },
      ],
    });
  });

  test("German: the axis and tooltip, the target's line and the series name", async () => {
    await renderWidget({
      metric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
      slo: buildSlo(),
    });
    await screen.findByTestId("line-chart");

    const chart: ChartProps = lastChart();

    expect(chart.yAxis.options.formatter(99.874)).toBe(germanPercent("99,874"));
    expect(chart.referenceLines?.[0]?.label).toBe(
      worded(DE, "Target {{target}}", { target: germanPercent("99,9") }),
    );
    expect(chart.data[0]?.seriesName).toBe("SLI");
  });

  test("the target's line is named in a legend under the plot, which gives the legend its row (#6694)", async () => {
    await renderWidget({
      metric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
      slo: buildSlo(),
    });
    await screen.findByTestId("line-chart");

    const chart: ChartProps = lastChart();

    // At the end of its line, the label sat on an SLI running near the target.
    expect(chart.referenceLineLabelPlacement).toBe(
      ReferenceLineLabelPlacement.Legend,
    );
    // Centred, as the title above the plot and the status pill under it are.
    expect(chart.isReferenceLineLegendCentered).toBe(true);
    // The legend's row comes out of the plot, so the tile never overflows.
    expect(chart.heightInPx).toBe(
      PLOT_HEIGHT_IN_PX - SLO_WIDGET_LEGEND_ROW_IN_PX,
    );
  });

  test("a chart with no target's line keeps the whole height: no legend row", async () => {
    await renderWidget({
      metric: SloWidgetMetric.ErrorBudgetRemaining,
      displayType: SloWidgetDisplayType.Chart,
      slo: buildSlo(),
    });
    await screen.findByTestId("line-chart");

    expect(lastChart().referenceLines).toBeUndefined();
    expect(lastChart().heightInPx).toBe(PLOT_HEIGHT_IN_PX);
  });

  test("German: the burn rate's axis and the budget's series name", async () => {
    await renderWidget({
      metric: SloWidgetMetric.BurnRate,
      displayType: SloWidgetDisplayType.Chart,
      slo: buildSlo(),
    });
    await screen.findByTestId("line-chart");

    expect(lastChart().yAxis.options.formatter(3.25)).toBe("3,25×");
    expect(lastChart().data[0]?.seriesName).toBe(worded(DE, "Burn Rate"));
    // Only an SLI chart draws the target.
    expect(lastChart().referenceLines).toBeUndefined();
  });

  test("English: the target's line and the axis read as before", async () => {
    await inLanguage("en");

    await renderWidget({
      metric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
      slo: buildSlo(),
    });
    await screen.findByTestId("line-chart");

    expect(lastChart().referenceLines?.[0]?.label).toBe("Target 99.9%");
    expect(lastChart().yAxis.options.formatter(99.874)).toBe("99.874%");
  });
});

describe("the SLO list widget in German and Arabic", () => {
  const FLEET: Array<ServiceLevelObjective> = [
    buildSlo({
      _id: ObjectID.generate().toString(),
      name: "Payments API",
      ...OVER_BUDGET,
      errorBudgetRemainingSeconds: -600,
    }),
    buildSlo({ _id: ObjectID.generate().toString() }),
    buildSlo({
      _id: ObjectID.generate().toString(),
      name: "New objective",
      ...NOT_EVALUATED,
    }),
  ];

  async function renderList(viewMode?: "honeycomb"): Promise<RenderResult> {
    getListMock.mockResolvedValue({
      data: FLEET,
      count: FLEET.length,
      skip: 0,
      limit: SLO_LIST_DEFAULT_MAX_ROWS,
    });

    const component: DashboardSloListComponent = {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: DashboardComponentType.SloList,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 12,
      heightInDashboardUnits: 5,
      minWidthInDashboardUnits: 6,
      minHeightInDashboardUnits: 3,
      arguments: {
        title: "Service Level Objectives",
        maxRows: SLO_LIST_DEFAULT_MAX_ROWS,
        ...(viewMode ? { viewMode: viewMode } : {}),
      },
    } as unknown as DashboardSloListComponent;

    const result: RenderResult = render(
      <DashboardSloListComponentElement
        {...baseProps(450)}
        dashboardComponentWidthInPx={1200}
        component={component}
      />,
    );

    if (viewMode) {
      await screen.findByTestId("honeycomb");
    } else {
      await screen.findByText("Payments API");
    }

    return result;
  }

  function rowTexts(name: string): Array<string> {
    const row: Element | undefined = screen
      .getAllByTestId("slo-list-row")
      .find((candidate: Element) => {
        return (candidate.textContent || "").includes(name);
      });

    expect(row).toBeDefined();

    return drawnTexts(row as HTMLElement);
  }

  test("German: the target line, the figures and the budget line of each row", async () => {
    await renderList();

    expect(rowTexts(SLO_NAME)).toEqual(
      expect.arrayContaining([
        germanPercent("99,95"),
        worded(DE, "target {{target}}", { target: germanPercent("99,9") }),
        germanPercent("42,5"),
        worded(DE, "{{count}} min remaining", { count: "60" }),
        "1,25×",
        worded(DE, "Healthy"),
      ]),
    );
    expect(rowTexts("Payments API")).toEqual(
      expect.arrayContaining([
        worded(DE, "−{{count}} min over budget", { count: "10" }),
        worded(DE, "Budget Exhausted"),
      ]),
    );
    // A new SLO's status is German too, not "Not Evaluated".
    expect(rowTexts("New objective")).toEqual(
      expect.arrayContaining([
        worded(DE, "Not Evaluated"),
        worded(DE, "target {{target}}", { target: germanPercent("99,9") }),
      ]),
    );

    const allRows: string = screen
      .getAllByTestId("slo-list-row")
      .map((row: Element) => {
        return drawnTexts(row as HTMLElement).join("\n");
      })
      .join("\n");

    expect(allRows).not.toMatch(ENGLISH_WORDS);
    expect(allRows).not.toMatch(/[0-9]\.[0-9]/);
  });

  test("Arabic: the target line and the budget line, Latin digits", async () => {
    await inLanguage("ar");
    await renderList();

    expect(rowTexts(SLO_NAME)).toEqual(
      expect.arrayContaining([
        worded(AR, "target {{target}}", { target: arabicPercent(99.9) }),
        worded(AR, "{{count}} min remaining", { count: "60" }),
        worded(AR, "Healthy"),
      ]),
    );
    expect(rowTexts("New objective")).toEqual(
      expect.arrayContaining([worded(AR, "Not Evaluated")]),
    );
    expect(rowTexts("Payments API")).toEqual(
      expect.arrayContaining([
        worded(AR, "−{{count}} min over budget", { count: "10" }),
      ]),
    );
    // The burn rate's sign after its figure, as in the single-SLO tile.
    expect(rowTexts(SLO_NAME)).toEqual(
      expect.arrayContaining([
        `1.25${LEFT_TO_RIGHT_MARK}×${LEFT_TO_RIGHT_MARK}`,
      ]),
    );

    /*
     * An English name cut short loses its end, not its start: its cell
     * reads left to right, and a short one still starts where the Arabic
     * column's name does.
     */
    for (const cell of screen.getAllByTestId("slo-list-name")) {
      expect(cell).toHaveAttribute("dir", "ltr");
      expect(cell).toHaveClass("truncate", "text-end");
    }
  });

  test("Persian: the strip's counts in Persian digits, as the rows' figures are", async () => {
    await inLanguage("fa");
    await renderList();

    const summary: HTMLElement = screen.getByTestId("slo-list-summary");

    // One SLO over budget, one healthy, one not evaluated yet.
    expect(summary.textContent).toContain("۱");
    expect(summary.textContent).not.toMatch(/[0-9]/);
  });

  test("German: the strip's counts as German writes them", async () => {
    await renderList();

    expect(screen.getByTestId("slo-list-summary").textContent).toMatch(
      /^1\D.*1\D.*1\D/,
    );
  });

  test("German: an English name's cell is drawn as it always was", async () => {
    await renderList();

    for (const cell of screen.getAllByTestId("slo-list-name")) {
      expect(cell).not.toHaveAttribute("dir");
      expect(cell).not.toHaveClass("text-end");
    }
  });

  test("the honeycomb's tiles carry the reader's figures and the status keys it looks up", async () => {
    await renderList("honeycomb");

    const tiles: Array<{
      status: string;
      tooltip: { details: Array<{ label: string; value: string }> };
    }> = (
      honeycombMock.mock.calls[honeycombMock.mock.calls.length - 1]![0] as {
        tiles: Array<{
          status: string;
          tooltip: { details: Array<{ label: string; value: string }> };
        }>;
      }
    ).tiles;

    // The honeycomb looks each status up where it draws it: every one is a key.
    expect(
      tiles.map((tile: { status: string }) => {
        return Boolean(DE[tile.status]);
      }),
    ).toEqual([true, true, true]);
    expect(tiles[2]!.status).toBe("Not Evaluated");

    expect(tiles[1]!.tooltip.details).toEqual([
      { label: "SLI", value: germanPercent("99,95") },
      { label: "Error budget", value: germanPercent("42,5") },
      { label: "Burn rate", value: "1,25×" },
    ]);
  });

  test("English rows read as they always did", async () => {
    await inLanguage("en");
    await renderList();

    expect(rowTexts(SLO_NAME)).toEqual(
      expect.arrayContaining([
        "99.95%",
        "target 99.9%",
        "42.5%",
        "60 min remaining",
        "1.25×",
      ]),
    );
    expect(rowTexts("New objective")).toEqual(
      expect.arrayContaining(["Not Evaluated", "target 99.9%"]),
    );
    expect(rowTexts("Payments API")).toEqual(
      expect.arrayContaining(["−10 min over budget"]),
    );
  });
});

/*
 * A chart over a range with no history says so in a notice (#7088): on a
 * Persian board it was the English sentence, drawn with its full stop at
 * the left. It reads in Persian now, from the right, ending where a
 * Persian sentence ends; the SLO keeps its name, drawn as written.
 */
describe("the SLO chart's notice when its range has no history", () => {
  const NO_HISTORY: string =
    "No history for the selected time range — the SLO is evaluated every few minutes.";
  const LATIN_LETTER: RegExp = /[A-Za-z]/;

  async function renderEmptyChart(): Promise<RenderResult> {
    aggregateMock.mockResolvedValue({ data: [] });

    const result: RenderResult = await renderWidget({
      metric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
      slo: buildSlo(),
    });

    expect(lineChartMock).not.toHaveBeenCalled();

    return result;
  }

  test("Persian: the notice is a Persian sentence, its only Latin word the SLO", async () => {
    await inLanguage("fa");
    await renderEmptyChart();

    const notice: string = worded(FA, NO_HISTORY);
    const drawn: HTMLElement = screen.getByText(notice);

    expect(withoutIsolateMarks(drawn.textContent || "")).toBe(notice);
    expect(notice.endsWith(".")).toBe(true);
    expect(LATIN_LETTER.test(notice.split("SLO").join(""))).toBe(false);
    expect(screen.queryByText(NO_HISTORY)).toBeNull();
  });

  test("Persian: laid out from the right, its full stop ends it at the left and the SLO reads as written", () => {
    const notice: string = worded(FA, NO_HISTORY);
    const line: ReturnType<typeof drawLine> = drawLine(notice, "rtl");
    const from: number = notice.indexOf("SLO");

    // Drawn left to right: the sentence's end, its full stop, comes first.
    expect(getDrawnText(line).startsWith(".")).toBe(true);
    expect(isDrawnAsWritten(line, from, from + "SLO".length)).toBe(true);
  });

  test("German: the notice is the German sentence", async () => {
    await inLanguage("de");
    await renderEmptyChart();

    expect(screen.getByText(worded(DE, NO_HISTORY))).toBeTruthy();
  });

  test("English: the notice reads as it always did", async () => {
    await inLanguage("en");
    await renderEmptyChart();

    expect(screen.getByText(NO_HISTORY)).toBeTruthy();
  });
});
