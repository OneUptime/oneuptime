import MetricType from "Common/Models/DatabaseModels/MetricType";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Input from "Common/UI/Components/Input/Input";
import RadioButtons, {
  RadioButton,
} from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  SLO_METRIC_FILTER_MAX_LENGTH,
  SLO_METRIC_NAME_MAX_LENGTH,
  SloMetricKind,
  SloMetricQueryConfig,
  SloMetricQueryPart,
} from "Common/Utils/Slo/SloMetricSli";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  loadSloMetricTypes,
  readSloMetricConfigInForm,
  setSloMetricPartElement,
  SLO_METRIC_FIELD_PLACEHOLDERS,
  SLO_METRIC_KIND_CHOICES,
  SLO_METRIC_UNIT_TEMPLATE,
  SloMetricPartElement,
} from "./SloMetricQueryFields";

/*
 * The controls of a Metric SLO's metric fields (SloMetricQueryFields, #8445):
 * the project's metrics to pick from, the kind's choices, and the inputs of
 * the good condition, the good value (with the metric's unit under it) and
 * the filter. The fields are React-free, so they can be read where there is
 * no browser; loading this module hands them these controls. The pages that
 * show the SLO form - the SLO list's and a service's create forms, and
 * Settings - load it.
 */

type SloValues = FormValues<ServiceLevelObjective>;

const useSloMetricTypes: () => Array<MetricType> | null =
  (): Array<MetricType> | null => {
    const [metricTypes, setMetricTypes] = useState<Array<MetricType> | null>(
      null,
    );

    useEffect(() => {
      let isCurrent: boolean = true;

      loadSloMetricTypes()
        .then((loaded: Array<MetricType>) => {
          if (isCurrent) {
            setMetricTypes(loaded);
          }
        })
        .catch(() => {
          if (isCurrent) {
            setMetricTypes([]);
          }
        });

      return () => {
        isCurrent = false;
      };
    }, []);

    return metricTypes;
  };

interface SloMetricNamePickerProps {
  value: string;
  onChange: (metricName: string) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
  ariaDescribedby?: string | undefined;
}

/*
 * The project's metrics to pick from, searchable; a name typed that is not
 * one of them yet is kept as typed (a metric is often set up before its
 * first points arrive).
 */
export const SloMetricNamePicker: FunctionComponent<
  SloMetricNamePickerProps
> = (props: SloMetricNamePickerProps): ReactElement => {
  const translator: Translator = useTranslator();
  const metricTypes: Array<MetricType> | null = useSloMetricTypes();

  const names: Array<string> = Array.from(
    new Set<string>(
      (metricTypes || [])
        .map((metricType: MetricType): string => {
          return metricType.name || "";
        })
        .filter((name: string): boolean => {
          return Boolean(name) && !name.toLowerCase().startsWith("oneuptime.");
        }),
    ),
  );

  if (props.value && !names.includes(props.value)) {
    names.unshift(props.value);
  }

  const options: Array<DropdownOption> = names.map(
    (name: string): DropdownOption => {
      return { label: name, value: name };
    },
  );

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === props.value;
    },
  );

  return (
    <Dropdown
      options={options}
      value={selected}
      onChange={(value: DropdownValue | Array<DropdownValue> | null): void => {
        props.onChange(
          typeof value === "string"
            ? value.slice(0, SLO_METRIC_NAME_MAX_LENGTH)
            : "",
        );
      }}
      isCreatable={true}
      isClearable={true}
      isLoading={metricTypes === null}
      placeholder={translator.translateText(
        SLO_METRIC_FIELD_PLACEHOLDERS[SloMetricQueryPart.MetricName],
      )}
      isPlaceholderTranslated={true}
      error={props.error}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      dataTestId="slo-metric-name"
    />
  );
};

interface SloMetricUnitHintProps {
  metricName: string;
}

// "In s, the metric's unit." under a histogram's value, when the metric has a unit.
export const SloMetricUnitHint: FunctionComponent<SloMetricUnitHintProps> = (
  props: SloMetricUnitHintProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const metricTypes: Array<MetricType> | null = useSloMetricTypes();

  const unit: string =
    (metricTypes || []).find((metricType: MetricType): boolean => {
      return metricType.name === props.metricName;
    })?.unit || "";

  if (!unit.trim()) {
    return null;
  }

  return (
    <p className="mt-1 text-sm text-gray-500" data-testid="slo-metric-unit">
      {translator.translateTemplate(
        SLO_METRIC_UNIT_TEMPLATE,
        { unit: unit.trim() },
        { setsValuesApart: true },
      )}
    </p>
  );
};

// The good condition's and the filter's input.
const drawTextPart: (
  part: SloMetricQueryPart.GoodFilter | SloMetricQueryPart.Filter,
  values: SloValues,
  props: CustomElementProps,
) => ReactElement = (
  part: SloMetricQueryPart.GoodFilter | SloMetricQueryPart.Filter,
  values: SloValues,
  props: CustomElementProps,
): ReactElement => {
  return (
    <Input
      value={String(readSloMetricConfigInForm(values)[part] || "")}
      onChange={(text: string): void => {
        props.onChange?.(text);
      }}
      placeholder={SLO_METRIC_FIELD_PLACEHOLDERS[part]}
      isPlaceholderIdentifier={true}
      readsLeftToRight={true}
      disableSpellCheck={true}
      maxLength={SLO_METRIC_FILTER_MAX_LENGTH}
      error={props.error}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      dataTestId={`slo-metric-${part}`}
    />
  );
};

// How good events are told apart: a counter by a condition, or a histogram by a value.
const drawKindPart: (
  values: SloValues,
  props: CustomElementProps,
) => ReactElement = (
  values: SloValues,
  props: CustomElementProps,
): ReactElement => {
  const translator: Translator = getGlobalTranslator();
  const radioButtons: Array<RadioButton> = SLO_METRIC_KIND_CHOICES.map(
    (choice: {
      kind: SloMetricKind;
      title: string;
      description: string;
    }): RadioButton => {
      return {
        value: choice.kind,
        title: translator.translateText(choice.title) || choice.title,
        description:
          translator.translateText(choice.description) || choice.description,
      };
    },
  );

  return (
    <RadioButtons
      options={radioButtons}
      initialValue={readSloMetricConfigInForm(values).kind}
      onChange={(kind: string): void => {
        props.onChange?.(kind);
      }}
      error={props.error}
      ariaLabelledby={props.ariaLabelledby}
      ariaDescribedby={props.ariaDescribedby}
      dataTestId="slo-metric-kind"
    />
  );
};

// A histogram's good value, with the metric's unit under it.
const drawGoodAtOrUnderPart: (
  values: SloValues,
  props: CustomElementProps,
) => ReactElement = (
  values: SloValues,
  props: CustomElementProps,
): ReactElement => {
  const config: Partial<SloMetricQueryConfig> =
    readSloMetricConfigInForm(values);

  return (
    <div>
      <Input
        value={
          config.goodAtOrUnder === undefined || config.goodAtOrUnder === null
            ? ""
            : String(config.goodAtOrUnder)
        }
        onChange={(text: string): void => {
          const trimmed: string = text.trim();
          const number: number = Number(trimmed);

          props.onChange?.(
            trimmed === ""
              ? undefined
              : Number.isFinite(number)
                ? number
                : trimmed,
          );
        }}
        placeholder={
          SLO_METRIC_FIELD_PLACEHOLDERS[SloMetricQueryPart.GoodAtOrUnder]
        }
        isPlaceholderIdentifier={true}
        inputMode="decimal"
        error={props.error}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        dataTestId="slo-metric-goodAtOrUnder"
      />
      <SloMetricUnitHint metricName={String(config.metricName || "")} />
    </div>
  );
};

export const drawSloMetricPart: SloMetricPartElement = (
  part: SloMetricQueryPart,
  values: SloValues,
  props: CustomElementProps,
): ReactElement => {
  switch (part) {
    case SloMetricQueryPart.MetricName:
      return (
        <SloMetricNamePicker
          value={String(readSloMetricConfigInForm(values).metricName || "")}
          onChange={(metricName: string): void => {
            props.onChange?.(metricName);
          }}
          error={props.error}
          ariaLabelledby={props.ariaLabelledby}
          ariaDescribedby={props.ariaDescribedby}
        />
      );
    case SloMetricQueryPart.Kind:
      return drawKindPart(values, props);
    case SloMetricQueryPart.GoodAtOrUnder:
      return drawGoodAtOrUnderPart(values, props);
    case SloMetricQueryPart.GoodFilter:
    case SloMetricQueryPart.Filter:
      return drawTextPart(part, values, props);
  }
};

setSloMetricPartElement(drawSloMetricPart);
