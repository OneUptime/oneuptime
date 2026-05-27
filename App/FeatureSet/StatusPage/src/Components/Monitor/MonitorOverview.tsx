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
import MonitorStatusTimelne from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import UptimeBarTooltipIncident from "Common/Types/Monitor/UptimeBarTooltipIncident";
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
  defaultBarColor: Color;
  uptimeHistoryDays?: number | undefined;
  incidents?: Array<UptimeBarTooltipIncident> | undefined;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
}

const MonitorOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [selectedDayIncidents, setSelectedDayIncidents] = useState<
    Array<UptimeBarTooltipIncident>
  >([]);

  const hexToRgba: (hex: string, alpha: number) => string = (
    hex: string,
    alpha: number,
  ): string => {
    const cleaned: string = hex.replace("#", "").trim();
    if (cleaned.length !== 6) {
      return hex;
    }
    const r: number = parseInt(cleaned.substring(0, 2), 16);
    const g: number = parseInt(cleaned.substring(2, 4), 16);
    const b: number = parseInt(cleaned.substring(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return hex;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const getCurrentStatus: GetReactElementFunction = (): ReactElement => {
    let precision: UptimePrecision = UptimePrecision.ONE_DECIMAL;

    if (props.uptimePrecision) {
      precision = props.uptimePrecision;
    }

    const statusColor: string =
      props.currentStatus?.color?.toString() || Green.toString();

    const isInDowntime: boolean = Boolean(
      props.downtimeMonitorStatuses.find((downtimeStatus: MonitorStatus) => {
        return (
          props.currentStatus.id?.toString() === downtimeStatus.id?.toString()
        );
      }),
    );

    if (!isInDowntime && props.showUptimePercent) {
      const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
        props.monitorStatusTimeline,
        precision,
        props.downtimeMonitorStatuses,
      );

      return (
        <div
          className="font-semibold tabular-nums text-sm sm:text-base tracking-tight"
          style={{ color: statusColor }}
        >
          {uptimePercent}
          {t("overview.uptimeSuffix")}
        </div>
      );
    }

    if (props.showCurrentStatus) {
      const statusName: string =
        translateStatusName(props.currentStatus?.name) ||
        t("overview.operational");

      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase ring-1"
          style={{
            backgroundColor: hexToRgba(statusColor, 0.1),
            color: statusColor,
            borderColor: hexToRgba(statusColor, 0.22),
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: statusColor }}
            aria-hidden="true"
          />
          {statusName}
        </span>
      );
    }

    return <></>;
  };

  return (
    <div className={props.className}>
      <div>
        {/* Monitor header: responsive layout for name, tooltip, and status */}
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:justify-between sm:items-start mb-1.5">
          <div className="flex items-center min-w-0">
            <div className="text-base sm:text-lg font-semibold text-gray-900 tracking-tight truncate">
              {props.monitorName}
            </div>
            {props.tooltip && (
              <Tooltip
                key={1}
                text={props.tooltip || t("monitorOverview.notAvailable")}
              >
                <div className="ml-1.5">
                  <Icon
                    className="cursor-pointer w-4 h-4 text-gray-400 hover:text-gray-600 transition-colors"
                    icon={IconProp.Help}
                  />
                </div>
              </Tooltip>
            )}
          </div>
          {/* Status: stacked below name on mobile, inline on sm+ */}
          <div className="flex sm:items-start">{getCurrentStatus()}</div>
        </div>

        {/* Description: muted body text */}
        {props.description ? (
          <div className="mb-2 text-xs sm:text-sm text-gray-500">
            <MarkdownViewer text={props.description || ""} />
          </div>
        ) : null}
      </div>

      {/* Uptime graph: Scrollable on mobile, full width on larger screens */}
      {props.showHistoryChart && (
        <div className="w-full overflow-x-auto">
          <MonitorUptimeGraph
            error={undefined}
            barColorRules={props.statusPageHistoryChartBarColorRules}
            defaultBarColor={props.defaultBarColor}
            downtimeMonitorStatuses={props.downtimeMonitorStatuses}
            items={props.monitorStatusTimeline || []}
            startDate={props.startDate}
            endDate={props.endDate}
            isLoading={false}
            height={props.uptimeGraphHeight}
            incidents={props.incidents}
            onIncidentClick={props.onIncidentClick}
            onBarClick={(
              date: Date,
              incidents: Array<UptimeBarTooltipIncident>,
            ) => {
              setSelectedDay(date);
              setSelectedDayIncidents(incidents);
            }}
          />
        </div>
      )}

      {/* Time labels */}
      {props.showHistoryChart && (
        <div className="text-[11px] sm:text-xs text-gray-400 mt-2 justify-between flex font-medium uppercase tracking-wider">
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
          onIncidentClick={props.onIncidentClick}
          onClose={() => {
            setSelectedDay(null);
            setSelectedDayIncidents([]);
          }}
        />
      )}
    </div>
  );
};

export default MonitorOverview;
