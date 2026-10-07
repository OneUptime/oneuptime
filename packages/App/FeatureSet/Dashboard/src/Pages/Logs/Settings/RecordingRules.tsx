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
import LogRecordingRule from "Common/Models/DatabaseModels/LogRecordingRule";
import { getOutputMetricNameFromRuleName } from "Common/Types/Metrics/RecordingRuleOutputMetricName";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_ID_ATTRIBUTE,
  LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES,
  LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE,
  LogRecordingRuleDefinitionUtil,
} from "Common/Types/Log/LogRecordingRuleDefinition";
import {
  LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS,
  LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES,
} from "Common/Utils/Telemetry/LogRecordingRuleWindow";
import { getRecordingRuleAdvancedSummary } from "../../../Components/Metrics/RecordingRule/RecordingRuleForm";
import LogRecordingRuleDefinitionEditor from "../../../Components/Logs/RecordingRule/LogRecordingRuleDefinitionEditor";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const documentationMarkdown: string = `
### How Log Recording Rules Work

A Log Recording Rule turns logs into a metric. Every minute, the worker takes the logs that match the rule's filter in each **1-minute bucket** and writes one point per bucket - per series, with a group by - into the metric store under the rule's **Output Metric Name**. Chart it in the Metric Explorer or on a dashboard, or alert on it with a Metrics monitor, like any other metric. The output metric name is made from the rule's name - "SD-WAN gateway latency" writes \`sd_wan_gateway_latency\` - unless you choose **Edit** next to it and type your own (e.g. \`sdwan.gateway.latency.ms\`).

### Definition

- **Which Logs** - telemetry services, severities, text the body contains and attribute equality filters. All optional; they AND together.
- **Aggregation** - \`Count of logs\`, or the \`Sum\`, \`Average\`, \`Minimum\`, \`Maximum\` or a percentile (\`p50\` ... \`p99\`) of a **numeric attribute**. The attribute's value must be a number (\`latency=11\`); logs where it is missing or not a number are skipped - never counted as 0.
- **Group By** - up to ${LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES} attribute keys. One series per distinct combination of their values, written with those attributes so charts and Metrics monitors can group by them. At most ${LOG_RECORDING_RULE_MAX_SERIES_PER_MINUTE} series are written per minute: the ones with the most logs.
- **Unit** - the output metric's unit, e.g. \`ms\`.

Attribute filter keys match whatever their case; the numeric attribute and group-by keys must be written exactly as the logs carry them - pick them from the suggestions.

### When points are written

A bucket is computed ${LOG_RECORDING_RULE_EVALUATION_LAG_IN_SECONDS} seconds after it ends, so late logs still land in it. Each rule remembers the last minute it wrote: after a worker restart or other downtime it catches up on the minutes it missed, up to ${LOG_RECORDING_RULE_MAX_CATCH_UP_IN_MINUTES} minutes back, and never writes a minute twice. A count with no group by writes 0 for a minute with no matching logs; other rules write nothing for a minute with nothing to aggregate.

### Example: SD-WAN gateway latency

A firewall's syslog SLA summaries, parsed by a log pipeline into attributes (\`gw_name\`, \`profile_name\`, \`latency\` ...): filter on \`log_component\` = \`SLA\`, aggregate **Average** of \`latency\`, group by \`gw_name\` and \`profile_name\`, unit \`ms\`. Then create a **Metrics** monitor on the output metric with **Group By** \`gw_name\` to get one alert per gateway whose latency stays high.

### Output labeling

Every point carries \`${LOG_RECORDING_RULE_ID_ATTRIBUTE}\` with the rule's ID, plus its group-by values.
`;

/*
 * One page, as the metric and trace recording rules' are: the rule's name -
 * the output metric line under it is made from the name, not asked for -
 * and its definition, with the description and Enabled (on) folded under
 * More fields (Components/Metrics/RecordingRule/RecordingRuleForm says why).
 */
const logRecordingRuleMoreFields: FormFieldCollapsibleSection<LogRecordingRule> =
  getAdvancedFormSection<LogRecordingRule>({
    getSummary: getRecordingRuleAdvancedSummary,
  });

const LogRecordingRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<LogRecordingRule>
      modelType={LogRecordingRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="log-recording-rules-table"
      name="Logs > Settings > Recording Rules"
      userPreferencesKey="log-recording-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      /*
       * By name: every enabled rule is evaluated each minute, on its own,
       * so the list has no order to keep.
       */
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Recording Rules",
        description:
          "Turn logs into metrics: count matching logs, or aggregate a numeric log attribute, every minute - optionally split by log attributes. Results are written as new metric series you can chart and alert on.",
      }}
      helpContent={{
        title: "How Log Recording Rules Work",
        description:
          "Define a new metric as a count or an aggregation over logs, evaluated every minute.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No recording rules found."}
      createInitialValues={{
        isEnabled: true,
        definition: LogRecordingRuleDefinitionUtil.getEmptyDefinition(),
      }}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. SD-WAN gateway latency",
          validation: { minLength: 2 },
        },
        /*
         * On Create, made from the rule's name as it is typed (and by the
         * server when the create leaves it out); never asked for. Right
         * under the name it is made from.
         */
        getGeneratedKeyFormField<LogRecordingRule>({
          field: { outputMetricName: true },
          nameField: "name",
          title: "Output Metric Name",
          makeKey: getOutputMetricNameFromRuleName,
          placeholder: "e.g. sdwan.gateway.latency.ms",
          description:
            "Name of the new metric this rule writes. Must be unique per project.",
        }),
        // On Edit, a rule's output metric can still be renamed.
        {
          field: { outputMetricName: true },
          title: "Output Metric Name",
          description:
            "Name of the new metric this rule writes. Must be unique per project.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. sdwan.gateway.latency.ms",
          doNotShowWhenCreating: true,
        },
        {
          field: { definition: true },
          title: "Definition",
          description:
            "Pick the logs, what to compute from them each minute, and optionally the attributes to split the result by.",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: true,
          customValidation: (values: FormValues<LogRecordingRule>) => {
            return LogRecordingRuleDefinitionUtil.getValidationError(
              values.definition,
            );
          },
          getCustomElement: (
            values: FormValues<LogRecordingRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <LogRecordingRuleDefinitionEditor
                value={
                  values.definition as LogRecordingRuleDefinition | undefined
                }
                onChange={(next: LogRecordingRuleDefinition) => {
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
          collapsibleSection: logRecordingRuleMoreFields,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description:
            "Only enabled rules are evaluated each minute. You can pause a rule any time.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          collapsibleSection: logRecordingRuleMoreFields,
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
          getElement: (item: LogRecordingRule): ReactElement => {
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
          getElement: (item: LogRecordingRule): ReactElement => {
            return (
              <code className="text-sm font-mono text-indigo-600">
                {item.outputMetricName || ""}
              </code>
            );
          },
        },
        {
          field: { definition: true },
          title: "Computes",
          type: FieldType.Element,
          getElement: (item: LogRecordingRule): ReactElement => {
            const definition: LogRecordingRuleDefinition | null =
              LogRecordingRuleDefinitionUtil.fromJSON(item.definition);

            return (
              <code className="text-sm font-mono text-gray-700">
                {definition
                  ? LogRecordingRuleDefinitionUtil.describe(definition)
                  : ""}
              </code>
            );
          },
        },
        {
          field: { computedUntil: true },
          title: "Computed Until",
          type: FieldType.DateTime,
          noValueMessage: "Not run yet",
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

export default LogRecordingRules;
