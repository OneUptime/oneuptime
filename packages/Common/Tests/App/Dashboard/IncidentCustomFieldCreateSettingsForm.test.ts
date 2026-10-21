import { describe, expect, test } from "@jest/globals";
import {
  buildCustomFieldSettingsFormFields,
  buildCustomFieldSettingsModelFormFields,
  getChangedCustomFieldSettingsFormValues,
  getCustomFieldProjectDefaultLabel,
  getCustomFieldSettingFormKey,
  getCustomFieldSettingLabel,
  getCustomFieldSettingOptions,
  getCustomFieldSettingsFormInitialValues,
  getCustomFieldSettingValue,
  getCustomFieldTypeLabel,
  getKeyedCustomFieldDefinitions,
  getTemplateDefaultLabel,
  getTemplateProjectDefaultLabel,
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
 *     the form did not show kept as they were on a template - and dropped on
 *     a form, whose public page must not ask a field nobody put there;
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
    const options: Array<DropdownOption> = getCustomFieldSettingOptions(IMPACT);

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
    expect(labels(getCustomFieldSettingOptions(CATEGORY))).toEqual([
      "Default (Not Shown)",
      "Required",
      "Optional",
      "Hidden",
    ]);
  });

  test("the labels are the shared copy", () => {
    expect(labels(getCustomFieldSettingOptions(DURATION))).toEqual([
      IncidentCustomFieldCreateSettingsCopy.templateDefaultOptional,
      IncidentCustomFieldCreateSettingsCopy.required,
      IncidentCustomFieldCreateSettingsCopy.optional,
      IncidentCustomFieldCreateSettingsCopy.templateHidden,
    ]);
  });
});

/*
 * A field the template overrides no longer says, in its own label, what the
 * project does with it; "Project default: ..." says it beside the override.
 */
describe("the project default beside a template's own setting", () => {
  test("names what the field does on its own", () => {
    expect(getTemplateProjectDefaultLabel(IMPACT)).toBe(
      "Project default: Required",
    );
    expect(getTemplateProjectDefaultLabel(DURATION)).toBe(
      "Project default: Optional",
    );
    expect(getTemplateProjectDefaultLabel(CATEGORY)).toBe(
      "Project default: Not Shown",
    );
    // Required on its own asks for nothing.
    expect(getTemplateProjectDefaultLabel(REQUIRED_NOT_SHOWN)).toBe(
      "Project default: Not Shown",
    );
  });

  test("is shown for every setting a template chooses for itself", () => {
    expect(
      getCustomFieldProjectDefaultLabel(IMPACT, { impact: "Optional" }),
    ).toBe("Project default: Required");
    expect(
      getCustomFieldProjectDefaultLabel(IMPACT, { impact: "Hidden" }),
    ).toBe("Project default: Required");
    expect(
      getCustomFieldProjectDefaultLabel(CATEGORY, { category: "Required" }),
    ).toBe("Project default: Not Shown");
    // Even one that matches the project's: it is still the template's choice.
    expect(
      getCustomFieldProjectDefaultLabel(DURATION, {
        estimated_duration: "Optional",
      }),
    ).toBe("Project default: Optional");
  });

  test("not for a field left on Default, whose label already says it", () => {
    expect(getCustomFieldProjectDefaultLabel(IMPACT, {})).toBeUndefined();
    expect(
      getCustomFieldProjectDefaultLabel(IMPACT, { impact: "Default" }),
    ).toBeUndefined();
  });

  test("the labels are the shared copy", () => {
    expect([
      getTemplateProjectDefaultLabel(IMPACT),
      getTemplateProjectDefaultLabel(DURATION),
      getTemplateProjectDefaultLabel(CATEGORY),
    ]).toEqual([
      IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultRequired,
      IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultOptional,
      IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultNotShown,
    ]);
  });
});

/*
 * A field copied from a monitor custom field takes the monitor's value once
 * the incident has a monitor, so a public form does not ask it while its
 * incident template attaches monitors. The Questions card says so beside it.
 */
describe("reading a stored setting", () => {
  const STORED: JSONObject = {
    impact: "Hidden",
    estimated_duration: "Required",
    category: "Default",
    // Not a setting at all: the field is Default / Not Asked.
    root_cause: "required",
  };

  test("a template reads each setting as stored, anything else as Default", () => {
    expect(getCustomFieldSettingValue(IMPACT, STORED)).toBe(
      CustomFieldCreateSetting.Hidden,
    );
    expect(getCustomFieldSettingValue(DURATION, STORED)).toBe(
      CustomFieldCreateSetting.Required,
    );
    expect(getCustomFieldSettingValue(CATEGORY, STORED)).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(getCustomFieldSettingValue(REQUIRED_NOT_SHOWN, STORED)).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(getCustomFieldSettingValue(IMPACT, null)).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(getCustomFieldSettingValue(NO_KEY, STORED)).toBe(
      CustomFieldCreateSetting.Default,
    );
  });

  test("the label is the option's: Default naming the field's own behaviour", () => {
    expect(getCustomFieldSettingLabel(IMPACT, {})).toBe("Default (Required)");
    expect(getCustomFieldSettingLabel(IMPACT, { impact: "Optional" })).toBe(
      "Optional",
    );
    expect(getCustomFieldSettingLabel(CATEGORY, { category: "Required" })).toBe(
      "Required",
    );
    expect(
      getCustomFieldSettingLabel(DURATION, { estimated_duration: "Hidden" }),
    ).toBe("Hidden");
  });

  test("a setting is 'chosen' when the record decides the field for itself", () => {
    expect(isCustomFieldSettingChosen(IMPACT, {})).toBe(false);
    expect(isCustomFieldSettingChosen(IMPACT, { impact: "Default" })).toBe(
      false,
    );
    expect(isCustomFieldSettingChosen(IMPACT, { impact: "Hidden" })).toBe(true);
    expect(isCustomFieldSettingChosen(IMPACT, { impact: "Required" })).toBe(
      true,
    );
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
      }),
    ).toEqual({
      [key("impact")]: "Hidden",
      [key("estimated_duration")]: "Default",
      [key("category")]: "Default",
      [key("root_cause")]: "Optional",
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
      }),
    ).toEqual({});
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
      }),
    ).toEqual({ impact: "Hidden" });
  });

  test("a field the form did not hold a value for keeps its stored setting", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT, DURATION],
        formValues: { [key("impact")]: "Optional" },
        startingSettings: { estimated_duration: "Hidden" },
      }),
    ).toEqual({ impact: "Optional", estimated_duration: "Hidden" });
  });

  test("a setting for a field no longer listed is kept, so a field made again gets it back", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: { [key("impact")]: "Required" },
        startingSettings: { deleted_field: "Required" },
      }),
    ).toEqual({ impact: "Required", deleted_field: "Required" });
  });

  /*
   * A form's settings are the questions on its public page. The question of
   * a field deleted since would be asked of the next field that gets its key
   * - made again under the same name, or any field whose name has no Latin
   * letters, which all start from the key "field" - so a form keeps the
   * questions of the fields it lists, and no others.
   */
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
    });

    expect(saved).toEqual({});
  });

  test("the stored settings passed in are not changed", () => {
    const stored: JSONObject = { impact: "Hidden" };

    packCustomFieldSettingsFormValues({
      definitions: [IMPACT],
      formValues: { [key("impact")]: "Required" },
      startingSettings: stored,
    });

    expect(stored).toEqual({ impact: "Hidden" });
  });

  test("no form values at all saves the stored settings, compacted", () => {
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: null,
        startingSettings: { impact: "Required", category: "Default" },
      }),
    ).toEqual({ impact: "Required" });
  });
});

/*
 * A save lays only the dropdowns changed in the modal over the settings as
 * they are stored when it saves, so what somebody else saved meanwhile, for
 * the fields this edit leaves alone, stays.
 */
describe("what an edit changed", () => {
  test("only the dropdowns whose choice changed, under their form keys", () => {
    expect(
      getChangedCustomFieldSettingsFormValues({
        definitions: ALL,
        formValues: {
          [key("impact")]: "Hidden",
          [key("estimated_duration")]: "Default",
          [key("category")]: "Optional",
          [key("root_cause")]: "Optional",
        },
        initialValues: {
          [key("impact")]: "Default",
          [key("estimated_duration")]: "Default",
          [key("category")]: "Optional",
          [key("root_cause")]: "Default",
        },
      }),
    ).toEqual({
      [key("impact")]: "Hidden",
      [key("root_cause")]: "Optional",
    });
  });

  test("a dropdown cleared while on Default, or holding its option object, has not changed", () => {
    expect(
      getChangedCustomFieldSettingsFormValues({
        definitions: [IMPACT, DURATION],
        formValues: {
          [key("impact")]: null,
          [key("estimated_duration")]: { label: "Hidden", value: "Hidden" },
        },
        initialValues: {
          [key("impact")]: "Default",
          [key("estimated_duration")]: "Hidden",
        },
      }),
    ).toEqual({});
  });

  test("a dropdown cleared from a setting has changed: it goes back to Default", () => {
    const changed: JSONObject = getChangedCustomFieldSettingsFormValues({
      definitions: [IMPACT],
      formValues: { [key("impact")]: null },
      initialValues: { [key("impact")]: "Hidden" },
    });

    expect(changed).toEqual({ [key("impact")]: null });
    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: changed,
        startingSettings: { impact: "Hidden", category: "Required" },
      }),
    ).toEqual({ category: "Required" });
  });

  test("a field the form never held a value for has nothing to say", () => {
    expect(
      getChangedCustomFieldSettingsFormValues({
        definitions: [IMPACT],
        formValues: null,
        initialValues: null,
      }),
    ).toEqual({});
  });

  test("packed over what is stored now, another admin's settings for the other fields stay", () => {
    const opened: JSONObject = getCustomFieldSettingsFormInitialValues({
      definitions: [IMPACT, DURATION, CATEGORY],
      settings: {},
    });

    // Saved by somebody else after the form opened.
    const storedNow: JSONObject = {
      estimated_duration: "Hidden",
      category: "Required",
    };

    expect(
      packCustomFieldSettingsFormValues({
        definitions: [IMPACT, DURATION, CATEGORY],
        formValues: getChangedCustomFieldSettingsFormValues({
          definitions: [IMPACT, DURATION, CATEGORY],
          // Every dropdown is submitted; only Impact was changed.
          formValues: { ...opened, [key("impact")]: "Optional" },
          initialValues: opened,
        }),
        startingSettings: storedNow,
      }),
    ).toEqual({
      impact: "Optional",
      estimated_duration: "Hidden",
      category: "Required",
    });
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
      { definitions: ALL },
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

  test("each is an optional dropdown of a template's choices, starting on Default", () => {
    const [templateField]: Array<Field<JSONObject>> =
      buildCustomFieldSettingsFormFields({
        definitions: [IMPACT],
      });

    expect(templateField!.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(templateField!.dropdownOptions).toEqual(
      getCustomFieldSettingOptions(IMPACT),
    );
    expect(templateField!.defaultValue).toBe(CustomFieldCreateSetting.Default);
    expect(templateField!.placeholder).toBe("Default (Required)");
    expect(templateField!.required).toBe(false);
    // "(Optional)" beside a choice that includes Optional would only confuse.
    expect(templateField!.hideOptionalLabel).toBe(true);
  });

  test("a step only when asked for one, and no description for a field with no type", () => {
    const [withoutStep]: Array<Field<JSONObject>> =
      buildCustomFieldSettingsFormFields({
        definitions: [{ name: "Untyped", variableKey: "untyped" }],
      });

    expect(withoutStep!.stepId).toBeUndefined();
    expect(withoutStep!.description).toBeUndefined();

    const [withStep]: Array<Field<JSONObject>> =
      buildCustomFieldSettingsFormFields({
        definitions: [IMPACT],
        stepId: "custom-field-settings",
      });

    expect(withStep!.stepId).toBe("custom-field-settings");
  });

  test("no field with a key: no dropdowns", () => {
    expect(
      buildCustomFieldSettingsFormFields({
        definitions: [NO_KEY],
      }),
    ).toEqual([]);
  });

  test("in a model's own form, each is checked against customFieldSettings and held under its own key", () => {
    const fields: Array<ModelField<IncidentTemplate>> =
      buildCustomFieldSettingsModelFormFields<IncidentTemplate>({
        definitions: [IMPACT, CATEGORY],
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
      getCustomFieldSettingOptions(CATEGORY),
    );
  });
});
