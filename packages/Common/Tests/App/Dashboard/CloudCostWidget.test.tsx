import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import DashboardCloudCostComponent from "../../../Types/Dashboard/DashboardComponents/DashboardCloudCostComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";
import DashboardCloudCostComponentUtil, {
  CloudCostWidgetDisplay,
  CloudCostWidgetScope,
} from "../../../Utils/Dashboard/Components/DashboardCloudCostComponent";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE CLOUD COST WIDGET (#11009): a total against the period before, a
 * breakdown or each day's spend, over every account, one account, a cost
 * group or a cost view, for the dashboard's time range - read through the
 * same code as Cloud > Costs and a cost group's page, on the project's
 * basis unless the widget names one. A public dashboard reads nothing and
 * draws only its note; a widget that names nothing to cover asks for it.
 */

const aggregateMock: MockFunction = getJestMockFunction();
const readAllocationMock: MockFunction = getJestMockFunction();
const fetchAccountsMock: MockFunction = getJestMockFunction();
const fetchBasisMock: MockFunction = getJestMockFunction();
const fetchGroupSpendMock: MockFunction = getJestMockFunction();
const fetchAllocationMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostReads",
  () => {
    return {
      __esModule: true,
      DASHBOARD_CLOUD_COST_READER: {
        aggregate: (...args: Array<unknown>): unknown => {
          return aggregateMock(...args);
        },
        readAllocation: (...args: Array<unknown>): unknown => {
          return readAllocationMock(...args);
        },
        readPlatformLists: async (): Promise<unknown> => {
          return { environments: [], apps: [] };
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts",
    );
    return {
      __esModule: true,
      ...actual,
      fetchCloudAccounts: (...args: Array<unknown>): unknown => {
        return fetchAccountsMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBasis",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBasis",
    );
    return {
      __esModule: true,
      ...actual,
      fetchProjectCloudCostBasis: (...args: Array<unknown>): unknown => {
        return fetchBasisMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostAllocationReads",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostAllocationReads",
    );
    return {
      __esModule: true,
      ...actual,
      fetchCloudCostGroupSpend: (...args: Array<unknown>): unknown => {
        return fetchGroupSpendMock(...args);
      },
      fetchCloudCostAllocation: (...args: Array<unknown>): unknown => {
        return fetchAllocationMock(...args);
      },
    };
  },
);

// The chart itself is the Costs page's, tested there: here, what it is handed.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDailySpendChart",
  () => {
    return {
      __esModule: true,
      default: (props: {
        points: Array<{ x: Date; y: number }>;
        currency: string;
        heightInPx?: number;
      }): React.ReactElement => {
        return (
          <div
            data-testid="chart-stand-in"
            data-points={props.points
              .map((point: { x: Date; y: number }) => {
                return `${point.x.toISOString().slice(0, 10)}=${point.y}`;
              })
              .join(",")}
            data-currency={props.currency}
            data-height={String(props.heightInPx || 0)}
          />
        );
      },
    };
  },
);

import DashboardCloudCostComponentElement, {
  CLOUD_COST_NOTHING,
  CLOUD_COST_NOT_ON_PUBLIC,
  CLOUD_COST_SETUP,
  CLOUD_COST_WIDGET_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardCloudCostComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000011009");
const ACCOUNT: string = "0192f1a0-1100-7000-8000-00000000ac01";
const GROUP: string = "0192f1a0-1100-7000-8000-00000000c001";
const VIEW: string = "0192f1a0-1100-7000-8000-0000000e0001";

// The board's range: 16 to 22 November.
const BOARD_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-11-16T00:00:00.000Z"),
    new Date("2026-11-22T23:59:59.999Z"),
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

function accountRow(id: string, name: string): Record<string, unknown> {
  return {
    id: new ObjectID(id),
    name,
    provider: "aws",
    accountId: "111111111111",
    lastSeenAt: null,
    hasConnection: true,
    resourceCount: 3,
    costSummary: {
      state: "reading",
      currency: "EUR",
      monthToDate: 0,
      lastMonth: 0,
      monthFullDays: 0,
      lastMonthToDate: 0,
      projectedMonth: 0,
      last30Days: 0,
      topServices: [],
    },
    savingsSummary: null,
  };
}

function widget(
  args: DashboardCloudCostComponent["arguments"],
): DashboardCloudCostComponent {
  const component: DashboardCloudCostComponent =
    DashboardCloudCostComponentUtil.getDefaultComponent();
  component.arguments = args;
  return component;
}

function renderWidget(
  args: DashboardCloudCostComponent["arguments"],
): void {
  const props: DashboardBaseComponentProps & {
    component: DashboardCloudCostComponent;
  } = {
    componentId: new ObjectID("0192f1a0-1100-7000-8000-0000000d0001"),
    isEditMode: false,
    isSelected: false,
    key: "cloud-cost-widget",
    onComponentUpdate: (): void => {
      // The widget never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 300,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: BOARD_RANGE,
    metricTypes: [],
    component: widget(args),
  };

  render(<DashboardCloudCostComponentElement {...props} />);
}

function readsAsked(): number {
  return (
    aggregateMock.mock.calls.length +
    fetchAccountsMock.mock.calls.length +
    fetchGroupSpendMock.mock.calls.length +
    fetchAllocationMock.mock.calls.length +
    fetchBasisMock.mock.calls.length
  );
}

beforeEach(() => {
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    PROJECT as never,
  );
  fetchAccountsMock.mockResolvedValue([
    accountRow(ACCOUNT, "Production AWS"),
  ] as never);
  fetchBasisMock.mockResolvedValue(CloudCostBasis.Amortized as never);
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
  aggregateMock.mockReset();
  readAllocationMock.mockReset();
  fetchAccountsMock.mockReset();
  fetchBasisMock.mockReset();
  fetchGroupSpendMock.mockReset();
  fetchAllocationMock.mockReset();
  jest.restoreAllMocks();
});

describe("where the widget reads nothing", () => {
  test("on a public dashboard: its note alone, and not one read", async () => {
    setPublicDashboardContext({
      dashboardId: new ObjectID("6a305555-0000-4000-8000-000000000008"),
    } as unknown as PublicDashboardContext);

    renderWidget({
      display: CloudCostWidgetDisplay.Total,
      scope: CloudCostWidgetScope.CostGroup,
      cloudCostGroupId: GROUP,
      title: "Payments' cloud spend",
    });

    expect(screen.getByText(CLOUD_COST_NOT_ON_PUBLIC)).toBeInTheDocument();
    expect(screen.getByText("Payments' cloud spend")).toBeInTheDocument();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
    expect(readsAsked()).toBe(0);
  });

  test.each([
    [CloudCostWidgetScope.Account],
    [CloudCostWidgetScope.CostGroup],
    [CloudCostWidgetScope.CostView],
  ])("covering %s without picking one: what to pick, and no read", async (
    scope: CloudCostWidgetScope,
  ) => {
    renderWidget({ display: CloudCostWidgetDisplay.Total, scope });

    expect(screen.getByText(CLOUD_COST_SETUP)).toBeInTheDocument();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
    expect(readsAsked()).toBe(0);
  });
});

describe("each day's spend", () => {
  test("every account's, each UTC day of the range, in the accounts' currency, on the project's basis", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: "2026-11-16T00:00:00.000Z", value: 10 },
        { timestamp: "2026-11-18T00:00:00.000Z", value: 110 },
      ],
    } as never);

    renderWidget({
      display: CloudCostWidgetDisplay.Trend,
      scope: CloudCostWidgetScope.AllAccounts,
    });

    const chart: HTMLElement = await screen.findByTestId("chart-stand-in");

    expect(chart.getAttribute("data-points")).toBe(
      [
        "2026-11-16=10",
        "2026-11-17=0",
        "2026-11-18=110",
        "2026-11-19=0",
        "2026-11-20=0",
        "2026-11-21=0",
        "2026-11-22=0",
      ].join(","),
    );
    expect(chart.getAttribute("data-currency")).toBe("EUR");
    // The widget's own height, less its title.
    expect(chart.getAttribute("data-height")).toBe("252");
    expect(screen.getByText("Cloud spend, every account")).toBeInTheDocument();

    const asked: AggregateBy<never> = aggregateMock.mock
      .calls[0]![0] as AggregateBy<never>;
    expect(asked.aggregationInterval).toBe(AggregationInterval.Day);
    expect(asked.aggregateColumnName).toBe("amortizedCost");
    expect((asked.query as Record<string, unknown>)["currency"]).toBe("EUR");
  });

  test("a cost group's, as its page reads it, on the basis the widget names", async () => {
    fetchGroupSpendMock.mockResolvedValue({
      currency: "EUR",
      buckets: ["2026-11-16", "2026-11-17"],
      group: {
        id: GROUP,
        name: "Payments",
        total: 30,
        previousTotal: 20,
        series: [10, 20],
        topServices: [],
      },
    } as never);

    renderWidget({
      display: CloudCostWidgetDisplay.Trend,
      scope: CloudCostWidgetScope.CostGroup,
      cloudCostGroupId: GROUP,
      basis: CloudCostBasis.Net,
    });

    const chart: HTMLElement = await screen.findByTestId("chart-stand-in");

    expect(chart.getAttribute("data-points")).toBe(
      "2026-11-16=10,2026-11-17=20",
    );

    const asked: { groupId: ObjectID; ask: Record<string, unknown> } =
      fetchGroupSpendMock.mock.calls[0]![0] as {
        groupId: ObjectID;
        ask: Record<string, unknown>;
      };
    expect(asked.groupId.toString()).toBe(GROUP);
    expect(asked.ask["basis"]).toBe(CloudCostBasis.Net);
    expect((asked.ask["startDate"] as Date).toISOString()).toBe(
      "2026-11-16T00:00:00.000Z",
    );
    // The basis named: the project's is never asked.
    expect(fetchBasisMock).not.toHaveBeenCalled();
  });

  test("a range that cost nothing says so", async () => {
    aggregateMock.mockResolvedValue({ data: [] } as never);

    renderWidget({
      display: CloudCostWidgetDisplay.Trend,
      scope: CloudCostWidgetScope.AllAccounts,
    });

    expect(await screen.findByText(CLOUD_COST_NOTHING)).toBeInTheDocument();
  });
});

describe("a total", () => {
  test("a cost group's, against the period before", async () => {
    fetchGroupSpendMock.mockResolvedValue({
      currency: "USD",
      buckets: [],
      group: {
        id: GROUP,
        name: "Payments",
        total: 490,
        previousTotal: 392,
        series: [],
        topServices: [],
      },
    } as never);

    renderWidget({
      display: CloudCostWidgetDisplay.Total,
      scope: CloudCostWidgetScope.CostGroup,
      cloudCostGroupId: GROUP,
    });

    expect(
      await screen.findByTestId(`${CLOUD_COST_WIDGET_TEST_ID}-total`),
    ).toHaveTextContent("$490.00");
    expect(
      screen.getByText("25% more than the period before"),
    ).toBeInTheDocument();
  });
});

describe("a breakdown", () => {
  test("by account: each by its name, the costliest first", async () => {
    aggregateMock.mockImplementation((async (aggregateBy: AggregateBy<never>) => {
      const day: InBetween<Date> = (
        aggregateBy.query as Record<string, unknown>
      )["day"] as InBetween<Date>;
      const isRange: boolean =
        new Date(day.startValue).toISOString() === "2026-11-16T00:00:00.000Z";

      return {
        data: isRange
          ? [
              { cloudAccountId: ACCOUNT, value: 300 },
              { cloudAccountId: "gone", value: 40 },
            ]
          : [{ cloudAccountId: ACCOUNT, value: 280 }],
      };
    }) as never);

    renderWidget({
      display: CloudCostWidgetDisplay.Breakdown,
      scope: CloudCostWidgetScope.AllAccounts,
      breakdownBy: "cloudAccountId",
    });

    const list: HTMLElement = await screen.findByTestId(
      `${CLOUD_COST_WIDGET_TEST_ID}-breakdown`,
    );

    expect(list).toHaveTextContent("Production AWS");
    expect(list.textContent!.indexOf("Production AWS")).toBeLessThan(
      list.textContent!.indexOf("gone"),
    );
    // The period before is the week before the board's.
    const previous: InBetween<Date> = (
      (aggregateMock.mock.calls[1]![0] as AggregateBy<never>).query as Record<
        string,
        unknown
      >
    )["day"] as InBetween<Date>;
    expect(new Date(previous.startValue).toISOString()).toBe(
      "2026-11-09T00:00:00.000Z",
    );
  });

  test("a cost view's: its groups, then what no group takes", async () => {
    fetchAllocationMock.mockResolvedValue({
      viewId: VIEW,
      viewName: "By team",
      currency: "USD",
      total: 850,
      previousTotal: 700,
      buckets: ["2026-11-16"],
      groups: [
        { id: "g-search", name: "Search", total: 120, series: [120] },
        { id: "g-pay", name: "Payments", total: 490, series: [490] },
        { id: "g-empty", name: "Empty", total: 0, series: [0] },
      ],
      unallocated: { total: 240, series: [240] },
    } as never);

    renderWidget({
      display: CloudCostWidgetDisplay.Breakdown,
      scope: CloudCostWidgetScope.CostView,
      cloudCostViewId: VIEW,
    });

    const list: HTMLElement = await screen.findByTestId(
      `${CLOUD_COST_WIDGET_TEST_ID}-breakdown`,
    );
    const text: string = list.textContent || "";

    expect(text.indexOf("Payments")).toBeLessThan(text.indexOf("Search"));
    expect(text.indexOf("Search")).toBeLessThan(text.indexOf("Unallocated"));
    expect(text).not.toContain("Empty");
  });
});

describe("a read that fails", () => {
  test("is said under the title, in the error's words", async () => {
    aggregateMock.mockRejectedValue(
      new Error("You need a role that may read cloud costs.") as never,
    );

    renderWidget({
      display: CloudCostWidgetDisplay.Trend,
      scope: CloudCostWidgetScope.AllAccounts,
      title: "Spend",
    });

    await waitFor(() => {
      expect(
        screen.getByText("You need a role that may read cloud costs."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Spend")).toBeInTheDocument();
  });
});

describe("its settings", () => {
  test("a new widget draws every account's trend, half a board wide", () => {
    const component: DashboardCloudCostComponent =
      DashboardCloudCostComponentUtil.getDefaultComponent();

    expect(component.arguments).toEqual({
      display: CloudCostWidgetDisplay.Trend,
      scope: CloudCostWidgetScope.AllAccounts,
    });
    expect(component.widthInDashboardUnits).toBe(6);
    expect(component.heightInDashboardUnits).toBe(4);
  });

  test("what it covers is picked from the project's accounts, groups and views", () => {
    const ids: Array<string> = DashboardCloudCostComponentUtil.getComponentConfigArguments().map(
      (argument: { id: unknown }) => String(argument.id),
    );

    expect(ids).toEqual([
      "scope",
      "cloudAccountId",
      "cloudCostGroupId",
      "cloudCostViewId",
      "display",
      "breakdownBy",
      "basis",
      "title",
    ]);
  });
});
