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
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent";
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

const EN: Record<string, string> = readDashboardLocale("en");
const DE: Record<string, string> = readDashboardLocale("de");
const AR: Record<string, string> = readDashboardLocale("ar");

const NO_BREAK_SPACE: string = "\u00A0";
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
    },
  } as unknown as DashboardSloComponent;

  const result: RenderResult = render(
    <DashboardSloComponentElement {...baseProps(320)} component={component} />,
  );

  await screen.findByText((_content: string, element: Element | null) => {
    return Boolean(
      element?.textContent?.includes(SLO_NAME) && element.children.length === 0,
    );
  });

  return result;
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
    },
  );
});

describe("the SLO widget's tile in Arabic", () => {
  beforeEach(async () => {
    await inLanguage("ar");
  });

  test("SLI: the English name is set apart in the Arabic title; Latin digits", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.Sli,
      slo: buildSlo(),
    });

    const texts: Array<string> = drawnTexts(container);
    const title: string | undefined = texts.find((text: string) => {
      return text.includes(SLO_NAME);
    });

    expect(title).toContain(isolated(SLO_NAME));
    expect(withoutIsolateMarks(title || "")).toBe(`${SLO_NAME} · SLI`);
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

    expect(
      withoutIsolateMarks(
        texts.find((text: string) => {
          return text.includes(SLO_NAME);
        }) || "",
      ),
    ).toBe(`${SLO_NAME} · ${worded(AR, "Error Budget Remaining")}`);
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

  test("Burn rate before the first evaluation", async () => {
    const { container } = await renderWidget({
      metric: SloWidgetMetric.BurnRate,
      slo: buildSlo(NOT_EVALUATED),
    });

    const texts: Array<string> = drawnTexts(container);

    expect(texts).toEqual(
      expect.arrayContaining([worded(AR, "Not evaluated yet")]),
    );
    expect(
      withoutIsolateMarks(
        texts.find((text: string) => {
          return text.includes(SLO_NAME);
        }) || "",
      ),
    ).toBe(`${SLO_NAME} · ${worded(AR, "Burn Rate")}`);
    expect(texts.join("\n")).not.toMatch(ENGLISH_WORDS);
  });
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
});

describe("the SLO widget's chart in the reader's figures", () => {
  type ChartProps = {
    data: Array<{ seriesName: string }>;
    yAxis: { options: { formatter: (value: number) => string } };
    referenceLines?: Array<{ value: number; label?: string }> | undefined;
    referenceLineLabelPlacement?: ReferenceLineLabelPlacement | undefined;
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
