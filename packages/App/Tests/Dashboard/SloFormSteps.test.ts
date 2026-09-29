import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getSloFormFields,
  getSloWindowTypeDropdownOptions,
  SLO_CREATE_INITIAL_VALUES,
  SLO_FORM_STEPS,
  SLO_WINDOW_TYPE_DESCRIPTIONS,
  validateAtRiskThreshold,
  validateTargetPercentage,
  validateWindowDays,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "Common/Utils/Slo/SloHealth";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import Validation from "Common/UI/Components/Forms/Validation";

/*
 * A stepped form fails silently when its wiring drifts: a field without a
 * matching stepId simply disappears, and a required field on a step that
 * cannot be reached blocks the wizard forever. These assertions cover the
 * real form arrays so adding a field or renaming a step cannot ship an
 * incomplete SLO form while still compiling.
 *
 * They also pin what the create form deliberately no longer asks. Monitors,
 * the monitor label rule, the downtime statuses and the multi-monitor mode
 * moved to the Monitors, Monitor Rules and Settings pages, and each starts
 * from a server default; a field that crept back into the wizard would ask
 * users a question the product decided they should not have to answer
 * before their SLO exists.
 */

type SloField = ModelField<ServiceLevelObjective>;
type SloStep = FormStep<ServiceLevelObjective>;
type SloValues = FormValues<ServiceLevelObjective>;

/*
 * Building the field list also builds the full timezone dropdown. Build it
 * once so this structural suite stays fast and deterministic.
 */
const CREATE_FIELDS: Array<SloField> = getSloFormFields();

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

function columnsOnStep(stepId: string): Array<string> {
  return CREATE_FIELDS.filter((field: SloField): boolean => {
    return field.stepId === stepId;
  }).map(columnOf);
}

function fieldFor(column: string): SloField {
  const field: SloField | undefined = CREATE_FIELDS.find(
    (candidate: SloField): boolean => {
      return columnOf(candidate) === column;
    },
  );

  if (!field) {
    throw new Error(`No SLO form field found for column "${column}".`);
  }

  return field;
}

/*
 * BasicForm fills each field's `name` from its key before validating;
 * Validation.validate throws without one, so do the same here.
 */
function validateStep(
  stepId: string,
  values: SloValues,
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
    currentFormStepId: stepId,
    onValidate: undefined,
  });
}

function withValues(values: Record<string, unknown>): SloValues {
  return {
    ...SLO_CREATE_INITIAL_VALUES,
    ...values,
  } as unknown as SloValues;
}

describe("the SLO create form steps", () => {
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

  test("ask what the SLO is, its objective, its period and its labels, in that order", () => {
    expect(stepIds()).toEqual(["basic-info", "objective", "period", "labels"]);
    expect(
      SLO_FORM_STEPS.map((step: SloStep): string => {
        return step.title;
      }),
    ).toEqual(["Basic Info", "Objective", "Period", "Labels"]);
  });

  test("use unique step ids", () => {
    expect(new Set(stepIds()).size).toBe(stepIds().length);
  });

  test("assign every field to a declared step", () => {
    const declaredStepIds: Set<string> = new Set(stepIds());

    for (const field of CREATE_FIELDS) {
      expect(field.stepId).toBeTruthy();
      expect(declaredStepIds.has(field.stepId!)).toBe(true);
    }
  });

  test("keep every step non-empty", () => {
    for (const stepId of stepIds()) {
      expect(columnsOnStep(stepId).length).toBeGreaterThan(0);
    }
  });

  test("group fields by the question each step answers", () => {
    expect(columnsOnStep("basic-info")).toEqual(["name", "description"]);
    expect(columnsOnStep("objective")).toEqual([
      "targetPercentage",
      "atRiskThresholdPercentage",
    ]);
    expect(columnsOnStep("period")).toEqual([
      "windowType",
      "windowDays",
      "timezone",
    ]);
    expect(columnsOnStep("labels")).toEqual(["labels"]);
  });

  test.each([
    "monitors",
    "monitorLabels",
    "autoAddedMonitors",
    "multiMonitorMode",
    "downtimeMonitorStatuses",
    "isEnabled",
    "isArchived",
  ])(
    "no longer ask for %s — it has its own page and a server default",
    (column: string) => {
      expect(CREATE_FIELDS.map(columnOf)).not.toContain(column);
    },
  );

  test("keep the conditional window fields on the same step as Window Type", () => {
    const windowStepId: string | undefined = fieldFor("windowType").stepId;

    expect(windowStepId).toBe("period");
    expect(fieldFor("windowDays").stepId).toBe(windowStepId);
    expect(fieldFor("timezone").stepId).toBe(windowStepId);
  });

  test("keep the at-risk threshold beside the target it is a fraction of", () => {
    expect(fieldFor("atRiskThresholdPercentage").stepId).toBe(
      fieldFor("targetPercentage").stepId,
    );
  });
});

describe("the SLO create form's initial values", () => {
  test("seed exactly the objective and period defaults", () => {
    expect(SLO_CREATE_INITIAL_VALUES).toEqual({
      windowType: SloWindowType.Rolling,
      windowDays: DEFAULT_ROLLING_WINDOW_DAYS,
      atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
    });
  });

  test("seed nothing for columns the form no longer carries", () => {
    const keys: Array<string> = Object.keys(SLO_CREATE_INITIAL_VALUES);

    expect(keys).not.toContain("monitors");
    expect(keys).not.toContain("multiMonitorMode");
    expect(keys).not.toContain("downtimeMonitorStatuses");
  });

  test("seed only columns that have a field on the form", () => {
    const formColumns: Array<string> = CREATE_FIELDS.map(columnOf);

    for (const key of Object.keys(SLO_CREATE_INITIAL_VALUES)) {
      expect(formColumns).toContain(key);
    }
  });
});

describe("validating the SLO create form one step at a time", () => {
  test("Basic Info requires a name and nothing else", () => {
    expect(Object.keys(validateStep("basic-info", withValues({})))).toEqual([
      "name",
    ]);
    expect(
      validateStep("basic-info", withValues({ name: "API Availability" })),
    ).toEqual({});
  });

  test("Objective requires a target, because the initial values carry none", () => {
    expect(Object.keys(validateStep("objective", withValues({})))).toEqual([
      "targetPercentage",
    ]);
  });

  test("Objective accepts a real target with the seeded at-risk threshold", () => {
    expect(
      validateStep("objective", withValues({ targetPercentage: 99.9 })),
    ).toEqual({});
  });

  test("Objective rejects a 100% target that leaves no error budget", () => {
    expect(
      validateStep("objective", withValues({ targetPercentage: 100 })),
    ).toEqual({
      targetPercentage: "Target must be greater than 0 and at most 99.999.",
    });
  });

  test("Objective rejects a fractional at-risk threshold before the integer column does", () => {
    expect(
      validateStep(
        "objective",
        withValues({ targetPercentage: 99.9, atRiskThresholdPercentage: 20.5 }),
      ),
    ).toEqual({
      atRiskThresholdPercentage: "At-risk threshold must be a whole number.",
    });
  });

  test("Objective does not validate the period fields on its own step", () => {
    expect(
      validateStep(
        "objective",
        withValues({ targetPercentage: 99.9, windowDays: 9000 }),
      ),
    ).toEqual({});
  });

  test("Period passes with the seeded rolling window", () => {
    expect(validateStep("period", withValues({}))).toEqual({});
  });

  test("Period passes for Calendar Month with an empty Window (Days), because the field is hidden", () => {
    expect(
      validateStep(
        "period",
        withValues({
          windowType: SloWindowType.CalendarMonth,
          windowDays: "",
        }),
      ),
    ).toEqual({});
  });

  test("Period still checks Window (Days) for a rolling window", () => {
    expect(
      Object.keys(validateStep("period", withValues({ windowDays: "" }))),
    ).toEqual(["windowDays"]);
    expect(validateStep("period", withValues({ windowDays: 400 }))).toEqual({
      windowDays: "Window must be between 1 and 366 days.",
    });
  });

  test("Labels are optional", () => {
    expect(validateStep("labels", withValues({}))).toEqual({});
  });

  test("a user who answers every step can walk the whole wizard", () => {
    const values: SloValues = withValues({
      name: "API Availability",
      targetPercentage: 99.9,
    });

    for (const stepId of stepIds()) {
      expect(validateStep(stepId, values)).toEqual({});
    }
  });
});

describe("the SLO create form's window fields", () => {
  type WindowTypeOnChange = (
    value: SloWindowType,
    currentFormValues: SloValues,
    setNewFormValues: (values: SloValues) => void,
  ) => void;

  function windowTypeOnChange(): WindowTypeOnChange {
    return fieldFor("windowType").onChange as WindowTypeOnChange;
  }

  test("backfill a cleared Window (Days) when switching to Calendar Month", () => {
    const setNewFormValues: ReturnType<typeof jest.fn> = jest.fn();

    windowTypeOnChange()(
      SloWindowType.CalendarMonth,
      withValues({ windowDays: "" }),
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect((setNewFormValues.mock.calls[0]![0] as SloValues).windowDays).toBe(
      DEFAULT_ROLLING_WINDOW_DAYS,
    );
  });

  test("leave a real Window (Days) alone when switching to Calendar Month", () => {
    const setNewFormValues: ReturnType<typeof jest.fn> = jest.fn();

    windowTypeOnChange()(
      SloWindowType.CalendarMonth,
      withValues({ windowDays: 14 }),
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("never rewrite values when switching to Rolling", () => {
    const setNewFormValues: ReturnType<typeof jest.fn> = jest.fn();

    windowTypeOnChange()(
      SloWindowType.Rolling,
      withValues({ windowDays: "" }),
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("show Window (Days) only for rolling windows and Timezone only for calendar months", () => {
    const rolling: SloValues = withValues({});
    const calendar: SloValues = withValues({
      windowType: SloWindowType.CalendarMonth,
    });

    expect(fieldFor("windowDays").showIf!(rolling)).toBe(true);
    expect(fieldFor("windowDays").showIf!(calendar)).toBe(false);
    expect(fieldFor("timezone").showIf!(rolling)).toBe(false);
    expect(fieldFor("timezone").showIf!(calendar)).toBe(true);
  });

  test("explain every window type inside the dropdown itself", () => {
    const options: Array<DropdownOption> = getSloWindowTypeDropdownOptions();

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(Object.values(SloWindowType));

    for (const option of options) {
      expect(option.description).toBe(
        SLO_WINDOW_TYPE_DESCRIPTIONS[option.value as SloWindowType],
      );
      expect(option.description!.length).toBeGreaterThan(0);
    }

    expect(fieldFor("windowType").dropdownOptions).toEqual(options);
  });

  test("put the client-side validators on the fields they guard", () => {
    expect(fieldFor("targetPercentage").customValidation).toBe(
      validateTargetPercentage,
    );
    expect(fieldFor("atRiskThresholdPercentage").customValidation).toBe(
      validateAtRiskThreshold,
    );
    expect(fieldFor("windowDays").customValidation).toBe(validateWindowDays);
  });

  /*
   * A bare "99.9" means nothing until it is turned into downtime; the help
   * text is where a first-time user learns what they are agreeing to.
   */
  test("translate the target into the downtime it allows", () => {
    expect(String(fieldFor("targetPercentage").description)).toContain(
      "downtime",
    );
  });
});
