import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardTableComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTableComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricUtil from "../../Metrics/Utils/Metrics";
import API from "Common/UI/Utils/API/API";
import JSONFunctions from "Common/Types/JSONFunctions";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import OneUptimeDate from "Common/Types/Date";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTableComponent;
}

const DashboardTableComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [metricResults, setMetricResults] = React.useState<
    Array<AggregatedResult>
  >([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const metricViewData: MetricViewData = {
    queryConfigs: props.component.arguments.metricQueryConfig
      ? [props.component.arguments.metricQueryConfig]
      : [],
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate(
      props.dashboardStartAndEndDate,
    ),
    formulaConfigs: [],
  };

  const fetchAggregatedResults: PromiseVoidFunction =
    async (): Promise<void> => {
      setIsLoading(true);

      if (
        !metricViewData.startAndEndDate?.startValue ||
        !metricViewData.startAndEndDate?.endValue
      ) {
        setIsLoading(false);
        setError("Please select a valid start and end date.");
        return;
      }

      if (
        !metricViewData.queryConfigs ||
        metricViewData.queryConfigs.length === 0 ||
        !metricViewData.queryConfigs[0] ||
        !metricViewData.queryConfigs[0].metricQueryData ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData ||
        Object.keys(metricViewData.queryConfigs[0].metricQueryData.filterData)
          .length === 0
      ) {
        setIsLoading(false);
        setError("Please select a metric. Click here to add a metric.");
        return;
      }

      if (
        !metricViewData.queryConfigs[0] ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData ||
        !metricViewData.queryConfigs[0].metricQueryData.filterData
          ?.aggegationType
      ) {
        setIsLoading(false);
        setError(
          "Please select an aggregation. Click here to add an aggregation.",
        );
        return;
      }

      try {
        const results: Array<AggregatedResult> = await MetricUtil.fetchResults({
          metricViewData: metricViewData,
        });

        setMetricResults(results);
        setError("");
      } catch (err: unknown) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      setIsLoading(false);
    };

  useEffect(() => {
    fetchAggregatedResults();
  }, [props.dashboardStartAndEndDate, props.metricTypes, props.refreshTick]);

  const [metricQueryConfig, setMetricQueryConfig] = React.useState<
    MetricQueryConfigData | undefined
  >(props.component.arguments.metricQueryConfig);

  useEffect(() => {
    if (
      JSONFunctions.isJSONObjectDifferent(
        metricQueryConfig || {},
        props.component.arguments.metricQueryConfig || {},
      )
    ) {
      setMetricQueryConfig(props.component.arguments.metricQueryConfig);
      fetchAggregatedResults();
    }
  }, [props.component.arguments.metricQueryConfig]);

  if (isLoading && metricResults.length === 0) {
    // Skeleton loading for table - only on initial load
    return (
      <div className="h-full flex flex-col animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-4">
            <div className="h-3 w-32 bg-gray-100 rounded"></div>
            <div className="h-3 w-16 bg-gray-100 rounded ml-auto"></div>
          </div>
          {Array.from({ length: 5 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex gap-4"
                style={{ opacity: 1 - i * 0.15 }}
              >
                <div className="h-3 w-28 bg-gray-50 rounded"></div>
                <div className="h-3 w-14 bg-gray-50 rounded ml-auto"></div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={IconProp.TableCells} />
          </div>
        </div>
        <ErrorMessage message={error} />
      </div>
    );
  }

  const maxRows: number = props.component.arguments.maxRows || 20;

  const allData: Array<AggregatedModel> = [];
  for (const result of metricResults) {
    for (const item of result.data) {
      allData.push(item);
    }
  }

  const displayData: Array<AggregatedModel> = allData.slice(0, maxRows);

  // Calculate max value for bar visualization
  const maxDataValue: number =
    displayData.length > 0
      ? Math.max(
          ...displayData.map((item: AggregatedModel) => {
            return Math.abs(item.value);
          }),
        )
      : 1;

  return (
    <div
      className="h-full overflow-auto flex flex-col"
      style={{
        opacity: isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {props.component.arguments.tableTitle && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {props.component.arguments.tableTitle}
          </span>
          <span className="text-xs text-gray-300 tabular-nums">
            {displayData.length} rows
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto rounded-md border border-gray-100">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
            <tr>
              <th
                className="px-4 py-2.5 font-medium tracking-wider"
                style={{ width: "45%" }}
              >
                Timestamp
              </th>
              <th
                className="px-4 py-2.5 font-medium tracking-wider text-right"
                style={{ width: "25%" }}
              >
                Value
              </th>
              <th
                className="px-4 py-2.5 font-medium tracking-wider"
                style={{ width: "30%" }}
              ></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {displayData.map((item: AggregatedModel, index: number) => {
              const roundedValue: number = Math.round(item.value * 100) / 100;
              const barWidth: number =
                maxDataValue > 0
                  ? (Math.abs(roundedValue) / maxDataValue) * 100
                  : 0;

              return (
                <tr
                  key={index}
                  className="hover:bg-gray-50/50 transition-colors duration-100 group"
                >
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {OneUptimeDate.getDateAsLocalFormattedString(
                      OneUptimeDate.fromString(item.timestamp),
                    )}
                  </td>
                  <td className="px-4 py-2 font-semibold text-gray-900 text-right tabular-nums text-xs">
                    {roundedValue}
                  </td>
                  <td className="px-3 py-2">
                    <div className="w-full h-3 bg-gray-50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${barWidth}%`,
                          background:
                            "linear-gradient(90deg, rgba(99, 102, 241, 0.2) 0%, rgba(99, 102, 241, 0.4) 100%)",
                        }}
                      ></div>
                    </div>
                  </td>
                </tr>
              );
            })}
            {displayData.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-gray-400 text-sm"
                >
                  No data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DashboardTableComponentElement;
