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
import CloudCostGroup from "../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostView from "../../../Models/DatabaseModels/CloudCostView";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationInterval,
  CloudCostAllocationResult,
  CloudCostAllocationUnallocated,
  CloudCostSharedSplit,
  CloudCostViewGrouping,
} from "../../../Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostRule,
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "../../../Types/Cloud/CloudCostRules";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import Toast from "../../../UI/Utils/Toast";
import { createTranslator } from "../../../Types/Translator";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudCostBreakdownCard from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBreakdownCard";
import { CloudAccountRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts";
import CloudCostAddToGroupModal from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostAddToGroupModal";
import {
  getGroupChangeHint,
  toCloudCostAllocationCsv,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostGroupFigures";
import { NEVER_MATCHES } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostGroupWords";
import { percentagesAddUp } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostPercentagesEditor";
import CloudCostQuickStart from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostQuickStart";
import CloudCostRuleEditor, {
  CloudCostRuleOptions,
  changeConditionField,
  getRuleEditorProblem,
  newCloudCostCondition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostRuleEditor";
import CloudCostRuleSummary, {
  CloudCostRuleNames,
  emptyCloudCostRuleNames,
  getCloudCostValueText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostRuleSummary";
import CloudCostUnallocatedCard from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CostGroups/CloudCostUnallocatedCard";
import { CloudCostState } from "../../../Types/Cloud/CloudCost";

/*
 * COST GROUPS IN THE DASHBOARD (#11006), with the network stubbed: a
 * group's rules read as sentences, written in the rule editor, what no
 * rule matches listed with Add to Group, a rule started from it, the first
 * view made in one click, a view's figures as change hints and a CSV, and
 * the Costs page's "Cost groups" breakdown.
 */

const PROJECT: ObjectID = new ObjectID(PROJECT_ID);
const ACCOUNT: string = "10000000-0000-4000-8000-0000000000b1";
const PAYMENTS_TEAM: string = "10000000-0000-4000-8000-0000000000d1";
const VIEW: string = "10000000-0000-4000-8000-0000000000f1";
const PAYMENTS: string = "10000000-0000-4000-8000-0000000000c1";
const SEARCH: string = "10000000-0000-4000-8000-0000000000c2";
const MADE: string = "10000000-0000-4000-8000-0000000000c3";
const NOW: Date = new Date("2026-11-20T15:00:00.000Z");

const ENGLISH: ReturnType<typeof createTranslator> = createTranslator(
  undefined,
  "en",
);

function names(): CloudCostRuleNames {
  const built: CloudCostRuleNames = emptyCloudCostRuleNames();
  built.accounts.set(ACCOUNT, "Production AWS");
  built.teams.set(PAYMENTS_TEAM, "Payments");
  return built;
}

const OPTIONS: CloudCostRuleOptions = {
  tagKeys: ["team", "env"],
  services: ["Amazon EC2", "Amazon S3"],
  regions: ["us-east-1"],
  loadTagValues: async (): Promise<Array<string>> => {
    return ["payments", "search"];
  },
};

function group(data: {
  id: string;
  name: string;
  rules?: Array<CloudCostRule>;
  automaticKey?: string;
}): CloudCostGroup {
  const made: CloudCostGroup = new CloudCostGroup();
  made._id = data.id;
  made.name = data.name;
  made.rules = data.rules || [];

  if (data.automaticKey) {
    made.automaticKey = data.automaticKey;
  }

  return made;
}

function groupResult(
  overrides: Partial<CloudCostAllocationGroupResult> & { id: string },
): CloudCostAllocationGroupResult {
  return {
    name: "",
    order: 1,
    isShared: false,
    cloud: 0,
    lineItems: 0,
    sharedIn: 0,
    sharedOut: 0,
    total: 0,
    series: [],
    ...overrides,
  };
}

function unallocated(
  overrides: Partial<CloudCostAllocationUnallocated> = {},
): CloudCostAllocationUnallocated {
  return {
    cloud: 0,
    lineItems: 0,
    total: 0,
    series: [],
    topServices: [],
    topAccounts: [],
    topTagValues: [],
    topOwnerTeams: [],
    ...overrides,
  };
}

function allocation(
  overrides: Partial<CloudCostAllocationResult> = {},
): CloudCostAllocationResult {
  return {
    viewId: VIEW,
    viewName: "By team",
    currency: "USD",
    interval: CloudCostAllocationInterval.Day,
    start: "2026-11-01",
    lastDay: "2026-11-20",
    buckets: [],
    cloud: 1000,
    lineItems: 0,
    total: 1000,
    groups: [],
    unallocated: unallocated(),
    readAt: NOW.toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/cost-groups`);
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a group's rules, read as sentences", () => {
  test("each condition a sentence, rules joined by or, records by their names", () => {
    render(
      <CloudCostRuleSummary
        rules={[
          {
            conditions: [
              {
                field: CloudCostRuleField.Tag,
                key: "team",
                operator: CloudCostRuleOperator.Is,
                values: ["payments", "billing"],
              },
            ],
          },
          {
            conditions: [
              {
                field: CloudCostRuleField.Account,
                operator: CloudCostRuleOperator.Is,
                values: [ACCOUNT],
              },
              {
                field: CloudCostRuleField.Service,
                operator: CloudCostRuleOperator.Contains,
                values: ["EC2"],
              },
            ],
          },
          {
            conditions: [
              {
                field: CloudCostRuleField.OwnerTeam,
                operator: CloudCostRuleOperator.IsNot,
                values: ["10000000-0000-4000-8000-00000000dead"],
              },
            ],
          },
        ]}
        names={names()}
      />,
    );

    const conditions: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-cost-condition",
    );

    expect(
      conditions.map((condition: HTMLElement) => {
        return condition.textContent;
      }),
    ).toEqual([
      "Tag team is paymentsorbilling",
      "Account is Production AWS",
      "Service contains EC2",
      "Owner team is not No longer in this project",
    ]);
    expect(screen.getByTestId("cloud-cost-rule-summary").textContent).toContain(
      "Or",
    );
  });

  test("a group with no rules says it takes nothing", () => {
    render(<CloudCostRuleSummary rules={[]} names={names()} />);

    expect(
      screen.getByTestId("cloud-cost-rule-summary-empty").textContent,
    ).toBe("No rules yet: this group takes nothing.");
  });

  test("a value reads as its record's name, its cloud's name, or as written", () => {
    expect(
      getCloudCostValueText({
        field: CloudCostRuleField.Account,
        value: ACCOUNT.toUpperCase(),
        names: names(),
      }),
    ).toEqual({ text: "Production AWS", isAsWritten: true });
    expect(
      getCloudCostValueText({
        field: CloudCostRuleField.Provider,
        value: "gcp",
        names: names(),
      }),
    ).toEqual({ text: "Google Cloud", isAsWritten: true });
    expect(
      getCloudCostValueText({
        field: CloudCostRuleField.Region,
        value: "",
        names: names(),
      }),
    ).toEqual({ text: "(empty)", isAsWritten: false });
  });
});

describe("the rule editor", () => {
  function Harness(props: {
    initial: Array<CloudCostRule>;
    onRules: (rules: Array<CloudCostRule>) => void;
  }): React.ReactElement {
    const [rules, setRules] = React.useState<Array<CloudCostRule>>(
      props.initial,
    );

    return (
      <CloudCostRuleEditor
        value={rules}
        onChange={(changed: Array<CloudCostRule>) => {
          setRules(changed);
          props.onRules(changed);
        }}
        names={names()}
        options={OPTIONS}
        showProblem={true}
      />
    );
  }

  test("a new rule starts on the costliest tag; a condition can be added and removed", async () => {
    let seen: Array<CloudCostRule> = [];

    await act(async () => {
      render(
        <Harness
          initial={[]}
          onRules={(rules: Array<CloudCostRule>) => {
            seen = rules;
          }}
        />,
      );
    });

    expect(screen.getByTestId("cloud-cost-rule-editor-empty")).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByTestId("cloud-cost-rule-add"));
    });

    expect(seen).toEqual([
      {
        conditions: [
          {
            field: CloudCostRuleField.Tag,
            key: "team",
            operator: CloudCostRuleOperator.Is,
            values: [],
          },
        ],
      },
    ]);
    // A condition with no value is said, in the reader's words.
    expect(screen.getByTestId("cloud-cost-rule-editor").textContent).toContain(
      "Rule 1, condition 1: choose or type a value.",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("cloud-cost-condition-add"));
    });

    expect(seen[0]!.conditions).toHaveLength(2);

    // Removing the last conditions of a rule removes the rule.
    await act(async () => {
      fireEvent.click(screen.getAllByTestId("cloud-cost-condition-remove")[1]!);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId("cloud-cost-condition-remove")[0]!);
    });

    expect(seen).toEqual([]);
    expect(screen.getByTestId("cloud-cost-rule-editor-empty")).toBeVisible();
  });

  test("a second rule reads Or; removing a rule leaves the others", async () => {
    let seen: Array<CloudCostRule> = [];
    const initial: Array<CloudCostRule> = [
      {
        conditions: [
          {
            field: CloudCostRuleField.Service,
            operator: CloudCostRuleOperator.Is,
            values: ["Amazon EC2"],
          },
        ],
      },
      {
        conditions: [
          {
            field: CloudCostRuleField.Account,
            operator: CloudCostRuleOperator.Is,
            values: [ACCOUNT],
          },
        ],
      },
    ];

    await act(async () => {
      render(
        <Harness
          initial={initial}
          onRules={(rules: Array<CloudCostRule>) => {
            seen = rules;
          }}
        />,
      );
    });

    expect(screen.getAllByTestId("cloud-cost-rule")).toHaveLength(2);
    expect(screen.getByTestId("cloud-cost-rule-editor").textContent).toContain(
      "Or",
    );

    await act(async () => {
      fireEvent.click(screen.getAllByTestId("cloud-cost-rule-remove")[0]!);
    });

    expect(seen).toEqual([initial[1]]);
  });

  test("a condition moved to another field drops the old field's values and keeps an operator it takes", () => {
    expect(
      changeConditionField({
        condition: {
          field: CloudCostRuleField.Service,
          operator: CloudCostRuleOperator.Contains,
          values: ["EC2"],
        },
        field: CloudCostRuleField.Account,
        options: OPTIONS,
      }),
    ).toEqual({
      field: CloudCostRuleField.Account,
      operator: CloudCostRuleOperator.Is,
      values: [],
    });
    expect(
      changeConditionField({
        condition: {
          field: CloudCostRuleField.Service,
          operator: CloudCostRuleOperator.StartsWith,
          values: ["Amazon"],
        },
        field: CloudCostRuleField.Tag,
        options: OPTIONS,
      }),
    ).toEqual({
      field: CloudCostRuleField.Tag,
      key: "team",
      operator: CloudCostRuleOperator.StartsWith,
      values: [],
    });
    // Without tags, a new condition is on an account.
    expect(newCloudCostCondition({ ...OPTIONS, tagKeys: [] }).field).toBe(
      CloudCostRuleField.Account,
    );
  });

  test("what keeps rules from being saved, in the reader's words", () => {
    expect(
      getRuleEditorProblem({
        rules: [
          {
            conditions: [
              {
                field: CloudCostRuleField.Service,
                operator: CloudCostRuleOperator.Is,
                values: ["Amazon EC2"],
              },
            ],
          },
          {
            conditions: [
              {
                field: CloudCostRuleField.Tag,
                key: "",
                operator: CloudCostRuleOperator.Exists,
                values: [],
              },
            ],
          },
        ],
        translator: ENGLISH,
      }),
    ).toBe("Rule 2, condition 1: choose the tag's key.");
    expect(
      getRuleEditorProblem({
        rules: [
          {
            conditions: [
              {
                field: CloudCostRuleField.Tag,
                key: "env",
                operator: CloudCostRuleOperator.DoesNotExist,
                values: [],
              },
            ],
          },
        ],
        translator: ENGLISH,
      }),
    ).toBeNull();
    // What only the server's check finds is said in general.
    expect(
      getRuleEditorProblem({
        rules: [
          {
            conditions: [
              {
                field: CloudCostRuleField.OwnerTeam,
                operator: CloudCostRuleOperator.Is,
                values: ["not an id"],
              },
            ],
          },
        ],
        translator: ENGLISH,
      }),
    ).toBe("These rules cannot be saved yet. Check each condition.");
  });
});

describe("what no rule matches yet", () => {
  test("each kind listed, the costliest first, each with Add to Group", async () => {
    const picks: Array<unknown> = [];

    render(
      <CloudCostUnallocatedCard
        unallocated={unallocated({
          total: 900,
          cloud: 900,
          topServices: [{ key: "Amazon S3", amount: 600 }],
          topAccounts: [{ key: ACCOUNT, amount: 900 }],
          topTagValues: [{ key: "env", value: "prod", amount: 300 }],
          topOwnerTeams: [{ key: PAYMENTS_TEAM, amount: 90 }],
        })}
        currency="USD"
        names={names()}
        canEdit={true}
        onPick={(pick: unknown) => {
          picks.push(pick);
        }}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-cost-unallocated-row",
    );

    expect(
      rows.map((row: HTMLElement) => {
        return row.textContent;
      }),
    ).toEqual([
      "Amazon S3$600.00Add to Group",
      "Production AWS$900.00Add to Group",
      "env: prod$300.00Add to Group",
      "Payments$90.00Add to Group",
    ]);

    for (const row of rows) {
      fireEvent.click(within(row).getByTestId("cloud-cost-unallocated-add"));
    }

    expect(picks).toEqual([
      { field: CloudCostRuleField.Service, value: "Amazon S3" },
      { field: CloudCostRuleField.Account, value: ACCOUNT },
      { field: CloudCostRuleField.Tag, key: "env", value: "prod" },
      { field: CloudCostRuleField.OwnerTeam, value: PAYMENTS_TEAM },
    ]);
  });

  test("nothing unallocated says so; a reader who may not edit gets no button", () => {
    const { rerender } = render(
      <CloudCostUnallocatedCard
        unallocated={unallocated()}
        currency="USD"
        names={names()}
        canEdit={true}
        onPick={() => {}}
      />,
    );

    expect(screen.getByTestId("cloud-cost-unallocated-none")).toBeVisible();

    rerender(
      <CloudCostUnallocatedCard
        unallocated={unallocated({
          total: 10,
          topServices: [{ key: "Amazon S3", amount: 10 }],
        })}
        currency="USD"
        names={names()}
        canEdit={false}
        onPick={() => {}}
      />,
    );

    expect(screen.queryByTestId("cloud-cost-unallocated-add")).toBeNull();
  });
});

describe("a rule started from what no rule matches", () => {
  test("into a group of the person's own: its rules keep theirs, the new one appended", async () => {
    const update: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "updateById",
    ).mockResolvedValue({});
    getJestSpyOn(Toast, "success").mockReturnValue("");
    let added: number = 0;
    const own: CloudCostRule = {
      conditions: [
        {
          field: CloudCostRuleField.Tag,
          key: "team",
          operator: CloudCostRuleOperator.Is,
          values: ["payments"],
        },
      ],
    };

    await act(async () => {
      render(
        <CloudCostAddToGroupModal
          viewId={new ObjectID(VIEW)}
          groups={[
            group({ id: MADE, name: "made", automaticKey: "made" }),
            group({ id: PAYMENTS, name: "Payments", rules: [own] }),
          ]}
          pick={{ field: CloudCostRuleField.Service, value: "Amazon S3" }}
          names={names()}
          onClose={() => {}}
          onAdded={() => {
            added++;
          }}
        />,
      );
    });

    // A group OneUptime makes keeps its own rules: not offered.
    expect(
      screen.getByTestId("cloud-cost-add-to-group").textContent,
    ).not.toContain("made");

    await act(async () => {
      fireEvent.click(screen.getByText("Add to Group"));
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: new ObjectID(PAYMENTS),
        data: {
          rules: [
            own,
            {
              conditions: [
                {
                  field: CloudCostRuleField.Service,
                  operator: CloudCostRuleOperator.Is,
                  values: ["Amazon S3"],
                },
              ],
            },
          ],
        },
      }),
    );
    expect(added).toBe(1);
  });

  test("into a new group, named after what it takes", async () => {
    const create: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "create",
    ).mockResolvedValue({ data: { _id: SEARCH } });
    getJestSpyOn(Toast, "success").mockReturnValue("");

    await act(async () => {
      render(
        <CloudCostAddToGroupModal
          viewId={new ObjectID(VIEW)}
          groups={[]}
          pick={{ field: CloudCostRuleField.Tag, key: "team", value: "search" }}
          names={names()}
          onClose={() => {}}
          onAdded={() => {}}
        />,
      );
    });

    expect(
      (screen.getByTestId("cloud-cost-add-to-group-name") as HTMLInputElement)
        .value,
    ).toBe("search");

    await act(async () => {
      fireEvent.click(screen.getByText("Add to Group"));
    });

    const created: CloudCostGroup = (
      create.mock.calls[0]![0] as { model: CloudCostGroup }
    ).model;

    expect(created.name).toBe("search");
    expect(created.cloudCostViewId?.toString()).toBe(VIEW);
    expect(created.rules).toEqual([
      {
        conditions: [
          {
            field: CloudCostRuleField.Tag,
            key: "team",
            operator: CloudCostRuleOperator.Is,
            values: ["search"],
          },
        ],
      },
    ]);
  });
});

describe("the first view, one click away", () => {
  test("By team, from owners: a view made per owner team, then opened", async () => {
    const create: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "create",
    ).mockResolvedValue({ data: { _id: VIEW } });
    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockReturnValue(undefined);

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudCostQuickStart tagKeys={["team"]} canCreate={true} />
        </MemoryRouter>,
      );
    });

    const choices: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-cost-quick-start-choice",
    );

    expect(
      choices.map((choice: HTMLElement) => {
        return choice.getAttribute("data-grouping");
      }),
    ).toEqual([
      CloudCostViewGrouping.OwnerTeam,
      CloudCostViewGrouping.TagValue,
      CloudCostViewGrouping.Rules,
    ]);

    await act(async () => {
      fireEvent.click(
        within(choices[0]!).getByTestId("cloud-cost-quick-start-create"),
      );
    });

    const view: CloudCostView = (
      create.mock.calls[0]![0] as { model: CloudCostView }
    ).model;

    expect(view.grouping).toBe(CloudCostViewGrouping.OwnerTeam);
    expect(view.name).toBe("By team");
    expect(String(navigate.mock.calls[0]![0])).toContain(
      `/cloud/cost-groups/${VIEW}`,
    );
  });

  test("By a tag names the view after the tag; with no tags it cannot be pressed", async () => {
    const create: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "create",
    ).mockResolvedValue({ data: { _id: VIEW } });
    getJestSpyOn(Navigation, "navigate").mockReturnValue(undefined);

    const { rerender } = render(
      <MemoryRouter>
        <CloudCostQuickStart tagKeys={["cost-center"]} canCreate={true} />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(
        within(
          screen.getAllByTestId("cloud-cost-quick-start-choice")[1]!,
        ).getByTestId("cloud-cost-quick-start-create"),
      );
    });

    const view: CloudCostView = (
      create.mock.calls[0]![0] as { model: CloudCostView }
    ).model;

    expect(view.tagKey).toBe("cost-center");
    expect(view.name).toBe("By cost-center");

    rerender(
      <MemoryRouter>
        <CloudCostQuickStart tagKeys={[]} canCreate={true} />
      </MemoryRouter>,
    );

    expect(
      within(
        screen.getAllByTestId("cloud-cost-quick-start-choice")[1]!,
      ).getByTestId("cloud-cost-quick-start-create"),
    ).toBeDisabled();
  });

  test("a reader who may not create views is offered nothing to press", () => {
    render(
      <MemoryRouter>
        <CloudCostQuickStart tagKeys={["team"]} canCreate={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("cloud-cost-quick-start-create")).toBeNull();
  });
});

describe("a view's figures", () => {
  test("the change on the period before, in the reader's words", () => {
    expect(
      getGroupChangeHint({
        group: { total: 120, previousTotal: 100 },
        translator: ENGLISH,
      }),
    ).toBe("Up 20% on the period before");
    expect(
      getGroupChangeHint({
        group: { total: 75, previousTotal: 100 },
        translator: ENGLISH,
      }),
    ).toBe("Down 25% on the period before");
    expect(
      getGroupChangeHint({
        group: { total: 100.2, previousTotal: 100 },
        translator: ENGLISH,
      }),
    ).toBe("The same as the period before");
    expect(
      getGroupChangeHint({
        group: { total: 100, previousTotal: 0 },
        translator: ENGLISH,
      }),
    ).toBeNull();
  });

  test("as a CSV: a row per group then the unallocated, a name never read as a formula, a credit as a number", () => {
    const csv: string = toCloudCostAllocationCsv(
      allocation({
        basis: CloudCostBasis.Amortized,
        groups: [
          groupResult({
            id: PAYMENTS,
            name: '=HYPERLINK("x")',
            total: 743.08,
            cloud: 420,
            sharedIn: 323.08,
          }),
          groupResult({
            id: SEARCH,
            name: 'Search, "core"',
            total: -60,
            lineItems: -60,
          }),
        ],
        unallocated: unallocated({ total: 150, cloud: 150 }),
      }),
    );

    // Each row says the basis its figures are on, as finance pulls them.
    expect(csv.split("\n")).toEqual([
      '"group","group_id","period_start","currency","cost_basis","total","cloud","line_items","shared_in","shared_out"',
      `"'=HYPERLINK(""x"")","${PAYMENTS}","2026-11-01","USD","amortized","743.08","420","0","323.08","0"`,
      `"Search, ""core""","${SEARCH}","2026-11-01","USD","amortized","-60","0","-60","0","0"`,
      '"Unallocated","","2026-11-01","USD","amortized","150","150","0","0","0"',
      "",
    ]);
  });

  test("fixed percentages add up to 100, or are none", () => {
    expect(percentagesAddUp({})).toBe(true);
    expect(percentagesAddUp({ [PAYMENTS]: 60, [SEARCH]: 40 })).toBe(true);
    expect(percentagesAddUp({ [PAYMENTS]: 60 })).toBe(false);
  });

  test("a group no rule can reach names the group that takes it all", () => {
    expect(
      ENGLISH.translateTemplate(NEVER_MATCHES, { group: "Payments" }),
    ).toBe(
      "Payments above takes every cost these rules match, so this group gets nothing. Move it up, or narrow the earlier group's rules.",
    );
  });
});

describe("Where the money goes, by cost group", () => {
  const ACCOUNTS: Array<CloudAccountRow> = [
    {
      id: new ObjectID(ACCOUNT),
      name: "Production AWS",
      provider: "aws",
      accountId: "123456789012",
      lastSeenAt: new Date(),
      hasConnection: true,
      resourceCount: 10,
      costSummary: {
        state: CloudCostState.Reading,
        currency: "USD",
        monthToDate: 1000,
        lastMonth: 2000,
        monthFullDays: 1000,
        lastMonthToDate: 900,
        projectedMonth: 1800,
        last30Days: 1900,
        topServices: [],
        readAt: NOW.toISOString(),
      } as never,
      savingsSummary: null,
    },
  ];

  async function openByGroup(
    views: Array<CloudCostView>,
    basis?: CloudCostBasis,
  ): Promise<void> {
    // The card opens on its services, read before the groups are asked for.
    getJestSpyOn(AnalyticsModelAPI, "aggregate").mockResolvedValue({
      data: [],
    });
    getJestSpyOn(ModelAPI, "getList").mockImplementation(
      async (request: { modelType: unknown }): Promise<unknown> => {
        return request.modelType === CloudCostView
          ? { data: views, count: views.length }
          : request.modelType === CloudResource
            ? { data: [], count: 0 }
            : { data: [], count: 0 };
      },
    );

    await act(async () => {
      render(
        <MemoryRouter>
          <CloudCostBreakdownCard
            scope={{ projectId: PROJECT, currency: "USD", basis }}
            accounts={ACCOUNTS}
            isOneAccount={false}
          />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("cloud-cost-breakdown-dimension-group"),
      );
    });
  }

  test("with no view yet, the way to set cost groups up", async () => {
    await openByGroup([]);

    expect(screen.getByTestId("cloud-cost-breakdown-no-views")).toBeVisible();
    expect(
      screen
        .getByTestId("cloud-cost-breakdown-set-up-groups")
        .getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/cloud/cost-groups`);
  });

  test("each group's spend, linked to its page, with its change; what no group takes under the list", async () => {
    const view: CloudCostView = new CloudCostView();
    view._id = VIEW;
    view.name = "By team";
    view.grouping = CloudCostViewGrouping.OwnerTeam;

    const post: jest.SpyInstance<any, any> = getJestSpyOn(
      API,
      "post",
    ).mockResolvedValue({
      data: allocation({
        total: 1000,
        groups: [
          groupResult({
            id: PAYMENTS,
            name: "Payments",
            total: 600,
            previousTotal: 500,
          }),
          groupResult({
            id: SEARCH,
            name: "Search",
            order: 2,
            total: 250,
          }),
          // A shared group that split everything away is left out.
          groupResult({
            id: MADE,
            name: "Support",
            order: 3,
            isShared: true,
            split: CloudCostSharedSplit.Proportional,
            total: 0,
            sharedOut: 100,
          }),
        ],
        unallocated: unallocated({ total: 150, cloud: 150 }),
      }),
    });

    await openByGroup([view]);

    expect(String(post.mock.calls[0]![0].url)).toContain(
      `/cloud-cost-view/${VIEW}/allocation`,
    );

    const card: HTMLElement = screen.getByTestId("cloud-cost-breakdown");

    expect(card.textContent).toContain("Payments");
    expect(card.textContent).toContain("Up 20% on the period before");
    expect(card.textContent).toContain("Search");
    expect(card.textContent).not.toContain("Support");
    expect(
      screen.getByTestId("cloud-cost-breakdown-rest").textContent,
    ).toContain("$150.00 is in no group.");
    expect(
      screen
        .getByTestId("cloud-cost-breakdown-view-manage")
        .getAttribute("href"),
    ).toBe(`/dashboard/${PROJECT_ID}/cloud/cost-groups/${VIEW}`);
    expect(
      Array.from(card.querySelectorAll("a")).some((link: Element) => {
        return (
          link.getAttribute("href") ===
          `/dashboard/${PROJECT_ID}/cloud/cost-groups/${VIEW}/groups/${PAYMENTS}`
        );
      }),
    ).toBe(true);
  });

  test("each group's spend is asked for on the basis the page shows (#11007)", async () => {
    const view: CloudCostView = new CloudCostView();
    view._id = VIEW;
    view.name = "By team";

    const post: jest.SpyInstance<any, any> = getJestSpyOn(
      API,
      "post",
    ).mockResolvedValue({
      data: allocation({
        basis: CloudCostBasis.Net,
        groups: [groupResult({ id: PAYMENTS, name: "Payments", total: 600 })],
      }),
    });

    await openByGroup([view], CloudCostBasis.Net);

    expect(String(post.mock.calls[0]![0].url)).toContain(
      `/cloud-cost-view/${VIEW}/allocation`,
    );
    expect(post.mock.calls[0]![0].data).toMatchObject({
      basis: CloudCostBasis.Net,
      currency: "USD",
    });
  });

  test("a page that names no basis leaves it to the project's", async () => {
    const view: CloudCostView = new CloudCostView();
    view._id = VIEW;
    view.name = "By team";

    const post: jest.SpyInstance<any, any> = getJestSpyOn(
      API,
      "post",
    ).mockResolvedValue({ data: allocation() });

    await openByGroup([view]);

    expect(post.mock.calls[0]![0].data).not.toHaveProperty("basis");
  });
});
