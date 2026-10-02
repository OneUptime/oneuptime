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
import { ReactElement } from "react";

/*
 * "The incident runbook rules don't have things like incident labels,
 * monitor labels, and all of that stuff. Can you please add those things as
 * well, just like we have on the incident privacy rules?" - the maintainer,
 * on Create New Runbook Rule's Match Criteria step, whose Criteria dropdown
 * offered only the title and the description.
 *
 * The page's real fields in the real ModelForm and conditions builder. The
 * table around the form, the network and the entity pickers are stubbed: a
 * picker draws one button per record of the model it was given.
 */

let mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

interface EntityDropdownStubProps {
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
  modelType?: unknown;
  isMultiSelect?: boolean | undefined;
  value?: unknown;
  onChange?: ((value: Array<string> | string | null) => void) | undefined;
}

const mockEntityDropdowns: Record<string, EntityDropdownStubProps> = {};

jest.mock("../../../UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: EntityDropdownStubProps): ReactElement => {
      return mockRenderEntityDropdown(props);
    },
  };
});

let submittedRule: RunbookRule | null = null;

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
      getItem: async (): Promise<null> => {
        return null;
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
        model: RunbookRule;
      }): Promise<{ data: RunbookRule }> => {
        submittedRule = data.model;
        return { data: data.model };
      },
    },
  };
});

import RunbookRulesTable, {
  getRunbookRuleDocumentation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/RunbookRulesTable";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import Permission from "../../../Types/Permission";
import {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { getRunbookRuleCriteriaFields } from "../../../Types/Runbook/RunbookRuleCriteria";
import RunbookRuleTriggerEntity from "../../../Types/Runbook/RunbookRuleTriggerEntity";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import Field from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import Column from "../../../UI/Components/ModelTable/Column";
import Columns from "../../../UI/Components/ModelTable/Columns";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import { getRuleCriteriaFieldName } from "../../../UI/Components/RuleCriteria/RuleCriteriaFields";
import {
  getLegacyRuleCriteriaFields,
  MATCH_CRITERIA_STEP_ID,
} from "../../../UI/Components/RuleCriteria/RuleCriteriaModelForm";
import getRuleCriteriaTableConfiguration, {
  RULE_CRITERIA_HELP_SECTION_BODY,
  RuleCriteriaTableConfiguration,
  replaceRuleCriteriaHelpMarkdown,
} from "../../../UI/Components/RuleCriteria/RuleCriteriaModelTable";
import { getRuleCriteriaSummaryText } from "../../../UI/Components/RuleCriteria/RuleCriteriaSummary";

const MONITOR_ID: string = "80000000-0000-4000-8000-000000000001";
const LABEL_ID: string = "80000000-0000-4000-8000-000000000002";
const INCIDENT_SEVERITY_ID: string = "80000000-0000-4000-8000-000000000003";
const ALERT_SEVERITY_ID: string = "80000000-0000-4000-8000-000000000004";
const RUNBOOK_ID: string = "80000000-0000-4000-8000-000000000005";

interface StubOption {
  label: string;
  value: string;
}

// The records each picker offers, by the model it is asked to pick from.
function mockOptionsFor(modelType: unknown): Array<StubOption> {
  if (modelType === Monitor) {
    return [{ label: "checkout-api", value: MONITOR_ID }];
  }

  if (modelType === Label) {
    return [{ label: "production", value: LABEL_ID }];
  }

  if (modelType === IncidentSeverity) {
    return [{ label: "Critical", value: INCIDENT_SEVERITY_ID }];
  }

  if (modelType === AlertSeverity) {
    return [{ label: "High", value: ALERT_SEVERITY_ID }];
  }

  if (modelType === Runbook) {
    return [{ label: "DB failover", value: RUNBOOK_ID }];
  }

  return [];
}

function mockRenderEntityDropdown(
  props: EntityDropdownStubProps,
): ReactElement {
  const testId: string = props.dataTestId || "entity-dropdown";
  mockEntityDropdowns[testId] = props;

  return (
    <div data-testid={`stub-entity-${testId}`}>
      {mockOptionsFor(props.modelType).map(
        (option: StubOption): ReactElement => {
          return (
            <button
              key={option.value}
              type="button"
              aria-label={`${props.ariaLabel || testId}: ${option.label}`}
              onClick={(): void => {
                props.onChange?.(
                  props.isMultiSelect ? [option.value] : option.value,
                );
              }}
            >
              {option.label}
            </button>
          );
        },
      )}
    </div>
  );
}

type Props = Record<string, unknown>;

interface TriggerCase {
  trigger: RunbookRuleTriggerEntity;
  entityLabel: string;
  criteria: Array<string>;
}

const TRIGGERS: Array<TriggerCase> = [
  {
    trigger: RunbookRuleTriggerEntity.Incident,
    entityLabel: "incident",
    criteria: [
      "Monitors",
      "Incident Severities",
      "Incident Labels",
      "Monitor Labels",
      "Incident Title",
      "Incident Description",
      "Monitor Name",
      "Monitor Description",
    ],
  },
  {
    trigger: RunbookRuleTriggerEntity.Alert,
    entityLabel: "alert",
    criteria: [
      "Monitors",
      "Alert Severities",
      "Alert Labels",
      "Monitor Labels",
      "Alert Title",
      "Alert Description",
      "Monitor Name",
      "Monitor Description",
    ],
  },
  {
    trigger: RunbookRuleTriggerEntity.ScheduledMaintenance,
    entityLabel: "scheduled maintenance event",
    criteria: [
      "Monitors",
      "Event Labels",
      "Monitor Labels",
      "Event Title",
      "Event Description",
      "Monitor Name",
      "Monitor Description",
    ],
  },
];

function tableProps(trigger: TriggerCase): Props {
  mockCapturedTableProps = [];
  render(
    <RunbookRulesTable
      triggerEntityType={trigger.trigger}
      entityLabel={trigger.entityLabel}
    />,
  );
  cleanup();

  const props: Props | undefined =
    mockCapturedTableProps[mockCapturedTableProps.length - 1];
  expect(props).toBeDefined();
  return props!;
}

function matchCriteriaFields(props: Props): Array<Field<RunbookRule>> {
  return getLegacyRuleCriteriaFields(
    props["formFields"] as Array<Field<RunbookRule>>,
  );
}

async function renderCreateForm(trigger: TriggerCase): Promise<void> {
  const props: Props = tableProps(trigger);

  render(
    <ModelForm<RunbookRule>
      modelType={RunbookRule}
      id="runbook-rule-form"
      name="Runbook Rule"
      fields={props["formFields"] as Fields<RunbookRule>}
      steps={props["formSteps"] as Array<FormStep<RunbookRule>>}
      formType={FormType.Create}
      initialValues={{ name: "Start the failover runbook", isEnabled: true }}
      submitButtonText="Create Runbook Rule"
    />,
  );

  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /Next/i }));
  await screen.findByTestId("rule-criteria-builder");
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

async function addCondition(
  index: number,
  criterion: string,
  value: string,
): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add condition" }));
  await selectOption(`Criteria for condition ${index + 1}`, criterion);
  await user.click(
    screen.getByRole("button", {
      name: `Value for condition ${index + 1}: ${value}`,
    }),
  );
}

async function pickRunbookAndCreate(): Promise<RunbookRule> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Next/i }));
  await user.click(
    await screen.findByRole("button", { name: "entity-dropdown: DB failover" }),
  );
  await user.click(screen.getByRole("button", { name: "Create Runbook Rule" }));

  await waitFor(() => {
    expect(submittedRule).not.toBeNull();
  });

  return submittedRule!;
}

beforeEach(() => {
  submittedRule = null;
  mockCapturedTableProps = [];

  for (const key of Object.keys(mockEntityDropdowns)) {
    delete mockEntityDropdowns[key];
  }
});

afterEach(() => {
  cleanup();
});

describe("Create New Runbook Rule - Match Criteria", () => {
  test.each(TRIGGERS)(
    "the $trigger Criteria dropdown lists what the other $entityLabel rules match on",
    async (trigger: TriggerCase) => {
      await renderCreateForm(trigger);
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Add condition" }));

      const menu: HTMLElement = await openMenu("Criteria for condition 1");
      const options: Array<string> = within(menu)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.textContent || "";
        });

      expect(options).toEqual(trigger.criteria);
      expect(menu).not.toHaveTextContent(/Pattern/);
    },
  );

  test("an incident rule runs on production monitors' critical incidents", async () => {
    const trigger: TriggerCase = TRIGGERS[0]!;
    await renderCreateForm(trigger);

    await addCondition(0, "Monitor Labels", "production");
    await addCondition(1, "Incident Severities", "Critical");

    // Each criterion picks from its own kind of record.
    expect(mockEntityDropdowns["rule-criteria-value-0"]?.modelType).toBe(Label);
    expect(mockEntityDropdowns["rule-criteria-value-1"]?.modelType).toBe(
      IncidentSeverity,
    );
    expect(screen.getByTestId("rule-criteria-row-0")).toHaveTextContent(
      "Has any of",
    );
    expect(screen.getByTestId("rule-criteria-connector-1")).toHaveTextContent(
      "And",
    );

    const rule: RunbookRule = await pickRunbookAndCreate();

    expect(rule.criteria).toEqual({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [LABEL_ID],
        },
        {
          field: "incidentSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [INCIDENT_SEVERITY_ID],
        },
      ],
    });

    // Old API pods still read the columns: they see a rule that matches nothing.
    expect(rule.titlePattern).toBe(RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN);
    expect(rule.descriptionPattern).toBeFalsy();
    expect(rule.monitorNamePattern).toBeFalsy();
    expect(rule.monitorDescriptionPattern).toBeFalsy();
    expect(rule.monitors).toEqual([]);
    expect(rule.incidentSeverities).toEqual([]);
    expect(rule.labels).toEqual([]);
    expect(rule.monitorLabels).toEqual([]);
    // An incident rule never writes the alert severities.
    expect(rule.alertSeverities).toBeUndefined();
  });

  test("an alert rule picks alert severities and the alert's own labels", async () => {
    const trigger: TriggerCase = TRIGGERS[1]!;
    await renderCreateForm(trigger);

    await addCondition(0, "Alert Severities", "High");
    await addCondition(1, "Alert Labels", "production");
    await addCondition(2, "Monitors", "checkout-api");

    expect(mockEntityDropdowns["rule-criteria-value-0"]?.modelType).toBe(
      AlertSeverity,
    );
    expect(mockEntityDropdowns["rule-criteria-value-1"]?.modelType).toBe(Label);
    expect(mockEntityDropdowns["rule-criteria-value-2"]?.modelType).toBe(
      Monitor,
    );

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.click(
      within(screen.getByTestId("rule-criteria-combine")).getByRole("radio", {
        name: "Match any",
      }),
    );

    const rule: RunbookRule = await pickRunbookAndCreate();

    expect(rule.criteria).toEqual({
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.Any,
      filters: [
        {
          field: "alertSeverities",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [ALERT_SEVERITY_ID],
        },
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [LABEL_ID],
        },
        {
          field: "monitors",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [MONITOR_ID],
        },
      ],
    });
    expect(rule.alertSeverities).toEqual([]);
    expect(rule.incidentSeverities).toBeUndefined();
  });

  test("a scheduled maintenance rule matches on the event's labels and has no severity", async () => {
    const trigger: TriggerCase = TRIGGERS[2]!;
    await renderCreateForm(trigger);

    await addCondition(0, "Event Labels", "production");

    const rule: RunbookRule = await pickRunbookAndCreate();

    expect(rule.criteria?.filters).toEqual([
      {
        field: "labels",
        operator: RuleCriteriaOperator.HasAnyOf,
        value: [LABEL_ID],
      },
    ]);
    expect(rule.incidentSeverities).toBeUndefined();
    expect(rule.alertSeverities).toBeUndefined();
  });

  test("text criteria still start on Contains and save as before", async () => {
    await renderCreateForm(TRIGGERS[0]!);
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await selectOption("Criteria for condition 1", "Monitor Name");
    expect(screen.getByTestId("rule-criteria-row-0")).toHaveTextContent(
      "Contains",
    );
    await user.type(screen.getByTestId("rule-criteria-value-0"), "checkout");

    const rule: RunbookRule = await pickRunbookAndCreate();

    expect(rule.criteria?.filters).toEqual([
      {
        field: "monitorNamePattern",
        operator: RuleCriteriaOperator.Contains,
        value: "checkout",
      },
    ]);
  });
});

describe("the runbook rule form's criteria", () => {
  test.each(TRIGGERS)(
    "$trigger rules offer exactly the criteria the engine evaluates for them",
    (trigger: TriggerCase) => {
      const fieldNames: Array<string | null> = matchCriteriaFields(
        tableProps(trigger),
      ).map((field: Field<RunbookRule>): string | null => {
        return getRuleCriteriaFieldName(field);
      });

      expect(fieldNames).toEqual([
        ...getRunbookRuleCriteriaFields(trigger.trigger),
      ]);
    },
  );

  test.each(TRIGGERS)(
    "$trigger rules pick monitors, severities and labels from their own models",
    (trigger: TriggerCase) => {
      const pickers: Record<string, unknown> = {};

      for (const field of matchCriteriaFields(tableProps(trigger))) {
        if (field.dropdownModal) {
          pickers[getRuleCriteriaFieldName(field)!] = field.dropdownModal.type;
        }
      }

      expect(pickers).toEqual({
        monitors: Monitor,
        ...(trigger.trigger === RunbookRuleTriggerEntity.Incident
          ? { incidentSeverities: IncidentSeverity }
          : {}),
        ...(trigger.trigger === RunbookRuleTriggerEntity.Alert
          ? { alertSeverities: AlertSeverity }
          : {}),
        labels: Label,
        monitorLabels: Label,
      });
    },
  );

  test("the match criteria are all on the Match Criteria step", () => {
    const props: Props = tableProps(TRIGGERS[0]!);
    const steps: Array<FormStep<RunbookRule>> = props["formSteps"] as Array<
      FormStep<RunbookRule>
    >;

    expect(
      steps.map((step: FormStep<RunbookRule>): string => {
        return step.title;
      }),
    ).toEqual(["Basic Info", "Match Criteria", "Runbooks"]);
    expect(
      matchCriteriaFields(props).every((field: Field<RunbookRule>) => {
        return field.stepId === MATCH_CRITERIA_STEP_ID && !field.required;
      }),
    ).toBe(true);
  });
});

describe("the runbook rule table", () => {
  function configuration(
    trigger: TriggerCase,
  ): RuleCriteriaTableConfiguration<RunbookRule> {
    const props: Props = tableProps(trigger);

    return getRuleCriteriaTableConfiguration<RunbookRule>({
      model: new RunbookRule(),
      formFields: props["formFields"] as Fields<RunbookRule>,
      columns: props["columns"] as Columns<RunbookRule>,
      filters: props["filters"] as Array<Filter<RunbookRule>>,
      selectMoreFields: props["selectMoreFields"] as Record<string, true>,
      helpContent: props["helpContent"] as {
        title: string;
        description?: string;
        markdown: string;
      },
    });
  }

  test.each(TRIGGERS)(
    "$trigger rules show what each rule matches beside its name",
    (trigger: TriggerCase) => {
      const tableConfiguration: RuleCriteriaTableConfiguration<RunbookRule> =
        configuration(trigger);

      expect(
        tableConfiguration.columns.map((column: Column<RunbookRule>) => {
          return column.title;
        }),
      ).toEqual(["Name", "Match Criteria", "Description", "Status"]);

      // The summary reads the criteria and every column a rule may still use.
      expect(tableConfiguration.selectMoreFields).toEqual(
        expect.objectContaining(
          Object.fromEntries(
            ["criteria", ...getRunbookRuleCriteriaFields(trigger.trigger)].map(
              (field: string): [string, true] => {
                return [field, true];
              },
            ),
          ),
        ),
      );
    },
  );

  test("the summary names the conditions the way the form does", () => {
    const rule: RunbookRule = new RunbookRule();
    rule.criteria = {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.Any,
      filters: [
        {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAnyOf,
          value: [LABEL_ID],
        },
        {
          field: "labels",
          operator: RuleCriteriaOperator.HasNoneOf,
          value: [LABEL_ID],
        },
      ],
    };

    expect(
      getRuleCriteriaSummaryText({
        fields: matchCriteriaFields(tableProps(TRIGGERS[1]!)),
        item: rule,
      }),
    ).toBe(
      "Match any: Monitor Labels has any of 1 selected value; Alert Labels has none of 1 selected value",
    );
  });

  test("a rule saved before conditions existed is summarised from its columns", () => {
    const rule: RunbookRule = new RunbookRule();
    rule.titlePattern = "database|postgres";

    expect(
      getRuleCriteriaSummaryText({
        fields: matchCriteriaFields(tableProps(TRIGGERS[0]!)),
        item: rule,
      }),
    ).toBe("Match all: Incident Title matches pattern “database|postgres”");
  });
});

describe("the runbook rule help", () => {
  test.each(TRIGGERS)(
    "$trigger help lists the page's criteria in its words",
    (trigger: TriggerCase) => {
      const markdown: string = getRunbookRuleDocumentation({
        triggerEntityType: trigger.trigger,
        entityLabel: trigger.entityLabel,
      });

      for (const criterion of trigger.criteria) {
        expect({ criterion, listed: markdown.includes(criterion) }).toEqual({
          criterion,
          listed: true,
        });
      }

      expect(markdown).not.toMatch(/\bPattern\b/);
      expect(markdown).toContain(`### What Conditions Can Check`);
      expect(markdown).toContain("Runbooks → Executions");
    },
  );

  test("scheduled maintenance help has no severities, incident and alert help do", () => {
    expect(
      getRunbookRuleDocumentation({
        triggerEntityType: RunbookRuleTriggerEntity.ScheduledMaintenance,
        entityLabel: "scheduled maintenance event",
      }),
    ).not.toContain("Severities");
    expect(
      getRunbookRuleDocumentation({
        triggerEntityType: RunbookRuleTriggerEntity.Incident,
        entityLabel: "incident",
      }),
    ).toContain("**Incident Severities**");
    expect(
      getRunbookRuleDocumentation({
        triggerEntityType: RunbookRuleTriggerEntity.Alert,
        entityLabel: "alert",
      }),
    ).toContain("**Alert Severities**");
  });

  test("the table's help is this text, its Match Criteria section rewritten for the builder", () => {
    const trigger: TriggerCase = TRIGGERS[0]!;
    const help: { markdown: string } = tableProps(trigger)["helpContent"] as {
      markdown: string;
    };
    const markdown: string = getRunbookRuleDocumentation({
      triggerEntityType: trigger.trigger,
      entityLabel: trigger.entityLabel,
    });

    expect(help.markdown).toBe(markdown);

    const shown: string = replaceRuleCriteriaHelpMarkdown(markdown);

    // The list of what a condition can check is outside the rewritten part.
    expect(shown).toContain("### What Conditions Can Check");
    expect(shown).toContain("**Monitor Labels**");
    expect(shown).toContain("### Match Criteria");
    expect(shown).toContain(RULE_CRITERIA_HELP_SECTION_BODY);
    expect(shown).toContain("### Action");
  });
});
