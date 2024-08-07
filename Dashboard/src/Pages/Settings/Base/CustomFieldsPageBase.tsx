import DashboardNavigation from "../../../Utils/Navigation";
import PageComponentProps from "../../PageComponentProps";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "CommonUI/src/Components/ModelTable/ModelTable";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import Navigation from "CommonUI/src/Utils/Navigation";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import React, { Fragment, ReactElement } from "react";

export type CustomFieldsBaseModels =
  | MonitorCustomField
  | StatusPageCustomField
  | IncidentCustomField
  | ScheduledMaintenanceCustomField
  | OnCallDutyPolicyCustomField;

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
        query={{
          projectId: DashboardNavigation.getProjectId()!,
        }}
        showViewIdButton={true}
        id="custom-fields-table"
        name={"Settings > " + props.title}
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
            required: true,
            placeholder: "This label is for all the internal services.",
          },
          {
            field: {
              type: true,
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
              type: true,
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
            title: "Field Description",
            type: FieldType.Text,
          },
          {
            field: {
              type: true,
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
