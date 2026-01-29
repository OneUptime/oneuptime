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
  @CaptureSpan()
  public static greaterThan(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: number) => {
          return value > data.threshold;
        });
      }
      return data.value.every((value: number) => {
        return value > data.threshold;
      });
    }

    return data.value > data.threshold;
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
    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: number) => {
          return value < data.threshold;
        });
      }
      return data.value.every((value: number) => {
        return value < data.threshold;
      });
    }

    return data.value < data.threshold;
  }

  @CaptureSpan()
  public static greaterThanOrEqual(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: number) => {
          return value >= data.threshold;
        });
      }
      return data.value.every((value: number) => {
        return value >= data.threshold;
      });
    }

    return data.value >= data.threshold;
  }

  @CaptureSpan()
  public static lessThanOrEqual(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: number) => {
          return value <= data.threshold;
        });
      }
      return data.value.every((value: number) => {
        return value <= data.threshold;
      });
    }

    return data.value <= data.threshold;
  }

  @CaptureSpan()
  public static equalTo(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: number) => {
          return value === data.threshold;
        });
      }
      return data.value.every((value: number) => {
        return value === data.threshold;
      });
    }

    return data.value === data.threshold;
  }

  @CaptureSpan()
  public static notEqualTo(data: {
    value: number | Array<number>;
    evaluationType?: EvaluateOverTimeType | undefined;
    threshold: number;
  }): boolean {
    if (Array.isArray(data.value)) {
      if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
        return data.value.some((value: number) => {
          return value !== data.threshold;
        });
      }
      return data.value.every((value: number) => {
        return value !== data.threshold;
      });
    }

    return data.value !== data.threshold;
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
        return `${data.criteriaFilter.checkOn} is not empty.`;
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
  }): string {
    // CPU Percent over the last 5 minutes is 10 which is less than the threshold of 20
    let message: string = "";

    let evaluationType: EvaluateOverTimeType | undefined =
      data.criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType;

    if (data.criteriaFilter.metricMonitorOptions?.metricAggregationType) {
      evaluationType =
        data.criteriaFilter.metricMonitorOptions.metricAggregationType;
    }

    if (evaluationType === EvaluateOverTimeType.AnyValue) {
      message += "Any value of";
    }

    if (evaluationType === EvaluateOverTimeType.AllValues) {
      message += "All values of";
    }

    message += ` ${data.criteriaFilter.checkOn}`;

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

    if (
      data.criteriaFilter.filterType !== FilterType.True &&
      data.criteriaFilter.filterType !== FilterType.False
    ) {
      const formattedValues: string = CompareCriteria.formatCriteriaValues(
        data.values,
      );

      message += ` is ${formattedValues}`;

      message += " which is";
    }

    switch (data.criteriaFilter.filterType) {
      case FilterType.GreaterThan:
        message += ` greater than ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.GreaterThanOrEqualTo:
        message += ` greater than or equal to ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.LessThan:
        message += ` less than ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.LessThanOrEqualTo:
        message += ` less than or equal to ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.NotEqualTo:
        message += ` not equal to ${CompareCriteria.formatSingleValue(data.threshold)}. `;
        break;
      case FilterType.EqualTo:
        message += ` equal to ${CompareCriteria.formatSingleValue(data.threshold)}. `;
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

    return message.trim();
  }

  private static formatCriteriaValues(
    values: Array<number | boolean> | number | boolean | string,
  ): string {
    if (Array.isArray(values)) {
      return values
        .map((value: number | boolean) => {
          return CompareCriteria.formatSingleValue(value);
        })
        .join(", ");
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
