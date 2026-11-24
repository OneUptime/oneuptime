import MetricType from "Common/Models/DatabaseModels/MetricType";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import type { ListResult as AnalyticsListResult } from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { JSONObject } from "Common/Types/JSON";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  getGlobalTranslator,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  getSloMetricQueryProblem,
  normalizeSloMetricQueryConfig,
  SloMetricKind,
  SloMetricQueryConfig,
  SloMetricQueryPart,
  SloMetricQueryProblem,
} from "Common/Utils/Slo/SloMetricSli";
import {
  SLO_COUNTABLE_METRIC_POINT_TYPES,
  SLO_GAUGE_METRIC_POINT_TYPE,
  SLO_METRIC_KIND_POINT_TYPES,
} from "Common/Utils/Slo/SloHealth";

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
 *
 * The fields are read where there is no browser, and App has no react
 * (Tests/FeatureSetImportsStayReactFree.test.ts), so this module draws
 * nothing itself: each part's control - the metric picker, the kind's
 * choices, an input - is drawn by SloMetricQueryFieldElements.tsx, which
 * the pages that show the form load (setSloMetricPartElement).
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
  metricPointTypes.clear();
};

// How far back a metric's newest point is looked for.
export const SLO_METRIC_POINT_TYPE_LOOKBACK_DAYS: number = 7;

export const SLO_METRIC_GAUGE_HINT: string = translationKey(
  "This metric is a gauge, which has no events to count. Choose a counter or a histogram, or measure it by a monitor's uptime.",
);
export const SLO_METRIC_UNCOUNTABLE_HINT: string = translationKey(
  "This metric is neither a counter nor an explicit-bucket histogram, so it has no events to count.",
);
export const SLO_METRIC_HISTOGRAM_AS_COUNTER_HINT: string = translationKey(
  'This metric is a histogram: choose "A histogram, by a value" under Good Events.',
);
export const SLO_METRIC_COUNTER_AS_HISTOGRAM_HINT: string = translationKey(
  'This metric is a counter: choose "A counter, by a condition" under Good Events.',
);

/*
 * What the picker says of the metric picked, by the kind of point its
 * newest one is (loadSloMetricPointType) and the kind of events the form
 * counts it as: a gauge's line, another kind's that cannot be counted, a
 * counter's or a histogram's counted as the other, or nothing for one
 * counted as the kind it is, or whose kind is not known (#10027).
 */
export const getSloMetricKindHint: (
  metricPointType: string | null | undefined,
  kind?: SloMetricKind | undefined,
) => string | null = (
  metricPointType: string | null | undefined,
  kind?: SloMetricKind | undefined,
): string | null => {
  if (!metricPointType) {
    return null;
  }

  if (SLO_COUNTABLE_METRIC_POINT_TYPES.includes(metricPointType)) {
    if (!kind || SLO_METRIC_KIND_POINT_TYPES[kind] === metricPointType) {
      return null;
    }

    return kind === SloMetricKind.Counter
      ? SLO_METRIC_HISTOGRAM_AS_COUNTER_HINT
      : SLO_METRIC_COUNTER_AS_HISTOGRAM_HINT;
  }

  return metricPointType === SLO_GAUGE_METRIC_POINT_TYPE
    ? SLO_METRIC_GAUGE_HINT
    : SLO_METRIC_UNCOUNTABLE_HINT;
};

/*
 * The kind of point a metric's newest one is ("Sum", "Histogram", "Gauge":
 * Metric.metricPointType), read once per metric of the session, or null
 * when it has none in the last week or cannot be read: a Metric SLO counts
 * a counter's or a histogram's events, and a gauge has none (#10027). The
 * picker says so of a gauge, and an SLO waiting for events of one says why.
 */
const metricPointTypes: Map<string, Promise<string | null>> = new Map<
  string,
  Promise<string | null>
>();

export const loadSloMetricPointType: (
  metricName: string,
) => Promise<string | null> = async (
  metricName: string,
): Promise<string | null> => {
  const name: string = (metricName || "").trim();

  if (!name) {
    return null;
  }

  // Imported here, as loadSloMetricTypes does, for the same reason.
  const [analyticsApi, projectUtil]: [
    typeof import("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI"),
    typeof import("Common/UI/Utils/Project"),
  ] = await Promise.all([
    import("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI"),
    import("Common/UI/Utils/Project"),
  ]);

  const projectId: string =
    projectUtil.default.getCurrentProjectId()?.toString() || "";
  const cacheKey: string = `${projectId}\n${name}`;
  const cached: Promise<string | null> | undefined =
    metricPointTypes.get(cacheKey);

  if (cached) {
    return cached;
  }

  const endTime: Date = OneUptimeDate.getCurrentDate();
  const query: Record<string, unknown> = {
    projectId: projectUtil.default.getCurrentProjectId(),
    name: name,
    time: new InBetween<Date>(
      OneUptimeDate.addRemoveDays(
        endTime,
        -1 * SLO_METRIC_POINT_TYPE_LOOKBACK_DAYS,
      ),
      endTime,
    ),
  };
  const loading: Promise<string | null> = analyticsApi.default
    .getList<Metric>({
      modelType: Metric,
      query: query,
      select: { metricPointType: true },
      sort: { time: SortOrder.Descending },
      skip: 0,
      limit: 1,
    })
    .then((result: AnalyticsListResult<Metric>): string | null => {
      const pointType: unknown = result.data?.[0]?.metricPointType;

      return typeof pointType === "string" && pointType ? pointType : null;
    })
    .catch((): string | null => {
      metricPointTypes.delete(cacheKey);
      return null;
    });

  metricPointTypes.set(cacheKey, loading);

  return loading;
};

/*
 * Draws one part's control in the form: the metric picker, the kind's
 * choices, an input. SloMetricQueryFieldElements.tsx hands it over as it
 * loads, and the pages that show the form load it.
 */
export type SloMetricPartElement = (
  part: SloMetricQueryPart,
  values: SloValues,
  props: CustomElementProps,
) => ReturnType<
  NonNullable<ModelField<ServiceLevelObjective>["getCustomElement"]>
>;

let drawSloMetricPart: SloMetricPartElement | null = null;

export const setSloMetricPartElement: (draw: SloMetricPartElement) => void = (
  draw: SloMetricPartElement,
): void => {
  drawSloMetricPart = draw;
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
  const partField: (
    part: SloMetricQueryPart,
    showIf: (values: SloValues) => boolean,
  ) => ModelField<ServiceLevelObjective> = (
    part: SloMetricQueryPart,
    showIf: (values: SloValues) => boolean,
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
      showIf: showIf,
      getCustomElement: (
        values: SloValues,
        props: CustomElementProps,
      ): ReturnType<SloMetricPartElement> => {
        if (!drawSloMetricPart) {
          throw new Error(
            "A Metric SLO's fields are shown without their controls: load Pages/Slo/SloMetricQueryFieldElements where the SLO form is shown.",
          );
        }

        return drawSloMetricPart(part, values, props);
      },
      stepId: options.stepId,
      dataTestId: `slo-metric-${part}-field`,
    } as ModelField<ServiceLevelObjective>;
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
    partField(SloMetricQueryPart.MetricName, isMetricForm),
    partField(SloMetricQueryPart.Kind, isMetricForm),
    partField(SloMetricQueryPart.GoodFilter, isKind(SloMetricKind.Counter)),
    partField(
      SloMetricQueryPart.GoodAtOrUnder,
      isKind(SloMetricKind.Histogram),
    ),
    partField(SloMetricQueryPart.Filter, isMetricForm),
  ];
};
