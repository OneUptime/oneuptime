import { describe, expect, test } from "@jest/globals";
import {
  BURN_RATE_RULE_FORM_FIELDS,
  BURN_RATE_RULE_FORM_STEPS,
  BURN_RATE_RULE_OWNER_USER_COLUMNS,
  FetchBurnRateRuleOwnerUserOptionsFunction,
  validateBurnRateOutputs,
  willCreateAlert,
  willDeclareIncident,
  withOwnerUserDropdownOptions,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleForm";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import {
  DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
  SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
  SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
  isSloBurnRateTemplateVariable,
} from "Common/Utils/Slo/SloBurnRateTemplate";

/*
 * The create form is a wizard now, and every way of getting a wizard wrong is
 * silent. A field whose stepId matches no step is on no step, so it never
 * renders — it does not fail to compile and it does not throw. A per-output
 * step whose showIf disagrees with the toggle that gates it either hides a step
 * the user needs or shows one for an output that is off. And the validator that
 * forbids an output-less rule can only see the fields of the step being left
 * (Validation.validate skips every field whose stepId is not the current one),
 * so the two toggles have to share a step or the rule cannot be enforced at
 * all.
 *
 * None of that is reachable by rendering under the App project's node
 * environment, so the two arrays live in the form's React-free half and this
 * suite asserts on the real values rather than on source text. Importing them
 * from the page instead would pull the whole component graph — and react,
 * which App does not have — into App's test program;
 * FeatureSetImportsStayReactFree.test.ts is the guard for that.
 */

type FieldOf = ModelField<ServiceLevelObjectiveBurnRateRule>;
type StepOf = FormStep<ServiceLevelObjectiveBurnRateRule>;

const ALERT_STEPS: Array<string> = ["alert-details"];
const INCIDENT_STEPS: Array<string> = ["incident-details"];

function stepIds(): Array<string> {
  return BURN_RATE_RULE_FORM_STEPS.map((step: StepOf): string => {
    return step.id;
  });
}

function stepById(id: string): StepOf {
  const step: StepOf | undefined = BURN_RATE_RULE_FORM_STEPS.find(
    (candidate: StepOf): boolean => {
      return candidate.id === id;
    },
  );

  if (!step) {
    throw new Error(`No form step declared with id "${id}".`);
  }

  return step;
}

/*
 * ModelField's `field` is a one-key select object, which is how the form names
 * the column. Reading the key back is the only way to say "the shouldCreateAlert
 * field" without depending on array positions that a reorder would shuffle.
 */
function columnOf(field: FieldOf): string {
  const keys: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  if (keys.length !== 1) {
    throw new Error(
      `Expected exactly one column per form field, got ${JSON.stringify(keys)}.`,
    );
  }

  return keys[0]!;
}

function fieldFor(column: string): FieldOf {
  const field: FieldOf | undefined = BURN_RATE_RULE_FORM_FIELDS.find(
    (candidate: FieldOf): boolean => {
      return columnOf(candidate) === column;
    },
  );

  if (!field) {
    throw new Error(`No form field for column "${column}".`);
  }

  return field;
}

function columnsOnStep(stepId: string): Array<string> {
  return BURN_RATE_RULE_FORM_FIELDS.filter((field: FieldOf): boolean => {
    return field.stepId === stepId;
  }).map(columnOf);
}

function columnMetadata(column: string): TableColumnMetadata {
  return new ServiceLevelObjectiveBurnRateRule().getTableColumnMetadata(column);
}

function descriptionOf(field: FieldOf): string {
  if (typeof field.description !== "string") {
    throw new Error(
      `Field "${columnOf(field)}" has no plain-text description.`,
    );
  }

  return field.description;
}

describe("the burn rate rule form steps", () => {
  test("walk the questions a rule answers, output by output, in order", () => {
    expect(stepIds()).toEqual([
      "rule",
      "burn-window",
      "declares",
      "alert-details",
      "incident-details",
    ]);

    expect(
      BURN_RATE_RULE_FORM_STEPS.map((step: StepOf): string => {
        return step.title;
      }),
    ).toEqual(["Rule", "Burn Window", "What It Declares", "Alert", "Incident"]);
  });

  test("every step id is unique", () => {
    expect(new Set(stepIds()).size).toBe(stepIds().length);
  });

  test("every field is assigned to a step that exists", () => {
    const declared: Set<string> = new Set(stepIds());

    for (const field of BURN_RATE_RULE_FORM_FIELDS) {
      /*
       * A field with no stepId, or one naming a step that is not declared,
       * renders on no step at all. It is not a compile error and not a runtime
       * error — the field simply vanishes from the form.
       */
      expect(field.stepId).toBeTruthy();
      expect(declared.has(field.stepId!)).toBe(true);
    }
  });

  test("every step has at least one field", () => {
    for (const id of stepIds()) {
      expect(columnsOnStep(id).length).toBeGreaterThan(0);
    }
  });

  test("no column appears on the form twice", () => {
    const columns: Array<string> = BURN_RATE_RULE_FORM_FIELDS.map(columnOf);

    expect(new Set(columns).size).toBe(columns.length);
  });

  test("each step carries the fields that answer its question", () => {
    expect(columnsOnStep("rule")).toEqual(["name", "isEnabled"]);

    expect(columnsOnStep("burn-window")).toEqual([
      "burnRateThreshold",
      "longWindowInMinutes",
      "shortWindowInMinutes",
      "refireSuppressionMinutes",
    ]);

    expect(columnsOnStep("declares")).toEqual([
      "shouldCreateAlert",
      "shouldCreateIncident",
      "addSloOwnersAsOwners",
    ]);

    expect(columnsOnStep("alert-details")).toEqual([
      "alertTitleTemplate",
      "alertSeverity",
      "alertDescriptionTemplate",
      "alertOwnerTeams",
      "alertOwnerUsers",
      "alertLabels",
      "onCallDutyPolicies",
      "autoResolveAlert",
      "isAlertPrivate",
      "alertRemediationNotes",
    ]);

    expect(columnsOnStep("incident-details")).toEqual([
      "incidentTitleTemplate",
      "incidentSeverity",
      "incidentDescriptionTemplate",
      "incidentOwnerTeams",
      "incidentOwnerUsers",
      "incidentLabels",
      "incidentOnCallDutyPolicies",
      "autoResolveIncident",
      "isIncidentPrivate",
      "incidentRemediationNotes",
    ]);
  });

  /*
   * The steps list above is exact, so a new column cannot slip in unnoticed.
   * This pins the rule behind it: every user-editable column of the model is
   * offered somewhere, except the ones deliberately left out.
   */
  test("offers every user-editable rule column except the deliberate omissions", () => {
    const onForm: Set<string> = new Set(
      BURN_RATE_RULE_FORM_FIELDS.map(columnOf),
    );

    const deliberatelyAbsent: Set<string> = new Set([
      // Set by the page from the route, never typed in.
      "project",
      "projectId",
      "serviceLevelObjective",
      "serviceLevelObjectiveId",
      // Relation columns the form edits through their entity twin.
      "alertSeverityId",
      "incidentSeverityId",
      // Only meaningful for Metric SLIs, which are not evaluated yet.
      "minimumSampleCount",
      // Audit columns.
      "createdByUser",
      "createdByUserId",
      "deletedByUser",
      "deletedByUserId",
    ]);

    // Base-model bookkeeping every table has, none of it user-editable.
    const baseColumns: Set<string> = new Set([
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
      "slug",
    ]);

    const model: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();

    for (const column of model.getTableColumns().columns) {
      // Worker-owned lifecycle columns cannot be written through the API at all.
      if (
        column.startsWith("last") ||
        deliberatelyAbsent.has(column) ||
        baseColumns.has(column)
      ) {
        continue;
      }

      expect({ column, onForm: onForm.has(column) }).toEqual({
        column,
        onForm: true,
      });
    }
  });

  /*
   * The load-bearing one. Validation runs per step, so a validator needs every
   * value it compares on the step it is attached to. Split the two toggles
   * across steps and "turn the alert off, then turn the incident on" fails on
   * the way out of the first step — before the user can reach the toggle that
   * would have made the rule legal.
   */
  test("both output toggles live on one step", () => {
    const alertToggle: FieldOf = fieldFor("shouldCreateAlert");
    const incidentToggle: FieldOf = fieldFor("shouldCreateIncident");

    expect(alertToggle.stepId).toBe("declares");
    expect(incidentToggle.stepId).toBe(alertToggle.stepId);
  });

  /*
   * addSloOwnersAsOwners applies to both outputs, so it belongs to neither
   * output's steps: on one of them it would vanish whenever that output is off
   * while still applying to the other.
   */
  test("the switch that applies to both outputs is not hidden with either of them", () => {
    expect(fieldFor("addSloOwnersAsOwners").stepId).toBe("declares");
    expect(stepById("declares").showIf).toBeUndefined();
  });

  /*
   * On the ALERT toggle, and only there. A customValidation is handed the whole
   * form's values, so one attachment covers both flags — but Validation.validate
   * only runs a field's validators when that field HAS a value (`name in
   * entries`). shouldCreateAlert always does, because its defaultValue is
   * written into the values on open. shouldCreateIncident has no default, so an
   * untouched incident toggle validates nothing: move the attachment there and
   * "turn the alert off and submit" stops being caught in the browser at all.
   */
  test("the no-output validator hangs off the toggle that always has a value", () => {
    expect(fieldFor("shouldCreateAlert").customValidation).toBe(
      validateBurnRateOutputs,
    );
    expect(fieldFor("shouldCreateIncident").customValidation).toBeUndefined();

    /*
     * And that toggle's default is what guarantees it is in the values at all —
     * the two facts are one mechanism, so they are asserted together.
     */
    expect(fieldFor("shouldCreateAlert").defaultValue).toBe(true);
  });

  /*
   * `defaultValue` is only applied when truthy, so a toggle whose column
   * defaults to true must carry `defaultValue: true` - or a create form shows it
   * off while the row is written on - and a toggle whose column defaults to
   * false must carry none, because `false` would be indistinguishable from
   * absent anyway. Read from the model, so a flipped column default fails here.
   */
  test("every toggle shows exactly what its column will hold on create", () => {
    const toggles: Array<FieldOf> = BURN_RATE_RULE_FORM_FIELDS.filter(
      (field: FieldOf): boolean => {
        return field.fieldType === FormFieldSchemaType.Toggle;
      },
    );

    expect(toggles.map(columnOf)).toEqual([
      "isEnabled",
      "shouldCreateAlert",
      "shouldCreateIncident",
      "addSloOwnersAsOwners",
      "autoResolveAlert",
      "isAlertPrivate",
      "autoResolveIncident",
      "isIncidentPrivate",
    ]);

    for (const toggle of toggles) {
      const column: string = columnOf(toggle);
      const metadata: TableColumnMetadata = columnMetadata(column);

      expect(metadata.type).toBe(TableColumnType.Boolean);

      expect({
        column,
        defaultValue: toggle.defaultValue,
      }).toEqual({
        column,
        defaultValue: metadata.defaultValue === true ? true : undefined,
      });
    }
  });

  test("the auto-resolve toggles default on, the private toggles and SLO owners off", () => {
    expect(fieldFor("autoResolveAlert").defaultValue).toBe(true);
    expect(fieldFor("autoResolveIncident").defaultValue).toBe(true);
    expect(fieldFor("isAlertPrivate").defaultValue).toBeUndefined();
    expect(fieldFor("isIncidentPrivate").defaultValue).toBeUndefined();
    expect(fieldFor("addSloOwnersAsOwners").defaultValue).toBeUndefined();
  });

  test("each output's fields live only on that output's steps", () => {
    const alertColumns: Array<string> = [
      "alertTitleTemplate",
      "alertDescriptionTemplate",
      "alertRemediationNotes",
      "alertSeverity",
      "onCallDutyPolicies",
      "alertOwnerTeams",
      "alertOwnerUsers",
      "alertLabels",
      "autoResolveAlert",
      "isAlertPrivate",
    ];

    const incidentColumns: Array<string> = [
      "incidentTitleTemplate",
      "incidentDescriptionTemplate",
      "incidentRemediationNotes",
      "incidentSeverity",
      "incidentOnCallDutyPolicies",
      "incidentOwnerTeams",
      "incidentOwnerUsers",
      "incidentLabels",
      "autoResolveIncident",
      "isIncidentPrivate",
    ];

    for (const column of alertColumns) {
      expect({ column, step: fieldFor(column).stepId }).toEqual({
        column,
        step: expect.stringMatching(/^alert-/),
      });
    }

    for (const column of incidentColumns) {
      expect({ column, step: fieldFor(column).stepId }).toEqual({
        column,
        step: expect.stringMatching(/^incident-/),
      });
    }
  });
});

describe("the template fields", () => {
  const TITLE_COLUMNS: Array<string> = [
    "alertTitleTemplate",
    "incidentTitleTemplate",
  ];

  const MARKDOWN_COLUMNS: Array<string> = [
    "alertDescriptionTemplate",
    "alertRemediationNotes",
    "incidentDescriptionTemplate",
    "incidentRemediationNotes",
  ];

  test("titles are single-line text, limited like the server and showing the default", () => {
    for (const column of TITLE_COLUMNS) {
      const field: FieldOf = fieldFor(column);

      expect(field.fieldType).toBe(FormFieldSchemaType.Text);
      expect(field.required).toBe(false);
      expect(field.validation?.maxLength).toBe(
        SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH,
      );

      /*
       * The placeholder IS the default template, so an empty field shows what
       * the record will be titled rather than implying it will be untitled.
       */
      expect(field.placeholder).toBe(DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE);
      expect(descriptionOf(field)).toContain(
        DEFAULT_SLO_BURN_RATE_TITLE_TEMPLATE,
      );
    }
  });

  test("the title limit is the column's own length, so a saved template always fits", () => {
    for (const column of TITLE_COLUMNS) {
      expect(columnMetadata(column).type).toBe(TableColumnType.LongText);
    }

    // ColumnLength.LongText, the varchar the title columns are created with.
    expect(SLO_BURN_RATE_TITLE_TEMPLATE_MAX_LENGTH).toBe(500);
  });

  test("descriptions and remediation notes are markdown, limited like the server", () => {
    for (const column of MARKDOWN_COLUMNS) {
      const field: FieldOf = fieldFor(column);

      expect(field.fieldType).toBe(FormFieldSchemaType.Markdown);
      expect(columnMetadata(column).type).toBe(TableColumnType.Markdown);
      expect(field.required).toBe(false);
      expect(field.validation?.maxLength).toBe(
        SLO_BURN_RATE_MARKDOWN_TEMPLATE_MAX_LENGTH,
      );
    }
  });

  test("every template field tells the user about the variables, naming only real ones", () => {
    for (const column of [...TITLE_COLUMNS, ...MARKDOWN_COLUMNS]) {
      const description: string = descriptionOf(fieldFor(column));

      const named: Array<string> = [
        ...description.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect({ column, namesVariables: named.length > 0 }).toEqual({
        column,
        namesVariables: true,
      });

      for (const name of named) {
        expect({
          column,
          name,
          exists: isSloBurnRateTemplateVariable(name),
        }).toEqual({
          column,
          name,
          exists: true,
        });
      }
    }
  });
});

describe("the relation pickers", () => {
  /*
   * A picker's dropdownModal lists records of its type; pointing a picker at
   * the wrong model would offer, say, labels for an owner-team column, and the
   * save would fail on a foreign key the user cannot see.
   */
  const PICKERS: Array<{
    column: string;
    modelType: typeof Label | typeof Team | typeof OnCallDutyPolicy;
  }> = [
    { column: "onCallDutyPolicies", modelType: OnCallDutyPolicy },
    { column: "incidentOnCallDutyPolicies", modelType: OnCallDutyPolicy },
    { column: "alertOwnerTeams", modelType: Team },
    { column: "incidentOwnerTeams", modelType: Team },
    { column: "alertLabels", modelType: Label },
    { column: "incidentLabels", modelType: Label },
  ];

  test("each list picker lists the model its column joins to", () => {
    for (const picker of PICKERS) {
      const field: FieldOf = fieldFor(picker.column);
      const metadata: TableColumnMetadata = columnMetadata(picker.column);

      expect(field.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(picker.modelType);
      expect(field.dropdownModal?.type).toBe(picker.modelType);
      expect(field.dropdownModal?.valueField).toBe("_id");
      expect(field.dropdownModal?.labelField).toBe("name");
    }
  });

  test("the owner-user pickers join to User and carry no loader of their own", () => {
    expect([...BURN_RATE_RULE_OWNER_USER_COLUMNS]).toEqual([
      "alertOwnerUsers",
      "incidentOwnerUsers",
    ]);

    for (const column of BURN_RATE_RULE_OWNER_USER_COLUMNS) {
      const field: FieldOf = fieldFor(column);

      expect(field.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(columnMetadata(column).modelType).toBe(User);

      /*
       * User is not project-listable, so a dropdownModal would list nothing.
       * The loader needs ProjectUser, which reads `window` at module load, so
       * this React-free module must leave it to the page.
       */
      expect(field.dropdownModal).toBeUndefined();
      expect(field.fetchDropdownOptions).toBeUndefined();
    }
  });
});

describe("withOwnerUserDropdownOptions", () => {
  const loader: FetchBurnRateRuleOwnerUserOptionsFunction = async () => {
    return [{ value: "user-1", label: "Jane Doe" }];
  };

  test("gives exactly the two owner-user pickers the loader", () => {
    const wired: Array<FieldOf> = withOwnerUserDropdownOptions(
      BURN_RATE_RULE_FORM_FIELDS,
      loader,
    );

    expect(wired).toHaveLength(BURN_RATE_RULE_FORM_FIELDS.length);

    const withLoader: Array<string> = wired
      .filter((field: FieldOf): boolean => {
        return field.fetchDropdownOptions === loader;
      })
      .map(columnOf);

    expect(withLoader).toEqual(["alertOwnerUsers", "incidentOwnerUsers"]);
  });

  test("leaves every other field as the very same object, in the same order", () => {
    const wired: Array<FieldOf> = withOwnerUserDropdownOptions(
      BURN_RATE_RULE_FORM_FIELDS,
      loader,
    );

    BURN_RATE_RULE_FORM_FIELDS.forEach((field: FieldOf, index: number) => {
      if (BURN_RATE_RULE_OWNER_USER_COLUMNS.includes(columnOf(field))) {
        // A copy with everything else intact.
        expect(wired[index]).not.toBe(field);
        expect({ ...wired[index], fetchDropdownOptions: undefined }).toEqual({
          ...field,
          fetchDropdownOptions: undefined,
        });
        return;
      }

      expect(wired[index]).toBe(field);
    });
  });

  test("never mutates the shared field array it was given", () => {
    withOwnerUserDropdownOptions(BURN_RATE_RULE_FORM_FIELDS, loader);

    expect(fieldFor("alertOwnerUsers").fetchDropdownOptions).toBeUndefined();
    expect(fieldFor("incidentOwnerUsers").fetchDropdownOptions).toBeUndefined();
  });

  test("hands the loader through untouched, so it runs with the form's values", async () => {
    const wired: Array<FieldOf> = withOwnerUserDropdownOptions(
      BURN_RATE_RULE_FORM_FIELDS,
      loader,
    );

    const ownerField: FieldOf | undefined = wired.find(
      (field: FieldOf): boolean => {
        return columnOf(field) === "alertOwnerUsers";
      },
    );

    await expect(ownerField!.fetchDropdownOptions!({})).resolves.toEqual([
      { value: "user-1", label: "Jane Doe" },
    ]);
  });
});

describe("the per-output steps appear only for the output they configure", () => {
  function isVisible(
    stepId: string,
    values: FormValues<ServiceLevelObjectiveBurnRateRule>,
  ): boolean {
    const step: StepOf = stepById(stepId);

    if (!step.showIf) {
      throw new Error(`Step "${stepId}" has no showIf.`);
    }

    return step.showIf(values);
  }

  test("the first three steps are unconditional", () => {
    for (const id of ["rule", "burn-window", "declares"]) {
      expect(stepById(id).showIf).toBeUndefined();
    }
  });

  test("an untouched form shows the alert steps and hides the incident steps", () => {
    /*
     * Exactly the model's column defaults. A form the user has not touched
     * submits a rule that alerts and declares nothing, so that is what it must
     * offer to configure.
     */
    for (const id of ALERT_STEPS) {
      expect(isVisible(id, {})).toBe(true);
    }

    for (const id of INCIDENT_STEPS) {
      expect(isVisible(id, {})).toBe(false);
    }
  });

  test("turning an output on reveals its step, turning it off hides it", () => {
    for (const id of INCIDENT_STEPS) {
      expect(isVisible(id, { shouldCreateIncident: true })).toBe(true);
      expect(isVisible(id, { shouldCreateIncident: false })).toBe(false);
    }

    for (const id of ALERT_STEPS) {
      expect(isVisible(id, { shouldCreateAlert: true })).toBe(true);
      expect(isVisible(id, { shouldCreateAlert: false })).toBe(false);
    }
  });

  test("an incident-only rule shows only the incident steps", () => {
    const incidentOnly: FormValues<ServiceLevelObjectiveBurnRateRule> = {
      shouldCreateAlert: false,
      shouldCreateIncident: true,
    };

    for (const id of ALERT_STEPS) {
      expect(isVisible(id, incidentOnly)).toBe(false);
    }

    for (const id of INCIDENT_STEPS) {
      expect(isVisible(id, incidentOnly)).toBe(true);
    }
  });

  /*
   * The steps and the validator have to read the flags the same way, or a step
   * hides the fields for an output the validator still counts as on. They share
   * one pair of predicates for exactly this reason; this pins that they do.
   */
  test("every step agrees with the predicate that gates it, over all nine combinations", () => {
    const EVERY_VALUE: Array<boolean | undefined> = [undefined, true, false];

    for (const shouldCreateAlert of EVERY_VALUE) {
      for (const shouldCreateIncident of EVERY_VALUE) {
        const values: FormValues<ServiceLevelObjectiveBurnRateRule> = {};

        if (shouldCreateAlert !== undefined) {
          values.shouldCreateAlert = shouldCreateAlert;
        }

        if (shouldCreateIncident !== undefined) {
          values.shouldCreateIncident = shouldCreateIncident;
        }

        for (const id of ALERT_STEPS) {
          expect({ values, id, visible: isVisible(id, values) }).toEqual({
            values,
            id,
            visible: willCreateAlert(values),
          });
        }

        for (const id of INCIDENT_STEPS) {
          expect({ values, id, visible: isVisible(id, values) }).toEqual({
            values,
            id,
            visible: willDeclareIncident(values),
          });
        }

        /*
         * And the one combination that hides EVERY per-output step is exactly
         * the one the validator refuses to let through.
         */
        const hidesAll: boolean = [...ALERT_STEPS, ...INCIDENT_STEPS].every(
          (id: string): boolean => {
            return !isVisible(id, values);
          },
        );

        expect(hidesAll).toBe(validateBurnRateOutputs(values) !== null);
      }
    }
  });
});

describe("willCreateAlert / willDeclareIncident", () => {
  test("read the model's own defaults when a flag is absent", () => {
    expect(willCreateAlert({})).toBe(true);
    expect(willDeclareIncident({})).toBe(false);
  });

  test("the alert flag is read `!== false`, so only an explicit false turns it off", () => {
    expect(willCreateAlert({ shouldCreateAlert: true })).toBe(true);
    expect(willCreateAlert({ shouldCreateAlert: undefined })).toBe(true);
    expect(willCreateAlert({ shouldCreateAlert: false })).toBe(false);
  });

  test("the incident flag is read `=== true`, so only an explicit true turns it on", () => {
    expect(willDeclareIncident({ shouldCreateIncident: true })).toBe(true);
    expect(willDeclareIncident({ shouldCreateIncident: undefined })).toBe(
      false,
    );
    expect(willDeclareIncident({ shouldCreateIncident: false })).toBe(false);
  });

  test("each reads only its own flag", () => {
    expect(willCreateAlert({ shouldCreateIncident: true })).toBe(true);
    expect(willDeclareIncident({ shouldCreateAlert: true })).toBe(false);
  });
});

describe("the output sections", () => {
  test.each(["alert", "incident"] as const)(
    "%s keeps title and severity visible and groups optional fields",
    (output: "alert" | "incident") => {
      const type: string = output === "alert" ? "Alert" : "Incident";
      const columns: Array<string> = columnsOnStep(output + "-details");
      expect(columns).toEqual([
        output + "TitleTemplate",
        output + "Severity",
        output + "DescriptionTemplate",
        output + "OwnerTeams",
        output + "OwnerUsers",
        output + "Labels",
        output === "alert"
          ? "onCallDutyPolicies"
          : "incidentOnCallDutyPolicies",
        "autoResolve" + type,
        "is" + type + "Private",
        output + "RemediationNotes",
      ]);
      expect(
        fieldFor(output + "TitleTemplate").collapsibleSection,
      ).toBeUndefined();
      expect(fieldFor(output + "Severity").collapsibleSection).toBeUndefined();
      expect(
        columns.slice(2).map((column: string): string | undefined => {
          return fieldFor(column).collapsibleSection?.title;
        }),
      ).toEqual([
        "Description",
        "Ownership & Labels",
        "Ownership & Labels",
        "Ownership & Labels",
        "On-Call",
        "Advanced Options",
        "Advanced Options",
        "Advanced Options",
      ]);
    },
  );

  test("an untouched rule keeps every optional section collapsed, including auto-resolve defaults", () => {
    for (const field of BURN_RATE_RULE_FORM_FIELDS) {
      if (field.collapsibleSection) {
        expect(field.collapsibleSection.isConfigured({})).toBe(false);
        expect(
          field.collapsibleSection.isConfigured({
            autoResolveAlert: true,
            autoResolveIncident: true,
          }),
        ).toBe(false);
      }
    }
  });

  test.each([
    ["alertDescriptionTemplate", "Alert description"],
    ["incidentDescriptionTemplate", "Incident description"],
    ["alertOwnerTeams", ["team-id"]],
    ["alertOwnerUsers", ["user-id"]],
    ["alertLabels", ["label-id"]],
    ["incidentOwnerTeams", ["team-id"]],
    ["incidentOwnerUsers", ["user-id"]],
    ["incidentLabels", ["label-id"]],
    ["onCallDutyPolicies", ["policy-id"]],
    ["incidentOnCallDutyPolicies", ["policy-id"]],
    ["autoResolveAlert", false],
    ["autoResolveIncident", false],
    ["isAlertPrivate", true],
    ["isIncidentPrivate", true],
    ["alertRemediationNotes", "Restart the service"],
    ["incidentRemediationNotes", "Check the runbook"],
  ])(
    "saved %s opens only its configured section",
    (column: string, value: unknown) => {
      const configuredValues: FormValues<ServiceLevelObjectiveBurnRateRule> = {
        [column]: value,
      };
      const section: NonNullable<FieldOf["collapsibleSection"]> =
        fieldFor(column).collapsibleSection!;
      expect(section.isConfigured(configuredValues)).toBe(true);
      for (const field of BURN_RATE_RULE_FORM_FIELDS) {
        if (field.collapsibleSection) {
          expect(field.collapsibleSection.isConfigured(configuredValues)).toBe(
            field.collapsibleSection.id === section.id,
          );
        }
      }
    },
  );

  test("empty selections do not mark routing or ownership as configured", () => {
    for (const column of [
      "alertOwnerTeams",
      "alertOwnerUsers",
      "alertLabels",
      "incidentOwnerTeams",
      "incidentOwnerUsers",
      "incidentLabels",
      "onCallDutyPolicies",
      "incidentOnCallDutyPolicies",
    ]) {
      expect(
        fieldFor(column).collapsibleSection!.isConfigured({ [column]: [] }),
      ).toBe(false);
    }
  });
});
