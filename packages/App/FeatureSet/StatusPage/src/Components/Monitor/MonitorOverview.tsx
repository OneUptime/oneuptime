import { Green } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import MonitorUptimeGraph from "Common/UI/Components/MonitorGraphs/Uptime";
import UptimeUtil from "Common/UI/Components/MonitorGraphs/UptimeUtil";
import UptimeBarDayModal from "Common/UI/Components/MonitorGraphs/UptimeBarDayModal";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { UptimeDayBucket } from "Common/Types/StatusPage/UptimeDailyAggregate";
import { MergedDowntimeTotals } from "Common/Types/StatusPage/MergedDowntimeTotals";
import UptimeDailyAggregateUtil from "Common/Utils/StatusPage/UptimeDailyAggregateUtil";
import MonitorStatusTimelne from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import UptimeBarTooltipIncident from "Common/Types/Monitor/UptimeBarTooltipIncident";
import UptimeHistoryLabels from "Common/Types/Monitor/UptimeHistoryLabels";
import { UptimeBarDaySummary } from "Common/UI/Components/Graphs/DayUptimeGraph";
import StatusPageGroupNestingLayoutUtil from "Common/Utils/StatusPage/GroupNestingLayout";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateStatusName } from "../../Utils/StatusTranslation";

export interface ComponentProps {
  monitorName: string;
  description?: string | undefined;
  tooltip?: string | undefined;
  currentStatus: MonitorStatus;
  monitorStatusTimeline: Array<MonitorStatusTimelne>;
  startDate: Date;
  endDate: Date;
  showHistoryChart?: boolean | undefined;
  showCurrentStatus?: boolean | undefined;
  uptimeGraphHeight?: number | undefined;
  className?: string | undefined;
  showUptimePercent: boolean;
  uptimePrecision?: UptimePrecision | undefined;
  statusPageHistoryChartBarColorRules: Array<StatusPageHistoryChartBarColorRule>;
  downtimeMonitorStatuses: Array<MonitorStatus>;
  /*
   * Server-measured per-day coverage for this resource's monitor. Without it
   * the bars cannot tell a quiet day from one whose timeline rows the fetch
   * cap dropped, and paint both with defaultBarColor.
   */
  uptimeBuckets?: Array<UptimeDayBucket> | undefined;
  /*
   * A monitor group's merged downtime from the server: the time at least one
   * of its monitors was down, over the time any of them was recorded, from
   * every row. What the uptime percentage of a monitor-group resource is
   * read from - a group has no buckets of its own. It does not paint the
   * bars.
   */
  mergedDowntime?: MergedDowntimeTotals | undefined;
  /*
   * The zone uptimeBuckets were cut in (UptimeDailyAggregate.timezone). The
   * bars are drawn on that zone's days so each bar is exactly one bucket.
   */
  uptimeTimezone?: string | undefined;
  monitorStatuses?: Array<MonitorStatus> | undefined;
  defaultBarColor: Color;
  uptimeHistoryDays?: number | undefined;
  incidents?: Array<UptimeBarTooltipIncident> | undefined;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
  /*
   * "90 days ago ... Today" under the bars. Every bar in a block is drawn over
   * the same window, so the overview turns this off and draws the axis once for
   * the whole block instead of once per resource per nesting level. Defaults to
   * on for anything that renders a resource on its own.
   */
  showTimeAxisLabels?: boolean | undefined;
}

const MonitorOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedDayIncidents, setSelectedDayIncidents] = useState<
    Array<UptimeBarTooltipIncident>
  >([]);
  const [selectedDaySummary, setSelectedDaySummary] =
    useState<UptimeBarDaySummary | null>(null);

  /*
   * Handed to both the strip and the dialog it opens, so a visitor reading a
   * German status page is not read an English date summary by their screen
   * reader.
   */
  const uptimeHistoryLabels: UptimeHistoryLabels = {
    /*
     * Interpolated here rather than from the bar count, and deliberately so.
     * A rolling window of N times 24 hours touches N+1 calendar days, so the
     * strip draws one more bar than the window it covers - and the axis under
     * it already says "N days ago ... Today". The name a screen reader reads
     * out has to agree with the one the page shows, not with the bar count.
     */
    graphLabel: t("uptimeHistory.graphLabel", {
      total: props.uptimeHistoryDays || 90,
    }),
    dayLabel: t("uptimeHistory.dayLabel"),
    dayLabelWithIncidents: t("uptimeHistory.dayLabelWithIncidents"),
    dayLabelNoData: t("uptimeHistory.dayLabelNoData"),
    dayLabelNoDataWithIncidents: t("uptimeHistory.dayLabelNoDataWithIncidents"),
    uptime: t("uptimeHistory.uptime"),
    noMonitoringData: t("uptimeHistory.noMonitoringData"),
    incidents: t("uptimeHistory.incidents"),
    noIncidents: t("uptimeHistory.noIncidents"),
    noIncidentsDescription: t("uptimeHistory.noIncidentsDescription"),
    declared: t("uptimeHistory.declared"),
    oneIncidentOnThisDay: t("uptimeHistory.oneIncidentOnThisDay"),
    incidentsOnThisDay: t("uptimeHistory.incidentsOnThisDay"),
    close: t("common.close"),
  };

  const getCurrentStatus: GetReactElementFunction = (): ReactElement => {
    // if the current status is operational then show uptime Percent.

    let precision: UptimePrecision = UptimePrecision.ONE_DECIMAL;

    if (props.uptimePrecision) {
      precision = props.uptimePrecision;
    }

    if (
      !props.downtimeMonitorStatuses.find((downtimeStatus: MonitorStatus) => {
        return (
          props.currentStatus.id?.toString() === downtimeStatus.id?.toString()
        );
      }) &&
      props.showUptimePercent
    ) {
      /*
       * From the same buckets the bars are painted from, when there are any.
       *
       * monitorStatusTimeline arrives under a 10,000 row cap across every
       * monitor on the page, so on a page with a flapping monitor it holds a
       * few days of the window and a percentage computed from it only sees
       * those days - it read 99.876% for a monitor that was up 99.667% of
       * its sixty days. The buckets are measured from every row.
       */
      let uptimePercent: number | null = props.uptimeBuckets
        ? UptimeDailyAggregateUtil.getUptimePercent({
            buckets: props.uptimeBuckets,
            downtimeMonitorStatusIds: props.downtimeMonitorStatuses
              .map((status: MonitorStatus) => {
                return status.id?.toString() || "";
              })
              .filter(Boolean),
            precision: precision,
          })
        : null;

      /*
       * A monitor group, from the server's merged figure, for the same
       * reason: it too is measured from every row. A group's rows here are
       * also merged by priority, which lets a later-starting, longer-running
       * row of one monitor cut another monitor's outage short.
       */
      if (uptimePercent === null && props.mergedDowntime) {
        uptimePercent = UptimeUtil.calculateUptimePercentOfCoveredSeconds({
          coveredSeconds: props.mergedDowntime.coveredSeconds,
          downtimeSeconds: props.mergedDowntime.downtimeSeconds,
          precision: precision,
        });
      }

      /*
       * Otherwise (no reading, or one that covers nothing) measure uptime
       * over the same window the history chart is drawn for. Without this
       * an open (endsAt = null) row that started before the window
       * contributes its whole duration, and the denominator becomes "first
       * event -> now" rather than the window.
       */
      if (uptimePercent === null) {
        uptimePercent = UptimeUtil.calculateUptimePercentage(
          props.monitorStatusTimeline,
          precision,
          props.downtimeMonitorStatuses,
          {
            startDate: props.startDate,
            endDate: props.endDate,
          },
        );
      }

      return (
        <div
          className="font-medium"
          style={{
            color: props.currentStatus?.color?.toString() || Green.toString(),
          }}
        >
          {uptimePercent}
          {t("overview.uptimeSuffix")}
        </div>
      );
    }

    if (props.showCurrentStatus) {
      return (
        <div
          className=""
          style={{
            color: props.currentStatus?.color?.toString() || Green.toString(),
          }}
        >
          {translateStatusName(props.currentStatus?.name) ||
            t("overview.operational")}
        </div>
      );
    }

    return <></>;
  };

  return (
    <div className={props.className}>
      <div>
        {/* Monitor header: responsive layout for name, tooltip, and status */}
        <div
          className="flex flex-col sm:flex-row sm:justify-between sm:items-start"
          style={{ marginBottom: "3px" }}
        >
          <div className="flex items-center mb-2 sm:mb-0">
            {/*
             * Deliberately not larger than a group title: a resource is a leaf
             * of the group hierarchy and must not out-weigh the group heading
             * above it. The class lives in the layout util so that floor is
             * checked against the string that actually renders here.
             */}
            <div
              className={StatusPageGroupNestingLayoutUtil.getResourceTitleClassName()}
            >
              {props.monitorName}
            </div>
            {props.tooltip && (
              <Tooltip
                key={1}
                text={props.tooltip || t("monitorOverview.notAvailable")}
              >
                <div className="ml-1">
                  <Icon
                    className="cursor-pointer w-4 h-4 mt-1 text-gray-400"
                    icon={IconProp.Help}
                  />
                </div>
              </Tooltip>
            )}
          </div>
          {/* Status: Stack below name on mobile, inline on larger screens */}
          <div className="text-sm sm:text-base font-medium">
            {getCurrentStatus()}
          </div>
        </div>

        {/* Description: Responsive text size */}
        <div className="mb-2 text-xs sm:text-sm">
          {props.description && (
            <MarkdownViewer text={props.description || ""} />
          )}
        </div>
      </div>

      {/* Uptime graph: Scrollable on mobile, full width on larger screens */}
      {props.showHistoryChart && (
        <div className="w-full overflow-x-auto">
          <MonitorUptimeGraph
            error={undefined}
            barColorRules={props.statusPageHistoryChartBarColorRules}
            defaultBarColor={props.defaultBarColor}
            downtimeMonitorStatuses={props.downtimeMonitorStatuses}
            uptimeBuckets={props.uptimeBuckets}
            uptimeTimezone={props.uptimeTimezone}
            monitorStatuses={props.monitorStatuses}
            items={props.monitorStatusTimeline || []}
            startDate={props.startDate}
            endDate={props.endDate}
            isLoading={false}
            height={props.uptimeGraphHeight}
            incidents={props.incidents}
            onIncidentClick={props.onIncidentClick}
            labels={uptimeHistoryLabels}
            onBarClick={(
              date: Date,
              incidents: Array<UptimeBarTooltipIncident>,
              summary: UptimeBarDaySummary,
            ) => {
              setSelectedDay(date);
              setSelectedDayIncidents(incidents);
              setSelectedDaySummary(summary);
            }}
          />
        </div>
      )}

      {/* Time labels: Visible on all screen sizes */}
      {props.showHistoryChart && props.showTimeAxisLabels !== false && (
        <div className="text-xs sm:text-sm text-gray-500 mt-1 justify-between flex">
          <div>
            {t("monitorOverview.daysAgo", {
              days: props.uptimeHistoryDays || 90,
            })}
          </div>
          <div>{t("monitorOverview.today")}</div>
        </div>
      )}

      {/* Incident detail modal */}
      {selectedDay && (
        <UptimeBarDayModal
          date={selectedDay}
          incidents={selectedDayIncidents}
          uptimePercent={selectedDaySummary?.uptimePercent}
          hasEvents={selectedDaySummary?.hasEvents}
          statusDurations={selectedDaySummary?.statusDurations}
          labels={uptimeHistoryLabels}
          timezone={props.uptimeTimezone}
          onIncidentClick={props.onIncidentClick}
          onClose={() => {
            setSelectedDay(null);
            setSelectedDayIncidents([]);
            setSelectedDaySummary(null);
          }}
        />
      )}
    </div>
  );
};

export default MonitorOverview;
