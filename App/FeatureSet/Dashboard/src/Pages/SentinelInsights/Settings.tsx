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
const SentinelInsightsSettings: FunctionComponent<ComponentProps> = (
  _props: ComponentProps,
): ReactElement => {
  return (
    <>
      <CardModelDetail<Project>
        name="Sentinel Insights Settings"
        cardProps={{
          title: "Sentinel Insights",
          description:
            "Sentinel's proactive telemetry watch: deterministic statistical sensors file quiet insights — they never page and never open incidents. Requires an LLM provider only for the optional AI triage analysis, not for detection.",
        }}
        isEditable={true}
        editButtonText={"Update"}
        formFields={[
          {
            field: {
              enableSentinelInsights: true,
            },
            title: "Enable Sentinel Insights (proactive telemetry watch)",
            description:
              "When enabled, Sentinel continuously watches this project's telemetry with deterministic statistical sensors (error-log spikes, exception novelty and spikes, trace-latency regressions, week-over-week metric drift) and files quiet Insights — never pages, never opens incidents. Each new insight also gets a budgeted, read-only AI triage analysis when an LLM provider is configured.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
          {
            field: {
              enableInsightFixTasks: true,
            },
            title: "Automatically open draft fix PRs from insights",
            description:
              "When enabled, insights whose deterministic evidence points at code (new or spiking exceptions with a resolvable repository, trace-latency regressions with span-tree findings) automatically queue an AI agent task that opens a draft pull request with a proposed fix. Honors the daily fix task budget and per-repository open-PR caps. Pull requests are always human-reviewed — nothing merges automatically.",
            required: false,
            fieldType: FormFieldSchemaType.Toggle,
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-sentinel-insights-settings",
          fields: [
            {
              field: {
                enableSentinelInsights: true,
              },
              title: "Enable Sentinel Insights (proactive telemetry watch)",
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
          ],
          modelId: ProjectUtil.getCurrentProjectId()!,
        }}
      />
    </>
  );
};

export default SentinelInsightsSettings;
