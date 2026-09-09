import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import DayUptimeGraph, {
  BarChartRule,
  Event,
  UptimeBarDaySummary,
} from "../Graphs/DayUptimeGraph";
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
  // A search can reveal many histories at once. Derive their data before the
  // first paint instead of painting empty bars and rebuilding them in effects.
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
