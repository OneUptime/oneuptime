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
 * REAL renderers, in the two states a reader meets them in: the toolbar on
 * "All" (a freshly created dashboard) and one SLO picked.
 *
 * The editorial and scoping suites read the template as data. Nothing there
 * catches the shipped ARGUMENTS and the renderers disagreeing: an SLO widget
 * stuck on a skeleton, a fresh dashboard that asks the reader to edit it, a
 * tile printing "null%", the fleet list waiting for a pick it does not need,
 * or a heading that renders empty.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const lineChartRenderMock: MockFunction = getJestMockFunction();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
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
 * recharts measures a 0x0 parent in jsdom, so the stub records the props —
 * which is where the reference line lives — and renders a countable marker.
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

// The SLO List links rows with a react-router Link.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return React.createElement("a", null, props.children);
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

import DashboardSloComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent";
import DashboardSloListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloListComponent";
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
import DashboardSloListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardSloListComponent";
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
import DashboardVariable from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { SLO_WIDGET_NO_SELECTION_TEXT } from "../../../Utils/Dashboard/SloWidgetSource";
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
 * Cast rather than guarded at every use: "the template resolves to a config"
 * is asserted by the first test, which fails loudly before any render test
 * can fail confusingly.
 */
const VIEW_CONFIG: DashboardViewConfig = TEMPLATE_CONFIG as DashboardViewConfig;

const TEMPLATE_COMPONENTS: Array<DashboardBaseComponent> =
  TEMPLATE_CONFIG?.components || [];

function ofType<T>(componentType: DashboardComponentType): Array<T> {
  return TEMPLATE_COMPONENTS.filter(
    (component: DashboardBaseComponent): boolean => {
      return component.componentType === componentType;
    },
  ) as unknown as Array<T>;
}

const SLO_WIDGETS: Array<DashboardSloComponent> = ofType<DashboardSloComponent>(
  DashboardComponentType.Slo,
);
const SLO_LIST_WIDGETS: Array<DashboardSloListComponent> =
  ofType<DashboardSloListComponent>(DashboardComponentType.SloList);
const TEXT_WIDGETS: Array<DashboardTextComponent> =
  ofType<DashboardTextComponent>(DashboardComponentType.Text);

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

// The variables exactly as the template ships them: the toolbar on "All".
const SHIPPED_VARIABLES: Array<DashboardVariable> =
  TEMPLATE_CONFIG?.variables || [];

// ── fixtures ──────────────────────────────────────────────────────────────

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PICKED_SLO_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SLO_NAME: string = "Checkout availability";

const PICKED_VARIABLES: Array<DashboardVariable> = SHIPPED_VARIABLES.map(
  (variable: DashboardVariable): DashboardVariable => {
    return { ...variable, selectedValue: SLO_NAME };
  },
);

const START_DATE: Date = new Date("2026-08-10T00:00:00.000Z");
const END_DATE: Date = new Date("2026-08-10T06:00:00.000Z");

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
};

const TOTAL_DASHBOARD_WIDTH_IN_PX: number = 1200;
const TARGET_PERCENTAGE: number = 99.9;
const HISTORY_ROW_COUNT: number = 8;

interface TileExpectation {
  value: string;
  subline: string | null;
}

/*
 * Written out rather than computed, so a change in the formatter's rounding
 * or units fails here. "×" is U+00D7 MULTIPLICATION SIGN.
 */
const EXPECTED_TILE: Record<SloWidgetMetric, TileExpectation> = {
  [SloWidgetMetric.Sli]: { value: "99.95%", subline: "target 99.9%" },
  [SloWidgetMetric.ErrorBudgetRemaining]: {
    value: "42.5%",
    subline: "60 min remaining",
  },
  [SloWidgetMetric.BurnRate]: { value: "1.25×", subline: null },
};

type BuildSloFunction = (
  overrides?: Partial<ServiceLevelObjective>,
) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  overrides: Partial<ServiceLevelObjective> = {},
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = PICKED_SLO_ID.toString();
  slo.name = SLO_NAME;
  slo.targetPercentage = TARGET_PERCENTAGE;
  slo.currentSliPercentage = 99.95;
  slo.errorBudgetRemainingPercentage = 42.5;
  slo.errorBudgetRemainingSeconds = 3600;
  slo.currentBurnRate = 1.25;
  slo.sloStatus = SloStatus.Healthy;
  return Object.assign(slo, overrides);
};

const FLEET: Array<ServiceLevelObjective> = [
  buildSlo({
    _id: ObjectID.generate().toString(),
    name: "Payments API",
    errorBudgetRemainingPercentage: 3,
    sloStatus: SloStatus.AtRisk,
  }),
  buildSlo(),
];

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

/*
 * One ModelAPI.getList, two callers: an SLO widget looks a picked name up with
 * a two-row read; the SLO List reads the fleet with its own cap.
 */
type RespondToListFunction = (args: JSONObject) => JSONObject;

let sloForNameLookup: ServiceLevelObjective = buildSlo();

const respondToList: RespondToListFunction = (args: JSONObject): JSONObject => {
  if (args["limit"] === 2) {
    return { data: [sloForNameLookup], count: 1 };
  }

  return { data: FLEET, count: FLEET.length };
};

// ── rendering ─────────────────────────────────────────────────────────────

type BuildPropsFunction = (data: {
  component: DashboardBaseComponent;
  variables: Array<DashboardVariable>;
}) => DashboardBaseComponentProps;

/*
 * Size every widget the way the canvas does — from the units the TEMPLATE
 * declares — so height-dependent branches see the geometry actually shipped.
 */
const buildBaseProps: BuildPropsFunction = (data: {
  component: DashboardBaseComponent;
  variables: Array<DashboardVariable>;
}): DashboardBaseComponentProps => {
  return {
    componentId: data.component.componentId,
    isEditMode: false,
    isSelected: false,
    key: data.component.componentId.toString(),
    onComponentUpdate: (): void => {
      // No widget on this template writes back through this.
    },
    totalCurrentDashboardWidthInPx: TOTAL_DASHBOARD_WIDTH_IN_PX,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: TOTAL_DASHBOARD_WIDTH_IN_PX,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: GetHeightOfDashboardComponent(
      data.component.heightInDashboardUnits,
      TOTAL_DASHBOARD_WIDTH_IN_PX,
    ),
    dashboardComponentWidthInPx: GetWidthOfDashboardComponent(
      data.component.widthInDashboardUnits,
      TOTAL_DASHBOARD_WIDTH_IN_PX,
    ),
    dashboardViewConfig: VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: data.variables,
  };
};

type RenderSloWidgetFunction = (
  widget: DashboardSloComponent,
  variables: Array<DashboardVariable>,
) => RenderResult;

const renderSloWidget: RenderSloWidgetFunction = (
  widget: DashboardSloComponent,
  variables: Array<DashboardVariable>,
): RenderResult => {
  return render(
    <DashboardSloComponentElement
      {...buildBaseProps({ component: widget, variables })}
      component={widget}
    />,
  );
};

type LabelOfFunction = (widget: DashboardSloComponent) => string;

const labelOf: LabelOfFunction = (widget: DashboardSloComponent): string => {
  return widget.arguments.widgetTitle || "(untitled SLO widget)";
};

type CountRequestsFunction = () => number;

const countRequests: CountRequestsFunction = (): number => {
  return (
    getItemMock.mock.calls.length +
    getListMock.mock.calls.length +
    aggregateMock.mock.calls.length
  );
};

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

type GetLastChartPropsFunction = () => LineChartStubProps;

const getLastChartProps: GetLastChartPropsFunction = (): LineChartStubProps => {
  const calls: Array<Array<unknown>> = lineChartRenderMock.mock
    .calls as unknown as Array<Array<unknown>>;

  return calls[calls.length - 1]![0] as LineChartStubProps;
};

beforeEach((): void => {
  jest.clearAllMocks();
  sloForNameLookup = buildSlo();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getItemMock.mockResolvedValue(buildSlo());
  getListMock.mockImplementation((args: unknown) => {
    return Promise.resolve(respondToList(args as JSONObject));
  });
  aggregateMock.mockResolvedValue(buildSloHistory(HISTORY_ROW_COUNT));
});

afterEach((): void => {
  cleanup();
});

describe("SLO dashboard template — what it ships", () => {
  test("resolves to SLO widgets in both display types, the SLO List, headings and the SLO variable", () => {
    /*
     * Every loop below iterates one of these arrays, so an empty one would make
     * those tests pass vacuously for ever. This is the guard.
     */
    expect(TEMPLATE_CONFIG).not.toBeNull();
    expect(TILE_WIDGETS.length).toBeGreaterThan(0);
    expect(CHART_WIDGETS.length).toBeGreaterThan(0);
    expect(TILE_WIDGETS.length + CHART_WIDGETS.length).toBe(SLO_WIDGETS.length);
    expect(SLO_LIST_WIDGETS).toHaveLength(1);
    expect(TEXT_WIDGETS.length).toBeGreaterThan(0);
    expect(SHIPPED_VARIABLES).toHaveLength(1);

    // The premise of everything below: every SLO widget follows that variable.
    for (const widget of SLO_WIDGETS) {
      expect(
        `${labelOf(widget)}: pinned=${widget.arguments.serviceLevelObjectiveId || "none"} follows=${widget.arguments.serviceLevelObjectiveVariableId}`,
      ).toBe(
        `${labelOf(widget)}: pinned=none follows=${(SHIPPED_VARIABLES[0] as DashboardVariable).id}`,
      );
    }
  });
});

describe("SLO dashboard template — as created, with the toolbar on All", () => {
  /*
   * The complaint this rewrite answers: a fresh SLO dashboard opened on six
   * inert "Click to select an SLO" widgets and a row telling the reader to
   * edit it. Now every SLO widget names the one control that works in the view
   * mode a new dashboard opens in — and asks nothing of the server until used.
   */
  test("every SLO widget asks for a toolbar pick under its own title, and reads nothing", async () => {
    for (const widget of SLO_WIDGETS) {
      const label: string = labelOf(widget);
      const requestsBefore: number = countRequests();

      renderSloWidget(widget, SHIPPED_VARIABLES);

      await expectRendered({ label, text: SLO_WIDGET_NO_SELECTION_TEXT });
      await expectRendered({ label, text: label });
      expectNotRendered({ label, text: "Click to select an SLO" });
      expectNotRendered({ label, text: SLO_NOT_EVALUATED_TEXT });

      expect(`${label}: ${countRequests() - requestsBefore} requests`).toBe(
        `${label}: 0 requests`,
      );
      expect(lineChartRenderMock).not.toHaveBeenCalled();

      cleanup();
    }
  });

  test("reaches the toolbar prompt even before a project is resolved", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    for (const widget of SLO_WIDGETS) {
      renderSloWidget(widget, SHIPPED_VARIABLES);

      await expectRendered({
        label: labelOf(widget),
        text: SLO_WIDGET_NO_SELECTION_TEXT,
      });
      expectNotRendered({
        label: labelOf(widget),
        text: "No project selected.",
      });

      cleanup();
    }
  });

  /*
   * The fleet does not wait for anything: the SLO List queries the moment the
   * dashboard is created, every active objective, least budget first.
   */
  test("the SLO List shows the fleet immediately", async () => {
    const list: DashboardSloListComponent =
      SLO_LIST_WIDGETS[0] as DashboardSloListComponent;

    render(
      <DashboardSloListComponentElement
        {...buildBaseProps({ component: list, variables: SHIPPED_VARIABLES })}
        component={list}
      />,
    );

    expect(await screen.findAllByTestId("slo-list-row")).toHaveLength(
      FLEET.length,
    );
    expect(screen.getByText("Service Level Objectives")).toBeInTheDocument();

    const args: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;

    expect(args["query"]).toEqual({ projectId: PROJECT_ID, isArchived: false });
  });
});

describe("SLO dashboard template — with an SLO picked in the toolbar", () => {
  test("each tile renders its own metric's number and subline, under the picked SLO's name", async () => {
    const covered: Set<SloWidgetMetric> = new Set<SloWidgetMetric>();

    for (const widget of TILE_WIDGETS) {
      const label: string = labelOf(widget);
      const metric: SloWidgetMetric =
        widget.arguments.sloMetric || SloWidgetMetric.Sli;
      const expected: TileExpectation = EXPECTED_TILE[metric];

      covered.add(metric);

      renderSloWidget(widget, PICKED_VARIABLES);

      await expectRendered({ label, text: expected.value });
      await expectRendered({ label, text: `${SLO_NAME} · ${label}` });

      if (expected.subline !== null) {
        await expectRendered({ label, text: expected.subline });
      }

      /*
       * Three tiles read three columns off one row, so a tile wired to the
       * wrong metric would still render a plausible number.
       */
      for (const otherMetric of Object.values(SloWidgetMetric)) {
        if (otherMetric !== metric) {
          expectNotRendered({ label, text: EXPECTED_TILE[otherMetric].value });
        }
      }

      cleanup();
    }

    expect(covered.size).toBe(Object.keys(EXPECTED_TILE).length);
  });

  test.each([
    ["NULL state columns", null],
    ["absent state columns", undefined],
  ])(
    "says the SLO is not evaluated yet for %s, never null or NaN",
    async (_shape: string, stateValue: null | undefined) => {
      sloForNameLookup = Object.assign(buildSlo(), {
        currentSliPercentage: stateValue,
        errorBudgetRemainingPercentage: stateValue,
        errorBudgetRemainingSeconds: stateValue,
        currentBurnRate: stateValue,
        sloStatus: stateValue,
      }) as unknown as ServiceLevelObjective;

      for (const widget of TILE_WIDGETS) {
        const label: string = labelOf(widget);
        const { container }: RenderResult = renderSloWidget(
          widget,
          PICKED_VARIABLES,
        );

        await expectRendered({ label, text: SLO_NOT_EVALUATED_TEXT });

        const leaked: RegExpMatchArray | null = (
          container.textContent || ""
        ).match(/null|NaN|undefined/i);

        expect(`${label}: ${leaked ? leaked[0] : "no leaked value"}`).toBe(
          `${label}: no leaked value`,
        );

        cleanup();
      }
    },
  );

  test("every history chart plots the picked SLO's series by its id", async () => {
    for (const widget of CHART_WIDGETS) {
      const label: string = labelOf(widget);

      aggregateMock.mockClear();
      renderSloWidget(widget, PICKED_VARIABLES);

      await expectRendered({ label, text: `points:${HISTORY_ROW_COUNT}` });

      const query: JSONObject = (
        (aggregateMock.mock.calls[0]![0] as JSONObject)[
          "aggregateBy"
        ] as JSONObject
      )["query"] as JSONObject;

      expect(`${label}: ${(query["sloId"] as ObjectID).toString()}`).toBe(
        `${label}: ${PICKED_SLO_ID.toString()}`,
      );

      cleanup();
    }
  });

  test("the SLI history draws the objective's target as a reference line; the others draw none", async () => {
    for (const widget of CHART_WIDGETS) {
      const label: string = labelOf(widget);
      const isSli: boolean = widget.arguments.sloMetric === SloWidgetMetric.Sli;

      renderSloWidget(widget, PICKED_VARIABLES);

      await expectRendered({ label, text: `points:${HISTORY_ROW_COUNT}` });

      const referenceLines: Array<ChartReferenceLineProps> =
        getLastChartProps().referenceLines || [];

      if (isSli) {
        expect(referenceLines).toHaveLength(1);
        expect(referenceLines[0]!.value).toBe(TARGET_PERCENTAGE);
        expect(referenceLines[0]!.label).toBe(`Target ${TARGET_PERCENTAGE}%`);
      } else {
        expect(`${label}: ${referenceLines.length} reference lines`).toBe(
          `${label}: 0 reference lines`,
        );
      }

      cleanup();
    }
  });

  test("an empty history renders the empty state, not an empty chart", async () => {
    aggregateMock.mockResolvedValue(buildSloHistory(0));

    for (const widget of CHART_WIDGETS) {
      const label: string = labelOf(widget);
      const chartsBefore: number = lineChartRenderMock.mock.calls.length;

      renderSloWidget(widget, PICKED_VARIABLES);

      await expectRendered({ label, text: /No history for the selected/i });
      expect(
        `${label}: ${lineChartRenderMock.mock.calls.length - chartsBefore} charts`,
      ).toBe(`${label}: 0 charts`);

      cleanup();
    }
  });

  test("the SLO List narrows to the picked objective", async () => {
    const list: DashboardSloListComponent =
      SLO_LIST_WIDGETS[0] as DashboardSloListComponent;

    render(
      <DashboardSloListComponentElement
        {...buildBaseProps({ component: list, variables: PICKED_VARIABLES })}
        component={list}
      />,
    );

    await screen.findAllByTestId("slo-list-row");

    expect(
      (getListMock.mock.calls[0]![0] as JSONObject)["query"] as JSONObject,
    ).toEqual({ projectId: PROJECT_ID, isArchived: false, name: SLO_NAME });
  });
});

describe("SLO dashboard template — the text rows", () => {
  test("every text row is a bold heading that renders its words in full at a legible size", () => {
    for (const widget of TEXT_WIDGETS) {
      const text: string = widget.arguments.text;

      render(
        <DashboardTextComponentElement
          {...buildBaseProps({
            component: widget,
            variables: SHIPPED_VARIABLES,
          })}
          component={widget}
        />,
      );

      const rendered: HTMLElement = screen.getByText(text);

      expect(rendered.textContent).toBe(text);
      /*
       * No instruction row: every text row is a heading, which the renderer
       * gives `font-semibold`.
       */
      expect(
        `"${text}" bold=${rendered.className.includes("font-semibold")}`,
      ).toBe(`"${text}" bold=true`);

      const fontSizeInPx: number = Number.parseFloat(rendered.style.fontSize);

      expect(Number.isFinite(fontSizeInPx)).toBe(true);
      expect(fontSizeInPx).toBeGreaterThan(0);

      cleanup();
    }
  });
});
