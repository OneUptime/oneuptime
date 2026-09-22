import Probe from "Common/Models/DatabaseModels/Probe";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";

/*
 * How a monitor's own metric (response time, CPU, disk, ...) is charted.
 * Shared by the Metrics tab and the overview's response-time card, so the
 * two always query and label a series the same way.
 */

export type GetSeriesResolverArgs = {
  data: AggregateModel;
  monitorType: MonitorType;
  monitorMetricType: MonitorMetricType;
  probes: Array<Probe>;
};

/*
 * Shared title resolver for a chart series. Extracted so each category's
 * MetricView can reuse the same logic for probe name / disk path / interface
 * grouping without duplicating the closure.
 */
export function resolveSeriesTitle(args: GetSeriesResolverArgs): ChartSeries {
  const { data, monitorType, monitorMetricType, probes } = args;

  const fallback: ChartSeries = {
    title: MonitorMetricTypeUtil.getTitleByMonitorMetricType(
      monitorMetricType,
      monitorType,
    ),
  };

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

  /*
   * Probe-pull monitors group by probe, because the probe is the only thing
   * that varies between two rows of the same series. Database Health relies
   * on that: every one of its series is single-valued per monitor, so it
   * writes no dimension beyond probeId. A future change that fans a database
   * series out per database or per table has to extend this function first,
   * or every one of those series shares the probe's legend.
   */
  if (MonitorTypeHelper.isProbableMonitor(monitorType)) {
    const probeIdString: string | undefined = (attributes as JSONObject)[
      "probeId"
    ] as string | undefined;
    if (!probeIdString) {
      return fallback;
    }
    const probe: Probe | undefined = probes.find((p: Probe) => {
      return p.id?.toString() === new ObjectID(probeIdString).toString();
    });
    return {
      title: probe?.name?.toString() || fallback.title,
    };
  }

  if (monitorType === MonitorType.Server) {
    if (attributes["diskPath"]) {
      return { title: attributes["diskPath"].toString() };
    }
    if (attributes["interfaceName"]) {
      return { title: attributes["interfaceName"].toString() };
    }
  }

  return fallback;
}

/*
 * One chart's query: the metric, filtered to this monitor and project,
 * grouped by attributes so each probe (or disk, or interface) is its own
 * series.
 */
export function buildMonitorMetricQueryConfig(data: {
  monitorId: ObjectID;
  projectId: ObjectID | null;
  monitorType: MonitorType;
  metric: MonitorMetricType;
  probes: Array<Probe>;
}): MetricQueryConfigData {
  const monitorMetricType: MonitorMetricType = data.metric;
  const monitorType: MonitorType = data.monitorType;

  return {
    metricAliasData: {
      metricVariable: monitorMetricType,
      title: MonitorMetricTypeUtil.getTitleByMonitorMetricType(
        monitorMetricType,
        monitorType,
      ),
      description: MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
        monitorMetricType,
        monitorType,
      ),
      legend: MonitorMetricTypeUtil.getLegendByMonitorMetricType(
        monitorMetricType,
        monitorType,
      ),
      legendUnit:
        MonitorMetricTypeUtil.getLegendUnitByMonitorMetricType(
          monitorMetricType,
        ),
    },
    metricQueryData: {
      filterData: {
        metricName: monitorMetricType,
        attributes: {
          monitorId: data.monitorId.toString(),
          projectId: data.projectId?.toString() || "",
        },
        aggegationType:
          MonitorMetricTypeUtil.getAggregationTypeByMonitorMetricType(
            monitorMetricType,
          ),
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: (aggregate: AggregateModel): ChartSeries => {
      return resolveSeriesTitle({
        data: aggregate,
        monitorType: monitorType,
        monitorMetricType: monitorMetricType,
        probes: data.probes,
      });
    },
  };
}
