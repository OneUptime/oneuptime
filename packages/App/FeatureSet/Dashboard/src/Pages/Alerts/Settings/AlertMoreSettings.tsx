import PageComponentProps from "../../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

const AlertMoreSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="Alert Number Prefix"
        cardProps={{
          title: "Number Prefix",
          description:
            "Configure custom prefixes for alert and alert episode numbers. For example, set 'ALT-' to display alert numbers as 'ALT-42' instead of '#42'. Leave empty to use the default '#' prefix.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              alertNumberPrefix: true,
            },
            title: "Alert Number Prefix",
            description:
              "Custom prefix for alert numbers (e.g., 'ALT-'). Leave empty for default '#'.",
            required: false,
            placeholder: "ALT-",
            fieldType: FormFieldSchemaType.Text,
            validation: {
              maxLength: 20,
            },
          },
          {
            field: {
              alertEpisodeNumberPrefix: true,
            },
            title: "Alert Episode Number Prefix",
            description:
              "Custom prefix for alert episode numbers (e.g., 'AE-'). Leave empty for default '#'.",
            required: false,
            placeholder: "AE-",
            fieldType: FormFieldSchemaType.Text,
            validation: {
              maxLength: 20,
            },
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-alert-prefix",
          fields: [
            {
              field: {
                alertNumberPrefix: true,
              },
              title: "Alert Number Prefix",
              placeholder: "# (default)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                alertEpisodeNumberPrefix: true,
              },
              title: "Alert Episode Number Prefix",
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

export default AlertMoreSettings;
