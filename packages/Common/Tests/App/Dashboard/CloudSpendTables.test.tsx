import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The lists of Cloud's Spend section - Savings' ways to spend less and
 * Budgets - with ModelTable captured instead of rendered, so what each
 * hands it is under test:
 *
 *   - Savings: read only, the largest saving first, over every account or
 *     one; each row says what to do, to what (its resource's page when
 *     OneUptime holds it), what would change and what it saves a month in
 *     its own currency; the strip above, or what each cloud needs before
 *     any is read; the accounts whose recommendations are not read.
 *   - Budgets: created in two steps (what a month may cost and for which
 *     account; when to alert), the currency most accounts are billed in
 *     and 80% and 100% to start with; each row says what the month has
 *     cost against it, where it is heading and how it is doing.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    // A mark where the table is drawn, so a page's order can be read.
    default: (props: Record<string, unknown>): React.ReactElement => {
      mockCapturedTableProps.push(props);
      return react.createElement("div", {
        "data-testid": "captured-model-table",
        "data-table-id": props["id"],
      });
    },
  };
});

import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudCostState,
  CloudSavingKind,
} from "../../../Types/Cloud/CloudCost";
import { CloudCommitmentKind } from "../../../Types/Cloud/CloudCommitments";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudSavingsTable, {
  getSavingChangeText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSavingsTable";
import CloudBudgets, {
  ALERT_AT_NOT_PERCENTS,
  ALL_ACCOUNTS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Budgets";
import CloudSavings from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Savings";
import { SAVINGS_GAPS_NONE_READ_DESCRIPTION } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostGapsCard";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

interface CapturedColumn<T> {
  title: string;
  field: Record<string, unknown>;
  getElement?: (item: T) => React.ReactElement;
  isHiddenByDefault?: boolean;
}

interface CapturedFormField {
  title: string;
  stepId?: string;
  required?: boolean;
  collapsibleSection?: unknown;
  customValidation?: (values: Record<string, unknown>) => string | null;
  defaultValue?: unknown;
}

const ACCOUNT_ROW: string = "10000000-0000-4000-8000-0000000000b1";
const RESOURCE_ROW: string = "10000000-0000-4000-8000-0000000000c1";

const pageProps: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/cloud/savings`),
  currentProject: null,
  hasPaymentMethod: true,
};

let accountsForTest: Array<CloudAccount> = [];

function account(overrides: Partial<CloudAccount> = {}): CloudAccount {
  const model: CloudAccount = new CloudAccount();
  Object.assign(model, {
    _id: ACCOUNT_ROW,
    name: "web-prod",
    provider: "aws",
    accountId: "123456789012",
    lastSeenAt: new Date(),
    cloudConnectionId: new ObjectID(ACCOUNT_ROW),
    costSummary: {
      state: CloudCostState.Reading,
      currency: "EUR",
      monthToDate: 100,
      lastMonth: 0,
      monthFullDays: 100,
      lastMonthToDate: 0,
      projectedMonth: 0,
      last30Days: 0,
      topServices: [],
      readAt: new Date().toISOString(),
    },
    ...overrides,
  });
  return model;
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  goTo(`/dashboard/${PROJECT_ID}/cloud/savings`);
  accountsForTest = [account()];

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return {
        data: accountsForTest,
        count: accountsForTest.length,
        skip: 0,
        limit: 100,
      };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function lastTable(): Record<string, unknown> {
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function column<T>(title: string): CapturedColumn<T> {
  return (lastTable()["columns"] as Array<CapturedColumn<T>>).find(
    (entry: CapturedColumn<T>): boolean => {
      return entry.title === title;
    },
  )!;
}

function titles(key: "columns" | "filters" | "formFields"): Array<string> {
  return (lastTable()[key] as Array<{ title: string }>).map(
    (entry: { title: string }): string => {
      return entry.title;
    },
  );
}

function drawn(element: React.ReactElement): HTMLElement {
  return render(<MemoryRouter>{element}</MemoryRouter>).container;
}

// A recommendation as the API answers it: its stored columns, typed loosely.
function recommendation(
  overrides: Record<string, unknown> = {},
): CloudCostRecommendation {
  const model: CloudCostRecommendation = new CloudCostRecommendation();
  Object.assign(model, {
    _id: "10000000-0000-4000-8000-0000000000f1",
    action: "Rightsize",
    kind: CloudSavingKind.Rightsize,
    resourceName: "web-1",
    resourceType: "EC2 instance",
    region: "us-east-1",
    currentConfiguration: "m5.2xlarge",
    recommendedConfiguration: "m5.xlarge",
    monthlySavings: 61.33,
    currency: "USD",
    cloudResourceId: new ObjectID(RESOURCE_ROW),
    cloudAccountId: new ObjectID(ACCOUNT_ROW),
    cloudAccount: { name: "web-prod" },
    ...overrides,
  });
  return model;
}

describe("the ways to spend less, as a table", () => {
  test("read only, the largest saving first, every account's", async () => {
    await act(async () => {
      render(<CloudSavingsTable id="savings" currency="USD" />);
    });

    expect(lastTable()).toMatchObject({
      modelType: CloudCostRecommendation,
      isCreateable: false,
      isEditable: false,
      isDeleteable: false,
      sortBy: "monthlySavings",
      sortOrder: SortOrder.Descending,
      query: {},
    });
    /*
     * Read left to right as a person says it: what to do (and what it
     * changes), to which resource, what it saves, in which account. The kind
     * only said the action's word again: it waits in the column picker, and
     * stays a filter.
     */
    expect(titles("columns")).toEqual([
      "Recommendation",
      "Resource",
      "Monthly Savings",
      "Account",
      "Kind",
      "Source",
      "Effort",
    ]);
    expect(titles("columns")).not.toContain("Change");
    expect(titles("columns")).not.toContain("Saves a Month");
    for (const hidden of ["Kind", "Source", "Effort"]) {
      expect(column<CloudCostRecommendation>(hidden).isHiddenByDefault).toBe(
        true,
      );
    }
    for (const shown of [
      "Recommendation",
      "Resource",
      "Monthly Savings",
      "Account",
    ]) {
      expect(
        column<CloudCostRecommendation>(shown).isHiddenByDefault,
      ).toBeFalsy();
    }
    // What it changes is read with the row, for the Recommendation cell.
    expect(lastTable()["selectMoreFields"]).toMatchObject({
      currentConfiguration: true,
      recommendedConfiguration: true,
    });
    expect(titles("filters")).toEqual([
      "Kind",
      "Account",
      "Cloud",
      "Resource",
      "Region",
    ]);
  });

  test("one account's: its own, without its name in every row", async () => {
    await act(async () => {
      render(
        <CloudSavingsTable
          id="savings"
          currency="USD"
          cloudAccountId={new ObjectID(ACCOUNT_ROW)}
        />,
      );
    });

    expect(lastTable()["query"]).toEqual({
      cloudAccountId: new ObjectID(ACCOUNT_ROW),
    });
    expect(titles("columns")).not.toContain("Account");
    expect(titles("filters")).toEqual(["Kind", "Resource", "Region"]);
  });

  test("a row: what to do and what it changes, to which resource (its page), where, and what it saves in its own currency", async () => {
    await act(async () => {
      render(<CloudSavingsTable id="savings" currency="EUR" />);
    });

    // What to do, and under it what it changes - a phone shows both.
    const what: HTMLElement = drawn(
      column<CloudCostRecommendation>("Recommendation").getElement!(
        recommendation(),
      ),
    );
    expect(what).toHaveTextContent("Rightsize");
    expect(within(what).getByTestId("cloud-saving-change")).toHaveTextContent(
      "m5.2xlarge → m5.xlarge",
    );
    // The resource is a column of its own, not in this cell.
    expect(within(what).queryByRole("link")).toBeNull();
    expect(what).not.toHaveTextContent("web-1");

    // Nothing to change said: the action alone.
    const idle: HTMLElement = drawn(
      column<CloudCostRecommendation>("Recommendation").getElement!(
        recommendation({
          action: "Delete",
          currentConfiguration: "",
          recommendedConfiguration: "",
        }),
      ),
    );
    expect(idle).toHaveTextContent("Delete");
    expect(within(idle).queryByTestId("cloud-saving-change")).toBeNull();

    // To which resource: its page, its type and Region under it.
    const resource: HTMLElement = drawn(
      column<CloudCostRecommendation>("Resource").getElement!(recommendation()),
    );
    expect(
      within(resource).getByRole("link", { name: "web-1" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/${RESOURCE_ROW}`),
    );
    expect(resource).toHaveTextContent("EC2 instance · us-east-1");

    // A resource OneUptime does not hold: its name, not a link.
    const unheld: HTMLElement = drawn(
      column<CloudCostRecommendation>("Resource").getElement!(
        recommendation({ cloudResourceId: undefined, resourceName: "vm-9" }),
      ),
    );
    expect(within(unheld).queryByRole("link")).toBeNull();
    expect(unheld).toHaveTextContent("vm-9");

    expect(
      drawn(
        column<CloudCostRecommendation>("Monthly Savings").getElement!(
          recommendation(),
        ),
      ),
    ).toHaveTextContent("$61.33");
    // A row that names no currency is in the page's.
    expect(
      drawn(
        column<CloudCostRecommendation>("Monthly Savings").getElement!(
          recommendation({ currency: undefined }),
        ),
      ),
    ).toHaveTextContent("€61.33");
    expect(
      drawn(
        column<CloudCostRecommendation>("Kind").getElement!(recommendation()),
      ),
    ).toHaveTextContent("Rightsize");
    expect(
      within(
        drawn(
          column<CloudCostRecommendation>("Account").getElement!(
            recommendation(),
          ),
        ),
      ).getByRole("link", { name: "web-prod" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/accounts/${ACCOUNT_ROW}/costs`),
    );
  });

  test("what would change, as the recommender says it", () => {
    expect(getSavingChangeText(recommendation(), "en")).toBe(
      "m5.2xlarge → m5.xlarge",
    );
    expect(
      getSavingChangeText(
        recommendation({
          recommendedConfiguration: " ",
          currentConfiguration: "Idle for 14 days",
        }),
        "en",
      ),
    ).toBe("Idle for 14 days");
    expect(
      getSavingChangeText(
        recommendation({
          currentConfiguration: "",
          recommendedConfiguration: "",
        }),
        "en",
      ),
    ).toBe("");
  });

  test("on a page read from the right, the arrow points on from what runs now", () => {
    expect(
      withoutIsolateMarks(getSavingChangeText(recommendation(), "fa")),
    ).toBe("m5.2xlarge ← m5.xlarge");
  });
});

describe("Cloud > Savings", () => {
  test("what could be saved, by way, over the table - in the currency the costs are in", async () => {
    accountsForTest = [
      account({
        savingsSummary: {
          state: CloudCostState.Reading,
          count: 4,
          monthlySavings: 420,
          byKind: {
            [CloudSavingKind.Idle]: { count: 4, monthlySavings: 420 },
          },
          currency: "EUR",
          readAt: new Date().toISOString(),
        },
      }),
    ];

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudSavings {...pageProps} />
        </MemoryRouter>,
      );
    });

    const strip: HTMLElement = await screen.findByTestId("cloud-savings-strip");
    expect(strip).toHaveTextContent("€420.00");
    expect(strip).toHaveTextContent("4 recommendations");
    expect(screen.queryByTestId("cloud-savings-not-read")).toBeNull();
    expect(lastTable()).toMatchObject({ id: "cloud-savings-table" });
    expect(screen.queryByTestId("cloud-savings-gaps")).toBeNull();
  });

  test("before any is read: what each cloud needs, and the account waiting for its first read", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <CloudSavings {...pageProps} />
        </MemoryRouter>,
      );
    });

    const steps: HTMLElement = await screen.findByTestId(
      "cloud-savings-not-read",
    );
    expect(steps).toHaveTextContent("Cost Optimization Hub");
    expect(screen.queryByTestId("cloud-savings-strip")).toBeNull();

    const gaps: Array<HTMLElement> = within(
      screen.getByTestId("cloud-savings-gaps"),
    ).getAllByTestId("cloud-cost-gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toHaveAttribute("data-reason", "waiting");
    // Nothing read yet: no figures to be left out of.
    expect(
      screen.getByText(SAVINGS_GAPS_NONE_READ_DESCRIPTION),
    ).toBeInTheDocument();
  });

  test("one not allowed to read them says so, with what to do", async () => {
    accountsForTest = [
      account({
        savingsSummary: {
          state: CloudCostState.NotAllowed,
          message:
            "User is not authorized to perform cost-optimization-hub:ListRecommendations",
          count: 0,
          monthlySavings: 0,
          byKind: {},
          currency: "USD",
          readAt: new Date().toISOString(),
        },
      }),
    ];

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudSavings {...pageProps} />
        </MemoryRouter>,
      );
    });

    const gap: HTMLElement = await screen.findByTestId("cloud-cost-gap");
    expect(gap).toHaveAttribute("data-reason", CloudCostState.NotAllowed);
    expect(gap).toHaveTextContent("cost-optimization-hub:ListRecommendations");
    expect(gap).toHaveTextContent("Cost Optimization Hub");
  });

  test("each account's commitments, under the ways to spend less: the page's own list first", async () => {
    accountsForTest = [
      account({
        savingsSummary: {
          state: CloudCostState.Reading,
          count: 1,
          monthlySavings: 40,
          byKind: {
            [CloudSavingKind.Commitment]: { count: 1, monthlySavings: 40 },
          },
          currency: "EUR",
          commitments: {
            state: CloudCostState.Reading,
            currency: "EUR",
            days: 30,
            kinds: [
              {
                kind: CloudCommitmentKind.SavingsPlans,
                coveredSpend: 600,
                onDemandSpend: 400,
                commitmentSpend: 500,
                unusedSpend: 25,
              },
            ],
            readAt: new Date().toISOString(),
          },
          readAt: new Date().toISOString(),
        },
      }),
    ];

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudSavings {...pageProps} />
        </MemoryRouter>,
      );
    });

    const card: HTMLElement = await screen.findByTestId("cloud-commitments");
    expect(card).toHaveTextContent("web-prod");
    expect(card).toHaveTextContent("Savings Plans");
    expect(card).toHaveTextContent("Covers 60%");
    expect(card).toHaveTextContent("€25.00 unused");

    /*
     * The strip, the ways to spend less it sums up, then the commitments:
     * what the page is for comes first.
     */
    const table: HTMLElement = screen.getByTestId("captured-model-table");
    expect(table).toHaveAttribute("data-table-id", "cloud-savings-table");
    expect(
      screen.getByTestId("cloud-savings-strip").compareDocumentPosition(table) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      table.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the accounts whose recommendations are not read close the page, after the commitments", async () => {
    accountsForTest = [
      account({
        _id: ACCOUNT_ROW,
        savingsSummary: {
          state: CloudCostState.Reading,
          count: 1,
          monthlySavings: 40,
          byKind: {},
          currency: "USD",
          commitments: {
            state: CloudCostState.NotAllowed,
            message:
              "The role may not read Savings Plans and Reserved Instances from Cost Explorer.",
            currency: "USD",
            days: 30,
            kinds: [],
            readAt: new Date().toISOString(),
          },
          readAt: new Date().toISOString(),
        },
      }),
      account({
        _id: RESOURCE_ROW,
        name: "data-lake",
        savingsSummary: {
          state: CloudCostState.NotAllowed,
          message:
            "User is not authorized to perform cost-optimization-hub:ListRecommendations",
          count: 0,
          monthlySavings: 0,
          byKind: {},
          currency: "USD",
          readAt: new Date().toISOString(),
        },
      }),
    ];

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudSavings {...pageProps} />
        </MemoryRouter>,
      );
    });

    const card: HTMLElement = await screen.findByTestId("cloud-commitments");
    const gaps: HTMLElement = screen.getByTestId("cloud-savings-gaps");

    // web-prod's commitments are refused: what to do, with its cloud's guide.
    expect(within(card).getByTestId("cloud-commitment-step")).toHaveTextContent(
      "Run the connection's setup command again: it lets the connection read Savings Plans and Reserved Instances.",
    );
    expect(
      card.compareDocumentPosition(gaps) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(gaps).toHaveTextContent("data-lake");
  });

  test("no account's commitments read: no Commitments card", async () => {
    await act(async () => {
      render(
        <MemoryRouter>
          <CloudSavings {...pageProps} />
        </MemoryRouter>,
      );
    });

    await screen.findByTestId("cloud-savings-not-read");
    expect(screen.queryByTestId("cloud-commitments")).toBeNull();
  });
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

  test("created in two steps, in the currency most accounts are billed in, alerting at 80% and 100%", async () => {
    await openBudgets();

    expect(lastTable()).toMatchObject({
      modelType: CloudBudget,
      id: "cloud-budgets-table",
      isCreateable: true,
      isEditable: true,
      isDeleteable: true,
      rowSwitch: { column: "isEnabled" },
      createInitialValues: {
        currency: "EUR",
        alertThresholds: "80,100",
        alertOnProjection: true,
        alertOnAnomaly: true,
        isEnabled: true,
      },
    });
    expect(
      (lastTable()["formSteps"] as Array<{ id: string }>).map(
        (step: { id: string }) => {
          return step.id;
        },
      ),
    ).toEqual(["budget", "alerts"]);

    const fields: Array<CapturedFormField> = lastTable()[
      "formFields"
    ] as Array<CapturedFormField>;
    const byStep: (stepId: string) => Array<string> = (
      stepId: string,
    ): Array<string> => {
      return fields
        .filter((field: CapturedFormField): boolean => {
          return field.stepId === stepId;
        })
        .map((field: CapturedFormField): string => {
          return field.title;
        });
    };

    expect(byStep("budget")).toEqual([
      "Name",
      "Monthly Amount",
      "Account",
      "Currency",
      "Description",
    ]);
    expect(byStep("alerts")).toEqual([
      "Alert At",
      "Alert When On Course To Pass",
      "Alert On Unusual Days",
      "Alert Severity",
      "On-Call Policies",
    ]);
    // A day that cost far more than usual alerts unless turned off.
    const unusualDays: CapturedFormField | undefined = fields.find(
      (field: CapturedFormField): boolean => {
        return field.title === "Alert On Unusual Days";
      },
    );
    expect(unusualDays?.defaultValue).toBe(true);
    // The currency and a description wait under More fields.
    expect(
      fields
        .filter((field: CapturedFormField): boolean => {
          return Boolean(field.collapsibleSection);
        })
        .map((field: CapturedFormField): string => {
          return field.title;
        }),
    ).toEqual(["Currency", "Description"]);
    expect(titles("columns")).toEqual([
      "Name",
      "Applies To",
      "This Month",
      "Status",
    ]);
  });

  test("a row: what the month has cost against it, where it is heading, how it is doing", async () => {
    await openBudgets();

    const budget: CloudBudget = new CloudBudget();
    Object.assign(budget, {
      _id: "10000000-0000-4000-8000-0000000000d1",
      name: "Production",
      monthlyAmount: 5000,
      currency: "USD",
      spentThisMonth: 4100,
      projectedThisMonth: 6200,
      alertThresholds: "80,100",
      lastCheckedAt: new Date(),
      isEnabled: true,
    });

    const month: HTMLElement = drawn(
      column<CloudBudget>("This Month").getElement!(budget),
    );
    expect(month).toHaveTextContent("$4,100 of $5,000");
    expect(month).toHaveTextContent("On course for $6,200");

    const status: HTMLElement = drawn(
      column<CloudBudget>("Status").getElement!(budget),
    );
    expect(within(status).getByTestId("cloud-budget-status")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(status).toHaveTextContent("Passed 80%");

    expect(
      drawn(column<CloudBudget>("Applies To").getElement!(budget)),
    ).toHaveTextContent(ALL_ACCOUNTS);

    /*
     * Its name and description are the team's own words, each set apart
     * in its own direction: on a Persian page an English description keeps
     * its full stop at its end.
     */
    budget.description = "Every account, before credits.";
    const isolated: Array<string> = Array.from(
      drawn(column<CloudBudget>("Name").getElement!(budget)).querySelectorAll(
        "bdi",
      ),
    ).map((element: Element): string => {
      return element.textContent || "";
    });
    expect(isolated).toEqual(["Production", "Every account, before credits."]);

    budget.cloudAccountId = new ObjectID(ACCOUNT_ROW);
    budget.cloudAccount = { name: "web-prod" } as CloudAccount;
    expect(
      within(
        drawn(column<CloudBudget>("Applies To").getElement!(budget)),
      ).getByRole("link", { name: "web-prod" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/accounts/${ACCOUNT_ROW}/costs`),
    );

    // Paused: no longer checked, so what it last said of the month is old.
    budget.isEnabled = false;
    const paused: HTMLElement = drawn(
      column<CloudBudget>("This Month").getElement!(budget),
    );
    expect(paused).toHaveTextContent("$4,100 of $5,000");
    expect(paused).not.toHaveTextContent("On course for");
    expect(
      drawn(column<CloudBudget>("Status").getElement!(budget)),
    ).toHaveTextContent("Paused");
    budget.isEnabled = true;

    // Not checked yet: nothing said of where it is heading.
    Object.assign(budget, { lastCheckedAt: undefined });
    expect(
      drawn(column<CloudBudget>("This Month").getElement!(budget)),
    ).not.toHaveTextContent("On course for");
  });

  test("a budget's amount reads as it was set, and nothing spent as nothing: $0 of $500, not $0.00 of $500.00", async () => {
    await openBudgets();

    const budget: CloudBudget = new CloudBudget();
    Object.assign(budget, {
      _id: "10000000-0000-4000-8000-0000000000d2",
      name: "Sandbox",
      monthlyAmount: 500,
      currency: "USD",
      spentThisMonth: 0,
      projectedThisMonth: 0,
      alertThresholds: "80,100",
      isEnabled: true,
    });

    const nothing: HTMLElement = drawn(
      column<CloudBudget>("This Month").getElement!(budget),
    );
    expect(nothing).toHaveTextContent("$0 of $500");
    expect(nothing).not.toHaveTextContent(".00");

    // A spend in cents keeps them; a budget with cents keeps its own.
    Object.assign(budget, { spentThisMonth: 203.69, monthlyAmount: 237.5 });
    expect(
      drawn(column<CloudBudget>("This Month").getElement!(budget)),
    ).toHaveTextContent("$203.69 of $237.50");
  });

  test("Alert At says when it is not a list of percents, rather than the budget alerting at 80% and 100% instead", async () => {
    await openBudgets();

    const alertAt: CapturedFormField = (
      lastTable()["formFields"] as Array<CapturedFormField>
    ).find((field: CapturedFormField): boolean => {
      return field.title === "Alert At";
    })!;
    expect(alertAt.customValidation).toBeDefined();

    // As people write them: commas, spaces, percent signs.
    for (const written of ["80,100", "50%, 90%", " 75 ; 100 ", "120"]) {
      expect(alertAt.customValidation!({ alertThresholds: written })).toBe(
        null,
      );
    }

    // Not a percent, out of 1 to 1000, or nothing at all: said.
    for (const written of ["abc", "80, ninety", "0", "1500", " , ", ""]) {
      expect(alertAt.customValidation!({ alertThresholds: written })).toBe(
        ALERT_AT_NOT_PERCENTS,
      );
    }
  });
});
