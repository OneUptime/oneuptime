import FormsCopy from "../FormsCopy";
import {
  FormReferenceData,
  FormReferenceRecord,
  toDropdownOptions,
} from "./FormOnSubmitData";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import {
  FormTargetSettingReferenceModel,
  FormTargetSettings,
  IncidentFormTargetSettings,
  readFormTargetSettings,
  ScheduledMaintenanceFormTargetSettings,
} from "Common/Types/Form/FormTargetSettings";
import FormTargetType from "Common/Types/Form/FormTargetType";
import { JSONObject } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";

/*
 * The On Submit page's "Edit Settings" dialog, without React: its steps,
 * its fields, what it starts from and what it saves. One step per kind of
 * decision - the defaults, what is always attached, who owns it and, for a
 * maintenance event, whether it is published - so no step is a wall of
 * dropdowns (and long forms walk steps; see LongFormStepsGuard).
 *
 * The dialog starts from the stored settings whole: a record they name is
 * never left out because a list did not have it (#10646). The dialog used to
 * keep only the records it found among the project's first 10,000 of a
 * kind, so a monitor past them was dropped from the form the next time the
 * dialog was saved, whatever was changed.
 *
 * What is always attached is picked from the server, searched as it is
 * typed in, however many monitors, labels, policies or status pages the
 * project has (EntityDropdown); a record held is named by its id, and one
 * deleted since reads "Deleted", in muted italics, to keep or take out. The
 * severity and the template are picked from the project's short lists, a
 * held one they do not offer (archived or deleted since) shown and marked.
 * Saving keeps whatever was left, as it was left: the server judges only
 * the records the dialog adds (FormTargetHelpers.validateSettingReferences).
 * Owners are one people picker, people and teams in one list, as everywhere
 * else owners are picked; it keeps the people in ownerUserIds and the teams
 * in ownerTeamIds.
 */

export const FORM_SETTINGS_STEP_DEFAULTS: string = "defaults";
export const FORM_SETTINGS_STEP_ATTACH: string = "attach";
export const FORM_SETTINGS_STEP_OWNERS: string = "owners";
export const FORM_SETTINGS_STEP_PUBLISHING: string = "publishing";

export type GetFormSettingsStepsFunction = (
  targetType: FormTargetType,
) => Array<FormStep<JSONObject>>;

export const getFormSettingsSteps: GetFormSettingsStepsFunction = (
  targetType: FormTargetType,
): Array<FormStep<JSONObject>> => {
  const steps: Array<FormStep<JSONObject>> = [
    { id: FORM_SETTINGS_STEP_DEFAULTS, title: FormsCopy.stepDefaults },
    { id: FORM_SETTINGS_STEP_ATTACH, title: FormsCopy.stepAlwaysAttach },
    { id: FORM_SETTINGS_STEP_OWNERS, title: FormsCopy.stepOwners },
  ];

  if (targetType === FormTargetType.ScheduledMaintenance) {
    steps.push({
      id: FORM_SETTINGS_STEP_PUBLISHING,
      title: FormsCopy.stepPublishing,
    });
  }

  return steps;
};

// The model each always-attached list is picked from, searched on the server.
export const FORM_SETTINGS_PICKED_MODELS: Partial<
  Record<FormTargetSettingReferenceModel, DatabaseBaseModelType>
> = {
  [FormTargetSettingReferenceModel.Monitor]: Monitor,
  [FormTargetSettingReferenceModel.Label]: Label,
  [FormTargetSettingReferenceModel.OnCallDutyPolicy]: OnCallDutyPolicy,
  [FormTargetSettingReferenceModel.StatusPage]: StatusPage,
};

type MultiSelectFunction = (data: {
  key: string;
  title: string;
  description: string;
  stepId: string;
  model: FormTargetSettingReferenceModel;
}) => Field<JSONObject>;

/*
 * A list of records always attached, picked from the server: every record
 * of the kind the reader may see, searched by name as it is typed in, an
 * archived label left out for a new pick (ArchivedValuePicker). The ones
 * the setting holds are read by their ids, so each is named however many
 * the project has; one deleted since reads "Deleted".
 */
const multiSelect: MultiSelectFunction = (data: {
  key: string;
  title: string;
  description: string;
  stepId: string;
  model: FormTargetSettingReferenceModel;
}): Field<JSONObject> => {
  const modelType: DatabaseBaseModelType | undefined =
    FORM_SETTINGS_PICKED_MODELS[data.model];

  if (!modelType) {
    throw new Error(`No picker for ${data.model}.`);
  }

  return {
    field: { [data.key]: true },
    title: data.title,
    description: data.description,
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: modelType,
      labelField: "name",
      valueField: "_id",
      notFoundLabel: FormsCopy.deletedRecord,
    },
    required: false,
    stepId: data.stepId,
  };
};

type ToSingleSelectOptionsFunction = (data: {
  records: Array<FormReferenceRecord> | undefined;
  model: FormTargetSettingReferenceModel;
  heldId: string | undefined;
}) => Array<DropdownOption>;

/*
 * A short list's options - the severities, the templates - and, when the
 * setting holds one the project no longer has, that one too: "Deleted", in
 * muted italics, never offered for a pick, so it can be seen and cleared.
 */
const toSingleSelectOptions: ToSingleSelectOptionsFunction = (data: {
  records: Array<FormReferenceRecord> | undefined;
  model: FormTargetSettingReferenceModel;
  heldId: string | undefined;
}): Array<DropdownOption> => {
  const options: Array<DropdownOption> = toDropdownOptions(
    data.records,
    data.model,
  );
  const heldId: string | undefined = data.heldId?.toLowerCase();

  if (
    heldId &&
    !options.some((option: DropdownOption): boolean => {
      return String(option.value).toLowerCase() === heldId;
    })
  ) {
    options.push({
      value: heldId,
      label: FormsCopy.deletedRecord,
      isUserContent: false,
      isNotFound: true,
      isDisabled: true,
    });
  }

  return options;
};

export type GetFormSettingsFieldsFunction = (data: {
  targetType: FormTargetType;
  reference: FormReferenceData;
  // The stored settings, so a severity or template held is shown.
  settings?: unknown;
}) => Array<Field<JSONObject>>;

/** The dialog's fields, each on its step. */
export const getFormSettingsFields: GetFormSettingsFieldsFunction = (data: {
  targetType: FormTargetType;
  reference: FormReferenceData;
  settings?: unknown;
}): Array<Field<JSONObject>> => {
  const lists: FormReferenceData["lists"] = data.reference.lists;

  const defaultTitle: Field<JSONObject> = {
    field: { defaultTitle: true },
    title: FormsCopy.defaultTitle,
    description: FormsCopy.defaultTitleDescription,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    stepId: FORM_SETTINGS_STEP_DEFAULTS,
  };

  const owners: Array<Field<JSONObject>> = [
    getOwnersFormField<JSONObject>({
      usersKey: "ownerUserIds",
      teamsKey: "ownerTeamIds",
      title: FormsCopy.owners,
      description: FormsCopy.ownersDescription,
      stepId: FORM_SETTINGS_STEP_OWNERS,
    }),
  ];

  if (data.targetType === FormTargetType.ScheduledMaintenance) {
    return [
      defaultTitle,
      multiSelect({
        key: "monitorIds",
        title: FormsCopy.alwaysMonitors,
        description: FormsCopy.alwaysMonitorsDescription,
        stepId: FORM_SETTINGS_STEP_ATTACH,
        model: FormTargetSettingReferenceModel.Monitor,
      }),
      multiSelect({
        key: "statusPageIds",
        title: FormsCopy.alwaysStatusPages,
        description: FormsCopy.alwaysStatusPagesDescription,
        stepId: FORM_SETTINGS_STEP_ATTACH,
        model: FormTargetSettingReferenceModel.StatusPage,
      }),
      multiSelect({
        key: "labelIds",
        title: FormsCopy.alwaysLabels,
        description: FormsCopy.alwaysLabelsDescription,
        stepId: FORM_SETTINGS_STEP_ATTACH,
        model: FormTargetSettingReferenceModel.Label,
      }),
      ...owners,
      {
        field: { showOnStatusPages: true },
        title: FormsCopy.showOnStatusPages,
        description: FormsCopy.showOnStatusPagesDescription,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        stepId: FORM_SETTINGS_STEP_PUBLISHING,
      },
      {
        field: { notifySubscribers: true },
        title: FormsCopy.notifySubscribers,
        description: FormsCopy.notifySubscribersDescription,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        stepId: FORM_SETTINGS_STEP_PUBLISHING,
      },
    ];
  }

  const held: IncidentFormTargetSettings = readFormTargetSettings({
    targetType: FormTargetType.Incident,
    value: data.settings,
  }) as IncidentFormTargetSettings;

  return [
    defaultTitle,
    {
      field: { incidentSeverityId: true },
      title: FormsCopy.defaultSeverity,
      description: FormsCopy.defaultSeverityDescription,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: toSingleSelectOptions({
        records: lists[FormTargetSettingReferenceModel.IncidentSeverity],
        model: FormTargetSettingReferenceModel.IncidentSeverity,
        heldId: held.incidentSeverityId,
      }),
      required: false,
      stepId: FORM_SETTINGS_STEP_DEFAULTS,
    },
    {
      field: { incidentTemplateId: true },
      title: FormsCopy.incidentTemplate,
      description: FormsCopy.incidentTemplateDescription,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: toSingleSelectOptions({
        records: lists[FormTargetSettingReferenceModel.IncidentTemplate],
        model: FormTargetSettingReferenceModel.IncidentTemplate,
        heldId: held.incidentTemplateId,
      }),
      required: false,
      stepId: FORM_SETTINGS_STEP_DEFAULTS,
    },
    multiSelect({
      key: "monitorIds",
      title: FormsCopy.alwaysMonitors,
      description: FormsCopy.alwaysMonitorsDescription,
      stepId: FORM_SETTINGS_STEP_ATTACH,
      model: FormTargetSettingReferenceModel.Monitor,
    }),
    multiSelect({
      key: "labelIds",
      title: FormsCopy.alwaysLabels,
      description: FormsCopy.alwaysLabelsDescription,
      stepId: FORM_SETTINGS_STEP_ATTACH,
      model: FormTargetSettingReferenceModel.Label,
    }),
    multiSelect({
      key: "onCallDutyPolicyIds",
      title: FormsCopy.onCallPolicies,
      description: FormsCopy.onCallPoliciesDescription,
      stepId: FORM_SETTINGS_STEP_ATTACH,
      model: FormTargetSettingReferenceModel.OnCallDutyPolicy,
    }),
    ...owners,
  ];
};

export type GetFormSettingsInitialValuesFunction = (data: {
  targetType: FormTargetType;
  settings: unknown;
  reference?: FormReferenceData | undefined;
}) => JSONObject;

/*
 * What the dialog starts from: the stored settings, every record they name
 * kept - one deleted since too, which its picker shows as "Deleted" to keep
 * or take out.
 */
export const getFormSettingsInitialValues: GetFormSettingsInitialValuesFunction =
  (data: {
    targetType: FormTargetType;
    settings: unknown;
    reference?: FormReferenceData | undefined;
  }): JSONObject => {
    const read: FormTargetSettings = readFormTargetSettings({
      targetType: data.targetType,
      value: data.settings,
    });

    const values: JSONObject = {
      defaultTitle: read.defaultTitle || "",
      monitorIds: read.monitorIds || [],
      labelIds: read.labelIds || [],
      ownerUserIds: read.ownerUserIds || [],
      ownerTeamIds: read.ownerTeamIds || [],
    };

    if (data.targetType === FormTargetType.ScheduledMaintenance) {
      const settings: ScheduledMaintenanceFormTargetSettings =
        read as ScheduledMaintenanceFormTargetSettings;

      values["statusPageIds"] = settings.statusPageIds || [];
      values["showOnStatusPages"] = settings.showOnStatusPages === true;
      values["notifySubscribers"] = settings.notifySubscribers === true;

      return values;
    }

    const settings: IncidentFormTargetSettings =
      read as IncidentFormTargetSettings;

    if (settings.incidentSeverityId) {
      values["incidentSeverityId"] = settings.incidentSeverityId;
    }

    if (settings.incidentTemplateId) {
      values["incidentTemplateId"] = settings.incidentTemplateId;
    }

    values["onCallDutyPolicyIds"] = settings.onCallDutyPolicyIds || [];

    return values;
  };

type ReadChoiceFunction = (value: unknown) => string | undefined;

// A dropdown can hold the option it was picked as ({label, value}) or its value.
const readChoice: ReadChoiceFunction = (value: unknown): string | undefined => {
  const picked: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["value"]
      : value;

  return typeof picked === "string" && picked.trim()
    ? picked.trim().toLowerCase()
    : undefined;
};

type ReadChoicesFunction = (value: unknown) => Array<string>;

const readChoices: ReadChoicesFunction = (value: unknown): Array<string> => {
  const entries: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const entry of entries) {
    const id: string | undefined = readChoice(entry);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

export type PackFormSettingsValuesFunction = (data: {
  targetType: FormTargetType;
  values: JSONObject;
}) => JSONObject;

/**
 * The settings the dialog saves: only this target's, with empty text and
 * empty lists left out - the shape readFormTargetSettings reads back.
 */
export const packFormSettingsValues: PackFormSettingsValuesFunction = (data: {
  targetType: FormTargetType;
  values: JSONObject;
}): JSONObject => {
  const settings: JSONObject = {};
  const values: JSONObject = data.values || {};

  const defaultTitle: unknown = values["defaultTitle"];

  if (typeof defaultTitle === "string" && defaultTitle.trim()) {
    settings["defaultTitle"] = defaultTitle.trim();
  }

  const listKeys: Array<string> =
    data.targetType === FormTargetType.ScheduledMaintenance
      ? [
          "monitorIds",
          "statusPageIds",
          "labelIds",
          "ownerUserIds",
          "ownerTeamIds",
        ]
      : [
          "monitorIds",
          "labelIds",
          "onCallDutyPolicyIds",
          "ownerUserIds",
          "ownerTeamIds",
        ];

  for (const key of listKeys) {
    const ids: Array<string> = readChoices(values[key]);

    if (ids.length > 0) {
      settings[key] = ids;
    }
  }

  if (data.targetType === FormTargetType.ScheduledMaintenance) {
    for (const key of ["showOnStatusPages", "notifySubscribers"]) {
      if (values[key] === true || values[key] === "true") {
        settings[key] = true;
      }
    }

    return settings;
  }

  for (const key of ["incidentSeverityId", "incidentTemplateId"]) {
    const id: string | undefined = readChoice(values[key]);

    if (id) {
      settings[key] = id;
    }
  }

  return settings;
};
