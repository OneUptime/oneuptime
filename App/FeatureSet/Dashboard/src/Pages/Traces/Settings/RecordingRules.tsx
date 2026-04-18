import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import TraceRecordingRule from "Common/Models/DatabaseModels/TraceRecordingRule";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const exampleDefinition: string = JSON.stringify(
  {
    sources: [
      {
        alias: "A",
        aggregationType: "ErrorCount",
      },
      {
        alias: "B",
        aggregationType: "Count",
      },
    ],
    expression: "A / B * 100",
    groupByAttribute: "service.name",
  },
  null,
  2,
);

const documentationMarkdown: string = `
### How Trace Recording Rules Work

A Trace Recording Rule computes a new metric from span aggregations on a schedule. Every minute, the worker evaluates each enabled rule for the **previous 1-minute bucket** and writes the result into the metric store under your chosen **Output Metric Name**.

### Definition

JSON with three parts:

- **sources** — list of span aggregations, each with an \`alias\` (A, B, C, …) and an \`aggregationType\`:
  - \`Count\` — count of matching spans
  - \`ErrorCount\` — count of spans with status = error
  - \`AvgDurationSeconds\`, \`P50DurationSeconds\`, \`P95DurationSeconds\`, \`P99DurationSeconds\`, \`MaxDurationSeconds\`, \`MinDurationSeconds\`

  Optional filters per source: \`spanNameRegex\`, \`spanKind\`, \`onlyErrors\`, \`filterAttributeKey\` + \`filterAttributeValue\`.

- **expression** — arithmetic over aliases. Operators: \`+ - * /\`, parentheses, numeric literals. Example: \`A / B * 100\`.
- **groupByAttribute** — optional attribute key (e.g. \`service.name\`). One derived data point per distinct value per bucket.

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
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. HTTP error rate (from spans)",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this rule computes and why.",
        },
        {
          field: { outputMetricName: true },
          title: "Output Metric Name",
          description:
            "Name of the new derived metric. Must be unique per project.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. http.server.error_rate",
        },
        {
          field: { definition: true },
          title: "Definition (JSON)",
          description:
            "Sources, expression, and optional group-by attribute. See Help for the schema.",
          fieldType: FormFieldSchemaType.JSON,
          required: true,
          defaultValue: JSON.parse(exampleDefinition),
          placeholder: exampleDefinition,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
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
