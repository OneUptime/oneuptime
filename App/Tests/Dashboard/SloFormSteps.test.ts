import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getSloFormFields,
  SLO_CREATE_INITIAL_VALUES,
  SLO_FORM_STEPS,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import Validation from "Common/UI/Components/Forms/Validation";

/*
 * A stepped form fails silently when its wiring drifts: a field without a
 * matching stepId simply disappears. These assertions cover the actual form
 * arrays so adding a field or renaming a step cannot ship an incomplete SLO
 * form while still compiling successfully.
 */

type SloField = ModelField<ServiceLevelObjective>;
type SloStep = FormStep<ServiceLevelObjective>;

/*
 * Building the field list also builds the full timezone dropdown. Cache the
 * two form variants once so this structural suite stays fast and deterministic.
 */
const CREATE_FIELDS: Array<SloField> = getSloFormFields();
const EDIT_FIELDS: Array<SloField> = getSloFormFields({
  includeIsEnabled: true,
});

function stepIds(): Array<string> {
  return SLO_FORM_STEPS.map((step: SloStep): string => {
    return step.id;
  });
}

function columnOf(field: SloField): string {
  const columns: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  if (columns.length !== 1) {
    throw new Error(
      `Expected one column per SLO form field, got ${JSON.stringify(columns)}.`,
    );
  }

  return columns[0]!;
}

function columnsOnStep(
  stepId: string,
  options?: { includeIsEnabled?: boolean | undefined },
): Array<string> {
  return (options?.includeIsEnabled ? EDIT_FIELDS : CREATE_FIELDS)
    .filter((field: SloField): boolean => {
      return field.stepId === stepId;
    })
    .map(columnOf);
}

function fieldFor(column: string): SloField {
  const field: SloField | undefined = EDIT_FIELDS.find(
    (candidate: SloField): boolean => {
      return columnOf(candidate) === column;
    },
  );

  if (!field) {
    throw new Error(`No SLO form field found for column "${column}".`);
  }

  return field;
}

function validateMonitorStep(
  values: FormValues<ServiceLevelObjective>,
): Record<string, string> {
  const namedFields: Array<SloField> = CREATE_FIELDS.map(
    (field: SloField): SloField => {
      return {
        ...field,
        name: columnOf(field),
      };
    },
  );

  return Validation.validate({
    formFields: namedFields,
    values: values,
    currentFormStepId: "monitors",
    onValidate: undefined,
  });
}

describe("the SLO form steps", () => {
  test("are wired into the SLO create table", () => {
    const pageSource: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Dashboard",
          "src",
          "Pages",
          "Slo",
          "Slos.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(pageSource).toContain("formSteps={SLO_FORM_STEPS}");
    expect(pageSource).toContain(
      "createInitialValues={SLO_CREATE_INITIAL_VALUES}",
    );
  });

  test("present the four configuration stages in order", () => {
    expect(stepIds()).toEqual([
      "basic-info",
      "monitors",
      "objective",
      "labels",
    ]);
    expect(
      SLO_FORM_STEPS.map((step: SloStep): string => {
        return step.title;
      }),
    ).toEqual(["Basic Info", "Monitors", "Objective", "Labels"]);
  });

  test("use unique step ids", () => {
    expect(new Set(stepIds()).size).toBe(stepIds().length);
  });

  test("assign every create and edit field to a declared step", () => {
    const declaredStepIds: Set<string> = new Set(stepIds());

    for (const field of EDIT_FIELDS) {
      expect(field.stepId).toBeTruthy();
      expect(declaredStepIds.has(field.stepId!)).toBe(true);
    }
  });

  test("keeps every create step non-empty", () => {
    for (const stepId of stepIds()) {
      expect(columnsOnStep(stepId).length).toBeGreaterThan(0);
    }
  });

  test("groups fields by the question each step answers", () => {
    expect(columnsOnStep("basic-info")).toEqual(["name", "description"]);
    expect(columnsOnStep("monitors")).toEqual([
      "monitors",
      "monitorLabels",
      "multiMonitorMode",
      "downtimeMonitorStatuses",
    ]);
    expect(columnsOnStep("objective")).toEqual([
      "targetPercentage",
      "windowType",
      "windowDays",
      "timezone",
      "atRiskThresholdPercentage",
    ]);
    expect(columnsOnStep("labels")).toEqual(["labels"]);
  });

  test("keeps dependent monitor selectors together for per-step validation", () => {
    expect(fieldFor("monitors").stepId).toBe("monitors");
    expect(fieldFor("monitorLabels").stepId).toBe(
      fieldFor("monitors").stepId,
    );
  });

  test("lets monitor labels satisfy the monitor step without a manual monitor", () => {
    const errors: Record<string, string> = validateMonitorStep({
      ...SLO_CREATE_INITIAL_VALUES,
      monitorLabels: [
        { _id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      ],
    } as unknown as FormValues<ServiceLevelObjective>);

    expect(errors).toEqual({});
  });

  test("still requires a monitor when no auto-add labels are selected", () => {
    const errors: Record<string, string> = validateMonitorStep({
      ...SLO_CREATE_INITIAL_VALUES,
    });

    expect(Object.keys(errors)).toEqual(["monitors"]);
    expect(errors["monitors"]).toBe("Monitors is required.");
  });

  test("keeps conditional window fields with their controlling field", () => {
    const windowStepId: string | undefined = fieldFor("windowType").stepId;

    expect(windowStepId).toBe("objective");
    expect(fieldFor("windowDays").stepId).toBe(windowStepId);
    expect(fieldFor("timezone").stepId).toBe(windowStepId);
  });

  test("keeps the edit-only Enabled field with the SLO's basic settings", () => {
    expect(
      columnsOnStep("basic-info", { includeIsEnabled: true }),
    ).toEqual(["name", "description", "isEnabled"]);
    expect(columnsOnStep("labels", { includeIsEnabled: true })).toEqual([
      "labels",
    ]);
  });
});
