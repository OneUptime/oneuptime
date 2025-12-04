import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import MonitorMetricTypeUtil from "Common/Utils/Monitor/MonitorMetricType";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
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
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";

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

  // set it to past 1 hour
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -1);

  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  type GetQueryConfigByMonitorMetricTypesFunction =
    () => Array<MetricQueryConfigData>;

  const getQueryConfigByMonitorMetricTypes: GetQueryConfigByMonitorMetricTypesFunction =
    (): Array<MetricQueryConfigData> => {
      const queries: Array<MetricQueryConfigData> = [];

      if (!monitorType) {
        return [];
      }

      for (const monitorMetricType of monitorMetricTypesByMonitor) {
        // Determine chart type - use bar chart for IsOnline and ResponseStatusCode
        const chartType: MetricChartType =
          monitorMetricType === MonitorMetricType.IsOnline ||
          monitorMetricType === MonitorMetricType.ResponseStatusCode
            ? MetricChartType.BAR
            : MetricChartType.LINE;

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
          chartType: chartType,
        });
      }

      return queries;
    };

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: getQueryConfigByMonitorMetricTypes(),
    formulaConfigs: [],
  });

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
    <div>
      <MetricView
        data={metricViewData}
        hideQueryElements={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData({
            ...data,
            queryConfigs: getQueryConfigByMonitorMetricTypes(),
            formulaConfigs: [],
          });
        }}
      />
    </div>
  );
};

export default MonitorMetricsElement;
