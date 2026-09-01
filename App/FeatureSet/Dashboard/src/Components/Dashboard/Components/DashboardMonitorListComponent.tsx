import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DashboardMonitorListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardMonitorListComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import DashboardResourceListBase, {
  ResourceListColumn,
  ResourceListViewMode,
} from "./DashboardResourceListBase";
import { HoneycombTile } from "./DashboardResourceHoneycomb";
import {
  StateTimelineAxisTick,
  StateTimelineLegendItem,
  StateTimelineRow,
  StateTimelineSegment,
  StateTimelineTooltipDetail,
} from "./DashboardResourceStateTimeline";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import DashboardResourceList from "../Utils/DashboardResourceList";
import MonitorStateTimelineWidgetData from "../Utils/MonitorStateTimelineWidgetData";
import {
  getDashboardDateTimeLabel,
  getDashboardTimelineAxisLabel,
} from "../Utils/DashboardDateTime";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import API from "Common/UI/Utils/API/API";
import IconProp from "Common/Types/Icon/IconProp";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import JSONFunctions from "Common/Types/JSONFunctions";
import OneUptimeDate from "Common/Types/Date";
import ProjectUtil from "Common/UI/Utils/Project";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Color from "Common/Types/Color";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import MonitorStateTimelineUtil, {
  MonitorStateTimelineLegendItem,
  MonitorStateTimelineRow,
  MonitorStateTimelineSegment,
} from "Common/Utils/Monitor/MonitorStateTimelineUtil";
import MonitorStateTimelineTooltipField, {
  MonitorStateTimelineTooltipFieldUtil,
} from "Common/Types/Dashboard/MonitorStateTimelineTooltipField";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardMonitorListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Name", widthPct: "55%" },
  { label: "Status", widthPct: "30%" },
  { label: "Type", widthPct: "15%" },
];

const NO_VALUE_LABEL: string = "—";
const ONGOING_LABEL: string = "Ongoing";

/*
 * Labels stop being time-only once the window is longer than a day, so a
 * long window gets fewer, wider ticks and a short one gets more.
 */
const ONE_DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const TICK_COUNT_FOR_SHORT_WINDOW: number = 4;
const TICK_COUNT_FOR_LONG_WINDOW: number = 3;

const DashboardMonitorListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [monitors, setMonitors] = useState<Array<Monitor>>([]);
  const [statusTimelines, setStatusTimelines] = useState<
    Array<MonitorStatusTimeline>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * Which fetch is the current one. The timeline mode issues two sequential
   * requests, so a range change part way through leaves an older, narrower
   * window still in flight; without this guard its late response overwrites
   * the newer one and the lanes render a truncated history and a wrong uptime
   * against the window the axis is labelled with.
   */
  const fetchGeneration: React.MutableRefObject<number> = useRef<number>(0);

  const maxRows: number = props.component.arguments.maxRows || 25;

  const viewMode: ResourceListViewMode =
    props.component.arguments.viewMode === "honeycomb"
      ? "honeycomb"
      : props.component.arguments.viewMode === "timeline"
        ? "timeline"
        : "list";

  const isTimelineView: boolean = viewMode === "timeline";

  const statusFilter: string | undefined =
    props.component.arguments.statusFilter;
  const monitorStatusIds: Array<string> | undefined =
    props.component.arguments.monitorStatusIds;
  const monitorTypes: Array<string> | undefined =
    props.component.arguments.monitorTypes;
  const labelIds: Array<string> | undefined =
    props.component.arguments.labelIds;

  const monitorStatusIdsKey: string = (monitorStatusIds || []).join(",");
  const monitorTypesKey: string = (monitorTypes || []).join(",");
  const labelIdsKey: string = (labelIds || []).join(",");

  /*
   * Re-resolved on every refresh tick as well as on a range change: a
   * relative range like "Past 1 hour" means something different each time the
   * dashboard refreshes, and a timeline that kept the first window would
   * silently stop advancing.
   */
  const timelineWindow: { startDate: Date; endDate: Date } = useMemo(() => {
    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        props.dashboardStartAndEndDate,
      );

    /*
     * Clamped BEFORE anything is drawn or requested. The public route applies
     * the same ceiling server side; without matching it here, an over-long
     * CUSTOM range would draw an axis spanning months against history the
     * server only returned the tail of.
     */
    return MonitorStateTimelineUtil.clampWindow({
      startDate: range.startValue,
      endDate: range.endValue,
    });
    /*
     * refreshTick is a deliberate extra dependency, not an oversight: on a
     * relative range the resolver reads the wall clock, so the window has to
     * be recomputed on every auto-refresh or the timeline stops advancing.
     */
  }, [props.dashboardStartAndEndDate, props.refreshTick]);

  /*
   * What the monitor fetch actually depends on. In list and honeycomb mode the
   * query is time-independent, so keying the fetch on the window itself would
   * refire every Monitor List widget on the board on every range change, for
   * data that cannot have changed.
   */
  const timelineWindowKey: string = isTimelineView
    ? `${timelineWindow.startDate.getTime()}-${timelineWindow.endDate.getTime()}`
    : "";

  const fetchMonitors: () => Promise<void> = useCallback(async () => {
    const generation: number = ++fetchGeneration.current;

    setIsLoading(true);

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!DashboardResourceList.isPublic() && !projectId) {
      setIsLoading(false);
      setError("No project selected.");
      return;
    }

    try {
      const query: Query<Monitor> = {
        projectId: projectId,
      } as Query<Monitor>;

      if (statusFilter === "operational") {
        (query as Record<string, unknown>)["currentMonitorStatus"] = {
          isOperationalState: true,
        };
      } else if (statusFilter === "non-operational") {
        (query as Record<string, unknown>)["currentMonitorStatus"] = {
          isOperationalState: false,
        };
      }

      if (monitorStatusIds && monitorStatusIds.length > 0) {
        (query as Record<string, unknown>)["currentMonitorStatusId"] =
          new Includes(monitorStatusIds);
      }

      if (monitorTypes && monitorTypes.length > 0) {
        (query as Record<string, unknown>)["monitorType"] = new Includes(
          monitorTypes,
        );
      }

      if (labelIds && labelIds.length > 0) {
        (query as Record<string, unknown>)["labels"] = new Includes(labelIds);
      }

      const listResult: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        requestOptions: DashboardResourceList.getRequestOptions("monitor", {
          componentId: props.componentId,
          variables: props.variables,
        }),
        query: query,
        limit: maxRows,
        skip: 0,
        select: {
          _id: true,
          name: true,
          monitorType: true,
          currentMonitorStatus: {
            name: true,
            color: true,
          },
        },
        sort: {
          name: SortOrder.Ascending,
        },
      });

      /*
       * The timeline is a second read, and only in the mode that draws it —
       * a list or honeycomb widget must not pay for status history it never
       * renders.
       */
      let nextStatusTimelines: Array<MonitorStatusTimeline> = [];

      if (isTimelineView) {
        nextStatusTimelines =
          await MonitorStateTimelineWidgetData.fetchStatusTimelines({
            componentId: props.componentId,
            monitorIds: listResult.data
              .map((monitor: Monitor) => {
                return monitor.id;
              })
              .filter((id: ObjectID | null): id is ObjectID => {
                return id !== null;
              }),
            projectId: projectId,
            startDate: timelineWindow.startDate,
            endDate: timelineWindow.endDate,
            variables: props.variables,
          });
      }

      if (generation !== fetchGeneration.current) {
        // A newer fetch started while this one was in flight; it owns the state.
        return;
      }

      /*
       * Both together, after both reads. Committing the monitors first would
       * end the skeleton (its guard is isLoading && count === 0) and paint a
       * full set of "No status history" lanes for the whole of the second
       * round trip, then jump the track narrower when the uptime column
       * finally appears.
       */
      setMonitors(listResult.data);
      setStatusTimelines(nextStatusTimelines);
      setError(null);
    } catch (err: unknown) {
      if (generation !== fetchGeneration.current) {
        return;
      }

      setError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      if (generation === fetchGeneration.current) {
        setIsLoading(false);
      }
    }
  }, [
    maxRows,
    statusFilter,
    monitorStatusIdsKey,
    monitorTypesKey,
    labelIdsKey,
    isTimelineView,
    timelineWindowKey,
    props.componentId,
    props.variables,
  ]);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors, props.refreshTick]);

  type GetMonitorRouteFunction = (monitorId: string) => Route | undefined;

  const getMonitorRoute: GetMonitorRouteFunction = (
    monitorId: string,
  ): Route | undefined => {
    if (!monitorId) {
      return undefined;
    }

    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.MONITOR_VIEW] as Route,
      { modelId: new ObjectID(monitorId) },
    );
  };

  const honeycombTiles: Array<HoneycombTile> = monitors.map(
    (monitor: Monitor): HoneycombTile => {
      const monitorId: string = (monitor._id as string) || "";
      const name: string = (monitor.name as string) || "Unnamed";
      const statusName: string =
        (monitor.currentMonitorStatus?.name as string) || "Unknown";
      const statusColor: Color | undefined = monitor.currentMonitorStatus
        ?.color as Color | undefined;
      const monitorType: string = (monitor.monitorType as string) || "—";

      return {
        id: monitorId || name,
        status: statusName,
        color: statusColor ? statusColor.toString() : "#9ca3af",
        route: getMonitorRoute(monitorId),
        tooltip: {
          title: name,
          details: [{ label: "Type", value: monitorType }],
        },
      };
    },
  );

  // ── state timeline ────────────────────────────────────────────────────

  const timelineRows: Array<MonitorStateTimelineRow> = useMemo(() => {
    if (!isTimelineView) {
      return [];
    }

    return MonitorStateTimelineUtil.buildRows({
      monitors: monitors.map((monitor: Monitor) => {
        return {
          monitorId: (monitor._id as string) || "",
          monitorName: (monitor.name as string) || "Unnamed",
        };
      }),
      statusTimelines: statusTimelines,
      startDate: timelineWindow.startDate,
      endDate: timelineWindow.endDate,
    });
  }, [isTimelineView, monitors, statusTimelines, timelineWindow]);

  const tooltipFields: Array<MonitorStateTimelineTooltipField> = useMemo(() => {
    return MonitorStateTimelineTooltipFieldUtil.resolveFields(
      props.component.arguments.timelineTooltipFields,
    );
  }, [props.component.arguments.timelineTooltipFields]);

  type GetTooltipValueFunction = (data: {
    field: MonitorStateTimelineTooltipField;
    row: MonitorStateTimelineRow;
    segment: MonitorStateTimelineSegment;
    monitorType: string;
  }) => string;

  const getTooltipValue: GetTooltipValueFunction = (data: {
    field: MonitorStateTimelineTooltipField;
    row: MonitorStateTimelineRow;
    segment: MonitorStateTimelineSegment;
    monitorType: string;
  }): string => {
    const { field, row, segment, monitorType } = data;

    switch (field) {
      case MonitorStateTimelineTooltipField.Status:
        return segment.label;
      case MonitorStateTimelineTooltipField.StartedAt:
        return getDashboardDateTimeLabel(segment.startDate);
      case MonitorStateTimelineTooltipField.EndedAt:
        /*
         * A run that had not ended when the window closed has no end to
         * report — printing the clipped one reads as "Ended: <now>" over an
         * outage that is still happening.
         */
        return segment.continuesAfterWindow
          ? ONGOING_LABEL
          : getDashboardDateTimeLabel(segment.endDate);
      case MonitorStateTimelineTooltipField.Duration:
        return OneUptimeDate.secondsToFormattedFriendlyTimeString(
          segment.durationInSeconds,
        );
      case MonitorStateTimelineTooltipField.UptimePercent:
        return row.uptimePercent === null
          ? NO_VALUE_LABEL
          : `${row.uptimePercent}%`;
      case MonitorStateTimelineTooltipField.CurrentStatus:
        return row.currentStatusName || NO_VALUE_LABEL;
      case MonitorStateTimelineTooltipField.LastStatusChange:
        return row.lastStatusChangeAt
          ? getDashboardDateTimeLabel(row.lastStatusChangeAt)
          : NO_VALUE_LABEL;
      case MonitorStateTimelineTooltipField.MonitorType:
        return monitorType;
      default:
        return NO_VALUE_LABEL;
    }
  };

  const timelineViewRows: Array<StateTimelineRow> = useMemo(() => {
    const monitorTypeById: Map<string, string> = new Map<string, string>(
      monitors.map((monitor: Monitor): [string, string] => {
        return [
          (monitor._id as string) || "",
          (monitor.monitorType as string) || NO_VALUE_LABEL,
        ];
      }),
    );

    return timelineRows.map(
      (row: MonitorStateTimelineRow): StateTimelineRow => {
        const monitorType: string =
          monitorTypeById.get(row.monitorId) || NO_VALUE_LABEL;

        const segments: Array<StateTimelineSegment> = row.segments.map(
          (
            segment: MonitorStateTimelineSegment,
            index: number,
          ): StateTimelineSegment => {
            const tooltipDetails: Array<StateTimelineTooltipDetail> =
              tooltipFields.map(
                (
                  field: MonitorStateTimelineTooltipField,
                ): StateTimelineTooltipDetail => {
                  return {
                    label: MonitorStateTimelineTooltipFieldUtil.getTitle(field),
                    value: getTooltipValue({
                      field,
                      row,
                      segment,
                      monitorType,
                    }),
                  };
                },
              );

            return {
              /*
               * Index, not status id: a monitor that flaps between two statuses
               * produces repeated status ids in one lane, and React would
               * collapse them into one key.
               */
              id: `${row.monitorId}-${index}`,
              label: segment.label,
              color: segment.color,
              startPercent: segment.startPercent,
              widthPercent: segment.widthPercent,
              tooltipDetails: tooltipDetails,
            };
          },
        );

        const uptimeLabel: string | undefined =
          row.uptimePercent === null ? undefined : `${row.uptimePercent}%`;

        /*
         * "at the end of this time range", not "currently": on a custom range
         * that ends in the past the last bar is not the monitor's status now,
         * and the same widget's list mode would announce a different one.
         */
        const ariaLabel: string =
          row.segments.length === 0
            ? `${row.monitorName}: no status history in this time range.`
            : `${row.monitorName}: ${row.currentStatusName} at the end of this time range, ${uptimeLabel} uptime.`;

        return {
          id: row.monitorId,
          label: row.monitorName,
          route: getMonitorRoute(row.monitorId),
          segments: segments,
          ...(uptimeLabel === undefined ? {} : { trailingLabel: uptimeLabel }),
          ariaLabel: ariaLabel,
        };
      },
    );
  }, [timelineRows, monitors, tooltipFields]);

  const timelineAxisTicks: Array<StateTimelineAxisTick> = useMemo(() => {
    if (!isTimelineView) {
      return [];
    }

    const isLongWindow: boolean =
      timelineWindow.endDate.getTime() - timelineWindow.startDate.getTime() >
      ONE_DAY_IN_MS;

    return MonitorStateTimelineUtil.getAxisTicks({
      startDate: timelineWindow.startDate,
      endDate: timelineWindow.endDate,
      tickCount: isLongWindow
        ? TICK_COUNT_FOR_LONG_WINDOW
        : TICK_COUNT_FOR_SHORT_WINDOW,
    }).map((tick: { date: Date; percent: number }): StateTimelineAxisTick => {
      return {
        label: getDashboardTimelineAxisLabel(tick.date, {
          includeDate: isLongWindow,
        }),
        percent: tick.percent,
      };
    });
  }, [isTimelineView, timelineWindow]);

  const timelineLegend: Array<StateTimelineLegendItem> = useMemo(() => {
    return MonitorStateTimelineUtil.getLegend(timelineRows).map(
      (item: MonitorStateTimelineLegendItem): StateTimelineLegendItem => {
        return { label: item.label, color: item.color };
      },
    );
  }, [timelineRows]);

  // ── list ──────────────────────────────────────────────────────────────

  const rows: Array<ReactElement> = monitors.map(
    (monitor: Monitor): ReactElement => {
      const monitorId: string = (monitor._id as string) || "";
      const statusName: string =
        (monitor.currentMonitorStatus?.name as string) || "Unknown";
      const statusColor: Color | undefined = monitor.currentMonitorStatus
        ?.color as Color | undefined;
      const monitorType: string = (monitor.monitorType as string) || "—";

      const detailRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_VIEW] as Route,
        { modelId: new ObjectID(monitorId) },
      );

      return (
        <tr
          key={monitorId}
          className="hover:bg-gray-50/50 transition-colors duration-100 group"
        >
          <td className="px-3 py-2 text-xs text-gray-700 truncate">
            <AppLink
              to={detailRoute}
              className="hover:underline text-gray-700 group-hover:text-blue-600"
            >
              {(monitor.name as string) || "Unnamed"}
            </AppLink>
          </td>
          <td className="px-3 py-2">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium"
              style={{ fontSize: "10px" }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: statusColor
                    ? statusColor.toString()
                    : "#9ca3af",
                }}
              ></span>
              <span
                style={{
                  color: statusColor ? statusColor.toString() : "#6b7280",
                }}
              >
                {statusName}
              </span>
            </span>
          </td>
          <td className="px-3 py-2 text-xs text-gray-500">{monitorType}</td>
        </tr>
      );
    },
  );

  return (
    <DashboardResourceListBase
      title={props.component.arguments.title}
      pluralLabel="monitors"
      columns={COLUMNS}
      count={monitors.length}
      isLoading={isLoading}
      error={error}
      isEmpty={monitors.length === 0}
      emptyMessage="No monitors found"
      emptyIcon={IconProp.AltGlobe}
      viewMode={viewMode}
      honeycombTiles={honeycombTiles}
      timelineRows={timelineViewRows}
      timelineAxisTicks={timelineAxisTicks}
      timelineLegend={timelineLegend}
      timelineNoDataLabel="No status history"
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

  /*
   * The State Timeline is the one view mode whose data depends on the
   * dashboard's time range, so unlike the other list widgets this one has to
   * re-render when the range changes — but ONLY in that mode. Comparing it
   * unconditionally would re-render (and refetch) every list-mode Monitor List
   * widget on the board on every range change, for a query that does not read
   * the range at all.
   */
  if (
    next.component.arguments.viewMode === "timeline" ||
    prev.component.arguments.viewMode === "timeline"
  ) {
    if (
      !JSONFunctions.deepEqual(
        prev.dashboardStartAndEndDate as unknown as Record<string, unknown>,
        next.dashboardStartAndEndDate as unknown as Record<string, unknown>,
      )
    ) {
      return false;
    }
  }

  return JSONFunctions.deepEqual(
    prev.component.arguments,
    next.component.arguments,
  );
}

export default React.memo(DashboardMonitorListComponentElement, arePropsEqual);
