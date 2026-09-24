import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import DayUptimeGraph, {
  BarChartRule,
  DayReading,
  Event,
  UptimeBarDaySummary,
} from "../Graphs/DayUptimeGraph";
import { StatusDuration } from "../Graphs/UptimeDaySummary";
import Dictionary from "../../../Types/Dictionary";
import {
  UptimeDayBucket,
  UptimeStatusDuration,
} from "../../../Types/StatusPage/UptimeDailyAggregate";
import UptimeUtil from "./UptimeUtil";
import Color from "../../../Types/Color";
import CommonMonitorEvent from "../../../Utils/Uptime/MonitorEvent";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeHistoryLabels from "../../../Types/Monitor/UptimeHistoryLabels";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export type MonitorEvent = CommonMonitorEvent;

export interface ComponentProps {
  startDate: Date;
  endDate: Date;
  items: Array<MonitorStatusTimeline>;
  isLoading?: boolean | undefined;
  onRefreshClick?: (() => void) | undefined;
  error?: string | undefined;
  height?: number | undefined;
  barColorRules?: Array<StatusPageHistoryChartBarColorRule> | undefined;
  downtimeMonitorStatuses: Array<MonitorStatus> | undefined;
  /*
   * Server-measured per-day coverage for THIS monitor.
   *
   * The `items` array above arrives under a fetch cap that silently drops
   * history, so it cannot answer "did we have data for this day". These
   * buckets can. When absent the graph keeps its old event-derived
   * behaviour, which is what the dashboard monitor page still uses.
   */
  uptimeBuckets?: Array<UptimeDayBucket> | undefined;
  /* Statuses by id, so a bucket's durations can be given a name and colour. */
  monitorStatuses?: Array<MonitorStatus> | undefined;
  /*
   * The zone uptimeBuckets were cut in, so the bars are drawn on the same
   * day boundaries. The browser's own zone when absent, which is only right
   * when the buckets were asked for in the browser's zone (the dashboard).
   */
  uptimeTimezone?: string | undefined;
  defaultBarColor: Color;
  incidents?: Array<UptimeBarTooltipIncident> | undefined;
  onBarClick?: (
    date: Date,
    incidents: Array<UptimeBarTooltipIncident>,
    summary: UptimeBarDaySummary,
  ) => void;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
  /* Wording for the strip's accessible names. Defaults to English. */
  labels?: UptimeHistoryLabels | undefined;
}

const MonitorUptimeGraph: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * A search can reveal many histories at once. Derive their data before the
   * first paint instead of painting empty bars and rebuilding them in effects.
   */
  const events: Array<Event> = useMemo(() => {
    return UptimeUtil.getNonOverlappingMonitorEvents(props.items);
  }, [props.items]);

  const barColorRules: Array<BarChartRule> = useMemo(() => {
    return (props.barColorRules || []).map(
      (rule: StatusPageHistoryChartBarColorRule): BarChartRule => {
        return {
          barColor: rule.barColor!,
          uptimePercentGreaterThanOrEqualTo:
            rule.uptimePercentGreaterThanOrEqualTo!,
        };
      },
    );
  }, [props.barColorRules]);

  /*
   * Turn the server's buckets into the graph's per-day readings, resolving
   * each status id to the name and colour the page already knows.
   */
  const dayReadings: Array<DayReading> | undefined = useMemo(() => {
    if (!props.uptimeBuckets) {
      return undefined;
    }

    const statusById: Dictionary<MonitorStatus> = {};

    for (const status of props.monitorStatuses || []) {
      if (status.id) {
        statusById[status.id.toString()] = status;
      }
    }

    const downtimeIds: Array<string> = (
      props.downtimeMonitorStatuses || []
    ).map((status: MonitorStatus) => {
      return status.id?.toString() || "";
    });

    return props.uptimeBuckets.map((bucket: UptimeDayBucket): DayReading => {
      return {
        dayStart: bucket.bucketStart,
        daySeconds: bucket.daySeconds,
        coveredSeconds: bucket.coveredSeconds,
        statusDurations: bucket.statusDurations.map(
          (duration: UptimeStatusDuration): StatusDuration => {
            const statusId: string = duration.monitorStatusId.toString();
            const status: MonitorStatus | undefined = statusById[statusId];

            return {
              label: status?.name || "Unknown",
              seconds: duration.seconds,
              color: status?.color || props.defaultBarColor,
              isDowntime: downtimeIds.includes(statusId),
              /*
               * So a day painted from this bucket alone takes the colour of
               * its worst status, as a day painted from timeline rows does.
               */
              priority: status?.priority ?? undefined,
            };
          },
        ),
      };
    });
  }, [
    props.uptimeBuckets,
    props.monitorStatuses,
    props.downtimeMonitorStatuses,
    props.defaultBarColor,
  ]);

  if (props.isLoading) {
    return <ComponentLoader />;
  }

  if (props.error) {
    return (
      <ErrorMessage
        message={props.error}
        onRefreshClick={props.onRefreshClick ? props.onRefreshClick : undefined}
      />
    );
  }

  return (
    <DayUptimeGraph
      startDate={props.startDate}
      endDate={props.endDate}
      events={events}
      dayReadings={dayReadings}
      timezone={props.uptimeTimezone}
      defaultBarColor={props.defaultBarColor}
      height={props.height}
      barColorRules={barColorRules}
      downtimeEventStatusIds={
        props.downtimeMonitorStatuses?.map((status: MonitorStatus) => {
          return status.id!;
        }) || []
      }
      incidents={props.incidents}
      onBarClick={props.onBarClick}
      onIncidentClick={props.onIncidentClick}
      labels={props.labels}
    />
  );
};

export default MonitorUptimeGraph;
