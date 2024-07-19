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
} from "CommonUI/src/Components/Button/Button";
import Text from "Common/Types/Text";
import HorizontalRule from "CommonUI/src/Components/HorizontalRule/HorizontalRule";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import StartAndEndDate, {
  StartAndEndDateType,
} from "CommonUI/src/Components/Date/StartAndEndDate";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import FieldLabelElement from "CommonUI/src/Components/Forms/Fields/FieldLabel";
import Card from "CommonUI/src/Components/Card/Card";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import API from "CommonUI/src/Utils/API/API";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "CommonUI/src/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Model/AnalyticsModels/Metric";
import OneUptimeDate from "Common/Types/Date";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ComponentLoader from "CommonUI/src/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "CommonUI/src/Components/ErrorMessage/ErrorMessage";
import ChartGroup, {
  Chart,
  ChartGroupInterval,
  ChartType,
} from "CommonUI/src/Components/Charts/ChartGroup/ChartGroup";
import {
  AxisType,
  ChartCurve,
  XScalePrecision,
  XScaleType,
  YScaleType,
} from "CommonUI/src/Components/Charts/Line/LineChart";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import IconProp from "Common/Types/Icon/IconProp";

export interface MetricViewData {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
  startAndEndDate: InBetween | null;
}

export interface ComponentProps {
  data: MetricViewData;
}

const MetricView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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

  useEffect(() => {
    fetchAggregatedResults().catch((err) => {
      setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
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
          xScale: {
            type: XScaleType.TIME,
            precision: XScalePrecision.HOUR,
            max: "auto",
            min: "auto",
          },
          yScale: {
            type: YScaleType.LINEAR,
            max: "auto",
            min: "auto",
          },
          axisBottom: {
            legend: "Time",
            type: AxisType.Date,
          },
          axisLeft: {
            legend: "Value",
            type: AxisType.Number,
          },
          curve: ChartCurve.LINEAR,
        },
        sync: true,
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
                createdAt: metricViewData.startAndEndDate,
                name: queryConfig.metricQueryData.filterData.metricName,
                attributes: queryConfig.metricQueryData.filterData.attributes,
              },
              aggregateBy:
                (queryConfig.metricQueryData.filterData
                  .aggregateBy as MetricsAggregationType) ||
                MetricsAggregationType.Avg,
              aggregateColumnName: "value",
              aggregationTimestampColumnName: "createdAt",
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

          results.push(result);
        }

        setMetricResults(results);

        setMetricResultsError("");
      } catch (err: unknown) {
        setMetricResultsError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsMetricResultsLoading(false);
    };

  type GetEmptyFormulaConfigFunction = () => MetricFormulaConfigData;

  const getEmptyFormulaConfigData: GetEmptyFormulaConfigFunction =
    (): MetricFormulaConfigData => {
      return {
        metricAliasData: { metricVariable: "", title: "", description: "" },
        metricFormulaData: {
          metricFormula: "",
        },
      };
    };

  return (
    <Fragment>
      <div className="space-y-3">
        <Card>
          <div className="-mt-5">
            <FieldLabelElement title="Start and End Time" required={true} />
            <StartAndEndDate
              type={StartAndEndDateType.DateTime}
              initialValue={props.data.startAndEndDate || undefined}
              onValueChanged={(startAndEndDate: InBetween | null) => {
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
        <div className="flex -ml-3 justify-between w-full">
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
            <Button
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
            />
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
          <ChartGroup
            interval={ChartGroupInterval.ONE_HOUR}
            charts={getCharts()}
          />
        </div>
      )}
    </Fragment>
  );
};

export default MetricView;
