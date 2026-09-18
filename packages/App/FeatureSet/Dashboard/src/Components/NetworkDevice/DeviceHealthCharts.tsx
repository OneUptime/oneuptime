import MetricView from "../Metrics/MetricView";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
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
  networkDeviceId: ObjectID;
}

/*
 * Health card for the device Overview and Metrics pages: charts the
 * per-interface utilization series and the polled health-OID series (CPU /
 * memory / temperature from vendor templates and the device's custom
 * OIDs).
 *
 * Metrics are DEVICE-scoped (attributes.networkDeviceId), written by the
 * device's own polling pipeline — so these charts work for every
 * registered device, monitors or not.
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
    const projectId: string =
      ProjectUtil.getCurrentProjectId()?.toString() || "";
    const networkDeviceId: string = props.networkDeviceId.toString();

    return [
      {
        metricAliasData: {
          metricVariable: "interface_utilization",
          title: "Interface Utilization",
          description:
            "Per-interface bandwidth utilization. One series per interface.",
          legend: "Utilization",
          legendUnit: "%",
        },
        metricQueryData: {
          filterData: {
            metricName: MonitorMetricType.SnmpInterfaceUtilizationPercent,
            attributes: {
              networkDeviceId: networkDeviceId,
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
      },
      {
        metricAliasData: {
          metricVariable: "oid_values",
          title: "Device Health (Polled OIDs)",
          description:
            "CPU, memory, temperature, and other polled OID values from vendor templates and custom OIDs. One series per OID.",
          legend: "Value",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: MonitorMetricType.SnmpOidValue,
            attributes: {
              networkDeviceId: networkDeviceId,
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
      },
    ];
  }, [props.networkDeviceId]);

  const [viewData, setViewData] = useState<MetricViewData>(() => {
    return {
      startAndEndDate:
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange),
      queryConfigs: queryConfigs,
      formulaConfigs: [],
    };
  });

  // Keep the charts in sync when the time range or device changes.
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

  return (
    <Card
      title="Health"
      description="Interface utilization and polled health metrics collected by this device's polls."
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
