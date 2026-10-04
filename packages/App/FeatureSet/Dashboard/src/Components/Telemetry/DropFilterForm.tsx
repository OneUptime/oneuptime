import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import {
  MAX_SAMPLE_PERCENTAGE,
  MIN_SAMPLE_PERCENTAGE,
} from "Common/Types/Telemetry/DropFilterSampling";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  getAdvancedFormSection,
  normalizeFormValue,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import FilterQueryBuilderField from "../FilterQueryBuilder/FilterQueryBuilderField";
import LogFilterConfig from "../FilterQueryBuilder/LogFilterConfig";
import TraceFilterConfig from "../FilterQueryBuilder/TraceFilterConfig";
import { FilterBuilderConfig } from "../FilterQueryBuilder/Types";
import React, { ReactElement } from "react";

/*
 * CREATE A LOG OR TRACE DROP FILTER: WHICH RECORDS, THEN WHAT HAPPENS TO
 * THEM.
 *
 * Logs > Settings > Drop Filters and Traces > Settings > Drop Filters build
 * their create form here. It used to open on a "Basic Info" step holding
 * only a name, a description and an Enabled switch, and asked what the
 * filter does on the two steps after it. Two steps now, both about the rule:
 *
 *   - Match: the filter's name and the query that picks the records.
 *   - Action: Drop, picked already, or Sample - and the percentage to keep,
 *     only for Sample. Then the description and Enabled, folded under
 *     Advanced: Enabled starts on, as the server stores a filter created
 *     without it, and the folded header says when the filter starts
 *     working; switched off - to stage a filter before it drops anything -
 *     the header says "Configured".
 *
 * Action is the only other required answer and it has its default, so the
 * filter can be created from Match (Forms/Utils/FinishFromAnyStep); Next
 * walks on to Action for Sample.
 */

export const LOG_DROP_FILTER_DEFAULTS_SUMMARY: string = translationKey(
  "The filter applies to new logs within a minute of being created.",
);

export const TRACE_DROP_FILTER_DEFAULTS_SUMMARY: string = translationKey(
  "The filter applies to new spans within a minute of being created.",
);

export interface DropFilterFormOptions {
  filterConfig: FilterBuilderConfig;
  namePlaceholder: string;
  filterQueryHelp: string;
  actionHelp: string;
  samplePercentageHelp: string;
  // What the folded section says while Enabled is on and nothing is typed.
  defaultsSummary: string;
}

export const LOG_DROP_FILTER_FORM_OPTIONS: DropFilterFormOptions = {
  filterConfig: LogFilterConfig,
  namePlaceholder: translationKey("e.g. Drop Debug Logs"),
  filterQueryHelp: translationKey(
    "Which logs this filter applies to. Build rules with fields like severity, body, service, or custom attributes.",
  ),
  actionHelp: translationKey(
    "Drop permanently discards matching logs. Sample keeps a percentage of them.",
  ),
  samplePercentageHelp: translationKey(
    "Required when Action is Sample. Percentage of matching logs to keep, between 1 and 99 (e.g. 10 = keep 10%, discard 90%).",
  ),
  defaultsSummary: LOG_DROP_FILTER_DEFAULTS_SUMMARY,
};

export const TRACE_DROP_FILTER_FORM_OPTIONS: DropFilterFormOptions = {
  filterConfig: TraceFilterConfig,
  namePlaceholder: translationKey("e.g. Drop Healthcheck Spans"),
  filterQueryHelp: translationKey(
    "Which spans this filter applies to. Build rules with fields like span name, kind, status, service, or custom attributes.",
  ),
  actionHelp: translationKey(
    "Drop permanently discards matching spans. Sample keeps a percentage of them.",
  ),
  samplePercentageHelp: translationKey(
    "Required when Action is Sample. Percentage of matching spans to keep, between 1 and 99 (e.g. 10 = keep 10%, discard 90%).",
  ),
  defaultsSummary: TRACE_DROP_FILTER_DEFAULTS_SUMMARY,
};

/**
 * What the folded Advanced section says while it is left alone: when the
 * filter starts working. Nothing once Enabled is switched off or a
 * description is typed - the header then says "Configured".
 */
export const getDropFilterAdvancedSummary: (
  options: DropFilterFormOptions,
  values: FormValues<LogDropFilter>,
) => Array<string> | undefined = (
  options: DropFilterFormOptions,
  values: FormValues<LogDropFilter>,
): Array<string> | undefined => {
  const formValues: Record<string, unknown> = (values || {}) as Record<
    string,
    unknown
  >;
  const description: unknown = formValues["description"];
  const isEnabled: unknown = normalizeFormValue(formValues["isEnabled"]);

  const isAtDefaults: boolean =
    (typeof description !== "string" || description.trim().length === 0) &&
    (isEnabled === undefined || isEnabled === null || isEnabled === true);

  return isAtDefaults ? [options.defaultsSummary] : undefined;
};

export const getDropFilterFormSteps: <
  TFilter extends LogDropFilter | TraceDropFilter,
>() => Array<FormStep<TFilter>> = <
  TFilter extends LogDropFilter | TraceDropFilter,
>(): Array<FormStep<TFilter>> => {
  /*
   * The ids are written out here and on every field, so the form scan
   * (Tests/Helpers/FormStepsScan) can tell which step each field is on.
   */
  return [
    { title: "Match", id: "match" },
    { title: "Action", id: "action" },
  ];
};

/*
 * The fields of both pages' forms, written once over LogDropFilter: a trace
 * drop filter has the same columns (TraceDropFilter), so the trace page takes
 * the same list with the trace filter builder (getTraceDropFilterFormFields).
 */
const getDropFilterFormFields: (
  options: DropFilterFormOptions,
) => Array<ModelField<LogDropFilter>> = (
  options: DropFilterFormOptions,
): Array<ModelField<LogDropFilter>> => {
  const advanced: FormFieldCollapsibleSection<LogDropFilter> =
    getAdvancedFormSection<LogDropFilter>({
      getSummary: (
        values: FormValues<LogDropFilter>,
      ): Array<string> | undefined => {
        return getDropFilterAdvancedSummary(options, values);
      },
    });

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      stepId: "match",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: options.namePlaceholder,
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        filterQuery: true,
      },
      title: "Filter Query",
      stepId: "match",
      description: options.filterQueryHelp,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      getCustomElement: (
        values: FormValues<LogDropFilter>,
        fieldProps: CustomElementProps,
      ): ReactElement => {
        return (
          <FilterQueryBuilderField
            initialValue={(values.filterQuery as string) || ""}
            onChange={(value: string) => {
              if (fieldProps.onChange) {
                fieldProps.onChange(value);
              }
            }}
            error={fieldProps.error}
            config={options.filterConfig}
          />
        );
      },
    },
    {
      field: {
        action: true,
      },
      title: "Action",
      stepId: "action",
      description: options.actionHelp,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      dropdownOptions: [
        { label: "Drop", value: LogDropFilterAction.Drop },
        { label: "Sample", value: LogDropFilterAction.Sample },
      ],
    },
    {
      field: {
        samplePercentage: true,
      },
      title: "Sample Percentage",
      stepId: "action",
      description: options.samplePercentageHelp,
      fieldType: FormFieldSchemaType.Number,
      /*
       * Required, but only while the Sample action is selected - the form
       * skips validation for fields hidden by showIf. Leaving this optional
       * let a sample filter be saved with no percentage, which the engine
       * used to read as "throw away half".
       */
      required: true,
      validation: {
        minValue: MIN_SAMPLE_PERCENTAGE,
        maxValue: MAX_SAMPLE_PERCENTAGE,
      },
      placeholder: "e.g. 10",
      showIf: (values: FormValues<LogDropFilter>): boolean => {
        return normalizeFormValue(values.action) === LogDropFilterAction.Sample;
      },
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "action",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Describe what this filter does.",
      collapsibleSection: advanced,
    },
    {
      field: {
        isEnabled: true,
      },
      title: "Enabled",
      stepId: "action",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      collapsibleSection: advanced,
    },
  ];
};

export const getLogDropFilterFormFields: () => Array<
  ModelField<LogDropFilter>
> = (): Array<ModelField<LogDropFilter>> => {
  return getDropFilterFormFields(LOG_DROP_FILTER_FORM_OPTIONS);
};

export const getTraceDropFilterFormFields: () => Array<
  ModelField<TraceDropFilter>
> = (): Array<ModelField<TraceDropFilter>> => {
  return getDropFilterFormFields(
    TRACE_DROP_FILTER_FORM_OPTIONS,
  ) as unknown as Array<ModelField<TraceDropFilter>>;
};
