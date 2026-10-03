import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  compactCustomFieldCreateSettings,
  CustomFieldCreateSetting,
  CustomFieldCreateSettings,
  EffectiveCustomFieldCreateSetting,
  getCustomFieldCreateSetting,
  getEffectiveCustomFieldCreateSetting,
  isCustomFieldCreateSetting,
  readCustomFieldCreateSettings,
} from "Common/Types/CustomField/CustomFieldCreateSettings";
import { isValidCustomFieldVariableKey } from "Common/Types/CustomField/CustomFieldVariableKey";
import { JSONObject } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { CUSTOM_FIELD_TYPE_LABELS } from "../CustomFields/CustomFieldSettingsCopy";
import IncidentCustomFieldCreateSettingsCopy from "./IncidentCustomFieldCreateSettingsCopy";
import { IncidentCustomFieldDefinition } from "./IncidentCustomFieldDefinitions";

/*
 * The inputs that set, per incident custom field, whether it is asked for
 * when an incident is created (Common/Types/CustomField/
 * CustomFieldCreateSettings): one dropdown per field, in the fields' order,
 * on an incident template's Custom Fields on Create card and the wizard step
 * of the same name. The choices are Default - which follows the field's own
 * Show on Create and Required on Create, and says which - Required, Optional
 * and Hidden.
 *
 * The values are the settings themselves ("Required", "Hidden", ...). Each
 * input is held under its own form key, "customFieldSettings:<variableKey>":
 * never the bare key, which a field named "Title" or "Constructor" would
 * share with something else in the form.
 */

export const INCIDENT_CUSTOM_FIELD_SETTING_FORM_KEY_PREFIX: string =
  "customFieldSettings:";

// The column a template's settings are stored in.
export const INCIDENT_CUSTOM_FIELD_SETTINGS_COLUMN: string =
  "customFieldSettings";

/*
 * A definition a setting can be kept for. Settings are keyed by the field's
 * template variable key, which every field has had since migration
 * 1795800000000; one without cannot be given a setting, so it is left out
 * rather than offered an input that could never be saved.
 */
export interface KeyedIncidentCustomFieldDefinition
  extends IncidentCustomFieldDefinition {
  variableKey: string;
}

export type GetCustomFieldSettingFormKeyFunction = (
  variableKey: string,
) => string;

// Where the form holds one field's setting.
export const getCustomFieldSettingFormKey: GetCustomFieldSettingFormKeyFunction =
  (variableKey: string): string => {
    return `${INCIDENT_CUSTOM_FIELD_SETTING_FORM_KEY_PREFIX}${variableKey}`;
  };

export type GetKeyedCustomFieldDefinitionsFunction = (
  definitions: Array<IncidentCustomFieldDefinition>,
) => Array<KeyedIncidentCustomFieldDefinition>;

/**
 * The fields that can have a setting, in the order given: the ones with a
 * valid template variable key. The key is unique per project, but only the
 * first field with a key is kept all the same - two inputs under one form key
 * would each overwrite the other's answer.
 */
export const getKeyedCustomFieldDefinitions: GetKeyedCustomFieldDefinitionsFunction =
  (
    definitions: Array<IncidentCustomFieldDefinition>,
  ): Array<KeyedIncidentCustomFieldDefinition> => {
    const seenKeys: Set<string> = new Set<string>();
    const keyed: Array<KeyedIncidentCustomFieldDefinition> = [];

    for (const definition of definitions) {
      const variableKey: string | undefined = definition.variableKey;

      if (
        typeof variableKey !== "string" ||
        !isValidCustomFieldVariableKey(variableKey) ||
        seenKeys.has(variableKey)
      ) {
        continue;
      }

      seenKeys.add(variableKey);
      keyed.push({ ...definition, variableKey: variableKey });
    }

    return keyed;
  };

export type GetTemplateDefaultLabelFunction = (
  definition: IncidentCustomFieldDefinition,
) => string;

/**
 * "Default", saying what that is for this field: what the Details step does
 * with it when a template leaves it alone - the field's own Show on Create
 * and Required on Create.
 */
export const getTemplateDefaultLabel: GetTemplateDefaultLabelFunction = (
  definition: IncidentCustomFieldDefinition,
): string => {
  const projectDefault: EffectiveCustomFieldCreateSetting =
    getEffectiveCustomFieldCreateSetting(definition);

  if (projectDefault === CustomFieldCreateSetting.Required) {
    return IncidentCustomFieldCreateSettingsCopy.templateDefaultRequired;
  }

  if (projectDefault === CustomFieldCreateSetting.Optional) {
    return IncidentCustomFieldCreateSettingsCopy.templateDefaultOptional;
  }

  return IncidentCustomFieldCreateSettingsCopy.templateDefaultNotShown;
};

export type GetTemplateProjectDefaultLabelFunction = (
  definition: IncidentCustomFieldDefinition,
) => string;

/**
 * "Project default: Required", and its two siblings: the behaviour Default
 * names, said beside a setting of the template's own.
 */
export const getTemplateProjectDefaultLabel: GetTemplateProjectDefaultLabelFunction =
  (definition: IncidentCustomFieldDefinition): string => {
    const projectDefault: EffectiveCustomFieldCreateSetting =
      getEffectiveCustomFieldCreateSetting(definition);

    if (projectDefault === CustomFieldCreateSetting.Required) {
      return IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultRequired;
    }

    if (projectDefault === CustomFieldCreateSetting.Optional) {
      return IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultOptional;
    }

    return IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultNotShown;
  };

export type GetCustomFieldSettingOptionsFunction = (
  definition: IncidentCustomFieldDefinition,
) => Array<DropdownOption>;

/**
 * A field's choices, in the order they are listed. The first, Default, is
 * the one a field has when nothing is stored for it.
 */
export const getCustomFieldSettingOptions: GetCustomFieldSettingOptionsFunction =
  (definition: IncidentCustomFieldDefinition): Array<DropdownOption> => {
    return [
      {
        value: CustomFieldCreateSetting.Default,
        label: getTemplateDefaultLabel(definition),
      },
      {
        value: CustomFieldCreateSetting.Required,
        label: IncidentCustomFieldCreateSettingsCopy.required,
      },
      {
        value: CustomFieldCreateSetting.Optional,
        label: IncidentCustomFieldCreateSettingsCopy.optional,
      },
      {
        value: CustomFieldCreateSetting.Hidden,
        label: IncidentCustomFieldCreateSettingsCopy.templateHidden,
      },
    ];
  };

export type GetCustomFieldSettingValueFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
) => CustomFieldCreateSetting;

// A field's setting, as its dropdown holds it.
export const getCustomFieldSettingValue: GetCustomFieldSettingValueFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
): CustomFieldCreateSetting => {
  return getCustomFieldCreateSetting(settings, definition.variableKey);
};

export type GetCustomFieldSettingLabelFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
) => string;

// A field's setting in words: the label of the option it has.
export const getCustomFieldSettingLabel: GetCustomFieldSettingLabelFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
): string => {
  const value: CustomFieldCreateSetting = getCustomFieldSettingValue(
    definition,
    settings,
  );

  const options: Array<DropdownOption> =
    getCustomFieldSettingOptions(definition);

  const option: DropdownOption | undefined = options.find(
    (candidate: DropdownOption): boolean => {
      return candidate.value === value;
    },
  );

  // Every value the readers above return has an option.
  return option ? option.label : options[0]!.label;
};

export type IsCustomFieldSettingChosenFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
) => boolean;

/**
 * Whether the template says something of its own about the field: it
 * overrides it. The card sets those apart from the fields left as they are.
 */
export const isCustomFieldSettingChosen: IsCustomFieldSettingChosenFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
): boolean => {
  return (
    getCustomFieldSettingValue(definition, settings) !==
    CustomFieldCreateSetting.Default
  );
};

export type GetCustomFieldProjectDefaultLabelFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
) => string | undefined;

/**
 * What the project does with a field, to show next to its setting: for a
 * field the template overrides. A field left on Default already says it
 * ("Default (Required)"), so it gets none.
 *
 * Without it, a template that relaxes a field the project requires reads
 * exactly like one that asks a field the project leaves out - and a viewer,
 * who cannot open the editor where Default spells it out, cannot tell which.
 */
export const getCustomFieldProjectDefaultLabel: GetCustomFieldProjectDefaultLabelFunction =
  (
    definition: IncidentCustomFieldDefinition,
    settings: unknown,
  ): string | undefined => {
    if (!isCustomFieldSettingChosen(definition, settings)) {
      return undefined;
    }

    return getTemplateProjectDefaultLabel(definition);
  };

export type GetCustomFieldTypeLabelFunction = (
  definition: IncidentCustomFieldDefinition,
) => string | undefined;

// The field's type, named as the custom field settings pages name it.
export const getCustomFieldTypeLabel: GetCustomFieldTypeLabelFunction = (
  definition: IncidentCustomFieldDefinition,
): string | undefined => {
  if (!definition.customFieldType) {
    return undefined;
  }

  return CUSTOM_FIELD_TYPE_LABELS[definition.customFieldType] || undefined;
};

export type GetCustomFieldSettingsFormInitialValuesFunction = (data: {
  definitions: Array<IncidentCustomFieldDefinition>;
  settings: unknown;
}) => JSONObject;

/**
 * The form's starting values: every field's setting, under its form key -
 * Default included, so each dropdown shows a choice.
 */
export const getCustomFieldSettingsFormInitialValues: GetCustomFieldSettingsFormInitialValuesFunction =
  (data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    settings: unknown;
  }): JSONObject => {
    const initialValues: JSONObject = {};

    for (const definition of getKeyedCustomFieldDefinitions(data.definitions)) {
      initialValues[getCustomFieldSettingFormKey(definition.variableKey)] =
        getCustomFieldSettingValue(definition, data.settings);
    }

    return initialValues;
  };

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

type NormalizeFormValueFunction = (value: unknown) => unknown;

/*
 * A dropdown can still hold the option object it was picked as ({label,
 * value}) rather than its value; the value is what is stored.
 */
const normalizeFormValue: NormalizeFormValueFunction = (
  value: unknown,
): unknown => {
  if (
    isPlainObject(value) &&
    Object.prototype.hasOwnProperty.call(value, "value") &&
    Object.prototype.hasOwnProperty.call(value, "label")
  ) {
    return value["value"];
  }

  return value;
};

export type PackCustomFieldSettingsFormValuesFunction = (data: {
  // The fields the form asked about.
  definitions: Array<IncidentCustomFieldDefinition>;
  // Every value the form submitted.
  formValues: JSONObject | null | undefined;
  /*
   * The settings stored before the edit. A template keeps them for every key
   * the form did not ask about - a field deleted since, whose key a field of
   * the same name gets back, gets its setting back with it (as the settings
   * docs promise).
   */
  startingSettings?: unknown;
}) => CustomFieldCreateSettings;

/**
 * The settings to save: the stored ones, with each field the form asked
 * about set to its dropdown's choice, then compacted - Default says nothing
 * and is left out. A dropdown somebody cleared means the same. Invalid
 * stored entries are dropped too, so what is saved is always a value the
 * server accepts.
 */
export const packCustomFieldSettingsFormValues: PackCustomFieldSettingsFormValuesFunction =
  (data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    formValues: JSONObject | null | undefined;
    startingSettings?: unknown;
  }): CustomFieldCreateSettings => {
    const formValues: JSONObject = data.formValues || {};

    const definitions: Array<KeyedIncidentCustomFieldDefinition> =
      getKeyedCustomFieldDefinitions(data.definitions);

    const settings: CustomFieldCreateSettings = readCustomFieldCreateSettings(
      data.startingSettings,
    );

    for (const definition of definitions) {
      const formKey: string = getCustomFieldSettingFormKey(
        definition.variableKey,
      );

      // The form never held a value for it, so it has nothing to say.
      if (!Object.prototype.hasOwnProperty.call(formValues, formKey)) {
        continue;
      }

      const value: unknown = normalizeFormValue(formValues[formKey]);

      if (isCustomFieldCreateSetting(value)) {
        settings[definition.variableKey] = value;
      } else {
        delete settings[definition.variableKey];
      }
    }

    return compactCustomFieldCreateSettings(settings);
  };

type ReadFormSettingFunction = (value: unknown) => CustomFieldCreateSetting;

/*
 * What a dropdown's value means, as a setting: the option's value, and a
 * cleared or unknown value as Default.
 */
const readFormSetting: ReadFormSettingFunction = (
  value: unknown,
): CustomFieldCreateSetting => {
  const setting: unknown = normalizeFormValue(value);

  if (!isCustomFieldCreateSetting(setting)) {
    return CustomFieldCreateSetting.Default;
  }

  return setting;
};

export type GetChangedCustomFieldSettingsFormValuesFunction = (data: {
  // The fields the form asked about.
  definitions: Array<IncidentCustomFieldDefinition>;
  // Every value the form submitted.
  formValues: JSONObject | null | undefined;
  // What the form started from: getCustomFieldSettingsFormInitialValues.
  initialValues: JSONObject | null | undefined;
}) => JSONObject;

/**
 * The submitted values of the dropdowns somebody changed, under their form
 * keys, and nothing else. A dropdown counts as changed when its choice now
 * means something else: one changed and changed back, or cleared while on
 * Default, has not changed.
 *
 * Packed over the settings as they are stored at the moment of saving
 * (packCustomFieldSettingsFormValues), this saves the edit and only the edit:
 * a field somebody else set while the form was open - another admin, another
 * tab, the API, Terraform - keeps what they set, instead of going back to
 * what this form happened to start from.
 */
export const getChangedCustomFieldSettingsFormValues: GetChangedCustomFieldSettingsFormValuesFunction =
  (data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    formValues: JSONObject | null | undefined;
    initialValues: JSONObject | null | undefined;
  }): JSONObject => {
    const formValues: JSONObject = data.formValues || {};
    const initialValues: JSONObject = data.initialValues || {};
    const changed: JSONObject = {};

    for (const definition of getKeyedCustomFieldDefinitions(data.definitions)) {
      const formKey: string = getCustomFieldSettingFormKey(
        definition.variableKey,
      );

      if (!Object.prototype.hasOwnProperty.call(formValues, formKey)) {
        continue;
      }

      if (
        readFormSetting(formValues[formKey]) ===
        readFormSetting(initialValues[formKey])
      ) {
        continue;
      }

      changed[formKey] = formValues[formKey];
    }

    return changed;
  };

export type RemoveCustomFieldSettingsFormKeysFunction = (
  miscDataProps: JSONObject,
) => void;

/**
 * Takes the inputs' values out of a request's misc data, where ModelForm puts
 * every form-only value: they travel in customFieldSettings, and nowhere
 * else.
 */
export const removeCustomFieldSettingsFormKeys: RemoveCustomFieldSettingsFormKeysFunction =
  (miscDataProps: JSONObject): void => {
    for (const key of Object.keys(miscDataProps)) {
      if (key.startsWith(INCIDENT_CUSTOM_FIELD_SETTING_FORM_KEY_PREFIX)) {
        delete miscDataProps[key];
      }
    }
  };

export type BuildCustomFieldSettingsFormFieldsFunction = (data: {
  definitions: Array<IncidentCustomFieldDefinition>;
  stepId?: string | undefined;
}) => Array<Field<JSONObject>>;

/**
 * One dropdown per field that can have a setting, in the order given, titled
 * with the field's name and described with its type. Never required: a
 * dropdown left empty means Default, which is also why the
 * "(Optional)" mark is left off - next to a choice that includes "Optional"
 * it would only confuse.
 */
export const buildCustomFieldSettingsFormFields: BuildCustomFieldSettingsFormFieldsFunction =
  (data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    stepId?: string | undefined;
  }): Array<Field<JSONObject>> => {
    return getKeyedCustomFieldDefinitions(data.definitions).map(
      (definition: KeyedIncidentCustomFieldDefinition): Field<JSONObject> => {
        const options: Array<DropdownOption> =
          getCustomFieldSettingOptions(definition);

        const field: Field<JSONObject> = {
          field: {
            [getCustomFieldSettingFormKey(definition.variableKey)]: true,
          },
          title: definition.name,
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: options,
          // A cleared dropdown reads as what it means.
          placeholder: options[0]!.label,
          defaultValue: CustomFieldCreateSetting.Default,
          required: false,
          hideOptionalLabel: true,
        };

        const typeLabel: string | undefined =
          getCustomFieldTypeLabel(definition);

        if (typeLabel) {
          field.description = typeLabel;
        }

        if (data.stepId) {
          field.stepId = data.stepId;
        }

        return field;
      },
    );
  };

export type BuildCustomFieldSettingsModelFormFieldsFunction = <
  TBaseModel extends BaseModel,
>(data: {
  definitions: Array<IncidentCustomFieldDefinition>;
  stepId?: string | undefined;
}) => Array<ModelField<TBaseModel>>;

/**
 * The same dropdowns inside a model's own create form (a new incident
 * template's wizard). A ModelForm only knows its model's columns, so each
 * input is permission-checked against the customFieldSettings column
 * (overrideField) and held under its own form key (overrideFieldKey); the
 * page's onBeforeCreate packs them into that column
 * (packCustomFieldSettingsFormValues) and takes them out of the misc data
 * (removeCustomFieldSettingsFormKeys).
 */
export const buildCustomFieldSettingsModelFormFields: BuildCustomFieldSettingsModelFormFieldsFunction =
  <TBaseModel extends BaseModel>(data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    stepId?: string | undefined;
  }): Array<ModelField<TBaseModel>> => {
    return buildCustomFieldSettingsFormFields(data).map(
      (builtField: Field<JSONObject>): ModelField<TBaseModel> => {
        const formKey: string = Object.keys(builtField.field || {})[0]!;

        const rest: Field<JSONObject> = { ...builtField };
        delete rest.field;

        return {
          ...(rest as unknown as ModelField<TBaseModel>),
          overrideField: {
            [INCIDENT_CUSTOM_FIELD_SETTINGS_COLUMN]: true,
          },
          overrideFieldKey: formKey,
        };
      },
    );
  };
