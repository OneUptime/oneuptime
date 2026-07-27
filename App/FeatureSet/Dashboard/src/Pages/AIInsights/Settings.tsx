import PageComponentProps from "../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

export type ComponentProps = PageComponentProps;

/*
 * Both flags default to FALSE — insights and automatic fix tasks are
 * strictly opt-in (the roadmap's ImproveInstrumentation posture). The
 * server enforces the gates; this page only edits the Project columns.
 */
const AIInsightsSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="AI Insights Settings"
        cardProps={{
          title: "AI Insights",
          description:
            "OneUptime AI's proactive telemetry watch: deterministic statistical sensors file quiet insights — they never page and never open incidents. Requires an LLM provider only for the optional AI triage analysis, not for detection.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              enableAiInsights: true,
            },
            title: "Enable AI Insights (proactive telemetry watch)",
            description:
              "When enabled, OneUptime AI continuously watches this project's telemetry with deterministic statistical sensors (error-log spikes, exception novelty and spikes, trace-latency regressions, week-over-week metric drift) and files quiet Insights — never pages, never opens incidents. Each new insight also gets a budgeted, read-only AI triage analysis when an LLM provider is configured.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              enableInsightFixTasks: true,
            },
            title: "Automatically open draft fix PRs from insights",
            description:
              "When enabled, insights the AI triage classifies as code faults automatically queue an AI agent task that opens a draft pull request with a proposed fix. Insights triaged as user errors, expected denials or infrastructure conditions never get automatic PRs. Honors the daily fix task budget and per-repository open-PR caps. Pull requests are always human-reviewed — nothing merges automatically.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              autoArchiveNonActionableExceptions: true,
            },
            title: "Auto-archive expected-denial exceptions",
            description:
              "When enabled, exception groups the AI triage classifies as expected denials (auth failures, plan/paywall rejections, security scanners tripping intentional validation) are automatically archived so they stop surfacing in the unresolved list. User errors and infrastructure conditions are never auto-archived. Archiving is reversible from the Archived tab.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-ai-insights-settings",
          fields: [
            {
              field: {
                enableAiInsights: true,
              },
              title: "Enable AI Insights (proactive telemetry watch)",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                enableInsightFixTasks: true,
              },
              title: "Automatically open draft fix PRs from insights",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                autoArchiveNonActionableExceptions: true,
              },
              title: "Auto-archive expected-denial exceptions",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />

      {/*
       * The one deliberate exception to "insights never page": an opt-in
       * bridge that opens a real Alert (never an incident, never status-page
       * visible) from insights at or above a severity floor. Default OFF —
       * the server enforces every gate; this card only edits the Project
       * columns.
       */}
      <CardModelDetail<Project>
        name="Insight Escalation"
        cardProps={{
          title: "Insight Escalation",
          description:
            "Escalate qualifying insights to real Alerts that page via on-call. This is the ONLY way an insight can ever page anyone — with this off (the default), insights stay a quiet inbox. Escalation creates alerts, never incidents, and nothing appears on status pages.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              enableAiInsightEscalation: true,
            },
            title: "Escalate Qualifying Insights To Alerts",
            description:
              "When enabled, insights at or above the minimum severity open a real Alert — which pages via its on-call policies and (if enabled) wakes an automatic AI investigation.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              aiInsightEscalationMinimumSeverity: true,
            },
            title: "Minimum Severity To Escalate",
            description:
              "Only insights at or above this severity escalate. When unset, only High severity insights escalate — the strongest detector findings. Metric drift insights are always Low severity, so they never escalate at the default.",
            required: false,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(AIInsightSeverity),
            placeholder: "Default (High)",
          },
          {
            field: {
              aiInsightEscalationAlertSeverity: true,
            },
            title: "Alert Severity For Escalated Insights",
            description:
              "The alert severity assigned to alerts created from escalated insights. When unset, your project's most critical alert severity is used.",
            required: false,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            placeholder: "Default (most critical severity)",
          },
          {
            field: {
              aiInsightEscalationOnCallDutyPolicy: true,
            },
            title: "On-Call Policy To Page",
            description:
              "The on-call policy attached to alerts created from escalated insights — this is who gets paged. When unset, no policy is attached directly, though your alert on-call rules can still match the alert and page.",
            required: false,
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            placeholder: "None",
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-ai-insight-escalation-settings",
          fields: [
            {
              field: {
                enableAiInsightEscalation: true,
              },
              title: "Escalate Qualifying Insights To Alerts",
              placeholder: "Disabled",
              fieldType: FieldType.Boolean,
            },
            {
              field: {
                aiInsightEscalationMinimumSeverity: true,
              },
              title: "Minimum Severity To Escalate",
              placeholder: "Default (High)",
              fieldType: FieldType.Text,
            },
            {
              field: {
                aiInsightEscalationAlertSeverity: {
                  name: true,
                },
              },
              title: "Alert Severity For Escalated Insights",
              placeholder: "Default (most critical severity)",
              fieldType: FieldType.Entity,
            },
            {
              field: {
                aiInsightEscalationOnCallDutyPolicy: {
                  name: true,
                },
              },
              title: "On-Call Policy To Page",
              placeholder: "None",
              fieldType: FieldType.Entity,
            },
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default AIInsightsSettings;
