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
 * Action is the only other required answer and it has its default, so Next
 * on Match walks to Action without asking for anything there; the filter
 * is created from Action, the last step (Forms/Utils/SteppedFormFooter).
 *
 * Action is a choice of two answers, each saying in one line what it does
 * ("Shouldnt this be two buttons ...", the maintainer, on a setting whose
 * one description explained both of its modes). It was a dropdown under
 * "Drop permanently discards matching logs. Sample keeps a percentage of
 * them.", and a filter's own page asked again with a dropdown of its own
 * whose answers read "Drop — Discard all matching logs", beside a Sample
 * Percentage box shown for Drop too. Both now take getDropFilterActionFields.
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
  // The one line under each answer of Action.
  dropChoiceHelp: string;
  sampleChoiceHelp: string;
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
  dropChoiceHelp: translationKey("Discards every matching log for good."),
  sampleChoiceHelp: translationKey(
    "Keeps a share of the matching logs and discards the rest.",
  ),
  samplePercentageHelp: translationKey(
    "The share of matching logs to keep, from 1 to 99. 10 keeps one in ten.",
  ),
  defaultsSummary: LOG_DROP_FILTER_DEFAULTS_SUMMARY,
};

export const TRACE_DROP_FILTER_FORM_OPTIONS: DropFilterFormOptions = {
  filterConfig: TraceFilterConfig,
  namePlaceholder: translationKey("e.g. Drop Healthcheck Spans"),
  filterQueryHelp: translationKey(
    "Which spans this filter applies to. Build rules with fields like span name, kind, status, service, or custom attributes.",
  ),
  dropChoiceHelp: translationKey("Discards every matching span for good."),
  sampleChoiceHelp: translationKey(
    "Keeps a share of the matching spans and discards the rest.",
  ),
  samplePercentageHelp: translationKey(
    "The share of matching spans to keep, from 1 to 99. 10 keeps one in ten.",
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
 * What a filter does with what it matches: Drop or Sample, and - only for
 * Sample - the share to keep. Asked by the create form, on its Action step,
 * and by a filter's own page, whose Action card edits them; written once,
 * so the two can never offer different answers again.
 *
 * The percentage is required, but only while Sample is picked: the form
 * skips hidden fields when it validates. Leaving it optional let a sample
 * filter be saved with no percentage, which the engine used to read as
 * "throw away half".
 */
export const getDropFilterActionFields: (
  options: DropFilterFormOptions,
) => Array<ModelField<LogDropFilter>> = (
  options: DropFilterFormOptions,
): Array<ModelField<LogDropFilter>> => {
  return [
    {
      field: {
        action: true,
      },
      title: "Action",
      stepId: "action",
      fieldType: FormFieldSchemaType.RadioButton,
      required: true,
      // Each answer says what it does; the column's sentence would repeat it.
      hideColumnDescription: true,
      dataTestId: "drop-filter-action",
      radioButtonOptions: [
        {
          title: "Drop",
          value: LogDropFilterAction.Drop,
          description: options.dropChoiceHelp,
        },
        {
          title: "Sample",
          value: LogDropFilterAction.Sample,
          description: options.sampleChoiceHelp,
        },
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
  ];
};

/*
 * The same two fields for a filter's own page, whose Action card is a form
 * of its own with no steps: a field naming a step would be shown on none.
 */
const withoutStep: (
  fields: Array<ModelField<LogDropFilter>>,
) => Array<ModelField<LogDropFilter>> = (
  fields: Array<ModelField<LogDropFilter>>,
): Array<ModelField<LogDropFilter>> => {
  return fields.map(
    (field: ModelField<LogDropFilter>): ModelField<LogDropFilter> => {
      const copy: ModelField<LogDropFilter> = { ...field };
      delete copy.stepId;
      return copy;
    },
  );
};

export const getLogDropFilterActionFields: () => Array<
  ModelField<LogDropFilter>
> = (): Array<ModelField<LogDropFilter>> => {
  return withoutStep(getDropFilterActionFields(LOG_DROP_FILTER_FORM_OPTIONS));
};

export const getTraceDropFilterActionFields: () => Array<
  ModelField<TraceDropFilter>
> = (): Array<ModelField<TraceDropFilter>> => {
  return withoutStep(
    getDropFilterActionFields(TRACE_DROP_FILTER_FORM_OPTIONS),
  ) as unknown as Array<ModelField<TraceDropFilter>>;
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
    ...getDropFilterActionFields(options),
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
