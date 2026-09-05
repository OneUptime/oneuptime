import logger from "../../../Utils/Logger";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import Typeof from "../../../../Types/Typeof";
import CaptureSpan from "../../Telemetry/CaptureSpan";

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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
  public static checkEqualToOrNotEqualTo(data: {
    value: string | number;
    threshold: string | number;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (data.criteriaFilter.filterType === FilterType.EqualTo) {
      if (data.value === data.threshold) {
        return `${data.criteriaFilter.checkOn} is equal to ${data.threshold}.`;
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.NotEqualTo) {
      if (data.value !== data.threshold) {
        return `${data.criteriaFilter.checkOn} is not equal to ${data.threshold}.`;
      }

      return null;
    }

    return null;
  }

  @CaptureSpan()
  public static compareEmptyAndNotEmpty(data: {
    value: any;
    criteriaFilter: CriteriaFilter;
  }): string | null {
    if (data.criteriaFilter.filterType === FilterType.IsEmpty) {
      if (data.value === null || data.value === undefined) {
        return `${data.criteriaFilter.checkOn} is empty.`;
      }

      return null;
    }

    if (data.criteriaFilter.filterType === FilterType.IsNotEmpty) {
      if (data.value !== null && data.value !== undefined) {
        const valueStr: string = String(data.value);
        const truncatedValue: string =
          valueStr.length > 500 ? valueStr.substring(0, 500) + "..." : valueStr;
        return `${data.criteriaFilter.checkOn} is not empty. Value: ${truncatedValue}`;
      }

      return null;
    }

    return null;
  }

  @CaptureSpan()
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

  @CaptureSpan()
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

  @CaptureSpan()
  public static compareCriteriaNumbers(data: {
    value: Array<number> | number;
    threshold: number;
    criteriaFilter: CriteriaFilter;
    metricDisplayName?: string | undefined;
    unit?: string | undefined;
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
        });
      }

      return null;
    }

    return null;
  }

  @CaptureSpan()
  public static getCompareMessage(data: {
    values: Array<number | boolean> | number | boolean | string;
    threshold: number | string | boolean;
    criteriaFilter: CriteriaFilter;
    metricDisplayName?: string | undefined;
    unit?: string | undefined;
  }): string {
    // CPU Percent over the last 5 minutes is 10 which is less than the threshold of 20
    let message: string = "";
    let breachSummary: string = "";

    let evaluationType: EvaluateOverTimeType | undefined =
      data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType;

    if (data.criteriaFilter.metricMonitorOptions?.metricAggregationType) {
      evaluationType =
        data.criteriaFilter.metricMonitorOptions.metricAggregationType;
    }

    /*
     * Name the quantifier or the aggregation. Before this, only the two
     * set quantifiers were named and the four reducing aggregations
     * produced a bare "Metric Value is 82.62 which is greater than 90",
     * which reads as a contradiction unless you already know the number
     * shown is a five-minute average.
     */
    switch (evaluationType) {
      case EvaluateOverTimeType.AnyValue:
        message += "Any value of";
        break;
      case EvaluateOverTimeType.AllValues:
        message += "All values of";
        break;
      case EvaluateOverTimeType.Average:
        message += "The average of";
        break;
      case EvaluateOverTimeType.Sum:
        message += "The sum of";
        break;
      case EvaluateOverTimeType.MaximumValue:
        message += "The maximum of";
        break;
      case EvaluateOverTimeType.MunimumValue:
        message += "The minimum of";
        break;
      default:
        break;
    }

    /*
     * Prefer a metric-specific display name over the generic "Metric Value"
     * label when evaluating metric monitors.
     */
    const label: string =
      data.metricDisplayName &&
      data.criteriaFilter.checkOn === CheckOn.MetricValue
        ? data.metricDisplayName
        : data.criteriaFilter.checkOn;

    message += ` ${label}`;

    if (data.criteriaFilter.checkOn === CheckOn.DiskUsagePercent) {
      const diskPath: string =
        data.criteriaFilter.serverMonitorOptions?.diskPath || "/";

      message += ` on disk ${diskPath}`;
    }

    if (
      data.criteriaFilter.evaluateOverTime &&
      data.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
    ) {
      message += ` over the last ${data.criteriaFilter.evaluateOverTimeOptions.timeValueInMinutes} minutes`;
    }

    const unitSuffix: string = data.unit ? ` ${data.unit}` : "";

    if (
      data.criteriaFilter.filterType !== FilterType.True &&
      data.criteriaFilter.filterType !== FilterType.False
    ) {
      /*
       * Print the samples that actually breached, not the whole window.
       *
       * `AnyValue` is an existential quantifier: it is met when ONE sample
       * crosses the threshold. Printing the entire window and then
       * asserting "which is greater than 90" produced the sentence a real
       * customer received — "is 72.35, 81.54, 79.95, 91.53, 87.73 % which
       * is greater than 90 %" — in which four of the five listed numbers
       * are below the threshold the sentence claims they all exceed.
       *
       * For every other evaluation type the reported set and the compared
       * set are the same thing (a reducing aggregation collapses to one
       * value; AllValues requires all of them), so this narrowing is a
       * no-op and the existing wording is preserved exactly.
       */
      const reportedValues:
        | Array<number | boolean>
        | number
        | boolean
        | string = CompareCriteria.getReportedValues({
        values: data.values,
        threshold: data.threshold,
        filterType: data.criteriaFilter.filterType as FilterType,
        evaluationType: evaluationType,
      });

      const formattedValues: string =
        CompareCriteria.formatCriteriaValues(reportedValues);

      message += ` is ${formattedValues}${unitSuffix}`;

      message += " which is";

      /*
       * How much of the window actually breached.
       *
       * Without it "Any value ... is 91.53 % which is greater than 90 %"
       * is true but hides the thing the reader needs in order to judge
       * whether to get out of bed: whether that was one transient sample
       * or the whole five minutes. One-in-five is a spike; five-in-five is
       * an outage. Only added when the two counts differ, so a fully
       * breaching window keeps the shorter sentence.
       */
      if (
        Array.isArray(data.values) &&
        Array.isArray(reportedValues) &&
        reportedValues.length < data.values.length
      ) {
        breachSummary = ` ${reportedValues.length} of ${data.values.length} samples in the evaluation window breached this threshold.`;
      }
    }

    switch (data.criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        message += ` greater than ${CompareCriteria.formatSingleValue(data.threshold)}${unitSuffix}. `;
        break;
      case FilterType.GreaterThanOrEqualTo:
        message += ` greater than or equal to ${CompareCriteria.formatSingleValue(data.threshold)}${unitSuffix}. `;
        break;
      case FilterType.LessThan:
        message += ` less than ${CompareCriteria.formatSingleValue(data.threshold)}${unitSuffix}. `;
        break;
      case FilterType.LessThanOrEqualTo:
        message += ` less than or equal to ${CompareCriteria.formatSingleValue(data.threshold)}${unitSuffix}. `;
        break;
      case FilterType.NotEqualTo:
        message += ` not equal to ${CompareCriteria.formatSingleValue(data.threshold)}${unitSuffix}. `;
        break;
      case FilterType.EqualTo:
        message += ` equal to ${CompareCriteria.formatSingleValue(data.threshold)}${unitSuffix}. `;
        break;
      case FilterType.Contains:
        message += ` contains ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.NotContains:
        message += ` does not contain ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.True:
        message += ` is ${data.threshold}. `;
        break;
      case FilterType.False:
        message += ` is ${data.threshold}. `;
        break;
      case FilterType.StartsWith:
        message += ` starts with ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.EndsWith:
        message += ` ends with ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
    }

    return `${message.trim()}${breachSummary}`;
  }

  /*
   * Narrow the window down to what the message should quote.
   *
   * Only `AnyValue` needs narrowing — see the comment at the call site.
   * A reducing aggregation is collapsed to its single aggregate so the
   * sentence quotes the average it actually compared, not the raw samples.
   * If nothing is found to breach (a caller rendering a message for a
   * filter that did not match, or a non-numeric window) the original
   * values are returned unchanged rather than an empty list, so the
   * message degrades to its previous behaviour instead of to "is ".
   */
  private static getReportedValues(data: {
    values: Array<number | boolean> | number | boolean | string;
    threshold: number | string | boolean;
    filterType: FilterType;
    evaluationType?: EvaluateOverTimeType | undefined;
  }): Array<number | boolean> | number | boolean | string {
    if (!Array.isArray(data.values)) {
      return data.values;
    }

    if (typeof data.threshold !== Typeof.Number) {
      return data.values;
    }

    const numericValues: Array<number> = data.values.filter(
      (value: number | boolean): value is number => {
        return typeof value === Typeof.Number && Number.isFinite(value);
      },
    );

    if (numericValues.length !== data.values.length) {
      return data.values;
    }

    const predicate: ((value: number) => boolean) | null =
      CompareCriteria.getNumericPredicate({
        filterType: data.filterType,
        threshold: data.threshold as number,
      });

    if (!predicate) {
      return data.values;
    }

    const breaching: Array<number> = CompareCriteria.getBreachingValues({
      values: numericValues,
      evaluationType: data.evaluationType,
      predicate: predicate,
    });

    if (breaching.length === 0) {
      return data.values;
    }

    return breaching;
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

  private static formatCriteriaValues(
    values: Array<number | boolean> | number | boolean | string,
  ): string {
    if (Array.isArray(values)) {
      /*
       * For a small number of values, list them verbatim so the message
       * reads naturally ("is 42, 55, 60"). For larger arrays, summarize
       * — dumping 30+ numbers on one line makes the root cause unreadable
       * and the detailed breakdown is shown in the Breaching Samples
       * table below.
       */
      const MAX_INLINE: number = 5;

      if (values.length <= MAX_INLINE) {
        return values
          .map((value: number | boolean) => {
            return CompareCriteria.formatSingleValue(value);
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
        return `${numericValues.length} samples between ${CompareCriteria.formatSingleValue(
          min,
        )} and ${CompareCriteria.formatSingleValue(max)}`;
      }

      // Fall back to a truncated list when not all values are numeric
      const head: string = values
        .slice(0, MAX_INLINE)
        .map((value: number | boolean) => {
          return CompareCriteria.formatSingleValue(value);
        })
        .join(", ");
      return `${head}, … (${values.length} values total)`;
    }

    return CompareCriteria.formatSingleValue(values);
  }

  private static formatSingleValue(
    value: number | boolean | string | null | undefined,
  ): string {
    if (value === null || value === undefined) {
      return "unknown";
    }

    if (typeof value === Typeof.Number) {
      const numericValue: number = value as number;

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
