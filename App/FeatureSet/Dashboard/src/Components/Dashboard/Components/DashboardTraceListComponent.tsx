import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import DashboardTraceListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTraceListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import DashboardResourceList from "../Utils/DashboardResourceList";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import Query from "Common/Types/BaseDatabase/Query";
import JSONFunctions from "Common/Types/JSONFunctions";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTraceListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Span Name", widthPct: "35%" },
  { label: "Duration", widthPct: "20%" },
  { label: "Status", widthPct: "15%" },
  { label: "Time", widthPct: "30%" },
];

const STATUS_COLORS: Record<number, { color: string; label: string }> = {
  [SpanStatus.Ok]: { color: "#10b981", label: "Ok" },
  [SpanStatus.Error]: { color: "#ef4444", label: "Error" },
  [SpanStatus.Unset]: { color: "#9ca3af", label: "Unset" },
};

const HONEYCOMB_LEGEND: Array<HoneycombLegendItem> = [
  { label: "Ok", color: STATUS_COLORS[SpanStatus.Ok]!.color },
  { label: "Error", color: STATUS_COLORS[SpanStatus.Error]!.color },
  { label: "Unset", color: STATUS_COLORS[SpanStatus.Unset]!.color },
];

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
  const [spans, setSpans] = useState<Array<Span>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const maxRows: number = props.component.arguments.maxRows || 50;
  const statusFilter: string | undefined =
    props.component.arguments.statusFilter;
  const viewMode: ResourceListViewMode =
    props.component.arguments.viewMode === "honeycomb" ? "honeycomb" : "list";

  const fetchTraces: () => Promise<void> = useCallback(async () => {
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

      if (statusFilter && statusFilter !== "") {
        (query as Record<string, unknown>)["statusCode"] =
          parseInt(statusFilter);
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
          requestOptions: DashboardResourceList.getRequestOptions("span"),
        });

      setSpans(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [props.dashboardStartAndEndDate, statusFilter, maxRows]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = spans.map(
    (span: Span, index: number): HoneycombTile => {
      const statusCode: number =
        (span.statusCode as number) || SpanStatus.Unset;
      const statusInfo: { color: string; label: string } =
        STATUS_COLORS[statusCode] || STATUS_COLORS[SpanStatus.Unset]!;
      const durationNano: number = (span.durationUnixNano as number) || 0;
      const startTime: Date | undefined = span.startTime
        ? OneUptimeDate.fromString(span.startTime as unknown as string)
        : undefined;
      const id: string =
        (span.spanId as string) || (span.traceId as string) || `${index}`;

      return {
        id: id,
        status: statusInfo.label,
        color: statusInfo.color,
        tooltip: {
          title: (span.name as string) || "—",
          details: [
            { label: "Duration", value: formatDuration(durationNano) },
            {
              label: "Time",
              value: startTime
                ? OneUptimeDate.getDateAsLocalFormattedString(startTime, true)
                : "—",
            },
          ],
        },
      };
    },
  );

  const rows: Array<ReactElement> = spans.map(
    (span: Span, index: number): ReactElement => {
      const statusCode: number =
        (span.statusCode as number) || SpanStatus.Unset;
      const statusStyle: StatusStyle = getStatusStyle(statusCode);
      const durationNano: number = (span.durationUnixNano as number) || 0;
      const startTime: Date | undefined = span.startTime
        ? OneUptimeDate.fromString(span.startTime as unknown as string)
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
              ? OneUptimeDate.getDateAsLocalFormattedString(startTime, true)
              : "—"}
          </td>
        </tr>
      );
    },
  );

  return (
    <DashboardResourceListBase
      title={props.component.arguments.title}
      pluralLabel="traces"
      columns={COLUMNS}
      count={spans.length}
      isLoading={isLoading}
      error={error}
      isEmpty={spans.length === 0}
      emptyMessage="No traces found"
      emptyIcon={IconProp.Activity}
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
      honeycombLegend={HONEYCOMB_LEGEND}
    >
      {rows}
    </DashboardResourceListBase>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardTraceListComponentElement, arePropsEqual);
