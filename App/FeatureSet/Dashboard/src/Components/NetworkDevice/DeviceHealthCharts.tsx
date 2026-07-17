import MetricView from "../Metrics/MetricView";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Card from "Common/UI/Components/Card/Card";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  monitors: Array<Monitor>;
}

/*
 * Health card for the device Overview: charts the per-interface utilization
 * series and the polled OID value series (CPU / memory / temperature from
 * vendor templates and custom OIDs) for every monitor watching this device.
 * Metrics are stored per-monitor (attributes.monitorId), so the queries fan
 * out over the monitors resolved by DeviceMonitorLookupUtil.
 */

/*
 * Chart series resolver: label each series by the grouping attribute the
 * metric carries — interfaceName for interface metrics, oidName (falling
 * back to the raw oid) for polled OID values.
 */
function resolveSeriesTitleFromAttributes(
  data: AggregateModel,
  attributeKeys: Array<string>,
  fallbackTitle: string,
): ChartSeries {
  const fallback: ChartSeries = { title: fallbackTitle };

  if (!data) {
    return fallback;
  }

  let attributes: JSONObject = data["attributes"] as JSONObject;
  if (!attributes) {
    return fallback;
  }
  if (typeof attributes === "string") {
    try {
      attributes = JSONFunctions.parseJSONObject(attributes);
    } catch {
      return fallback;
    }
  }

  for (const key of attributeKeys) {
    const value: string | undefined = attributes[key] as string | undefined;
    if (value) {
      return { title: value.toString() };
    }
  }

  return fallback;
}

const DeviceHealthCharts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const configs: Array<MetricQueryConfigData> = [];
    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";
    const hasManyMonitors: boolean = props.monitors.length > 1;

    props.monitors.forEach((monitor: Monitor, index: number) => {
      const monitorId: string = monitor._id?.toString() || "";
      const titlePrefix: string = hasManyMonitors ? `${monitor.name} — ` : "";

      configs.push({
        metricAliasData: {
          metricVariable: `interface_utilization_${index}`,
          title: `${titlePrefix}Interface Utilization`,
          description:
            "Per-interface bandwidth utilization. One series per interface.",
          legend: "Utilization",
          legendUnit: "%",
        },
        metricQueryData: {
          filterData: {
            metricName: MonitorMetricType.SnmpInterfaceUtilizationPercent,
            attributes: {
              monitorId: monitorId,
              projectId: projectId,
            },
            aggegationType: AggregationType.Max,
          },
          groupBy: {
            attributes: true,
          },
        },
        getSeries: (data: AggregateModel): ChartSeries => {
          return resolveSeriesTitleFromAttributes(
            data,
            ["interfaceName"],
            "Interface Utilization",
          );
        },
      });

      configs.push({
        metricAliasData: {
          metricVariable: `oid_values_${index}`,
          title: `${titlePrefix}Device Health (Polled OIDs)`,
          description:
            "CPU, memory, temperature, and other polled OID values from vendor templates and custom OIDs. One series per OID.",
          legend: "Value",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: MonitorMetricType.SnmpOidValue,
            attributes: {
              monitorId: monitorId,
              projectId: projectId,
            },
            /*
             * SnmpOidValue is a gauge (whatever the OID reports), so average
             * within each time bucket. MonitorMetricTypeUtil's aggregation
             * helper intentionally isn't used here — it throws for metric
             * types outside its per-type switch.
             */
            aggegationType: AggregationType.Avg,
          },
          groupBy: {
            attributes: true,
          },
        },
        getSeries: (data: AggregateModel): ChartSeries => {
          return resolveSeriesTitleFromAttributes(
            data,
            ["oidName", "oid"],
            "OID Value",
          );
        },
      });
    });

    return configs;
  }, [props.monitors]);

  const [viewData, setViewData] = useState<MetricViewData>(() => {
    return {
      startAndEndDate:
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange),
      queryConfigs: queryConfigs,
      formulaConfigs: [],
    };
  });

  // Keep the charts in sync when the time range or monitor list changes.
  useEffect(() => {
    setViewData((prev: MetricViewData) => {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
      return {
        ...prev,
        startAndEndDate: dateRange,
        queryConfigs: queryConfigs,
      };
    });
  }, [timeRange, queryConfigs]);

  if (props.monitors.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Health"
      description="Interface utilization and polled health metrics collected by monitors watching this device."
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={timeRange}
          onChange={(newRange: RangeStartAndEndDateTime) => {
            setTimeRange(newRange);
          }}
        />
      }
    >
      <MetricView
        data={viewData}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        onChange={(data: MetricViewData) => {
          setViewData({
            ...data,
            queryConfigs: queryConfigs,
            formulaConfigs: [],
          });
        }}
      />
    </Card>
  );
};

export default DeviceHealthCharts;
