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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The SLO List widget through its REAL renderer: what it asks the server for
 * (the query, order, select and route — which is where archived exclusion,
 * toolbar scoping and public-dashboard safety live) and what a reader sees
 * (status, SLI against target, the budget bar and the burn rate, never
 * "null%").
 */

const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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

/*
 * AppLink is a react-router Link; the stub marks where a link WOULD render so
 * the public-dashboard test can prove there is none.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return React.createElement(
          "a",
          { "data-testid": "slo-link" },
          props.children,
        );
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
      default: (props: { tiles: Array<{ status: string }> }) => {
        return React.createElement(
          "div",
          { "data-testid": "honeycomb" },
          props.tiles
            .map((tile: { status: string }) => {
              return tile.status;
            })
            .join(","),
        );
      },
    };
  },
);

import DashboardSloListComponentElement, {
  SLO_LIST_WIDGET_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloListComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DashboardSloListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardSloListComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { SLO_LIST_DEFAULT_MAX_ROWS } from "../../../Utils/Slo/SloListWidgetFormat";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DASHBOARD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

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

const PUBLIC_DASHBOARD_CONTEXT: PublicDashboardContext = {
  dashboardId: DASHBOARD_ID,
  apiUrl: {
    toString: (): string => {
      return "http://localhost/public-dashboard-api";
    },
  },
  postJSON: () => {
    return Promise.resolve({ data: {} } as unknown as HTTPResponse<JSONObject>);
  },
} as unknown as PublicDashboardContext;

type BuildSloFunction = (
  overrides: Partial<ServiceLevelObjective>,
) => ServiceLevelObjective;

const buildSlo: BuildSloFunction = (
  overrides: Partial<ServiceLevelObjective>,
): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = ObjectID.generate().toString();
  slo.name = "Checkout availability";
  slo.targetPercentage = 99.9;
  slo.currentSliPercentage = 99.95;
  slo.errorBudgetRemainingPercentage = 42.5;
  slo.errorBudgetRemainingSeconds = 3600;
  slo.currentBurnRate = 0.5;
  slo.sloStatus = SloStatus.Healthy;
  return Object.assign(slo, overrides);
};

// Rows in the order the server returns them: least budget first.
const FLEET: Array<ServiceLevelObjective> = [
  buildSlo({
    name: "Payments API",
    currentSliPercentage: 99.1,
    errorBudgetRemainingPercentage: -12.46,
    errorBudgetRemainingSeconds: -600,
    currentBurnRate: 20,
    sloStatus: SloStatus.BudgetExhausted,
  }),
  buildSlo({
    name: "Search API",
    errorBudgetRemainingPercentage: 8,
    currentBurnRate: 3,
    sloStatus: SloStatus.AtRisk,
  }),
  buildSlo({ name: "Checkout availability" }),
  Object.assign(new ServiceLevelObjective(), {
    _id: ObjectID.generate().toString(),
    name: "New objective",
    targetPercentage: 99.5,
    currentSliPercentage: null,
    errorBudgetRemainingPercentage: null,
    errorBudgetRemainingSeconds: null,
    currentBurnRate: null,
    sloStatus: null,
  }) as unknown as ServiceLevelObjective,
];

type RenderListFunction = (data?: {
  args?: DashboardSloListComponent["arguments"] | undefined;
  variables?: Array<DashboardVariable> | undefined;
}) => RenderResult;

const renderList: RenderListFunction = (
  data: {
    args?: DashboardSloListComponent["arguments"] | undefined;
    variables?: Array<DashboardVariable> | undefined;
  } = {},
): RenderResult => {
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
    arguments: data.args || {
      title: "Service Level Objectives",
      maxRows: SLO_LIST_DEFAULT_MAX_ROWS,
    },
  };

  const props: DashboardBaseComponentProps = {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "slo-list",
    onComponentUpdate: (): void => {
      // The list never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 450,
    dashboardComponentWidthInPx: 1200,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: DASHBOARD_RANGE,
    metricTypes: [],
    refreshTick: 0,
    variables: data.variables,
  };

  return render(
    <DashboardSloListComponentElement {...props} component={component} />,
  );
};

type GetListArgsFunction = () => JSONObject;

const getListArgs: GetListArgsFunction = (): JSONObject => {
  expect(getListMock).toHaveBeenCalledTimes(1);
  return getListMock.mock.calls[0]![0] as JSONObject;
};

const SLO_VARIABLE: DashboardVariable = {
  id: "slo-variable",
  name: "slo",
  label: "SLO",
  type: DashboardVariableType.TelemetryAttribute,
  attributeKey: "sloName",
  isMultiSelect: false,
};

beforeEach((): void => {
  jest.clearAllMocks();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getListMock.mockResolvedValue({
    data: FLEET,
    count: FLEET.length,
    skip: 0,
    limit: SLO_LIST_DEFAULT_MAX_ROWS,
  });
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("SLO List widget — what it asks for", () => {
  test("reads active SLOs in the current project, least budget first, capped by maxRows", async () => {
    renderList();

    await screen.findByText("Payments API");

    const args: JSONObject = getListArgs();

    expect(args["query"]).toEqual({ projectId: PROJECT_ID, isArchived: false });
    expect(args["sort"]).toEqual({
      errorBudgetRemainingPercentage: SortOrder.Ascending,
      name: SortOrder.Ascending,
    });
    expect(Object.keys(args["sort"] as JSONObject)).toEqual([
      "errorBudgetRemainingPercentage",
      "name",
    ]);
    expect(args["limit"]).toBe(SLO_LIST_DEFAULT_MAX_ROWS);
    expect(args["requestOptions"]).toBeUndefined();
  });

  test("selects exactly the fields a row renders", async () => {
    renderList();

    await screen.findByText("Payments API");

    expect(getListArgs()["select"]).toEqual(SLO_LIST_WIDGET_SELECT);
    expect(SLO_LIST_WIDGET_SELECT).toEqual({
      _id: true,
      name: true,
      targetPercentage: true,
      currentSliPercentage: true,
      errorBudgetRemainingPercentage: true,
      errorBudgetRemainingSeconds: true,
      currentBurnRate: true,
      sloStatus: true,
    });
  });

  test("applies its stored status and label filters", async () => {
    const labelId: string = ObjectID.generate().toString();

    renderList({
      args: {
        maxRows: 10,
        sloStatuses: [SloStatus.AtRisk, SloStatus.BudgetExhausted],
        labelIds: [labelId],
      },
    });

    await screen.findByText("Payments API");

    const query: JSONObject = getListArgs()["query"] as JSONObject;

    expect(query["sloStatus"]).toBeInstanceOf(Includes);
    expect((query["sloStatus"] as Includes).values).toEqual([
      SloStatus.AtRisk,
      SloStatus.BudgetExhausted,
    ]);
    expect(query["labels"]).toBeInstanceOf(Includes);
    expect((query["labels"] as Includes).values).toEqual([labelId]);
    expect(getListArgs()["limit"]).toBe(10);
  });

  test("narrows to the SLO picked in a sloName toolbar variable", async () => {
    renderList({
      variables: [{ ...SLO_VARIABLE, selectedValue: "Search API" }],
    });

    await screen.findByText("Payments API");

    expect(getListArgs()["query"]).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
      name: "Search API",
    });
  });

  test("ignores a toolbar variable on a key it has no column for", async () => {
    renderList({
      variables: [
        {
          ...SLO_VARIABLE,
          id: "team",
          attributeKey: "oneuptime.label.team",
          selectedValue: "payments",
        },
      ],
    });

    await screen.findByText("Payments API");

    expect(getListArgs()["query"]).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
  });

  test("refuses to guess a project when the session has none", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    renderList();

    expect(await screen.findByText("No project selected.")).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("SLO List widget — what a reader sees", () => {
  test("renders each objective's status, SLI against target, budget and burn rate", async () => {
    renderList();

    const rows: Array<HTMLElement> =
      await screen.findAllByTestId("slo-list-row");

    expect(rows).toHaveLength(FLEET.length);

    const exhausted: HTMLElement = rows[0] as HTMLElement;

    expect(within(exhausted).getByText("Payments API")).toBeInTheDocument();
    expect(
      within(exhausted).getByText(SloStatus.BudgetExhausted),
    ).toBeInTheDocument();
    expect(within(exhausted).getByText("99.1%")).toBeInTheDocument();
    expect(within(exhausted).getByText("target 99.9%")).toBeInTheDocument();
    // Overspent is shown as the negative number it is, never clamped to 0%.
    expect(within(exhausted).getByText("-12.5%")).toBeInTheDocument();
    expect(
      within(exhausted).getByText("−10 min over budget"),
    ).toBeInTheDocument();
    expect(within(exhausted).getByText("20×")).toBeInTheDocument();
  });

  test("draws the budget bar clamped to its track while the number stays negative", async () => {
    renderList();

    const bars: Array<HTMLElement> = await screen.findAllByRole("progressbar");

    expect(bars[0]).toHaveAttribute("aria-valuenow", "0");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "8");
    expect(bars[2]).toHaveAttribute("aria-valuenow", "42.5");
    // Not evaluated: no value, and no fill.
    expect(bars[3]).not.toHaveAttribute("aria-valuenow");
    expect((bars[3] as HTMLElement).childElementCount).toBe(0);
  });

  test("marks a critical burn rate red and an elevated one amber", async () => {
    renderList();

    expect((await screen.findByText("20×")).className).toContain(
      "text-red-600",
    );
    expect(screen.getByText("3×").className).toContain("text-amber-700");
    expect(screen.getByText("0.5×").className).toContain("text-gray-700");
  });

  test("says an unevaluated SLO is not evaluated, and never prints null or NaN", async () => {
    const { container }: RenderResult = renderList();

    const rows: Array<HTMLElement> =
      await screen.findAllByTestId("slo-list-row");
    const unevaluated: HTMLElement = rows[3] as HTMLElement;

    expect(within(unevaluated).getByText("Not Evaluated")).toBeInTheDocument();
    expect(within(unevaluated).getAllByText("—").length).toBe(3);
    expect(container.textContent || "").not.toMatch(/null|NaN|undefined/);
  });

  test("summarises the statuses worst first", async () => {
    renderList();

    const summary: HTMLElement = await screen.findByTestId("slo-list-summary");

    expect(summary.textContent).toBe(
      "1Budget Exhausted1At Risk1Healthy1Not Evaluated",
    );
  });

  test("says when the cap cut the list off, and that the healthiest were dropped", async () => {
    renderList({ args: { maxRows: FLEET.length } });

    expect(
      await screen.findByText(
        `Showing the ${FLEET.length} with the least budget`,
      ),
    ).toBeInTheDocument();
  });

  test("does not claim a cap when every SLO fits", async () => {
    renderList();

    await screen.findByTestId("slo-list-summary");

    expect(screen.queryByText(/with the least budget/)).not.toBeInTheDocument();
  });

  test("links each objective to its SLO page in the app", async () => {
    renderList();

    await screen.findByText("Payments API");

    expect(screen.getAllByTestId("slo-link")).toHaveLength(FLEET.length);
  });

  test("shows the title and the row count", async () => {
    renderList();

    expect(
      await screen.findByText("Service Level Objectives"),
    ).toBeInTheDocument();
    expect(screen.getByText(`${FLEET.length} SLOs`)).toBeInTheDocument();
  });

  test("invites creating an SLO when the project has none", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 50 });

    renderList();

    expect(
      await screen.findByText("No SLOs yet — create one to see it here"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("slo-list-summary")).not.toBeInTheDocument();
  });

  test("says nothing matches when a filter or the toolbar narrowed it to nothing", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 50 });

    renderList({
      variables: [{ ...SLO_VARIABLE, selectedValue: "Gone API" }],
    });

    expect(
      await screen.findByText("No active SLOs match this selection"),
    ).toBeInTheDocument();
  });

  test("renders a status honeycomb in honeycomb view", async () => {
    renderList({ args: { viewMode: "honeycomb" } });

    expect(await screen.findByTestId("honeycomb")).toHaveTextContent(
      `${SloStatus.BudgetExhausted},${SloStatus.AtRisk},${SloStatus.Healthy},Not Evaluated`,
    );
    expect(screen.queryAllByTestId("slo-list-row")).toHaveLength(0);
  });

  test("shows the server's error instead of an empty list", async () => {
    getListMock.mockRejectedValue(new Error("Permission denied"));

    renderList();

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
  });
});

describe("SLO List widget — on a public dashboard", () => {
  beforeEach((): void => {
    setPublicDashboardContext(PUBLIC_DASHBOARD_CONTEXT);
    getCurrentProjectIdMock.mockReturnValue(null);
  });

  test("reads through the dashboard-scoped slo-list endpoint with the widget and the selections", async () => {
    renderList({
      variables: [{ ...SLO_VARIABLE, selectedValue: "Search API" }],
    });

    await screen.findByText("Payments API");

    const requestOptions: JSONObject = getListArgs()[
      "requestOptions"
    ] as JSONObject;

    expect(
      (
        requestOptions["overrideRequestUrl"] as { toString: () => string }
      ).toString(),
    ).toBe(
      `http://localhost/public-dashboard-api/resource-list/${DASHBOARD_ID.toString()}/slo-list`,
    );
    expect(requestOptions["additionalRequestBody"]).toEqual({
      componentId: COMPONENT_ID.toString(),
      variables: [
        {
          id: SLO_VARIABLE.id,
          selectedValue: "Search API",
          selectedValues: [],
        },
      ],
    });
    expect(screen.queryByText("No project selected.")).not.toBeInTheDocument();
  });

  // A link into the app would bounce an anonymous viewer to the login page.
  test("renders names as plain text, never as links into the app", async () => {
    renderList();

    await screen.findByText("Payments API");

    expect(screen.queryAllByTestId("slo-link")).toHaveLength(0);
  });

  test("refreshes when the toolbar selection changes", async () => {
    const result: RenderResult = renderList();

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(1);
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
      },
    };

    result.rerender(
      <DashboardSloListComponentElement
        componentId={COMPONENT_ID}
        isEditMode={false}
        isSelected={false}
        key="slo-list"
        onComponentUpdate={(): void => {
          // Unused.
        }}
        totalCurrentDashboardWidthInPx={1200}
        dashboardCanvasTopInPx={0}
        dashboardCanvasLeftInPx={0}
        dashboardCanvasWidthInPx={1200}
        dashboardCanvasHeightInPx={800}
        dashboardComponentHeightInPx={450}
        dashboardComponentWidthInPx={1200}
        dashboardViewConfig={DASHBOARD_VIEW_CONFIG}
        dashboardStartAndEndDate={DASHBOARD_RANGE}
        metricTypes={[]}
        refreshTick={0}
        variables={[{ ...SLO_VARIABLE, selectedValue: "Search API" }]}
        component={component}
      />,
    );

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    const secondBody: JSONObject = (
      (getListMock.mock.calls[1]![0] as JSONObject)[
        "requestOptions"
      ] as JSONObject
    )["additionalRequestBody"] as JSONObject;

    expect(secondBody["variables"]).toEqual([
      { id: SLO_VARIABLE.id, selectedValue: "Search API", selectedValues: [] },
    ]);
  });
});
