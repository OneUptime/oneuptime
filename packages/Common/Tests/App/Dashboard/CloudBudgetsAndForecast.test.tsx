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
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * CLOUD BUDGETS AND THE FORECAST, AS THE DASHBOARD DRAWS THEM (#11008).
 *
 *   - Budgets: created in four steps - what it counts, what it may cost and
 *     for how long, when it tells someone, and who hears - with what a
 *     budget made through the API starts with; the pick a scope needs
 *     written into the budget's own columns; each row says what it counts,
 *     its period and the period so far: a split year this month against
 *     its share, with the year beside it; a row opens the budget's page.
 *   - A year's plan typed month by month, in the fiscal year's order.
 *   - The Forecast: the scope picked as the API reads it, the method in
 *     plain words and no range claimed where there is none, the tiles, the
 *     what-if as one sentence, and a forecast saved as a yearly budget.
 *
 * ModelTable is captured instead of rendered, so what each page hands it
 * is under test; the form's context and the cost basis are stood in for.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockCapturedTableProps.push(props);
      return react.createElement("div", {
        "data-testid": "captured-model-table",
      });
    },
  };
});

// The chart draws in a browser; here, the series it is handed.
const mockChartSeries: Array<unknown> = [];

jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { data: Array<unknown> }): React.ReactElement => {
      mockChartSeries.push(props.data);
      return react.createElement("div", { "data-testid": "captured-chart" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/UseCloudBudgetFormContext",
  () => {
    return {
      __esModule: true,
      fetchCloudBudgetCostGroups: async (): Promise<Array<unknown>> => {
        return [];
      },
      default: (): unknown => {
        return {
          accountsRead: { accounts: [], isLoading: false, error: "" },
          accounts: [
            {
              id: "10000000-0000-4000-8000-0000000000b1",
              name: "web-prod",
            },
          ],
          costGroups: [
            {
              id: "10000000-0000-4000-8000-0000000000d1",
              name: "Payments",
              viewName: "By team",
            },
          ],
          ruleContext: {
            names: {
              accounts: new Map(),
              teams: new Map(),
              labels: new Map(),
              environments: new Map(),
              apps: new Map(),
              clusters: new Map(),
            },
            options: {
              services: ["Amazon EC2", "Amazon S3"],
              regions: ["us-east-1"],
              tags: [],
            },
          },
          currency: "USD",
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBasis",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBasis",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: (): null => {
        return null;
      },
      useCloudCostBasis: (): unknown => {
        return {
          basis: "amortized",
          projectBasis: "amortized",
          setBasis: (): void => {},
          isLoaded: true,
        };
      },
    };
  },
);

import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import Route from "../../../Types/API/Route";
import {
  CLOUD_BUDGET_PERIOD_LABELS,
  CloudBudgetPeriod,
  CloudBudgetPlanSplit,
  CloudBudgetScope,
} from "../../../Types/Cloud/CloudBudget";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostForecast,
  CloudCostForecastMethod,
  CloudCostForecastMonthKind,
} from "../../../Types/Cloud/CloudCostForecast";
import { CloudCostForecastResult } from "../../../Types/Cloud/CloudBudgetReads";
import {
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "../../../Types/Cloud/CloudCostRules";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudBudgets, {
  getBudgetRowFigures,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Budgets";
import CloudForecastPage, {
  getWhatIfMonthOptions,
  toCloudCostForecastAsk,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Forecast";
import {
  ALERT_AT_NOT_PERCENTS,
  getAlertAtProblem,
  getFormScopeTarget,
  isFormPlanByMonth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudBudgetForm";
import CloudBudgetMonthlyPlanEditor, {
  toCloudBudgetPlanAmounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudBudgetMonthlyPlanEditor";
import CloudBudgetMonths, {
  getCloudBudgetMonthState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudBudgetMonths";
import * as CloudBudgetReads from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudBudgetReads";
import { getCloudForecastChartSeries } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudForecastChart";
import {
  CloudForecastHowMade,
  getCloudForecastMethodSentence,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudForecastDetails";
import { toPlannedBudget } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudForecastSavePlan";
import { getCloudBudgetPeriodLine } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Budgets/CloudBudgetWords";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

interface CapturedColumn {
  title: string;
  getElement?: (item: CloudBudget) => React.ReactElement;
}

interface CapturedField {
  title: string;
  stepId?: string;
  showIf?: (values: Record<string, unknown>) => boolean;
  collapsibleSection?: unknown;
  overrideFieldKey?: string;
}

// 20 November 2026: November is the eighth month of a year from April.
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const BUDGET_ID: string = "10000000-0000-4000-8000-0000000000e1";

const pageProps: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/cloud/budgets`),
  currentProject: null,
  hasPaymentMethod: true,
};

function lastTable(): Record<string, unknown> {
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function column(title: string): CapturedColumn {
  return (lastTable()["columns"] as Array<CapturedColumn>).find(
    (entry: CapturedColumn): boolean => {
      return entry.title === title;
    },
  )!;
}

function drawn(element: React.ReactElement): HTMLElement {
  return render(<MemoryRouter>{element}</MemoryRouter>).container;
}

function budget(overrides: Record<string, unknown> = {}): CloudBudget {
  const made: CloudBudget = new CloudBudget();
  Object.assign(made, {
    _id: BUDGET_ID,
    name: "Payments",
    scope: CloudBudgetScope.AllAccounts,
    period: CloudBudgetPeriod.Month,
    fiscalYearStartMonth: 1,
    planSplit: CloudBudgetPlanSplit.None,
    monthlyAmount: 5000,
    currency: "USD",
    spentThisMonth: 4100,
    projectedThisMonth: 6200,
    alertThresholds: "80,100",
    lastCheckedAt: NOW,
    isEnabled: true,
    ...overrides,
  });
  return made;
}

function forecast(
  overrides: Partial<CloudCostForecast> = {},
): CloudCostForecast {
  return {
    method: CloudCostForecastMethod.TrendAndSeason,
    monthsOfHistory: 12,
    historyFrom: "2025-11",
    historyTo: "2026-10",
    trendPerMonth: 15,
    confidencePercent: 80,
    dailyPace: 16,
    months: [
      {
        month: "2026-10",
        kind: CloudCostForecastMonthKind.Actual,
        amount: 496,
      },
      {
        month: "2026-11",
        kind: CloudCostForecastMonthKind.Current,
        amount: 968,
        spent: 494,
      },
      {
        month: "2026-12",
        kind: CloudCostForecastMonthKind.Forecast,
        amount: 1054,
        low: 900,
        high: 1200,
      },
      {
        month: "2027-01",
        kind: CloudCostForecastMonthKind.Forecast,
        amount: 500,
        low: 450,
        high: 550,
      },
    ],
    ...overrides,
  };
}

function forecastResult(data: CloudCostForecast): CloudCostForecastResult {
  return {
    scope: CloudBudgetScope.AllAccounts,
    currency: "USD",
    basis: CloudCostBasis.Amortized,
    forecast: data,
    readAt: NOW.toISOString(),
  };
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  mockChartSeries.length = 0;
  goTo(`/dashboard/${PROJECT_ID}/cloud/budgets`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Cloud > Budgets", () => {
  async function openBudgets(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <CloudBudgets {...pageProps} />
        </MemoryRouter>,
      );
    });
  }

  test("created in four steps, starting as a budget made through the API does: a month of every account, 80% and 100%", async () => {
    await openBudgets();

    expect(lastTable()).toMatchObject({
      modelType: CloudBudget,
      id: "cloud-budgets-table",
      isCreateable: true,
      isEditable: true,
      isDeleteable: true,
      isViewable: true,
      rowSwitch: { column: "isEnabled" },
      createInitialValues: {
        currency: "USD",
        scope: CloudBudgetScope.AllAccounts,
        period: CloudBudgetPeriod.Month,
        fiscalYearStartMonth: 1,
        planSplit: CloudBudgetPlanSplit.None,
        alertThresholds: "80,100",
        alertOnProjection: true,
        alertOnAnomaly: true,
        notifyCostGroupTeam: true,
        isEnabled: true,
      },
    });
    expect(
      (lastTable()["formSteps"] as Array<{ id: string }>).map(
        (step: { id: string }): string => {
          return step.id;
        },
      ),
    ).toEqual(["budget", "amount", "alerts", "people"]);

    const fields: Array<CapturedField> = lastTable()[
      "formFields"
    ] as Array<CapturedField>;
    const shown: (
      stepId: string,
      values: Record<string, unknown>,
    ) => Array<string> = (
      stepId: string,
      values: Record<string, unknown>,
    ): Array<string> => {
      return fields
        .filter((field: CapturedField): boolean => {
          return (
            field.stepId === stepId &&
            !field.collapsibleSection &&
            (!field.showIf || field.showIf(values))
          );
        })
        .map((field: CapturedField): string => {
          return field.title;
        });
    };

    expect(shown("budget", { scope: CloudBudgetScope.AllAccounts })).toEqual([
      "Name",
      "Applies To",
    ]);
    // One account: the pick is a field of its own, under Applies To.
    expect(shown("budget", { scope: CloudBudgetScope.Account })).toEqual([
      "Name",
      "Applies To",
      "Applies To",
    ]);
    expect(shown("amount", { period: CloudBudgetPeriod.Month })).toEqual([
      "Period",
      "Amount",
    ]);
    expect(shown("amount", { period: CloudBudgetPeriod.Quarter })).toEqual([
      "Period",
      "Amount",
      "First Month of the Year",
    ]);
    expect(
      shown("amount", {
        period: CloudBudgetPeriod.Year,
        planSplit: CloudBudgetPlanSplit.ByMonth,
      }),
    ).toEqual([
      "Period",
      "First Month of the Year",
      "Budget Plan",
      "Monthly Plan",
    ]);
    expect(shown("alerts", {})).toEqual([
      "Alert At",
      "Alert When On Course To Pass",
      "Alert On Unusual Days",
    ]);

    // The columns the pick writes are carried, never drawn.
    for (const title of ["Account", "Cost Group", "Filter"]) {
      const carrier: CapturedField | undefined = fields.find(
        (field: CapturedField): boolean => {
          return field.title === title;
        },
      );
      expect(carrier?.showIf?.({})).toBe(false);
    }

    expect(
      (lastTable()["columns"] as Array<CapturedColumn>).map(
        (entry: CapturedColumn): string => {
          return entry.title;
        },
      ),
    ).toEqual(["Name", "Applies To", "Period", "This Period", "Status"]);
  });

  test("a monthly row: what the month has cost against it, where it is heading, on which basis, and how it is doing", async () => {
    await openBudgets();

    const month: HTMLElement = drawn(
      column("This Period").getElement!(budget()),
    );
    expect(month).toHaveTextContent("$4,100 of $5,000");
    expect(month).toHaveTextContent("On course for $6,200");
    expect(within(month).getByTestId("cloud-budget-basis")).toHaveAttribute(
      "data-basis",
      CloudCostBasis.Amortized,
    );

    const status: HTMLElement = drawn(column("Status").getElement!(budget()));
    expect(within(status).getByTestId("cloud-budget-status")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(status).toHaveTextContent("Passed 80%");

    expect(drawn(column("Period").getElement!(budget()))).toHaveTextContent(
      "Monthly",
    );
    expect(drawn(column("Applies To").getElement!(budget()))).toHaveTextContent(
      "All accounts",
    );
  });

  test("a yearly row split by month: this month against its share, the year beside it", async () => {
    await openBudgets();

    // April to March: November, the eighth month, may cost 400.
    const plan: Array<number> = [
      500, 500, 500, 500, 500, 500, 500, 400, 1100, 500, 500, 500,
    ];
    const yearly: CloudBudget = budget({
      period: CloudBudgetPeriod.Year,
      fiscalYearStartMonth: 4,
      planSplit: CloudBudgetPlanSplit.ByMonth,
      monthlyPlan: plan,
      monthlyAmount: 6000,
      spentThisMonth: 494,
      projectedThisMonth: 968,
      spentThisPeriod: 3918,
      projectedThisPeriod: 6400,
    });

    const figures: ReturnType<typeof getBudgetRowFigures> = getBudgetRowFigures(
      yearly,
      NOW,
    );
    expect(figures).toMatchObject({
      amount: 400,
      spent: 494,
      isPlanMonth: true,
      periodAmount: 6000,
      periodSpent: 3918,
    });

    const cell: HTMLElement = drawn(column("This Period").getElement!(yearly));
    expect(cell).toHaveTextContent("This month: $494 of $400");
    expect(
      within(cell).getByTestId("cloud-budget-year-line"),
    ).toHaveTextContent("This year: $3,918 of $6,000");
    expect(drawn(column("Status").getElement!(yearly))).toHaveTextContent(
      "Over budget",
    );
    expect(drawn(column("Period").getElement!(yearly))).toHaveTextContent(
      "Yearly from April, by month",
    );
  });

  test("a row's scope: a cost group by its name, a group gone said so, a filter by its rules", async () => {
    await openBudgets();

    const group: HTMLElement = drawn(
      column("Applies To").getElement!(
        budget({
          scope: CloudBudgetScope.CostGroup,
          cloudCostGroupId: new ObjectID(
            "10000000-0000-4000-8000-0000000000d1",
          ),
          cloudCostGroup: {
            name: "Payments",
            cloudCostViewId: new ObjectID(
              "10000000-0000-4000-8000-0000000000f1",
            ),
          },
        }),
      ),
    );
    expect(
      within(group).getByTestId("cloud-budget-scope-group-link"),
    ).toHaveTextContent("Payments");

    const gone: HTMLElement = drawn(
      column("Applies To").getElement!(
        budget({ scope: CloudBudgetScope.CostGroup, cloudCostGroupId: null }),
      ),
    );
    expect(
      within(gone).getByTestId("cloud-budget-scope-group-gone"),
    ).toHaveTextContent("Cost group deleted");

    const filter: HTMLElement = drawn(
      column("Applies To").getElement!(
        budget({
          scope: CloudBudgetScope.Filter,
          filterRules: [
            {
              conditions: [
                {
                  field: CloudCostRuleField.Service,
                  operator: CloudCostRuleOperator.Is,
                  values: ["Amazon EC2"],
                },
              ],
            },
          ],
        }),
      ),
    );
    expect(
      within(filter).getByTestId("cloud-budget-scope-filter-cell"),
    ).toHaveTextContent("Filtered costs");
    expect(filter).toHaveTextContent("Amazon EC2");
  });

  test("a row's name and description are the team's own words, each set apart in its own direction", async () => {
    await openBudgets();

    const isolated: Array<string> = Array.from(
      drawn(
        column("Name").getElement!(
          budget({
            name: "Production",
            description: "Every account, before credits.",
          }),
        ),
      ).querySelectorAll("bdi"),
    ).map((element: Element): string => {
      return element.textContent || "";
    });

    expect(isolated).toEqual(["Production", "Every account, before credits."]);
  });

  test("one account's row opens the account's costs", async () => {
    await openBudgets();

    const cell: HTMLElement = drawn(
      column("Applies To").getElement!(
        budget({
          scope: CloudBudgetScope.Account,
          cloudAccountId: new ObjectID("10000000-0000-4000-8000-0000000000b1"),
          cloudAccount: { name: "web-prod" },
        }),
      ),
    );

    expect(
      within(cell).getByRole("link", { name: "web-prod" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        "/cloud/accounts/10000000-0000-4000-8000-0000000000b1/costs",
      ),
    );
  });

  test("paused, or not checked yet: nothing said of where it is heading", async () => {
    await openBudgets();

    const paused: CloudBudget = budget({ isEnabled: false });
    const cell: HTMLElement = drawn(column("This Period").getElement!(paused));
    expect(cell).toHaveTextContent("$4,100 of $5,000");
    expect(cell).not.toHaveTextContent("On course for");
    expect(drawn(column("Status").getElement!(paused))).toHaveTextContent(
      "Paused",
    );

    expect(
      drawn(
        column("This Period").getElement!(budget({ lastCheckedAt: undefined })),
      ),
    ).not.toHaveTextContent("On course for");
  });

  test("an amount reads as it was set, and nothing spent as nothing: $0 of $500, not $0.00 of $500.00", async () => {
    await openBudgets();

    const nothing: HTMLElement = drawn(
      column("This Period").getElement!(
        budget({
          monthlyAmount: 500,
          spentThisMonth: 0,
          projectedThisMonth: 0,
        }),
      ),
    );
    expect(nothing).toHaveTextContent("$0 of $500");
    expect(nothing).not.toHaveTextContent(".00");

    expect(
      drawn(
        column("This Period").getElement!(
          budget({ monthlyAmount: 237.5, spentThisMonth: 203.69 }),
        ),
      ),
    ).toHaveTextContent("$203.69 of $237.50");
  });

  test("Alert At's field refuses what is not a list of percents, rather than alerting at 80% and 100% instead", async () => {
    await openBudgets();

    const alertAt: {
      customValidation?: (values: Record<string, unknown>) => string | null;
    } = (
      lastTable()["formFields"] as Array<{
        title: string;
        customValidation?: (values: Record<string, unknown>) => string | null;
      }>
    ).find((field: { title: string }): boolean => {
      return field.title === "Alert At";
    })!;

    expect(alertAt.customValidation!({ alertThresholds: "80,100" })).toBe(null);
    expect(alertAt.customValidation!({ alertThresholds: "ninety" })).toBe(
      ALERT_AT_NOT_PERCENTS,
    );
  });

  test("a row opens the budget's own page", async () => {
    await openBudgets();

    const onViewPage: (item: CloudBudget) => Promise<Route> = lastTable()[
      "onViewPage"
    ] as (item: CloudBudget) => Promise<Route>;
    const route: Route = await onViewPage(budget());

    expect(route.toString()).toContain(`/cloud/budgets/${BUDGET_ID}`);
  });
});

describe("a budget's form", () => {
  test("Alert At says when it is not a list of percents", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();

    for (const written of ["80,100", "50%, 90%", " 75 ; 100 ", "120"]) {
      expect(getAlertAtProblem(written, translator)).toBe(null);
    }

    for (const written of ["abc", "80, ninety", "0", "1500", " , ", ""]) {
      expect(getAlertAtProblem(written, translator)).toBe(
        ALERT_AT_NOT_PERCENTS,
      );
    }
  });

  test("reads the pick its scope needs from the budget's columns, an account given as a record or an id", () => {
    expect(
      getFormScopeTarget({
        cloudAccountId: { _id: "10000000-0000-4000-8000-0000000000b1" },
        cloudCostGroupId: "10000000-0000-4000-8000-0000000000d1",
        filterRules: [{ conditions: [] }],
      } as never),
    ).toEqual({
      cloudAccountId: "10000000-0000-4000-8000-0000000000b1",
      cloudCostGroupId: "10000000-0000-4000-8000-0000000000d1",
      filterRules: [{ conditions: [] }],
    });
    expect(getFormScopeTarget({} as never)).toEqual({
      cloudAccountId: null,
      cloudCostGroupId: null,
      filterRules: null,
    });
  });

  test("only a yearly budget is typed month by month", () => {
    expect(
      isFormPlanByMonth({
        period: CloudBudgetPeriod.Year,
        planSplit: CloudBudgetPlanSplit.ByMonth,
      } as never),
    ).toBe(true);
    expect(
      isFormPlanByMonth({
        period: CloudBudgetPeriod.Quarter,
        planSplit: CloudBudgetPlanSplit.ByMonth,
      } as never),
    ).toBe(false);
    expect(
      isFormPlanByMonth({
        period: CloudBudgetPeriod.Year,
        planSplit: CloudBudgetPlanSplit.Equal,
      } as never),
    ).toBe(false);
  });

  test("a year's plan is typed in the fiscal year's order, from April, and adds up as it is typed", () => {
    const changes: Array<Array<number>> = [];
    const { rerender } = render(
      <CloudBudgetMonthlyPlanEditor
        value={[1000, 1000]}
        fiscalYearStartMonth={4}
        currency="USD"
        onChange={(plan: Array<number>) => {
          changes.push(plan);
        }}
      />,
    );

    expect(screen.getByLabelText("April amount")).toHaveValue(1000);
    expect(screen.getByLabelText("March amount")).toHaveValue(null);
    expect(screen.getByTestId("cloud-budget-plan-total")).toHaveTextContent(
      "Total: $2,000",
    );

    fireEvent.change(screen.getByLabelText("December amount"), {
      target: { value: "1600" },
    });
    expect(changes[0]).toEqual([1000, 1000, 0, 0, 0, 0, 0, 0, 1600, 0, 0, 0]);

    rerender(
      <CloudBudgetMonthlyPlanEditor
        value={changes[0]!}
        fiscalYearStartMonth={4}
        currency="USD"
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("cloud-budget-plan-total")).toHaveTextContent(
      "Total: $3,600",
    );
    // Anything that is not an amount is nothing.
    expect(toCloudBudgetPlanAmounts(["12.5", "", "abc", -3, 7])).toEqual([
      12.5, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  test("a period in a few words: monthly, quarterly from April, a split year", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();
    const line: (data: Record<string, unknown>) => string = (
      data: Record<string, unknown>,
    ): string => {
      return getCloudBudgetPeriodLine({
        period: data["period"],
        fiscalYearStartMonth: data["fiscalYearStartMonth"],
        planSplit: data["planSplit"],
        translator,
        labels: CLOUD_BUDGET_PERIOD_LABELS,
      });
    };

    expect(line({ period: CloudBudgetPeriod.Month })).toBe("Monthly");
    expect(
      line({ period: CloudBudgetPeriod.Quarter, fiscalYearStartMonth: 4 }),
    ).toBe("Quarterly from April");
    expect(
      line({ period: CloudBudgetPeriod.Year, fiscalYearStartMonth: 1 }),
    ).toBe("Yearly");
    expect(
      line({
        period: CloudBudgetPeriod.Year,
        fiscalYearStartMonth: 1,
        planSplit: CloudBudgetPlanSplit.Equal,
      }),
    ).toBe("Yearly, by month");
  });
});

describe("a budget's months", () => {
  test("each month against its share: over, under, heading over, or no share", () => {
    expect(
      getCloudBudgetMonthState({
        month: "2026-10",
        kind: CloudCostForecastMonthKind.Actual,
        amount: 496,
        planned: 300,
      }),
    ).toBe("over");
    expect(
      getCloudBudgetMonthState({
        month: "2026-09",
        kind: CloudCostForecastMonthKind.Actual,
        amount: 480,
        planned: 500,
      }),
    ).toBe("under");
    expect(
      getCloudBudgetMonthState({
        month: "2026-11",
        kind: CloudCostForecastMonthKind.Current,
        amount: 968,
        spent: 494,
        planned: 400,
      }),
    ).toBe("heading-over");
    expect(
      getCloudBudgetMonthState({
        month: "2026-11",
        kind: CloudCostForecastMonthKind.Current,
        amount: 968,
      }),
    ).toBe("none");
  });

  test("draws each month, this month so far and on course, and the period's total", () => {
    render(
      <CloudBudgetMonths
        currency="USD"
        amount={6000}
        spentThisPeriod={3918}
        months={[
          {
            month: "2026-10",
            kind: CloudCostForecastMonthKind.Actual,
            amount: 496,
            planned: 300,
          },
          {
            month: "2026-11",
            kind: CloudCostForecastMonthKind.Current,
            amount: 968,
            spent: 494,
            planned: 400,
          },
          {
            month: "2026-12",
            kind: CloudCostForecastMonthKind.Forecast,
            amount: 1054,
            planned: 1100,
            low: 900,
            high: 1200,
          },
        ]}
      />,
    );

    expect(document.body).toHaveTextContent("October 2026");
    expect(document.body).toHaveTextContent("Over by $196");
    expect(document.body).toHaveTextContent("$494 so far, on course for $968");
    expect(document.body).toHaveTextContent("Forecast $1,054");
  });
});

describe("Cloud > Forecast", () => {
  test("the scope picked, as the API reads it: nothing to read until a pick is made", () => {
    expect(
      toCloudCostForecastAsk({
        scope: "all",
        accountId: null,
        groupId: null,
        service: null,
      }),
    ).toEqual({ scope: CloudBudgetScope.AllAccounts });
    expect(
      toCloudCostForecastAsk({
        scope: "account",
        accountId: null,
        groupId: null,
        service: null,
      }),
    ).toBeNull();
    expect(
      toCloudCostForecastAsk({
        scope: "group",
        accountId: null,
        groupId: "10000000-0000-4000-8000-0000000000d1",
        service: null,
      }),
    ).toEqual({
      scope: CloudBudgetScope.CostGroup,
      cloudCostGroupId: new ObjectID("10000000-0000-4000-8000-0000000000d1"),
    });
    // A service is a filter of one condition.
    expect(
      toCloudCostForecastAsk({
        scope: "service",
        accountId: null,
        groupId: null,
        service: "Amazon EC2",
      }),
    ).toEqual({
      scope: CloudBudgetScope.Filter,
      filterRules: [
        {
          conditions: [
            {
              field: CloudCostRuleField.Service,
              operator: CloudCostRuleOperator.Is,
              values: ["Amazon EC2"],
            },
          ],
        },
      ],
    });
  });

  test("what the API is sent: the scope's own fields, the basis, the what-if", () => {
    expect(
      CloudBudgetReads.toCloudCostForecastBody({
        scope: CloudBudgetScope.CostGroup,
        cloudCostGroupId: new ObjectID("10000000-0000-4000-8000-0000000000d1"),
        currency: "USD",
        basis: CloudCostBasis.Net,
        growth: { percent: 20, fromMonth: "2027-01" },
      }),
    ).toMatchObject({
      scope: CloudBudgetScope.CostGroup,
      cloudCostGroupId: "10000000-0000-4000-8000-0000000000d1",
      currency: "USD",
      basis: CloudCostBasis.Net,
      growth: { percent: 20, fromMonth: "2027-01" },
    });
  });

  test("a what-if starts from a month the forecast holds ahead", () => {
    expect(
      getWhatIfMonthOptions(forecast(), getGlobalTranslator()).map(
        (option: { label: string; value: unknown }) => {
          return [option.value, option.label];
        },
      ),
    ).toEqual([
      ["2026-12", "December 2026"],
      ["2027-01", "January 2027"],
    ]);
  });

  test("the chart: what was spent, the rest of this month on course, and the months forecast", () => {
    const series: ReturnType<typeof getCloudForecastChartSeries> =
      getCloudForecastChartSeries({
        months: forecast().months,
        names: { spent: "Spent", onCourse: "On course", forecast: "Forecast" },
      });

    expect(
      series.map(
        (entry: { seriesName: string; data: Array<{ y: number }> }) => {
          return [
            entry.seriesName,
            entry.data.map((point: { y: number }): number => {
              return point.y;
            }),
          ];
        },
      ),
    ).toEqual([
      ["Spent", [496, 494, 0, 0]],
      ["On course", [0, 474, 0, 0]],
      ["Forecast", [0, 0, 1054, 500]],
    ]);
  });

  test("how a forecast was made, and how sure: no range claimed from too little history", () => {
    const translator: ReturnType<typeof getGlobalTranslator> =
      getGlobalTranslator();

    expect(getCloudForecastMethodSentence(forecast(), translator)).toBe(
      "The trend of the last 12 full months, and how far each month of the last year ran above or below it. A year shows each month once, so a month's peak is expected to come back as it was.",
    );

    render(
      <CloudForecastHowMade
        forecast={forecast({
          method: CloudCostForecastMethod.Pace,
          monthsOfHistory: 1,
        })}
      />,
    );
    const howMade: HTMLElement = screen.getByTestId("cloud-forecast-how-made");
    expect(howMade).toHaveAttribute(
      "data-method",
      CloudCostForecastMethod.Pace,
    );
    expect(howMade).toHaveTextContent("Last week's pace");
    // One month, in the singular.
    expect(howMade).toHaveTextContent("Made from 1 full month");
    expect(howMade).not.toHaveTextContent("Made from 1 full months");
    expect(howMade).not.toHaveTextContent("The likely range holds");
  });

  test("the page: the next twelve months with their range, next month, this month so far, and the trend", async () => {
    const read: jest.SpyInstance<any, any> = getJestSpyOn(
      CloudBudgetReads,
      "fetchCloudCostForecast",
    ).mockResolvedValue(forecastResult(forecast()));

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudForecastPage {...pageProps} />
        </MemoryRouter>,
      );
    });

    expect(read).toHaveBeenCalledWith({
      scope: CloudBudgetScope.AllAccounts,
      currency: "USD",
      basis: "amortized",
    });

    const strip: HTMLElement = await screen.findByTestId(
      "cloud-forecast-strip",
    );
    expect(strip).toHaveTextContent("$1,554");
    expect(strip).toHaveTextContent("$1,350 to $1,750");
    expect(strip).toHaveTextContent("$1,054");
    expect(strip).toHaveTextContent("$494 so far");
    expect(strip).toHaveTextContent("+$15 a month");

    // The what-if is one sentence, its month and its percent in it.
    const whatIf: HTMLElement = screen.getByTestId("cloud-forecast-what-if");
    expect(whatIf).toHaveTextContent("Every month from");
    expect(
      within(whatIf).getByTestId("cloud-forecast-growth-percent"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("cloud-forecast-growth-applied")).toBeNull();

    expect(mockChartSeries).not.toHaveLength(0);
  });

  test("a scope with too little history says there is no range, and a scope with nothing read says so", async () => {
    jest
      .spyOn(CloudBudgetReads, "fetchCloudCostForecast")
      .mockResolvedValueOnce(
        forecastResult(
          forecast({
            method: CloudCostForecastMethod.Pace,
            monthsOfHistory: 1,
            months: [
              {
                month: "2026-11",
                kind: CloudCostForecastMonthKind.Current,
                amount: 90,
                spent: 57,
              },
              {
                month: "2026-12",
                kind: CloudCostForecastMonthKind.Forecast,
                amount: 93,
              },
            ],
          }),
        ),
      );

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudForecastPage {...pageProps} />
        </MemoryRouter>,
      );
    });

    expect(await screen.findByTestId("cloud-forecast-strip")).toHaveTextContent(
      "No range: too little history",
    );

    cleanup();
    jest
      .spyOn(CloudBudgetReads, "fetchCloudCostForecast")
      .mockResolvedValueOnce(
        forecastResult(
          forecast({
            method: CloudCostForecastMethod.Pace,
            monthsOfHistory: 0,
            months: [
              {
                month: "2026-11",
                kind: CloudCostForecastMonthKind.Current,
                amount: 0,
                spent: 0,
              },
              {
                month: "2026-12",
                kind: CloudCostForecastMonthKind.Forecast,
                amount: 0,
              },
            ],
          }),
        ),
      );

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudForecastPage {...pageProps} />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByTestId("cloud-forecast-empty"),
    ).toBeInTheDocument();
  });

  test("a cost group or a service is read only once one is picked", async () => {
    const read: jest.SpyInstance<any, any> = getJestSpyOn(
      CloudBudgetReads,
      "fetchCloudCostForecast",
    ).mockResolvedValue(forecastResult(forecast()));

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudForecastPage {...pageProps} />
        </MemoryRouter>,
      );
    });

    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "A cost group" }));
    });

    expect(screen.getByTestId("cloud-forecast-pick")).toHaveTextContent(
      "Choose what to forecast.",
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("saved as a yearly budget's plan: the forecast's scope, basis and twelve months, and their total", () => {
    const made: CloudBudget = toPlannedBudget({
      ask: {
        scope: CloudBudgetScope.CostGroup,
        cloudCostGroupId: new ObjectID("10000000-0000-4000-8000-0000000000d1"),
        basis: CloudCostBasis.Amortized,
      },
      name: "  Payments next year  ",
      currency: "USD",
      fiscalYearStartMonth: 4,
      plan: [500, 500, 500, 500, 500, 500, 500, 500, 1054, 500, 500, 500],
    });

    expect(made.name).toBe("Payments next year");
    expect(made.scope).toBe(CloudBudgetScope.CostGroup);
    expect(made.cloudCostGroupId?.toString()).toBe(
      "10000000-0000-4000-8000-0000000000d1",
    );
    expect(made.period).toBe(CloudBudgetPeriod.Year);
    expect(made.fiscalYearStartMonth).toBe(4);
    expect(made.planSplit).toBe(CloudBudgetPlanSplit.ByMonth);
    expect(made.monthlyAmount).toBe(6554);
    expect(made.costBasis).toBe(CloudCostBasis.Amortized);
    expect(made.isEnabled).toBe(true);
  });
});
