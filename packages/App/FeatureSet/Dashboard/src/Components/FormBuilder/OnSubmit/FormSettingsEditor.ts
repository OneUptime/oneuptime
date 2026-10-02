import FormsCopy from "../FormsCopy";
import { FormReferenceData, toDropdownOptions } from "./FormOnSubmitData";
import { FormRecordOption } from "Common/Types/Form/FormPublic";
import {
  FormTargetSettingReferenceModel,
  FormTargetSettings,
  IncidentFormTargetSettings,
  readFormTargetSettings,
  ScheduledMaintenanceFormTargetSettings,
} from "Common/Types/Form/FormTargetSettings";
import FormTargetType from "Common/Types/Form/FormTargetType";
import { JSONObject } from "Common/Types/JSON";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";

/*
 * The On Submit page's "Edit Settings" dialog, without React: its steps,
 * its fields, what it starts from and what it saves. One step per kind of
 * decision - the defaults, what is always attached, who owns it and, for a
 * maintenance event, whether it is published - so no step is a wall of
 * dropdowns (and long forms walk steps; see LongFormStepsGuard).
 *
 * The dropdowns offer the project's records as they are now. A record a
 * setting names but that was deleted since is not among them, so the dialog
 * starts without it and saving leaves it out.
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

type MultiSelectFunction = (data: {
  key: string;
  title: string;
  description: string;
  stepId: string;
  records: Array<FormRecordOption> | undefined;
}) => Field<JSONObject>;

const multiSelect: MultiSelectFunction = (data: {
  key: string;
  title: string;
  description: string;
  stepId: string;
  records: Array<FormRecordOption> | undefined;
}): Field<JSONObject> => {
  return {
    field: { [data.key]: true },
    title: data.title,
    description: data.description,
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownOptions: toDropdownOptions(data.records),
    required: false,
    stepId: data.stepId,
  };
};

export type GetFormSettingsFieldsFunction = (data: {
  targetType: FormTargetType;
  reference: FormReferenceData;
}) => Array<Field<JSONObject>>;

/** The dialog's fields, each on its step. */
export const getFormSettingsFields: GetFormSettingsFieldsFunction = (data: {
  targetType: FormTargetType;
  reference: FormReferenceData;
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
    multiSelect({
      key: "ownerUserIds",
      title: FormsCopy.ownerUsers,
      description: FormsCopy.ownerUsersDescription,
      stepId: FORM_SETTINGS_STEP_OWNERS,
      records: lists[FormTargetSettingReferenceModel.User],
    }),
    multiSelect({
      key: "ownerTeamIds",
      title: FormsCopy.ownerTeams,
      description: FormsCopy.ownerTeamsDescription,
      stepId: FORM_SETTINGS_STEP_OWNERS,
      records: lists[FormTargetSettingReferenceModel.Team],
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
        records: lists[FormTargetSettingReferenceModel.Monitor],
      }),
      multiSelect({
        key: "statusPageIds",
        title: FormsCopy.alwaysStatusPages,
        description: FormsCopy.alwaysStatusPagesDescription,
        stepId: FORM_SETTINGS_STEP_ATTACH,
        records: lists[FormTargetSettingReferenceModel.StatusPage],
      }),
      multiSelect({
        key: "labelIds",
        title: FormsCopy.alwaysLabels,
        description: FormsCopy.alwaysLabelsDescription,
        stepId: FORM_SETTINGS_STEP_ATTACH,
        records: lists[FormTargetSettingReferenceModel.Label],
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

  return [
    defaultTitle,
    {
      field: { incidentSeverityId: true },
      title: FormsCopy.defaultSeverity,
      description: FormsCopy.defaultSeverityDescription,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: toDropdownOptions(
        lists[FormTargetSettingReferenceModel.IncidentSeverity],
      ),
      required: false,
      stepId: FORM_SETTINGS_STEP_DEFAULTS,
    },
    {
      field: { incidentTemplateId: true },
      title: FormsCopy.incidentTemplate,
      description: FormsCopy.incidentTemplateDescription,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: toDropdownOptions(
        lists[FormTargetSettingReferenceModel.IncidentTemplate],
      ),
      required: false,
      stepId: FORM_SETTINGS_STEP_DEFAULTS,
    },
    multiSelect({
      key: "monitorIds",
      title: FormsCopy.alwaysMonitors,
      description: FormsCopy.alwaysMonitorsDescription,
      stepId: FORM_SETTINGS_STEP_ATTACH,
      records: lists[FormTargetSettingReferenceModel.Monitor],
    }),
    multiSelect({
      key: "labelIds",
      title: FormsCopy.alwaysLabels,
      description: FormsCopy.alwaysLabelsDescription,
      stepId: FORM_SETTINGS_STEP_ATTACH,
      records: lists[FormTargetSettingReferenceModel.Label],
    }),
    multiSelect({
      key: "onCallDutyPolicyIds",
      title: FormsCopy.onCallPolicies,
      description: FormsCopy.onCallPoliciesDescription,
      stepId: FORM_SETTINGS_STEP_ATTACH,
      records: lists[FormTargetSettingReferenceModel.OnCallDutyPolicy],
    }),
    ...owners,
  ];
};

type KeepKnownFunction = (
  ids: Array<string> | undefined,
  records: Array<FormRecordOption> | undefined,
) => Array<string>;

// The ids that still name a record the dialog can offer.
const keepKnown: KeepKnownFunction = (
  ids: Array<string> | undefined,
  records: Array<FormRecordOption> | undefined,
): Array<string> => {
  const known: Set<string> = new Set<string>(
    (records || []).map((record: FormRecordOption): string => {
      return record.id;
    }),
  );

  return (ids || []).filter((id: string): boolean => {
    return known.has(id.toLowerCase());
  });
};

export type GetFormSettingsInitialValuesFunction = (data: {
  targetType: FormTargetType;
  settings: unknown;
  reference: FormReferenceData;
}) => JSONObject;

/** What the dialog starts from: the stored settings, deleted records left out. */
export const getFormSettingsInitialValues: GetFormSettingsInitialValuesFunction =
  (data: {
    targetType: FormTargetType;
    settings: unknown;
    reference: FormReferenceData;
  }): JSONObject => {
    const lists: FormReferenceData["lists"] = data.reference.lists;
    const read: FormTargetSettings = readFormTargetSettings({
      targetType: data.targetType,
      value: data.settings,
    });

    const values: JSONObject = {
      defaultTitle: read.defaultTitle || "",
      monitorIds: keepKnown(
        read.monitorIds,
        lists[FormTargetSettingReferenceModel.Monitor],
      ),
      labelIds: keepKnown(
        read.labelIds,
        lists[FormTargetSettingReferenceModel.Label],
      ),
      ownerUserIds: keepKnown(
        read.ownerUserIds,
        lists[FormTargetSettingReferenceModel.User],
      ),
      ownerTeamIds: keepKnown(
        read.ownerTeamIds,
        lists[FormTargetSettingReferenceModel.Team],
      ),
    };

    if (data.targetType === FormTargetType.ScheduledMaintenance) {
      const settings: ScheduledMaintenanceFormTargetSettings =
        read as ScheduledMaintenanceFormTargetSettings;

      values["statusPageIds"] = keepKnown(
        settings.statusPageIds,
        lists[FormTargetSettingReferenceModel.StatusPage],
      );
      values["showOnStatusPages"] = settings.showOnStatusPages === true;
      values["notifySubscribers"] = settings.notifySubscribers === true;

      return values;
    }

    const settings: IncidentFormTargetSettings =
      read as IncidentFormTargetSettings;

    const severity: Array<string> = keepKnown(
      settings.incidentSeverityId ? [settings.incidentSeverityId] : [],
      lists[FormTargetSettingReferenceModel.IncidentSeverity],
    );

    const template: Array<string> = keepKnown(
      settings.incidentTemplateId ? [settings.incidentTemplateId] : [],
      lists[FormTargetSettingReferenceModel.IncidentTemplate],
    );

    if (severity[0]) {
      values["incidentSeverityId"] = severity[0];
    }

    if (template[0]) {
      values["incidentTemplateId"] = template[0];
    }

    values["onCallDutyPolicyIds"] = keepKnown(
      settings.onCallDutyPolicyIds,
      lists[FormTargetSettingReferenceModel.OnCallDutyPolicy],
    );

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
      ? ["monitorIds", "statusPageIds", "labelIds", "ownerUserIds", "ownerTeamIds"]
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
