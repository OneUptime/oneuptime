import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { getGeneratedKeyFormField } from "Common/UI/Components/Forms/Fields/GeneratedKeyField";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import MetricRecordingRule from "Common/Models/DatabaseModels/MetricRecordingRule";
import RecordingRuleDefinition, {
  RecordingRuleDefinitionUtil,
} from "Common/Types/Metrics/RecordingRuleDefinition";
import { getOutputMetricNameFromRuleName } from "Common/Types/Metrics/RecordingRuleOutputMetricName";
import { getRecordingRuleAdvancedSummary } from "../../../Components/Metrics/RecordingRule/RecordingRuleForm";
import MetricRecordingRuleDefinitionEditor from "../../../Components/Metrics/RecordingRule/MetricRecordingRuleDefinitionEditor";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const documentationMarkdown: string = `
### How Recording Rules Work

A Recording Rule computes a new metric from one or more existing metrics on a schedule.

Every minute, the Recording Rules worker evaluates each enabled rule for the **previous 1-minute bucket**. The result is written into the metric store under the rule's **Output Metric Name**, tagged with the rule ID so you can tell derived series apart from raw data. The output metric name is made from the rule's name - "HTTP 5xx error rate" writes \`http_5xx_error_rate\` - unless you choose **Edit** next to it and type your own.

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

/*
 * One page: the rule's name - the output metric line under it is made from
 * the name, not asked for - and its definition, with the description and
 * Enabled (on) folded under More fields (Components/Metrics/
 * RecordingRule/RecordingRuleForm says why).
 */
const metricRecordingRuleMoreFields: FormFieldCollapsibleSection<MetricRecordingRule> =
  getAdvancedFormSection<MetricRecordingRule>({
    getSummary: getRecordingRuleAdvancedSummary,
  });

const MetricRecordingRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
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
      /*
       * By name: every enabled rule is evaluated each minute, on its own,
       * so the list has no order to keep (sortOrder is never read).
       */
      sortBy="name"
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
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. HTTP 5xx error rate",
          validation: { minLength: 2 },
        },
        /*
         * On Create, made from the rule's name as it is typed (and by the
         * server when the create leaves it out); never asked for. Right
         * under the name it is made from.
         */
        getGeneratedKeyFormField<MetricRecordingRule>({
          field: { outputMetricName: true },
          nameField: "name",
          title: "Output Metric Name",
          makeKey: getOutputMetricNameFromRuleName,
          placeholder: "e.g. http.error_rate",
          description:
            "The name the new derived metric will be written under. Must be unique per project.",
        }),
        // On Edit, a rule's output metric can still be renamed.
        {
          field: { outputMetricName: true },
          title: "Output Metric Name",
          description:
            "The name the new derived metric will be written under. Must be unique per project.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. http.error_rate",
          doNotShowWhenCreating: true,
        },
        {
          field: { definition: true },
          title: "Definition",
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
                value={values.definition as RecordingRuleDefinition | undefined}
                onChange={(next: RecordingRuleDefinition) => {
                  elementProps.onChange?.(next);
                }}
              />
            );
          },
        },
        {
          field: { description: true },
          title: "Description",
          description: "What this rule computes and why.",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this rule computes and why.",
          collapsibleSection: metricRecordingRuleMoreFields,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description:
            "Only enabled rules are evaluated each minute. You can pause a rule any time.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          collapsibleSection: metricRecordingRuleMoreFields,
        },
      ]}
      showRefreshButton={true}
      searchableFields={["name", "description"]}
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
                  {item.name || translator.translateText("Untitled")}
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
