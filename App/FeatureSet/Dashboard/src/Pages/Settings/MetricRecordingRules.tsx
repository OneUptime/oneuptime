import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import MetricRecordingRule from "Common/Models/DatabaseModels/MetricRecordingRule";
import ProjectUtil from "Common/UI/Utils/Project";
import IconProp from "Common/Types/Icon/IconProp";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

// Starter example shown as the default value for the definition field. Users
// edit it in place. JSON keeps the form small for v1; a visual builder can
// come later without changing the stored schema.
const exampleDefinition: string = JSON.stringify(
  {
    sources: [
      {
        alias: "A",
        metricName: "http.errors",
        aggregationType: "Sum",
      },
      {
        alias: "B",
        metricName: "http.requests",
        aggregationType: "Sum",
      },
    ],
    expression: "A / B * 100",
    groupByAttribute: "service.name",
  },
  null,
  2,
);

const documentationMarkdown: string = `
### How Recording Rules Work

A Recording Rule computes a new metric from one or more existing metrics on a schedule.

Every minute, the Recording Rules worker evaluates each enabled rule for the **previous 1-minute bucket**. The result is written into the metric store under your chosen **Output Metric Name**, tagged with the rule ID so you can tell derived series apart from raw data.

### Definition

The \`definition\` field is JSON with three parts:

- **sources** — list of input metrics, each with an \`alias\` (A, B, C, …), a \`metricName\`, and an \`aggregationType\` (Sum, Avg, Count, Min, Max). Optional \`filterAttributeKey\` + \`filterAttributeValue\` narrow the input.
- **expression** — an arithmetic expression over the aliases. Operators: \`+ - * /\`, parentheses, numeric literals. Example: \`A / B * 100\`.
- **groupByAttribute** — optional attribute key (e.g. \`service.name\`). When set, one derived data point is produced per distinct value of that attribute.

### Null semantics

If a bucket would produce a non-finite result (division by zero, missing source, overflow), it is skipped — no row is written for that bucket. Dashboards and alerts see a gap rather than bad data.

### Output labeling

Every materialized row carries an attribute \`oneuptime.derived.rule_id\` with this rule's ID, plus the group-by attribute value when set.
`;

const MetricRecordingRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<MetricRecordingRule>
        modelType={MetricRecordingRule}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="metric-recording-rules-table"
        name="Settings > Telemetry & APM > Recording Rules"
        userPreferencesKey="metric-recording-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        sortBy="sortOrder"
        sortOrder={SortOrder.Ascending}
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
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. HTTP 5xx error rate",
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
              "The name the new derived metric will be written under. Must be unique per project.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. http.error_rate",
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
              // The form stores definition as a JSON-encoded string, but
              // future writes (or API-created rows) may land as plain
              // objects. Handle both.
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
    </Fragment>
  );
};

export default MetricRecordingRules;

// Re-export to silence unused-import lint for icon import if needed later.
export const RECORDING_RULE_ICON: IconProp = IconProp.Calculator;
