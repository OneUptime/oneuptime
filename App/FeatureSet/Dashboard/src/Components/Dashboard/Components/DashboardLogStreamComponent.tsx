import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardLogStreamComponent from "Common/Types/Dashboard/DashboardComponents/DashboardLogStreamComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Log from "Common/Models/AnalyticsModels/Log";
import API from "Common/UI/Utils/API/API";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";
import {
  queryStringToFilter,
  LogFilter,
} from "Common/Types/Log/LogQueryToFilter";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardLogStreamComponent;
}

type SeverityColor = {
  dot: string;
  text: string;
  bg: string;
};

const getSeverityColor: (severity: string) => SeverityColor = (
  severity: string,
): SeverityColor => {
  const lower: string = severity.toLowerCase();
  if (lower === "fatal") {
    return {
      dot: "bg-purple-500",
      text: "text-purple-700",
      bg: "bg-purple-50",
    };
  }
  if (lower === "error") {
    return { dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" };
  }
  if (lower === "warning") {
    return {
      dot: "bg-yellow-500",
      text: "text-yellow-700",
      bg: "bg-yellow-50",
    };
  }
  if (lower === "information") {
    return { dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" };
  }
  if (lower === "debug") {
    return { dot: "bg-gray-400", text: "text-gray-600", bg: "bg-gray-50" };
  }
  if (lower === "trace") {
    return { dot: "bg-gray-300", text: "text-gray-500", bg: "bg-gray-50" };
  }
  return { dot: "bg-gray-300", text: "text-gray-500", bg: "bg-gray-50" };
};

const DashboardLogStreamComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [logs, setLogs] = React.useState<Array<Log>>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const maxRows: number = props.component.arguments.maxRows || 50;

  const fetchLogs: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);

    const startAndEndDate: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        props.dashboardStartAndEndDate,
      );

    if (!startAndEndDate.startValue || !startAndEndDate.endValue) {
      setIsLoading(false);
      setError("Please select a valid start and end date.");
      return;
    }

    try {
      const query: Query<Log> = {
        time: new InBetween<Date>(
          startAndEndDate.startValue,
          startAndEndDate.endValue,
        ),
      } as Query<Log>;

      // Add severity filter if set
      if (
        props.component.arguments.severityFilter &&
        props.component.arguments.severityFilter !== ""
      ) {
        (query as Record<string, unknown>)["severityText"] =
          props.component.arguments.severityFilter;
      }

      // Add body contains filter if set
      if (
        props.component.arguments.bodyContains &&
        props.component.arguments.bodyContains.trim() !== ""
      ) {
        (query as Record<string, unknown>)["body"] =
          props.component.arguments.bodyContains.trim();
      }

      // Add attribute filters if set
      if (
        props.component.arguments.attributeFilterQuery &&
        props.component.arguments.attributeFilterQuery.trim() !== ""
      ) {
        const parsedFilter: LogFilter = queryStringToFilter(
          props.component.arguments.attributeFilterQuery.trim(),
        );

        if (parsedFilter.attributes) {
          (query as Record<string, unknown>)["attributes"] =
            parsedFilter.attributes;
        }
      }

      const listResult: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({
        modelType: Log,
        query: query,
        limit: maxRows,
        skip: 0,
        select: {
          time: true,
          severityText: true,
          body: true,
          serviceId: true,
          traceId: true,
          spanId: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      });

      setLogs(listResult.data);
      setError("");
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  useEffect(() => {
    fetchLogs();
  }, [
    props.component.arguments.severityFilter,
    props.component.arguments.bodyContains,
    props.component.arguments.attributeFilterQuery,
    props.component.arguments.maxRows,
  ]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          {Array.from({ length: 6 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex gap-2 items-center"
                style={{ opacity: 1 - i * 0.12 }}
              >
                <div className="w-1.5 h-1.5 bg-gray-200 rounded-full"></div>
                <div className="h-3 w-16 bg-gray-100 rounded"></div>
                <div
                  className="h-3 bg-gray-50 rounded flex-1"
                  style={{ maxWidth: `${40 + Math.random() * 50}%` }}
                ></div>
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
            <Icon icon={IconProp.List} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto flex flex-col">
      {props.component.arguments.title && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {props.component.arguments.title}
          </span>
          <span className="text-xs text-gray-300 tabular-nums">
            {logs.length} entries
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto rounded-md border border-gray-100">
        <div className="divide-y divide-gray-50">
          {logs.map((log: Log, index: number) => {
            const severity: string =
              (log.severityText as string) || "Unspecified";
            const colors: SeverityColor = getSeverityColor(severity);
            const body: string = (log.body as string) || "";
            const time: Date | undefined = log.time
              ? OneUptimeDate.fromString(log.time as string)
              : undefined;

            return (
              <div
                key={index}
                className="flex items-start gap-2 px-3 py-1.5 hover:bg-gray-50/50 transition-colors duration-100 group"
              >
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${colors.dot}`}
                  ></div>
                  <span
                    className={`text-xs font-medium ${colors.text} ${colors.bg} px-1 py-0.5 rounded w-12 text-center`}
                    style={{ fontSize: "10px" }}
                  >
                    {severity.substring(0, 4).toUpperCase()}
                  </span>
                </div>
                {time && (
                  <span
                    className="text-xs text-gray-400 shrink-0 tabular-nums"
                    style={{ fontSize: "11px" }}
                  >
                    {OneUptimeDate.getDateAsLocalFormattedString(time, true)}
                  </span>
                )}
                <span
                  className="text-xs text-gray-600 truncate flex-1 font-mono"
                  style={{ fontSize: "11px" }}
                >
                  {body}
                </span>
              </div>
            );
          })}
          {logs.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              No logs found
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardLogStreamComponentElement;
