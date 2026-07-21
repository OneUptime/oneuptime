import PageComponentProps from "../PageComponentProps";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Project from "Common/Models/DatabaseModels/Project";
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
    </>
  );
};

export default AIInsightsSettings;
