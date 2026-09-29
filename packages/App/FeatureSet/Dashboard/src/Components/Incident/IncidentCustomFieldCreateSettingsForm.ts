import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  compactCustomFieldCreateSettings,
  CustomFieldCreateSetting,
  CustomFieldCreateSettings,
  EffectiveCustomFieldCreateSetting,
  getCustomFieldCreateSetting,
  getEffectiveCustomFieldCreateSetting,
  getIncidentFormCustomFieldSetting,
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
 * CustomFieldCreateSettings): one dropdown per field, in the fields' order.
 * Two places use them, each in its own mode:
 *
 *   - "template": an incident template's Custom Fields on Create card and
 *     the wizard step of the same name. The choices are Default - which
 *     follows the field's own Show on Create and Required on Create, and says
 *     which - Required, Optional and Hidden;
 *   - "form": an incident form's Questions card. A public form asks only the
 *     fields it names, so the choices are Not Asked (stored as nothing at
 *     all), Optional and Required.
 *
 * The values are the settings themselves ("Required", "Hidden", ...); only
 * the labels differ between the modes. Each input is held under its own form
 * key, "customFieldSettings:<variableKey>": never the bare key, which a field
 * named "Title" or "Constructor" would share with something else in the form.
 */

export type IncidentCustomFieldSettingsMode = "template" | "form";

export const INCIDENT_CUSTOM_FIELD_SETTING_FORM_KEY_PREFIX: string =
  "customFieldSettings:";

// The column a template's and a form's settings are stored in.
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

export type GetCustomFieldSettingOptionsFunction = (
  definition: IncidentCustomFieldDefinition,
  mode: IncidentCustomFieldSettingsMode,
) => Array<DropdownOption>;

/**
 * A field's choices, in the order they are listed. The first is the one a
 * field has when nothing is stored for it: Default on a template, Not Asked
 * on a form.
 */
export const getCustomFieldSettingOptions: GetCustomFieldSettingOptionsFunction =
  (
    definition: IncidentCustomFieldDefinition,
    mode: IncidentCustomFieldSettingsMode,
  ): Array<DropdownOption> => {
    if (mode === "form") {
      return [
        {
          value: CustomFieldCreateSetting.Hidden,
          label: IncidentCustomFieldCreateSettingsCopy.formNotAsked,
        },
        {
          value: CustomFieldCreateSetting.Optional,
          label: IncidentCustomFieldCreateSettingsCopy.optional,
        },
        {
          value: CustomFieldCreateSetting.Required,
          label: IncidentCustomFieldCreateSettingsCopy.required,
        },
      ];
    }

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

export type GetUnsetCustomFieldSettingFunction = (
  mode: IncidentCustomFieldSettingsMode,
) => CustomFieldCreateSetting;

// The setting of a field nothing is stored for.
export const getUnsetCustomFieldSetting: GetUnsetCustomFieldSettingFunction = (
  mode: IncidentCustomFieldSettingsMode,
): CustomFieldCreateSetting => {
  return mode === "form"
    ? CustomFieldCreateSetting.Hidden
    : CustomFieldCreateSetting.Default;
};

export type GetCustomFieldSettingValueFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
  mode: IncidentCustomFieldSettingsMode,
) => CustomFieldCreateSetting;

/**
 * A field's setting, as its dropdown holds it. A form reads the settings the
 * way the public form does, so a stored Default - which a form does not offer
 * - shows as the Not Asked it means there.
 */
export const getCustomFieldSettingValue: GetCustomFieldSettingValueFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
  mode: IncidentCustomFieldSettingsMode,
): CustomFieldCreateSetting => {
  if (mode === "form") {
    return getIncidentFormCustomFieldSetting(settings, definition.variableKey);
  }

  return getCustomFieldCreateSetting(settings, definition.variableKey);
};

export type GetCustomFieldSettingLabelFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
  mode: IncidentCustomFieldSettingsMode,
) => string;

// A field's setting in words: the label of the option it has.
export const getCustomFieldSettingLabel: GetCustomFieldSettingLabelFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
  mode: IncidentCustomFieldSettingsMode,
): string => {
  const value: CustomFieldCreateSetting = getCustomFieldSettingValue(
    definition,
    settings,
    mode,
  );

  const options: Array<DropdownOption> = getCustomFieldSettingOptions(
    definition,
    mode,
  );

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
  mode: IncidentCustomFieldSettingsMode,
) => boolean;

/**
 * Whether the settings say something of their own about the field: a
 * template that overrides it, a form that asks it. The card sets those apart
 * from the fields left as they are.
 */
export const isCustomFieldSettingChosen: IsCustomFieldSettingChosenFunction = (
  definition: IncidentCustomFieldDefinition,
  settings: unknown,
  mode: IncidentCustomFieldSettingsMode,
): boolean => {
  return (
    getCustomFieldSettingValue(definition, settings, mode) !==
    getUnsetCustomFieldSetting(mode)
  );
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
  mode: IncidentCustomFieldSettingsMode;
}) => JSONObject;

/**
 * The form's starting values: every field's setting, under its form key -
 * Default or Not Asked included, so each dropdown shows a choice.
 */
export const getCustomFieldSettingsFormInitialValues: GetCustomFieldSettingsFormInitialValuesFunction =
  (data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    settings: unknown;
    mode: IncidentCustomFieldSettingsMode;
  }): JSONObject => {
    const initialValues: JSONObject = {};

    for (const definition of getKeyedCustomFieldDefinitions(data.definitions)) {
      initialValues[getCustomFieldSettingFormKey(definition.variableKey)] =
        getCustomFieldSettingValue(definition, data.settings, data.mode);
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
   * docs promise). A form keeps only the fields it asked about: see below.
   */
  startingSettings?: unknown;
  mode: IncidentCustomFieldSettingsMode;
}) => CustomFieldCreateSettings;

/**
 * The settings to save: the stored ones, with each field the form asked
 * about set to its dropdown's choice, then compacted - Default says nothing
 * and is left out, and so, on a form, is Not Asked (Hidden). A dropdown
 * somebody cleared means the same as those. Invalid stored entries are
 * dropped too, so what is saved is always a value the server accepts.
 *
 * A form's settings are its questions on a page anyone with the link can
 * open, and a field is not asked until an admin adds it there. So a form
 * keeps the stored setting of the fields it lists and of no other: the
 * question for a field deleted since would otherwise stay, and put any new
 * field that gets the same key - one made again with the same name, or any
 * field whose name has no Latin letters ("field") - on the public page the
 * moment it is created, name, description, options and all.
 */
export const packCustomFieldSettingsFormValues: PackCustomFieldSettingsFormValuesFunction =
  (data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    formValues: JSONObject | null | undefined;
    startingSettings?: unknown;
    mode: IncidentCustomFieldSettingsMode;
  }): CustomFieldCreateSettings => {
    const formValues: JSONObject = data.formValues || {};

    const definitions: Array<KeyedIncidentCustomFieldDefinition> =
      getKeyedCustomFieldDefinitions(data.definitions);

    const storedSettings: CustomFieldCreateSettings =
      readCustomFieldCreateSettings(data.startingSettings);

    let settings: CustomFieldCreateSettings = storedSettings;

    if (data.mode === "form") {
      settings = {};

      for (const definition of definitions) {
        const stored: CustomFieldCreateSetting = getCustomFieldCreateSetting(
          storedSettings,
          definition.variableKey,
        );

        if (stored !== CustomFieldCreateSetting.Default) {
          settings[definition.variableKey] = stored;
        }
      }
    }

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

    return compactCustomFieldCreateSettings(settings, {
      dropHidden: data.mode === "form",
    });
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
  mode: IncidentCustomFieldSettingsMode;
  stepId?: string | undefined;
}) => Array<Field<JSONObject>>;

/**
 * One dropdown per field that can have a setting, in the order given, titled
 * with the field's name and described with its type. Never required: a
 * dropdown left empty means Default (or Not Asked), which is also why the
 * "(Optional)" mark is left off - next to a choice that includes "Optional"
 * it would only confuse.
 */
export const buildCustomFieldSettingsFormFields: BuildCustomFieldSettingsFormFieldsFunction =
  (data: {
    definitions: Array<IncidentCustomFieldDefinition>;
    mode: IncidentCustomFieldSettingsMode;
    stepId?: string | undefined;
  }): Array<Field<JSONObject>> => {
    return getKeyedCustomFieldDefinitions(data.definitions).map(
      (definition: KeyedIncidentCustomFieldDefinition): Field<JSONObject> => {
        const options: Array<DropdownOption> = getCustomFieldSettingOptions(
          definition,
          data.mode,
        );

        const field: Field<JSONObject> = {
          field: {
            [getCustomFieldSettingFormKey(definition.variableKey)]: true,
          },
          title: definition.name,
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: options,
          // A cleared dropdown reads as what it means.
          placeholder: options[0]!.label,
          defaultValue: getUnsetCustomFieldSetting(data.mode),
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
  mode: IncidentCustomFieldSettingsMode;
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
    mode: IncidentCustomFieldSettingsMode;
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
