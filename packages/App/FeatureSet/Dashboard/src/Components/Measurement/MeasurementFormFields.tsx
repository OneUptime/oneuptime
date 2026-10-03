import MeasurementPresetPicker from "./MeasurementPresetPicker";
import {
  DEFAULT_MEASUREMENT_CHART_SUMMARY,
  DEFAULT_MEASUREMENT_OCCURRENCE,
  DEFAULT_MEASUREMENT_UNIT_VALUE,
  MEASUREMENT_CHART_SUMMARY_OPTIONS,
  MEASUREMENT_FORM_COPY,
  MEASUREMENT_OCCURRENCE_OPTIONS,
  MEASUREMENT_PRESET_FIELD_KEY,
  MEASUREMENT_UNIT_OPTIONS,
  MeasurementEnd,
  MeasurementEndFields,
  MeasurementForm,
  MeasurementOption,
  MeasurementValues,
  getDefaultMeasurementStartAnchorType,
  getMeasurementChartQueryParams,
  getMeasurementEndFields,
  getMeasurementMomentFormValue,
  getValuesForMeasurementMoment,
  getValuesForMeasurementPreset,
} from "../../Utils/Measurement/MeasurementSetup";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dictionary from "Common/Types/Dictionary";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateTemplate } from "Common/UI/Utils/TranslateTemplate";
import Navigation from "Common/UI/Utils/Navigation";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import {
  MeasurementMoment,
  canMeasurementMomentRepeat,
  getMeasurementMoments,
  isPickedStateMeasurementMoment,
} from "Common/Utils/Measurement/MeasurementMoments";
import React, { ReactElement } from "react";

/*
 * The fields the Incident, Alert and Scheduled Maintenance Measurements
 * forms share (see Utils/Measurement/MeasurementSetup for what they replace
 * and why). The ready-made measurements and the two moments are form-only:
 * what they change is written into the measurement's own columns, which are
 * registered below (getMeasurementColumnFormFields) so the form loads and
 * saves them.
 *
 * Each page writes every step id and Advanced section in its own calls, so
 * the form step guards (Common/Tests/Helpers/FormStepsScan.ts) can place
 * each field.
 */

type AsValuesFunction = <TModel extends BaseModel>(
  values: FormValues<TModel>,
) => MeasurementValues;

const asValues: AsValuesFunction = <TModel extends BaseModel>(
  values: FormValues<TModel>,
): MeasurementValues => {
  return (values || {}) as unknown as MeasurementValues;
};

type ColumnFunction = <TModel extends BaseModel>(
  column: string,
) => SelectFormFields<TModel>;

const column: ColumnFunction = <TModel extends BaseModel>(
  name: string,
): SelectFormFields<TModel> => {
  return { [name]: true } as unknown as SelectFormFields<TModel>;
};

// The form's callbacks run outside React, so they translate through i18next.
const translateMeasurementText: (text: string) => string = (
  text: string,
): string => {
  return translateTemplate(text);
};

type ToDropdownOptionsFunction = (
  options: Array<MeasurementOption>,
) => Array<DropdownOption>;

// Dropdown translates an option's label and description itself.
const toDropdownOptions: ToDropdownOptionsFunction = (
  options: Array<MeasurementOption>,
): Array<DropdownOption> => {
  return options.map((option: MeasurementOption): DropdownOption => {
    const dropdownOption: DropdownOption = {
      value: option.value,
      label: option.label,
    };

    if (option.description) {
      dropdownOption.description = option.description;
    }

    if (option.aliases && option.aliases.length > 0) {
      dropdownOption.aliases = option.aliases;
    }

    return dropdownOption;
  });
};

/*
 * "What do you want to measure?" - the ready-made measurements. Picking one
 * fills in the name, the description and both moments.
 */
export const getMeasurementPresetFormField: <
  TModel extends BaseModel,
>(options: {
  form: MeasurementForm;
  stepId: string;
  title: string;
  description: string;
  doNotShowWhenEditing: boolean;
}) => ModelField<TModel> = <TModel extends BaseModel>(options: {
  form: MeasurementForm;
  stepId: string;
  title: string;
  description: string;
  doNotShowWhenEditing: boolean;
}): ModelField<TModel> => {
  return {
    // A preset sets the two ends: shown to whoever may set them.
    overrideField: {
      [options.form.start.anchorType]: true,
    },
    overrideFieldKey: MEASUREMENT_PRESET_FIELD_KEY,
    formOnly: true,
    title: options.title,
    description: options.description,
    stepId: options.stepId,
    doNotShowWhenEditing: options.doNotShowWhenEditing,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    spanFullRow: true,
    dataTestId: "measurement-preset",
    onChange: (
      value: unknown,
      currentValues: FormValues<TModel>,
      setNewFormValues: (values: FormValues<TModel>) => void,
    ): void => {
      setNewFormValues(
        getValuesForMeasurementPreset({
          form: options.form,
          values: asValues(currentValues),
          presetId: typeof value === "string" ? value : undefined,
          translate: translateMeasurementText,
        }) as FormValues<TModel>,
      );
    },
    getCustomElement: (
      values: FormValues<TModel>,
      props: CustomElementProps,
    ): ReactElement => {
      const picked: unknown = asValues(values)[MEASUREMENT_PRESET_FIELD_KEY];

      return (
        <MeasurementPresetPicker
          domain={options.form.domain}
          value={typeof picked === "string" ? picked : ""}
          error={props.error}
          ariaLabelledby={props.ariaLabelledby}
          onChange={(presetId: string): void => {
            props.onChange?.(presetId);
          }}
        />
      );
    },
  };
};

/*
 * "Starts when" or "Ends when": one list of moments in plain words. The
 * moment is saved as the anchor type and, for a state role, the role.
 */
export const getMeasurementMomentFormField: <
  TModel extends BaseModel,
>(options: {
  form: MeasurementForm;
  end: MeasurementEnd;
  stepId: string;
  title: string;
  description: string;
}) => ModelField<TModel> = <TModel extends BaseModel>(options: {
  form: MeasurementForm;
  end: MeasurementEnd;
  stepId: string;
  title: string;
  description: string;
}): ModelField<TModel> => {
  const fields: MeasurementEndFields = getMeasurementEndFields(
    options.form,
    options.end,
  );

  return {
    overrideField: {
      [fields.anchorType]: true,
    },
    overrideFieldKey: fields.moment,
    formOnly: true,
    title: options.title,
    description: options.description,
    stepId: options.stepId,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: getMeasurementMoments(options.form.domain).map(
      (moment: MeasurementMoment): DropdownOption => {
        return {
          value: moment.value,
          label: moment.label,
          description: moment.description,
        };
      },
    ),
    required: true,
    placeholder: MEASUREMENT_FORM_COPY.momentPlaceholder,
    dataTestId: `measurement-${options.end}-moment`,
    getDefaultValue: (values: FormValues<TModel>): string => {
      return (
        getMeasurementMomentFormValue({
          form: options.form,
          end: options.end,
          values: asValues(values),
        }) || ""
      );
    },
    onChange: (
      value: unknown,
      currentValues: FormValues<TModel>,
      setNewFormValues: (values: FormValues<TModel>) => void,
    ): void => {
      setNewFormValues(
        getValuesForMeasurementMoment({
          form: options.form,
          end: options.end,
          values: asValues(currentValues),
          moment: typeof value === "string" ? value : undefined,
        }) as FormValues<TModel>,
      );
    },
  };
};

type IsMomentFunction = <TModel extends BaseModel>(data: {
  form: MeasurementForm;
  end: MeasurementEnd;
  values: FormValues<TModel>;
}) => boolean;

const isPickedState: IsMomentFunction = <TModel extends BaseModel>(data: {
  form: MeasurementForm;
  end: MeasurementEnd;
  values: FormValues<TModel>;
}): boolean => {
  return isPickedStateMeasurementMoment({
    domain: data.form.domain,
    value: getMeasurementMomentFormValue({
      form: data.form,
      end: data.end,
      values: asValues(data.values),
    }),
  });
};

/*
 * The state an end is pinned to, asked for only when the moment is "a
 * state you pick". Listed in the order the project's states run, with their
 * colours.
 */
export const getMeasurementStateFormField: <TModel extends BaseModel>(options: {
  form: MeasurementForm;
  end: MeasurementEnd;
  stepId: string;
  title: string;
  description: string;
}) => ModelField<TModel> = <TModel extends BaseModel>(options: {
  form: MeasurementForm;
  end: MeasurementEnd;
  stepId: string;
  title: string;
  description: string;
}): ModelField<TModel> => {
  const fields: MeasurementEndFields = getMeasurementEndFields(
    options.form,
    options.end,
  );

  return {
    field: column<TModel>(fields.state),
    title: options.title,
    description: options.description,
    stepId: options.stepId,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: options.form.stateModel,
      labelField: "name",
      valueField: "_id",
      sort: { order: SortOrder.Ascending },
    },
    required: (values: FormValues<TModel>): boolean => {
      return isPickedState<TModel>({
        form: options.form,
        end: options.end,
        values,
      });
    },
    placeholder: MEASUREMENT_FORM_COPY.statePlaceholder,
    dataTestId: `measurement-${options.end}-state`,
    showIf: (values: FormValues<TModel>): boolean => {
      return isPickedState<TModel>({
        form: options.form,
        end: options.end,
        values,
      });
    },
  };
};

/*
 * Whether the first or the last time a state is reached counts - only a
 * question for an end that is reaching a state, which a reopened incident
 * can do twice. First, as the server defaults to.
 */
export const getMeasurementOccurrenceFormField: <
  TModel extends BaseModel,
>(options: {
  form: MeasurementForm;
  end: MeasurementEnd;
  stepId: string;
  title: string;
  description: string;
  collapsibleSection: FormFieldCollapsibleSection<TModel>;
}) => ModelField<TModel> = <TModel extends BaseModel>(options: {
  form: MeasurementForm;
  end: MeasurementEnd;
  stepId: string;
  title: string;
  description: string;
  collapsibleSection: FormFieldCollapsibleSection<TModel>;
}): ModelField<TModel> => {
  const fields: MeasurementEndFields = getMeasurementEndFields(
    options.form,
    options.end,
  );

  return {
    field: column<TModel>(fields.occurrence),
    title: options.title,
    description: options.description,
    stepId: options.stepId,
    collapsibleSection: options.collapsibleSection,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: toDropdownOptions(MEASUREMENT_OCCURRENCE_OPTIONS),
    defaultValue: DEFAULT_MEASUREMENT_OCCURRENCE,
    required: false,
    hideOptionalLabel: true,
    dataTestId: `measurement-${options.end}-occurrence`,
    showIf: (values: FormValues<TModel>): boolean => {
      return canMeasurementMomentRepeat({
        domain: options.form.domain,
        value: getMeasurementMomentFormValue({
          form: options.form,
          end: options.end,
          values: asValues(values),
        }),
      });
    },
  };
};

// "Show durations in": the unit charts use. Automatic (seconds) by default.
export const getMeasurementUnitFormField: <TModel extends BaseModel>(options: {
  stepId: string;
  collapsibleSection: FormFieldCollapsibleSection<TModel>;
}) => ModelField<TModel> = <TModel extends BaseModel>(options: {
  stepId: string;
  collapsibleSection: FormFieldCollapsibleSection<TModel>;
}): ModelField<TModel> => {
  return {
    field: column<TModel>("unit"),
    title: MEASUREMENT_FORM_COPY.unitTitle,
    description: MEASUREMENT_FORM_COPY.unitDescription,
    stepId: options.stepId,
    collapsibleSection: options.collapsibleSection,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: toDropdownOptions(MEASUREMENT_UNIT_OPTIONS),
    defaultValue: DEFAULT_MEASUREMENT_UNIT_VALUE,
    required: false,
    hideOptionalLabel: true,
    dataTestId: "measurement-unit",
  };
};

/*
 * "Chart summary": how View Chart sums up many incidents. Average by
 * default; never Sum, which would add durations up into a number that
 * means nothing.
 */
export const getMeasurementChartSummaryFormField: <
  TModel extends BaseModel,
>(options: {
  stepId: string;
  description: string;
  collapsibleSection: FormFieldCollapsibleSection<TModel>;
}) => ModelField<TModel> = <TModel extends BaseModel>(options: {
  stepId: string;
  description: string;
  collapsibleSection: FormFieldCollapsibleSection<TModel>;
}): ModelField<TModel> => {
  return {
    field: column<TModel>("aggregationType"),
    title: MEASUREMENT_FORM_COPY.chartSummaryTitle,
    description: options.description,
    stepId: options.stepId,
    collapsibleSection: options.collapsibleSection,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: toDropdownOptions(MEASUREMENT_CHART_SUMMARY_OPTIONS),
    defaultValue: DEFAULT_MEASUREMENT_CHART_SUMMARY,
    required: false,
    hideOptionalLabel: true,
    dataTestId: "measurement-chart-summary",
  };
};

/*
 * The columns the moments are saved in, registered so the form loads and
 * saves them; never shown. A new measurement starts where most do.
 */
export const getMeasurementColumnFormFields: <TModel extends BaseModel>(
  form: MeasurementForm,
) => Array<ModelField<TModel>> = <TModel extends BaseModel>(
  form: MeasurementForm,
): Array<ModelField<TModel>> => {
  return [
    {
      field: column<TModel>(form.start.anchorType),
      title: "Start Anchor Type",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      defaultValue: getDefaultMeasurementStartAnchorType(form),
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: column<TModel>(form.start.stateRole),
      title: "Start State Role",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: column<TModel>(form.end.anchorType),
      title: "End Anchor Type",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: column<TModel>(form.end.stateRole),
      title: "End State Role",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
  ];
};

/**
 * The metric explorer, open on one measurement's chart.
 */
export const getMeasurementChartRoute: (data: {
  metricName: string;
  name?: string | null | undefined;
  aggregationType?: string | null | undefined;
}) => Route = (data: {
  metricName: string;
  name?: string | null | undefined;
  aggregationType?: string | null | undefined;
}): Route => {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.METRIC_VIEW] as Route,
  );

  const params: Dictionary<string> = getMeasurementChartQueryParams(data);

  const query: string = Object.keys(params)
    .map((name: string): string => {
      return `${encodeURIComponent(name)}=${encodeURIComponent(
        params[name] as string,
      )}`;
    })
    .join("&");

  return new Route(`${route.toString()}?${query}`);
};

interface ChartableMeasurement {
  name?: string | undefined;
  metricName?: string | undefined;
  aggregationType?: string | undefined;
}

/*
 * View Chart, on every measurement in the list: where its numbers are. The
 * first action of the row, so it is the row's button.
 */
export const getMeasurementChartActionButton: <
  TModel extends BaseModel,
>() => ActionButtonSchema<TModel> = <
  TModel extends BaseModel,
>(): ActionButtonSchema<TModel> => {
  return {
    title: MEASUREMENT_FORM_COPY.viewChart,
    icon: IconProp.ChartBar,
    buttonStyleType: ButtonStyleType.OUTLINE,
    isVisible: (item: TModel): boolean => {
      return Boolean((item as unknown as ChartableMeasurement).metricName);
    },
    onClick: (
      item: TModel,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
    ): void => {
      try {
        const measurement: ChartableMeasurement =
          item as unknown as ChartableMeasurement;

        Navigation.navigate(
          getMeasurementChartRoute({
            metricName: measurement.metricName || "",
            name: measurement.name,
            aggregationType: measurement.aggregationType,
          }),
        );

        onCompleteAction();
      } catch (err) {
        onError(err as Error);
      }
    },
  };
};
