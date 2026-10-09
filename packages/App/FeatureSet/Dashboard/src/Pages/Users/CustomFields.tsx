import PageComponentProps from "../PageComponentProps";
import {
  getCustomFieldDefinitionColumns,
  getCustomFieldDefinitionFilters,
} from "../../Components/CustomFields/CustomFieldDefinitionTable";
import {
  CustomFieldFormCopy,
  CustomFieldTypeOption,
  getCustomFieldTypeOptions,
} from "../../Components/CustomFields/CustomFieldSettingsCopy";
import {
  CustomFieldOptionsFormField,
  getCustomFieldOptionsFormField,
  useCustomFieldOptionsFormField,
} from "../../Components/CustomFields/CustomFieldOptionsField";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const TeamMemberCustomFields: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  /*
   * A dropdown's options, editable after the field has values, as on every
   * other custom field settings page (#4564).
   */
  const optionsField: CustomFieldOptionsFormField<TeamMemberCustomField> =
    useCustomFieldOptionsFormField<TeamMemberCustomField>({
      modelType: TeamMemberCustomField,
    });

  return (
    <Fragment>
      <ModelTable<TeamMemberCustomField>
        modelType={TeamMemberCustomField}
        userPreferencesKey="team-member-custom-fields-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        id="team-member-custom-fields-table"
        name="Settings > Team Member Custom Fields"
        saveFilterProps={{
          tableId: "settings-team-member-custom-fields-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        onBeforeEdit={optionsField.onBeforeEdit}
        onBeforeUpdate={optionsField.onBeforeUpdate}
        cardProps={{
          title: "Team Member Custom Fields",
          description:
            "Custom fields help you collect additional information about team members in your project.",
        }}
        noItemsMessage={"No custom fields found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        /*
         * One page, as on every other custom field settings page: the name,
         * the description and the type - and a dropdown's options, under a
         * dropdown type. Tests/UI/Components/Forms/LongFormStepsGuard lists
         * the form, with why it is not stepped.
         */
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Field Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Department",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: "Field Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "The department or team this user belongs to (e.g., Engineering, Sales, Support)",
          },
          {
            field: {
              customFieldType: true,
            },
            title: "Field Type",
            description: CustomFieldFormCopy.fieldTypeDescription,
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Please select field type.",
            /*
             * The same labels as every other custom field settings page,
             * Long text and Rich text (Markdown) included.
             */
            dropdownOptions: getCustomFieldTypeOptions().map(
              (option: CustomFieldTypeOption) => {
                return {
                  label: option.label,
                  value: option.value,
                };
              },
            ),
          },
          getCustomFieldOptionsFormField(optionsField.formFieldInput),
        ]}
        showRefreshButton={true}
        // The same two columns as every other custom field settings table.
        filters={getCustomFieldDefinitionFilters()}
        columns={getCustomFieldDefinitionColumns()}
      />
    </Fragment>
  );
};

export default TeamMemberCustomFields;
