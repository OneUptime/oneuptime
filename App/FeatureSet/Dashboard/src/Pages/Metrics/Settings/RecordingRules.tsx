import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import MetricRecordingRule from "Common/Models/DatabaseModels/MetricRecordingRule";
import RecordingRuleDefinition, {
  RecordingRuleDefinitionUtil,
} from "Common/Types/Metrics/RecordingRuleDefinition";
import MetricRecordingRuleDefinitionEditor from "../../../Components/Metrics/RecordingRule/MetricRecordingRuleDefinitionEditor";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Recording Rules Work

A Recording Rule computes a new metric from one or more existing metrics on a schedule.

Every minute, the Recording Rules worker evaluates each enabled rule for the **previous 1-minute bucket**. The result is written into the metric store under your chosen **Output Metric Name**, tagged with the rule ID so you can tell derived series apart from raw data.

### Definition

A rule is made of three parts:

- **Sources** — up to 4 input metrics. Each gets an alias (A, B, C, D), a metric name, and an aggregation (Sum, Avg, Count, Min, Max). You can optionally filter a source by a single attribute key/value.
- **Expression** — arithmetic over the aliases. Operators: \`+ - * /\`, parentheses, numeric literals. Example: \`A / B * 100\`.
- **Group By** — optional attribute key (e.g. \`service.name\`). When set, one derived data point is produced per distinct value of that attribute.

### Null semantics

If a bucket would produce a non-finite result (division by zero, missing source, overflow), it is skipped — no row is written for that bucket. Dashboards and alerts see a gap rather than bad data.

### Output labeling

Every materialized row carries an attribute \`oneuptime.derived.rule_id\` with this rule's ID, plus the group-by attribute value when set.
`;

const MetricRecordingRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <ModelTable<MetricRecordingRule>
      modelType={MetricRecordingRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="metric-recording-rules-table"
      name="Metrics > Settings > Recording Rules"
      userPreferencesKey="metric-recording-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      sortBy="sortOrder"
      sortOrder={SortOrder.Ascending}
      createEditModalWidth={ModalWidth.Large}
      createInitialValues={{
        isEnabled: true,
        definition: RecordingRuleDefinitionUtil.getEmptyDefinition(),
      }}
      cardProps={{
        title: "Recording Rules",
        description:
          "Compute derived metrics from expressions over your existing metrics. Results are materialized as new series, so dashboards and alerts can query cheap pre-computed values.",
      }}
      helpContent={{
        title: "How Recording Rules Work",
        description:
          "Define a new metric as an expression over other metrics, evaluated every minute.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No recording rules found."}
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
          placeholder: "e.g. HTTP 5xx error rate",
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
            "The name the new derived metric will be written under. Must be unique per project.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. http.error_rate",
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
            "Pick your source metrics, write the expression that combines them, and optionally split the result by an attribute.",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          customValidation: (values: FormValues<MetricRecordingRule>) => {
            return RecordingRuleDefinitionUtil.getValidationError(
              values.definition as RecordingRuleDefinition | undefined,
            );
          },
          getCustomElement: (
            values: FormValues<MetricRecordingRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <MetricRecordingRuleDefinitionEditor
                value={
                  values.definition as RecordingRuleDefinition | undefined
                }
                onChange={(next: RecordingRuleDefinition) => {
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
          getElement: (item: MetricRecordingRule): ReactElement => {
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
          getElement: (item: MetricRecordingRule): ReactElement => {
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
          getElement: (item: MetricRecordingRule): ReactElement => {
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

export default MetricRecordingRules;
