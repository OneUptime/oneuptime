/**
 * @timezone UTC
 */
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
 * The SLO widget's Chart display renders a real recharts line — and it is
 * exactly there that it broke. Every sibling suite stubs LineChart out and
 * asserts on the props handed down, which is why the bug survived: the props
 * were right, the REQUEST was right, the data was right, and recharts still
 * drew nothing, because the widget labelled its x-axis "" and the chart rows
 * were keyed off that label while recharts was told to read "Time".
 *
 * So this suite deliberately renders the real chart and asserts on the SVG
 * the viewer actually gets. It covers both surfaces the widget runs on: the
 * anonymous public dashboard (where the bug was reported) and the
 * authenticated one (where it was equally broken, just unnoticed).
 *
 * Pinned to UTC: the x-axis bucket labels are produced by local-time
 * formatters.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

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
 * The ONLY thing stubbed in the chart stack. ResponsiveContainer measures its
 * parent, which is always 0x0 in jsdom, and a 0x0 recharts chart draws no
 * marks — which would make every assertion below pass for the wrong reason.
 */
jest.mock("recharts", () => {
  const actual: Record<string, any> = jest.requireActual("recharts") as Record<
    string,
    any
  >;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

import DashboardSloComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DASHBOARD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

/*
 * A CUSTOM range pins the window to fixed instants; a relative range would
 * resolve against the wall clock. Six hours buckets at five minutes, which
 * is the cadence the evaluation worker writes at.
 */
const START_DATE: Date = new Date("2026-08-10T00:00:00.000Z");
const END_DATE: Date = new Date("2026-08-10T06:00:00.000Z");

const DASHBOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START_DATE, END_DATE),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

/** SVG the viewer sees only when recharts actually plotted the series. */
const LINE_SELECTOR: string = "path.recharts-line-curve";

let publicResponse: JSONObject = { data: [] };

const PUBLIC_DASHBOARD_CONTEXT: PublicDashboardContext = {
  dashboardId: DASHBOARD_ID,
  apiUrl: {
    toString: (): string => {
      return "http://localhost/public-dashboard-api";
    },
  },
  postJSON: () => {
    return Promise.resolve({
      data: publicResponse,
    } as unknown as HTTPResponse<JSONObject>);
  },
} as unknown as PublicDashboardContext;

/** One row every five minutes across the window, oldest first. */
type BuildHistoryFunction = (data?: {
  rowCount?: number | undefined;
  valueAt?: ((index: number) => number | string) | undefined;
}) => Array<JSONObject>;

const buildHistory: BuildHistoryFunction = (
  data: {
    rowCount?: number | undefined;
    valueAt?: ((index: number) => number | string) | undefined;
  } = {},
): Array<JSONObject> => {
  const rowCount: number = data.rowCount ?? 12;
  const rows: Array<JSONObject> = [];

  for (let index: number = 0; index < rowCount; index++) {
    rows.push({
      timestamp: new Date(
        START_DATE.getTime() + index * 5 * 60 * 1000,
      ).toISOString(),
      value: data.valueAt ? data.valueAt(index) : 99.9 - index * 0.01,
    });
  }

  return rows;
};

type BuildSloFunction = (
  overrides?: Partial<ServiceLevelObjective>,
) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  overrides: Partial<ServiceLevelObjective> = {},
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.name = "Checkout availability";
  slo.targetPercentage = 99.9;
  slo.currentSliPercentage = 99.95;
  slo.errorBudgetRemainingPercentage = 42.5;
  slo.errorBudgetRemainingSeconds = 3600;
  slo.currentBurnRate = 1.25;
  slo.sloStatus = SloStatus.Healthy;
  return Object.assign(slo, overrides);
};

type BuildPropsFunction = (
  overrides?: Partial<DashboardBaseComponentProps>,
) => DashboardBaseComponentProps;

const buildBaseProps: BuildPropsFunction = (
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps => {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "slo-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  } as unknown as DashboardBaseComponentProps;
};

type RenderWidgetFunction = (
  args: DashboardSloComponent["arguments"],
  propOverrides?: Partial<DashboardBaseComponentProps>,
) => RenderResult;

const renderWidget: RenderWidgetFunction = (
  args: DashboardSloComponent["arguments"],
  propOverrides: Partial<DashboardBaseComponentProps> = {},
): RenderResult => {
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
    arguments: args,
  } as unknown as DashboardSloComponent;

  return render(
    <DashboardSloComponentElement
      {...buildBaseProps(propOverrides)}
      component={component}
    />,
  );
};

/*
 * Settle in two stages.
 *
 * First the chart FRAME, which appears as soon as the widget's fetch resolves
 * and it switches to its Chart branch. Under the bug the frame — surface,
 * axes, grid, tooltip — rendered perfectly and only the series was missing,
 * so reaching this point proves the failure below is about the LINE and not
 * about a request that never came back.
 *
 * Then the series itself, on a short leash: the chart fills its rows in an
 * effect one tick after mounting, so it is never there on the first paint,
 * and a regression should fail in a second rather than sitting out the
 * default five.
 */
const LINE_TIMEOUT_IN_MS: number = 1500;

type FindLinePathsFunction = (
  container: HTMLElement,
) => Promise<Array<Element>>;

const findLinePaths: FindLinePathsFunction = async (
  container: HTMLElement,
): Promise<Array<Element>> => {
  await waitFor((): void => {
    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
  });

  await waitFor(
    (): void => {
      expect(container.querySelector(LINE_SELECTOR)).not.toBeNull();
    },
    { timeout: LINE_TIMEOUT_IN_MS },
  );

  return Array.from(container.querySelectorAll(LINE_SELECTOR));
};

/*
 * recharts emits the curve more than once per series (the drawn stroke plus
 * its hit-target twin), so assert on the GEOMETRY they all share rather than
 * on how many nodes carry it.
 */
type ExpectPlottedFunction = (paths: Array<Element>) => string;

const expectPlotted: ExpectPlottedFunction = (
  paths: Array<Element>,
): string => {
  expect(paths.length).toBeGreaterThan(0);

  const geometries: Array<string> = paths.map((path: Element): string => {
    return path.getAttribute("d") || "";
  });

  for (const geometry of geometries) {
    /*
     * The reported bug produced a chart frame with NO curve at all; a curve
     * present but empty (or full of NaN) would be the same blank widget, so
     * pin the path data itself.
     */
    expect(geometry.length).toBeGreaterThan(0);
    expect(geometry.startsWith("M")).toBe(true);
    expect(geometry).not.toContain("NaN");
  }

  // Every copy is the same series, so they must agree.
  expect(new Set(geometries).size).toBe(1);

  return geometries[0]!;
};

beforeEach((): void => {
  jest.clearAllMocks();
  publicResponse = { data: buildHistory() };
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getItemMock.mockResolvedValue(buildSlo());
  getListMock.mockResolvedValue({
    data: [buildSlo()],
    count: 1,
    skip: 0,
    limit: 1,
  });
  aggregateMock.mockResolvedValue({
    data: buildHistory(),
  } as unknown as AggregatedResult);
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("SLO chart widget on a public dashboard", () => {
  beforeEach((): void => {
    setPublicDashboardContext(PUBLIC_DASHBOARD_CONTEXT);
    // A public dashboard has no session, so no current project.
    getCurrentProjectIdMock.mockReturnValue(null);
  });

  test("plots a line an anonymous viewer can actually see", async () => {
    const { container }: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
    });

    const geometry: string = expectPlotted(await findLinePaths(container));

    /*
     * A drawn line visits every history row, so it carries one curve command
     * per plotted point rather than a single degenerate move-to.
     */
    expect(geometry.split("C").length).toBeGreaterThan(1);
  });

  test.each([
    [SloWidgetMetric.Sli],
    [SloWidgetMetric.ErrorBudgetRemaining],
    [SloWidgetMetric.BurnRate],
  ])("plots %s", async (sloMetric: SloWidgetMetric) => {
    publicResponse = {
      data: buildHistory({
        valueAt: (index: number): number => {
          return sloMetric === SloWidgetMetric.BurnRate
            ? 1 + index * 0.1
            : 99 - index * 0.1;
        },
      }),
    };

    const { container }: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: sloMetric,
      displayType: SloWidgetDisplayType.Chart,
    });

    expectPlotted(await findLinePaths(container));
  });

  test("draws the SLO's target as a reference line on the SLI chart", async () => {
    const { container }: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
    });

    await findLinePaths(container);

    expect(
      container.querySelectorAll("line.recharts-reference-line-line").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Target 99.9%")).toBeInTheDocument();
  });

  test("plots decimal strings, which is how ClickHouse returns the value", async () => {
    publicResponse = {
      data: buildHistory({
        valueAt: (index: number): string => {
          return `${99.9 - index * 0.05}`;
        },
      }),
    };

    const { container }: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Chart,
    });

    expectPlotted(await findLinePaths(container));
  });

  test("shows the empty-history state instead of a blank chart frame", async () => {
    publicResponse = { data: [] };

    const { container }: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Chart,
    });

    expect(
      await screen.findByText(/No history for the selected/i),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(LINE_SELECTOR).length).toBe(0);
  });

  test("keeps the tile display working alongside the chart fix", async () => {
    const { container }: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Tile,
    });

    expect(await screen.findByText("99.95%")).toBeInTheDocument();
    expect(screen.getByText("target 99.9%")).toBeInTheDocument();
    // A Tile never asks for history, so it never draws a series.
    expect(container.querySelectorAll(LINE_SELECTOR).length).toBe(0);
  });

  test("still plots when the widget tile is small enough to clamp its height", async () => {
    const { container }: RenderResult = renderWidget(
      {
        serviceLevelObjectiveId: SLO_ID.toString(),
        displayType: SloWidgetDisplayType.Chart,
      },
      { dashboardComponentHeightInPx: 100, dashboardComponentWidthInPx: 140 },
    );

    expectPlotted(await findLinePaths(container));
  });
});

describe("SLO chart widget on an authenticated dashboard", () => {
  test("plots a line through the private analytics route too", async () => {
    const { container }: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
    });

    expectPlotted(await findLinePaths(container));

    expect(aggregateMock).toHaveBeenCalledTimes(1);
  });

  test("renders the same geometry as the public dashboard for the same series", async () => {
    const authenticated: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
    });

    const authenticatedGeometry: string = expectPlotted(
      await findLinePaths(authenticated.container),
    );

    cleanup();

    setPublicDashboardContext(PUBLIC_DASHBOARD_CONTEXT);
    getCurrentProjectIdMock.mockReturnValue(null);

    const anonymous: RenderResult = renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
    });

    const anonymousGeometry: string = expectPlotted(
      await findLinePaths(anonymous.container),
    );

    /*
     * Same SLO, same window, same rows — the two surfaces differ only in
     * which endpoint served them, so the drawn line must be identical.
     */
    expect(anonymousGeometry).toBe(authenticatedGeometry);
  });
});
