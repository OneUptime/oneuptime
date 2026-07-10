import PageComponentProps from "../../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

const AlertAISettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="Automatic Alert Investigation"
        cardProps={{
          title: "Automatic Alert Investigation (Sentinel)",
          description:
            "When enabled, OneUptime's AI SRE (Sentinel) automatically investigates every new alert and posts a cited root cause analysis to the alert timeline. Alerts can be higher-volume than incidents, so enable this with that in mind. Requires an LLM provider to be configured in Settings > LLM Providers.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              enableAutomaticAlertInvestigation: true,
            },
            title: "Automatically Investigate Alerts",
            description:
              "Investigate every new alert and post a cited root cause analysis to the alert timeline.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              alertInvestigationMinimumSeverity: true,
            },
            title: "Minimum Severity To Investigate",
            description:
              "Only alerts at or above this severity are investigated. When unset, the top two severity tiers are investigated by default. Repeat alerts from the same monitor within 30 minutes are not re-investigated.",
            required: false,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            placeholder: "Default (top two severity tiers)",
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-alert-ai-settings",
          fields: [
            {
              field: {
                enableAutomaticAlertInvestigation: true,
              },
              title: "Automatically Investigate Alerts",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                alertInvestigationMinimumSeverity: {
                  name: true,
                },
              },
              title: "Minimum Severity To Investigate",
              placeholder: "Default (top two severity tiers)",
              fieldType: FieldType.Entity,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default AlertAISettings;
