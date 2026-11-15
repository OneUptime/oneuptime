import MetricType from "Common/Models/DatabaseModels/MetricType";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Input from "Common/UI/Components/Input/Input";
import RadioButtons, {
  RadioButton,
} from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getSloMetricQueryProblem,
  normalizeSloMetricQueryConfig,
  SLO_METRIC_FILTER_MAX_LENGTH,
  SLO_METRIC_NAME_MAX_LENGTH,
  SloMetricKind,
  SloMetricQueryConfig,
  SloMetricQueryPart,
  SloMetricQueryProblem,
} from "Common/Utils/Slo/SloMetricSli";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * A METRIC SLO'S METRIC, IN THE CREATE FORM AND IN SETTINGS (#8445).
 *
 * The metric is one JSON column, metricQueryConfig, asked as the questions
 * a person answers about it: which metric, how its good events are told
 * apart (a counter's condition, or a histogram's value), and optionally
 * which of its series count. Each question is its own field, with its own
 * help and its own problem (getSloMetricQueryProblem says which part a
 * problem is about), and edits its part of the column; the column itself
 * stays registered, unseen, so the form loads and saves it - the burn rate
 * rule's When it fires choice edits its two columns the same way. So the
 * create form, a service's SLOs page and Settings all edit it with no
 * wiring of their own.
 */

export const SLO_METRIC_FIELD_KEYS: Record<SloMetricQueryPart, string> = {
  [SloMetricQueryPart.MetricName]: "sloMetricName",
  [SloMetricQueryPart.Kind]: "sloMetricKind",
  [SloMetricQueryPart.GoodFilter]: "sloMetricGoodFilter",
  [SloMetricQueryPart.GoodAtOrUnder]: "sloMetricGoodAtOrUnder",
  [SloMetricQueryPart.Filter]: "sloMetricFilter",
};

export const SLO_METRIC_FIELD_TITLES: Record<SloMetricQueryPart, string> = {
  [SloMetricQueryPart.MetricName]: translationKey("Metric"),
  [SloMetricQueryPart.Kind]: translationKey("Good Events"),
  [SloMetricQueryPart.GoodFilter]: translationKey("Good When"),
  [SloMetricQueryPart.GoodAtOrUnder]: translationKey("Good At Or Under"),
  [SloMetricQueryPart.Filter]: translationKey("Metric Filter"),
};

export const SLO_METRIC_FIELD_DESCRIPTIONS: Record<SloMetricQueryPart, string> =
  {
    [SloMetricQueryPart.MetricName]: translationKey(
      "The counter or histogram your services send, by its name. Pick one of your project's metrics, or type a name it will send.",
    ),
    [SloMetricQueryPart.Kind]: translationKey(
      "How OneUptime tells a good event from a bad one.",
    ),
    [SloMetricQueryPart.GoodFilter]: translationKey(
      "The counter's events whose attributes match this search are good, such as a status code under 500.",
    ),
    [SloMetricQueryPart.GoodAtOrUnder]: translationKey(
      "An observation at or under this value is good, in the metric's own unit: 0.3 for 300 ms of a histogram in seconds. Use one of its bucket boundaries.",
    ),
    [SloMetricQueryPart.Filter]: translationKey(
      "Optional. Count only the metric's series whose attributes match this search, such as -@http.route:/health. Empty counts all of them.",
    ),
  };

export const SLO_METRIC_FIELD_PLACEHOLDERS: Record<SloMetricQueryPart, string> =
  {
    [SloMetricQueryPart.MetricName]: translationKey(
      "Search your metrics, or type a name",
    ),
    [SloMetricQueryPart.Kind]: "",
    [SloMetricQueryPart.GoodFilter]: "@http.response.status_code:<500",
    [SloMetricQueryPart.GoodAtOrUnder]: "0.3",
    [SloMetricQueryPart.Filter]: "@http.route:/checkout*",
  };

export const SLO_METRIC_KIND_CHOICES: Array<{
  kind: SloMetricKind;
  title: string;
  description: string;
}> = [
  {
    kind: SloMetricKind.Counter,
    title: translationKey("A counter, by a condition"),
    description: translationKey(
      "Good events are what the counter grew by on the series that match a condition, such as http_requests_total with a status code under 500.",
    ),
  },
  {
    kind: SloMetricKind.Histogram,
    title: translationKey("A histogram, by a value"),
    description: translationKey(
      "Good events are the observations at or under a value, such as http.server.request.duration at or under 0.3 seconds.",
    ),
  },
];

// The unit a histogram's value is in, when the metric says: "In s, the metric's unit."
export const SLO_METRIC_UNIT_TEMPLATE: string = translationKey(
  "In {{unit}}, the metric's unit.",
);

// How many of the project's metrics the picker offers.
export const SLO_METRIC_PICKER_LIMIT: number = 500;

type SloValues = FormValues<ServiceLevelObjective>;

// The form is for a Metric SLO: its metric is asked.
export const isMetricForm: (item: SloValues) => boolean = (
  item: SloValues,
): boolean => {
  return item.sliType === SliType.Metric;
};

// The metric as the form holds it: what is stored, or what is being typed.
export const readSloMetricConfigInForm: (
  values: SloValues,
) => Partial<SloMetricQueryConfig> = (
  values: SloValues,
): Partial<SloMetricQueryConfig> => {
  const stored: unknown = (values as Record<string, unknown>)[
    "metricQueryConfig"
  ];

  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }

  return stored as Partial<SloMetricQueryConfig>;
};

/*
 * A counter or a histogram, by its name, for a metric picked before its
 * kind was: OpenTelemetry's and Prometheus' naming conventions say which
 * most metrics are. Undefined when the name does not say.
 */
// A histogram's name ends in what it measures: a duration, a latency, a unit of time.
const HISTOGRAM_NAME: RegExp =
  /(duration|latency|_seconds|_milliseconds|_bucket|\.time)$/;

// A counter's ends in what it counts.
const COUNTER_NAME: RegExp = /(_total|_count|\.count|requests|errors)$/;

export const guessSloMetricKind: (
  metricName: string,
) => SloMetricKind | undefined = (
  metricName: string,
): SloMetricKind | undefined => {
  const name: string = metricName.trim().toLowerCase();

  if (HISTOGRAM_NAME.test(name)) {
    return SloMetricKind.Histogram;
  }

  if (COUNTER_NAME.test(name)) {
    return SloMetricKind.Counter;
  }

  return undefined;
};

// The form's values with one part of the metric changed.
export const withSloMetricPart: (
  values: SloValues,
  part: SloMetricQueryPart,
  value: unknown,
) => SloValues = (
  values: SloValues,
  part: SloMetricQueryPart,
  value: unknown,
): SloValues => {
  const config: JSONObject = {
    ...(readSloMetricConfigInForm(values) as JSONObject),
  };

  if (value === undefined || value === null || value === "") {
    delete config[part];
  } else {
    config[part] = value as JSONObject[string];
  }

  // A metric picked before its kind: its name usually says which it is.
  if (part === SloMetricQueryPart.MetricName && !config["kind"]) {
    const guessed: SloMetricKind | undefined = guessSloMetricKind(
      String(value || ""),
    );

    if (guessed) {
      config["kind"] = guessed;
    }
  }

  return {
    ...values,
    metricQueryConfig: config,
  } as unknown as SloValues;
};

/*
 * What is wrong with one part of a Metric SLO's metric, in the reader's
 * language with its figures written their way, or null - also for every
 * other SLI type, whose metric is never counted.
 */
export const getSloMetricPartProblem: (
  values: SloValues,
  part: SloMetricQueryPart,
) => string | null = (
  values: SloValues,
  part: SloMetricQueryPart,
): string | null => {
  if (!isMetricForm(values)) {
    return null;
  }

  const problem: SloMetricQueryProblem | null = getSloMetricQueryProblem(
    normalizeSloMetricQueryConfig(readSloMetricConfigInForm(values)),
  );

  if (!problem || problem.part !== part) {
    return null;
  }

  const reader: Translator = getGlobalTranslator();
  const figures: Record<string, string> = {};

  for (const [name, figure] of Object.entries(problem.values)) {
    figures[name] =
      typeof figure === "number" ? reader.formatNumber(figure) : figure;
  }

  return reader.translateTemplate(problem.template, figures, {
    setsValuesApart: true,
  });
};

/*
 * The project's metric types, read once per project for every picker and
 * value field of the session; an empty list when they cannot be read, so
 * the picker still takes a typed name.
 */
const metricTypesByProject: Map<string, Promise<Array<MetricType>>> = new Map<
  string,
  Promise<Array<MetricType>>
>();

export const loadSloMetricTypes: () => Promise<
  Array<MetricType>
> = async (): Promise<Array<MetricType>> => {
  /*
   * Imported here: the API client and the project read the browser's
   * config as they load, and the SLO form's fields are read where there
   * is none (RecommendationResourceRegistry does the same).
   */
  const [modelApi, projectUtil]: [
    typeof import("Common/UI/Utils/ModelAPI/ModelAPI"),
    typeof import("Common/UI/Utils/Project"),
  ] = await Promise.all([
    import("Common/UI/Utils/ModelAPI/ModelAPI"),
    import("Common/UI/Utils/Project"),
  ]);

  const projectId: string =
    projectUtil.default.getCurrentProjectId()?.toString() || "";
  const cached: Promise<Array<MetricType>> | undefined =
    metricTypesByProject.get(projectId);

  if (cached) {
    return cached;
  }

  const loading: Promise<Array<MetricType>> = modelApi.default
    .getList<MetricType>({
      modelType: MetricType,
      query: {},
      limit: SLO_METRIC_PICKER_LIMIT,
      skip: 0,
      select: { name: true, unit: true },
      sort: { name: SortOrder.Ascending },
    })
    .then((result: { data: Array<MetricType> }): Array<MetricType> => {
      return result.data || [];
    })
    .catch((): Array<MetricType> => {
      metricTypesByProject.delete(projectId);
      return [];
    });

  metricTypesByProject.set(projectId, loading);

  return loading;
};

// For tests: forget the metric types read so far.
export const forgetSloMetricTypes: () => void = (): void => {
  metricTypesByProject.clear();
};

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

interface SloMetricFieldsOptions {
  // The create form's step for the metric; Settings has none.
  stepId?: string | undefined;
}

type GetSloMetricFieldsFunction = (
  options?: SloMetricFieldsOptions,
) => Array<ModelField<ServiceLevelObjective>>;

/*
 * The metric's fields: the column, registered unseen so the form loads and
 * saves it, then one field per question, each editing its part.
 */
export const getSloMetricFields: GetSloMetricFieldsFunction = (
  options: SloMetricFieldsOptions = {},
): Array<ModelField<ServiceLevelObjective>> => {
  type PartField = Omit<
    ModelField<ServiceLevelObjective>,
    "overrideField" | "overrideFieldKey" | "title" | "description"
  >;

  const partField: (
    part: SloMetricQueryPart,
    field: PartField,
  ) => ModelField<ServiceLevelObjective> = (
    part: SloMetricQueryPart,
    field: PartField,
  ): ModelField<ServiceLevelObjective> => {
    return {
      overrideField: { metricQueryConfig: true },
      overrideFieldKey: SLO_METRIC_FIELD_KEYS[part],
      formOnly: true,
      title: SLO_METRIC_FIELD_TITLES[part],
      description: SLO_METRIC_FIELD_DESCRIPTIONS[part],
      fieldType: FormFieldSchemaType.CustomComponent,
      // Each part says what it needs in its own problem (getSloMetricPartProblem).
      required: false,
      hideOptionalLabel: part !== SloMetricQueryPart.Filter,
      // The column's description is the API's, in English: each part says its own.
      hideColumnDescription: true,
      customValidation: (values: SloValues): string | null => {
        return getSloMetricPartProblem(values, part);
      },
      onChange: (
        value: unknown,
        currentValues: SloValues,
        setNewFormValues: (values: SloValues) => void,
      ): void => {
        setNewFormValues(withSloMetricPart(currentValues, part, value));
      },
      stepId: options.stepId,
      dataTestId: `slo-metric-${part}-field`,
      ...field,
    } as ModelField<ServiceLevelObjective>;
  };

  const textPart: (
    part: SloMetricQueryPart.GoodFilter | SloMetricQueryPart.Filter,
    showIf: (values: SloValues) => boolean,
  ) => ModelField<ServiceLevelObjective> = (
    part: SloMetricQueryPart.GoodFilter | SloMetricQueryPart.Filter,
    showIf: (values: SloValues) => boolean,
  ): ModelField<ServiceLevelObjective> => {
    return partField(part, {
      showIf: showIf,
      getCustomElement: (
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
      },
    });
  };

  const isKind: (kind: SloMetricKind) => (values: SloValues) => boolean = (
    kind: SloMetricKind,
  ): ((values: SloValues) => boolean) => {
    return (values: SloValues): boolean => {
      return (
        isMetricForm(values) && readSloMetricConfigInForm(values).kind === kind
      );
    };
  };

  return [
    {
      field: {
        metricQueryConfig: true,
      },
      title: translationKey("Metric"),
      fieldType: FormFieldSchemaType.JSON,
      required: false,
      // Never shown: each question below says what its part is.
      hideColumnDescription: true,
      // Loaded and saved through it; the questions below edit it.
      showIf: (): boolean => {
        return false;
      },
      stepId: options.stepId,
    },
    partField(SloMetricQueryPart.MetricName, {
      showIf: isMetricForm,
      getCustomElement: (
        values: SloValues,
        props: CustomElementProps,
      ): ReactElement => {
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
      },
    }),
    partField(SloMetricQueryPart.Kind, {
      showIf: isMetricForm,
      getCustomElement: (
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
                translator.translateText(choice.description) ||
                choice.description,
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
      },
    }),
    textPart(SloMetricQueryPart.GoodFilter, isKind(SloMetricKind.Counter)),
    partField(SloMetricQueryPart.GoodAtOrUnder, {
      showIf: isKind(SloMetricKind.Histogram),
      getCustomElement: (
        values: SloValues,
        props: CustomElementProps,
      ): ReactElement => {
        const config: Partial<SloMetricQueryConfig> =
          readSloMetricConfigInForm(values);

        return (
          <div>
            <Input
              value={
                config.goodAtOrUnder === undefined ||
                config.goodAtOrUnder === null
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
      },
    }),
    textPart(SloMetricQueryPart.Filter, isMetricForm),
  ];
};
