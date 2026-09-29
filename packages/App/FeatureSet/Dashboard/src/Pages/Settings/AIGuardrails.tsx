import Project from "Common/Models/DatabaseModels/Project";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";

const AIGuardrails: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <CardModelDetail
      name="Other AI Workload Guardrails"
      cardProps={{
        title: "Other AI Workload Guardrails",
        description:
          "Control autonomous AI work that is not attached to an incident or alert. Incident and alert investigations have independent limits on their own AI settings pages.",
      }}
      isEditable={true}
      editButtonText="Edit Other AI Guardrails"
      formFields={[
        {
          field: {
            aiMaxConcurrentInvestigations: true,
          },
          title: "Max Concurrent Background AI Runs",
          description:
            "How many background AI runs without an incident or alert subject may run at once. Leave empty for the default of 3 (minimum 1, maximum 25).",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "3",
        },
        {
          field: {
            aiDailyAutonomousTokenLimit: true,
          },
          title: "Daily Background AI Token Limit",
          description:
            "Maximum tokens per UTC day for autonomous AI work without an incident or alert subject, such as AI Insight triage. Leave empty for no limit; set 0 to pause this background work.",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "No limit",
        },
        {
          field: {
            aiDailyFixTaskLimit: true,
          },
          title: "Daily Other AI Fix Task Limit",
          description:
            "Maximum fix tasks per UTC day that are not attached to an incident or alert, including exception, insight, and performance fixes. Leave empty for the default of 25; set 0 to pause them.",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "25",
        },
      ]}
      modelDetailProps={{
        modelType: Project,
        id: "other-ai-workload-guardrails",
        fields: [
          {
            field: {
              aiMaxConcurrentInvestigations: true,
            },
            fieldType: FieldType.Number,
            title: "Max Concurrent Background AI Runs",
            placeholder: "Default (3)",
          },
          {
            field: {
              aiDailyAutonomousTokenLimit: true,
            },
            fieldType: FieldType.Number,
            title: "Daily Background AI Token Limit",
            placeholder: "No limit",
          },
          {
            field: {
              aiDailyFixTaskLimit: true,
            },
            fieldType: FieldType.Number,
            title: "Daily Other AI Fix Task Limit",
            placeholder: "Default (25)",
          },
        ],
        modelId: ProjectUtil.getCurrentProjectId()!,
      }}
    />
  );
};

export default AIGuardrails;
