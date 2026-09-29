import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { RenderResult, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The SLO widget is the first widget to read a SINGLE model row on a public
 * dashboard, and it reads two different things through two different public
 * endpoints. Both halves of that are asserted here against the REQUESTS the
 * widget issues, because the request is where the security boundary lives:
 *
 *  - an anonymous viewer must get the widget's data (it used to be refused
 *    outright with "SLO widgets are not available on public dashboards"), and
 *  - it must arrive through the dashboard-scoped endpoints, which resolve the
 *    SLO from the stored widget — never through the private CRUD routes,
 *    whose 401 sends the viewer to /accounts/login.
 *
 * The authenticated path is asserted alongside it so the two cannot drift.
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
 * recharts measures a 0x0 parent in jsdom and renders nothing, so the real
 * chart would test neither the series nor the axes. What matters here is what
 * the widget hands down.
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
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";

interface LineChartStubProps {
  data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
}

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
 * resolve against the wall clock and make the window assertions untestable.
 * Six hours buckets at five minutes, which is what the assertions expect.
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

/** Every postJSON call the public dashboard client received. */
interface PublicRequest {
  route: string;
  body: JSONObject;
}

let publicRequests: Array<PublicRequest> = [];
let publicResponse: JSONObject = { data: [] };

const PUBLIC_DASHBOARD_CONTEXT: PublicDashboardContext = {
  dashboardId: DASHBOARD_ID,
  apiUrl: {
    toString: (): string => {
      return "http://localhost/public-dashboard-api";
    },
  },
  postJSON: (route: string, body: JSONObject) => {
    publicRequests.push({ route, body });
    return Promise.resolve({
      data: publicResponse,
    } as unknown as HTTPResponse<JSONObject>);
  },
} as unknown as PublicDashboardContext;

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
  };
};

type RenderWidgetFunction = (
  args: DashboardSloComponent["arguments"],
) => RenderResult;

const renderWidget: RenderWidgetFunction = (
  args: DashboardSloComponent["arguments"],
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
      {...buildBaseProps()}
      component={component}
    />,
  );
};

beforeEach((): void => {
  jest.clearAllMocks();
  publicRequests = [];
  publicResponse = { data: [] };
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getItemMock.mockResolvedValue(buildSlo());
  getListMock.mockResolvedValue({
    data: [buildSlo()],
    count: 1,
    skip: 0,
    limit: 1,
  });
  aggregateMock.mockResolvedValue({ data: [] } as AggregatedResult);
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("SLO widget on a public dashboard", () => {
  beforeEach((): void => {
    setPublicDashboardContext(PUBLIC_DASHBOARD_CONTEXT);
    /*
     * A public dashboard has no session and therefore no current project.
     * This is the exact condition the widget used to refuse on.
     */
    getCurrentProjectIdMock.mockReturnValue(null);
  });

  test("renders the SLO instead of refusing anonymous viewers", async () => {
    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Tile,
    });

    expect(await screen.findByText("99.95%")).toBeInTheDocument();
    expect(screen.getByText("target 99.9%")).toBeInTheDocument();
    expect(
      screen.queryByText(/not available on public dashboards/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/no project selected/i)).not.toBeInTheDocument();
  });

  test("reads the SLO through the dashboard-scoped resource endpoint", async () => {
    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Tile,
    });

    await screen.findByText("99.95%");

    // The private single-item CRUD route would 401 and bounce to login.
    expect(getItemMock).not.toHaveBeenCalled();
    expect(getListMock).toHaveBeenCalledTimes(1);

    const listArgs: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;
    const requestOptions: JSONObject = listArgs["requestOptions"] as JSONObject;

    expect(
      (
        requestOptions["overrideRequestUrl"] as { toString: () => string }
      ).toString(),
    ).toBe(
      `http://localhost/public-dashboard-api/resource-list/${DASHBOARD_ID.toString()}/slo`,
    );
    /*
     * componentId is what lets the server resolve WHICH stored widget — and
     * therefore which SLO — this request is allowed to read.
     */
    expect(
      (requestOptions["additionalRequestBody"] as JSONObject)["componentId"],
    ).toBe(COMPONENT_ID.toString());
    expect(listArgs["limit"]).toBe(1);
  });

  test("reads chart history through the public SLO history endpoint", async () => {
    publicResponse = {
      data: [
        { timestamp: "2026-08-10T00:00:00.000Z", value: "99.9" },
        { timestamp: "2026-08-10T00:05:00.000Z", value: 99.8 },
      ],
    };

    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.BurnRate,
      displayType: SloWidgetDisplayType.Chart,
    });

    expect(await screen.findByTestId("line-chart")).toHaveTextContent(
      "points:2",
    );

    // The private analytics /aggregate route would 401 and bounce to login.
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(publicRequests.length).toBe(1);

    const request: PublicRequest = publicRequests[0]!;
    expect(request.route).toBe(
      `/slo-history-aggregate/${DASHBOARD_ID.toString()}`,
    );
    expect(request.body["componentId"]).toBe(COMPONENT_ID.toString());

    /*
     * The window is the ONE thing the public endpoint reads out of
     * aggregateBy — it rebuilds everything else from the stored widget — and
     * it hard-fails without it. So it has to survive the wire serializer,
     * which is what the server deserializes on the other side.
     */
    const aggregateBy: JSONObject = JSONFunctions.deserialize(
      request.body["aggregateBy"] as JSONObject,
    ) as JSONObject;

    expect(
      new Date(aggregateBy["startTimestamp"] as string).toISOString(),
    ).toBe(START_DATE.toISOString());
    expect(new Date(aggregateBy["endTimestamp"] as string).toISOString()).toBe(
      END_DATE.toISOString(),
    );

    /*
     * The rest is sent but discarded server-side. Asserted anyway so the two
     * paths keep sending the same shape — the authenticated route DOES read
     * these.
     */
    expect(aggregateBy["aggregateColumnName"]).toBe("value");
    expect(aggregateBy["aggregationTimestampColumnName"]).toBe("bucketStart");
    expect(aggregateBy["aggregationType"]).toBe(AggregationType.Avg);
    expect(aggregateBy["aggregationInterval"]).toBe(
      AggregationInterval.FiveMinutes,
    );
  });

  test("coerces decimal strings and drops unusable history rows", async () => {
    publicResponse = {
      data: [
        { timestamp: "2026-08-10T00:00:00.000Z", value: "99.9" },
        { timestamp: null, value: 50 },
        { timestamp: "2026-08-10T00:10:00.000Z", value: "not-a-number" },
        { timestamp: "2026-08-10T00:15:00.000Z", value: 98.5 },
      ],
    };

    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Chart,
    });

    expect(await screen.findByTestId("line-chart")).toHaveTextContent(
      "points:2",
    );
  });

  test("shows the empty-history state rather than an error when nothing is stored", async () => {
    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Chart,
    });

    expect(
      await screen.findByText(/No history for the selected/i),
    ).toBeInTheDocument();
  });

  test("does not fetch anything for an unconfigured widget", async () => {
    renderWidget({ displayType: SloWidgetDisplayType.Tile });

    expect(
      await screen.findByText("Click to select an SLO"),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
    expect(publicRequests.length).toBe(0);
  });

  test("says the SLO is gone when the endpoint returns no row", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 1 });

    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Tile,
    });

    expect(
      await screen.findByText("This SLO no longer exists."),
    ).toBeInTheDocument();
  });
});

describe("SLO widget on an authenticated dashboard", () => {
  test("keeps reading the SLO through the private CRUD route", async () => {
    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
      displayType: SloWidgetDisplayType.Tile,
    });

    expect(await screen.findByText("42.5%")).toBeInTheDocument();
    expect(screen.getByText("60 min remaining")).toBeInTheDocument();

    expect(getListMock).not.toHaveBeenCalled();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    const itemArgs: JSONObject = getItemMock.mock.calls[0]![0] as JSONObject;
    expect((itemArgs["id"] as ObjectID).toString()).toBe(SLO_ID.toString());
    expect(itemArgs["requestOptions"]).toBeUndefined();
    // Only the seven display fields, on the private route as on the public one.
    expect(itemArgs["select"]).toEqual({
      name: true,
      targetPercentage: true,
      currentSliPercentage: true,
      errorBudgetRemainingPercentage: true,
      errorBudgetRemainingSeconds: true,
      currentBurnRate: true,
      sloStatus: true,
    });
  });

  test("keeps aggregating history through the private analytics route", async () => {
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: START_DATE, value: 99.9 }],
    } as AggregatedResult);

    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      sloMetric: SloWidgetMetric.Sli,
      displayType: SloWidgetDisplayType.Chart,
    });

    expect(await screen.findByTestId("line-chart")).toHaveTextContent(
      "points:1",
    );
    expect(publicRequests.length).toBe(0);
    expect(aggregateMock).toHaveBeenCalledTimes(1);

    const aggregateArgs: JSONObject = aggregateMock.mock
      .calls[0]![0] as JSONObject;
    const aggregateBy: JSONObject = aggregateArgs["aggregateBy"] as JSONObject;
    const query: JSONObject = aggregateBy["query"] as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect((query["sloId"] as ObjectID).toString()).toBe(SLO_ID.toString());
    expect(query["metricName"]).toBe("sli.percent");
    expect(aggregateBy["sort"]).toEqual({
      bucketStart: SortOrder.Ascending,
    });

    // Same window as the public path — the two must not drift.
    expect((aggregateBy["startTimestamp"] as Date).toISOString()).toBe(
      START_DATE.toISOString(),
    );
    expect((aggregateBy["endTimestamp"] as Date).toISOString()).toBe(
      END_DATE.toISOString(),
    );
    const bucketStart: InBetween<Date> = query[
      "bucketStart"
    ] as unknown as InBetween<Date>;
    expect(bucketStart).toBeInstanceOf(InBetween);
    expect(bucketStart.startValue.toISOString()).toBe(START_DATE.toISOString());
    expect(bucketStart.endValue.toISOString()).toBe(END_DATE.toISOString());
  });

  test("still refuses to guess a project when there is no session project", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    renderWidget({
      serviceLevelObjectiveId: SLO_ID.toString(),
      displayType: SloWidgetDisplayType.Tile,
    });

    expect(await screen.findByText("No project selected.")).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(getListMock).not.toHaveBeenCalled();
  });
});
