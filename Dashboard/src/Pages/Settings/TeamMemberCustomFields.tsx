import PageComponentProps from "../PageComponentProps";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const TeamMemberCustomFields: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
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
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Team Member Custom Fields",
          description:
            "Custom fields help you collect additional information about team members in your project.",
        }}
        noItemsMessage={"No custom fields found."}
        viewPageRoute={Navigation.getCurrentRoute()}
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
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Please select field type.",
            dropdownOptions: Object.keys(CustomFieldType).map(
              (item: string) => {
                return {
                  label: item,
                  value: item,
                };
              },
            ),
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Field Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            title: "Field Description",
            type: FieldType.Text,
          },
          {
            field: {
              customFieldType: true,
            },
            title: "Field Type",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Field Name",
            type: FieldType.Text,
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: "Field Description",
            type: FieldType.Text,
          },
          {
            field: {
              customFieldType: true,
            },
            title: "Field Type",
            type: FieldType.Text,
          },
        ]}
      />
    </Fragment>
  );
};

export default TeamMemberCustomFields;
