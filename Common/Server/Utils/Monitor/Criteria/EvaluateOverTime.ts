import Query from "../../../Types/AnalyticsDatabase/Query";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
} from "../../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../../Types/ObjectID";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import MonitorMetricTypeUtil from "../../../../Utils/Monitor/MonitorMetricType";
import MetricService from "../../../Services/MetricService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import InBetween from "../../../../Types/BaseDatabase/InBetween";

export default class EvaluateOverTime {
  @CaptureSpan()
  public static async getValueOverTime(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    evaluateOverTimeOptions: EvaluateOverTimeOptions;
    metricType: CheckOn;
    miscData?: JSONObject | undefined;
  }): Promise<number | boolean | Array<number | boolean>> {
    // get values over time

    const lastMinutesDate: Date = OneUptimeDate.getSomeMinutesAgo(
      data.evaluateOverTimeOptions.timeValueInMinutes!,
    );

    // TODO: Query over miscData

    const now: Date = OneUptimeDate.getCurrentDate();

    const query: Query<Metric> = {
      projectId: data.projectId,
      time: new InBetween(lastMinutesDate, now),
      serviceId: data.monitorId,
      name: MonitorMetricTypeUtil.getMonitorMeticTypeByCheckOn(data.metricType),
    };

    if (data.miscData) {
      query.attributes = data.miscData;
    }

    const monitorMetricsItems: Array<Metric> = await MetricService.findBy({
      query: query,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
      select: {
        value: true,
      },
    });

    const values: Array<number | boolean> = monitorMetricsItems
      .map((item: Metric) => {
        if (
          data.metricType === CheckOn.IsOnline ||
          data.metricType === CheckOn.IsRequestTimeout
        ) {
          return item.value === 1;
        }

        return item.value;
      })
      .filter((value: number | boolean | undefined) => {
        return value !== undefined;
      }) as Array<number | boolean>;

    if (
      data.evaluateOverTimeOptions.evaluateOverTimeType ===
        EvaluateOverTimeType.AnyValue ||
      data.evaluateOverTimeOptions.evaluateOverTimeType ===
        EvaluateOverTimeType.AllValues
    ) {
      // if its any or all then return the values. Otherwise compute the value based on the type
      return values;
    }

    return this.getValueByEvaluationType({
      values: values as Array<number>,
      evaluateOverTimeType: data.evaluateOverTimeOptions.evaluateOverTimeType!,
    });
  }

  private static getValueByEvaluationType(data: {
    values: Array<number>;
    evaluateOverTimeType: EvaluateOverTimeType;
  }): number {
    switch (data.evaluateOverTimeType) {
      case EvaluateOverTimeType.Average:
        return this.getAverage(data.values);
      case EvaluateOverTimeType.MaximumValue:
        return this.getMax(data.values);
      case EvaluateOverTimeType.MunimumValue:
        return this.getMin(data.values);
      case EvaluateOverTimeType.Sum:
        return this.getSum(data.values);
      default:
        return 0;
    }
  }

  private static getSum(values: number[]): number {
    // get sum of all values
    return values.reduce((a: number, b: number) => {
      return a + b;
    }, 0);
  }

  private static getMin(values: number[]): number {
    // get min value
    return Math.min(...values);
  }

  private static getMax(values: number[]): number {
    // get max value
    return Math.max(...values);
  }

  private static getAverage(values: number[]): number {
    // get average value
    return this.getSum(values) / values.length;
  }
}
