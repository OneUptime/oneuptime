import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import {
  XcpNgMetricDefinition,
  getXcpNgMetricById,
} from "Common/Types/Monitor/XcpNgMetricCatalog";
import {
  XCP_NG_SCOPE_ATTRIBUTE,
  XcpNgLabel,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { chartWordsInReadersLanguage } from "../../../Components/Metrics/Utils/ChartWordsInReadersLanguage";

/*
 * Curated MetricView presets sharing one time-range state - the XCP-ng
 * analog of Pages/Proxmox/View/Insights.tsx. Every chart is an
 * XcpNgMetricCatalog entry, on the pool's own series (its XAPI UUID, the
 * resource attribute xcp_ng.pool.id) and the scope each series describes
 * (the xcp_ng.scope datapoint attribute ingest stamps), split per host, VM
 * or storage repository by the label Xen Orchestra names it with. The
 * network and disk throughputs are Xen Orchestra's per-second rates, which
 * the agent stores as gauges: drawn as they come, never as a rate of a
 * counter. Explicitly NOT computed recommendations.
 */

// The pool's identity on every series, as the XCP-ng Agent stamps it.
const XCP_NG_POOL_RESOURCE_ATTRIBUTE: string = "resource.xcp_ng.pool.id";

export interface XcpNgInsightsChart {
  // An XcpNgMetricCatalog id.
  metricId: string;
  // The labels each line is one of (a host's name, a VM's name...).
  groupByAttributeKeys: Array<string>;
  /*
   * The chart's own words where the catalog's would not fit it: a ratio
   * from 0 to 1 is drawn as a percent, so its description says percent.
   */
  title?: string | undefined;
  description?: string | undefined;
}

export interface XcpNgInsightsSection {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  charts: Array<XcpNgInsightsChart>;
}

export const XCP_NG_INSIGHTS_SECTIONS: ReadonlyArray<XcpNgInsightsSection> = [
  {
    key: "hosts",
    title: translationKey("Hosts"),
    description: translationKey(
      "CPU, load and free memory of each host in the pool.",
    ),
    icon: IconProp.ServerStack,
    charts: [
      {
        metricId: "xcp-host-cpu-average",
        groupByAttributeKeys: [XcpNgLabel.HostName],
        title: translationKey("Host CPU Usage"),
        description: translationKey(
          "A host's CPU use averaged over its cores, in percent.",
        ),
      },
      {
        metricId: "xcp-host-load",
        groupByAttributeKeys: [XcpNgLabel.HostName],
      },
      {
        metricId: "xcp-host-memory-free-bytes",
        groupByAttributeKeys: [XcpNgLabel.HostName],
      },
    ],
  },
  {
    key: "vms",
    title: translationKey("VMs"),
    description: translationKey(
      "CPU and memory of the VMs in the pool, and how long each waited for a CPU.",
    ),
    icon: IconProp.Cube,
    charts: [
      {
        metricId: "xcp-vm-cpu-usage",
        groupByAttributeKeys: [XcpNgLabel.VmName],
        title: translationKey("VM CPU Usage"),
        description: translationKey(
          "A VM's CPU use averaged over its vCPUs, in percent.",
        ),
      },
      {
        metricId: "xcp-vm-memory-bytes",
        groupByAttributeKeys: [XcpNgLabel.VmName],
      },
      {
        metricId: "xcp-vm-runstate-full-contention",
        groupByAttributeKeys: [XcpNgLabel.VmName],
        title: translationKey("VM CPU Contention"),
        description: translationKey(
          "The share of time all of a VM's vCPUs were ready to run but waited for a physical CPU, in percent.",
        ),
      },
    ],
  },
  {
    key: "storage",
    title: translationKey("Storage"),
    description: translationKey(
      "The space each storage repository uses, and how big it is.",
    ),
    icon: IconProp.Database,
    charts: [
      {
        metricId: "xcp-sr-physical-usage-bytes",
        groupByAttributeKeys: [XcpNgLabel.SrName],
      },
      {
        metricId: "xcp-sr-physical-size-bytes",
        groupByAttributeKeys: [XcpNgLabel.SrName],
      },
    ],
  },
  {
    key: "disk",
    title: translationKey("Disk"),
    description: translationKey(
      "Per-second disk reads and writes of the VMs in the pool.",
    ),
    icon: IconProp.Disc,
    charts: [
      {
        metricId: "xcp-vm-disk-read-bytes-total",
        groupByAttributeKeys: [XcpNgLabel.VmName],
      },
      {
        metricId: "xcp-vm-disk-write-bytes-total",
        groupByAttributeKeys: [XcpNgLabel.VmName],
      },
    ],
  },
  {
    key: "network",
    title: translationKey("Network"),
    description: translationKey(
      "Per-second traffic in and out of each host's physical interfaces.",
    ),
    icon: IconProp.Signal,
    charts: [
      {
        metricId: "xcp-host-network-receive-bytes-total",
        groupByAttributeKeys: [XcpNgLabel.HostName, XcpNgLabel.Interface],
      },
      {
        metricId: "xcp-host-network-transmit-bytes-total",
        groupByAttributeKeys: [XcpNgLabel.HostName, XcpNgLabel.Interface],
      },
    ],
  },
];

/*
 * The unit a chart draws a catalog unit in: a ratio from 0 to 1 as a
 * percent (multiplied by 100 once, by the query's transform - the stored
 * series carries no unit of its own, so nothing else scales it), seconds as
 * "s", and the rest as the catalog writes them ("bytes", "bytes/s",
 * "ops/s"), which the chart's ValueFormatter scales and words.
 */
export function getXcpNgChartUnit(unit: string | undefined): string {
  if (!unit || unit === "count") {
    return "";
  }
  if (unit === "ratio") {
    return "%";
  }
  if (unit === "seconds") {
    return "s";
  }
  return unit;
}

const ratioToPercent: (value: number) => number = (value: number): number => {
  return value * 100;
};

export function getXcpNgInsightsQuery(data: {
  chart: XcpNgInsightsChart;
  poolIdentifier: string;
}): MetricQueryConfigData | undefined {
  const metric: XcpNgMetricDefinition | undefined = getXcpNgMetricById(
    data.chart.metricId,
  );

  if (!metric) {
    return undefined;
  }

  return {
    metricAliasData: {
      metricVariable: metric.id.replace(/-/g, "_"),
      title: data.chart.title || metric.friendlyName,
      description: data.chart.description || metric.description,
      legend: data.chart.title || metric.friendlyName,
      legendUnit: getXcpNgChartUnit(metric.unit),
    },
    metricQueryData: {
      filterData: {
        metricName: metric.metricName,
        attributes: {
          [XCP_NG_POOL_RESOURCE_ATTRIBUTE]: data.poolIdentifier,
          [XCP_NG_SCOPE_ATTRIBUTE]: metric.defaultResourceScope,
        },
        aggegationType: metric.defaultAggregation,
        aggregateBy: {},
      },
      groupByAttributeKeys: data.chart.groupByAttributeKeys,
    },
    ...(metric.unit === "ratio" ? { transformValue: ratioToPercent } : {}),
  };
}

/*
 * A section's queries in order, skipping ids the catalog does not have, so a
 * renamed catalog entry drops a chart rather than crashing the page.
 */
export function getXcpNgInsightsQueries(data: {
  section: XcpNgInsightsSection;
  poolIdentifier: string;
}): Array<MetricQueryConfigData> {
  const queries: Array<MetricQueryConfigData> = [];
  for (const chart of data.section.charts) {
    const query: MetricQueryConfigData | undefined = getXcpNgInsightsQuery({
      chart: chart,
      poolIdentifier: data.poolIdentifier,
    });
    if (query) {
      queries.push(query);
    }
  }
  return queries;
}

const XcpNgPoolInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [startAndEndDate, setStartAndEndDate] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
  );

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  const fetchPool: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: XcpNgPool | null = await ModelAPI.getItem({
        modelType: XcpNgPool,
        id: modelId,
        select: {
          name: true,
          poolIdentifier: true,
        },
      });
      setPool(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchPool().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageSkeleton shape="chart" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!pool?.poolIdentifier) {
    return <ErrorMessage message="Pool not found." />;
  }

  const poolIdentifier: string = pool.poolIdentifier;

  return (
    /*
     * The cards share the page's one range, so they share one zoom too: a
     * drag on a chart in any card zooms every card, and a double-click on a
     * chart in any card (or "Reset zoom" beside any card's picker) puts the
     * range back, even after a zoom made in another card.
     */
    <TimeRangeZoomScope
      timeRange={timeRange}
      onTimeRangeChange={handleTimeRangeChange}
    >
      {XCP_NG_INSIGHTS_SECTIONS.map(
        (section: XcpNgInsightsSection): ReactElement => {
          return (
            <EmbeddedMetricCard
              key={section.key}
              title={
                <div className="flex items-center gap-2">
                  <Icon icon={section.icon} className="h-5 w-5 text-gray-500" />
                  <span>{translator.translateText(section.title)}</span>
                </div>
              }
              isTitleTranslated={true}
              description={section.description}
              queryConfigs={chartWordsInReadersLanguage(
                getXcpNgInsightsQueries({
                  section: section,
                  poolIdentifier: poolIdentifier,
                }),
                translator,
              )}
              timeRange={timeRange}
              onTimeRangeChange={handleTimeRangeChange}
              startAndEndDate={startAndEndDate}
            />
          );
        },
      )}
    </TimeRangeZoomScope>
  );
};

export default XcpNgPoolInsights;
