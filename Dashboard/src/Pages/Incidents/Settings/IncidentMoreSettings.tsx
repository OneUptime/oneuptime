import PageComponentProps from "../../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

const IncidentMoreSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="Incident Number Prefix"
        cardProps={{
          title: "Number Prefix",
          description:
            "Configure custom prefixes for incident and incident episode numbers. For example, set 'INC-' to display incident numbers as 'INC-42' instead of '#42'. Leave empty to use the default '#' prefix.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              incidentNumberPrefix: true,
            },
            title: "Incident Number Prefix",
            description:
              "Custom prefix for incident numbers (e.g., 'INC-'). Leave empty for default '#'.",
            required: false,
            placeholder: "INC-",
            fieldType: FormFieldSchemaType.Text,
            validation: {
              maxLength: 20,
            },
          },
          {
            field: {
              incidentEpisodeNumberPrefix: true,
            },
            title: "Incident Episode Number Prefix",
            description:
              "Custom prefix for incident episode numbers (e.g., 'IE-'). Leave empty for default '#'.",
            required: false,
            placeholder: "IE-",
            fieldType: FormFieldSchemaType.Text,
            validation: {
              maxLength: 20,
            },
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-incident-prefix",
          fields: [
            {
              field: {
                incidentNumberPrefix: true,
              },
              title: "Incident Number Prefix",
              placeholder: "# (default)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                incidentEpisodeNumberPrefix: true,
              },
              title: "Incident Episode Number Prefix",
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

export default IncidentMoreSettings;
