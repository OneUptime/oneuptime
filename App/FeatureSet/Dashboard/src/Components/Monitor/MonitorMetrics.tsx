import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import MonitorMetricTypeUtil, {
  MonitorMetricCategory,
} from "Common/Utils/Monitor/MonitorMetricType";
import MetricView from "../Metrics/MetricView";
import ProjectUtil from "Common/UI/Utils/Project";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import API from "Common/UI/Utils/API/API";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ProbeUtil from "../../Utils/Probe";
import Probe from "Common/Models/DatabaseModels/Probe";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Card from "Common/UI/Components/Card/Card";

export interface ComponentProps {
  monitorId: ObjectID;
}

type GetSeriesResolverArgs = {
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
function resolveSeriesTitle(args: GetSeriesResolverArgs): ChartSeries {
  const { data, monitorType, monitorMetricType, probes } = args;

  const fallback: ChartSeries = {
    title: MonitorMetricTypeUtil.getTitleByMonitorMetricType(monitorMetricType),
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

interface CategoryMetricsCardProps {
  category: MonitorMetricCategory;
  queryConfigs: Array<MetricQueryConfigData>;
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (newRange: RangeStartAndEndDateTime) => void;
}

const CategoryMetricsCard: FunctionComponent<CategoryMetricsCardProps> = (
  props: CategoryMetricsCardProps,
): ReactElement => {
  const [viewData, setViewData] = useState<MetricViewData>(() => {
    return {
      startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        props.timeRange,
      ),
      queryConfigs: props.queryConfigs,
      formulaConfigs: [],
    };
  });

  /*
   * Sync view data when the shared time range or regenerated query configs
   * change (e.g. probes finish loading after the initial render).
   */
  useEffect(() => {
    setViewData((prev: MetricViewData) => {
      const dateRange: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(props.timeRange);
      return {
        ...prev,
        startAndEndDate: dateRange,
        queryConfigs: props.queryConfigs,
      };
    });
  }, [props.timeRange, props.queryConfigs]);

  return (
    <Card
      title={props.category.title}
      description={props.category.description}
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={props.timeRange}
          onChange={props.onTimeRangeChange}
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
            queryConfigs: props.queryConfigs,
            formulaConfigs: [],
          });
        }}
      />
    </Card>
  );
};

const MonitorMetricsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorType, setMonitorType] = useState<MonitorType>(
    MonitorType.Manual, // unknown monitor type.
  );

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const fetchMonitor: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    try {
      const item: Monitor | null = await ModelAPI.getItem({
        modelType: Monitor,
        id: props.monitorId,
        select: {
          monitorType: true,
        },
      });

      const monitorType: MonitorType = item?.monitorType || MonitorType.Manual;

      setMonitorType(monitorType);

      const isProbeableMonitor: boolean =
        MonitorTypeHelper.isProbableMonitor(monitorType);

      if (isProbeableMonitor) {
        setProbes(await ProbeUtil.getAllProbes());
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchMonitor().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
  }, []);

  /*
   * Build query configs for a specific metric list. Re-computed when probes
   * or monitor type change so chart series labels refresh correctly.
   */
  const buildQueryConfigs: (
    metrics: Array<MonitorMetricType>,
  ) => Array<MetricQueryConfigData> = useCallback(
    (metrics: Array<MonitorMetricType>): Array<MetricQueryConfigData> => {
      return metrics.map(
        (monitorMetricType: MonitorMetricType): MetricQueryConfigData => {
          return {
            metricAliasData: {
              metricVariable: monitorMetricType,
              title:
                MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                  monitorMetricType,
                ),
              description:
                MonitorMetricTypeUtil.getDescriptionByMonitorMetricType(
                  monitorMetricType,
                ),
              legend:
                MonitorMetricTypeUtil.getLegendByMonitorMetricType(
                  monitorMetricType,
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
                  monitorId: props.monitorId.toString(),
                  projectId:
                    ProjectUtil.getCurrentProjectId()?.toString() || "",
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
            getSeries: (data: AggregateModel): ChartSeries => {
              return resolveSeriesTitle({
                data,
                monitorType,
                monitorMetricType,
                probes,
              });
            },
          };
        },
      );
    },
    [props.monitorId, monitorType, probes],
  );

  const categories: Array<MonitorMetricCategory> = useMemo(() => {
    if (!monitorType) {
      return [];
    }
    return MonitorMetricTypeUtil.getMonitorMetricCategoriesByMonitorType(
      monitorType,
    );
  }, [monitorType]);

  /*
   * Memoise the per-category query configs so each CategoryMetricsCard only
   * re-renders when its own metrics actually change.
   */
  const categoryQueryConfigs: Array<Array<MetricQueryConfigData>> =
    useMemo(() => {
      return categories.map((category: MonitorMetricCategory) => {
        return buildQueryConfigs(category.metrics);
      });
    }, [categories, buildQueryConfigs]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (categories.length === 0) {
    return <></>;
  }

  return (
    <>
      {categories.map(
        (category: MonitorMetricCategory, index: number): ReactElement => {
          return (
            <CategoryMetricsCard
              key={category.title}
              category={category}
              queryConfigs={categoryQueryConfigs[index] || []}
              timeRange={timeRange}
              onTimeRangeChange={handleTimeRangeChange}
            />
          );
        },
      )}
    </>
  );
};

export default MonitorMetricsElement;
