import PageComponentProps from "../../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

const ScheduledMaintenanceMoreSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="Scheduled Maintenance Number Prefix"
        cardProps={{
          title: "Number Prefix",
          description:
            "Configure a custom prefix for scheduled maintenance numbers. For example, set 'SM-' to display numbers as 'SM-42' instead of '#42'. Leave empty to use the default '#' prefix.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              scheduledMaintenanceNumberPrefix: true,
            },
            title: "Scheduled Maintenance Number Prefix",
            description:
              "Custom prefix for scheduled maintenance numbers (e.g., 'SM-'). Leave empty for default '#'.",
            required: false,
            placeholder: "SM-",
            fieldType: FormFieldSchemaType.Text,
            validation: {
              maxLength: 20,
            },
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-sm-prefix",
          fields: [
            {
              field: {
                scheduledMaintenanceNumberPrefix: true,
              },
              title: "Scheduled Maintenance Number Prefix",
              placeholder: "# (default)",
              fieldType: FieldType.Text,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default ScheduledMaintenanceMoreSettings;
