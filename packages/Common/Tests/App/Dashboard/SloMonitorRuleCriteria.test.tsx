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
import React from "react";
import getSloMonitorRuleFormFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/SloMonitorRuleFormFields";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import { getLegacyRuleCriteriaFields } from "../../../UI/Components/RuleCriteria/RuleCriteriaModelForm";
import { getRuleCriteriaSummaryText } from "../../../UI/Components/RuleCriteria/RuleCriteriaSummary";

/*
 * Drive the real ModelForm and dropdowns using the SLO page's actual fields.
 * This catches fields being removed by column permissions, builder conversion,
 * edit loading, and serialization, not just the labels in the configuration.
 */
let savedRule: ServiceLevelObjectiveMonitorRule | null = null;
let submittedRule: ServiceLevelObjectiveMonitorRule | null = null;
let selectedFields: Record<string, unknown> = {};
let permissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: permissions };
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
      getItem: async (data: {
        select: Record<string, unknown>;
      }): Promise<ServiceLevelObjectiveMonitorRule | null> => {
        selectedFields = data.select;
        return savedRule;
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
        model: ServiceLevelObjectiveMonitorRule;
      }): Promise<{ data: ServiceLevelObjectiveMonitorRule }> => {
        submittedRule = data.model;
        return { data: data.model };
      },
    },
  };
});

const RULE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function criteriaWith(
  field: string,
  operator: RuleCriteriaOperator,
  value: string,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [{ field: field, operator: operator, value: value }],
  };
}

function existingRule(
  criteria?: RuleCriteria,
): ServiceLevelObjectiveMonitorRule {
  const rule: ServiceLevelObjectiveMonitorRule =
    new ServiceLevelObjectiveMonitorRule();
  rule._id = RULE_ID;
  rule.name = "Production API monitors";
  rule.isEnabled = true;
  if (criteria !== undefined) {
    rule.criteria = criteria;
  }
  return rule;
}

async function renderForm(formType: FormType = FormType.Create): Promise<void> {
  render(
    <ModelForm<ServiceLevelObjectiveMonitorRule>
      modelType={ServiceLevelObjectiveMonitorRule}
      id="slo-monitor-rule-form"
      name="SLO Monitor Rule"
      fields={getSloMonitorRuleFormFields()}
      formType={formType}
      modelIdToEdit={
        formType === FormType.Update ? new ObjectID(RULE_ID) : undefined
      }
      initialValues={
        formType === FormType.Create
          ? { name: "Production API monitors", isEnabled: true }
          : undefined
      }
      steps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria" },
      ]}
      submitButtonText="Save SLO Monitor Rule"
    />,
  );

  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Next/i }));
  await screen.findByTestId("rule-criteria-builder");
}

async function selectOption(name: string, label: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: name }));
  const options: Array<HTMLElement> = await screen.findAllByText(label, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

async function addCondition(title: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(screen.getByTestId("rule-criteria-add"));
  const index: number = screen.getAllByText("Criteria", { exact: true }).length;
  await selectOption(`Criteria for condition ${index}`, title);
}

async function submitForm(): Promise<ServiceLevelObjectiveMonitorRule> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Save SLO Monitor Rule" }),
  );
  await waitFor(() => {
    expect(submittedRule).not.toBeNull();
  });
  return submittedRule!;
}

beforeEach(() => {
  savedRule = null;
  submittedRule = null;
  selectedFields = {};
  permissions = [Permission.ProjectOwner, Permission.User];
});

afterEach(() => {
  cleanup();
});

describe("SLO monitor rule criteria in the create and edit forms", () => {
  test("lists Monitor Type and names text fields without Pattern", async () => {
    await renderForm();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.click(screen.getByTestId("rule-criteria-add"));
    await user.click(
      screen.getByRole("combobox", { name: "Criteria for condition 1" }),
    );

    for (const title of [
      "Monitor Labels",
      "Monitor Type",
      "Monitor Name",
      "Monitor Description",
    ]) {
      expect(
        screen.getAllByText(title, { exact: true }).length,
      ).toBeGreaterThan(0);
    }
    expect(
      screen.queryByText("Monitor Name Pattern", { exact: true }),
    ).toBeNull();
    expect(
      screen.queryByText("Monitor Description Pattern", { exact: true }),
    ).toBeNull();
  });

  test("offers every valid monitor type as a single dropdown value", async () => {
    await renderForm();
    await addCondition("Monitor Type");
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.click(
      screen.getByRole("combobox", { name: "Value for condition 1" }),
    );

    for (const monitorType of Object.values(MonitorType)) {
      expect(screen.getByText(monitorType, { exact: true })).not.toBeNull();
    }
    expect(screen.queryByText("No options")).toBeNull();

    await user.click(screen.getByText(MonitorType.Website, { exact: true }));
    await selectOption("Value for condition 1", MonitorType.API);
    const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
    expect(rule.criteria).toEqual(
      criteriaWith("monitorType", RuleCriteriaOperator.Equals, MonitorType.API),
    );
  });

  test("limits Monitor Type operators to Equals and Does not equal", async () => {
    await renderForm();
    await addCondition("Monitor Type");
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.click(
      screen.getByRole("combobox", { name: "Operator for condition 1" }),
    );

    expect(
      screen.getAllByText("Equals", { exact: true }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Does not equal", { exact: true })).not.toBeNull();
    for (const unsupported of [
      "Contains",
      "Matches pattern",
      "Does not match pattern",
      "Has any of",
    ]) {
      expect(screen.queryByText(unsupported, { exact: true })).toBeNull();
    }

    await user.click(screen.getByText("Does not equal", { exact: true }));
    await selectOption("Value for condition 1", MonitorType.Manual);
    const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
    expect(rule.criteria).toEqual(
      criteriaWith(
        "monitorType",
        RuleCriteriaOperator.NotEquals,
        MonitorType.Manual,
      ),
    );
  });

  test.each([
    ["Monitor Name", "monitorNamePattern"],
    ["Monitor Description", "monitorDescriptionPattern"],
  ])(
    "offers pattern operators for %s and preserves its stored field key",
    async (title: string, field: string) => {
      await renderForm();
      await addCondition(title);
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      await user.click(
        screen.getByRole("combobox", { name: "Operator for condition 1" }),
      );
      expect(
        screen.getAllByText("Matches pattern", { exact: true }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText("Does not match pattern", { exact: true }),
      ).not.toBeNull();
      expect(screen.getByText("Contains", { exact: true })).not.toBeNull();

      await user.click(
        screen.getByText("Does not match pattern", { exact: true }),
      );
      await user.type(
        screen.getByTestId("rule-criteria-value-0"),
        "^staging-.*",
      );
      const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
      expect(rule.criteria).toEqual(
        criteriaWith(
          field,
          RuleCriteriaOperator.DoesNotMatchPattern,
          "^staging-.*",
        ),
      );
    },
  );

  test.each([FilterCondition.All, FilterCondition.Any])(
    "combines type and text conditions with Match %s and sends the compatibility shadow",
    async (filterCondition: FilterCondition) => {
      await renderForm();
      await addCondition("Monitor Type");
      await selectOption("Value for condition 1", MonitorType.API);
      await addCondition("Monitor Name");
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      await user.type(screen.getByTestId("rule-criteria-value-1"), "api-*");
      await user.click(
        screen.getByTestId(
          filterCondition === FilterCondition.All
            ? "rule-criteria-match-all"
            : "rule-criteria-match-any",
        ),
      );

      const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
      expect(rule.criteria).toEqual({
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: filterCondition,
        filters: [
          {
            field: "monitorType",
            operator: RuleCriteriaOperator.Equals,
            value: MonitorType.API,
          },
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.MatchesPattern,
            value: "api-*",
          },
        ],
      });
      expect(rule.monitorType).toBeNull();
      expect(rule.monitorNamePattern).toBe(
        RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
      );
      expect(rule.monitorDescriptionPattern).toBeNull();
      expect(rule.monitorLabels).toEqual([]);
    },
  );

  test("prevents saving a Monitor Type condition without choosing a value", async () => {
    await renderForm();
    await addCondition("Monitor Type");
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Save SLO Monitor Rule" }),
    );
    expect(
      (await screen.findByTestId("rule-criteria-error")).textContent,
    ).toContain("non-blank");
    expect(submittedRule).toBeNull();
  });

  test("clears an incompatible pattern when switching to Monitor Type", async () => {
    await renderForm();
    await addCondition("Monitor Name");
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.type(screen.getByTestId("rule-criteria-value-0"), "api-*");
    await selectOption("Criteria for condition 1", "Monitor Type");

    expect(screen.getByText("Equals", { exact: true })).not.toBeNull();
    expect(screen.queryByDisplayValue("api-*")).toBeNull();
    expect(screen.getByText("Select Monitor Type")).not.toBeNull();
    await selectOption("Value for condition 1", MonitorType.Ping);
    const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
    expect(rule.criteria).toEqual(
      criteriaWith(
        "monitorType",
        RuleCriteriaOperator.Equals,
        MonitorType.Ping,
      ),
    );
  });

  test.each([
    [RuleCriteriaOperator.Equals, MonitorType.DockerSwarm],
    [RuleCriteriaOperator.NotEquals, MonitorType.SSLCertificate],
  ])(
    "loads and saves a stored type condition using %s without changing it",
    async (operator: RuleCriteriaOperator, monitorType: MonitorType) => {
      const criteria: RuleCriteria = criteriaWith(
        "monitorType",
        operator,
        monitorType,
      );
      savedRule = existingRule(criteria);
      savedRule.monitorNamePattern = RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN;
      await renderForm(FormType.Update);

      expect(selectedFields).toMatchObject({
        monitorType: true,
        criteria: true,
      });
      const row: HTMLElement = screen.getByTestId("rule-criteria-row-0");
      expect(
        within(row).getByText("Monitor Type", { exact: true }),
      ).not.toBeNull();
      expect(
        within(row).getByText(monitorType, { exact: true }),
      ).not.toBeNull();
      expect(
        within(row).getByText(
          operator === RuleCriteriaOperator.Equals
            ? "Equals"
            : "Does not equal",
          { exact: true },
        ),
      ).not.toBeNull();
      const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
      expect(rule._id).toBe(RULE_ID);
      expect(rule.criteria).toEqual(criteria);
    },
  );

  test("edits a saved type and operator", async () => {
    savedRule = existingRule(
      criteriaWith("monitorType", RuleCriteriaOperator.Equals, MonitorType.API),
    );
    await renderForm(FormType.Update);
    await selectOption("Operator for condition 1", "Does not equal");
    await selectOption("Value for condition 1", MonitorType.Manual);
    const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
    expect(rule.criteria).toEqual(
      criteriaWith(
        "monitorType",
        RuleCriteriaOperator.NotEquals,
        MonitorType.Manual,
      ),
    );
  });

  test("hydrates legacy name and description patterns under their new labels", async () => {
    savedRule = existingRule();
    savedRule.monitorNamePattern = "^api-";
    savedRule.monitorDescriptionPattern = "*customer*";
    await renderForm(FormType.Update);

    expect(screen.getByText("Monitor Name", { exact: true })).not.toBeNull();
    expect(
      screen.getByText("Monitor Description", { exact: true }),
    ).not.toBeNull();
    expect(
      screen.getAllByText("Matches pattern", { exact: true }),
    ).toHaveLength(2);
    expect(screen.getByDisplayValue("^api-")).not.toBeNull();
    expect(screen.getByDisplayValue("*customer*")).not.toBeNull();
    const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
    expect(rule.criteria).toEqual({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.MatchesPattern,
          value: "^api-",
        },
        {
          field: "monitorDescriptionPattern",
          operator: RuleCriteriaOperator.MatchesPattern,
          value: "*customer*",
        },
      ],
    });
  });

  test("hydrates a legacy monitor type using Equals", async () => {
    savedRule = existingRule();
    savedRule.monitorType = MonitorType.Server;
    await renderForm(FormType.Update);

    expect(screen.getByText("Monitor Type", { exact: true })).not.toBeNull();
    expect(screen.getByText("Equals", { exact: true })).not.toBeNull();
    expect(
      screen.getByText(MonitorType.Server, { exact: true }),
    ).not.toBeNull();
    const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
    expect(rule.criteria).toEqual(
      criteriaWith(
        "monitorType",
        RuleCriteriaOperator.Equals,
        MonitorType.Server,
      ),
    );
  });

  test("shows Monitor Type to a user with only the specific create permission", async () => {
    permissions = [
      Permission.CreateServiceLevelObjectiveMonitorRule,
      Permission.User,
    ];
    await renderForm();
    await addCondition("Monitor Type");
    await selectOption("Value for condition 1", MonitorType.Website);
    const rule: ServiceLevelObjectiveMonitorRule = await submitForm();
    expect(rule.criteria?.filters[0]?.value).toBe(MonitorType.Website);
  });

  test("uses concise field names and explicit operators in rule summaries", () => {
    const rule: ServiceLevelObjectiveMonitorRule = existingRule({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "monitorType",
          operator: RuleCriteriaOperator.Equals,
          value: MonitorType.API,
        },
        {
          field: "monitorNamePattern",
          operator: RuleCriteriaOperator.MatchesPattern,
          value: "api-*",
        },
        {
          field: "monitorDescriptionPattern",
          operator: RuleCriteriaOperator.DoesNotMatchPattern,
          value: "*staging*",
        },
      ],
    });
    expect(
      getRuleCriteriaSummaryText({
        fields: getLegacyRuleCriteriaFields(getSloMonitorRuleFormFields()),
        item: rule,
      }),
    ).toBe(
      "Match all: Monitor Type equals “API”; Monitor Name matches pattern “api-*”; Monitor Description does not match pattern “*staging*”",
    );
  });
});
