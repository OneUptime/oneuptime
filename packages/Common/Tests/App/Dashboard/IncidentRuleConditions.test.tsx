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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The form from the maintainer's screenshot - Create New Incident Privacy
 * Rule, Match Criteria step - with the page's real fields in the real
 * ModelForm and the real dropdowns. Only the table around the form and the
 * network are stubbed.
 *
 * "Instead of saying 'incident title pattern,' we can just say 'incident
 * title' ... Please also improve the UI while you are at it."
 */

const ruleTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/RuleRun/RuleTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      ruleTableMock(props);
      return <div data-testid="rule-table" />;
    },
  };
});

let submittedRule: IncidentPrivacyRule | null = null;
// The rule an Edit form opens, as the API answers it.
let ruleToEdit: IncidentPrivacyRule | null = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [Permission.ProjectOwner, Permission.User],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<IncidentPrivacyRule | null> => {
        return ruleToEdit;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 50 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: async (data: {
        model: IncidentPrivacyRule;
      }): Promise<{ data: IncidentPrivacyRule }> => {
        submittedRule = data.model;
        return { data: data.model };
      },
    },
  };
});

import IncidentPrivacyRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentPrivacyRules";
import IncidentPrivacyRule from "../../../Models/DatabaseModels/IncidentPrivacyRule";
import Route from "../../../Types/API/Route";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import Permission from "../../../Types/Permission";
import {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import ObjectID from "../../../Types/ObjectID";

type Props = Record<string, any>;

const RULE_ID: string = "7d6c5b4a-3f2e-4d1c-8b0a-9e8f7d6c5b4a";

function savedRule(
  filters: Array<Record<string, unknown>>,
): IncidentPrivacyRule {
  const rule: IncidentPrivacyRule = new IncidentPrivacyRule();
  rule._id = RULE_ID;
  rule.name = "Private database incidents";
  rule.isEnabled = true;
  rule.criteria = {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: filters,
  } as never;
  return rule;
}

const CRITERIA_IN_ORDER: Array<string> = [
  "Monitors",
  "Incident Severities",
  "Incident Labels",
  "Monitor Labels",
  "Incident Title",
  "Incident Description",
  "Monitor Name",
  "Monitor Description",
];

function incidentRuleTableProps(): Props {
  const url: string = `/dashboard/${PROJECT_ID}/incidents/settings/privacy-rules`;
  goTo(url);
  render(
    <MemoryRouter initialEntries={[url]}>
      <IncidentPrivacyRulesPage
        pageRoute={new Route(url)}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );

  const call: Array<unknown> | undefined = ruleTableMock.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return (args[0] as Props)["modelType"] === IncidentPrivacyRule;
    },
  );
  cleanup();

  expect(call).toBeDefined();
  return call![0] as Props;
}

async function renderCreateForm(): Promise<void> {
  const tableProps: Props = incidentRuleTableProps();

  render(
    <ModelForm<IncidentPrivacyRule>
      modelType={IncidentPrivacyRule}
      id="incident-privacy-rule-form"
      name="Incident Privacy Rule"
      fields={tableProps["formFields"] as Fields<IncidentPrivacyRule>}
      steps={tableProps["formSteps"] as Array<FormStep<IncidentPrivacyRule>>}
      formType={FormType.Create}
      initialValues={{ name: "Private database incidents", isEnabled: true }}
      submitButtonText="Create Incident Privacy Rule"
    />,
  );

  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Next/i }));
  await screen.findByTestId("rule-criteria-builder");
}

async function renderEditForm(rule: IncidentPrivacyRule): Promise<void> {
  const tableProps: Props = incidentRuleTableProps();
  ruleToEdit = rule;

  render(
    <ModelForm<IncidentPrivacyRule>
      modelType={IncidentPrivacyRule}
      id="incident-privacy-rule-form"
      name="Incident Privacy Rule"
      fields={tableProps["formFields"] as Fields<IncidentPrivacyRule>}
      steps={tableProps["formSteps"] as Array<FormStep<IncidentPrivacyRule>>}
      formType={FormType.Update}
      modelIdToEdit={new ObjectID(RULE_ID)}
      allowAnyStepNavigation={true}
      submitButtonText="Save Changes"
    />,
  );

  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  // An edit form opens any step from its step list.
  await user.click(await screen.findByText("Match Criteria"));
  await screen.findByTestId("rule-criteria-builder");
}

// "Only incidents that match conditions": one condition to fill in appears.
async function chooseConditions(): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(
    screen.getByRole("radio", { name: "Only incidents that match conditions" }),
  );
}

async function openMenu(name: string): Promise<HTMLElement> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: name }));
  return await screen.findByRole("listbox");
}

async function selectOption(name: string, label: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const menu: HTMLElement = await openMenu(name);
  await user.click(within(menu).getByText(label, { exact: true }));
}

beforeEach(() => {
  ruleTableMock.mockReset();
  submittedRule = null;
  ruleToEdit = null;
});

afterEach(() => {
  cleanup();
});

describe("Create New Incident Privacy Rule - Match Criteria", () => {
  /*
   * "We have customers who think they need to add at least one condition,
   * but the idea is that if they don't add any condition, it matches all the
   * incidents. ... We'd probably show two options: all incidents or
   * conditions, and when we click on conditions, we show the conditions
   * panel."
   */
  test("opens on 'All incidents': nothing to fill in, and no '(Optional)' field to doubt", async () => {
    await renderCreateForm();

    const group: HTMLElement = screen.getByRole("radiogroup", {
      name: /Applies to/,
    });
    expect(
      within(group).getByRole("radio", { name: "All incidents" }),
    ).toBeChecked();
    expect(
      within(group).getByRole("radio", {
        name: "Only incidents that match conditions",
      }),
    ).not.toBeChecked();

    // No condition waits to be filled in.
    expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add condition" })).toBeNull();
    expect(screen.queryByTestId("rule-criteria-empty")).toBeNull();
    // The old field said "Conditions (Optional)" over an empty list.
    expect(screen.queryByText("Conditions")).toBeNull();
    expect(screen.queryByText("(Optional)")).toBeNull();
    // Not the API's description of the criteria column.
    expect(screen.queryByText(/Versioned conditions/)).toBeNull();
    expect(screen.queryByText("How should conditions be combined?")).toBeNull();
  });

  test("REGRESSION: a rule for every incident is created without a condition and without an error", async () => {
    /*
     * The screenshot: the step showed an empty "If [Monitors] [Has any of]"
     * row marked "Choose at least one value." People who wanted every
     * incident could not tell they needed no condition at all.
     */
    await renderCreateForm();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Create Incident Privacy Rule" }),
    );
    await waitFor(() => {
      expect(submittedRule).not.toBeNull();
    });

    expect(screen.queryByText("Choose at least one value.")).toBeNull();
    // Stored exactly as a rule without conditions always was.
    expect(submittedRule!.criteria).toEqual({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [],
    });
    expect(submittedRule!.incidentTitlePattern).toBe(
      RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
    );
  });

  test("'Only incidents that match conditions' opens the conditions with one ready, on Monitors", async () => {
    await renderCreateForm();

    await chooseConditions();

    const row: HTMLElement = screen.getByTestId("rule-criteria-row-0");
    expect(row).toHaveTextContent("If");
    expect(row).toHaveTextContent("Monitors");
    expect(row).toHaveTextContent("Has any of");
    // Under the answer that asked for it.
    expect(
      within(
        screen.getByTestId("rule-criteria-applies-to-conditions"),
      ).getByTestId("rule-criteria-row-0"),
    ).toBe(row);
    // Nothing is red until the form is sent.
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  test("changing one's mind back to 'All incidents' saves no conditions", async () => {
    await renderCreateForm();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await chooseConditions();
    await selectOption("Criteria for condition 1", "Incident Title");
    await user.type(screen.getByTestId("rule-criteria-value-0"), "database");
    await user.click(screen.getByRole("radio", { name: "All incidents" }));

    expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Create Incident Privacy Rule" }),
    );
    await waitFor(() => {
      expect(submittedRule).not.toBeNull();
    });
    expect(submittedRule!.criteria?.filters).toEqual([]);
  });

  test("the Criteria dropdown lists every criterion without Pattern", async () => {
    await renderCreateForm();
    await chooseConditions();

    const menu: HTMLElement = await openMenu("Criteria for condition 1");
    const options: Array<string> = within(menu)
      .getAllByRole("option")
      .map((option: HTMLElement): string => {
        return option.textContent || "";
      });

    expect(options).toEqual(CRITERIA_IN_ORDER);
    expect(menu).not.toHaveTextContent(/Pattern/);
  });

  test("a relation condition reads Monitors · Has any of · Select one or more", async () => {
    await renderCreateForm();
    await chooseConditions();

    const row: HTMLElement = screen.getByTestId("rule-criteria-row-0");
    expect(row).toHaveTextContent("If");
    expect(row).toHaveTextContent("Monitors");
    expect(row).toHaveTextContent("Has any of");
    expect(
      within(row).getByPlaceholderText("Select one or more"),
    ).toBeInTheDocument();
    expect(row).not.toHaveTextContent("(optional)");
  });

  test("builds and saves 'incident title contains database, or description contains timeout'", async () => {
    await renderCreateForm();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await chooseConditions();
    await selectOption("Criteria for condition 1", "Incident Title");

    // Text starts on Contains and asks for text, not for a regex.
    expect(screen.getByTestId("rule-criteria-row-0")).toHaveTextContent(
      "Contains",
    );
    const firstValue: HTMLElement = screen.getByTestId("rule-criteria-value-0");
    expect(firstValue).toHaveAttribute("placeholder", "Enter text");
    await user.type(firstValue, "database");

    // The next condition starts on the first criterion not used yet.
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    expect(screen.getByTestId("rule-criteria-row-1")).toHaveTextContent(
      "Monitors",
    );
    await selectOption("Criteria for condition 2", "Incident Description");
    await user.type(screen.getByTestId("rule-criteria-value-1"), "timeout");

    // Two conditions: now there is something to combine.
    const combine: HTMLElement = screen.getByTestId("rule-criteria-combine");
    expect(
      within(combine).getByRole("radio", { name: "Match all" }),
    ).toBeChecked();
    expect(screen.getByTestId("rule-criteria-connector-1")).toHaveTextContent(
      "And",
    );
    await user.click(within(combine).getByRole("radio", { name: "Match any" }));
    expect(screen.getByTestId("rule-criteria-connector-1")).toHaveTextContent(
      "Or",
    );

    await user.click(
      screen.getByRole("button", { name: "Create Incident Privacy Rule" }),
    );
    await waitFor(() => {
      expect(submittedRule).not.toBeNull();
    });

    expect(submittedRule!.criteria).toEqual({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.Any,
      filters: [
        {
          field: "incidentTitlePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "database",
        },
        {
          field: "incidentDescriptionPattern",
          operator: RuleCriteriaOperator.Contains,
          value: "timeout",
        },
      ],
    });
    // Old API pods still read the legacy columns: they match nothing.
    expect(submittedRule!.incidentTitlePattern).toBe(
      RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
    );
    expect(submittedRule!.monitors).toEqual([]);
  });

  test("a pattern is one operator away, keeping the text typed", async () => {
    await renderCreateForm();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await chooseConditions();
    await selectOption("Criteria for condition 1", "Monitor Name");
    await user.type(screen.getByTestId("rule-criteria-value-0"), "prod-");
    await selectOption("Operator for condition 1", "Matches pattern");

    expect(screen.getByTestId("rule-criteria-value-0")).toHaveValue("prod-");
    expect(screen.getByTestId("rule-criteria-value-0")).toHaveAttribute(
      "placeholder",
      "prod-.*",
    );

    await user.click(
      screen.getByRole("button", { name: "Create Incident Privacy Rule" }),
    );
    await waitFor(() => {
      expect(submittedRule).not.toBeNull();
    });
    expect(submittedRule!.criteria?.filters).toEqual([
      {
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.MatchesPattern,
        value: "prod-",
      },
    ]);
  });

  test("an empty value is pointed out at its row before anything is sent", async () => {
    await renderCreateForm();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await chooseConditions();
    await selectOption("Criteria for condition 1", "Incident Title");
    await user.click(
      screen.getByRole("button", { name: "Create Incident Privacy Rule" }),
    );

    const row: HTMLElement = screen.getByTestId("rule-criteria-row-0");
    expect(await within(row).findByRole("alert")).toHaveTextContent(
      "Enter a value.",
    );
    expect(submittedRule).toBeNull();

    await user.type(screen.getByTestId("rule-criteria-value-0"), "db");
    await waitFor(() => {
      expect(within(row).queryByRole("alert")).toBeNull();
    });
  });

  test("a condition is removed with its trash icon; the last one taken away is 'All incidents' again", async () => {
    await renderCreateForm();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await chooseConditions();
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await user.click(
      screen.getByRole("button", { name: "Remove condition 1" }),
    );

    expect(screen.getByTestId("rule-criteria-row-0")).toBeInTheDocument();
    expect(screen.queryByTestId("rule-criteria-row-1")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Remove condition 1" }),
    );

    expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
    expect(screen.getByRole("radio", { name: "All incidents" })).toBeChecked();
  });
});

describe("Edit Incident Privacy Rule - Match Criteria", () => {
  test("a rule with conditions opens on 'Only incidents that match conditions', its conditions shown", async () => {
    await renderEditForm(
      savedRule([
        {
          field: "incidentTitlePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "database",
        },
      ]),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("radio", {
          name: "Only incidents that match conditions",
        }),
      ).toBeChecked();
    });
    expect(screen.getByTestId("rule-criteria-value-0")).toHaveValue("database");
  });

  test("a rule with no conditions opens on 'All incidents'", async () => {
    await renderEditForm(savedRule([]));

    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "All incidents" }),
      ).toBeChecked();
    });
    expect(screen.queryByTestId("rule-criteria-row-0")).toBeNull();
  });

  test("moving a rule to 'All incidents' saves it without its conditions", async () => {
    await renderEditForm(
      savedRule([
        {
          field: "incidentTitlePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "database",
        },
      ]),
    );
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByTestId("rule-criteria-row-0")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("radio", { name: "All incidents" }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(submittedRule).not.toBeNull();
    });
    expect(submittedRule!.criteria).toEqual({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [],
    });
  });
});
