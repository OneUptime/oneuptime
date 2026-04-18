import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import TraceRecordingRule from "Common/Models/DatabaseModels/TraceRecordingRule";
import TraceRecordingRuleDefinition, {
  TraceRecordingRuleDefinitionUtil,
} from "Common/Types/Trace/TraceRecordingRuleDefinition";
import TraceRecordingRuleDefinitionEditor from "../../../Components/Traces/RecordingRule/TraceRecordingRuleDefinitionEditor";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Trace Recording Rules Work

A Trace Recording Rule computes a new metric from span aggregations on a schedule. Every minute, the worker evaluates each enabled rule for the **previous 1-minute bucket** and writes the result into the metric store under your chosen **Output Metric Name**.

### Definition

A rule is made of three parts:

- **Span Sources** — up to 4 span aggregations. Each gets an alias (A, B, C, D) and an aggregation type:
  - \`Count\` — count of matching spans
  - \`ErrorCount\` — count of spans with status = error
  - \`Avg / p50 / p95 / p99 / Max / Min Duration (s)\` — duration percentiles and extremes

  Optional per-source filters: span name regex, span kind, only-errors toggle, or attribute key/value.

- **Expression** — arithmetic over aliases. Operators: \`+ - * /\`, parentheses, numeric literals. Example: \`A / B * 100\`.
- **Group By** — optional attribute key (e.g. \`service.name\`). One derived data point per distinct value per bucket.

### Null semantics

Non-finite results (division by zero, missing source) produce no row — dashboards see a gap rather than bad data.

### Output labeling

Every materialized row carries \`oneuptime.derived.trace_rule_id\` plus the group-by value when set.
`;

const TraceRecordingRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<TraceRecordingRule>
      modelType={TraceRecordingRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="trace-recording-rules-table"
      name="Traces > Settings > Recording Rules"
      userPreferencesKey="trace-recording-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      sortBy="sortOrder"
      sortOrder={SortOrder.Ascending}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Recording Rules",
        description:
          "Compute derived metrics from expressions over span aggregations (count, error count, duration percentiles). Results are materialized as new metric series.",
      }}
      helpContent={{
        title: "How Trace Recording Rules Work",
        description:
          "Define a new metric as an expression over span aggregations, evaluated every minute.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No recording rules found."}
      createInitialValues={{
        isEnabled: true,
        definition: TraceRecordingRuleDefinitionUtil.getEmptyDefinition(),
      }}
      onBeforeCreate={async (item: TraceRecordingRule) => {
        if (!item.sortOrder) {
          item.sortOrder = 1;
        }
        if (item.isEnabled === undefined || item.isEnabled === null) {
          item.isEnabled = true;
        }
        return item;
      }}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Definition", id: "definition" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. HTTP error rate (from spans)",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          description: "What this rule computes and why.",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this rule computes and why.",
        },
        {
          field: { outputMetricName: true },
          title: "Output Metric Name",
          stepId: "basic-info",
          description:
            "Name of the new derived metric. Must be unique per project.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. http.server.error_rate",
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          description:
            "Only enabled rules are evaluated each minute. You can pause a rule any time.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: { definition: true },
          title: "Definition",
          stepId: "definition",
          description:
            "Pick your span sources, write the expression that combines them, and optionally split the result by an attribute.",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          customValidation: (values: FormValues<TraceRecordingRule>) => {
            return TraceRecordingRuleDefinitionUtil.getValidationError(
              values.definition as TraceRecordingRuleDefinition | undefined,
            );
          },
          getCustomElement: (
            values: FormValues<TraceRecordingRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <TraceRecordingRuleDefinitionEditor
                value={
                  values.definition as TraceRecordingRuleDefinition | undefined
                }
                onChange={(next: TraceRecordingRuleDefinition) => {
                  elementProps.onChange?.(next);
                }}
              />
            );
          },
        },
      ]}
      showRefreshButton={true}
      showViewIdButton={true}
      filters={[
        {
          field: { name: true },
          type: FieldType.Text,
          title: "Name",
        },
        {
          field: { outputMetricName: true },
          type: FieldType.Text,
          title: "Output Metric",
        },
        {
          field: { isEnabled: true },
          type: FieldType.Boolean,
          title: "Enabled",
        },
      ]}
      columns={[
        {
          field: { name: true, description: true },
          title: "Name",
          type: FieldType.Element,
          getElement: (item: TraceRecordingRule): ReactElement => {
            return (
              <div>
                <div className="font-medium text-gray-900">
                  {item.name || "Untitled"}
                </div>
                {item.description && (
                  <div className="text-xs text-gray-500 mt-0.5">
                    {item.description}
                  </div>
                )}
              </div>
            );
          },
        },
        {
          field: { outputMetricName: true },
          title: "Output Metric",
          type: FieldType.Element,
          getElement: (item: TraceRecordingRule): ReactElement => {
            return (
              <code className="text-sm font-mono text-indigo-600">
                {item.outputMetricName || ""}
              </code>
            );
          },
        },
        {
          field: { definition: true },
          title: "Expression",
          type: FieldType.Element,
          getElement: (item: TraceRecordingRule): ReactElement => {
            const raw: unknown = item.definition as unknown;
            let expr: string = "";
            if (typeof raw === "string") {
              try {
                const parsed: { expression?: string } = JSON.parse(raw);
                expr = parsed.expression ?? "";
              } catch {
                expr = "";
              }
            } else if (raw && typeof raw === "object") {
              expr = (raw as { expression?: string }).expression ?? "";
            }
            return (
              <code className="text-sm font-mono text-gray-700">{expr}</code>
            );
          },
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
    />
  );
};

export default TraceRecordingRules;
