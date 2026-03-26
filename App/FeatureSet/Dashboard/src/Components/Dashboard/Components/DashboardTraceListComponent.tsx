import React, { FunctionComponent, ReactElement, useEffect } from "react";
import DashboardTraceListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTraceListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import API from "Common/UI/Utils/API/API";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTraceListComponent;
}

type StatusStyle = {
  label: string;
  textClass: string;
  bgClass: string;
};

const getStatusStyle: (statusCode: number) => StatusStyle = (
  statusCode: number,
): StatusStyle => {
  if (statusCode === SpanStatus.Error) {
    return {
      label: "Error",
      textClass: "text-red-700",
      bgClass: "bg-red-50 border-red-100",
    };
  }
  if (statusCode === SpanStatus.Ok) {
    return {
      label: "Ok",
      textClass: "text-green-700",
      bgClass: "bg-green-50 border-green-100",
    };
  }
  return {
    label: "Unset",
    textClass: "text-gray-500",
    bgClass: "bg-gray-50 border-gray-100",
  };
};

const formatDuration: (durationNano: number) => string = (
  durationNano: number,
): string => {
  if (durationNano < 1000) {
    return `${durationNano}ns`;
  }
  const durationMicro: number = durationNano / 1000;
  if (durationMicro < 1000) {
    return `${Math.round(durationMicro)}µs`;
  }
  const durationMs: number = durationMicro / 1000;
  if (durationMs < 1000) {
    return `${Math.round(durationMs * 10) / 10}ms`;
  }
  const durationS: number = durationMs / 1000;
  return `${Math.round(durationS * 100) / 100}s`;
};

const DashboardTraceListComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [spans, setSpans] = React.useState<Array<Span>>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  const maxRows: number = props.component.arguments.maxRows || 50;

  const fetchTraces: PromiseVoidFunction = async (): Promise<void> => {
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
      const query: Query<Span> = {
        startTime: new InBetween<Date>(
          startAndEndDate.startValue,
          startAndEndDate.endValue,
        ),
      } as Query<Span>;

      // Add status filter if set
      if (
        props.component.arguments.statusFilter &&
        props.component.arguments.statusFilter !== ""
      ) {
        (query as Record<string, unknown>)["statusCode"] = parseInt(
          props.component.arguments.statusFilter,
        );
      }

      const listResult: ListResult<Span> =
        await AnalyticsModelAPI.getList<Span>({
          modelType: Span,
          query: query,
          limit: maxRows,
          skip: 0,
          select: {
            startTime: true,
            name: true,
            statusCode: true,
            durationUnixNano: true,
            traceId: true,
            spanId: true,
            kind: true,
            serviceId: true,
          },
          sort: {
            startTime: SortOrder.Descending,
          },
          requestOptions: {},
        });

      setSpans(listResult.data);
      setError("");
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchTraces();
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  useEffect(() => {
    fetchTraces();
  }, [
    props.component.arguments.statusFilter,
    props.component.arguments.maxRows,
  ]);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-4">
            <div className="h-3 w-32 bg-gray-100 rounded"></div>
            <div className="h-3 w-16 bg-gray-100 rounded"></div>
            <div className="h-3 w-12 bg-gray-100 rounded ml-auto"></div>
          </div>
          {Array.from({ length: 5 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex gap-4"
                style={{ opacity: 1 - i * 0.15 }}
              >
                <div className="h-3 w-28 bg-gray-50 rounded"></div>
                <div className="h-3 w-14 bg-gray-50 rounded"></div>
                <div className="h-3 w-10 bg-gray-50 rounded ml-auto"></div>
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
            <Icon icon={IconProp.Activity} />
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
            {spans.length} traces
          </span>
        </div>
      )}
      <div className="flex-1 overflow-auto rounded-md border border-gray-100">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
            <tr>
              <th
                className="px-3 py-2.5 font-medium tracking-wider"
                style={{ width: "35%" }}
              >
                Span Name
              </th>
              <th
                className="px-3 py-2.5 font-medium tracking-wider"
                style={{ width: "20%" }}
              >
                Duration
              </th>
              <th
                className="px-3 py-2.5 font-medium tracking-wider"
                style={{ width: "15%" }}
              >
                Status
              </th>
              <th
                className="px-3 py-2.5 font-medium tracking-wider"
                style={{ width: "30%" }}
              >
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {spans.map((span: Span, index: number) => {
              const statusCode: number =
                (span.statusCode as number) || SpanStatus.Unset;
              const statusStyle: StatusStyle = getStatusStyle(statusCode);
              const durationNano: number =
                (span.durationUnixNano as number) || 0;
              const startTime: Date | undefined = span.startTime
                ? OneUptimeDate.fromString(span.startTime as string)
                : undefined;

              return (
                <tr
                  key={index}
                  className="hover:bg-gray-50/50 transition-colors duration-100 group"
                >
                  <td className="px-3 py-2 text-xs text-gray-700 font-mono truncate">
                    {(span.name as string) || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 tabular-nums font-medium">
                    {formatDuration(durationNano)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${statusStyle.textClass} ${statusStyle.bgClass}`}
                      style={{ fontSize: "10px" }}
                    >
                      {statusStyle.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 tabular-nums">
                    {startTime
                      ? OneUptimeDate.getDateAsLocalFormattedString(
                          startTime,
                          true,
                        )
                      : "—"}
                  </td>
                </tr>
              );
            })}
            {spans.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-gray-400 text-sm"
                >
                  No traces found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DashboardTraceListComponentElement;
