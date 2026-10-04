import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import {
  getAdvancedFormSection,
  normalizeFormValue,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import MetricPipelineRule from "Common/Models/DatabaseModels/MetricPipelineRule";
import MetricPipelineRuleType from "Common/Types/Metrics/MetricPipelineRuleType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterConditionUtil,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import MetricPipelineRuleFilters from "../../../Components/Metrics/PipelineRuleFilter/MetricPipelineRuleFilters";
import Service from "Common/Models/DatabaseModels/Service";
import ProjectUtil from "Common/UI/Utils/Project";
import Pill from "Common/UI/Components/Pill/Pill";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import {
  Blue500,
  Green500,
  Purple500,
  Cyan500,
  Orange500,
  Red500,
  Teal500,
  Indigo500,
  Gray500,
} from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

interface PillConfig {
  label: string;
  color: Color;
  icon: IconProp;
  tooltip: string;
}

const ruleTypeCardOptions: Array<CardSelectOption> = [
  {
    value: MetricPipelineRuleType.Filter,
    title: "Filter (allowlist)",
    description:
      "Keep only data points matching the criteria. Everything that does not match is dropped at ingest. Useful for strict allowlists.",
    icon: IconProp.Filter,
  },
  {
    value: MetricPipelineRuleType.Drop,
    title: "Drop",
    description:
      "Drop data points matching the criteria. Everything else passes through unchanged. Useful for silencing noisy metrics.",
    icon: IconProp.Trash,
  },
  {
    value: MetricPipelineRuleType.RenameMetric,
    title: "Rename Metric",
    description:
      "Rename the metric itself. Use this to standardize names across SDK versions or to align with your internal naming convention.",
    icon: IconProp.Edit,
  },
  {
    value: MetricPipelineRuleType.RenameAttribute,
    title: "Rename Attribute",
    description:
      "Rename an attribute key on matched rows (values are preserved). Useful for normalizing attribute naming between services.",
    icon: IconProp.Edit,
  },
  {
    value: MetricPipelineRuleType.AddAttribute,
    title: "Add Attribute",
    description:
      "Attach a new attribute (key = value) to matched rows. Great for tagging by environment, region, or ownership at ingest.",
    icon: IconProp.Add,
  },
  {
    value: MetricPipelineRuleType.RemoveAttribute,
    title: "Remove Attribute",
    description:
      "Delete an attribute from matched rows. Useful when an SDK emits a high-cardinality attribute you do not want stored.",
    icon: IconProp.Close,
  },
  {
    value: MetricPipelineRuleType.RedactAttribute,
    title: "Redact Attribute",
    description:
      "Replace an attribute's value with a redaction placeholder (default [REDACTED]). Keeps the key visible but hides sensitive data.",
    icon: IconProp.EyeSlash,
  },
  {
    value: MetricPipelineRuleType.Sample,
    title: "Sample",
    description:
      "Probabilistically keep a percentage of matched rows and drop the rest. Cuts volume on high-frequency metrics while keeping a representative sample.",
    icon: IconProp.Percent,
  },
];

const ruleTypeConfig: Record<string, PillConfig> = {
  [MetricPipelineRuleType.Filter]: {
    label: "Filter",
    color: Blue500,
    icon: IconProp.Filter,
    tooltip: "Keep only data points matching the match expression.",
  },
  [MetricPipelineRuleType.Drop]: {
    label: "Drop",
    color: Red500,
    icon: IconProp.Trash,
    tooltip: "Drop data points matching the match expression.",
  },
  [MetricPipelineRuleType.RenameMetric]: {
    label: "Rename Metric",
    color: Indigo500,
    icon: IconProp.Edit,
    tooltip: "Rename the metric (row.name).",
  },
  [MetricPipelineRuleType.RenameAttribute]: {
    label: "Rename Attribute",
    color: Cyan500,
    icon: IconProp.Edit,
    tooltip: "Rename an attribute key.",
  },
  [MetricPipelineRuleType.AddAttribute]: {
    label: "Add Attribute",
    color: Green500,
    icon: IconProp.Add,
    tooltip: "Add a new attribute to the data point.",
  },
  [MetricPipelineRuleType.RemoveAttribute]: {
    label: "Remove Attribute",
    color: Orange500,
    icon: IconProp.Close,
    tooltip: "Remove an attribute from the data point.",
  },
  [MetricPipelineRuleType.RedactAttribute]: {
    label: "Redact Attribute",
    color: Purple500,
    icon: IconProp.EyeSlash,
    tooltip: "Replace an attribute's value with a redacted placeholder.",
  },
  [MetricPipelineRuleType.Sample]: {
    label: "Sample",
    color: Teal500,
    icon: IconProp.Percent,
    tooltip: "Probabilistically keep a percentage of matched rows.",
  },
};

const documentationMarkdown: string = `
### How Metric Pipeline Rules Work

Pipeline rules run **at metric ingest time**, after the OTel data point has been parsed but **before** it is written to storage. Service-scoped rules run first (and may short-circuit with \`Drop\`). Project-wide rules run after, on anything that survived.

| Rule Type        | What it does                                                    |
|------------------|-----------------------------------------------------------------|
| Filter           | Keep only data points matching the match expression.            |
| Drop             | Drop data points matching the match expression.                 |
| Rename Metric    | Rename the metric name (row.name).                              |
| Rename Attribute | Rename an attribute key everywhere it appears on matched rows.  |
| Add Attribute    | Add a new attribute (key = value) to matched rows.              |
| Remove Attribute | Remove an attribute from matched rows.                          |
| Redact Attribute | Replace an attribute's value with a redaction placeholder.      |
| Sample           | Keep \`samplePercentage\`% of matching rows; drop the rest.     |

### Match Criteria

Add one or more **Filters** to decide which data points the rule fires on:

- **Metric Name** — match on the metric name with conditions like Equal To, Contains, Starts With, Matches Regex, etc.
- **Attribute** — match on a specific attribute key. Choose Is Present / Is Not Present / Is Empty / Is Not Empty for key-based checks, or Equal To / Contains / Matches Regex (etc.) to compare the attribute value.

Once a rule has two or more filters, **Filter Condition** decides how they are combined (with one filter or none there is nothing to combine, so it is not asked):

- **All** (AND) — the data point must match every filter.
- **Any** (OR) — the data point matches if at least one filter matches.

If no filters are added, the rule applies to every metric data point.

### Scope

- A new rule applies to every service: it is a project-wide rule.
- To scope a rule to a single service, open **More fields** on the Match step and pick it under **Only for one service**. Service-scoped rules evaluate first.
`;

/*
 * CREATE A METRIC PIPELINE RULE: WHICH DATA POINTS, THEN WHAT HAPPENS TO
 * THEM.
 *
 * It used to open on a "Basic Info" step - a name, a description, a service
 * and an Enabled switch - and asked what the rule matches and does only on
 * the two steps after it. Two steps now, both about the rule, as a log or
 * trace drop filter walks them (Components/Telemetry/DropFilterForm):
 *
 *   - Match: the rule's name and its filters. Filter Condition (All / Any)
 *     shows once there are two filters to combine (isFilterConditionNeeded,
 *     the rule the conditions builder follows); until then it keeps its
 *     default, All, which is what the rule is saved with. Then, folded under
 *     More fields: the description, the one service the rule is limited to
 *     (none: every service) and Enabled, on - the header says so in a
 *     sentence while they are left alone.
 *   - Action: what the rule does, and the one or two values that action
 *     needs. The rule is created from here, the last step.
 */

// What the folded section says while everything in it is left alone.
export const PIPELINE_RULE_DEFAULTS_SUMMARY: string = translationKey(
  "The rule applies to every service, and takes effect within a minute of being saved.",
);

/**
 * The sentence under the folded More fields header while its fields hold
 * their defaults - no description, every service, on - or nothing once one
 * is set: the header's chips then say what.
 */
export const getPipelineRuleAdvancedSummary: (
  values: FormValues<MetricPipelineRule>,
) => Array<string> | undefined = (
  values: FormValues<MetricPipelineRule>,
): Array<string> | undefined => {
  const formValues: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;
  const description: unknown = formValues["description"];
  const service: unknown = normalizeFormValue(formValues["service"]);
  const isEnabled: unknown = normalizeFormValue(formValues["isEnabled"]);

  const hasDescription: boolean =
    typeof description === "string" && description.trim().length > 0;
  const hasService: boolean =
    service !== undefined && service !== null && service !== "";
  const isSwitchedOff: boolean = isEnabled === false;

  return hasDescription || hasService || isSwitchedOff
    ? undefined
    : [PIPELINE_RULE_DEFAULTS_SUMMARY];
};

const pipelineRuleMoreFields: FormFieldCollapsibleSection<MetricPipelineRule> =
  getAdvancedFormSection<MetricPipelineRule>({
    getSummary: getPipelineRuleAdvancedSummary,
  });

const MetricPipelineRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  return (
    <ModelTable<MetricPipelineRule>
      modelType={MetricPipelineRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="metric-pipeline-rules-table"
      name="Metrics > Settings > Pipeline Rules"
      userPreferencesKey="metric-pipeline-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      sortBy="sortOrder"
      sortOrder={SortOrder.Ascending}
      enableDragAndDrop={true}
      dragDropIndexField="sortOrder"
      createEditModalWidth={ModalWidth.Large}
      // No filters yet: the rule matches every data point until some are added.
      createInitialValues={{ filters: [] }}
      cardProps={{
        title: "Metric Pipeline Rules",
        description:
          "Filter, drop, rename, enrich, redact, or sample OpenTelemetry metrics at ingest time. Drag to reorder.",
      }}
      helpContent={{
        title: "How Metric Pipeline Rules Work",
        description:
          "Understanding rule types, match criteria, and service-vs-project scope.",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No metric pipeline rules found."}
      formSteps={[
        { title: "Match", id: "match" },
        { title: "Action", id: "action" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "match",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Drop noisy http.server.duration",
          validation: { minLength: 2 },
        },
        {
          field: { filters: true },
          title: "Filters",
          stepId: "match",
          description:
            "Add filters to decide which metric data points this rule fires on. Leave empty to match every data point.",
          fieldType: FormFieldSchemaType.CustomComponent,
          required: false,
          customValidation: (values: FormValues<MetricPipelineRule>) => {
            return MetricPipelineRuleFilterConditionUtil.getValidationError(
              values.filters as Array<MetricPipelineRuleFilterCondition>,
            );
          },
          getCustomElement: (
            values: FormValues<MetricPipelineRule>,
            elementProps: CustomElementProps,
          ): ReactElement => {
            return (
              <MetricPipelineRuleFilters
                value={
                  values.filters as
                    | Array<MetricPipelineRuleFilterCondition>
                    | undefined
                }
                onChange={(next: Array<MetricPipelineRuleFilterCondition>) => {
                  elementProps.onChange?.(next);
                }}
              />
            );
          },
        },
        /*
         * Only once there are two filters to combine: with one or none, All
         * and Any match the same data points. Hidden, it keeps its default
         * (All), which the rule is saved with.
         */
        {
          field: { filterCondition: true },
          title: "Filter Condition",
          stepId: "match",
          description:
            "How to combine the filters above. 'All' requires every filter to match (AND). 'Any' requires at least one filter to match (OR).",
          fieldType: FormFieldSchemaType.RadioButton,
          required: true,
          defaultValue: FilterCondition.All,
          radioButtonOptions: [
            { title: "All", value: FilterCondition.All },
            { title: "Any", value: FilterCondition.Any },
          ],
          showIf: (values: FormValues<MetricPipelineRule>): boolean => {
            return isFilterConditionNeeded(values.filters);
          },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "match",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this rule does and why it's needed.",
          collapsibleSection: pipelineRuleMoreFields,
        },
        {
          field: { service: true },
          title: "Only for one service",
          stepId: "match",
          description:
            "Leave empty for a rule that applies to every service. Rules for one service run before the project-wide ones.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: false,
          dropdownModal: {
            type: Service,
            labelField: "name",
            valueField: "_id",
          },
          collapsibleSection: pipelineRuleMoreFields,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description: "Whether this rule is active.",
          stepId: "match",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          defaultValue: true,
          collapsibleSection: pipelineRuleMoreFields,
        },
        {
          field: { ruleType: true },
          title: "Rule Type",
          description:
            "Pick the action this rule will perform when a metric data point matches the criteria above.",
          stepId: "action",
          fieldType: FormFieldSchemaType.CardSelect,
          required: true,
          cardSelectOptions: ruleTypeCardOptions,
          cardSelectSingleColumn: true,
        },
        {
          field: { renameFromKey: true },
          title: "Rename From",
          stepId: "action",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          showIf: (values: FormValues<MetricPipelineRule>): boolean => {
            return (
              values.ruleType === MetricPipelineRuleType.RenameMetric ||
              values.ruleType === MetricPipelineRuleType.RenameAttribute
            );
          },
        },
        {
          field: { renameToKey: true },
          title: "Rename To",
          stepId: "action",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          showIf: (values: FormValues<MetricPipelineRule>): boolean => {
            return (
              values.ruleType === MetricPipelineRuleType.RenameMetric ||
              values.ruleType === MetricPipelineRuleType.RenameAttribute
            );
          },
        },
        {
          field: { addAttributeKey: true },
          title: "Attribute Key",
          stepId: "action",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          showIf: (values: FormValues<MetricPipelineRule>): boolean => {
            return (
              values.ruleType === MetricPipelineRuleType.AddAttribute ||
              values.ruleType === MetricPipelineRuleType.RemoveAttribute ||
              values.ruleType === MetricPipelineRuleType.RedactAttribute
            );
          },
        },
        {
          field: { addAttributeValue: true },
          title: "Attribute Value",
          stepId: "action",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          showIf: (values: FormValues<MetricPipelineRule>): boolean => {
            return values.ruleType === MetricPipelineRuleType.AddAttribute;
          },
        },
        {
          field: { redactReplacement: true },
          title: "Redact Replacement",
          stepId: "action",
          description: "Literal string to use in place of the original value.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "[REDACTED]",
          showIf: (values: FormValues<MetricPipelineRule>): boolean => {
            return values.ruleType === MetricPipelineRuleType.RedactAttribute;
          },
        },
        {
          field: { samplePercentage: true },
          title: "Sample Percentage (% to keep)",
          stepId: "action",
          description: "0 drops everything, 100 keeps everything.",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "10",
          showIf: (values: FormValues<MetricPipelineRule>): boolean => {
            return values.ruleType === MetricPipelineRuleType.Sample;
          },
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
          field: { ruleType: true },
          type: FieldType.Text,
          title: "Rule Type",
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
          getElement: (item: MetricPipelineRule): ReactElement => {
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
          field: { ruleType: true },
          title: "Rule Type",
          type: FieldType.Element,
          getElement: (item: MetricPipelineRule): ReactElement => {
            const key: string = (item.ruleType as string) || "unknown";
            const config: PillConfig = ruleTypeConfig[key] || {
              label: key,
              color: Gray500,
              icon: IconProp.Filter,
              tooltip: key,
            };
            return (
              <Pill
                text={config.label}
                color={config.color}
                tooltip={config.tooltip}
                isMinimal={true}
              />
            );
          },
        },
        {
          field: { service: { name: true } },
          title: "Scope",
          type: FieldType.Element,
          getElement: (item: MetricPipelineRule): ReactElement => {
            if (item.service?.name) {
              return (
                <span className="inline-flex items-center text-sm font-medium text-gray-900">
                  <span className="text-gray-400 mr-1">
                    {translator.translateText("Service:")}
                  </span>
                  {item.service.name}
                </span>
              );
            }
            return (
              <span className="text-sm text-gray-500">
                {translator.translateText("Project-wide")}
              </span>
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

export default MetricPipelineRules;
