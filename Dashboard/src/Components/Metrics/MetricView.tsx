import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import MetricQueryConfig, { MetricQueryConfigData } from "./MetricQueryConfig";
import MetricGraphConfig, {
  MetricFormulaConfigData,
} from "./MetricFormulaConfig";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Text from "Common/Types/Text";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import StartAndEndDate, {
  StartAndEndDateType,
} from "Common/UI/Components/Date/StartAndEndDate";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import FieldLabelElement from "Common/UI/Components/Forms/Fields/FieldLabel";
import Card from "Common/UI/Components/Card/Card";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import API from "Common/UI/Utils/API/API";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ComponentLoader from "Common/UI/Components/Compon\entLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ChartGroup, {
  Chart,
  ChartType,
} from "Common/UI/Components/Charts/ChartGroup/ChartGroup";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import IconProp from "Common/Types/Icon/IconProp";
import DashboardNavigation from "../../Utils/Navigation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import Dictionary from "Common/Types/Dictionary";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import { XAxisAggregateType } from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import { YAxisPrecision } from "Common/UI/Components/Charts/Types/YAxis/YAxis";

export interface MetricViewData {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  startAndEndDate: InBetween<Date> | null;
}

export interface ComponentProps {
  data: MetricViewData;
}

const MetricView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {

  const [xAxisType, setXAxisType] = useState<XAxisType>(XAxisType.Time);

  const [chartStartDate, setChartStartDate] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );

  const [chartEndDate, setChartEndDate] = useState<Date>(
    OneUptimeDate.getCurrentDate(),
  );

  const [currentQueryVariable, setCurrentQueryVariable] = useState<string>(
    Text.getLetterFromAByNumber(props.data.queryConfigs.length),
  );

  type GetEmptyQueryConfigFunction = () => MetricQueryConfigData;

  const getEmptyQueryConfigData: GetEmptyQueryConfigFunction =
    (): MetricQueryConfigData => {
      const currentVar: string = currentQueryVariable;
      setCurrentQueryVariable(Text.getNextLowercaseLetter(currentVar));

      return {
        metricAliasData: {
          metricVariable: currentVar,
          title: "",
          description: "",
        },
        metricQueryData: {
          filterData: {
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      };
    };

  const [metricViewData, setMetricViewData] = useState<MetricViewData>(
    props.data,
  );

  const [isPageLoading, setIsPageLoading] = useState<boolean>(false);
  const [pageError, setPageError] = useState<string>("");
  const [allMetricNames, setAllMetricNames] = useState<Array<string>>([]);

  const [telemetryAttributes, setTelemetryAttributes] = useState<Array<string>>(
    [],
  );

  type GetChartXAxisTypeFunction = () => XAxisType;

  const getChartXAxisType: GetChartXAxisTypeFunction = (): XAxisType => {
    if (
      metricViewData.startAndEndDate?.startValue &&
      metricViewData.startAndEndDate?.endValue
    ) {
      // if these are less than a day then we can use time
      const hourDifference: number = OneUptimeDate.getHoursBetweenTwoDates(
        metricViewData.startAndEndDate.startValue as Date,
        metricViewData.startAndEndDate.endValue as Date,
      );

      if (hourDifference <= 24) {
        return XAxisType.Time;
      }
    }

    return XAxisType.Date;
  };


  useEffect(() => {
    fetchAggregatedResults().catch((err: Error) => {
      setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
    });

    loadAllMetricsTypes().catch((err: Error) => {
      setPageError(API.getFriendlyErrorMessage(err as Error));
    });
  }, []);

  type GetChartsFunction = () => Array<Chart>;

  const getCharts: GetChartsFunction = (): Array<Chart> => {
    const charts: Array<Chart> = [];

    let index: number = 0;

    for (const queryConfig of metricViewData.queryConfigs) {
      if (!metricResults[index]) {
        continue;
      }

      let xAxisAggregationType = XAxisAggregateType.Average;

      if(queryConfig.metricQueryData.filterData.aggegationType === MetricsAggregationType.Sum) {
        xAxisAggregationType = XAxisAggregateType.Sum;
      }

      if(queryConfig.metricQueryData.filterData.aggegationType === MetricsAggregationType.Count) {
        xAxisAggregationType = XAxisAggregateType.Sum;
      }

      if(queryConfig.metricQueryData.filterData.aggegationType === MetricsAggregationType.Max) {
        xAxisAggregationType = XAxisAggregateType.Max;
      }

      if(queryConfig.metricQueryData.filterData.aggegationType === MetricsAggregationType.Min) {
        xAxisAggregationType = XAxisAggregateType.Min;
      }

      if(queryConfig.metricQueryData.filterData.aggegationType === MetricsAggregationType.Avg) {
        xAxisAggregationType = XAxisAggregateType.Average;
      }


      const chart: Chart = {
        id: index.toString(),
        type: ChartType.LINE,
        title:
          queryConfig.metricAliasData.title ||
          queryConfig.metricQueryData.filterData.metricName?.toString() ||
          "",
        description: queryConfig.metricAliasData.description,
        props: {
          data: [
            {
              seriesName:
                queryConfig.metricAliasData.title ||
                queryConfig.metricQueryData.filterData.metricName?.toString() ||
                "",
              data: metricResults[index]!.data.map(
                (result: AggregatedModel) => {
                  return {
                    x: OneUptimeDate.fromString(result.timestamp),
                    y: result.value,
                  };
                },
              ),
            },
          ],
          xAxis: {
            legend: "Time",
            options: {
              type: xAxisType,
              max: chartEndDate,
              min: chartStartDate,
              aggregateType: xAxisAggregationType,
            },
          },
          yAxis: {
            legend: "",
            options: {
              type: YAxisType.Number,
              formatter: (value: number) => {
                return `${value}`;
              },
              precision: YAxisPrecision.NoDecimals,
              max: "auto",
              min: "auto",
            },
          },
          curve: ChartCurve.LINEAR,
          sync: true,
        },
      };

      charts.push(chart);

      index++;
    }

    return charts;
  };

  const [metricResults, setMetricResults] = useState<Array<AggregatedResult>>(
    [],
  );
  const [isMetricResultsLoading, setIsMetricResultsLoading] =
    useState<boolean>(false);
  const [metricResultsError, setMetricResultsError] = useState<string>("");

  const loadAllMetricsTypes: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsPageLoading(true);

      const metrics: ListResult<Metric> = await ModelAPI.getList({
        modelType: Metric,
        select: {
          name: true,
        },
        query: {
          projectId: DashboardNavigation.getProjectId()!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {
          name: SortOrder.Ascending,
        },
        groupBy: {
          name: true,
        },
      });

      setAllMetricNames(
        metrics.data.map((metric: Metric) => {
          return metric.name!;
        }),
      );

      const metricAttributesResponse:
        | HTTPResponse<JSONObject>
        | HTTPErrorResponse = await API.post(
        URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/metrics/get-attributes",
        ),
        {},
        {
          ...ModelAPI.getCommonHeaders(),
        },
      );

      if (metricAttributesResponse instanceof HTTPErrorResponse) {
        throw metricAttributesResponse;
      } else {
        const attributes: Array<string> = metricAttributesResponse.data[
          "attributes"
        ] as Array<string>;
        setTelemetryAttributes(attributes);
      }

      setIsPageLoading(false);
      setPageError("");
    } catch (err) {
      setIsPageLoading(false);
      setPageError(API.getFriendlyErrorMessage(err as Error));
    }
  };

  const fetchAggregatedResults: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsMetricResultsLoading(true);

      const results: Array<AggregatedResult> = [];
      try {
        for (const queryConfig of metricViewData.queryConfigs) {
          const result: AggregatedResult = await ModelAPI.aggregate({
            modelType: Metric,
            aggregateBy: {
              query: {
                time: metricViewData.startAndEndDate!,
                name: queryConfig.metricQueryData.filterData.metricName!,
                attributes: queryConfig.metricQueryData.filterData
                  .attributes as Dictionary<string | number | boolean>,
              },
              aggregationType:
                (queryConfig.metricQueryData.filterData
                  .aggegationType as MetricsAggregationType) ||
                MetricsAggregationType.Avg,
              aggregateColumnName: "value",
              aggregationTimestampColumnName: "time",
              startTimestamp:
                (metricViewData.startAndEndDate?.startValue as Date) ||
                OneUptimeDate.getCurrentDate(),
              endTimestamp:
                (metricViewData.startAndEndDate?.endValue as Date) ||
                OneUptimeDate.getCurrentDate(),
              limit: LIMIT_PER_PROJECT,
              skip: 0,
            },
          });

          result.data.map((data: AggregatedModel) => {
            // convert to int from float

            if (data.value) {
              data.value = Math.round(data.value);
            }

            return data;
          });

          results.push(result);
        }

        setMetricResults(results);
        setXAxisType(getChartXAxisType());
        setChartStartDate(metricViewData.startAndEndDate?.startValue as Date);
        setChartEndDate(metricViewData.startAndEndDate?.endValue as Date);

        setMetricResultsError("");
      } catch (err: unknown) {
        setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsMetricResultsLoading(false);
    };

  // type GetEmptyFormulaConfigFunction = () => MetricFormulaConfigData;

  // const getEmptyFormulaConfigData: GetEmptyFormulaConfigFunction =
  //   (): MetricFormulaConfigData => {
  //     return {
  //       metricAliasData: { metricVariable: "", title: "", description: "" },
  //       metricFormulaData: {
  //         metricFormula: "",
  //       },
  //     };
  //   };

  if (isPageLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (pageError) {
    return <ErrorMessage error={pageError} />;
  }

  return (
    <Fragment>
      <div className="space-y-3">
        <Card>
          <div className="-mt-5">
            <FieldLabelElement title="Start and End Time" required={true} />
            <StartAndEndDate
              type={StartAndEndDateType.DateTime}
              initialValue={props.data.startAndEndDate || undefined}
              onValueChanged={(startAndEndDate: InBetween<Date> | null) => {
                setMetricViewData({
                  ...metricViewData,
                  startAndEndDate: startAndEndDate,
                });
              }}
            />
          </div>
        </Card>

        {metricViewData.queryConfigs.map(
          (queryConfig: MetricQueryConfigData, index: number) => {
            return (
              <MetricQueryConfig
                key={index}
                onDataChanged={(data: MetricQueryConfigData) => {
                  const newGraphConfigs: Array<MetricQueryConfigData> = [
                    ...metricViewData.queryConfigs,
                  ];
                  newGraphConfigs[index] = data;
                  setMetricViewData({
                    ...metricViewData,
                    queryConfigs: newGraphConfigs,
                  });
                }}
                data={queryConfig}
                telemetryAttributes={telemetryAttributes}
                metricNames={allMetricNames}
                onRemove={() => {
                  const newGraphConfigs: Array<MetricQueryConfigData> = [
                    ...metricViewData.queryConfigs,
                  ];
                  newGraphConfigs.splice(index, 1);

                  setMetricViewData({
                    ...metricViewData,
                    queryConfigs: newGraphConfigs,
                  });
                }}
              />
            );
          },
        )}
      </div>
      <div className="space-y-3">
        {metricViewData.formulaConfigs.map(
          (formulaConfig: MetricFormulaConfigData, index: number) => {
            return (
              <MetricGraphConfig
                key={index}
                onDataChanged={(data: MetricFormulaConfigData) => {
                  const newGraphConfigs: Array<MetricFormulaConfigData> = [
                    ...metricViewData.formulaConfigs,
                  ];
                  newGraphConfigs[index] = data;
                  setMetricViewData({
                    ...metricViewData,
                    formulaConfigs: newGraphConfigs,
                  });
                }}
                data={formulaConfig}
                onRemove={() => {
                  const newGraphConfigs: Array<MetricFormulaConfigData> = [
                    ...metricViewData.formulaConfigs,
                  ];
                  newGraphConfigs.splice(index, 1);
                  setMetricViewData({
                    ...metricViewData,
                    formulaConfigs: newGraphConfigs,
                  });
                }}
              />
            );
          },
        )}
      </div>
      <div>
        <div className="flex -ml-3 mt-8 justify-between w-full">
          <div>
            <Button
              title="Add Query"
              buttonSize={ButtonSize.Small}
              onClick={() => {
                setMetricViewData({
                  ...metricViewData,
                  queryConfigs: [
                    ...metricViewData.queryConfigs,
                    getEmptyQueryConfigData(),
                  ],
                });
              }}
            />
            {/* <Button
              title="Add Formula"
              buttonSize={ButtonSize.Small}
              onClick={() => {
                setMetricViewData({
                  ...metricViewData,
                  formulaConfigs: [
                    ...metricViewData.formulaConfigs,
                    getEmptyFormulaConfigData(),
                  ],
                });
              }}
            /> */}
          </div>
          <div className="flex items-end -mr-3">
            <Button
              title="Apply"
              icon={IconProp.Play}
              buttonStyle={ButtonStyleType.PRIMARY}
              buttonSize={ButtonSize.Small}
              onClick={fetchAggregatedResults}
            />
          </div>
        </div>
      </div>
      <HorizontalRule />

      {isMetricResultsLoading && <ComponentLoader />}

      {metricResultsError && <ErrorMessage error={metricResultsError} />}

      {!isMetricResultsLoading && !metricResultsError && (
        <div className="grid grid-cols-1 gap-4">
          {/** charts */}
          <ChartGroup charts={getCharts()} />
        </div>
      )}
    </Fragment>
  );
};

export default MetricView;
