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
import Span from "Common/Models/AnalyticsModels/Span";
import DashboardResourceList from "../Utils/DashboardResourceList";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  DashboardDateTime,
  getDashboardDateTime,
  getDashboardDateTimeLabel,
} from "../Utils/DashboardDateTime";
import Query from "Common/Types/BaseDatabase/Query";
import JSONFunctions from "Common/Types/JSONFunctions";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
  getSpanStatusPresentation,
} from "../../../Utils/SpanStatusPresentation";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTraceListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Span Name", widthPct: "32%" },
  { label: "Duration", widthPct: "18%" },
  { label: "Status", widthPct: "15%" },
  // Wider than the other columns because it carries a date *and* a time.
  { label: "Time", widthPct: "35%" },
];

const HONEYCOMB_LEGEND: Array<HoneycombLegendItem> =
  SPAN_STATUS_PRESENTATIONS.map(
    (status: SpanStatusPresentation): HoneycombLegendItem => {
      return { label: status.displayLabel, color: status.color };
    },
  );

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
            primaryEntityId: true,
          },
          sort: {
            startTime: SortOrder.Descending,
          },
          requestOptions: DashboardResourceList.getRequestOptions("span", {
            componentId: props.componentId,
            variables: props.variables,
          }),
        });

      setSpans(listResult.data);
      setError(null);
    } catch (err: unknown) {
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    setIsLoading(false);
  }, [
    props.dashboardStartAndEndDate,
    statusFilter,
    maxRows,
    props.componentId,
    props.variables,
  ]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces, props.refreshTick]);

  const honeycombTiles: Array<HoneycombTile> = spans.map(
    (span: Span, index: number): HoneycombTile => {
      const status: SpanStatusPresentation = getSpanStatusPresentation(
        span.statusCode,
      );
      const durationNano: number = (span.durationUnixNano as number) || 0;
      const startTimeLabel: string = getDashboardDateTimeLabel(
        span.startTime as unknown as string | undefined,
        // Spans are sub-second events, so the second is worth showing.
        { showSeconds: true },
      );
      const id: string =
        (span.spanId as string) || (span.traceId as string) || `${index}`;

      return {
        id: id,
        status: status.displayLabel,
        color: status.color,
        tooltip: {
          title: (span.name as string) || "—",
          details: [
            { label: "Duration", value: formatDuration(durationNano) },
            {
              label: "Time",
              value: startTimeLabel,
            },
          ],
        },
      };
    },
  );

  const rows: Array<ReactElement> = spans.map(
    (span: Span, index: number): ReactElement => {
      const status: SpanStatusPresentation = getSpanStatusPresentation(
        span.statusCode,
      );
      const durationNano: number = (span.durationUnixNano as number) || 0;
      const startTime: DashboardDateTime = getDashboardDateTime(
        span.startTime as unknown as string | undefined,
        // Spans are sub-second events, so the second is worth showing.
        { showSeconds: true },
      );

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
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${status.pillClassName} ${status.pillBorderClassName}`}
              style={{ fontSize: "10px" }}
              title={status.description}
            >
              {status.label}
            </span>
          </td>
          <td
            className="px-3 py-2 text-xs text-gray-500 tabular-nums whitespace-nowrap"
            title={startTime.title}
          >
            {startTime.label}
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
