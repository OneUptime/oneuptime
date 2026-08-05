import { describe, expect, test } from "@jest/globals";
import { getSloFormFields } from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import Label from "Common/Models/DatabaseModels/Label";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelField from "Common/UI/Components/Forms/Types/Field";

/*
 * The SLO form gained a label rule: "attach every monitor carrying one of
 * these labels". Two things about it are load-bearing and easy to break by
 * accident.
 *
 * First the key. `monitorLabels` is the rule; `labels` is how the SLO itself
 * is categorised. They are both multi-selects over Label sitting a few rows
 * apart, and swapping them would silently point the rule at the wrong column
 * — the form would look right and attach nothing.
 *
 * Second, Monitors stops being unconditionally required. An SLO driven
 * entirely by the rule is saved with an empty picker and filled in by the
 * server; demanding a manual pick there would force the user to attach a
 * monitor they did not mean to curate. It stays required when there is no
 * rule, because an SLO with neither is one that can never be evaluated.
 */

const FIELD_KEY_MONITORS: string = "monitors";
const FIELD_KEY_MONITOR_LABELS: string = "monitorLabels";
const FIELD_KEY_LABELS: string = "labels";

function getFieldKey(field: ModelField<ServiceLevelObjective>): string {
  return Object.keys(field.field || {})[0] as string;
}

function getField(key: string): ModelField<ServiceLevelObjective> {
  const field: ModelField<ServiceLevelObjective> | undefined =
    getSloFormFields().find((item: ModelField<ServiceLevelObjective>) => {
      return getFieldKey(item) === key;
    });

  if (!field) {
    throw new Error(`SLO form field "${key}" not found`);
  }

  return field;
}

function isMonitorsRequired(
  values: Partial<FormValues<ServiceLevelObjective>>,
): boolean {
  const required: unknown = getField(FIELD_KEY_MONITORS).required;

  if (typeof required === "function") {
    return (required as (item: FormValues<ServiceLevelObjective>) => boolean)(
      values as FormValues<ServiceLevelObjective>,
    );
  }

  return Boolean(required);
}

describe("getSloFormFields — the monitor label rule", () => {
  test("offers the rule as its own field, distinct from the SLO's own labels", () => {
    const keys: Array<string> = getSloFormFields().map(
      (field: ModelField<ServiceLevelObjective>) => {
        return getFieldKey(field);
      },
    );

    expect(keys).toContain(FIELD_KEY_MONITOR_LABELS);
    expect(keys).toContain(FIELD_KEY_LABELS);
    expect(keys.indexOf(FIELD_KEY_MONITOR_LABELS)).not.toBe(
      keys.indexOf(FIELD_KEY_LABELS),
    );
  });

  test("places the rule directly after the monitor list it maintains", () => {
    const keys: Array<string> = getSloFormFields().map(
      (field: ModelField<ServiceLevelObjective>) => {
        return getFieldKey(field);
      },
    );

    expect(keys.indexOf(FIELD_KEY_MONITOR_LABELS)).toBe(
      keys.indexOf(FIELD_KEY_MONITORS) + 1,
    );
  });

  test("renders the rule as a multi-select over Label", () => {
    const field: ModelField<ServiceLevelObjective> = getField(
      FIELD_KEY_MONITOR_LABELS,
    );

    expect(field.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(field.dropdownModal?.type).toBe(Label);
    expect(field.dropdownModal?.valueField).toBe("_id");
  });

  test("never makes the rule itself mandatory — a hand-curated SLO is still valid", () => {
    expect(getField(FIELD_KEY_MONITOR_LABELS).required).toBe(false);
  });

  test("explains that hand-attached monitors survive the rule", () => {
    expect(getField(FIELD_KEY_MONITOR_LABELS).description).toContain(
      "never removed",
    );
  });

  test("keeps Monitors required when there is no rule to fill it", () => {
    expect(isMonitorsRequired({})).toBe(true);
    expect(isMonitorsRequired({ monitorLabels: [] })).toBe(true);
  });

  test("drops the Monitors requirement once a rule can fill it", () => {
    expect(
      isMonitorsRequired({
        monitorLabels: [{ _id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
      } as unknown as Partial<FormValues<ServiceLevelObjective>>),
    ).toBe(false);
  });

  test("treats a non-array rule value as no rule at all", () => {
    expect(
      isMonitorsRequired({
        monitorLabels: undefined,
      } as unknown as Partial<FormValues<ServiceLevelObjective>>),
    ).toBe(true);
  });
});
