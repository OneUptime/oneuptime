import PageComponentProps from "../../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

const IncidentAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="Automatic Incident Investigation"
        cardProps={{
          title: "Automatic Incident Investigation (Sentinel)",
          description:
            "When enabled, OneUptime's AI SRE (Sentinel) automatically investigates every new incident and posts a cited root cause analysis to the incident timeline. Requires an LLM provider to be configured in Settings > LLM Providers.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              enableAutomaticIncidentInvestigation: true,
            },
            title: "Automatically Investigate Incidents",
            description:
              "Investigate every new incident and post a cited root cause analysis to the incident timeline.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-incident-ai-settings",
          fields: [
            {
              field: {
                enableAutomaticIncidentInvestigation: true,
              },
              title: "Automatically Investigate Incidents",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default IncidentAISettings;
