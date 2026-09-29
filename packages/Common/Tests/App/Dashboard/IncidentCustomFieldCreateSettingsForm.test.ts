import { describe, expect, test } from "@jest/globals";
import {
  buildCustomFieldSettingsFormFields,
  buildCustomFieldSettingsModelFormFields,
  getCustomFieldSettingFormKey,
  getCustomFieldSettingLabel,
  getCustomFieldSettingOptions,
  getCustomFieldSettingsFormInitialValues,
  getCustomFieldSettingValue,
  getCustomFieldTypeLabel,
  getKeyedCustomFieldDefinitions,
  getTemplateDefaultLabel,
  getUnsetCustomFieldSetting,
  INCIDENT_CUSTOM_FIELD_SETTING_FORM_KEY_PREFIX,
  isCustomFieldSettingChosen,
  KeyedIncidentCustomFieldDefinition,
  packCustomFieldSettingsFormValues,
  removeCustomFieldSettingsFormKeys,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsForm";
import IncidentCustomFieldCreateSettingsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsCopy";
import { IncidentCustomFieldDefinition } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldDefinitions";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import {
  CustomFieldCreateSetting,
  CustomFieldCreateSettings,
} from "../../../Types/CustomField/CustomFieldCreateSettings";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * The inputs behind "Custom Fields on Create" (an incident template) and
 * "Questions" (an incident form): one dropdown per incident custom field,
 * keyed by the field's template variable key. What is pinned here, without
 * rendering anything:
 *
 *   - which fields get an input at all (a template variable key is needed);
 *   - the choices and their labels in each mode - Default naming what the
 *     field does on its own in a template, Not Asked first on a form;
 *   - how a stored setting reads back in each mode;
 *   - what is saved: compacted, with Default (and on a form Not Asked) left
 *     out, a cleared dropdown meaning the same, and the settings of fields
 *     the form did not show kept as they were;
 *   - the inputs never travel as misc data, and never under a bare key.
 */

const IMPACT: IncidentCustomFieldDefinition = {
  name: "Impact",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Low\nHigh",
  showOnCreate: true,
  isRequiredOnCreate: true,
  variableKey: "impact",
};

const DURATION: IncidentCustomFieldDefinition = {
  name: "Estimated Duration",
  customFieldType: CustomFieldType.Number,
  showOnCreate: true,
  variableKey: "estimated_duration",
};

const CATEGORY: IncidentCustomFieldDefinition = {
  name: "Category",
  customFieldType: CustomFieldType.Text,
  variableKey: "category",
};

// Required on its own asks for nothing: only Show on Create puts it on the step.
const REQUIRED_NOT_SHOWN: IncidentCustomFieldDefinition = {
  name: "Root Cause",
  customFieldType: CustomFieldType.LongText,
  isRequiredOnCreate: true,
  variableKey: "root_cause",
};

// Older than template variable keys: it can have no setting.
const NO_KEY: IncidentCustomFieldDefinition = {
  name: "Legacy",
  customFieldType: CustomFieldType.Text,
  showOnCreate: true,
};

const ALL: Array<IncidentCustomFieldDefinition> = [
  IMPACT,
  DURATION,
  CATEGORY,
  REQUIRED_NOT_SHOWN,
  NO_KEY,
];

function key(variableKey: string): string {
  return getCustomFieldSettingFormKey(variableKey);
}

function labels(options: Array<DropdownOption>): Array<string> {
  return options.map((option: DropdownOption): string => {
    return option.label;
  });
}

function values(options: Array<DropdownOption>): Array<unknown> {
  return options.map((option: DropdownOption): unknown => {
    return option.value;
  });
}

describe("the form keys", () => {
  test("each input is held under customFieldSettings:<variableKey>", () => {
    expect(INCIDENT_CUSTOM_FIELD_SETTING_FORM_KEY_PREFIX).toBe(
      "customFieldSettings:",
    );
    expect(getCustomFieldSettingFormKey("impact")).toBe(
      "customFieldSettings:impact",
    );
  });

  test("a field whose key is also a column's name gets an input of its own", () => {
    // A field named "Title" has the key "title", which the wizard also asks.
    expect(getCustomFieldSettingFormKey("title")).not.toBe("title");
  });
});

describe("which fields can have a setting", () => {
  test("every field with a template variable key, in the order given", () => {
    expect(
      getKeyedCustomFieldDefinitions(ALL).map(
        (definition: KeyedIncidentCustomFieldDefinition): string => {
          return definition.variableKey;
        },
      ),
    ).toEqual(["impact", "estimated_duration", "category", "root_cause"]);
  });

  test("a field with no key, an empty key or a key that is not one is left out", () => {
    expect(
      getKeyedCustomFieldDefinitions([
        NO_KEY,
        { ...CATEGORY, variableKey: "" },
        { ...CATEGORY, variableKey: "Not A Key" },
        { ...CATEGORY, variableKey: "__proto__" },
        { ...CATEGORY, variableKey: "a".repeat(65) },
      ]),
    ).toEqual([]);
  });

  test("two fields claiming one key: only the first gets the input", () => {
    const kept: Array<KeyedIncidentCustomFieldDefinition> =
      getKeyedCustomFieldDefinitions([
        IMPACT,
        { ...CATEGORY, name: "Impact (copy)", variableKey: "impact" },
      ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]!.name).toBe("Impact");
  });

  test("the definitions passed in are not changed", () => {
    const definitions: Array<IncidentCustomFieldDefinition> = [{ ...IMPACT }];

    getKeyedCustomFieldDefinitions(definitions)[0]!.name = "Changed";

    expect(definitions[0]!.name).toBe("Impact");
  });
});

describe("a template's choices", () => {
  test("Default says what the field does on its own", () => {
    expect(getTemplateDefaultLabel(IMPACT)).toBe("Default (Required)");
    expect(getTemplateDefaultLabel(DURATION)).toBe("Default (Optional)");
    expect(getTemplateDefaultLabel(CATEGORY)).toBe("Default (Not Shown)");
    expect(getTemplateDefaultLabel(REQUIRED_NOT_SHOWN)).toBe(
      "Default (Not Shown)",
    );
  });

  test("Default, Required, Optional and Hidden, in that order", () => {
    const options: Array<DropdownOption> = getCustomFieldSettingOptions(
      IMPACT,
      "template",
    );

    expect(values(options)).toEqual([
      CustomFieldCreateSetting.Default,
      CustomFieldCreateSetting.Required,
      CustomFieldCreateSetting.Optional,
      CustomFieldCreateSetting.Hidden,
    ]);
    expect(labels(options)).toEqual([
      "Default (Required)",
      "Required",
      "Optional",
      "Hidden",
    ]);
  });

  test("only Default's label changes from field to field", () => {
    expect(labels(getCustomFieldSettingOptions(CATEGORY, "template"))).toEqual([
      "Default (Not Shown)",
      "Required",
      "Optional",
      "Hidden",
    ]);
  });

  test("the labels are the shared copy", () => {
    expect(labels(getCustomFieldSettingOptions(DURATION, "template"))).toEqual([
      IncidentCustomFieldCreateSettingsCopy.templateDefaultOptional,
      IncidentCustomFieldCreateSettingsCopy.required,
      IncidentCustomFieldCreateSettingsCopy.optional,
      IncidentCustomFieldCreateSettingsCopy.templateHidden,
    ]);
  });
});

describe("a form's choices", () => {
  test("Not Asked, Optional and Required, in that order, for every field", () => {
    for (const definition of [IMPACT, DURATION, CATEGORY]) {
      const options: Array<DropdownOption> = getCustomFieldSettingOptions(
        definition,
        "form",
      );

      expect(values(options)).toEqual([
        CustomFieldCreateSetting.Hidden,
        CustomFieldCreateSetting.Optional,
        CustomFieldCreateSetting.Required,
      ]);
      expect(labels(options)).toEqual(["Not Asked", "Optional", "Required"]);
    }
  });

  test("a form offers no Default: its fields are not asked until it names them", () => {
    expect(values(getCustomFieldSettingOptions(IMPACT, "form"))).not.toContain(
      CustomFieldCreateSetting.Default,
    );
  });
});

describe("a field with nothing stored", () => {
  test("is Default on a template and Not Asked on a form", () => {
    expect(getUnsetCustomFieldSetting("template")).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(getUnsetCustomFieldSetting("form")).toBe(
      CustomFieldCreateSetting.Hidden,
    );
  });
});

describe("reading a stored setting", () => {
  const STORED: JSONObject = {
    impact: "Hidden",
    estimated_duration: "Required",
    category: "Default",
    // Not a setting at all: the field is Default / Not Asked.
    root_cause: "required",
  };

  test("a template reads each setting as stored, anything else as Default", () => {
    expect(getCustomFieldSettingValue(IMPACT, STORED, "template")).toBe(
      CustomFieldCreateSetting.Hidden,
    );
    expect(getCustomFieldSettingValue(DURATION, STORED, "template")).toBe(
      CustomFieldCreateSetting.Required,
    );
    expect(getCustomFieldSettingValue(CATEGORY, STORED, "template")).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(
      getCustomFieldSettingValue(REQUIRED_NOT_SHOWN, STORED, "template"),
    ).toBe(CustomFieldCreateSetting.Default);
    expect(getCustomFieldSettingValue(IMPACT, null, "template")).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(getCustomFieldSettingValue(NO_KEY, STORED, "template")).toBe(
      CustomFieldCreateSetting.Default,
    );
  });

  test("a form reads Default, Hidden and anything it does not know as Not Asked", () => {
    expect(getCustomFieldSettingValue(IMPACT, STORED, "form")).toBe(
      CustomFieldCreateSetting.Hidden,
    );
    expect(getCustomFieldSettingValue(DURATION, STORED, "form")).toBe(
      CustomFieldCreateSetting.Required,
    );
    expect(getCustomFieldSettingValue(CATEGORY, STORED, "form")).toBe(
      CustomFieldCreateSetting.Hidden,
    );
    expect(getCustomFieldSettingValue(REQUIRED_NOT_SHOWN, STORED, "form")).toBe(
      CustomFieldCreateSetting.Hidden,
    );
    expect(
      getCustomFieldSettingValue(IMPACT, { impact: "Optional" }, "form"),
    ).toBe(CustomFieldCreateSetting.Optional);
  });

  test("the label is the option's: Default naming the field's own behaviour", () => {
    expect(getCustomFieldSettingLabel(IMPACT, {}, "template")).toBe(
      "Default (Required)",
    );
    expect(
      getCustomFieldSettingLabel(IMPACT, { impact: "Optional" }, "template"),
    ).toBe("Optional");
    expect(
      getCustomFieldSettingLabel(
        CATEGORY,
        { category: "Required" },
        "template",
      ),
    ).toBe("Required");
    expect(
      getCustomFieldSettingLabel(
        DURATION,
        { estimated_duration: "Hidden" },
        "template",
      ),
    ).toBe("Hidden");
  });

  test("on a form, the label of a field not asked is Not Asked", () => {
    expect(getCustomFieldSettingLabel(IMPACT, {}, "form")).toBe("Not Asked");
    expect(
      getCustomFieldSettingLabel(IMPACT, { impact: "Default" }, "form"),
    ).toBe("Not Asked");
    expect(
      getCustomFieldSettingLabel(IMPACT, { impact: "Required" }, "form"),
    ).toBe("Required");
    expect(
      getCustomFieldSettingLabel(IMPACT, { impact: "Optional" }, "form"),
    ).toBe("Optional");
  });

  test("a setting is 'chosen' when the record decides the field for itself", () => {
    expect(isCustomFieldSettingChosen(IMPACT, {}, "template")).toBe(false);
    expect(
      isCustomFieldSettingChosen(IMPACT, { impact: "Default" }, "template"),
    ).toBe(false);
    expect(
      isCustomFieldSettingChosen(IMPACT, { impact: "Hidden" }, "template"),
    ).toBe(true);
    expect(
      isCustomFieldSettingChosen(IMPACT, { impact: "Required" }, "template"),
    ).toBe(true);

    expect(isCustomFieldSettingChosen(IMPACT, {}, "form")).toBe(false);
    expect(
      isCustomFieldSettingChosen(IMPACT, { impact: "Hidden" }, "form"),
    ).toBe(false);
    expect(
      isCustomFieldSettingChosen(IMPACT, { impact: "Optional" }, "form"),
    ).toBe(true);
  });
});

describe("a field's type", () => {
  test("is named as the custom field settings pages name it", () => {
    expect(getCustomFieldTypeLabel(IMPACT)).toBe("Dropdown (single select)");
    expect(getCustomFieldTypeLabel(DURATION)).toBe("Number");
    expect(getCustomFieldTypeLabel(REQUIRED_NOT_SHOWN)).toBe("Long text");
  });

  test("a field with no type has no type label", () => {
    expect(
      getCustomFieldTypeLabel({ name: "Untyped", variableKey: "untyped" }),
    ).toBeUndefined();
  });
});

describe("the form's starting values", () => {
  test("every keyed field's setting under its form key, Default included", () => {
    expect(
      getCustomFieldSettingsFormInitialValues({
        definitions: ALL,
        settings: { impact: "Hidden", root_cause: "Optional" },
        mode: "template",
      }),
    ).toEqual({
      [key("impact")]: "Hidden",
      [key("estimated_duration")]: "Default",
      [key("category")]: "Default",
      [key("root_cause")]: "Optional",
    });
  });

  test("on a form, every field not asked starts on Not Asked", () => {
    expect(
      getCustomFieldSettingsFormInitialValues({
        definitions: [IMPACT, DURATION, CATEGORY],
        settings: { impact: "Required", category: "Default" },
        mode: "form",
      }),
    ).toEqual({
      [key("impact")]: "Required",
      [key("estimated_duration")]: "Hidden",
      [key("category")]: "Hidden",
    });
  });
});

describe("what is saved", () => {
  test("a template keeps Required, Optional and Hidden, and leaves Default out", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: ALL,
        formValues: {
          [key("impact")]: "Hidden",
          [key("estimated_duration")]: "Required",
          [key("category")]: "Optional",
          [key("root_cause")]: "Default",
        },
        mode: "template",
      }),
    ).toEqual({
      impact: "Hidden",
      estimated_duration: "Required",
      category: "Optional",
    });
  });

  test("a template left on Default everywhere saves an empty object", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: ALL,
        formValues: {
          [key("impact")]: "Default",
          [key("category")]: "Default",
        },
        mode: "template",
      }),
    ).toEqual({});
  });

  test("a form keeps only the questions it asks: Not Asked is left out", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT, DURATION, CATEGORY],
        formValues: {
          [key("impact")]: "Required",
          [key("estimated_duration")]: "Hidden",
          [key("category")]: "Optional",
        },
        mode: "form",
      }),
    ).toEqual({ impact: "Required", category: "Optional" });
  });

  test("a form drops a stored Default and Hidden too", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: {},
        startingSettings: {
          impact: "Required",
          estimated_duration: "Default",
          category: "Hidden",
        },
        mode: "form",
      }),
    ).toEqual({ impact: "Required" });
  });

  test("a cleared dropdown means Default: the stored setting goes", () => {
    for (const cleared of [null, "", undefined]) {
      expect(
        packCustomFieldSettingsFormValues({
          definitions: [IMPACT, DURATION],
          formValues: {
            [key("impact")]: cleared as unknown as JSONObject["value"],
            [key("estimated_duration")]: "Optional",
          },
          startingSettings: { impact: "Hidden", estimated_duration: "Hidden" },
          mode: "template",
        }),
      ).toEqual({ estimated_duration: "Optional" });
    }
  });

  test("a value that is not a setting is treated as cleared, never saved", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT, DURATION],
        formValues: {
          [key("impact")]: "required",
          [key("estimated_duration")]: "Sometimes",
        },
        startingSettings: { impact: "Hidden" },
        mode: "template",
      }),
    ).toEqual({});
  });

  test("a dropdown still holding its picked option object saves the option's value", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: {
          [key("impact")]: { label: "Hidden", value: "Hidden" },
        },
        mode: "template",
      }),
    ).toEqual({ impact: "Hidden" });
  });

  test("a field the form did not hold a value for keeps its stored setting", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT, DURATION],
        formValues: { [key("impact")]: "Optional" },
        startingSettings: { estimated_duration: "Hidden" },
        mode: "template",
      }),
    ).toEqual({ impact: "Optional", estimated_duration: "Hidden" });
  });

  test("a setting for a field no longer listed is kept, so a field made again gets it back", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: { [key("impact")]: "Required" },
        startingSettings: { deleted_field: "Required" },
        mode: "template",
      }),
    ).toEqual({ impact: "Required", deleted_field: "Required" });
  });

  test("stored entries the server would refuse are dropped", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: { [key("impact")]: "Optional" },
        startingSettings: {
          "Not A Key": "Required",
          category: "required",
          estimated_duration: 5,
        },
        mode: "template",
      }),
    ).toEqual({ impact: "Optional" });
  });

  test("a field without a key is never saved, whatever the form holds", () => {
    const saved: CustomFieldCreateSettings = packCustomFieldSettingsFormValues({
      definitions: [NO_KEY],
      formValues: {
        [key("")]: "Required",
        "customFieldSettings:undefined": "Required",
        Legacy: "Required",
      },
      mode: "template",
    });

    expect(saved).toEqual({});
  });

  test("the stored settings passed in are not changed", () => {
    const stored: JSONObject = { impact: "Hidden" };

    packCustomFieldSettingsFormValues({
      definitions: [IMPACT],
      formValues: { [key("impact")]: "Required" },
      startingSettings: stored,
      mode: "template",
    });

    expect(stored).toEqual({ impact: "Hidden" });
  });

  test("no form values at all saves the stored settings, compacted", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: null,
        startingSettings: { impact: "Required", category: "Default" },
        mode: "template",
      }),
    ).toEqual({ impact: "Required" });
  });
});

describe("the misc data a create form sends", () => {
  test("loses the settings inputs and keeps everything else", () => {
    const miscDataProps: JSONObject = {
      [key("impact")]: "Required",
      [key("category")]: "Hidden",
      "customFields:Impact": "High",
      ownerTeams: ["team-1"],
    };

    removeCustomFieldSettingsFormKeys(miscDataProps);

    expect(miscDataProps).toEqual({
      "customFields:Impact": "High",
      ownerTeams: ["team-1"],
    });
  });
});

describe("the dropdowns", () => {
  test("one per keyed field, titled with its name and described with its type", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldSettingsFormFields(
      { definitions: ALL, mode: "template" },
    );

    expect(
      fields.map((field: Field<JSONObject>): unknown => {
        return field.title;
      }),
    ).toEqual(["Impact", "Estimated Duration", "Category", "Root Cause"]);
    expect(
      fields.map((field: Field<JSONObject>): unknown => {
        return field.description;
      }),
    ).toEqual(["Dropdown (single select)", "Number", "Text", "Long text"]);
    expect(
      fields.map((field: Field<JSONObject>): Array<string> => {
        return Object.keys(field.field || {});
      }),
    ).toEqual([
      [key("impact")],
      [key("estimated_duration")],
      [key("category")],
      [key("root_cause")],
    ]);
  });

  test("each is an optional dropdown of the mode's choices, starting on the unset one", () => {
    const [templateField]: Array<Field<JSONObject>> =
      buildCustomFieldSettingsFormFields({
        definitions: [IMPACT],
        mode: "template",
      });

    expect(templateField!.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(templateField!.dropdownOptions).toEqual(
      getCustomFieldSettingOptions(IMPACT, "template"),
    );
    expect(templateField!.defaultValue).toBe(CustomFieldCreateSetting.Default);
    expect(templateField!.placeholder).toBe("Default (Required)");
    expect(templateField!.required).toBe(false);
    // "(Optional)" beside a choice that includes Optional would only confuse.
    expect(templateField!.hideOptionalLabel).toBe(true);

    const [formField]: Array<Field<JSONObject>> =
      buildCustomFieldSettingsFormFields({
        definitions: [IMPACT],
        mode: "form",
      });

    expect(formField!.dropdownOptions).toEqual(
      getCustomFieldSettingOptions(IMPACT, "form"),
    );
    expect(formField!.defaultValue).toBe(CustomFieldCreateSetting.Hidden);
    expect(formField!.placeholder).toBe("Not Asked");
  });

  test("a step only when asked for one, and no description for a field with no type", () => {
    const [withoutStep]: Array<Field<JSONObject>> =
      buildCustomFieldSettingsFormFields({
        definitions: [{ name: "Untyped", variableKey: "untyped" }],
        mode: "template",
      });

    expect(withoutStep!.stepId).toBeUndefined();
    expect(withoutStep!.description).toBeUndefined();

    const [withStep]: Array<Field<JSONObject>> =
      buildCustomFieldSettingsFormFields({
        definitions: [IMPACT],
        mode: "template",
        stepId: "custom-field-settings",
      });

    expect(withStep!.stepId).toBe("custom-field-settings");
  });

  test("no field with a key: no dropdowns", () => {
    expect(
      buildCustomFieldSettingsFormFields({
        definitions: [NO_KEY],
        mode: "template",
      }),
    ).toEqual([]);
  });

  test("in a model's own form, each is checked against customFieldSettings and held under its own key", () => {
    const fields: Array<ModelField<IncidentTemplate>> =
      buildCustomFieldSettingsModelFormFields<IncidentTemplate>({
        definitions: [IMPACT, CATEGORY],
        mode: "template",
        stepId: "custom-field-settings",
      });

    expect(fields).toHaveLength(2);

    for (const field of fields) {
      // Not a column of its own: nothing is selected or sent for it.
      expect(field.field).toBeUndefined();
      expect(field.overrideField).toEqual({ customFieldSettings: true });
      expect(String(field.overrideFieldKey)).toMatch(/^customFieldSettings:/);
      expect(field.stepId).toBe("custom-field-settings");
      expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    }

    expect(
      fields.map((field: ModelField<IncidentTemplate>): unknown => {
        return field.overrideFieldKey;
      }),
    ).toEqual([key("impact"), key("category")]);
    expect(fields[1]!.dropdownOptions).toEqual(
      getCustomFieldSettingOptions(CATEGORY, "template"),
    );
  });
});
