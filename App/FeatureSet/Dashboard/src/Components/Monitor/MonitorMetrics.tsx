import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";
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
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import Card from "Common/UI/Components/Card/Card";

export interface ComponentProps {
  monitorId: ObjectID;
}

const MonitorMetricsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [monitorType, setMonitorType] = useState<MonitorType>(
    MonitorType.Manual, // unknown monitor type.
  );

  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [error, setError] = useState<string>("");

  const [probes, setProbes] = useState<Array<Probe>>([]);

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

  const monitorMetricTypesByMonitor: Array<MonitorMetricType> =
    MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(monitorType);

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  type GetQueryConfigByMonitorMetricTypesFunction =
    () => Array<MetricQueryConfigData>;

  const getQueryConfigByMonitorMetricTypes: GetQueryConfigByMonitorMetricTypesFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      if (!monitorType) {
        return [];
      }

      for (const monitorMetricType of monitorMetricTypesByMonitor) {
        queries.push({
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
                projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
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
            const isProbeableMonitor: boolean =
              MonitorTypeHelper.isProbableMonitor(monitorType);

            if (!data) {
              return {
                title:
                  MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                    monitorMetricType,
                  ),
              };
            }

            if (isProbeableMonitor) {
              let attributes: JSONObject = data["attributes"] as JSONObject;

              if (!attributes) {
                return {
                  title:
                    MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                      monitorMetricType,
                    ),
                };
              }

              // if attributes is typeof string then parse it to JSON

              if (typeof attributes === "string") {
                try {
                  attributes = JSONFunctions.parseJSONObject(attributes);
                } catch {
                  return {
                    title:
                      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                        monitorMetricType,
                      ),
                  };
                }
              }

              const probeId: ObjectID = new ObjectID(
                ((attributes as JSONObject)["probeId"] as string)?.toString(),
              );

              if (!probeId) {
                return {
                  title:
                    MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                      monitorMetricType,
                    ),
                };
              }

              const probe: Probe | undefined = probes.find((probe: Probe) => {
                return probe.id?.toString() === probeId.toString();
              });

              if (probe) {
                return {
                  title:
                    probe.name?.toString() ||
                    MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                      monitorMetricType,
                    ),
                };
              }

              return {
                title:
                  MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                    monitorMetricType,
                  ),
              };
            }

            if (monitorType === MonitorType.Server) {
              let attributes: JSONObject = data["attributes"] as JSONObject;

              if (!attributes) {
                return {
                  title:
                    MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                      monitorMetricType,
                    ),
                };
              }

              // if attributes is typeof string then parse it to JSON

              if (typeof attributes === "string") {
                try {
                  attributes = JSONFunctions.parseJSONObject(attributes);
                } catch {
                  return {
                    title:
                      MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                        monitorMetricType,
                      ),
                  };
                }
              }

              if (attributes["diskPath"]) {
                return {
                  title: attributes["diskPath"].toString(),
                };
              }

              return {
                title:
                  MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                    monitorMetricType,
                  ),
              };
            }

            return {
              title:
                MonitorMetricTypeUtil.getTitleByMonitorMetricType(
                  monitorMetricType,
                ),
            };
          },
        });
      }

      return queries;
    };

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
    queryConfigs: getQueryConfigByMonitorMetricTypes(),
    formulaConfigs: [],
  });

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback(
    (newTimeRange: RangeStartAndEndDateTime): void => {
      setTimeRange(newTimeRange);
      const dateRange = RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange);
      setMetricViewData((prev: MetricViewData) => {
        return {
          ...prev,
          startAndEndDate: dateRange,
        };
      });
    },
    [],
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (monitorMetricTypesByMonitor.length === 0) {
    return <></>;
  }

  return (
    <Card
      title="Monitor Metrics"
      description="Performance metrics collected from this monitor."
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={timeRange}
          onChange={handleTimeRangeChange}
        />
      }
    >
      <MetricView
        data={metricViewData}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData({
            ...data,
            queryConfigs: getQueryConfigByMonitorMetricTypes(),
            formulaConfigs: [],
          });
        }}
      />
    </Card>
  );
};

export default MonitorMetricsElement;
