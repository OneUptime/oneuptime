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
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getSloMetricKindHint,
  loadSloMetricPointType,
  loadSloMetricTypes,
  readSloMetricType,
  searchSloMetricTypes,
  readSloMetricConfigInForm,
  setSloMetricPartElement,
  SLO_METRIC_FIELD_PLACEHOLDERS,
  SLO_METRIC_KIND_CHOICES,
  SLO_METRIC_UNIT_TEMPLATE,
  SloMetricPartElement,
} from "./SloMetricQueryFields";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

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

// How long the picker waits after a key before it searches the server.
const SLO_METRIC_SEARCH_DEBOUNCE_MS: number = 250;

/*
 * The metrics what is typed into the picker names, from the server
 * (#10646): debounced, the newest answer winning, nothing asked for an
 * empty box. The picker offers them beside the first 500 it read.
 */
const useSloMetricSearch: () => {
  found: Array<MetricType>;
  onSearchTextChange: (text: string) => void;
} = (): {
  found: Array<MetricType>;
  onSearchTextChange: (text: string) => void;
} => {
  const [found, setFound] = useState<Array<MetricType>>([]);
  const timerRef: MutableRefObject<number | null> = useRef<number | null>(null);
  const sequenceRef: MutableRefObject<number> = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    found: found,
    onSearchTextChange: (text: string): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }

      if (!text.trim()) {
        return;
      }

      const sequence: number = ++sequenceRef.current;

      timerRef.current = window.setTimeout(() => {
        void searchSloMetricTypes(text).then((metrics: Array<MetricType>) => {
          if (sequence === sequenceRef.current) {
            setFound(metrics);
          }
        });
      }, SLO_METRIC_SEARCH_DEBOUNCE_MS);
    },
  };
};

/*
 * The metric of the name the form holds, read by it when the first 500 do
 * not have it (#10646): its unit is said under a histogram's value.
 */
const useHeldSloMetricType: (data: {
  name: string;
  metricTypes: Array<MetricType> | null;
}) => MetricType | undefined = (data: {
  name: string;
  metricTypes: Array<MetricType> | null;
}): MetricType | undefined => {
  const [held, setHeld] = useState<MetricType | undefined>(undefined);
  const isKnown: boolean = (data.metricTypes || []).some(
    (metricType: MetricType): boolean => {
      return metricType.name === data.name;
    },
  );
  const isRead: boolean = data.metricTypes !== null;

  useEffect(() => {
    let isCurrent: boolean = true;

    if (!data.name || !isRead || isKnown) {
      setHeld(undefined);
      return;
    }

    void readSloMetricType(data.name).then((metric: MetricType | null) => {
      if (isCurrent) {
        setHeld(metric || undefined);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [data.name, isKnown, isRead]);

  return held;
};

interface SloMetricNamePickerProps {
  value: string;
  // The kind of events the form counts it as, for what is said under it.
  kind?: SloMetricKind | undefined;
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
  const search: {
    found: Array<MetricType>;
    onSearchTextChange: (text: string) => void;
  } = useSloMetricSearch();

  // The first 500, and what the search found past them.
  const names: Array<string> = Array.from(
    new Set<string>(
      [...(metricTypes || []), ...search.found]
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

  // A metric's name as the telemetry sent it: drawn as written, never looked up.
  const options: Array<DropdownOption> = names.map(
    (name: string): DropdownOption => {
      return { label: name, value: name, isUserContent: true };
    },
  );

  const selected: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return option.value === props.value;
    },
  );

  return (
    <div>
      <Dropdown
        options={options}
        value={selected}
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
        ): void => {
          props.onChange(
            typeof value === "string"
              ? value.slice(0, SLO_METRIC_NAME_MAX_LENGTH)
              : "",
          );
        }}
        isCreatable={true}
        isClearable={true}
        isLoading={metricTypes === null}
        onSearchTextChange={search.onSearchTextChange}
        placeholder={translator.translateText(
          SLO_METRIC_FIELD_PLACEHOLDERS[SloMetricQueryPart.MetricName],
        )}
        isPlaceholderTranslated={true}
        error={props.error}
        ariaLabelledby={props.ariaLabelledby}
        ariaDescribedby={props.ariaDescribedby}
        dataTestId="slo-metric-name"
      />
      <SloMetricKindHint metricName={props.value} kind={props.kind} />
    </div>
  );
};

interface SloMetricKindHintProps {
  metricName: string;
  // The kind of events the form counts it as, once one is chosen.
  kind?: SloMetricKind | undefined;
}

export const SLO_METRIC_GAUGE_HINT_TEST_ID: string = "slo-metric-gauge";

/*
 * What the picked metric is, when it is a kind of metric an SLO cannot
 * count (#10027): a gauge - every cloud metric OneUptime reads is one - is
 * a level read now and then, with no events in it, and an SLO on one would
 * wait for its events for ever. Said under the picker as the metric is
 * picked, from its newest point; nothing for a counter, a histogram, or a
 * metric with no point yet.
 */
export const SloMetricKindHint: FunctionComponent<SloMetricKindHintProps> = (
  props: SloMetricKindHintProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const [pointType, setPointType] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    setPointType(null);

    if (!props.metricName.trim()) {
      return;
    }

    loadSloMetricPointType(props.metricName)
      .then((loaded: string | null): void => {
        if (isCurrent) {
          setPointType(loaded);
        }
      })
      .catch((): void => {
        // Not known: nothing is said.
      });

    return () => {
      isCurrent = false;
    };
  }, [props.metricName]);

  const hint: string | null = getSloMetricKindHint(pointType, props.kind);

  if (!hint) {
    return null;
  }

  return (
    <p
      className="mt-1.5 flex items-start gap-1.5 text-sm text-amber-700"
      data-testid={SLO_METRIC_GAUGE_HINT_TEST_ID}
    >
      <Icon
        icon={IconProp.Alert}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500"
      />
      <span className="min-w-0">{translator.translateText(hint) || hint}</span>
    </p>
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
  const heldMetricType: MetricType | undefined = useHeldSloMetricType({
    name: props.metricName,
    metricTypes: metricTypes,
  });

  const unit: string =
    (
      (metricTypes || []).find((metricType: MetricType): boolean => {
        return metricType.name === props.metricName;
      }) || heldMetricType
    )?.unit || "";

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
          kind={readSloMetricConfigInForm(values).kind}
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
