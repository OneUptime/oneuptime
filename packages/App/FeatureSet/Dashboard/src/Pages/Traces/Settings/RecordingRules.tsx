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
import TraceRecordingRule from "Common/Models/DatabaseModels/TraceRecordingRule";
import { getOutputMetricNameFromRuleName } from "Common/Types/Metrics/RecordingRuleOutputMetricName";
import { getRecordingRuleAdvancedSummary } from "../../../Components/Metrics/RecordingRule/RecordingRuleForm";
import TraceRecordingRuleDefinition, {
  TraceRecordingRuleDefinitionUtil,
} from "Common/Types/Trace/TraceRecordingRuleDefinition";
import TraceRecordingRuleDefinitionEditor from "../../../Components/Traces/RecordingRule/TraceRecordingRuleDefinitionEditor";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const documentationMarkdown: string = `
A trace recording rule turns spans into a metric, one point a minute, such as an error rate or a p95 duration. Chart it, put it on a dashboard, or alert on it, like any other metric.

## Set Up a Rule

- **Span Sources**: up to 4 span aggregations, each with a letter (A, B, C, D) and what it counts: \`Count\` of matching spans, \`ErrorCount\` of spans whose status is Error, or the \`Avg\`, \`p50\`, \`p95\`, \`p99\`, \`Max\` or \`Min\` duration in seconds. Each can be narrowed to a span name pattern, a span kind, errors only, or an attribute's value.
- **Expression**: arithmetic over the letters, with \`+ - * /\`, parentheses and numbers, such as \`A / B * 100\`.
- **Group By**: an attribute key, such as \`service.name\`, for one point per value of it.

The metric's name is made from the rule's name ("HTTP error rate" writes \`http_error_rate\`), unless you select **Edit** beside it and type your own.

## When Points Are Written

Every minute, each enabled rule is worked out for the minute before. A result that is not a number, such as a division by zero or a missing source, writes nothing, so a chart shows a gap rather than a wrong value.

## How Points Are Labelled

Every point carries \`oneuptime.derived.trace_rule_id\` with the rule's ID, and its group-by value when it has one.
`;

/*
 * One page, as a metric recording rule's: the rule's name - the output metric
 * line under it is made from the name, not asked for - and its definition,
 * with the description and Enabled (on) folded under More fields
 * (Components/Metrics/RecordingRule/RecordingRuleForm says why).
 */
const traceRecordingRuleMoreFields: FormFieldCollapsibleSection<TraceRecordingRule> =
  getAdvancedFormSection<TraceRecordingRule>({
    getSummary: getRecordingRuleAdvancedSummary,
  });

const TraceRecordingRules: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * "Create metric…" in the traces analytics view deep-links here with a
   * `?prefill=<json definition>` param — open the create form with the
   * analysis (filters + aggregation + group-by) already filled in.
   */
  const prefillDefinition: TraceRecordingRuleDefinition | undefined =
    useMemo(() => {
      const raw: string | null = new URLSearchParams(
        window.location.search,
      ).get("prefill");
      if (!raw) {
        return undefined;
      }
      const candidates: Array<string> = [raw];
      try {
        candidates.push(decodeURIComponent(raw));
      } catch {
        // raw is not percent-encoded — fine.
      }
      /*
       * Deep shape validation — the param is attacker-controllable (a
       * shareable link), so rebuild the definition from validated parts
       * rather than trusting the parsed object. Anything malformed is
       * dropped; an unusable result falls back to the empty definition.
       */
      for (const candidate of candidates) {
        try {
          const parsed: unknown = JSON.parse(candidate);
          if (
            !parsed ||
            typeof parsed !== "object" ||
            !Array.isArray((parsed as TraceRecordingRuleDefinition).sources) ||
            typeof (parsed as TraceRecordingRuleDefinition).expression !==
              "string"
          ) {
            continue;
          }
          const rawDefinition: TraceRecordingRuleDefinition =
            parsed as TraceRecordingRuleDefinition;

          const sources: TraceRecordingRuleDefinition["sources"] =
            rawDefinition.sources
              .filter((source: unknown): boolean => {
                return (
                  Boolean(source) &&
                  typeof source === "object" &&
                  typeof (source as { alias?: unknown }).alias === "string" &&
                  typeof (source as { aggregationType?: unknown })
                    .aggregationType === "string"
                );
              })
              .map(
                (
                  source: TraceRecordingRuleDefinition["sources"][0],
                ): TraceRecordingRuleDefinition["sources"][0] => {
                  return {
                    alias: source.alias,
                    aggregationType: source.aggregationType,
                    ...(typeof source.spanNameRegex === "string"
                      ? { spanNameRegex: source.spanNameRegex }
                      : {}),
                    ...(typeof source.spanKind === "string"
                      ? { spanKind: source.spanKind }
                      : {}),
                    ...(source.onlyErrors === true ? { onlyErrors: true } : {}),
                    ...(Array.isArray(source.filterAttributes)
                      ? {
                          filterAttributes: source.filterAttributes.filter(
                            (filter: unknown): boolean => {
                              return (
                                Boolean(filter) &&
                                typeof filter === "object" &&
                                typeof (filter as { key?: unknown }).key ===
                                  "string" &&
                                typeof (filter as { value?: unknown }).value ===
                                  "string"
                              );
                            },
                          ),
                        }
                      : {}),
                  };
                },
              );

          if (sources.length === 0) {
            continue;
          }

          return {
            sources,
            expression: rawDefinition.expression,
            groupByAttribute:
              typeof rawDefinition.groupByAttribute === "string"
                ? rawDefinition.groupByAttribute
                : "",
          };
        } catch {
          // try next candidate
        }
      }
      return undefined;
    }, []);

  return (
    <ModelTable<TraceRecordingRule>
      modelType={TraceRecordingRule}
      // Enable or Disable in each row's ⋯ menu: the one that changes the row.
      rowSwitch={{ column: "isEnabled" }}
      showCreateForm={Boolean(prefillDefinition)}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="trace-recording-rules-table"
      name="Traces > Settings > Recording Rules"
      userPreferencesKey="trace-recording-rules-table"
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
        definition:
          prefillDefinition ??
          TraceRecordingRuleDefinitionUtil.getEmptyDefinition(),
      }}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. HTTP error rate (from spans)",
          validation: { minLength: 2 },
        },
        /*
         * On Create, made from the rule's name as it is typed (and by the
         * server when the create leaves it out); never asked for. Right
         * under the name it is made from.
         */
        getGeneratedKeyFormField<TraceRecordingRule>({
          field: { outputMetricName: true },
          nameField: "name",
          title: "Output Metric Name",
          makeKey: getOutputMetricNameFromRuleName,
          placeholder: "e.g. http.server.error_rate",
          description:
            "Name of the new derived metric. Must be unique per project.",
        }),
        // On Edit, a rule's output metric can still be renamed.
        {
          field: { outputMetricName: true },
          title: "Output Metric Name",
          description:
            "Name of the new derived metric. Must be unique per project.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. http.server.error_rate",
          doNotShowWhenCreating: true,
        },
        {
          field: { definition: true },
          title: "Definition",
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
        {
          field: { description: true },
          title: "Description",
          description: "What this rule computes and why.",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "What this rule computes and why.",
          collapsibleSection: traceRecordingRuleMoreFields,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          description:
            "Only enabled rules are evaluated each minute. You can pause a rule any time.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          collapsibleSection: traceRecordingRuleMoreFields,
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
