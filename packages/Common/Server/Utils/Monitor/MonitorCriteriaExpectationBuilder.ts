import {
  CriteriaFilter,
  CriteriaFilterUtil,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MetricValueFormatter from "../../../Utils/Monitor/MetricValueFormatter";
import {
  EvaluationSentence,
  EvaluationSentenceValue,
  englishOfEvaluationSentence,
  evaluationTerm,
  translatablePluralSentence,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import { translationKey } from "../../../Types/Translator";

/**
 * How a criteria's values are displayed: the unit, the metric name the
 * formatter's fraction / epoch rules are keyed on, and the monitor type,
 * which decides how a window over the filter is judged.
 */
export interface CriteriaDisplayOptions {
  unit?: string | undefined;
  metricName?: string | undefined;
  monitorType?: MonitorType | undefined;
}

export default class MonitorCriteriaExpectationBuilder {
  public static getCriteriaFilterDescription(
    criteriaFilter: CriteriaFilter,
    options?: CriteriaDisplayOptions,
  ): string {
    return englishOfEvaluationSentence(
      MonitorCriteriaExpectationBuilder.getCriteriaFilterDescriptionSentence(
        criteriaFilter,
        options,
      ),
    ).trim();
  }

  /*
   * A filter as the evaluation names it - its check, its condition and its
   * value: "Response Status Code Greater Than 499" - as a sentence the
   * reader's language words (EvaluationSentence): the check and the
   * condition are its words, the value is as configured.
   */
  public static getCriteriaFilterDescriptionSentence(
    criteriaFilter: CriteriaFilter,
    options?: CriteriaDisplayOptions,
  ): EvaluationSentence {
    const check: EvaluationSentenceValue = evaluationTerm(
      criteriaFilter.checkOn,
    );

    const hasValue: boolean =
      criteriaFilter.value !== undefined && criteriaFilter.value !== null;

    // Its end trimmed, as the English always was.
    const value: string = hasValue
      ? String(
          MonitorCriteriaExpectationBuilder.formatThreshold(
            criteriaFilter.value,
            options,
          ) ?? criteriaFilter.value,
        ).trimEnd()
      : "";

    if (criteriaFilter.filterType) {
      const condition: EvaluationSentenceValue = evaluationTerm(
        criteriaFilter.filterType,
      );

      return hasValue
        ? translatableSentence("{{check}} {{condition}} {{value}}", {
            check: check,
            condition: condition,
            value: value,
          })
        : translatableSentence("{{check}} {{condition}}", {
            check: check,
            condition: condition,
          });
    }

    return hasValue
      ? translatableSentence("{{check}} {{value}}", {
          check: check,
          value: value,
        })
      : translatableSentence("{{check}}", { check: check });
  }

  /*
   * The threshold, rendered exactly as an observed value would be — or
   * returned untouched when it cannot be.
   *
   * Untouched covers three cases, and each matters: no unit was resolved
   * (every non-metric checkOn, whose unit lives in its CheckOn label), the
   * threshold is a string (the Contains / StartsWith family, which must
   * quote what the user typed), or it is not a finite number.
   */
  private static formatThreshold(
    value: string | number | undefined,
    options?: CriteriaDisplayOptions,
  ): string | number | undefined {
    if (!options?.unit) {
      return value;
    }

    const numeric: number = Number(value);

    if (typeof value === "boolean" || !Number.isFinite(numeric)) {
      return value;
    }

    return MetricValueFormatter.format({
      value: numeric,
      unit: options.unit,
      metricName: options.metricName,
    });
  }

  public static describeCriteriaExpectation(
    criteriaFilter: CriteriaFilter,
    options?: CriteriaDisplayOptions,
  ): string | null {
    const sentence: EvaluationSentence | null =
      MonitorCriteriaExpectationBuilder.describeCriteriaExpectationSentence(
        criteriaFilter,
        options,
      );

    return sentence ? englishOfEvaluationSentence(sentence) : null;
  }

  /*
   * What a filter expects, as a sentence the reader's language words
   * (EvaluationSentence): "to be greater than 499 over the last 5 minutes".
   * Its English is what describeCriteriaExpectation says.
   */
  public static describeCriteriaExpectationSentence(
    criteriaFilter: CriteriaFilter,
    options?: CriteriaDisplayOptions,
  ): EvaluationSentence | null {
    if (!criteriaFilter.filterType) {
      return null;
    }

    let expectation: EvaluationSentence;

    /*
     * Render the threshold the way the observed value is rendered, so the
     * two halves of one sentence cannot describe one quantity differently.
     * Reformatting only the observation produced "recorded latest 1.07 GB
     * (expected to be greater than 1000000000 By)".
     *
     * A NON-numeric threshold falls back to the previous text verbatim —
     * `criteriaFilter.value` is `string | number | undefined`, and the
     * string filter types below must keep quoting exactly what the user
     * typed. So must a threshold with no unit: `formatThreshold` is only
     * installed when a unit was resolved, which happens for the two metric
     * checkOns and nothing else.
     */
    const value: string | number | undefined = criteriaFilter.value;

    /*
     * The threshold as the six value-comparison cases below should print
     * it, unit included. Only those six get it: the string comparisons
     * quote what the user typed, and the heartbeat windows carry their own
     * "minutes" — formatting their value produced "within 5 sec minutes".
     */
    const comparedValue: string | number | undefined =
      MonitorCriteriaExpectationBuilder.formatThreshold(value, options);

    /*
     * Suffix numeric-threshold comparisons with the metric's display unit
     * (e.g. "greater than 5 sec") so the threshold reads in the same unit
     * as the observed value. Only the value-comparison filter types below
     * carry a numeric threshold — the others (empty, boolean, heartbeat
     * windows, …) supply their own wording and get no suffix.
     *
     * When the value was formatted above it already carries its unit, so
     * this suffix collapses to empty and the unit is not printed twice.
     */
    const unitSuffix: string =
      options?.unit && comparedValue === value ? ` ${options.unit}` : "";

    const evaluationWindow: EvaluationSentence | null =
      MonitorCriteriaExpectationBuilder.getEvaluationWindowSentence(
        criteriaFilter,
        options?.monitorType,
      );

    /*
     * The expectation's last value, as the sentence ends with it: the
     * English was trimmed at its end, so a value typed with spaces after it
     * ends the sentence without them when nothing follows it.
     */
    const atEnd: (text: string) => string = (text: string): string => {
      return evaluationWindow ? text : text.trimEnd();
    };

    const compared: string = atEnd(`${comparedValue}${unitSuffix}`);
    const typed: string = atEnd(`${value}`);

    switch (criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        expectation = translatableSentence("to be greater than {{value}}", {
          value: compared,
        });
        break;
      case FilterType.GreaterThanOrEqualTo:
        expectation = translatableSentence(
          "to be greater than or equal to {{value}}",
          { value: compared },
        );
        break;
      case FilterType.LessThan:
        expectation = translatableSentence("to be less than {{value}}", {
          value: compared,
        });
        break;
      case FilterType.LessThanOrEqualTo:
        expectation = translatableSentence(
          "to be less than or equal to {{value}}",
          { value: compared },
        );
        break;
      case FilterType.EqualTo:
        expectation = translatableSentence("to equal {{value}}", {
          value: compared,
        });
        break;
      case FilterType.NotEqualTo:
        expectation = translatableSentence("to not equal {{value}}", {
          value: compared,
        });
        break;
      case FilterType.Contains:
        expectation = translatableSentence("to contain {{value}}", {
          value: typed,
        });
        break;
      case FilterType.NotContains:
        expectation = translatableSentence("to not contain {{value}}", {
          value: typed,
        });
        break;
      case FilterType.StartsWith:
        expectation = translatableSentence("to start with {{value}}", {
          value: typed,
        });
        break;
      case FilterType.EndsWith:
        expectation = translatableSentence("to end with {{value}}", {
          value: typed,
        });
        break;
      case FilterType.IsEmpty:
        expectation = translatableSentence("to be empty");
        break;
      case FilterType.IsNotEmpty:
        expectation = translatableSentence("to not be empty");
        break;
      case FilterType.True:
        expectation = translatableSentence("to be true");
        break;
      case FilterType.False:
        expectation = translatableSentence("to be false");
        break;
      case FilterType.IsExecuting:
        expectation = translatableSentence("to be executing");
        break;
      case FilterType.IsNotExecuting:
        expectation = translatableSentence("to not be executing");
        break;
      case FilterType.RecievedInMinutes:
        expectation = value
          ? translatableSentence(
              "to receive a heartbeat within {{minutes}} minutes",
              { minutes: `${value}` },
            )
          : translatableSentence(
              "to receive a heartbeat within the configured window",
            );
        break;
      case FilterType.NotRecievedInMinutes:
        expectation = value
          ? translatableSentence(
              "to miss a heartbeat for at least {{minutes}} minutes",
              { minutes: `${value}` },
            )
          : translatableSentence(
              "to miss a heartbeat within the configured window",
            );
        break;
      case FilterType.EvaluatesToTrue:
        expectation = translatableSentence("to evaluate to true");
        break;
      case FilterType.ForecastAbove:
        expectation = translatableSentence(
          "to be forecast above {{value}} within {{horizon}}",
          {
            value: `${comparedValue}${unitSuffix}`,
            horizon:
              MonitorCriteriaExpectationBuilder.describeForecastHorizonSentence(
                criteriaFilter,
              ),
          },
        );
        break;
      case FilterType.ForecastBelow:
        expectation = translatableSentence(
          "to be forecast below {{value}} within {{horizon}}",
          {
            value: `${comparedValue}${unitSuffix}`,
            horizon:
              MonitorCriteriaExpectationBuilder.describeForecastHorizonSentence(
                criteriaFilter,
              ),
          },
        );
        break;
      default:
        expectation = value
          ? translatableSentence("{{condition}} {{value}}", {
              condition: evaluationTerm(criteriaFilter.filterType),
              value: typed,
            })
          : translatableSentence("{{condition}}", {
              condition: evaluationTerm(criteriaFilter.filterType),
            });
        break;
    }

    if (evaluationWindow) {
      return translatableSentence("{{expectation}} {{window}}", {
        expectation: expectation,
        window: evaluationWindow,
      });
    }

    return expectation;
  }

  // A forecast's horizon: "1 hour", "12 hours", "7 days".
  private static describeForecastHorizonSentence(
    criteriaFilter: CriteriaFilter,
  ): EvaluationSentence {
    const hours: number =
      CriteriaFilterUtil.getForecastHorizonInHours(criteriaFilter);

    if (hours >= 24 && hours % 24 === 0) {
      const days: number = hours / 24;

      return translatablePluralSentence(
        {
          one: translationKey("{{count}} day"),
          other: translationKey("{{count}} days"),
        },
        days,
      );
    }

    return translatablePluralSentence(
      {
        one: translationKey("{{count}} hour"),
        other: translationKey("{{count}} hours"),
      },
      hours,
    );
  }

  public static getEvaluationWindowDescription(
    criteriaFilter: CriteriaFilter,
    monitorType?: MonitorType | undefined,
  ): string | null {
    const sentence: EvaluationSentence | null =
      MonitorCriteriaExpectationBuilder.getEvaluationWindowSentence(
        criteriaFilter,
        monitorType,
      );

    return sentence ? englishOfEvaluationSentence(sentence) : null;
  }

  /*
   * The window a filter is judged over, and how: "over the last 5 minutes
   * using average", as a sentence (EvaluationSentence).
   */
  public static getEvaluationWindowSentence(
    criteriaFilter: CriteriaFilter,
    monitorType?: MonitorType | undefined,
  ): EvaluationSentence | null {
    const isEvaluatedOverTime: boolean = CriteriaFilterUtil.isEvaluatedOverTime(
      criteriaFilter,
      monitorType,
    );

    const minutes: number | undefined = isEvaluatedOverTime
      ? criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
      : undefined;

    /*
     * The window's type only while the filter is evaluated over time: the
     * form keeps a window when its box is unticked, so ticking it again
     * brings the window back, and that filter is judged on the latest check.
     * A boolean series saved with an aggregate is judged as All Values.
     */
    const aggregation: string | undefined =
      (isEvaluatedOverTime
        ? CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(
            criteriaFilter,
            monitorType,
          )
        : undefined) ||
      criteriaFilter.metricMonitorOptions?.metricAggregationType;

    // A forecast reads every value of the window into its trend.
    const usesAggregation: boolean = Boolean(
      aggregation &&
        !CriteriaFilterUtil.isForecastFilterType(criteriaFilter.filterType),
    );

    // The aggregation's name, cased for the middle of a sentence ("using average").
    const aggregationTerm: EvaluationSentenceValue = evaluationTerm(
      aggregation || "",
      { inSentence: true },
    );

    if (minutes && usesAggregation) {
      return translatableSentence(
        "over the last {{minutes}} minutes using {{aggregation}}",
        { minutes: String(minutes), aggregation: aggregationTerm },
      );
    }

    if (minutes) {
      return translatableSentence("over the last {{minutes}} minutes", {
        minutes: String(minutes),
      });
    }

    if (usesAggregation) {
      return translatableSentence("using {{aggregation}}", {
        aggregation: aggregationTerm,
      });
    }

    return null;
  }
}
