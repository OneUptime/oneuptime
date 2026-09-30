import IncidentFormCopy from "./IncidentFormCopy";
import IncidentForm from "Common/Models/DatabaseModels/IncidentForm";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import {
  DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING,
  INCIDENT_FORM_FIELD_SETTINGS,
  IncidentFormFieldSetting,
  isIncidentFormFieldSetting,
} from "Common/Types/Incident/IncidentFormPublic";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * The inputs of an incident form that both the create wizard (Incidents >
 * Settings > Forms) and the cards on a form's own page edit, built in one
 * place so the two cannot drift apart. The one that matters most is the
 * severity: IncidentFormService refuses a form without one, and ModelForm
 * never reads a column's own "required", so the field has to say it.
 */

export const INCIDENT_FORM_DETAILS_STEP_ID: string = "form-details";
export const INCIDENT_FORM_INCIDENT_SETTINGS_STEP_ID: string =
  "incident-settings";

export type GetIncidentFormFieldFunction = (
  stepId?: string | undefined,
) => ModelField<IncidentForm>;

export const getIncidentFormNameField: GetIncidentFormFieldFunction = (
  stepId?: string | undefined,
): ModelField<IncidentForm> => {
  return {
    field: {
      name: true,
    },
    title: "Name",
    description: IncidentFormCopy.nameDescription,
    fieldType: FormFieldSchemaType.Text,
    stepId: stepId,
    required: true,
    placeholder: IncidentFormCopy.namePlaceholder,
    validation: {
      minLength: 2,
    },
  };
};

/*
 * The form's description and its success message are shown on the public
 * page, to people who are not signed in. An image uploaded through the
 * editor is private - served only to a signed-in visitor (see
 * Markdown.tsx/SessionAwareImage) - so every reporter would see it broken.
 * Their editors offer no upload; an image already on the web can still be
 * linked in Markdown.
 */
export const getIncidentFormDescriptionField: GetIncidentFormFieldFunction = (
  stepId?: string | undefined,
): ModelField<IncidentForm> => {
  return {
    field: {
      description: true,
    },
    title: "Description",
    description: IncidentFormCopy.descriptionDescription,
    fieldType: FormFieldSchemaType.Markdown,
    stepId: stepId,
    required: false,
    allowImageUpload: false,
  };
};

export const getIncidentFormSeverityField: GetIncidentFormFieldFunction = (
  stepId?: string | undefined,
): ModelField<IncidentForm> => {
  return {
    field: {
      incidentSeverity: true,
    },
    title: "Severity",
    description: IncidentFormCopy.severityDescription,
    fieldType: FormFieldSchemaType.Dropdown,
    stepId: stepId,
    dropdownModal: {
      type: IncidentSeverity,
      labelField: "name",
      valueField: "_id",
    },
    required: true,
    placeholder: "Select Severity",
  };
};

/*
 * Optional. Its description is a warning more than a hint: with a template,
 * a stranger's report can page people, attach monitors (which then stop
 * being checked until the incident is resolved) and change what status
 * pages say about them.
 */
export const getIncidentFormTemplateField: GetIncidentFormFieldFunction = (
  stepId?: string | undefined,
): ModelField<IncidentForm> => {
  return {
    field: {
      incidentTemplate: true,
    },
    title: "Incident Template",
    description: IncidentFormCopy.templateDescription,
    fieldType: FormFieldSchemaType.Dropdown,
    stepId: stepId,
    dropdownModal: {
      type: IncidentTemplate,
      labelField: "templateName",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select Incident Template",
  };
};

export const getIncidentFormSuccessMessageField: GetIncidentFormFieldFunction =
  (stepId?: string | undefined): ModelField<IncidentForm> => {
    return {
      field: {
        successMessage: true,
      },
      title: IncidentFormCopy.successMessageTitle,
      description: IncidentFormCopy.successMessageDescription,
      fieldType: FormFieldSchemaType.Markdown,
      stepId: stepId,
      required: false,
      allowImageUpload: false,
    };
  };

/*
 * The description question's settings, by the words the dashboard already
 * uses for them. The Dropdown and the page translate them on the way out.
 */
export const INCIDENT_FORM_DESCRIPTION_SETTING_LABELS: Record<
  IncidentFormFieldSetting,
  string
> = {
  [IncidentFormFieldSetting.Required]: "Required",
  [IncidentFormFieldSetting.Optional]: "Optional",
  [IncidentFormFieldSetting.Hidden]: "Hidden",
};

export const INCIDENT_FORM_DESCRIPTION_SETTING_OPTIONS: Array<DropdownOption> =
  INCIDENT_FORM_FIELD_SETTINGS.map(
    (setting: IncidentFormFieldSetting): DropdownOption => {
      return {
        label: INCIDENT_FORM_DESCRIPTION_SETTING_LABELS[setting],
        value: setting,
      };
    },
  );

/*
 * What a stored description setting reads as. The column is NOT NULL with a
 * default, and the service refuses anything else, so a missing or unknown
 * value can only come from a partial read: it is shown as the default the
 * server would apply.
 */
export const getIncidentFormDescriptionSettingLabel: (
  value: unknown,
) => string = (value: unknown): string => {
  const setting: IncidentFormFieldSetting = isIncidentFormFieldSetting(value)
    ? value
    : DEFAULT_INCIDENT_FORM_DESCRIPTION_SETTING;

  return INCIDENT_FORM_DESCRIPTION_SETTING_LABELS[setting];
};
