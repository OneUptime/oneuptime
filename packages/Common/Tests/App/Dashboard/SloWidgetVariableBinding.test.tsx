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
 * The SLO widget following a toolbar variable, through its REAL renderer.
 *
 * This is what lets one toolbar pick drive every SLO tile and history chart on
 * a dashboard. Asserted against the REQUESTS the widget issues as much as the
 * text it renders, because the requests are where the rules live: no request
 * without a single pick, an exact-name lookup among active SLOs, an honest
 * refusal to guess between two SLOs sharing a name, the viewer's selection
 * sent to the public endpoints (which cannot otherwise know it), and a pinned
 * SLO that no variable can override.
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

// recharts draws nothing in jsdom; the stub records what the widget hands down.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: {
      data: Array<{ data: Array<unknown> }>;
    }): React.ReactElement => {
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
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  getSloWidgetAmbiguousText,
  getSloWidgetNotFoundText,
  SLO_WIDGET_MULTIPLE_SELECTION_TEXT,
  SLO_WIDGET_NO_SELECTION_TEXT,
  SLO_WIDGET_VARIABLE_MISSING_TEXT,
} from "../../../Utils/Dashboard/SloWidgetSource";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DASHBOARD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PINNED_SLO_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MATCHED_SLO_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const PICKED_SLO: string = "Checkout API";

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

const SLO_VARIABLE: DashboardVariable = {
  id: "slo-variable",
  name: "slo",
  label: "SLO",
  type: DashboardVariableType.TelemetryAttribute,
  attributeKey: "sloName",
  isMultiSelect: false,
};

interface PublicRequest {
  route: string;
  body: JSONObject;
}

let publicRequests: Array<PublicRequest> = [];

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
      data: {
        data: [{ timestamp: "2026-08-10T00:00:00.000Z", value: 99.9 }],
      },
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
  slo._id = MATCHED_SLO_ID.toString();
  slo.name = PICKED_SLO;
  slo.targetPercentage = 99.9;
  slo.currentSliPercentage = 99.95;
  slo.errorBudgetRemainingPercentage = 42.5;
  slo.errorBudgetRemainingSeconds = 3600;
  slo.currentBurnRate = 1.25;
  slo.sloStatus = SloStatus.Healthy;
  return Object.assign(slo, overrides);
};

type ListOfFunction = (slos: Array<ServiceLevelObjective>) => {
  data: Array<ServiceLevelObjective>;
  count: number;
};

const listOf: ListOfFunction = (
  slos: Array<ServiceLevelObjective>,
): { data: Array<ServiceLevelObjective>; count: number } => {
  return { data: slos, count: slos.length };
};

type BuildElementFunction = (data: {
  args: DashboardSloComponent["arguments"];
  variables?: Array<DashboardVariable> | undefined;
}) => React.ReactElement;

const buildElement: BuildElementFunction = (data: {
  args: DashboardSloComponent["arguments"];
  variables?: Array<DashboardVariable> | undefined;
}): React.ReactElement => {
  const component: DashboardSloComponent = {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.Slo,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 4,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 2,
    minHeightInDashboardUnits: 2,
    arguments: data.args,
  };

  const props: DashboardBaseComponentProps = {
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
    dashboardComponentHeightInPx: 360,
    dashboardComponentWidthInPx: 400,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: data.variables,
  };

  return <DashboardSloComponentElement {...props} component={component} />;
};

const followingArgs: (
  overrides?: Partial<DashboardSloComponent["arguments"]>,
) => DashboardSloComponent["arguments"] = (
  overrides: Partial<DashboardSloComponent["arguments"]> = {},
): DashboardSloComponent["arguments"] => {
  return {
    serviceLevelObjectiveVariableId: SLO_VARIABLE.id,
    sloMetric: SloWidgetMetric.Sli,
    displayType: SloWidgetDisplayType.Tile,
    widgetTitle: "SLI",
    ...overrides,
  };
};

type CountRequestsFunction = () => number;

const countRequests: CountRequestsFunction = (): number => {
  return (
    getItemMock.mock.calls.length +
    getListMock.mock.calls.length +
    aggregateMock.mock.calls.length +
    publicRequests.length
  );
};

beforeEach((): void => {
  jest.clearAllMocks();
  publicRequests = [];
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getItemMock.mockResolvedValue(buildSlo({ name: "Pinned SLO" }));
  getListMock.mockResolvedValue(listOf([buildSlo()]));
  aggregateMock.mockResolvedValue({
    data: [
      { timestamp: START_DATE, value: 99.9 },
      { timestamp: END_DATE, value: 99.8 },
    ],
  } as unknown as AggregatedResult);
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("SLO widget following a toolbar variable — waiting for a pick", () => {
  test("asks for a toolbar pick while the variable is on All, and reads nothing", async () => {
    render(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: "" }],
      }),
    );

    expect(
      await screen.findByText(SLO_WIDGET_NO_SELECTION_TEXT),
    ).toBeInTheDocument();
    // The title tells six identical placeholders apart.
    expect(screen.getByText("SLI")).toBeInTheDocument();
    // Never the edit-mode setup prompt, which does nothing in view mode.
    expect(
      screen.queryByText("Click to select an SLO"),
    ).not.toBeInTheDocument();
    expect(countRequests()).toBe(0);
  });

  test("asks for a single pick when a multi-select holds several", async () => {
    render(
      buildElement({
        args: followingArgs(),
        variables: [
          {
            ...SLO_VARIABLE,
            isMultiSelect: true,
            selectedValues: [PICKED_SLO, "Search API"],
          },
        ],
      }),
    );

    expect(
      await screen.findByText(SLO_WIDGET_MULTIPLE_SELECTION_TEXT),
    ).toBeInTheDocument();
    expect(countRequests()).toBe(0);
  });

  test("says the binding is broken when the variable is gone", async () => {
    render(buildElement({ args: followingArgs(), variables: [] }));

    expect(
      await screen.findByText(SLO_WIDGET_VARIABLE_MISSING_TEXT),
    ).toBeInTheDocument();
    expect(countRequests()).toBe(0);
  });

  test("keeps the edit-mode setup prompt for a widget that follows nothing", async () => {
    render(
      buildElement({
        args: { displayType: SloWidgetDisplayType.Tile },
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(
      await screen.findByText("Click to select an SLO"),
    ).toBeInTheDocument();
    expect(countRequests()).toBe(0);
  });
});

describe("SLO widget following a toolbar variable — on an authenticated dashboard", () => {
  test("looks the picked SLO up by exact name among active SLOs, reading at most two rows", async () => {
    render(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(await screen.findByText("99.95%")).toBeInTheDocument();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(getListMock).toHaveBeenCalledTimes(1);

    const listArgs: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;

    expect(listArgs["query"]).toEqual({
      name: PICKED_SLO,
      isArchived: false,
      projectId: PROJECT_ID,
    });
    expect(listArgs["limit"]).toBe(2);
    expect(listArgs["sort"]).toEqual({ name: SortOrder.Ascending });
    expect(listArgs["requestOptions"]).toBeUndefined();
    // The id is what the authenticated history aggregation is keyed by.
    expect((listArgs["select"] as JSONObject)["_id"]).toBe(true);
  });

  test("leads the title with the picked SLO's name", async () => {
    render(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(await screen.findByText(`${PICKED_SLO} · SLI`)).toBeInTheDocument();
  });

  test("charts the matched SLO's history by its id", async () => {
    render(
      buildElement({
        args: followingArgs({
          displayType: SloWidgetDisplayType.Chart,
          widgetTitle: "SLI History",
        }),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(await screen.findByTestId("line-chart")).toHaveTextContent(
      "points:2",
    );

    const aggregateBy: JSONObject = (
      aggregateMock.mock.calls[0]![0] as JSONObject
    )["aggregateBy"] as JSONObject;
    const query: JSONObject = aggregateBy["query"] as JSONObject;

    expect((query["sloId"] as ObjectID).toString()).toBe(
      MATCHED_SLO_ID.toString(),
    );
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["metricName"]).toBe("sli.percent");
  });

  test("says no active SLO carries the name, and charts nothing", async () => {
    getListMock.mockResolvedValue(listOf([]));

    render(
      buildElement({
        args: followingArgs({ displayType: SloWidgetDisplayType.Chart }),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(
      await screen.findByText(getSloWidgetNotFoundText(PICKED_SLO)),
    ).toBeInTheDocument();
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  /*
   * Two active SLOs sharing the picked name: the widget must not report
   * whichever sorted first under a toolbar that cannot tell them apart.
   */
  test("refuses to guess between two SLOs sharing the name, and charts neither", async () => {
    getListMock.mockResolvedValue(
      listOf([buildSlo(), buildSlo({ _id: ObjectID.generate().toString() })]),
    );

    render(
      buildElement({
        args: followingArgs({ displayType: SloWidgetDisplayType.Chart }),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(
      await screen.findByText(getSloWidgetAmbiguousText(PICKED_SLO)),
    ).toBeInTheDocument();
    expect(screen.queryByText("99.95%")).not.toBeInTheDocument();
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("a pinned SLO ignores the toolbar entirely", async () => {
    render(
      buildElement({
        args: followingArgs({
          serviceLevelObjectiveId: PINNED_SLO_ID.toString(),
        }),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(await screen.findByText("99.95%")).toBeInTheDocument();

    expect(getListMock).not.toHaveBeenCalled();
    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(
      (
        (getItemMock.mock.calls[0]![0] as JSONObject)["id"] as ObjectID
      ).toString(),
    ).toBe(PINNED_SLO_ID.toString());
    // A pinned widget's author title stands alone.
    expect(screen.getByText("SLI")).toBeInTheDocument();
  });

  test("refetches when the pick moves, and not when an unrelated variable does", async () => {
    const result: RenderResult = render(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    await screen.findByText("99.95%");
    expect(getListMock).toHaveBeenCalledTimes(1);

    const team: DashboardVariable = {
      id: "team",
      name: "team",
      type: DashboardVariableType.TelemetryAttribute,
      attributeKey: "oneuptime.label.team",
      isMultiSelect: false,
      selectedValue: "payments",
    };

    result.rerender(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }, team],
      }),
    );

    // Give an unwanted refetch the chance to happen before asserting it did not.
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 50);
    });
    expect(getListMock).toHaveBeenCalledTimes(1);

    getListMock.mockResolvedValue(
      listOf([buildSlo({ name: "Search API", currentSliPercentage: 98.5 })]),
    );

    result.rerender(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: "Search API" }, team],
      }),
    );

    expect(await screen.findByText("98.5%")).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(
      ((getListMock.mock.calls[1]![0] as JSONObject)["query"] as JSONObject)[
        "name"
      ],
    ).toBe("Search API");
  });

  test("returns to the toolbar prompt when the pick is cleared", async () => {
    const result: RenderResult = render(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    await screen.findByText("99.95%");

    result.rerender(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: "" }],
      }),
    );

    expect(
      await screen.findByText(SLO_WIDGET_NO_SELECTION_TEXT),
    ).toBeInTheDocument();
    await waitFor((): void => {
      expect(screen.queryByText("99.95%")).not.toBeInTheDocument();
    });
  });
});

describe("SLO widget following a toolbar variable — on a public dashboard", () => {
  beforeEach((): void => {
    setPublicDashboardContext(PUBLIC_DASHBOARD_CONTEXT);
    getCurrentProjectIdMock.mockReturnValue(null);
  });

  /*
   * The public endpoint resolves the SLO from its own stored copy of the bound
   * variable AND the viewer's selection — so the selection must travel with
   * the request, alongside the componentId that names the stored widget.
   */
  test("sends the viewer's selections to the dashboard-scoped SLO endpoint", async () => {
    render(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(await screen.findByText("99.95%")).toBeInTheDocument();

    const requestOptions: JSONObject = (
      getListMock.mock.calls[0]![0] as JSONObject
    )["requestOptions"] as JSONObject;

    expect(
      (
        requestOptions["overrideRequestUrl"] as { toString: () => string }
      ).toString(),
    ).toBe(
      `http://localhost/public-dashboard-api/resource-list/${DASHBOARD_ID.toString()}/slo`,
    );
    expect(requestOptions["additionalRequestBody"]).toEqual({
      componentId: COMPONENT_ID.toString(),
      variables: [
        { id: SLO_VARIABLE.id, selectedValue: PICKED_SLO, selectedValues: [] },
      ],
    });
  });

  test("sends the selections with the history aggregation too", async () => {
    render(
      buildElement({
        args: followingArgs({ displayType: SloWidgetDisplayType.Chart }),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(await screen.findByTestId("line-chart")).toBeInTheDocument();
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(publicRequests).toHaveLength(1);

    const request: PublicRequest = publicRequests[0] as PublicRequest;

    expect(request.route).toBe(
      `/slo-history-aggregate/${DASHBOARD_ID.toString()}`,
    );
    expect(request.body["componentId"]).toBe(COMPONENT_ID.toString());
    expect(request.body["variables"]).toEqual([
      { id: SLO_VARIABLE.id, selectedValue: PICKED_SLO, selectedValues: [] },
    ]);

    const aggregateBy: JSONObject = JSONFunctions.deserialize(
      request.body["aggregateBy"] as JSONObject,
    ) as JSONObject;

    expect(
      new Date(aggregateBy["startTimestamp"] as string).toISOString(),
    ).toBe(START_DATE.toISOString());
  });

  test("keeps a pinned chart's history request free of selections", async () => {
    render(
      buildElement({
        args: followingArgs({
          serviceLevelObjectiveId: PINNED_SLO_ID.toString(),
          displayType: SloWidgetDisplayType.Chart,
        }),
        variables: [{ ...SLO_VARIABLE, selectedValue: PICKED_SLO }],
      }),
    );

    expect(await screen.findByTestId("line-chart")).toBeInTheDocument();
    expect(publicRequests).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(
        (publicRequests[0] as PublicRequest).body,
        "variables",
      ),
    ).toBe(false);
  });

  test("asks for a toolbar pick without calling the public endpoints", async () => {
    render(
      buildElement({
        args: followingArgs(),
        variables: [{ ...SLO_VARIABLE }],
      }),
    );

    expect(
      await screen.findByText(SLO_WIDGET_NO_SELECTION_TEXT),
    ).toBeInTheDocument();
    expect(countRequests()).toBe(0);
  });
});
