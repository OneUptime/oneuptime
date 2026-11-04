import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { OpenStackPart } from "./UseOpenStackPart";

/*
 * One chart on a part's Metrics tab: a series of the cloud, narrowed to this part by the
 * labels the exporter gives it. Never Sum: a chart reads one-minute buckets across scrapes,
 * and a Sum adds them together (issue #5433).
 */
export function getOpenStackMetricQuery(data: {
  part: OpenStackPart;
  variable: string;
  title: string;
  description: string;
  metricName: string;
  legend: string;
  legendUnit?: string | undefined;
  attributes: Record<string, string>;
  format?: ((value: number) => string) | undefined;
  transformValue?: ((value: number) => number) | undefined;
}): MetricQueryConfigData {
  const regionName: string | undefined = data.part.row?.regionName;

  return {
    metricAliasData: {
      metricVariable: data.variable,
      title: data.title,
      description: data.description,
      legend: data.legend,
      legendUnit: data.legendUnit || "",
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: {
          "resource.openstack.cloud.name": data.part.cloudName,
          ...(regionName ? { "openstack.region.name": regionName } : {}),
          ...data.attributes,
        },
        aggegationType: AggregationType.Max,
        aggregateBy: {},
      },
      groupBy: { attributes: true },
    },
    yAxisValueFormatter: data.format,
    transformValue: data.transformValue,
  };
}
