import {
  getSecurityCaseAssigneePickerConfig,
  getSecurityCaseTeamPickerConfig,
} from "./SecurityCaseAssigneePicker";
import Label from "Common/Models/DatabaseModels/Label";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import type { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";

/*
 * A case's form: what the case is about, then who works it. Open Security
 * Case on the case lists and Edit Case on a case's own page are this one
 * form, so the two say the same of each field, in the reader's language.
 *
 * Every field says what it is for in words of its own. Without them the
 * form drew its column's description, written for the API reference and
 * in English on every page (ColumnDescriptionOnForm): "ID of the person
 * working the case." under Assign To and "ID of the team whose queue the
 * case is in." under Team on Edit Case. A field that may be left empty
 * says so beside its name, "(Optional)", so no description opens with
 * "Optional." of its own (SecurityFormsNoOptionalLead).
 *
 * Opening a case also asks how urgent it is; on its own page the priority
 * is set from the header's ⋯ (Set priority), so Edit Case leaves it out.
 *
 * React-free, so App's tests read the words it asks in.
 */
export const SECURITY_CASE_FORM_STEPS: Array<FormStep<SecurityCase>> = [
  { title: "Case", id: "case" },
  { title: "Assignment", id: "assignment" },
];

export function getSecurityCaseFormFields(
  data: {
    // Opening a case: the project's priorities, to pick how urgent it is.
    priorityOptions?: Array<DropdownOption> | undefined;
  } = {},
): Array<ModelField<SecurityCase>> {
  const priorityFields: Array<ModelField<SecurityCase>> = data.priorityOptions
    ? [
        {
          field: { securityCasePriorityId: true },
          stepId: "case",
          title: "Priority",
          description: "How urgent the case is.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownOptions: data.priorityOptions,
        },
      ]
    : [];

  return [
    {
      field: { title: true },
      stepId: "case",
      title: "Title",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      description: "What the case is about, in a line.",
      placeholder: "e.g. Suspicious sign-ins for alice@example.com",
    },
    {
      field: { description: true },
      stepId: "case",
      title: "Description",
      fieldType: FormFieldSchemaType.Markdown,
      required: false,
      description: "What prompted this case, and what to look at first.",
    },
    ...priorityFields,
    {
      field: { assignedToUserId: true },
      stepId: "assignment",
      title: "Assign To",
      fieldType: FormFieldSchemaType.PeoplePicker,
      required: false,
      description: "The person working the case.",
      peoplePicker: getSecurityCaseAssigneePickerConfig(),
    },
    {
      field: { assignedToTeamId: true },
      stepId: "assignment",
      title: "Team",
      fieldType: FormFieldSchemaType.PeoplePicker,
      required: false,
      description: "The team the case belongs to.",
      peoplePicker: getSecurityCaseTeamPickerConfig(),
    },
    {
      field: { labels: true },
      stepId: "assignment",
      title: "Labels",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      required: false,
      description: "Labels to filter and report on cases by.",
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
    },
  ];
}
