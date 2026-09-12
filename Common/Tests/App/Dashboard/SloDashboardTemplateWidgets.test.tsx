import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  RenderResult,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Mounts the widgets the SLO dashboard template actually ships — every one of
 * them, taken from getTemplateConfig(DashboardTemplateType.Slo) — through the
 * REAL renderers.
 *
 * Everything else in the repo reads this template as a data structure: the
 * editorial suite (Types/Dashboard/SloDashboardTemplate.test.ts) pins which
 * widgets it carries and what arguments they hold, and the invariants suite
 * pins the grid. Neither ever renders one, so nothing catches the case where
 * the shipped ARGUMENTS and the renderer disagree: a template widget stuck on
 * its loading skeleton, a tile printing "null%" before the evaluation worker
 * has run, a chart drawing a broken frame over an empty series, or the one
 * guidance row rendering empty.
 *
 * Every assertion below starts from the template config rather than from
 * hand-built components, so a seventh SLO widget added to the template is
 * covered here without editing this file.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const lineChartRenderMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock variables above are still unassigned when the factory
 * runs. Dereferencing them lazily, at call time, is what makes this work.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<any>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

/*
 * recharts measures a 0x0 parent in jsdom, so the real chart would draw
 * nothing and every "did it mount a chart" assertion would pass for the wrong
 * reason. The stub records the props instead — which is where the reference
 * line lives — and renders a marker the assertions can count.
 *
 * (The real recharts SVG is exercised by SloWidgetChartRendering.test.tsx;
 * what is pinned here is which of the TEMPLATE's charts gets a target line.)
 */
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: LineChartStubProps): React.ReactElement => {
      lineChartRenderMock(props);
      return React.createElement(
        "div",
        { "data-testid": "line-chart" },
        `points:${props.data[0]?.data.length ?? 0}`,
      );
    },
  };
});

import DashboardSloComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent";
import DashboardTextComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTextComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardTextComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  GetHeightOfDashboardComponent,
  GetWidthOfDashboardComponent,
} from "../../../Types/Dashboard/DashboardSize";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { SLO_NOT_EVALUATED_TEXT } from "../../../Utils/Slo/SloWidgetFormat";
import ChartReferenceLineProps from "../../../UI/Components/Charts/Types/ReferenceLineProps";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";

interface LineChartStubProps {
  data: Array<SeriesPoint>;
  referenceLines?: Array<ChartReferenceLineProps> | undefined;
}

// ── the template under test ───────────────────────────────────────────────

const TEMPLATE_CONFIG: DashboardViewConfig | null = getTemplateConfig(
  DashboardTemplateType.Slo,
);

/*
 * Cast rather than guarded at every use: "the SLO template resolves to a
 * config at all" is asserted by the first test, which fails loudly before any
 * render assertion can fail confusingly.
 */
const VIEW_CONFIG: DashboardViewConfig = TEMPLATE_CONFIG as DashboardViewConfig;

const TEMPLATE_COMPONENTS: Array<DashboardBaseComponent> =
  TEMPLATE_CONFIG?.components || [];

const SLO_WIDGETS: Array<DashboardSloComponent> = TEMPLATE_COMPONENTS.filter(
  (component: DashboardBaseComponent): boolean => {
    return component.componentType === DashboardComponentType.Slo;
  },
) as unknown as Array<DashboardSloComponent>;

const TEXT_WIDGETS: Array<DashboardTextComponent> = TEMPLATE_COMPONENTS.filter(
  (component: DashboardBaseComponent): boolean => {
    return component.componentType === DashboardComponentType.Text;
  },
) as unknown as Array<DashboardTextComponent>;

const TILE_WIDGETS: Array<DashboardSloComponent> = SLO_WIDGETS.filter(
  (widget: DashboardSloComponent): boolean => {
    return widget.arguments.displayType === SloWidgetDisplayType.Tile;
  },
);

const CHART_WIDGETS: Array<DashboardSloComponent> = SLO_WIDGETS.filter(
  (widget: DashboardSloComponent): boolean => {
    return widget.arguments.displayType === SloWidgetDisplayType.Chart;
  },
);

/** The widget's own label in a failure message — ids regenerate every call. */
type GetWidgetLabelFunction = (widget: DashboardSloComponent) => string;

const getWidgetLabel: GetWidgetLabelFunction = (
  widget: DashboardSloComponent,
): string => {
  return widget.arguments.widgetTitle || "(untitled SLO widget)";
};

type GetWidgetMetricFunction = (
  widget: DashboardSloComponent,
) => SloWidgetMetric;

const getWidgetMetric: GetWidgetMetricFunction = (
  widget: DashboardSloComponent,
): SloWidgetMetric => {
  // Sli is the renderer's own fallback when the argument was never set.
  return widget.arguments.sloMetric || SloWidgetMetric.Sli;
};

// ── fixtures ──────────────────────────────────────────────────────────────

const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

/*
 * A CUSTOM range pins the chart window to fixed instants; a relative range
 * would resolve against the wall clock on every render.
 */
const START_DATE: Date = new Date("2026-08-10T00:00:00.000Z");
const END_DATE: Date = new Date("2026-08-10T06:00:00.000Z");

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
};

/*
 * The dashboard canvas is twelve units wide, so this is the width a real
 * board is laid out against; the helpers below turn each widget's DECLARED
 * units into the pixel box the canvas would give it.
 */
const TOTAL_DASHBOARD_WIDTH_IN_PX: number = 1200;

const SLO_NAME: string = "Checkout availability";
const TARGET_PERCENTAGE: number = 99.9;
const SLI_PERCENTAGE: number = 99.95;
const BUDGET_REMAINING_PERCENTAGE: number = 42.5;
const BUDGET_REMAINING_SECONDS: number = 3600;
const BURN_RATE: number = 1.25;

/**
 * What each tile must render for the row above. Written out rather than
 * computed so a change in the formatter's rounding or units fails here:
 * the SLI keeps three decimals, the budget percentage one, the budget
 * seconds collapse to whole minutes (3600s -> 60 min) and burn rate is a
 * multiplier.
 *
 * "×" is U+00D7 MULTIPLICATION SIGN, spelled as an escape so a mangled
 * file encoding cannot make this pass by accident.
 */
interface TileExpectation {
  value: string;
  subline: string | null;
}

const EXPECTED_TILE: Record<SloWidgetMetric, TileExpectation> = {
  [SloWidgetMetric.Sli]: {
    value: "99.95%",
    subline: "target 99.9%",
  },
  [SloWidgetMetric.ErrorBudgetRemaining]: {
    value: "42.5%",
    subline: "60 min remaining",
  },
  [SloWidgetMetric.BurnRate]: {
    value: "1.25×",
    subline: null,
  },
};

/** The renderer's own copy of these strings; neither is exported. */
const SETUP_MESSAGE: string = "Click to select an SLO";
const EMPTY_HISTORY_MESSAGE: RegExp = /No history for the selected/i;

type BuildSloFunction = (data?: {
  hasTarget?: boolean | undefined;
}) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  data: { hasTarget?: boolean | undefined } = {},
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.name = SLO_NAME;
  slo.currentSliPercentage = SLI_PERCENTAGE;
  slo.errorBudgetRemainingPercentage = BUDGET_REMAINING_PERCENTAGE;
  slo.errorBudgetRemainingSeconds = BUDGET_REMAINING_SECONDS;
  slo.currentBurnRate = BURN_RATE;
  slo.sloStatus = SloStatus.Healthy;

  /*
   * `targetPercentage` is nullable on the model, so leaving it unset is a
   * state a real SLO can be in — and the reference-line rule turns on it.
   */
  if (data.hasTarget !== false) {
    slo.targetPercentage = TARGET_PERCENTAGE;
  }

  return slo;
};

/**
 * An SLO the evaluation worker has not reached yet. The target is set at
 * creation time, but every state column it maintains is empty — as NULL from
 * Postgres, or absent altogether once a JSON round-trip drops it, which is
 * why both shapes are exercised.
 */
type BuildUnevaluatedSloFunction = (
  stateValue: null | undefined,
) => ServiceLevelObjective;

const buildUnevaluatedSlo: BuildUnevaluatedSloFunction = (
  stateValue: null | undefined,
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.name = SLO_NAME;
  slo.targetPercentage = TARGET_PERCENTAGE;

  const emptyState: Record<string, null | undefined> = {
    currentSliPercentage: stateValue,
    errorBudgetRemainingPercentage: stateValue,
    errorBudgetRemainingSeconds: stateValue,
    currentBurnRate: stateValue,
    sloStatus: stateValue,
  };

  return Object.assign(slo, emptyState) as unknown as ServiceLevelObjective;
};

/** One SloHistory bucket every five minutes, oldest first. */
type BuildSloHistoryFunction = (rowCount: number) => AggregatedResult;

const buildSloHistory: BuildSloHistoryFunction = (
  rowCount: number,
): AggregatedResult => {
  const rows: Array<JSONObject> = [];

  for (let index: number = 0; index < rowCount; index++) {
    rows.push({
      timestamp: new Date(
        START_DATE.getTime() + index * 5 * 60 * 1000,
      ).toISOString(),
      value: 99.9 - index * 0.01,
    });
  }

  return { data: rows } as unknown as AggregatedResult;
};

const HISTORY_ROW_COUNT: number = 8;

// ── rendering ─────────────────────────────────────────────────────────────

type BuildPropsFunction = (
  component: DashboardBaseComponent,
) => DashboardBaseComponentProps;

const buildBaseProps: BuildPropsFunction = (
  component: DashboardBaseComponent,
): DashboardBaseComponentProps => {
  /*
   * Size every widget the way the canvas does — from the units the TEMPLATE
   * declares — so the renderers' height-dependent branches (the Text widget
   * scales its font to its row height, the chart reserves rows out of its
   * tile) see the geometry the template actually ships rather than an
   * arbitrary test number. A widget shrunk to a height-1 row in the template
   * would then be exercised at that height here.
   */
  return {
    componentId: component.componentId,
    isEditMode: false,
    isSelected: false,
    key: component.componentId.toString(),
    onComponentUpdate: (): void => {
      // No widget on this template writes back through this.
    },
    totalCurrentDashboardWidthInPx: TOTAL_DASHBOARD_WIDTH_IN_PX,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: TOTAL_DASHBOARD_WIDTH_IN_PX,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: GetHeightOfDashboardComponent(
      component.heightInDashboardUnits,
      TOTAL_DASHBOARD_WIDTH_IN_PX,
    ),
    dashboardComponentWidthInPx: GetWidthOfDashboardComponent(
      component.widthInDashboardUnits,
      TOTAL_DASHBOARD_WIDTH_IN_PX,
    ),
    dashboardViewConfig: VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
  };
};

type RenderSloWidgetFunction = (widget: DashboardSloComponent) => RenderResult;

const renderSloWidget: RenderSloWidgetFunction = (
  widget: DashboardSloComponent,
): RenderResult => {
  return render(
    <DashboardSloComponentElement
      {...buildBaseProps(widget)}
      component={widget}
    />,
  );
};

type RenderTextWidgetFunction = (
  widget: DashboardTextComponent,
) => RenderResult;

const renderTextWidget: RenderTextWidgetFunction = (
  widget: DashboardTextComponent,
): RenderResult => {
  return render(
    <DashboardTextComponentElement
      {...buildBaseProps(widget)}
      component={widget}
    />,
  );
};

/**
 * Picking an objective in the settings panel writes exactly one argument
 * onto the stored widget. Cloned rather than mutated so the template's own
 * components stay unconfigured for every other test in this file.
 */
type ConfigureSloWidgetFunction = (
  widget: DashboardSloComponent,
) => DashboardSloComponent;

const configureSloWidget: ConfigureSloWidgetFunction = (
  widget: DashboardSloComponent,
): DashboardSloComponent => {
  return {
    ...widget,
    arguments: {
      ...widget.arguments,
      serviceLevelObjectiveId: SLO_ID.toString(),
    },
  };
};

/*
 * Assertions carry the widget's title on both sides so a failure names the
 * offending widget rather than reporting `false !== true` for one of six
 * identical-looking renders.
 */
type ExpectRenderedFunction = (data: {
  label: string;
  text: string | RegExp;
}) => Promise<void>;

const expectRendered: ExpectRenderedFunction = async (data: {
  label: string;
  text: string | RegExp;
}): Promise<void> => {
  await waitFor((): void => {
    const isRendered: boolean = screen.queryAllByText(data.text).length > 0;
    expect(
      `${data.label}: ${isRendered ? "renders" : "does not render"} "${String(data.text)}"`,
    ).toBe(`${data.label}: renders "${String(data.text)}"`);
  });
};

type ExpectNotRenderedFunction = (data: {
  label: string;
  text: string | RegExp;
}) => void;

const expectNotRendered: ExpectNotRenderedFunction = (data: {
  label: string;
  text: string | RegExp;
}): void => {
  const isRendered: boolean = screen.queryAllByText(data.text).length > 0;
  expect(
    `${data.label}: ${isRendered ? "renders" : "does not render"} "${String(data.text)}"`,
  ).toBe(`${data.label}: does not render "${String(data.text)}"`);
};

/** Requests the widget under test issued, whichever route it reached for. */
type CountRequestsFunction = () => number;

const countRequests: CountRequestsFunction = (): number => {
  return (
    getItemMock.mock.calls.length +
    getListMock.mock.calls.length +
    aggregateMock.mock.calls.length
  );
};

type GetLastChartPropsFunction = () => LineChartStubProps;

const getLastChartProps: GetLastChartPropsFunction = (): LineChartStubProps => {
  const calls: Array<Array<unknown>> = lineChartRenderMock.mock
    .calls as unknown as Array<Array<unknown>>;

  return calls[calls.length - 1]![0] as LineChartStubProps;
};

beforeEach((): void => {
  jest.clearAllMocks();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getItemMock.mockResolvedValue(buildSlo());
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 1 });
  aggregateMock.mockResolvedValue(buildSloHistory(HISTORY_ROW_COUNT));
});

afterEach((): void => {
  cleanup();
});

describe("SLO dashboard template — what it ships", () => {
  test("resolves to a config carrying SLO widgets in both display types", () => {
    /*
     * Every loop below iterates one of these arrays, so an empty one would
     * make those tests pass vacuously for ever. This is the guard.
     */
    expect(TEMPLATE_CONFIG).not.toBeNull();
    expect(SLO_WIDGETS.length).toBeGreaterThan(0);
    expect(TEXT_WIDGETS.length).toBeGreaterThan(0);
    expect(TILE_WIDGETS.length).toBeGreaterThan(0);
    expect(CHART_WIDGETS.length).toBeGreaterThan(0);

    /*
     * A widget whose displayType was dropped would fall out of BOTH groups
     * and be silently skipped by the display-type tests.
     */
    expect(TILE_WIDGETS.length + CHART_WIDGETS.length).toBe(SLO_WIDGETS.length);

    /*
     * The premise of the setup-state tests: a template cannot know a
     * project's SLO ids, so it ships none. If this ever changes, the widget
     * renders data instead of its setup state and the tests below become
     * meaningless rather than failing for a good reason.
     */
    for (const widget of SLO_WIDGETS) {
      const label: string = getWidgetLabel(widget);
      expect(
        `${label}: ${widget.arguments.serviceLevelObjectiveId || "no objective"}`,
      ).toBe(`${label}: no objective`);
    }
  });
});

describe("SLO dashboard template — unconfigured widgets", () => {
  test("every SLO widget renders its own title in the setup state and queries nothing", async () => {
    expect(SLO_WIDGETS.length).toBeGreaterThan(0);

    for (const widget of SLO_WIDGETS) {
      const label: string = getWidgetLabel(widget);
      const requestsBefore: number = countRequests();

      renderSloWidget(widget);

      await expectRendered({ label: label, text: SETUP_MESSAGE });

      /*
       * The title is what makes six identical placeholders tell the reader
       * which tile is which before anything is configured — the reason the
       * template sets widgetTitle on every one of them.
       */
      await expectRendered({ label: label, text: label });

      /*
       * A widget with no objective must not reach ANY endpoint: on a public
       * dashboard the stored id is the authorization decision, so a request
       * without one has nothing the server could scope.
       */
      expect(`${label}: ${countRequests() - requestsBefore} requests`).toBe(
        `${label}: 0 requests`,
      );

      cleanup();
    }
  });

  test("an unconfigured Tile offers setup rather than claiming the SLO is unevaluated", async () => {
    expect(TILE_WIDGETS.length).toBeGreaterThan(0);

    for (const widget of TILE_WIDGETS) {
      const label: string = getWidgetLabel(widget);

      renderSloWidget(widget);

      await expectRendered({ label: label, text: SETUP_MESSAGE });

      /*
       * Two different empty states that must not be confused: "nothing is
       * chosen" is the reader's next action, "not evaluated yet" is a claim
       * about an SLO — and there is no SLO here to make it about.
       */
      expectNotRendered({ label: label, text: SLO_NOT_EVALUATED_TEXT });

      cleanup();
    }
  });

  test("an unconfigured Chart offers setup rather than mounting an empty chart", async () => {
    expect(CHART_WIDGETS.length).toBeGreaterThan(0);

    for (const widget of CHART_WIDGETS) {
      const label: string = getWidgetLabel(widget);
      const chartsBefore: number = lineChartRenderMock.mock.calls.length;

      renderSloWidget(widget);

      await expectRendered({ label: label, text: SETUP_MESSAGE });

      expect(
        `${label}: ${lineChartRenderMock.mock.calls.length - chartsBefore} charts mounted`,
      ).toBe(`${label}: 0 charts mounted`);

      cleanup();
    }
  });

  test("reaches the setup state even before a project is resolved", async () => {
    /*
     * The unconfigured branch returns before the project check, so a board
     * opened while the session's project is still unresolved shows the
     * reader what to do instead of the "No project selected." error.
     */
    getCurrentProjectIdMock.mockReturnValue(null);

    for (const widget of SLO_WIDGETS) {
      const label: string = getWidgetLabel(widget);

      renderSloWidget(widget);

      await expectRendered({ label: label, text: SETUP_MESSAGE });
      expectNotRendered({ label: label, text: "No project selected." });

      cleanup();
    }
  });
});

describe("SLO dashboard template — a configured Objective Health tile", () => {
  test("each tile renders its own metric's number and subline", async () => {
    expect(TILE_WIDGETS.length).toBeGreaterThan(0);

    const coveredMetrics: Set<SloWidgetMetric> = new Set<SloWidgetMetric>();

    for (const widget of TILE_WIDGETS) {
      const label: string = getWidgetLabel(widget);
      const metric: SloWidgetMetric = getWidgetMetric(widget);
      const expected: TileExpectation = EXPECTED_TILE[metric];

      coveredMetrics.add(metric);

      renderSloWidget(configureSloWidget(widget));

      await expectRendered({ label: label, text: expected.value });

      if (expected.subline !== null) {
        await expectRendered({ label: label, text: expected.subline });
      }

      /*
       * The three tiles read three different columns off the same row, so a
       * tile wired to the wrong metric would still render a plausible
       * number. Pin that each one renders ONLY its own.
       */
      for (const otherMetric of Object.values(SloWidgetMetric)) {
        if (otherMetric === metric) {
          continue;
        }

        expectNotRendered({
          label: label,
          text: EXPECTED_TILE[otherMetric].value,
        });
      }

      cleanup();
    }

    /*
     * The template is an SLO review in the order it is read — where the
     * service is, how much room is left, how fast it is going — so all three
     * numbers have to be on the board.
     */
    expect(coveredMetrics.size).toBe(Object.keys(EXPECTED_TILE).length);
  });

  test.each([
    ["NULL state columns", null],
    ["absent state columns", undefined],
  ])(
    "says the SLO is not evaluated yet for %s, never null or NaN",
    async (_shape: string, stateValue: null | undefined) => {
      getItemMock.mockResolvedValue(buildUnevaluatedSlo(stateValue));

      expect(TILE_WIDGETS.length).toBeGreaterThan(0);

      for (const widget of TILE_WIDGETS) {
        const label: string = getWidgetLabel(widget);

        const { container }: RenderResult = renderSloWidget(
          configureSloWidget(widget),
        );

        await expectRendered({ label: label, text: SLO_NOT_EVALUATED_TEXT });

        /*
         * The whole reason the not-evaluated state exists: the worker's
         * columns are empty until it first runs, and formatting one of them
         * anyway renders "null%" / "NaN%" at tile size.
         */
        const renderedText: string = container.textContent || "";
        const leakedValue: RegExpMatchArray | null =
          renderedText.match(/null|NaN|undefined/i);

        expect(
          `${label}: ${leakedValue ? leakedValue[0] : "no leaked value"}`,
        ).toBe(`${label}: no leaked value`);

        // Nor any of the numbers an evaluated SLO would have rendered.
        for (const metric of Object.values(SloWidgetMetric)) {
          expectNotRendered({
            label: label,
            text: EXPECTED_TILE[metric].value,
          });
        }

        cleanup();
      }
    },
  );
});

describe("SLO dashboard template — the Error Budget Trends charts", () => {
  test("an empty SloHistory series renders the empty state, not a chart", async () => {
    aggregateMock.mockResolvedValue(buildSloHistory(0));

    expect(CHART_WIDGETS.length).toBeGreaterThan(0);

    for (const widget of CHART_WIDGETS) {
      const label: string = getWidgetLabel(widget);
      const chartsBefore: number = lineChartRenderMock.mock.calls.length;

      renderSloWidget(configureSloWidget(widget));

      await expectRendered({ label: label, text: EMPTY_HISTORY_MESSAGE });

      /*
       * A chart mounted over zero points draws axes around nothing, which
       * reads as a broken widget rather than as "the worker has not written
       * anything inside this window yet".
       */
      expect(
        `${label}: ${lineChartRenderMock.mock.calls.length - chartsBefore} charts mounted`,
      ).toBe(`${label}: 0 charts mounted`);

      cleanup();
    }
  });

  test("every chart plots the history it was given", async () => {
    expect(CHART_WIDGETS.length).toBeGreaterThan(0);

    for (const widget of CHART_WIDGETS) {
      const label: string = getWidgetLabel(widget);

      renderSloWidget(configureSloWidget(widget));

      await expectRendered({
        label: label,
        text: `points:${HISTORY_ROW_COUNT}`,
      });

      cleanup();
    }
  });

  test("the SLI chart draws the objective's target as a reference line", async () => {
    const sliChart: DashboardSloComponent | undefined = CHART_WIDGETS.find(
      (widget: DashboardSloComponent): boolean => {
        return getWidgetMetric(widget) === SloWidgetMetric.Sli;
      },
    );

    /*
     * "Are we above the line" is the question the Error Budget Trends row
     * exists to answer at a glance, so the template must carry an SLI chart
     * for this test to be about anything.
     */
    expect(sliChart).toBeDefined();

    renderSloWidget(configureSloWidget(sliChart as DashboardSloComponent));

    await expectRendered({
      label: "SLI chart",
      text: `points:${HISTORY_ROW_COUNT}`,
    });

    const referenceLines: Array<ChartReferenceLineProps> =
      getLastChartProps().referenceLines || [];

    expect(referenceLines.length).toBe(1);
    expect(referenceLines[0]!.value).toBe(TARGET_PERCENTAGE);
    expect(referenceLines[0]!.label).toBe(`Target ${TARGET_PERCENTAGE}%`);
  });

  test("omits the target line when the SLO has no targetPercentage", async () => {
    getItemMock.mockResolvedValue(buildSlo({ hasTarget: false }));

    const sliChart: DashboardSloComponent | undefined = CHART_WIDGETS.find(
      (widget: DashboardSloComponent): boolean => {
        return getWidgetMetric(widget) === SloWidgetMetric.Sli;
      },
    );

    expect(sliChart).toBeDefined();

    renderSloWidget(configureSloWidget(sliChart as DashboardSloComponent));

    /*
     * The chart still has to draw — otherwise "no reference line" would be
     * true because nothing rendered at all.
     */
    await expectRendered({
      label: "SLI chart without a target",
      text: `points:${HISTORY_ROW_COUNT}`,
    });

    /*
     * A line at 0 (or at NaN) would read as a target of zero percent, which
     * is a reliability claim the SLO never made.
     */
    expect(getLastChartProps().referenceLines || []).toEqual([]);
  });

  test("the budget and burn-rate charts never draw a target line", async () => {
    const otherCharts: Array<DashboardSloComponent> = CHART_WIDGETS.filter(
      (widget: DashboardSloComponent): boolean => {
        return getWidgetMetric(widget) !== SloWidgetMetric.Sli;
      },
    );

    expect(otherCharts.length).toBeGreaterThan(0);

    for (const widget of otherCharts) {
      const label: string = getWidgetLabel(widget);

      renderSloWidget(configureSloWidget(widget));

      await expectRendered({
        label: label,
        text: `points:${HISTORY_ROW_COUNT}`,
      });

      /*
       * targetPercentage is a percentage of the SLI; drawn across a burn
       * rate ("99.9x") or across remaining budget it is meaningless, and
       * the SLO row carries one on every one of these renders.
       */
      const referenceLines: Array<ChartReferenceLineProps> =
        getLastChartProps().referenceLines || [];

      expect(`${label}: ${referenceLines.length} reference lines`).toBe(
        `${label}: 0 reference lines`,
      );

      cleanup();
    }
  });
});

describe("SLO dashboard template — the text rows", () => {
  test("every text row renders its configured sentence in full", () => {
    expect(TEXT_WIDGETS.length).toBeGreaterThan(0);

    for (const widget of TEXT_WIDGETS) {
      const text: string = widget.arguments.text;
      const { container }: RenderResult = renderTextWidget(widget);

      const rendered: HTMLElement | null = screen.queryByText(text);

      expect(`"${text}" -> "${rendered?.textContent ?? ""}"`).toBe(
        `"${text}" -> "${text}"`,
      );

      // The renderer's own placeholder for a row with nothing to say.
      expect(container.textContent).not.toContain("No text configured");

      /*
       * Section headers are bold and the guidance row is not — the one
       * visual cue that separates an instruction from a heading.
       */
      const expectedWeight: string = widget.arguments.isBold
        ? "font-semibold"
        : "font-normal";

      expect(
        `"${text}" -> ${rendered?.className.includes(expectedWeight) ? expectedWeight : rendered?.className}`,
      ).toBe(`"${text}" -> ${expectedWeight}`);

      cleanup();
    }
  });

  test("the guidance row renders the whole instruction at a legible size", () => {
    /*
     * Row 1 is the one instruction a reader needs on a freshly created SLO
     * dashboard: every widget above is inert until an objective is picked,
     * and the widgets' own "Click to select an SLO" does nothing in the view
     * mode a template opens in. A clipped or empty render loses that.
     */
    const guidance: DashboardTextComponent | undefined = TEXT_WIDGETS.find(
      (widget: DashboardTextComponent): boolean => {
        return widget.topInDashboardUnits === 1;
      },
    );

    expect(guidance).toBeDefined();

    const widget: DashboardTextComponent = guidance as DashboardTextComponent;
    const text: string = widget.arguments.text;

    renderTextWidget(widget);

    const rendered: HTMLElement = screen.getByText(text);

    // Rendered whole: not the first clause, not an ellipsis.
    expect(rendered.textContent).toBe(text);
    expect((rendered.textContent || "").length).toBe(text.length);

    /*
     * The Text widget scales its font to the row height. A height-1 row that
     * resolved to 0 (or to a non-number) would render the sentence
     * invisibly while every text assertion above still passed.
     */
    const fontSizeInPx: number = Number.parseFloat(rendered.style.fontSize);

    expect(Number.isFinite(fontSizeInPx)).toBe(true);
    expect(fontSizeInPx).toBeGreaterThan(0);
    expect(fontSizeInPx).toBeLessThanOrEqual(64);
  });
});
