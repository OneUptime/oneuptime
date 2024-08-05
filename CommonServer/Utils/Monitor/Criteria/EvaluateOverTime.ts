import MonitorMetricsByMinuteService from "../../../Services/MonitorMetricsByMinuteService";
import Query from "../../../Types/AnalyticsDatabase/Query";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  CheckOn,
  EvaluateOverTimeOptions,
  EvaluateOverTimeType,
} from "Common/Types/Monitor/CriteriaFilter";
import ObjectID from "Common/Types/ObjectID";
import MonitorMetricsByMinute from "Common/Models/AnalyticsModels/MonitorMetricsByMinute";

export default class EvaluateOverTime {
  public static async getValueOverTime(data: {
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

    const query: Query<MonitorMetricsByMinute> = {
      createdAt: new GreaterThanOrEqual(lastMinutesDate),
      monitorId: data.monitorId,
      metricType: data.metricType,
    };

    if (data.miscData) {
      query.miscData = data.miscData;
    }

    const monitorMetricsItems: Array<MonitorMetricsByMinute> =
      await MonitorMetricsByMinuteService.findBy({
        query: query,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          metricValue: true,
        },
      });

    const values: Array<number | boolean> = monitorMetricsItems
      .map((item: MonitorMetricsByMinute) => {
        if (data.metricType === CheckOn.IsOnline) {
          return item.metricValue === 1;
        }

        return item.metricValue;
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
