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
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        children: React.ReactNode;
        to: { toString: () => string };
        className?: string;
      }): React.ReactElement => {
        return (
          <a href={props.to.toString()} className={props.className}>
            {props.children}
          </a>
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
      populateRouteParams: (
        _route: unknown,
        params: { modelId: { toString: () => string } },
      ): { toString: () => string } => {
        return {
          toString: (): string => {
            return `/slo/${params.modelId.toString()}`;
          },
        };
      },
    },
  };
});

import DashboardSloListComponentElement, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloListComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import URL from "../../../Types/API/URL";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import TimeRange from "../../../Types/Time/TimeRange";
import DashboardSloListComponentUtil from "../../../Utils/Dashboard/Components/DashboardSloListComponent";

const COMPONENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DASHBOARD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CHECKOUT_MONITOR_ID: string =
  "44444444-4444-4444-8444-444444444444";
const SEARCH_MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";
const PRODUCTION_LABEL_ID: string =
  "66666666-6666-4666-8666-666666666666";
const PAYMENTS_LABEL_ID: string = "77777777-7777-4777-8777-777777777777";

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

interface RelatedItem {
  _id: string;
  name: string;
  color?: string;
}

function buildSlo(
  id: string,
  name: string,
  overrides: Partial<ServiceLevelObjective> = {},
): ServiceLevelObjective {
  return Object.assign(new ServiceLevelObjective(), {
    _id: id,
    name,
    targetPercentage: 99.9,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    currentSliPercentage: 99.95,
    errorBudgetRemainingPercentage: 75,
    errorBudgetRemainingSeconds: 3600,
    currentBurnRate: 0.5,
    sloStatus: SloStatus.Healthy,
    isEnabled: true,
    monitors: [] as Array<RelatedItem>,
    labels: [] as Array<RelatedItem>,
    ...overrides,
  });
}

const HEALTHY_ID: string = "88888888-8888-4888-8888-888888888888";
const AT_RISK_ID: string = "99999999-9999-4999-8999-999999999999";
const BREACHED_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DISABLED_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function buildFleet(): Array<ServiceLevelObjective> {
  const disabled: ServiceLevelObjective = buildSlo(
    DISABLED_ID,
    "Legacy API",
    {
      isEnabled: false,
      sloStatus: SloStatus.Paused,
    },
  );
  delete disabled.currentSliPercentage;
  delete disabled.errorBudgetRemainingPercentage;
  delete disabled.errorBudgetRemainingSeconds;
  delete disabled.currentBurnRate;

  return [
    buildSlo(HEALTHY_ID, "Checkout availability", {
      monitors: [
        { _id: CHECKOUT_MONITOR_ID, name: "Checkout API" },
      ] as never,
      labels: [
        { _id: PRODUCTION_LABEL_ID, name: "production", color: "#16a34a" },
        { _id: PAYMENTS_LABEL_ID, name: "payments", color: "#4f46e5" },
      ] as never,
    }),
    buildSlo(AT_RISK_ID, "Search latency", {
      monitors: [
        { _id: SEARCH_MONITOR_ID, name: "Search API" },
      ] as never,
      labels: [
        { _id: PRODUCTION_LABEL_ID, name: "production", color: "#16a34a" },
      ] as never,
      currentSliPercentage: 99.7,
      errorBudgetRemainingPercentage: 12.25,
      errorBudgetRemainingSeconds: 900,
      currentBurnRate: 2.4,
      sloStatus: SloStatus.AtRisk,
    }),
    buildSlo(BREACHED_ID, "Payments success", {
      monitors: [
        { _id: CHECKOUT_MONITOR_ID, name: "Checkout API" },
      ] as never,
      labels: [
        { _id: PAYMENTS_LABEL_ID, name: "payments", color: "#4f46e5" },
      ] as never,
      currentSliPercentage: 98.75,
      errorBudgetRemainingPercentage: -14.5,
      errorBudgetRemainingSeconds: -2520,
      currentBurnRate: 8.12,
      sloStatus: SloStatus.BudgetExhausted,
    }),
    disabled,
  ];
}

function projectLabelVariable(
  selectedValue: string = PRODUCTION_LABEL_ID,
): DashboardVariable {
  return {
    id: "environment",
    name: "ENVIRONMENT",
    type: DashboardVariableType.ProjectLabel,
    selectedValue,
    labelOptions: [
      { label: "Production", value: PRODUCTION_LABEL_ID },
      { label: "Payments", value: PAYMENTS_LABEL_ID },
    ],
  };
}

function buildProps(
  overrides: Partial<ComponentProps> = {},
): ComponentProps {
  const component: ComponentProps["component"] =
    DashboardSloListComponentUtil.getDefaultComponent();
  component.componentId = COMPONENT_ID;
  component.arguments = {
    title: "SLO Fleet Overview",
    maxRows: 50,
  };

  return {
    component,
    componentId: COMPONENT_ID,
    key: "slo-list",
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: (): void => {},
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 600,
    dashboardComponentWidthInPx: 1200,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: undefined,
    ...overrides,
  };
}

function renderWidget(overrides: Partial<ComponentProps> = {}): RenderResult {
  return render(<DashboardSloListComponentElement {...buildProps(overrides)} />);
}

beforeEach((): void => {
  jest.clearAllMocks();
  setPublicDashboardContext(null);
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getListMock.mockResolvedValue({
    data: buildFleet(),
    count: 4,
    skip: 0,
    limit: 50,
  });
});

afterEach((): void => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("SLO fleet overview widget", () => {
  test("fetches the complete fleet projection and renders attention-first rows", async () => {
    renderWidget();

    expect(await screen.findByText("Payments success")).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]?.[0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: { name: SortOrder.Ascending },
      select: {
        _id: true,
        name: true,
        targetPercentage: true,
        windowType: true,
        windowDays: true,
        timezone: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
        errorBudgetRemainingSeconds: true,
        currentBurnRate: true,
        sloStatus: true,
        isEnabled: true,
        atRiskThresholdPercentage: true,
        monitors: { _id: true, name: true },
        labels: { _id: true, name: true, color: true },
      },
    });
    expect(getListMock.mock.calls[0]?.[0].requestOptions).toBeUndefined();

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      /^slo-overview-row-/,
    );
    expect(rows.map((row: HTMLElement): string | null => row.getAttribute("data-testid"))).toEqual([
      `slo-overview-row-${BREACHED_ID}`,
      `slo-overview-row-${AT_RISK_ID}`,
      `slo-overview-row-${DISABLED_ID}`,
      `slo-overview-row-${HEALTHY_ID}`,
    ]);
    expect(screen.getByText("4 of 4 SLOs")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Checkout availability" })).toHaveAttribute(
      "href",
      `/slo/${HEALTHY_ID}`,
    );
  });

  test("summarizes every state and status cards filter the table", async () => {
    renderWidget();
    await screen.findByText("Payments success");

    expect(
      within(screen.getByTestId("slo-overview-summary-all")).getByText("4"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("slo-overview-summary-healthy")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("slo-overview-summary-at-risk")).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("slo-overview-summary-budget-exhausted"),
      ).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("slo-overview-summary-not-evaluating"),
      ).getByText("1"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("slo-overview-summary-at-risk"));
    expect(screen.getByText("Search latency")).toBeInTheDocument();
    expect(screen.queryByText("Payments success")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 4 SLOs")).toBeInTheDocument();
    expect(
      screen.getByTestId("slo-overview-summary-at-risk"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("searches across SLO, service, and label names", async () => {
    renderWidget();
    await screen.findByText("Payments success");
    const search: HTMLElement = screen.getByRole("searchbox", {
      name: "Search SLOs or services",
    });

    fireEvent.change(search, { target: { value: "legacy" } });
    expect(screen.getByText("Legacy API")).toBeInTheDocument();
    expect(screen.queryByText("Checkout availability")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Search API" } });
    expect(screen.getByText("Search latency")).toBeInTheDocument();
    expect(screen.queryByText("Legacy API")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "payments" } });
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();
    expect(screen.getByText("Payments success")).toBeInTheDocument();
    expect(screen.queryByText("Search latency")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 2 SLOs")).toBeInTheDocument();
  });

  test("filters locally by service or label without another network request", async () => {
    renderWidget();
    await screen.findByText("Payments success");

    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter by service or monitor" }),
      { target: { value: SEARCH_MONITOR_ID } },
    );
    expect(screen.getByText("Search latency")).toBeInTheDocument();
    expect(screen.queryByText("Payments success")).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter by service or monitor" }),
      { target: { value: "" } },
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by label" }), {
      target: { value: PAYMENTS_LABEL_ID },
    });
    expect(screen.getByText("Payments success")).toBeInTheDocument();
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();
    expect(screen.queryByText("Search latency")).not.toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("renders precision, signed budget, burn rate, window, and clamped progress", async () => {
    renderWidget();
    const breachedRow: HTMLElement = await screen.findByTestId(
      `slo-overview-row-${BREACHED_ID}`,
    );

    expect(within(breachedRow).getByText("98.75%")).toBeInTheDocument();
    expect(within(breachedRow).getByText("-14.5%")).toBeInTheDocument();
    expect(
      within(breachedRow).getByText("−42 min over budget"),
    ).toBeInTheDocument();
    expect(within(breachedRow).getByText("8.12×")).toBeInTheDocument();
    expect(within(breachedRow).getByText("30 days rolling")).toBeInTheDocument();
    const progress: HTMLElement = within(breachedRow).getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(progress.firstElementChild).toHaveStyle({ width: "0%" });

    const healthyProgress: HTMLElement = within(
      screen.getByTestId(`slo-overview-row-${HEALTHY_ID}`),
    ).getByRole("progressbar");
    expect(healthyProgress).toHaveAttribute("aria-valuenow", "75");
    expect(healthyProgress.firstElementChild).toHaveStyle({ width: "75%" });
  });

  test("applies stored status, monitor, fixed-label, variable-label, and row filters", async () => {
    const input: ComponentProps = buildProps({
      variables: [projectLabelVariable()],
    });
    input.component.arguments = {
      title: "{{ENVIRONMENT}} reliability",
      maxRows: 7,
      sloStatuses: [SloStatus.AtRisk, SloStatus.BudgetExhausted],
      monitorIds: [CHECKOUT_MONITOR_ID],
      labelIds: [PAYMENTS_LABEL_ID],
      labelVariableId: "environment",
    };

    render(<DashboardSloListComponentElement {...input} />);
    await screen.findByText("Payments success");

    expect(getListMock.mock.calls[0]?.[0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        sloStatus: new Includes([
          SloStatus.AtRisk,
          SloStatus.BudgetExhausted,
        ]),
        monitors: new Includes([CHECKOUT_MONITOR_ID]),
        labels: new IncludesAnyOfGroups([
          [PAYMENTS_LABEL_ID],
          [PRODUCTION_LABEL_ID],
        ]),
      },
      limit: LIMIT_PER_PROJECT,
    });
    expect(screen.getByText("Production reliability")).toBeInTheDocument();
  });

  test("uses the dashboard-scoped endpoint and sends only variable selections publicly", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);
    setPublicDashboardContext({
      dashboardId: DASHBOARD_ID,
      apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
      postJSON: async () => {
        throw new Error("Unexpected public request");
      },
    } as PublicDashboardContext);
    const input: ComponentProps = buildProps({
      variables: [projectLabelVariable(PAYMENTS_LABEL_ID)],
    });

    render(<DashboardSloListComponentElement {...input} />);
    await screen.findByText("Payments success");

    const requestOptions: Record<string, unknown> = getListMock.mock.calls[0]?.[0]
      .requestOptions as Record<string, unknown>;
    expect(
      (requestOptions["overrideRequestUrl"] as URL).toString(),
    ).toBe(
      `https://dev.oneuptime.com/public-dashboard-api/resource-list/${DASHBOARD_ID.toString()}/slo`,
    );
    expect(requestOptions["additionalRequestBody"]).toEqual({
      componentId: COMPONENT_ID.toString(),
      variables: [
        {
          id: "environment",
          selectedValue: PAYMENTS_LABEL_ID,
          selectedValues: [],
        },
      ],
    });
  });

  test("renders headline-only public SLO rows without exposing private metadata", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);
    setPublicDashboardContext({
      dashboardId: DASHBOARD_ID,
      apiUrl: URL.fromString("https://dev.oneuptime.com/public-dashboard-api"),
      postJSON: async () => {
        throw new Error("Unexpected public request");
      },
    } as PublicDashboardContext);
    const publicSlo: ServiceLevelObjective = buildSlo(
      HEALTHY_ID,
      "Public availability",
      {
        isEnabled: false,
      },
    );
    delete publicSlo.windowType;
    delete publicSlo.windowDays;
    delete publicSlo.timezone;
    delete publicSlo.monitors;
    delete publicSlo.labels;
    delete publicSlo.atRiskThresholdPercentage;
    getListMock.mockResolvedValue({
      data: [publicSlo],
      count: 1,
    });

    renderWidget();
    const row: HTMLElement = await screen.findByTestId(
      `slo-overview-row-${HEALTHY_ID}`,
    );
    expect(within(row).getByText("Public availability")).toBeInTheDocument();
    expect(within(row).getByText("Disabled")).toBeInTheDocument();
    expect(within(row).queryByText("99.95%")).not.toBeInTheDocument();
    expect(within(row).queryByText("75%")).not.toBeInTheDocument();
    expect(within(row).queryByText("60 min remaining")).not.toBeInTheDocument();
    expect(within(row).queryByText("0.5×")).not.toBeInTheDocument();
    expect(within(row).getByText("Not evaluated")).toBeInTheDocument();
    expect(within(row).getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(within(row).getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "Not evaluated",
    );
    expect(within(row).getAllByRole("cell")[2]).toHaveClass("text-gray-400");
    expect(
      within(screen.getByTestId("slo-overview-summary-healthy")).getByText("0"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("slo-overview-summary-not-evaluating"),
      ).getByText("1"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Public availability" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search SLOs" })).toBeInTheDocument();
    expect(screen.queryByText("Service / Monitor")).not.toBeInTheDocument();
    expect(screen.queryByText("Target & Window")).not.toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Filter by label" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Filter by service or monitor" }),
    ).not.toBeInTheDocument();
  });

  test("does not present stale numbers for disabled, paused, or misconfigured SLOs", async () => {
    const disabled: ServiceLevelObjective = buildSlo(
      DISABLED_ID,
      "Disabled stale SLO",
      {
        isEnabled: false,
        currentSliPercentage: 91.1,
        errorBudgetRemainingPercentage: 81.1,
        currentBurnRate: 71.1,
        sloStatus: SloStatus.Healthy,
      },
    );
    const paused: ServiceLevelObjective = buildSlo(
      HEALTHY_ID,
      "Paused stale SLO",
      {
        currentSliPercentage: 92.2,
        errorBudgetRemainingPercentage: 82.2,
        currentBurnRate: 72.2,
        sloStatus: SloStatus.Paused,
      },
    );
    const misconfigured: ServiceLevelObjective = buildSlo(
      AT_RISK_ID,
      "Misconfigured stale SLO",
      {
        currentSliPercentage: 93.3,
        errorBudgetRemainingPercentage: 83.3,
        currentBurnRate: 73.3,
        sloStatus: SloStatus.Misconfigured,
      },
    );
    getListMock.mockResolvedValueOnce({
      data: [disabled, paused, misconfigured],
      count: 3,
    });

    renderWidget();

    for (const item of [
      { id: DISABLED_ID, staleValues: ["91.1%", "81.1%", "71.1×"] },
      { id: HEALTHY_ID, staleValues: ["92.2%", "82.2%", "72.2×"] },
      { id: AT_RISK_ID, staleValues: ["93.3%", "83.3%", "73.3×"] },
    ]) {
      const staleRow: HTMLElement = await screen.findByTestId(
        `slo-overview-row-${item.id}`,
      );
      for (const staleValue of item.staleValues) {
        expect(within(staleRow).queryByText(staleValue)).not.toBeInTheDocument();
      }
      expect(within(staleRow).getByText("Not evaluated")).toBeInTheDocument();
      expect(within(staleRow).getByRole("progressbar")).not.toHaveAttribute(
        "aria-valuenow",
      );
      expect(within(staleRow).getByRole("progressbar")).toHaveAttribute(
        "aria-valuetext",
        "Not evaluated",
      );
      expect(within(staleRow).getAllByRole("cell")[3]).toHaveClass(
        "text-gray-400",
      );
    }
  });

  test("shows distinct fleet-empty and filter-empty states", async () => {
    getListMock.mockResolvedValueOnce({ data: [], count: 0 });
    const first: RenderResult = renderWidget();
    expect(
      await screen.findByText(
        "No SLOs found. Create an SLO to start tracking reliability.",
      ),
    ).toBeInTheDocument();
    first.unmount();

    getListMock.mockResolvedValueOnce({ data: buildFleet(), count: 4 });
    renderWidget();
    await screen.findByText("Payments success");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "does-not-exist" },
    });
    expect(
      screen.getByText("No SLOs match these filters."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 0 SLOs")).toBeInTheDocument();
  });

  test("searches the bounded fleet before applying the visible row cap", async () => {
    const input: ComponentProps = buildProps();
    input.component.arguments.maxRows = 2;
    render(<DashboardSloListComponentElement {...input} />);

    await screen.findByText("Payments success");
    expect(screen.getAllByTestId(/^slo-overview-row-/)).toHaveLength(2);
    expect(screen.queryByText("Checkout availability")).not.toBeInTheDocument();
    expect(getListMock.mock.calls[0]?.[0].limit).toBe(LIMIT_PER_PROJECT);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Checkout availability" },
    });
    expect(screen.getByText("Checkout availability")).toBeInTheDocument();
    expect(screen.getByText("1 of 1 SLOs")).toBeInTheDocument();
  });

  test("clears a relation filter when that option disappears on refresh", async () => {
    const input: ComponentProps = buildProps();
    const view: RenderResult = render(
      <DashboardSloListComponentElement {...input} />,
    );
    await screen.findByText("Payments success");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter by service or monitor" }),
      { target: { value: SEARCH_MONITOR_ID } },
    );
    expect(screen.getByText("Search latency")).toBeInTheDocument();

    getListMock.mockResolvedValueOnce({
      data: [buildSlo(HEALTHY_ID, "Unlinked SLO")],
      count: 1,
    });
    view.rerender(
      <DashboardSloListComponentElement {...input} refreshTick={1} />,
    );
    expect(await screen.findByText("Unlinked SLO")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", {
        name: "Filter by service or monitor",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("No SLOs match these filters."),
    ).not.toBeInTheDocument();
  });

  test("shows fetch and configuration errors without leaking stale rows", async () => {
    getListMock.mockRejectedValueOnce(new Error("SLO service unavailable"));
    renderWidget();
    expect(
      await screen.findByText("SLO service unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Payments success")).not.toBeInTheDocument();
  });

  test("does not fetch a private fleet when no project is selected", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);
    renderWidget();
    expect(await screen.findByText("No project selected.")).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("does not fetch everything when a configured label variable is missing", async () => {
    const input: ComponentProps = buildProps({ variables: [] });
    input.component.arguments.labelVariableId = "deleted-variable";
    render(<DashboardSloListComponentElement {...input} />);

    expect(
      await screen.findByText(/label variable is missing/),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("refetches on refresh tick", async () => {
    const input: ComponentProps = buildProps();
    const view: RenderResult = render(
      <DashboardSloListComponentElement {...input} />,
    );
    await screen.findByText("Payments success");
    expect(getListMock).toHaveBeenCalledTimes(1);

    view.rerender(
      <DashboardSloListComponentElement {...input} refreshTick={1} />,
    );
    await waitFor(() => {
      return expect(getListMock).toHaveBeenCalledTimes(2);
    });
  });

  test("ignores late results from an obsolete filter request", async () => {
    let resolvePrevious: (
      result: { data: Array<ServiceLevelObjective>; count: number },
    ) => void = () => {};
    getListMock.mockImplementationOnce(() => {
      return new Promise(
        (
          resolve: (result: {
            data: Array<ServiceLevelObjective>;
            count: number;
          }) => void,
        ) => {
          resolvePrevious = resolve;
        },
      );
    });
    const input: ComponentProps = buildProps();
    const view: RenderResult = render(
      <DashboardSloListComponentElement {...input} />,
    );
    await waitFor(() => {
      return expect(getListMock).toHaveBeenCalledTimes(1);
    });

    getListMock.mockResolvedValueOnce({
      data: [buildSlo(AT_RISK_ID, "Latest filtered SLO")],
      count: 1,
    });
    const updated: ComponentProps = buildProps();
    updated.component.arguments.sloStatuses = [SloStatus.AtRisk];
    view.rerender(<DashboardSloListComponentElement {...updated} />);
    expect(await screen.findByText("Latest filtered SLO")).toBeInTheDocument();

    await act(async () => {
      resolvePrevious({
        data: [buildSlo(HEALTHY_ID, "Obsolete fleet")],
        count: 1,
      });
    });
    expect(screen.queryByText("Obsolete fleet")).not.toBeInTheDocument();
    expect(screen.getByText("Latest filtered SLO")).toBeInTheDocument();
  });
});
