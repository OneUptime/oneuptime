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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import Route from "../../../Types/API/Route";
import {
  CloudAccountCostSummary,
  CloudCostState,
  readCloudAccountCostSummary,
} from "../../../Types/Cloud/CloudCost";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import { CloudCostPoint } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostReads";
import CloudCostsView, {
  BREAKDOWN_RESOURCES_NOTE,
  BREAKDOWN_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostsView";
import { CloudAccountRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts";
import {
  COST_GAPS_DESCRIPTION,
  COST_GAPS_NONE_READ_DESCRIPTION,
  COST_GAPS_NONE_READ_TITLE,
  COST_GAPS_TITLE,
  SAVINGS_GAPS_DESCRIPTION,
  SAVINGS_GAPS_NONE_READ_DESCRIPTION,
  SAVINGS_GAPS_TITLE,
  getCloudCostGapsDescription,
  getCloudCostGapsTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostGapsCard";

/*
 * WHAT THE CLOUD COSTS - Cloud > Costs over every account and an account's
 * own Costs tab - with the network stubbed and the chart replaced by a
 * marker of the days it was handed:
 *
 *   - the strip: the month so far, where it is heading, last month, what
 *     could be saved;
 *   - each of the last 30 days, read summed by day;
 *   - where the money goes: by service, Region, account (linked to that
 *     account's Costs) or resource, in a period - the first ten, then the
 *     rest on asking - and what a breakdown by resource can name;
 *   - an account's tab reads its own costs, with no breakdown by account;
 *   - the accounts left out of the figures, each with why and what to do;
 *   - before any cost is read, what each cloud needs.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDailySpendChart",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDailySpendChart",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: (props?: {
        points: Array<CloudCostPoint>;
        currency: string;
      }): React.ReactElement => {
        const ReactActual: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactActual.createElement("div", {
          "data-testid": "daily-spend-chart-stub",
          "data-days": String(props?.points.length ?? 0),
          "data-total": String(
            (props?.points || []).reduce(
              (sum: number, point: CloudCostPoint): number => {
                return sum + point.y;
              },
              0,
            ),
          ),
          "data-currency": props?.currency || "",
        });
      },
    };
  },
);

const PROJECT: ObjectID = new ObjectID(PROJECT_ID);
const WEB_ROW: string = "10000000-0000-4000-8000-0000000000b1";
const DATA_ROW: string = "10000000-0000-4000-8000-0000000000b2";
const EUROPE_ROW: string = "10000000-0000-4000-8000-0000000000b3";
const NEW_ROW: string = "10000000-0000-4000-8000-0000000000b4";
const NOW: Date = new Date("2026-11-20T15:00:00.000Z");

function summary(
  overrides: Record<string, unknown> = {},
): CloudAccountCostSummary {
  return readCloudAccountCostSummary({
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 2000,
    lastMonth: 4000,
    monthFullDays: 2000,
    lastMonthToDate: 1600,
    projectedMonth: 3900,
    last30Days: 3800,
    topServices: [],
    readAt: new Date().toISOString(),
    ...overrides,
  })!;
}

function row(
  overrides: Omit<Partial<CloudAccountRow>, "id"> & { id: string },
): CloudAccountRow {
  return {
    name: "",
    provider: "aws",
    accountId: "",
    lastSeenAt: new Date(),
    hasConnection: true,
    resourceCount: 10,
    costSummary: summary(),
    savingsSummary: null,
    ...overrides,
    id: new ObjectID(overrides.id),
  };
}

const WEB: CloudAccountRow = row({
  id: WEB_ROW,
  name: "web-prod",
  accountId: "123456789012",
});
const DATA: CloudAccountRow = row({
  id: DATA_ROW,
  name: "data-lake",
  accountId: "210987654321",
  costSummary: summary({ monthToDate: 1000 }),
});

let trendForTest: Array<{ timestamp: string; value: number }> | Error = [];
let sharesForTest: Array<Record<string, unknown>> | Error = [];
let aggregateSpy: jest.SpyInstance<any, any>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/costs`);

  // The view reads up to now: the same now, whatever day the suite runs.
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  trendForTest = [
    { timestamp: "2026-11-20T00:00:00.000Z", value: 120 },
    { timestamp: "2026-11-19T00:00:00.000Z", value: 80 },
  ];
  sharesForTest = [
    { service: "Amazon EC2", value: 1700 },
    { service: "Amazon RDS", value: 900 },
    { service: "", value: 400 },
  ];

  aggregateSpy = getJestSpyOn(
    AnalyticsModelAPI,
    "aggregate",
  ).mockImplementation(
    async (request: {
      aggregateBy: AggregateBy<CloudCost>;
    }): Promise<unknown> => {
      if (request.aggregateBy.aggregationInterval === AggregationInterval.Day) {
        if (trendForTest instanceof Error) {
          throw trendForTest;
        }
        return { data: trendForTest };
      }

      if (sharesForTest instanceof Error) {
        throw sharesForTest;
      }
      return { data: sharesForTest };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openView(
  props: Partial<React.ComponentProps<typeof CloudCostsView>> = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CloudCostsView
          projectId={PROJECT}
          accounts={[WEB, DATA]}
          savingsRoute={new Route(`/dashboard/${PROJECT_ID}/cloud/savings`)}
          {...props}
        />
      </MemoryRouter>,
    );
  });
}

function breakdownCalls(): Array<AggregateBy<CloudCost>> {
  return aggregateSpy.mock.calls
    .map((call: Array<any>): AggregateBy<CloudCost> => {
      return call[0].aggregateBy;
    })
    .filter((aggregateBy: AggregateBy<CloudCost>): boolean => {
      return aggregateBy.aggregationInterval === AggregationInterval.Total;
    });
}

describe("every account's costs", () => {
  test("the strip: the month so far, its projection, last month, what could be saved", async () => {
    await openView();

    const strip: HTMLElement = screen.getByTestId("cloud-costs-strip");
    const values: Array<string> = within(strip)
      .getAllByTestId("cloud-stat-tile-value")
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    expect(values).toEqual(["$3,000", "$7,800", "$8,000", "—"]);
  });

  test("each of the last 30 days, read summed by day for every account", async () => {
    await openView();

    const chart: HTMLElement = await screen.findByTestId(
      "daily-spend-chart-stub",
    );
    expect(chart).toHaveAttribute("data-days", "30");
    expect(chart).toHaveAttribute("data-total", "200");
    expect(chart).toHaveAttribute("data-currency", "USD");

    const trend: AggregateBy<CloudCost> = aggregateSpy.mock.calls
      .map((call: Array<any>): AggregateBy<CloudCost> => {
        return call[0].aggregateBy;
      })
      .find((aggregateBy: AggregateBy<CloudCost>): boolean => {
        return aggregateBy.aggregationInterval === AggregationInterval.Day;
      })!;
    expect(trend.query).not.toHaveProperty("cloudAccountId");
    expect(trend.query).toMatchObject({ projectId: PROJECT, currency: "USD" });
  });

  test("where the money goes: by service this month, the costliest first, a cost of no service named so", async () => {
    await openView();

    const breakdown: HTMLElement = screen.getByTestId("cloud-cost-breakdown");

    await waitFor(() => {
      expect(
        within(breakdown).getByTestId("cloud-cost-breakdown-total"),
      ).toHaveTextContent("$3,000 in all");
    });

    const text: string = breakdown.textContent || "";
    expect(text.indexOf("Amazon EC2")).toBeLessThan(text.indexOf("Amazon RDS"));
    expect(breakdown).toHaveTextContent("Unnamed service");
    expect(breakdown).toHaveTextContent("$1,700");
    expect(breakdownCalls()[0]!.groupBy).toEqual({ service: true });
  });

  test("by account: each named and linked to its own Costs; one since removed said so", async () => {
    sharesForTest = [
      { cloudAccountId: DATA_ROW, value: 1000 },
      { cloudAccountId: WEB_ROW, value: 2000 },
      { cloudAccountId: "10000000-0000-4000-8000-0000000000ff", value: 5 },
    ];

    await openView();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("cloud-cost-breakdown-dimension-cloudAccountId"),
      );
    });

    const breakdown: HTMLElement = screen.getByTestId("cloud-cost-breakdown");
    await waitFor(() => {
      expect(breakdown).toHaveAttribute("data-dimension", "cloudAccountId");
      expect(
        within(breakdown).getByRole("link", { name: /web-prod/ }),
      ).toBeInTheDocument();
    });

    expect(
      within(breakdown).getByRole("link", { name: /web-prod/ }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/accounts/${WEB_ROW}/costs`),
    );
    expect(breakdown).toHaveTextContent("An account since removed");
    expect(breakdownCalls().pop()!.groupBy).toEqual({ cloudAccountId: true });
  });

  test("last month: the whole of last month is read", async () => {
    await openView();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("cloud-cost-breakdown-period-last-month"),
      );
    });

    await waitFor(() => {
      expect(breakdownCalls().pop()).toMatchObject({
        startTimestamp: new Date("2026-10-01T00:00:00.000Z"),
        endTimestamp: new Date("2026-10-31T23:59:59.999Z"),
      });
    });
  });

  test("the first ten, then the rest on asking", async () => {
    sharesForTest = Array.from({ length: BREAKDOWN_SHOWN + 3 }).map(
      (_: unknown, index: number): Record<string, unknown> => {
        return { service: `Service ${index + 1}`, value: 100 - index };
      },
    );

    await openView();

    const breakdown: HTMLElement = screen.getByTestId("cloud-cost-breakdown");
    const toggle: HTMLElement = await within(breakdown).findByTestId(
      "cloud-cost-breakdown-toggle",
    );

    expect(toggle).toHaveTextContent("Show 3 more");
    expect(breakdown).not.toHaveTextContent("Service 13");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(breakdown).toHaveTextContent("Service 13");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("by resource: the resource's name, and what each cloud can name", async () => {
    sharesForTest = [
      {
        resourceId:
          "/subscriptions/0000/resourceGroups/web/providers/Microsoft.Compute/virtualMachines/web-1",
        value: 300,
      },
      { resourceId: "", value: 100 },
    ];

    await openView();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("cloud-cost-breakdown-dimension-resourceId"),
      );
    });

    const breakdown: HTMLElement = screen.getByTestId("cloud-cost-breakdown");
    await waitFor(() => {
      expect(breakdown).toHaveTextContent("web-1");
    });
    expect(breakdown).toHaveTextContent("Not billed to a resource");
    expect(breakdown).toHaveTextContent(BREAKDOWN_RESOURCES_NOTE);
  });

  test("a read that fails says so, and Refresh reads again", async () => {
    sharesForTest = new Error("ClickHouse is busy");

    await openView();

    const breakdown: HTMLElement = screen.getByTestId("cloud-cost-breakdown");
    await waitFor(() => {
      expect(breakdown).toHaveTextContent("ClickHouse is busy");
    });

    sharesForTest = [{ service: "Amazon EC2", value: 10 }];

    await act(async () => {
      fireEvent.click(within(breakdown).getByTestId("refresh-button"));
    });

    await waitFor(() => {
      expect(breakdown).toHaveTextContent("Amazon EC2");
    });
  });
});

describe("one account's Costs tab", () => {
  test("its own costs only, and no breakdown by account", async () => {
    await openView({ accounts: [WEB], cloudAccountId: WEB.id });

    await screen.findByTestId("daily-spend-chart-stub");

    for (const call of aggregateSpy.mock.calls) {
      expect(call[0].aggregateBy.query["cloudAccountId"]).toEqual(WEB.id);
    }
    expect(
      screen.queryByTestId("cloud-cost-breakdown-dimension-cloudAccountId"),
    ).toBeNull();
    expect(
      within(screen.getByTestId("cloud-costs-strip")).getAllByTestId(
        "cloud-stat-tile-value",
      )[0],
    ).toHaveTextContent("$2,000");
  });
});

describe("the accounts left out", () => {
  test("each with why: not allowed (with what to do), another currency, not read yet", async () => {
    await openView({
      accounts: [
        WEB,
        DATA,
        row({
          id: EUROPE_ROW,
          name: "eu-shop",
          provider: "azure",
          costSummary: summary({ currency: "EUR", monthToDate: 700 }),
        }),
        row({
          id: NEW_ROW,
          name: "analytics",
          provider: "gcp",
          costSummary: summary({
            state: CloudCostState.NotAllowed,
            message: "Permission bigquery.jobs.create denied.",
          }),
        }),
        row({
          id: "10000000-0000-4000-8000-0000000000b5",
          name: "staging",
          costSummary: null,
        }),
      ],
    });

    const gaps: Array<HTMLElement> = within(
      screen.getByTestId("cloud-costs-gaps"),
    ).getAllByTestId("cloud-cost-gap");

    expect(
      gaps.map((gap: HTMLElement) => {
        return gap.getAttribute("data-reason");
      }),
    ).toEqual(["currency", CloudCostState.NotAllowed, "waiting"]);

    expect(gaps[0]).toHaveTextContent("eu-shop");
    expect(gaps[0]).toHaveTextContent("Billed in EUR");
    expect(screen.getByTestId("cloud-costs-gaps")).toHaveTextContent(
      "The figures above are in USD",
    );
    // Left out of the figures above, which there are.
    expect(screen.getByText(COST_GAPS_DESCRIPTION)).toBeInTheDocument();
    /*
     * Left out, not "not read": eu-shop's costs are read, in euros, and
     * only kept out of figures in dollars.
     */
    expect(screen.getByText(COST_GAPS_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(COST_GAPS_NONE_READ_TITLE)).toBeNull();

    expect(gaps[1]).toHaveTextContent(
      "Permission bigquery.jobs.create denied.",
    );
    expect(gaps[1]).toHaveTextContent("BigQuery");
    expect(
      within(gaps[1]!).getByRole("link", { name: "Read the guide" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/docs/telemetry/cloud-costs#google-cloud"),
    );
    expect(
      within(gaps[1]!).getByRole("link", { name: "analytics" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/accounts/${NEW_ROW}/costs`),
    );

    expect(gaps[2]).toHaveTextContent("Waiting for the first read");
  });

  test("every account read in one currency: no card", async () => {
    await openView();

    expect(screen.queryByTestId("cloud-costs-gaps")).toBeNull();
  });
});

describe("before any cost is read", () => {
  test("what each cloud needs, and nothing read of the costs", async () => {
    await openView({
      accounts: [
        row({
          id: WEB_ROW,
          name: "web-prod",
          costSummary: summary({ state: CloudCostState.NotSetUp }),
        }),
        row({
          id: DATA_ROW,
          name: "data",
          provider: "azure",
          costSummary: null,
        }),
      ],
    });

    const steps: Array<HTMLElement> = within(
      screen.getByTestId("cloud-costs-not-read"),
    ).getAllByTestId("cloud-cost-setup-step");

    expect(
      steps.map((step: HTMLElement) => {
        return step.getAttribute("data-provider");
      }),
    ).toEqual(["aws", "azure"]);
    expect(steps[1]).toHaveTextContent("Cost Management Reader");
    expect(screen.queryByTestId("cloud-costs-strip")).toBeNull();
    expect(aggregateSpy).not.toHaveBeenCalled();

    // Still listed with why.
    expect(
      within(screen.getByTestId("cloud-costs-gaps")).getAllByTestId(
        "cloud-cost-gap",
      ),
    ).toHaveLength(2);
    // No figures above to be left out of: the card says what it holds.
    expect(
      screen.getByText(COST_GAPS_NONE_READ_DESCRIPTION),
    ).toBeInTheDocument();
    expect(screen.queryByText(COST_GAPS_DESCRIPTION)).toBeNull();
    expect(screen.getByText(COST_GAPS_NONE_READ_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(COST_GAPS_TITLE)).toBeNull();
  });
});

describe("the left-out accounts card's words", () => {
  test("its title: accounts left out of figures, or not read when nothing is", () => {
    expect(getCloudCostGapsTitle({ kind: "costs", isNothingRead: false })).toBe(
      "Accounts left out",
    );
    expect(getCloudCostGapsTitle({ kind: "costs", isNothingRead: true })).toBe(
      "Accounts whose costs are not read",
    );
    // An account's recommendations are left out only when not read.
    for (const isNothingRead of [true, false]) {
      expect(getCloudCostGapsTitle({ kind: "savings", isNothingRead })).toBe(
        SAVINGS_GAPS_TITLE,
      );
    }
    expect(COST_GAPS_DESCRIPTION).toBe(
      "Their costs are not in the figures above. Each says why.",
    );
  });

  test("say the figures above only when there are some", () => {
    expect(
      getCloudCostGapsDescription({ kind: "costs", isNothingRead: false }),
    ).toBe(COST_GAPS_DESCRIPTION);
    expect(
      getCloudCostGapsDescription({ kind: "costs", isNothingRead: true }),
    ).toBe(COST_GAPS_NONE_READ_DESCRIPTION);
    expect(
      getCloudCostGapsDescription({ kind: "savings", isNothingRead: false }),
    ).toBe(SAVINGS_GAPS_DESCRIPTION);
    expect(
      getCloudCostGapsDescription({ kind: "savings", isNothingRead: true }),
    ).toBe(SAVINGS_GAPS_NONE_READ_DESCRIPTION);
  });
});
