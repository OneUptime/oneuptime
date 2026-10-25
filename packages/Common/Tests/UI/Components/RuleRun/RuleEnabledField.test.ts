import { describe, expect, test } from "@jest/globals";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  RULE_ENABLED_COLUMN,
  hasRuleEnabledColumn,
  isRuleEnabledField,
  withRuleEnabledOnEditOnly,
} from "../../../../UI/Components/RuleRun/RuleEnabledField";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import Label from "../../../../Models/DatabaseModels/Label";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";

/*
 * Nobody creates a rule in order to have it switched off: a rule's create
 * form leaves its Enabled switch out, and the rule starts on.
 */

type RuleFields = {
  name?: string;
  isEnabled?: boolean;
  notifyOwners?: boolean;
};

const NAME: Field<RuleFields> = {
  field: { name: true },
  title: "Name",
  fieldType: FormFieldSchemaType.Text,
};

const ENABLED: Field<RuleFields> = {
  field: { isEnabled: true },
  title: "Enabled",
  fieldType: FormFieldSchemaType.Toggle,
  description: "Enable or disable this rule.",
};

const NOTIFY_OWNERS: Field<RuleFields> = {
  field: { notifyOwners: true },
  title: "Notify Owners",
  fieldType: FormFieldSchemaType.Toggle,
};

describe("isRuleEnabledField", () => {
  test("is the switch that writes the rule's isEnabled column", () => {
    expect(RULE_ENABLED_COLUMN).toBe("isEnabled");
    expect(isRuleEnabledField(ENABLED)).toBe(true);
    expect(
      isRuleEnabledField({
        ...ENABLED,
        fieldType: FormFieldSchemaType.Checkbox,
      }),
    ).toBe(true);
  });

  test("is no other field", () => {
    expect(isRuleEnabledField(NAME)).toBe(false);
    expect(isRuleEnabledField(NOTIFY_OWNERS)).toBe(false);
    // Not drawn as a switch.
    expect(
      isRuleEnabledField({ ...ENABLED, fieldType: FormFieldSchemaType.Text }),
    ).toBe(false);
    // Writes a value of its own, not the column.
    expect(
      isRuleEnabledField({ ...ENABLED, overrideFieldKey: "enableLater" }),
    ).toBe(false);
  });
});

// A rule's table offers Enable or Disable in each row for one (RuleTable).
describe("hasRuleEnabledColumn", () => {
  test("is true of a rule whose model has the boolean isEnabled column", () => {
    expect(hasRuleEnabledColumn(new MonitorLabelRule())).toBe(true);
    expect(hasRuleEnabledColumn(new IncidentOwnerRule())).toBe(true);
  });

  test("is false of a model without it, or with a column of another type", () => {
    expect(hasRuleEnabledColumn(new Label())).toBe(false);
    expect(
      hasRuleEnabledColumn({
        getTableColumnMetadata: (): unknown => {
          return { type: "Text" };
        },
      }),
    ).toBe(false);
  });
});

describe("withRuleEnabledOnEditOnly", () => {
  test("leaves the Enabled switch off the create form, and keeps it for editing", () => {
    const fields: Array<Field<RuleFields>> = withRuleEnabledOnEditOnly([
      NAME,
      ENABLED,
      NOTIFY_OWNERS,
    ]);

    expect(fields).toHaveLength(3);
    expect(fields[1]).toEqual({ ...ENABLED, doNotShowWhenCreating: true });
    // Still on the edit form.
    expect(fields[1]!.doNotShowWhenEditing).toBeUndefined();
  });

  test("hands every other field back as it was, and changes none of them", () => {
    const fields: Array<Field<RuleFields>> = withRuleEnabledOnEditOnly([
      NAME,
      ENABLED,
      NOTIFY_OWNERS,
    ]);

    expect(fields[0]).toBe(NAME);
    expect(fields[2]).toBe(NOTIFY_OWNERS);
    expect(ENABLED.doNotShowWhenCreating).toBeUndefined();
  });

  test("leaves a field already off the create form as it is", () => {
    const editOnly: Field<RuleFields> = {
      ...ENABLED,
      doNotShowWhenCreating: true,
    };

    expect(withRuleEnabledOnEditOnly([editOnly])[0]).toBe(editOnly);
  });
});
