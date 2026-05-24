import PageComponentProps from "../../PageComponentProps";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import TeamMemberCustomField from "Common/Models/DatabaseModels/TeamMemberCustomField";
import React, { Fragment, ReactElement } from "react";
import ProjectUtil from "Common/UI/Utils/Project";

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  [CustomFieldType.Text]: "Text",
  [CustomFieldType.Number]: "Number",
  [CustomFieldType.Boolean]: "Boolean",
  [CustomFieldType.Dropdown]: "Dropdown (single select)",
  [CustomFieldType.MultiSelectDropdown]: "Dropdown (multi-select)",
};

const isDropdownType: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    value === CustomFieldType.Dropdown ||
    value === CustomFieldType.MultiSelectDropdown
  );
};

export type CustomFieldsBaseModels =
  | MonitorCustomField
  | StatusPageCustomField
  | IncidentCustomField
  | ScheduledMaintenanceCustomField
  | OnCallDutyPolicyCustomField
  | TeamMemberCustomField;

export interface ComponentProps<CustomFieldsBaseModels>
  extends PageComponentProps {
  title: string;
  modelType: { new (): CustomFieldsBaseModels };
}

const CustomFieldsPageBase: (
  props: ComponentProps<CustomFieldsBaseModels>,
) => ReactElement = (
  props: ComponentProps<CustomFieldsBaseModels>,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<CustomFieldsBaseModels>
        modelType={props.modelType}
        userPreferencesKey="custom-fields-table"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        id="custom-fields-table"
        name={"Settings > " + props.title}
        saveFilterProps={{
          tableId: "settings-custom-fields-" + props.modelType.name + "-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: props.title,
          description:
            "Custom fields help you add new fields to your resources in OneUptime.",
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
            placeholder: "internal-service",
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
            placeholder: "This label is for all the internal services.",
          },
          {
            field: {
              customFieldType: true,
            },
            title: "Field Type",
            description:
              "Choose how data is entered for this field. Dropdown types also need a list of options below.",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Please select field type.",
            dropdownOptions: (
              Object.keys(CustomFieldType) as Array<CustomFieldType>
            ).map((item: CustomFieldType) => {
              return {
                label: FIELD_TYPE_LABELS[item] || item,
                value: item,
              };
            }),
          },
          {
            field: {
              dropdownOptions: true,
            },
            title: "Dropdown Options",
            description:
              "Add the options that should appear in the dropdown when this field is edited.",
            fieldType: FormFieldSchemaType.CustomComponent,
            required: (item: FormValues<CustomFieldsBaseModels>) => {
              return isDropdownType((item as any).customFieldType);
            },
            showIf: (item: FormValues<CustomFieldsBaseModels>) => {
              return isDropdownType((item as any).customFieldType);
            },
            getCustomElement: (
              _values: FormValues<CustomFieldsBaseModels>,
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
                    if (customElementProps.onChange) {
                      customElementProps.onChange(value);
                    }
                  }}
                  onBlur={() => {
                    if (customElementProps.onBlur) {
                      customElementProps.onBlur();
                    }
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

export default CustomFieldsPageBase;
