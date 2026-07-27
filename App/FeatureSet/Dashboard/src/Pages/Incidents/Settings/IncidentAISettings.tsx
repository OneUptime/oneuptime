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
          title: "Automatic Incident Investigation",
          description:
            "When enabled, OneUptime AI automatically investigates every new incident and posts a cited root cause analysis to the incident timeline. Requires an LLM provider to be configured in Settings > AI > LLM Providers.",
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
          {
            field: {
              enableInstrumentationFixTasks: true,
            },
            title: "Instrumentation PRs From Inconclusive Investigations",
            description:
              "Open instrumentation pull requests from inconclusive investigations (requires a connected GitHub repository). When an investigation cannot determine a root cause because telemetry was insufficient, OneUptime AI opens a pull request adding the missing logs, spans, and metrics to the implicated code paths — always human-reviewed, never auto-merged. This setting is shared between incident and alert investigations.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
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

      <CardModelDetail<Project>
        name="AI Remediation"
        cardProps={{
          title: "AI Remediation",
          description:
            "When an investigation reaches a confident root cause, OneUptime AI can also propose remediation actions — starting one of your existing runbooks, or a drafted command for one of your Runbook Agents. Proposals wait for approval on the incident or alert page and expire after 24 hours. This setting is shared between incident and alert investigations.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              enableAiRemediation: true,
            },
            title: "Propose Remediation Actions",
            description:
              "Propose up to 3 remediation actions after each confident investigation. Proposals are only ever suggestions until approved — and drafted commands always require explicit approval, everywhere.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              enableAiAutoRemediationOnNonProduction: true,
            },
            title: "Auto-Execute Runbook Actions On Non-Production Agents",
            description:
              "Only ever applies to RUNBOOK actions — and only when every executing step of that runbook targets a Runbook Agent explicitly tagged Staging, Testing or Development. Agents tagged Production, and agents never tagged at all, always require a human click. Drafted commands are never auto-executed regardless of this setting.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              aiDailyRemediationExecutionLimit: true,
            },
            title: "Daily Remediation Execution Limit",
            description:
              "Maximum AI-proposed remediation executions per day (UTC), counting human-approved and auto-executed actions together. Leave empty for the default of 10 — unset is NOT unlimited, because these actions run on your infrastructure. Set 0 to pause AI remediation execution entirely.",
            required: false,
            fieldType: FormFieldSchemaType.Number,
            placeholder: "10 (default)",
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-incident-ai-remediation-settings",
          fields: [
            {
              field: {
                enableAiRemediation: true,
              },
              title: "Propose Remediation Actions",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                enableAiAutoRemediationOnNonProduction: true,
              },
              title: "Auto-Execute Runbook Actions On Non-Production Agents",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                aiDailyRemediationExecutionLimit: true,
              },
              title: "Daily Remediation Execution Limit",
              placeholder: "Default (10)",
              fieldType: FieldType.Number,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default IncidentAISettings;
