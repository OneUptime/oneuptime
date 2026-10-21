import { describe, expect, test } from "@jest/globals";
import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import IncidentOwnerRule from "../../../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentSlaRule from "../../../../../Models/DatabaseModels/IncidentSlaRule";
import NetworkAlertPolicy from "../../../../../Models/DatabaseModels/NetworkAlertPolicy";
import AutoRemediationExecutionMode from "../../../../../Types/AutoRemediation/AutoRemediationExecutionMode";
import IconProp from "../../../../../Types/Icon/IconProp";
import FormFieldSchemaType from "../../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  CreateFormField,
  getCreateFormColumnDefault,
} from "../../../../../UI/Components/Forms/Utils/CreateFormDefaults";

/*
 * The column default a field of a Create form starts with
 * (getCreateFormColumnDefault), read off real models: what ModelForm hands
 * a field as its defaultValue when the field says nothing itself.
 */

const ownerRule: IncidentOwnerRule = new IncidentOwnerRule();

function toggle(
  key: string,
  extra: Partial<CreateFormField<IncidentOwnerRule>> = {},
): CreateFormField<IncidentOwnerRule> {
  return {
    field: { [key]: true } as CreateFormField<IncidentOwnerRule>["field"],
    title: key,
    fieldType: FormFieldSchemaType.Toggle,
    ...extra,
  };
}

describe("getCreateFormColumnDefault", () => {
  test("gives a switch its column's default, on and off alike", () => {
    // isEnabled and notifyOwners default to on in the database.
    expect(getCreateFormColumnDefault(ownerRule, toggle("isEnabled"))).toBe(
      true,
    );
    expect(getCreateFormColumnDefault(ownerRule, toggle("notifyOwners"))).toBe(
      true,
    );
    expect(
      getCreateFormColumnDefault(
        ownerRule,
        toggle("inheritOwnersFromMonitors"),
      ),
    ).toBe(false);

    // A checkbox is a switch too.
    expect(
      getCreateFormColumnDefault(ownerRule, {
        ...toggle("isEnabled"),
        fieldType: FormFieldSchemaType.Checkbox,
      }),
    ).toBe(true);
  });

  test("leaves a field that says what it starts as to itself", () => {
    expect(
      getCreateFormColumnDefault(
        ownerRule,
        toggle("isEnabled", { defaultValue: false }),
      ),
    ).toBeUndefined();
    expect(
      getCreateFormColumnDefault(
        ownerRule,
        toggle("isEnabled", {
          getDefaultValue: (): boolean => {
            return false;
          },
        }),
      ),
    ).toBeUndefined();
  });

  test("leaves a field that writes no column of its own alone", () => {
    // Checked against a column, but not writing it.
    expect(
      getCreateFormColumnDefault(ownerRule, {
        overrideField: { isEnabled: true },
        overrideFieldKey: "enableLater",
        title: "Enable Later",
        fieldType: FormFieldSchemaType.Toggle,
      }),
    ).toBeUndefined();
    // Sent as misc data, under a key of its own.
    expect(
      getCreateFormColumnDefault(
        ownerRule,
        toggle("isEnabled", { overrideFieldKey: "enableLater" }),
      ),
    ).toBeUndefined();
    // Only drives the form.
    expect(
      getCreateFormColumnDefault(
        ownerRule,
        toggle("isEnabled", { formOnly: true }),
      ),
    ).toBeUndefined();
    // No column at all, or none by that name.
    expect(
      getCreateFormColumnDefault(ownerRule, {
        title: "Nothing",
        fieldType: FormFieldSchemaType.Toggle,
      }),
    ).toBeUndefined();
    expect(
      getCreateFormColumnDefault(ownerRule, toggle("notAColumnOfThisModel")),
    ).toBeUndefined();
    // A column with no default of its own.
    expect(getCreateFormColumnDefault(ownerRule, toggle("name"))).toBe(
      undefined,
    );
  });

  test("gives a choice its column's default only when the field offers it", () => {
    const rule: AutoRemediationRule = new AutoRemediationRule();
    const options: Array<{ label: string; value: string }> = Object.values(
      AutoRemediationExecutionMode,
    ).map((value: string) => {
      return { label: value, value: value };
    });

    const dropdown: CreateFormField<AutoRemediationRule> = {
      field: { executionMode: true },
      title: "Execution Mode",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: options,
    };

    expect(getCreateFormColumnDefault(rule, dropdown)).toBe(
      AutoRemediationExecutionMode.Suggest,
    );

    // Options in groups count as well.
    expect(
      getCreateFormColumnDefault(rule, {
        ...dropdown,
        dropdownOptions: [{ label: "Modes", options: options }],
      }),
    ).toBe(AutoRemediationExecutionMode.Suggest);

    // Options fetched later: the column's choice still stands.
    expect(
      getCreateFormColumnDefault(rule, { ...dropdown, dropdownOptions: [] }),
    ).toBe(AutoRemediationExecutionMode.Suggest);

    // A default the field cannot show would be sent without being seen.
    expect(
      getCreateFormColumnDefault(rule, {
        ...dropdown,
        dropdownOptions: options.filter(
          (option: { value: string }): boolean => {
            return option.value !== AutoRemediationExecutionMode.Suggest;
          },
        ),
      }),
    ).toBeUndefined();

    // Radio buttons and card pickers are choices too.
    expect(
      getCreateFormColumnDefault(rule, {
        ...dropdown,
        fieldType: FormFieldSchemaType.RadioButton,
        dropdownOptions: undefined,
        radioButtonOptions: options.map((option: { value: string }) => {
          return { title: option.value, value: option.value };
        }),
      }),
    ).toBe(AutoRemediationExecutionMode.Suggest);

    expect(
      getCreateFormColumnDefault(rule, {
        ...dropdown,
        fieldType: FormFieldSchemaType.CardSelect,
        dropdownOptions: undefined,
        cardSelectOptions: [
          {
            value: AutoRemediationExecutionMode.Suggest,
            title: "Suggest",
            description: "Suggest a fix",
            icon: IconProp.Play,
          },
        ],
      }),
    ).toBe(AutoRemediationExecutionMode.Suggest);

    // Typed text never starts from a column.
    expect(
      getCreateFormColumnDefault(rule, {
        ...dropdown,
        fieldType: FormFieldSchemaType.Text,
      }),
    ).toBeUndefined();
  });

  test("gives a number box its column's number", () => {
    const slaRule: IncidentSlaRule = new IncidentSlaRule();

    expect(
      getCreateFormColumnDefault(slaRule, {
        field: { atRiskThresholdInPercentage: true },
        title: "At Risk Threshold",
        fieldType: FormFieldSchemaType.Number,
      }),
    ).toBe(80);

    // But not a boolean column drawn as a number, nor a number as a switch.
    expect(
      getCreateFormColumnDefault(slaRule, {
        field: { atRiskThresholdInPercentage: true },
        title: "At Risk Threshold",
        fieldType: FormFieldSchemaType.Toggle,
      }),
    ).toBeUndefined();
    expect(
      getCreateFormColumnDefault(ownerRule, {
        ...toggle("isEnabled"),
        fieldType: FormFieldSchemaType.Number,
      }),
    ).toBeUndefined();
  });

  test("leaves a JSON default alone", () => {
    // NetworkAlertPolicy.scope defaults to {}.
    expect(
      new NetworkAlertPolicy().getTableColumnMetadata("scope").defaultValue,
    ).toEqual({});

    for (const fieldType of [
      FormFieldSchemaType.CustomComponent,
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.JSON,
    ]) {
      expect(
        getCreateFormColumnDefault(new NetworkAlertPolicy(), {
          field: { scope: true },
          title: "Scope",
          fieldType: fieldType,
        }),
      ).toBeUndefined();
    }
  });
});
