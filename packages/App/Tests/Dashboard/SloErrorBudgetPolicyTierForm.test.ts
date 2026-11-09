import { describe, expect, test } from "@jest/globals";
import {
  ERROR_BUDGET_POLICY_TIER_FORM_FIELDS,
  POLICY_TIER_OUTPUTS_SECTION,
  POLICY_TIER_OUTPUTS_SUMMARY,
  POLICY_TIER_TEMPLATE_VARIABLES_DESCRIPTION,
  describePolicyTierOutputOptions,
  describePolicyTierOutputs,
  getPolicyTierOutputsSummary,
  policyTierCreatesAlert,
  policyTierDeclaresIncident,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/ErrorBudgetPolicyTierForm";
import {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
  describeBurnRateOutputs,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleForm";
import {
  DEPLOYMENTS_FROZEN_SINCE_TEMPLATE,
  DEPLOYMENTS_FROZEN_TEXT,
  POLICY_TIER_DEPLOYMENTS_ALLOWED_TEXT,
  POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT,
  POLICY_TIER_LINE_COLOR,
  describePolicyTierDeployments,
  getSloCurrentPolicyTier,
  getSloDeploymentFreeze,
  getSloPolicyTierLineLabel,
  getSloPolicyTierReferenceLines,
  isSloInPolicyTier,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloPolicyTier";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import ObjectID from "Common/Types/ObjectID";
import {
  TemplateVariable,
  TemplateVariableGroup,
} from "Common/Types/Template/TemplateVariable";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import { getPeoplePickerValueKeys } from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
  DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
  SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
  SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
  SLO_POLICY_TIER_TEMPLATE_VARIABLES,
  SloBurnRateTemplateVariableDefinition,
} from "Common/Utils/Slo/SloBurnRateTemplate";
import {
  SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";

/*
 * The form of a tier of an SLO's error budget policy. App has no renderer,
 * so the field list itself is asserted - the rendered form is
 * Common/Tests/UI/Components/Forms/BasicFormPolicyTierOutputs.
 *
 * What a tier is - a name, a budget-left threshold, what the team does - is
 * asked first and plainly; everything a tier can raise sits in one folded
 * section, switched off, built from the same builders as a burn rate rule's
 * outputs but with the tier's template variables and defaults. And the
 * burn rate rule's form, which those builders came out of, keeps its own.
 */

type FieldOf = ModelField<ServiceLevelObjectiveErrorBudgetPolicyTier>;
type TierValues = FormValues<ServiceLevelObjectiveErrorBudgetPolicyTier>;

const FIELDS: Array<FieldOf> = ERROR_BUDGET_POLICY_TIER_FORM_FIELDS;

function columnOf(field: FieldOf): string {
  const keys: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  expect(keys).toHaveLength(1);

  return keys[0]!;
}

// The columns a field writes: its one column, or a people picker's two.
function columnsOf(field: FieldOf): Array<string> {
  if (field.peoplePicker) {
    return getPeoplePickerValueKeys(field.peoplePicker);
  }

  return [columnOf(field)];
}

function fieldFor(column: string): FieldOf {
  const field: FieldOf | undefined = FIELDS.find(
    (candidate: FieldOf): boolean => {
      return columnsOf(candidate).includes(column);
    },
  );

  if (!field) {
    throw new Error(`No form field for column "${column}".`);
  }

  return field;
}

function metadataOf(column: string): TableColumnMetadata {
  return new ServiceLevelObjectiveErrorBudgetPolicyTier().getTableColumnMetadata(
    column,
  );
}

const ALERT_COLUMNS: Array<string> = [
  "alertTitleTemplate",
  "alertSeverity",
  "alertDescriptionTemplate",
  "alertOwnerUsers",
  "alertOwnerTeams",
  "alertLabels",
  "onCallDutyPolicies",
  "autoResolveAlert",
  "isAlertPrivate",
  "alertRemediationNotes",
];

const INCIDENT_COLUMNS: Array<string> = [
  "incidentTitleTemplate",
  "incidentSeverity",
  "incidentDescriptionTemplate",
  "incidentOwnerUsers",
  "incidentOwnerTeams",
  "incidentLabels",
  "incidentOnCallDutyPolicies",
  "autoResolveIncident",
  "isIncidentPrivate",
  "incidentRemediationNotes",
];

describe("the error budget policy tier form", () => {
  test("asks a tier's own three fields first, by the model's titles, unfolded and required", () => {
    const simple: Array<FieldOf> = FIELDS.slice(0, 3);

    expect(simple.map(columnOf)).toEqual([
      "name",
      "thresholdPercentage",
      "whatWeDo",
    ]);

    for (const field of simple) {
      const column: string = columnOf(field);

      expect({ column, title: field.title }).toEqual({
        column,
        title: metadataOf(column).title,
      });
      expect(field.required).toBe(true);
      expect(field.collapsibleSection).toBeUndefined();
      expect(field.showIf).toBeUndefined();
      expect(field.placeholder).toBeTruthy();
    }

    expect(
      simple.map((field: FieldOf): string | undefined => {
        return field.title;
      }),
    ).toEqual(["Name", "Budget Left Threshold (%)", "What We Do"]);
  });

  test("takes a threshold from 0 to 100, as the server does, and What We Do as Markdown up to its limit", () => {
    const threshold: FieldOf = fieldFor("thresholdPercentage");

    expect(threshold.fieldType).toBe(FormFieldSchemaType.Number);
    expect(threshold.validation).toEqual({
      minValue: SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE,
      maxValue: SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE,
    });
    expect(SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE).toBe(0);
    expect(SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE).toBe(100);

    const whatWeDo: FieldOf = fieldFor("whatWeDo");

    expect(whatWeDo.fieldType).toBe(FormFieldSchemaType.Markdown);
    expect(metadataOf("whatWeDo").type).toBe(TableColumnType.Markdown);
    expect(whatWeDo.validation?.maxLength).toBe(
      SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
    );
  });

  test("asks Freeze Deployments under What We Do, with the tier's own fields: unfolded, off, on the Create form too", () => {
    const freeze: FieldOf = fieldFor("freezesDeployments");

    // Right after the three fields a tier is made of, before Enabled.
    expect(FIELDS.indexOf(freeze)).toBe(3);
    expect(FIELDS.slice(0, 5).map(columnOf)).toEqual([
      "name",
      "thresholdPercentage",
      "whatWeDo",
      "freezesDeployments",
      "isEnabled",
    ]);

    expect(freeze.title).toBe(metadataOf("freezesDeployments").title);
    expect(freeze.title).toBe("Freeze Deployments");
    expect(freeze.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(freeze.required).toBe(false);
    // Not one of the outputs: it raises nothing, so it is not folded with them.
    expect(freeze.collapsibleSection).toBeUndefined();
    expect(freeze.showIf).toBeUndefined();
    // A tier's switch from the start, not an edit-only one like Enabled.
    expect(freeze.doNotShowWhenCreating).toBeUndefined();
    // Off by default, as its column: BasicForm applies only a truthy default.
    expect(freeze.defaultValue).toBeUndefined();
    expect(metadataOf("freezesDeployments").defaultValue).toBe(false);
    // Says what it does in the form's own words.
    expect(freeze.description).toBe(
      "While the SLO is in this tier, CI/CD pipelines that check it hold back releases.",
    );
  });

  test("Enabled is on the Edit form only, outside the fold: a new tier starts on", () => {
    const enabled: FieldOf = fieldFor("isEnabled");

    expect(enabled.doNotShowWhenCreating).toBe(true);
    expect(enabled.defaultValue).toBe(true);
    expect(enabled.collapsibleSection).toBeUndefined();
    expect(metadataOf("isEnabled").defaultValue).toBe(true);
  });

  test("folds every alert and incident setting into one section, after the tier's own fields", () => {
    const folded: Array<FieldOf> = FIELDS.filter((field: FieldOf): boolean => {
      return Boolean(field.collapsibleSection);
    });

    // One section, the same object for every field, so BasicForm draws one fold.
    for (const field of folded) {
      expect(field.collapsibleSection).toBe(POLICY_TIER_OUTPUTS_SECTION);
    }

    // Written one after another, at the end: nothing unfolded splits it.
    const firstFolded: number = FIELDS.indexOf(folded[0]!);

    expect(FIELDS.slice(firstFolded)).toEqual(folded);
    expect(folded.flatMap(columnsOf)).toEqual([
      "shouldCreateAlert",
      ...ALERT_COLUMNS,
      "shouldCreateIncident",
      ...INCIDENT_COLUMNS,
      "addSloOwnersAsOwners",
    ]);

    // A card named for what it holds, not More fields.
    expect(POLICY_TIER_OUTPUTS_SECTION.title).toBe("Alerts and incidents");
    expect(POLICY_TIER_OUTPUTS_SECTION.variant).toBeUndefined();
    expect(POLICY_TIER_OUTPUTS_SECTION.listFieldsWhileFolded).toBeUndefined();
  });

  test("the fold starts folded on a new tier - the prefilled templates do not count - and opens on one that raises something", () => {
    const defaults: TierValues = Object.fromEntries(
      FIELDS.filter((field: FieldOf): boolean => {
        return field.defaultValue !== undefined;
      }).map((field: FieldOf): [string, unknown] => {
        return [columnOf(field), field.defaultValue];
      }),
    ) as TierValues;

    expect(defaults.alertTitleTemplate).toBe(
      DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
    );
    expect(POLICY_TIER_OUTPUTS_SECTION.isConfigured!({})).toBe(false);
    expect(POLICY_TIER_OUTPUTS_SECTION.isConfigured!(defaults)).toBe(false);
    expect(
      POLICY_TIER_OUTPUTS_SECTION.isConfigured!({
        ...defaults,
        shouldCreateAlert: true,
      }),
    ).toBe(true);
    expect(
      POLICY_TIER_OUTPUTS_SECTION.isConfigured!({ shouldCreateIncident: true }),
    ).toBe(true);
  });

  test("folded, it says in a sentence what the tier raises", () => {
    expect(getPolicyTierOutputsSummary({})).toEqual([
      POLICY_TIER_OUTPUTS_SUMMARY.nothing,
    ]);
    expect(getPolicyTierOutputsSummary({ shouldCreateAlert: true })).toEqual([
      POLICY_TIER_OUTPUTS_SUMMARY.alert,
    ]);
    expect(getPolicyTierOutputsSummary({ shouldCreateIncident: true })).toEqual(
      [POLICY_TIER_OUTPUTS_SUMMARY.incident],
    );
    expect(
      getPolicyTierOutputsSummary({
        shouldCreateAlert: true,
        shouldCreateIncident: true,
      }),
    ).toEqual([POLICY_TIER_OUTPUTS_SUMMARY.both]);
    expect(POLICY_TIER_OUTPUTS_SECTION.getSummary!({})).toEqual(
      getPolicyTierOutputsSummary({}),
    );
  });

  test("both switches start off, as the tier's columns default, and nothing requires one", () => {
    for (const column of ["shouldCreateAlert", "shouldCreateIncident"]) {
      const field: FieldOf = fieldFor(column);

      expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
      expect(field.defaultValue).toBeUndefined();
      expect(field.required).toBe(false);
      expect(field.customValidation).toBeUndefined();
      expect(metadataOf(column).defaultValue).toBe(false);
      // The switches are always there to switch on.
      expect(field.showIf).toBeUndefined();
    }

    // A tier may raise nothing at all: no field refuses one that does.
    for (const field of FIELDS) {
      expect({
        column: columnsOf(field)[0],
        refuses: Boolean(field.customValidation?.({})),
      }).toEqual({ column: columnsOf(field)[0], refuses: false });
    }
  });

  test("each output's fields show only while its switch is on; the SLO owners switch while either is", () => {
    const values: Array<TierValues> = [
      {},
      { shouldCreateAlert: true },
      { shouldCreateIncident: true },
      { shouldCreateAlert: true, shouldCreateIncident: true },
      { shouldCreateAlert: false, shouldCreateIncident: false },
    ];

    for (const value of values) {
      for (const column of ALERT_COLUMNS) {
        expect({
          column,
          value,
          shown: fieldFor(column).showIf!(value),
        }).toEqual({ column, value, shown: value.shouldCreateAlert === true });
      }

      for (const column of INCIDENT_COLUMNS) {
        expect({
          column,
          value,
          shown: fieldFor(column).showIf!(value),
        }).toEqual({
          column,
          value,
          shown: value.shouldCreateIncident === true,
        });
      }

      expect(fieldFor("addSloOwnersAsOwners").showIf!(value)).toBe(
        value.shouldCreateAlert === true || value.shouldCreateIncident === true,
      );
    }
  });

  test("every toggle shows exactly what its column holds on a new tier", () => {
    const toggles: Array<FieldOf> = FIELDS.filter((field: FieldOf): boolean => {
      return field.fieldType === FormFieldSchemaType.Toggle;
    });

    expect(toggles.map(columnOf)).toEqual([
      "freezesDeployments",
      "isEnabled",
      "shouldCreateAlert",
      "autoResolveAlert",
      "isAlertPrivate",
      "shouldCreateIncident",
      "autoResolveIncident",
      "isIncidentPrivate",
      "addSloOwnersAsOwners",
    ]);

    for (const toggle of toggles) {
      const column: string = columnOf(toggle);
      const metadata: TableColumnMetadata = metadataOf(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);
      expect({ column, defaultValue: toggle.defaultValue }).toEqual({
        column,
        defaultValue: metadata.defaultValue === true ? true : undefined,
      });
    }
  });

  test("offers every column a person sets on a tier, and no column twice", () => {
    const onForm: Array<string> = FIELDS.flatMap(columnsOf);

    expect(new Set(onForm).size).toBe(onForm.length);

    const deliberatelyAbsent: Set<string> = new Set([
      // Set by the page from the route, never typed in.
      "project",
      "projectId",
      "serviceLevelObjective",
      "serviceLevelObjectiveId",
      // Relation columns the form edits through their entity twin.
      "alertSeverityId",
      "incidentSeverityId",
      "createdByUser",
      "createdByUserId",
      "deletedByUser",
      "deletedByUserId",
    ]);
    const baseColumns: Set<string> = new Set([
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
      "slug",
    ]);

    for (const column of new ServiceLevelObjectiveErrorBudgetPolicyTier().getTableColumns()
      .columns) {
      // The worker's lifecycle stamps.
      if (
        column.startsWith("last") ||
        deliberatelyAbsent.has(column) ||
        baseColumns.has(column)
      ) {
        continue;
      }

      expect({ column, onForm: onForm.includes(column) }).toEqual({
        column,
        onForm: true,
      });
    }
  });

  test("the tier's template fields offer the tier's variables, prefilled with the tier's defaults", () => {
    for (const column of [
      "alertTitleTemplate",
      "alertDescriptionTemplate",
      "alertRemediationNotes",
      "incidentTitleTemplate",
      "incidentDescriptionTemplate",
      "incidentRemediationNotes",
    ]) {
      const field: FieldOf = fieldFor(column);

      expect({ column, groups: field.templateVariables }).toEqual({
        column,
        groups: SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS,
      });
      expect(field.templateVariablesDescription).toBe(
        POLICY_TIER_TEMPLATE_VARIABLES_DESCRIPTION,
      );
    }

    for (const column of ["alertTitleTemplate", "incidentTitleTemplate"]) {
      const field: FieldOf = fieldFor(column);

      expect(field.defaultValue).toBe(DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE);
      expect(field.placeholder).toBe(DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE);
      expect(field.description).toContain(
        DEFAULT_SLO_POLICY_TIER_TITLE_TEMPLATE,
      );
      expect(field.description).toContain("this tier");
    }

    for (const column of [
      "alertDescriptionTemplate",
      "incidentDescriptionTemplate",
    ]) {
      expect(fieldFor(column).defaultValue).toBe(
        DEFAULT_SLO_POLICY_TIER_DESCRIPTION_TEMPLATE,
      );
    }

    // Offered is what a tier's templates fill in: the rule's own are not.
    const offered: Array<string> =
      SLO_POLICY_TIER_TEMPLATE_VARIABLE_GROUPS.flatMap(
        (group: TemplateVariableGroup): Array<string> => {
          return group.variables.map((variable: TemplateVariable): string => {
            return variable.name;
          });
        },
      );

    expect(offered).toEqual(
      SLO_POLICY_TIER_TEMPLATE_VARIABLES.map(
        (definition: SloBurnRateTemplateVariableDefinition): string => {
          return definition.key;
        },
      ),
    );
    expect(offered).toContain("policyTier");
    expect(offered).not.toContain("ruleName");
  });

  test("every output field writes a column the tier has, of the type the rule's twin has", () => {
    const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
      new ServiceLevelObjectiveErrorBudgetPolicyTier();
    const rule: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();

    for (const column of [...ALERT_COLUMNS, ...INCIDENT_COLUMNS]) {
      expect({
        column,
        type: tier.getTableColumnMetadata(column)?.type,
      }).toEqual({
        column,
        type: rule.getTableColumnMetadata(column)?.type,
      });
    }
  });
});

describe("the burn rate rule form, which the output fields came from", () => {
  function burnRateField(
    column: string,
  ): ModelField<ServiceLevelObjectiveBurnRateRule> {
    const field: ModelField<ServiceLevelObjectiveBurnRateRule> | undefined =
      BURN_RATE_RULE_FORM_FIELDS.find(
        (candidate: ModelField<ServiceLevelObjectiveBurnRateRule>): boolean => {
          return Object.keys(candidate.field || {})[0] === column;
        },
      );

    if (!field) {
      throw new Error(`No burn rate rule field for "${column}".`);
    }

    return field;
  }

  test("keeps a rule's own variables, defaults, steps and sections", () => {
    for (const column of [
      "alertTitleTemplate",
      "incidentDescriptionTemplate",
    ]) {
      expect(burnRateField(column).templateVariables).toEqual(
        SLO_BURN_RATE_TEMPLATE_VARIABLE_GROUPS,
      );
      expect(burnRateField(column).templateVariablesDescription).toBe(
        BURN_RATE_TEMPLATE_VARIABLES_DESCRIPTION,
      );
      expect(burnRateField(column).showIf).toBeUndefined();
    }

    expect(burnRateField("alertTitleTemplate").defaultValue).toBe(
      DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
    );
    expect(burnRateField("alertDescriptionTemplate").defaultValue).toBe(
      DEFAULT_SLO_BURN_RATE_DESCRIPTION_TEMPLATE,
    );
    expect(burnRateField("alertTitleTemplate").description).toContain(
      "this rule",
    );
    expect(burnRateField("alertTitleTemplate").stepId).toBe("alert-details");
    expect(burnRateField("incidentLabels").stepId).toBe("incident-details");
    expect(
      burnRateField("alertDescriptionTemplate").collapsibleSection?.id,
    ).toBe("alert-description");
  });

  /*
   * What Common's OverloadedFormStepsGuard read on the rule's Alert and
   * Incident steps until their fields moved into the shared output helpers,
   * which place a field on its step by an argument that guard leaves to
   * these tests: two fields open, and everything else in four folded
   * sections, each drawn as one row.
   */
  test("asks only the title and the severity open on its Alert and Incident steps, and folds the rest into four sections", () => {
    for (const output of ["alert", "incident"]) {
      const onStep: Array<ModelField<ServiceLevelObjectiveBurnRateRule>> =
        BURN_RATE_RULE_FORM_FIELDS.filter(
          (field: ModelField<ServiceLevelObjectiveBurnRateRule>): boolean => {
            return field.stepId === `${output}-details`;
          },
        );

      expect(
        onStep
          .filter(
            (field: ModelField<ServiceLevelObjectiveBurnRateRule>): boolean => {
              return !field.collapsibleSection;
            },
          )
          .map(
            (field: ModelField<ServiceLevelObjectiveBurnRateRule>): string => {
              return Object.keys(field.field || {})[0] || "";
            },
          ),
      ).toEqual([`${output}TitleTemplate`, `${output}Severity`]);

      // Each section once, its fields one after another: one row each.
      const sections: Array<string> = [];

      for (const field of onStep) {
        const id: string | undefined = field.collapsibleSection?.id;

        if (id && sections[sections.length - 1] !== id) {
          sections.push(id);
        }
      }

      expect(sections).toEqual([
        `${output}-description`,
        `${output}-ownership`,
        `${output}-on-call`,
        `${output}-advanced`,
      ]);
    }
  });

  test("and the two forms ask the outputs with the same fields", () => {
    const tierTitles: Array<string | undefined> = FIELDS.filter(
      (field: FieldOf): boolean => {
        return [...ALERT_COLUMNS, ...INCIDENT_COLUMNS].includes(
          columnsOf(field)[0]!,
        );
      },
    ).map((field: FieldOf): string | undefined => {
      return field.title;
    });
    const ruleTitles: Array<string | undefined> =
      BURN_RATE_RULE_FORM_FIELDS.filter(
        (field: ModelField<ServiceLevelObjectiveBurnRateRule>): boolean => {
          return Boolean(field.stepId?.endsWith("-details"));
        },
      ).map(
        (
          field: ModelField<ServiceLevelObjectiveBurnRateRule>,
        ): string | undefined => {
          return field.title;
        },
      );

    expect(tierTitles).toEqual(ruleTitles);
    expect(tierTitles).toHaveLength(18);
  });
});

describe("what a tier raises, as the table says it", () => {
  test("reads the tier's own defaults: a tier read without its columns raises nothing", () => {
    expect(policyTierCreatesAlert({})).toBe(false);
    expect(policyTierDeclaresIncident({})).toBe(false);
    expect(describePolicyTierOutputs({})).toBe("Nothing");
    // Unlike a rule, whose alert defaults on.
    expect(
      describeBurnRateOutputs(new ServiceLevelObjectiveBurnRateRule()),
    ).toBe("Alert");
  });

  test("names each output, and the options a row would not otherwise reveal", () => {
    expect(describePolicyTierOutputs({ shouldCreateAlert: true })).toBe(
      "Alert",
    );
    expect(describePolicyTierOutputs({ shouldCreateIncident: true })).toBe(
      "Incident",
    );
    expect(
      describePolicyTierOutputs({
        shouldCreateAlert: true,
        shouldCreateIncident: true,
      }),
    ).toBe("Alert + Incident");

    expect(
      describePolicyTierOutputOptions({
        shouldCreateAlert: true,
        autoResolveAlert: false,
        shouldCreateIncident: true,
        isIncidentPrivate: true,
        addSloOwnersAsOwners: true,
      }),
    ).toEqual([
      "Alert: resolved by hand",
      "Incident: private",
      "SLO owners added as owners",
    ]);

    // Options of an output the tier does not raise say nothing.
    expect(
      describePolicyTierOutputOptions({
        isAlertPrivate: true,
        autoResolveIncident: false,
        addSloOwnersAsOwners: true,
      }),
    ).toEqual([]);
  });
});

describe("the tier an SLO is in, and the lines a budget chart draws", () => {
  function tier(data: {
    id?: string;
    name: string;
    thresholdPercentage: number;
    isEnabled?: boolean;
  }): ServiceLevelObjectiveErrorBudgetPolicyTier {
    const row: ServiceLevelObjectiveErrorBudgetPolicyTier =
      new ServiceLevelObjectiveErrorBudgetPolicyTier();
    row._id = data.id || ObjectID.generate().toString();
    row.name = data.name;
    row.thresholdPercentage = data.thresholdPercentage;
    row.whatWeDo = `What we do in ${data.name}.`;
    row.isEnabled = data.isEnabled ?? true;
    return row;
  }

  const LINES: Array<ChartReferenceLineProps> = [
    { value: 0, label: "Budget exhausted", color: "#ef4444" },
    { value: 20, label: "At risk (20%)", color: "#f59e0b" },
  ];

  test("draws every enabled tier, highest first, named with its threshold", () => {
    const lines: Array<ChartReferenceLineProps> =
      getSloPolicyTierReferenceLines({
        lines: LINES,
        tiers: [
          tier({ name: "Reliability first", thresholdPercentage: 25 }),
          tier({ name: "Caution", thresholdPercentage: 50 }),
          tier({ name: "Off", thresholdPercentage: 75, isEnabled: false }),
          tier({ name: "Sliver", thresholdPercentage: 2.5 }),
        ],
      });

    expect(
      lines.map(
        (line: ChartReferenceLineProps): [number, string | undefined] => {
          return [line.value, line.label];
        },
      ),
    ).toEqual([
      [0, "Budget exhausted"],
      [20, "At risk (20%)"],
      [50, "Caution 50%"],
      [25, "Reliability first 25%"],
      [2.5, "Sliver 2.5%"],
    ]);
    expect(lines[2]!.color).toBe(POLICY_TIER_LINE_COLOR);
    // The lines it was given are not changed.
    expect(LINES[1]!.label).toBe("At risk (20%)");
  });

  test("says a tier that sits on a line already drawn on that line, once", () => {
    expect(
      getSloPolicyTierReferenceLines({
        lines: LINES,
        tiers: [
          tier({ name: "Budget exhausted", thresholdPercentage: 0 }),
          tier({ name: "Slowdown", thresholdPercentage: 20 }),
        ],
      }).map(
        (
          line: ChartReferenceLineProps,
        ): [number, string | undefined, string] => {
          return [line.value, line.label, line.color];
        },
      ),
    ).toEqual([
      [0, "Budget exhausted 0%", "#ef4444"],
      [20, "At risk (20%) · Slowdown 20%", "#f59e0b"],
    ]);
  });

  test("draws nothing more without a policy", () => {
    expect(getSloPolicyTierReferenceLines({ lines: LINES, tiers: [] })).toEqual(
      LINES,
    );
    expect(
      getSloPolicyTierLineLabel({ name: "Caution", thresholdPercentage: "50" }),
    ).toBe("Caution 50%");
  });

  test("finds the tier the SLO is in by its id, with when it entered it", () => {
    const caution: ServiceLevelObjectiveErrorBudgetPolicyTier = tier({
      name: "Caution",
      thresholdPercentage: 50,
    });
    const slo: ServiceLevelObjective = new ServiceLevelObjective();

    expect(isSloInPolicyTier(slo)).toBe(false);
    expect(getSloCurrentPolicyTier({ slo, tiers: [caution] })).toBeNull();

    slo.currentErrorBudgetPolicyTierId = new ObjectID(
      caution._id!.toUpperCase(),
    );
    slo.currentErrorBudgetPolicyTierName = "Caution (old name)";
    slo.currentErrorBudgetPolicyTierEnteredAt = new Date(
      "2026-11-08T10:00:00.000Z",
    );

    expect(isSloInPolicyTier(slo)).toBe(true);
    expect(getSloCurrentPolicyTier({ slo, tiers: [caution] })).toEqual({
      // The tier's own name: a rename shows at once.
      name: "Caution",
      tier: caution,
      thresholdPercentage: 50,
      whatWeDo: "What we do in Caution.",
      enteredAt: new Date("2026-11-08T10:00:00.000Z"),
    });

    // The tier is gone: the name the worker wrote on the SLO.
    expect(getSloCurrentPolicyTier({ slo, tiers: [] })).toEqual({
      name: "Caution (old name)",
      tier: null,
      thresholdPercentage: null,
      whatWeDo: "",
      enteredAt: new Date("2026-11-08T10:00:00.000Z"),
    });
  });
});

describe("the deploy gate, as the SLO's pages draw it", () => {
  test("a tier's row says Frozen for a tier that freezes deployments, Allowed for any other", () => {
    expect(describePolicyTierDeployments({ freezesDeployments: true })).toBe(
      POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT,
    );
    expect(POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT).toBe("Frozen");

    for (const freezesDeployments of [false, null, undefined]) {
      expect(describePolicyTierDeployments({ freezesDeployments })).toBe(
        POLICY_TIER_DEPLOYMENTS_ALLOWED_TEXT,
      );
    }

    expect(POLICY_TIER_DEPLOYMENTS_ALLOWED_TEXT).toBe("Allowed");
  });

  test("the SLO's answer is a freeze only when it says false, with since when", () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();

    // Never evaluated, or read without the column: nothing froze it.
    expect(getSloDeploymentFreeze(slo)).toBeNull();
    expect(getSloDeploymentFreeze(null)).toBeNull();
    expect(getSloDeploymentFreeze(undefined)).toBeNull();

    slo.deploymentsAllowed = true;
    slo.deploymentsFrozenAt = new Date("2026-11-08T10:00:00.000Z");
    // A time left over on an allowed answer is no freeze.
    expect(getSloDeploymentFreeze(slo)).toBeNull();

    slo.deploymentsAllowed = false;
    expect(getSloDeploymentFreeze(slo)).toEqual({
      frozenAt: new Date("2026-11-08T10:00:00.000Z"),
    });

    // The API hands a date over as text.
    slo.deploymentsFrozenAt = "2026-11-08T10:00:00.000Z" as unknown as Date;
    expect(getSloDeploymentFreeze(slo)?.frozenAt?.toISOString()).toBe(
      "2026-11-08T10:00:00.000Z",
    );

    // Frozen, read without the time: a freeze, since when unknown.
    const withoutTime: ServiceLevelObjective = new ServiceLevelObjective();
    withoutTime.deploymentsAllowed = false;
    expect(getSloDeploymentFreeze(withoutTime)).toEqual({ frozenAt: null });
  });

  test("the Overview's badge says since when as one sentence with the time in it", () => {
    expect(DEPLOYMENTS_FROZEN_SINCE_TEMPLATE).toBe(
      "Deployments frozen since {{time}}",
    );
    expect(DEPLOYMENTS_FROZEN_TEXT).toBe("Deployments frozen");
  });
});
