import PageComponentProps from "../PageComponentProps";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const isDropdownType: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    value === CustomFieldType.Dropdown ||
    value === CustomFieldType.MultiSelectDropdown
  );
};

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
        saveFilterProps={{
          tableId: "settings-team-member-custom-fields-table",
        }}
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
          {
            field: {
              dropdownOptions: true,
            },
            title: "Dropdown Options",
            description:
              "Add the options that should appear in the dropdown and optionally choose a color for each value.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: (item: FormValues<TeamMemberCustomField>) => {
              return isDropdownType(item.customFieldType);
            },
            showIf: (item: FormValues<TeamMemberCustomField>) => {
              return isDropdownType(item.customFieldType);
            },
            getCustomElement: (
              _values: FormValues<TeamMemberCustomField>,
              customElementProps: CustomElementProps,
            ) => {
              return (
                <DropdownOptionsInput
                  initialValue={
                    typeof customElementProps.initialValue === "string"
                      ? customElementProps.initialValue
                      : ""
                  }
                  error={customElementProps.error}
                  onChange={(value: string) => {
                    customElementProps.onChange?.(value);
                  }}
                  onBlur={() => {
                    customElementProps.onBlur?.();
                  }}
                />
              );
            },
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
