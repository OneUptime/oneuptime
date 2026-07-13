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
          title: "Sentinel: Automatic Alert Investigation",
          description:
            "When enabled, Sentinel — OneUptime's AI SRE — automatically investigates every new alert and posts a cited root cause analysis to the alert timeline. Alerts can be higher-volume than incidents, so enable this with that in mind. Requires an LLM provider to be configured in Settings > Sentinel > LLM Providers.",
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
              enableInstrumentationFixTasks: true,
            },
            title: "Instrumentation PRs From Inconclusive Investigations",
            description:
              "Open instrumentation pull requests from inconclusive investigations (requires a connected GitHub repository). When an investigation cannot determine a root cause because telemetry was insufficient, Sentinel opens a pull request adding the missing logs, spans, and metrics to the implicated code paths — always human-reviewed, never auto-merged. This setting is shared between incident and alert investigations.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              alertInvestigationMinimumSeverity: true,
            },
            title: "Minimum Severity To Investigate",
            description:
              "Only alerts at or above this severity are investigated. When unset, the top two severity tiers are investigated by default.",
            required: false,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            placeholder: "Default (top two severity tiers)",
          },
          {
            field: {
              alertInvestigationDedupeWindowMinutes: true,
            },
            title: "Re-investigation Cooldown (Minutes)",
            description:
              "Repeat alerts from the same monitor within this many minutes are not re-investigated — the first analysis stands. Leave empty for the default of 30 minutes; set 0 to investigate every qualifying alert.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "30",
          },
          {
            field: {
              aiMaxConcurrentInvestigations: true,
            },
            title: "Max Concurrent Investigations",
            description:
              "How many investigations may run at the same time, shared across incident and alert investigations for this project. Queued investigations wait for a free slot and expire after 30 minutes. Leave empty for the default of 3 (minimum 1, maximum 25).",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "3",
          },
          {
            field: {
              aiDailyAutonomousTokenLimit: true,
            },
            title: "Daily Autonomous Token Limit",
            description:
              "Maximum tokens per day (UTC) that autonomous investigations may consume, shared across incident and alert investigations for this project. When reached, new investigations are skipped until the next day — interactive AI chat is never blocked. Leave empty for no limit; set 0 to pause autonomous investigations entirely.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "No limit",
          },
          {
            field: {
              aiDailyFixTaskLimit: true,
            },
            title: "Daily AI Fix Task Limit",
            description:
              "Maximum AI fix tasks (agent runs that open pull requests) that may be created per day (UTC) for this project, across every fix recipe — manual and automatic. Leave empty for the default of 25 per day; set 0 to pause AI fix tasks entirely.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "25",
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
                enableInstrumentationFixTasks: true,
              },
              title: "Instrumentation PRs From Inconclusive Investigations",
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
            {
              field: {
                alertInvestigationDedupeWindowMinutes: true,
              },
              title: "Re-investigation Cooldown (Minutes)",
              placeholder: "Default (30 minutes)",
              fieldType: FieldType.Number,
            },
            {
              field: {
                aiMaxConcurrentInvestigations: true,
              },
              title: "Max Concurrent Investigations",
              placeholder: "Default (3)",
              fieldType: FieldType.Number,
            },
            {
              field: {
                aiDailyAutonomousTokenLimit: true,
              },
              title: "Daily Autonomous Token Limit",
              placeholder: "No limit",
              fieldType: FieldType.Number,
            },
            {
              field: {
                aiDailyFixTaskLimit: true,
              },
              title: "Daily AI Fix Task Limit",
              placeholder: "Default (25)",
              fieldType: FieldType.Number,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default AlertAISettings;
