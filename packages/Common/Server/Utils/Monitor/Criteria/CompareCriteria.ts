import logger from "../../../Utils/Logger";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import Typeof from "../../../../Types/Typeof";
import MetricValueFormatter from "../../../../Utils/Monitor/MetricValueFormatter";
import MonitorQuotedValue from "../MonitorQuotedValue";
import EvaluationSentenceMemo from "../EvaluationSentenceMemo";
import {
  EvaluationSentence,
  EvaluationSentenceValue,
  evaluationTerm,
  translatablePluralSentence,
  translatableSentence,
} from "../../../../Types/Monitor/EvaluationSentence";
import { translationKey } from "../../../../Types/Translator";

/*
 * No @CaptureSpan here: each method compares values already in memory, in
 * microseconds, several times per monitor check. A span each said nothing.
 */
export default class CompareCriteria {
  /*
   * Reduce an evaluation window to the value(s) a threshold is actually
   * compared against.
   *
   * Before this existed, every comparator branched on `AnyValue` and let
   * EVERY other evaluation type fall through to `.every()`. That silently
   * turned Average, Sum, Maximum Value and Minimum Value — all four
   * offered in the criteria UI and all four stored on real monitors — into
   * "All Values". A user who asked to be paged on the five-minute AVERAGE
   * was instead paged only when every single sample breached, which is a
   * strictly rarer event and never the one they asked for.
   *
   * Returns a single-element array for the reducing aggregations so the
   * caller compares against the aggregate, and the untouched window for
   * the two set-quantifier types.
   */
  public static reduceWindow(data: {
    values: Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
  }): Array<number> {
    const values: Array<number> = data.values;

    if (values.length === 0) {
      return values;
    }

    switch (data.evaluationType) {
      case EvaluateOverTimeType.Average: {
        const sum: number = values.reduce((a: number, b: number) => {
          return a + b;
        }, 0);
        return [sum / values.length];
      }
      case EvaluateOverTimeType.Sum:
        return [
          values.reduce((a: number, b: number) => {
            return a + b;
          }, 0),
        ];
      case EvaluateOverTimeType.MaximumValue:
        return [Math.max(...values)];
      case EvaluateOverTimeType.MunimumValue:
        return [Math.min(...values)];
      default:
        // AnyValue / AllValues quantify over the window itself.
        return values;
    }
  }

  /*
   * The one place a numeric criteria filter decides whether it is met.
   *
   * `AnyValue` is an existential quantifier, everything else is universal
   * once `reduceWindow` has collapsed the reducing aggregations to a
   * single sample — so "Average > 90" is `[avg].every(v => v > 90)`, which
   * is just `avg > 90`.
   */
  private static evaluateWindow(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    predicate: (value: number) => boolean;
  }): boolean {
    if (!Array.isArray(data.value)) {
      return data.predicate(data.value);
    }

    const values: Array<number> = CompareCriteria.reduceWindow({
      values: data.value,
      evaluationType: data.evaluationType,
    });

    if (values.length === 0) {
      return false;
    }

    if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
      return values.some(data.predicate);
    }

    return values.every(data.predicate);
  }

  /*
   * The samples that actually satisfied the filter.
   *
   * Only used to render the root cause. `getCompareMessage` used to print
   * the WHOLE window and then assert every printed number breached the
   * threshold, so a real alert read "is 72.35, 81.54, 79.95, 91.53, 87.73 %
   * which is greater than 90 %" — four of those five are below 90.
   */
  public static getBreachingValues(data: {
    values: Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    predicate: (value: number) => boolean;
  }): Array<number> {
    return CompareCriteria.reduceWindow({
      values: data.values,
      evaluationType: data.evaluationType,
    }).filter(data.predicate);
  }

  public static greaterThan(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    return CompareCriteria.evaluateWindow({
      value: data.value,
      evaluationType: data.evaluationType,
      predicate: (value: number) => {
        return value > data.threshold;
      },
    });
  }

  public static isTrue(data: {
    value: boolean | Array<boolean>;
    evaluationType?: EvaluateOverTimeType | undefined;
  }): boolean {
    logger.debug(`isTrue: ${JSON.stringify(data)}`);

    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: boolean) => {
          return value === true;
        });
      }
      return data.value.every((value: boolean) => {
        return value === true;
      });
    }

    return data.value === true;
  }

  public static isFalse(data: {
    value: boolean | Array<boolean>;
    evaluationType?: EvaluateOverTimeType | undefined;
  }): boolean {
    logger.debug(`isFalse: ${JSON.stringify(data)}`);

    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: boolean) => {
          return value === false;
        });
      }
      return data.value.every((value: boolean) => {
        return value === false;
      });
    }

    return data.value === false;
  }

  public static lessThan(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    return CompareCriteria.evaluateWindow({
      value: data.value,
      evaluationType: data.evaluationType,
      predicate: (value: number) => {
        return value < data.threshold;
      },
    });
  }

  public static greaterThanOrEqual(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    return CompareCriteria.evaluateWindow({
      value: data.value,
      evaluationType: data.evaluationType,
      predicate: (value: number) => {
        return value >= data.threshold;
      },
    });
  }

  public static lessThanOrEqual(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    return CompareCriteria.evaluateWindow({
      value: data.value,
      evaluationType: data.evaluationType,
      predicate: (value: number) => {
        return value <= data.threshold;
      },
    });
  }

  public static equalTo(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    return CompareCriteria.evaluateWindow({
      value: data.value,
      evaluationType: data.evaluationType,
      predicate: (value: number) => {
        return value === data.threshold;
      },
    });
  }

  public static notEqualTo(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    return CompareCriteria.evaluateWindow({
      value: data.value,
      evaluationType: data.evaluationType,
      predicate: (value: number) => {
        return value !== data.threshold;
      },
    });
  }

  public static convertToNumber(
    threshold: string | number | undefined,
  ): number | null {
    if (threshold === undefined || threshold === null) {
      return null;
    }

    if (typeof threshold === Typeof.String) {
      try {
        threshold = parseInt(threshold as string);
      } catch (err) {
        logger.error(err);
        return null;
      }
    }

    if (typeof threshold !== Typeof.Number) {
      return null;
    }

    /*
     * parseInt("abc") returns NaN rather than throwing, and NaN is typeof
     * "number" — so without this guard a non-numeric threshold would leak
     * past callers that only check for `=== null`, leaving every numeric
     * comparison silently false (value > NaN is always false). Treat an
     * unparseable value the same as a missing one so the caller can ignore
     * it instead of firing a broken criterion.
     */
    if (Number.isNaN(threshold as number)) {
      return null;
    }

    return threshold as number;
  }

  /*
   * A metric-value threshold as a number, fraction included.
   *
   * The criteria form saves what the user typed as a STRING, and
   * convertToNumber's parseInt truncated it: "0.9" on a ratio metric was
   * compared as 0 and fired on every non-zero sample, and "85.5" was
   * compared as 85. Metric values are where a fractional threshold is the
   * natural one to type (ratios, seconds, load averages), so they are
   * parsed with parseFloat. Every other checkOn keeps convertToNumber.
   *
   * Anything that does not parse to a finite number is treated as missing,
   * so the caller ignores the filter instead of comparing against NaN.
   */
  public static convertMetricThresholdToNumber(
    threshold: string | number | undefined,
  ): number | null {
    if (threshold === undefined || threshold === null) {
      return null;
    }

    const parsed: number =
      typeof threshold === Typeof.String
        ? parseFloat(threshold as string)
        : (threshold as number);

    if (typeof parsed !== Typeof.Number || !Number.isFinite(parsed)) {
      return null;
    }

    return parsed;
  }

  public static checkEqualToOrNotEqualTo(data: {
    value: string | number;
    threshold: string | number;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (data.criteriaFilter.filterType === FilterType.EqualTo) {
      if (data.value === data.threshold) {
        return EvaluationSentenceMemo.write(
          translatableSentence("{{check}} is equal to {{threshold}}.", {
            check: evaluationTerm(data.criteriaFilter.checkOn),
            threshold: String(data.threshold),
          }),
        );
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.NotEqualTo) {
      if (data.value !== data.threshold) {
        return EvaluationSentenceMemo.write(
          translatableSentence("{{check}} is not equal to {{threshold}}.", {
            check: evaluationTerm(data.criteriaFilter.checkOn),
            threshold: String(data.threshold),
          }),
        );
      }

      return null;
    }

    return null;
  }

  public static compareEmptyAndNotEmpty(data: {
    value: any;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (data.criteriaFilter.filterType === FilterType.IsEmpty) {
      if (data.value === null || data.value === undefined) {
        return EvaluationSentenceMemo.write(
          translatableSentence("{{check}} is empty.", {
            check: evaluationTerm(data.criteriaFilter.checkOn),
          }),
        );
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.IsNotEmpty) {
      if (data.value !== null && data.value !== undefined) {
        /*
         * A root cause goes out in email, Slack and Teams: the value is
         * redacted, put on one line and bounded (MonitorQuotedValue).
         */
        return EvaluationSentenceMemo.write(
          translatableSentence("{{check}} is not empty. Value: {{value}}", {
            check: evaluationTerm(data.criteriaFilter.checkOn),
            value: MonitorQuotedValue.quote(data.value),
          }),
        );
      }

      return null;
    }

    return null;
  }

  public static compareCriteriaStrings(data: {
    value: string;
    threshold: string;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (data.value === null || data.value === undefined) {
      return null;
    }

    if (data.threshold === null || data.threshold === undefined) {
      return null;
    }

    if (typeof data.value !== Typeof.String) {
      data.value = data.value.toString();
    }

    if (typeof data.threshold !== Typeof.String) {
      data.threshold = data.threshold.toString();
    }

    if (data.criteriaFilter.filterType === FilterType.Contains) {
      if (data.value.includes(data.threshold)) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold,
          criteriaFilter: data.criteriaFilter,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.NotContains) {
      if (!data.value.includes(data.threshold)) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold,
          criteriaFilter: data.criteriaFilter,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.StartsWith) {
      if (data.value.startsWith(data.threshold)) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold,
          criteriaFilter: data.criteriaFilter,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.EndsWith) {
      if (data.value.endsWith(data.threshold)) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold,
          criteriaFilter: data.criteriaFilter,
        });
      }

      return null;
    }

    // check equalto and not equal to
    const equalToOrNotEqualToResult: string | null =
      CompareCriteria.checkEqualToOrNotEqualTo({
        value: data.value,
        threshold: data.threshold,
        criteriaFilter: data.criteriaFilter,
      });

    if (equalToOrNotEqualToResult) {
      return equalToOrNotEqualToResult;
    }

    return null;
  }

  public static compareCriteriaBoolean(data: {
    value: Array<boolean> | boolean;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    logger.debug(`compareCriteriaBoolean: ${JSON.stringify(data)}`);

    if (data.value === null || data.value === undefined) {
      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.True) {
      if (
        CompareCriteria.isTrue({
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: true,
          criteriaFilter: data.criteriaFilter,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.False) {
      if (
        CompareCriteria.isFalse({
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: false,
          criteriaFilter: data.criteriaFilter,
        });
      }

      return null;
    }

    return null;
  }

  public static compareCriteriaNumbers(data: {
    value: Array<number> | number;
    threshold: number;
    criteriaFilter: CriteriaFilter;
    metricDisplayName?: string | undefined;
    unit?: string | undefined;
    /**
     * The metric NAME, when there is a real one. Distinct from
     * metricDisplayName, which is only a label (a configured title or a
     * formula expression). This one feeds
     * ValueFormatter.isFractionMetric, which would read the trailing
     * `_ratio` of a formula like `a / b_ratio` as a signal to multiply
     * the value by 100. Callers pass it only for plain metric criteria.
     */
    metricName?: string | undefined;
  }): string | null {
    if (data.value === null || data.value === undefined) {
      return null;
    }

    if (data.threshold === null || data.threshold === undefined) {
      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.GreaterThan) {
      if (
        CompareCriteria.greaterThan({
          threshold: data.threshold as number,
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold as number,
          criteriaFilter: data.criteriaFilter,
          metricDisplayName: data.metricDisplayName,
          unit: data.unit,
          metricName: data.metricName,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.LessThan) {
      if (
        CompareCriteria.lessThan({
          threshold: data.threshold as number,
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold as number,
          criteriaFilter: data.criteriaFilter,
          metricDisplayName: data.metricDisplayName,
          unit: data.unit,
          metricName: data.metricName,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.EqualTo) {
      if (
        CompareCriteria.equalTo({
          threshold: data.threshold as number,
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold as number,
          criteriaFilter: data.criteriaFilter,
          metricDisplayName: data.metricDisplayName,
          unit: data.unit,
          metricName: data.metricName,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.NotEqualTo) {
      if (
        CompareCriteria.notEqualTo({
          threshold: data.threshold as number,
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold as number,
          criteriaFilter: data.criteriaFilter,
          metricDisplayName: data.metricDisplayName,
          unit: data.unit,
          metricName: data.metricName,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.GreaterThanOrEqualTo) {
      if (
        CompareCriteria.greaterThanOrEqual({
          threshold: data.threshold as number,
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold as number,
          criteriaFilter: data.criteriaFilter,
          metricDisplayName: data.metricDisplayName,
          unit: data.unit,
          metricName: data.metricName,
        });
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.LessThanOrEqualTo) {
      if (
        CompareCriteria.lessThanOrEqual({
          threshold: data.threshold as number,
          value: data.value,
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
        })
      ) {
        return CompareCriteria.getCompareMessage({
          values: data.value,
          threshold: data.threshold as number,
          criteriaFilter: data.criteriaFilter,
          metricDisplayName: data.metricDisplayName,
          unit: data.unit,
          metricName: data.metricName,
        });
      }

      return null;
    }

    return null;
  }

  public static getCompareMessage(data: {
    values: Array<number | boolean> | number | boolean | string;
    threshold: number | string | boolean;
    criteriaFilter: CriteriaFilter;
    metricDisplayName?: string | undefined;
    unit?: string | undefined;
    /**
     * The metric NAME, when there is a real one. Distinct from
     * metricDisplayName, which is only a label (a configured title or a
     * formula expression). This one feeds
     * ValueFormatter.isFractionMetric, which would read the trailing
     * `_ratio` of a formula like `a / b_ratio` as a signal to multiply
     * the value by 100. Callers pass it only for plain metric criteria.
     */
    metricName?: string | undefined;
  }): string {
    /*
     * Its English, remembered with the sentence it is filled from, so the
     * evaluation summary can store the sentence beside it for the Dashboard
     * to word in each reader's language (EvaluationSentenceMemo).
     */
    return EvaluationSentenceMemo.write(CompareCriteria.getCompareSentence(data));
  }

  /*
   * What getCompareMessage says, as the sentence (EvaluationSentence) its
   * English is filled from: every word of it a template, every value - the
   * check's name, the readings, the threshold - a value of the sentence. The
   * English is word for word what this method wrote as text before.
   */
  public static getCompareSentence(data: {
    values: Array<number | boolean> | number | boolean | string;
    threshold: number | string | boolean;
    criteriaFilter: CriteriaFilter;
    metricDisplayName?: string | undefined;
    unit?: string | undefined;
    metricName?: string | undefined;
  }): EvaluationSentence {
    /*
     * Name the type the window was judged with. A boolean series saved with
     * an aggregate is judged as All Values, so it must not read as an average.
     */
    let evaluationType: EvaluateOverTimeType | undefined =
      CriteriaFilterUtil.getEffectiveEvaluateOverTimeType(data.criteriaFilter);

    if (data.criteriaFilter.metricMonitorOptions?.metricAggregationType) {
      evaluationType =
        data.criteriaFilter.metricMonitorOptions.metricAggregationType;
    }

    const label: EvaluationSentenceValue = CompareCriteria.getLabelValue({
      criteriaFilter: data.criteriaFilter,
      metricDisplayName: data.metricDisplayName,
    });

    /*
     * Format each number in its own unit and scale, including the threshold
     * and both ends of a range. Keep the original precision when no unit is
     * available; metric-name hints apply only to plain metrics, not formulas.
     */
    const withUnit: ((value: number) => string) | undefined =
      MetricValueFormatter.hasDisplayableUnit(data.unit, data.metricName)
        ? (value: number): string => {
            return MetricValueFormatter.format({
              value: value,
              unit: data.unit,
              metricName: data.metricName,
            });
          }
        : undefined;

    const numericValues: Array<number | boolean> = Array.isArray(data.values)
      ? data.values
      : typeof data.values === "number"
        ? [data.values]
        : [];

    if (
      typeof data.threshold === "number" &&
      Number.isFinite(data.threshold) &&
      numericValues.length > 0 &&
      numericValues.every((value: number | boolean) => {
        return typeof value === "number" && Number.isFinite(value);
      })
    ) {
      const numericSentence: EvaluationSentence | null =
        CompareCriteria.getNumericCompareSentence({
          values: numericValues as Array<number>,
          isSeries: Array.isArray(data.values),
          threshold: data.threshold,
          filterType: data.criteriaFilter.filterType as FilterType,
          // Use the same precedence as compareCriteriaNumbers.
          evaluationType:
            data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ||
            data.criteriaFilter.metricMonitorOptions?.metricAggregationType,
          label,
          withUnit,
        });

      if (numericSentence !== null) {
        return numericSentence;
      }
    }

    /*
     * Name the quantifier or the aggregation. Before this, only the two
     * set quantifiers were named and the four reducing aggregations
     * produced a bare "Metric Value is 82.62 which is greater than 90",
     * which reads as a contradiction unless you already know the number
     * shown is a five-minute average.
     */
    const subject: EvaluationSentenceValue =
      CompareCriteria.getQuantifiedSubject({
        evaluationType: evaluationType,
        label: label,
      });

    if (
      data.criteriaFilter.filterType === FilterType.True ||
      data.criteriaFilter.filterType === FilterType.False
    ) {
      return translatableSentence("{{subject}} is {{value}}.", {
        subject: subject,
        value: CompareCriteria.getStatedValue(data.threshold),
      });
    }

    /*
     * A text value is what the monitored system sent - a query's result,
     * a record, a script's error - so it is quoted as a root cause may
     * quote it (MonitorQuotedValue). A number is the evaluation's own.
     */
    const values: EvaluationSentenceValue =
      typeof data.values === "string"
        ? MonitorQuotedValue.quote(data.values)
        : CompareCriteria.getCriteriaValuesValue(data.values, withUnit);

    const threshold: EvaluationSentenceValue =
      CompareCriteria.getSingleValueValue(data.threshold, withUnit);

    // A text threshold is the filter's own text, never in a unit.
    const textThreshold: EvaluationSentenceValue =
      CompareCriteria.getSingleValueValue(data.threshold);

    const compared: Record<string, EvaluationSentenceValue> = {
      subject: subject,
      values: values,
      threshold: threshold,
    };

    switch (data.criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        return translatableSentence(
          "{{subject}} is {{values}} which is greater than {{threshold}}.",
          compared,
        );
      case FilterType.GreaterThanOrEqualTo:
        return translatableSentence(
          "{{subject}} is {{values}} which is greater than or equal to {{threshold}}.",
          compared,
        );
      case FilterType.LessThan:
        return translatableSentence(
          "{{subject}} is {{values}} which is less than {{threshold}}.",
          compared,
        );
      case FilterType.LessThanOrEqualTo:
        return translatableSentence(
          "{{subject}} is {{values}} which is less than or equal to {{threshold}}.",
          compared,
        );
      case FilterType.NotEqualTo:
        return translatableSentence(
          "{{subject}} is {{values}} which is not equal to {{threshold}}.",
          compared,
        );
      case FilterType.EqualTo:
        return translatableSentence(
          "{{subject}} is {{values}} which is equal to {{threshold}}.",
          compared,
        );
      case FilterType.Contains:
        return translatableSentence(
          "{{subject}} is {{values}} which is contains {{threshold}}.",
          { ...compared, threshold: textThreshold },
        );
      case FilterType.NotContains:
        return translatableSentence(
          "{{subject}} is {{values}} which is does not contain {{threshold}}.",
          { ...compared, threshold: textThreshold },
        );
      case FilterType.StartsWith:
        return translatableSentence(
          "{{subject}} is {{values}} which is starts with {{threshold}}.",
          { ...compared, threshold: textThreshold },
        );
      case FilterType.EndsWith:
        return translatableSentence(
          "{{subject}} is {{values}} which is ends with {{threshold}}.",
          { ...compared, threshold: textThreshold },
        );
      default:
        return translatableSentence("{{subject}} is {{values}} which is", {
          subject: subject,
          values: values,
        });
    }
  }

  /*
   * What a filter checks, as a sentence names it: the check's name (a term
   * the reader's language words), or a metric's own display name as
   * written; the disk it reads; the window it is judged over.
   */
  private static getLabelValue(data: {
    criteriaFilter: CriteriaFilter;
    metricDisplayName?: string | undefined;
  }): EvaluationSentenceValue {
    /*
     * Prefer a metric-specific display name over the generic "Metric Value"
     * label when evaluating metric monitors.
     */
    let label: EvaluationSentenceValue =
      data.metricDisplayName &&
      data.criteriaFilter.checkOn === CheckOn.MetricValue
        ? data.metricDisplayName
        : evaluationTerm(data.criteriaFilter.checkOn);

    if (data.criteriaFilter.checkOn === CheckOn.DiskUsagePercent) {
      const diskPath: string =
        data.criteriaFilter.serverMonitorOptions?.diskPath || "/";

      label = translatableSentence("{{label}} on disk {{diskPath}}", {
        label: label,
        diskPath: diskPath,
      });
    }

    if (
      data.criteriaFilter.evaluateOverTime &&
      data.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
    ) {
      const minutes: number =
        data.criteriaFilter.evaluateOverTimeOptions.timeValueInMinutes;

      label = translatablePluralSentence(
        {
          one: translationKey("{{label}} over the last {{count}} minute"),
          other: translationKey("{{label}} over the last {{count}} minutes"),
        },
        minutes,
        { label: label },
      );
    }

    return label;
  }

  // "Any value of Is Online", "The average of CPU Usage (in %)", or the label.
  private static getQuantifiedSubject(data: {
    evaluationType: EvaluateOverTimeType | undefined;
    label: EvaluationSentenceValue;
  }): EvaluationSentenceValue {
    const values: Record<string, EvaluationSentenceValue> = {
      label: data.label,
    };

    switch (data.evaluationType) {
      case EvaluateOverTimeType.AnyValue:
        return translatableSentence("Any value of {{label}}", values);
      case EvaluateOverTimeType.AllValues:
        return translatableSentence("All values of {{label}}", values);
      case EvaluateOverTimeType.Average:
        return translatableSentence("The average of {{label}}", values);
      case EvaluateOverTimeType.Sum:
        return translatableSentence("The sum of {{label}}", values);
      case EvaluateOverTimeType.MaximumValue:
        return translatableSentence("The maximum of {{label}}", values);
      case EvaluateOverTimeType.MunimumValue:
        return translatableSentence("The minimum of {{label}}", values);
      default:
        return data.label;
    }
  }

  // A true/false filter's value as it is stated: "true", "false", or as written.
  private static getStatedValue(
    threshold: number | string | boolean,
  ): EvaluationSentenceValue {
    const stated: string = `${threshold}`;

    return stated === "true" || stated === "false"
      ? evaluationTerm(stated)
      : stated;
  }

  private static getNumericCompareSentence(data: {
    values: Array<number>;
    isSeries: boolean;
    threshold: number;
    filterType: FilterType;
    evaluationType: EvaluateOverTimeType | undefined;
    label: EvaluationSentenceValue;
    withUnit: ((value: number) => string) | undefined;
  }): EvaluationSentence | null {
    const predicate: ((value: number) => boolean) | null =
      CompareCriteria.getNumericPredicate(data);
    const threshold: string = CompareCriteria.formatSingleValue(
      data.threshold,
      data.withUnit,
    );

    let comparison: EvaluationSentence | null = null;

    switch (data.filterType) {
      case FilterType.GreaterThan:
        comparison = translatableSentence("above the {{threshold}} threshold", {
          threshold: threshold,
        });
        break;
      case FilterType.GreaterThanOrEqualTo:
        comparison = translatableSentence(
          "at or above the {{threshold}} threshold",
          { threshold: threshold },
        );
        break;
      case FilterType.LessThan:
        comparison = translatableSentence("below the {{threshold}} threshold", {
          threshold: threshold,
        });
        break;
      case FilterType.LessThanOrEqualTo:
        comparison = translatableSentence(
          "at or below the {{threshold}} threshold",
          { threshold: threshold },
        );
        break;
      case FilterType.EqualTo:
        comparison = translatableSentence(
          "equal to the {{threshold}} threshold",
          { threshold: threshold },
        );
        break;
      case FilterType.NotEqualTo:
        comparison = translatableSentence(
          "different from the {{threshold}} threshold",
          { threshold: threshold },
        );
        break;
      default:
        comparison = null;
    }

    if (!comparison || !predicate) {
      return null;
    }

    const isAggregated: boolean =
      data.evaluationType === EvaluateOverTimeType.Average ||
      data.evaluationType === EvaluateOverTimeType.Sum ||
      data.evaluationType === EvaluateOverTimeType.MaximumValue ||
      data.evaluationType === EvaluateOverTimeType.MunimumValue;
    const reducedValues: Array<number> = CompareCriteria.reduceWindow({
      values: data.values,
      evaluationType: data.evaluationType,
    });
    const matchingValues: Array<number> = reducedValues.filter(predicate);
    const reportedValues: Array<number> =
      data.evaluationType === EvaluateOverTimeType.AnyValue &&
      matchingValues.length > 0
        ? matchingValues
        : reducedValues;

    // Avoid listing repeated readings or unbounded windows in notifications.
    let minimum: number = reportedValues[0]!;
    let maximum: number = reportedValues[0]!;
    for (const value of reportedValues) {
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    const low: string = CompareCriteria.formatSingleValue(
      minimum,
      data.withUnit,
    );
    const high: string = CompareCriteria.formatSingleValue(
      maximum,
      data.withUnit,
    );
    const subject: EvaluationSentenceValue = isAggregated
      ? CompareCriteria.getAggregatedSubject(data.evaluationType, data.label)
      : data.label;
    let observation: EvaluationSentence =
      low === high
        ? translatableSentence("{{subject}} was {{value}}", {
            subject: subject,
            value: low,
          })
        : translatableSentence("{{subject}} ranged from {{low}} to {{high}}", {
            subject: subject,
            low: low,
            high: high,
          });

    if (data.isSeries && !isAggregated) {
      let readings: EvaluationSentence = translatableSentence("1 reading");
      if (reportedValues.length < data.values.length) {
        readings = translatableSentence("{{count}} of {{total}} readings", {
          count: String(reportedValues.length),
          total: String(data.values.length),
        });
      } else if (data.values.length > 1) {
        readings = translatableSentence("all {{count}} readings", {
          count: String(data.values.length),
        });
      }
      observation =
        low === high
          ? translatableSentence("{{observation}} in {{readings}}", {
              observation: observation,
              readings: readings,
            })
          : translatableSentence("{{observation}} across {{readings}}", {
              observation: observation,
              readings: readings,
            });
    }

    const matches: boolean =
      data.evaluationType === EvaluateOverTimeType.AnyValue
        ? matchingValues.length > 0
        : matchingValues.length === reducedValues.length;

    if (!matches) {
      // Direct callers can request a description even when a filter did not match.
      return translatableSentence(
        "{{observation}}. The condition requires {{requirement}} to be {{comparison}}.",
        {
          observation: observation,
          requirement: CompareCriteria.getRequirement({
            evaluationType: data.evaluationType,
            isAggregated: isAggregated,
            isSeries: data.isSeries,
          }),
          comparison: comparison,
        },
      );
    }

    return translatableSentence("{{observation}}, {{comparison}}.", {
      observation: observation,
      comparison: comparison,
    });
  }

  // "The average of {{label}}": a reducing aggregation names what it reduced.
  private static getAggregatedSubject(
    evaluationType: EvaluateOverTimeType | undefined,
    label: EvaluationSentenceValue,
  ): EvaluationSentenceValue {
    switch (evaluationType) {
      case EvaluateOverTimeType.Average:
        return translatableSentence("The average of {{label}}", { label });
      case EvaluateOverTimeType.Sum:
        return translatableSentence("The sum of {{label}}", { label });
      case EvaluateOverTimeType.MaximumValue:
        return translatableSentence("The maximum of {{label}}", { label });
      case EvaluateOverTimeType.MunimumValue:
        return translatableSentence("The minimum of {{label}}", { label });
      default:
        return label;
    }
  }

  // What the condition holds to the threshold: "the average", "every reading".
  private static getRequirement(data: {
    evaluationType: EvaluateOverTimeType | undefined;
    isAggregated: boolean;
    isSeries: boolean;
  }): EvaluationSentence {
    if (data.isAggregated) {
      switch (data.evaluationType) {
        case EvaluateOverTimeType.Average:
          return translatableSentence("the average");
        case EvaluateOverTimeType.Sum:
          return translatableSentence("the sum");
        case EvaluateOverTimeType.MaximumValue:
          return translatableSentence("the maximum");
        default:
          return translatableSentence("the minimum");
      }
    }

    if (!data.isSeries) {
      return translatableSentence("the value");
    }

    return data.evaluationType === EvaluateOverTimeType.AnyValue
      ? translatableSentence("at least one reading")
      : translatableSentence("every reading");
  }

  /*
   * The comparison a numeric filter type performs, as a predicate.
   *
   * Kept next to the comparator methods it mirrors so the two cannot
   * drift: a filter type added to `compareCriteriaNumbers` without a case
   * here falls back to quoting the whole window, which is the old
   * behaviour rather than a wrong one.
   */
  private static getNumericPredicate(data: {
    filterType: FilterType;
    threshold: number;
  }): ((value: number) => boolean) | null {
    switch (data.filterType) {
      case FilterType.GreaterThan:
        return (value: number) => {
          return value > data.threshold;
        };
      case FilterType.GreaterThanOrEqualTo:
        return (value: number) => {
          return value >= data.threshold;
        };
      case FilterType.LessThan:
        return (value: number) => {
          return value < data.threshold;
        };
      case FilterType.LessThanOrEqualTo:
        return (value: number) => {
          return value <= data.threshold;
        };
      case FilterType.EqualTo:
        return (value: number) => {
          return value === data.threshold;
        };
      case FilterType.NotEqualTo:
        return (value: number) => {
          return value !== data.threshold;
        };
      default:
        return null;
    }
  }

  /*
   * `withUnit`, when supplied, is how a NUMBER is rendered — unit
   * included. It is threaded down rather than applied to the finished
   * string because the string is not always one number: a large window
   * collapses to "N samples between X and Y", and both X and Y need the
   * unit of their own scale.
   *
   * A value of a sentence (EvaluationSentence): the numbers as written, and
   * the words around them a sentence of their own.
   */
  private static getCriteriaValuesValue(
    values: Array<number | boolean> | number | boolean | string,
    withUnit?: ((value: number) => string) | undefined,
  ): EvaluationSentenceValue {
    if (Array.isArray(values)) {
      /*
       * For a small number of values, list them verbatim so the message
       * reads naturally ("is 42, 55, 60"). For larger arrays, summarize
       * — dumping 30+ numbers on one line makes the root cause unreadable
       * and the detailed breakdown is shown in the Breaching Samples
       * list below.
       */
      const MAX_INLINE: number = 5;

      if (values.length <= MAX_INLINE) {
        if (values.length === 1) {
          return CompareCriteria.getSingleValueValue(values[0], withUnit);
        }

        return values
          .map((value: number | boolean) => {
            return CompareCriteria.formatSingleValue(value, withUnit);
          })
          .join(", ");
      }

      const numericValues: Array<number> = values.filter(
        (value: number | boolean): value is number => {
          return typeof value === "number" && Number.isFinite(value);
        },
      );

      if (numericValues.length === values.length && numericValues.length > 0) {
        const min: number = Math.min(...numericValues);
        const max: number = Math.max(...numericValues);
        return translatableSentence(
          "{{count}} samples between {{low}} and {{high}}",
          {
            count: String(numericValues.length),
            low: CompareCriteria.formatSingleValue(min, withUnit),
            high: CompareCriteria.formatSingleValue(max, withUnit),
          },
        );
      }

      // Fall back to a truncated list when not all values are numeric
      const head: string = values
        .slice(0, MAX_INLINE)
        .map((value: number | boolean) => {
          return CompareCriteria.formatSingleValue(value, withUnit);
        })
        .join(", ");
      return translatableSentence("{{values}}, … ({{count}} values total)", {
        values: head,
        count: String(values.length),
      });
    }

    return CompareCriteria.getSingleValueValue(values, withUnit);
  }

  /*
   * One value as a sentence holds it: a number as written, true, false and
   * unknown as words the reader's language words, a text as it is.
   */
  private static getSingleValueValue(
    value: number | boolean | string | null | undefined,
    withUnit?: ((value: number) => string) | undefined,
  ): EvaluationSentenceValue {
    if (
      value === null ||
      value === undefined ||
      typeof value === Typeof.Boolean
    ) {
      return evaluationTerm(CompareCriteria.formatSingleValue(value, withUnit));
    }

    return CompareCriteria.formatSingleValue(value, withUnit);
  }

  private static formatSingleValue(
    value: number | boolean | string | null | undefined,
    withUnit?: ((value: number) => string) | undefined,
  ): string {
    if (value === null || value === undefined) {
      return "unknown";
    }

    if (typeof value === Typeof.Number) {
      const numericValue: number = value as number;

      if (withUnit) {
        return withUnit(numericValue);
      }

      if (Number.isInteger(numericValue)) {
        return numericValue.toString();
      }

      const roundedValue: number = Number(numericValue.toFixed(2));

      return roundedValue.toString();
    }

    if (typeof value === Typeof.Boolean) {
      return value ? "true" : "false";
    }

    return value.toString();
  }
}
