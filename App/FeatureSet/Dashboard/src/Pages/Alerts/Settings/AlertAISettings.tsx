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
          title: "Automatic Alert Investigation",
          description:
            "When enabled, OneUptime AI automatically investigates every new alert and posts a cited root cause analysis to the alert timeline. Alerts can be higher-volume than incidents, so enable this with that in mind. Requires an LLM provider to be configured in Settings > AI > LLM Providers.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formSteps={[
          {
            title: "Investigation",
            id: "investigation",
          },
          {
            title: "Limits",
            id: "limits",
          },
          {
            title: "Fix Tasks",
            id: "fix-tasks",
          },
        ]}
        formFields={[
          {
            field: {
              enableAutomaticAlertInvestigation: true,
            },
            stepId: "investigation",
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
            stepId: "investigation",
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
            stepId: "investigation",
            title: "Re-investigation Cooldown (Minutes)",
            description:
              "Repeat alerts from the same monitor within this many minutes are not re-investigated — the first analysis stands. Leave empty for the default of 30 minutes; set 0 to investigate every qualifying alert.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "30",
          },
          {
            field: {
              alertAiMaxConcurrentInvestigations: true,
            },
            stepId: "limits",
            title: "Max Concurrent Alert Investigations",
            description:
              "How many alert investigations may run at the same time for this project. Queued alert investigations wait for a free slot and expire after 30 minutes. Leave empty for the default of 3 (minimum 1, maximum 25).",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "3",
          },
          {
            field: {
              alertAiDailyAutonomousTokenLimit: true,
            },
            stepId: "limits",
            title: "Daily Alert AI Token Limit",
            description:
              "Maximum tokens per day (UTC) for autonomous alert-linked AI work, including investigations, remediation, and follow-up fix tasks. When reached, new alert-linked AI work is skipped until the next day — interactive AI chat is never blocked. Leave empty for no limit; set 0 to pause autonomous alert AI work entirely.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "No limit",
          },
          {
            field: {
              enableAlertInstrumentationFixTasks: true,
            },
            stepId: "fix-tasks",
            title: "Instrumentation PRs From Inconclusive Investigations",
            description:
              "Open instrumentation pull requests from inconclusive alert investigations (requires a connected GitHub repository). When an alert investigation cannot determine a root cause because telemetry was insufficient, OneUptime AI opens a pull request adding the missing logs, spans, and metrics to the implicated code paths — always human-reviewed, never auto-merged.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              enableAutomaticAlertCodeFixes: true,
            },
            stepId: "fix-tasks",
            title: "Enable Automatic Alert Code Fixes",
            description:
              "Open a draft fix pull request automatically when an alert investigation ends with a confident, evidenced root cause analysis that recommends a repository code change — the automatic form of the 'Open Fix PR from this analysis' button. Operational, infrastructure, external, user-error and inconclusive findings do not open pull requests. Requires a repository connected through the GitHub App and a Runner with the code-fix capability. Pull requests are always human-reviewed — nothing merges automatically.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              alertAiDailyFixTaskLimit: true,
            },
            stepId: "fix-tasks",
            title: "Daily Alert AI Fix Task Limit",
            description:
              "Maximum alert AI fix tasks (agent runs that open pull requests) that may be created per day (UTC) for this project, across manual and automatic alert fix recipes. Leave empty for the default of 25 per day; set 0 to pause alert AI fix tasks entirely.",
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
                alertInvestigationMinimumSeverity: {
                  name: true,
                  color: true,
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
                alertAiMaxConcurrentInvestigations: true,
              },
              title: "Max Concurrent Alert Investigations",
              placeholder: "Default (3)",
              fieldType: FieldType.Number,
            },
            {
              field: {
                alertAiDailyAutonomousTokenLimit: true,
              },
              title: "Daily Alert AI Token Limit",
              placeholder: "No limit",
              fieldType: FieldType.Number,
            },
            {
              field: {
                enableAlertInstrumentationFixTasks: true,
              },
              title: "Instrumentation PRs From Inconclusive Investigations",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                enableAutomaticAlertCodeFixes: true,
              },
              title: "Enable Automatic Alert Code Fixes",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                alertAiDailyFixTaskLimit: true,
              },
              title: "Daily Alert AI Fix Task Limit",
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
