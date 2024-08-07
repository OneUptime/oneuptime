import { Green } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import MonitorUptimeGraph from "Common/UI/Components/MonitorGraphs/Uptime";
import UptimeUtil from "Common/UI/Components/MonitorGraphs/UptimeUtil";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimelne from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import { UptimePrecision } from "Common/Models/DatabaseModels/StatusPageResource";
import React, { FunctionComponent, ReactElement } from "react";

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
}

const MonitorOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
      const uptimePercent: number = UptimeUtil.calculateUptimePercentage(
        props.monitorStatusTimeline,
        precision,
        props.downtimeMonitorStatuses,
      );

      return (
        <div
          className="font-medium"
          style={{
            color: props.currentStatus?.color?.toString() || Green.toString(),
          }}
        >
          {uptimePercent}% uptime
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
          {props.currentStatus?.name || "Operational"}
        </div>
      );
    }

    return <></>;
  };

  return (
    <div className={props.className}>
      <div>
        <div className="flex justify-between" style={{ marginBottom: "3px" }}>
          <div className="flex">
            <div className="">{props.monitorName}</div>
            {props.tooltip && (
              <Tooltip key={1} text={props.tooltip || "Not available"}>
                <div className="ml-1">
                  <Icon
                    className="cursor-pointer w-4 h-4 mt-1 text-gray-400"
                    icon={IconProp.Help}
                  />
                </div>
              </Tooltip>
            )}
          </div>
          {getCurrentStatus()}
        </div>
        <div className="mb-2 text-sm">
          {props.description && (
            <MarkdownViewer text={props.description || ""} />
          )}
        </div>
      </div>
      {props.showHistoryChart && (
        <div>
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
          />
        </div>
      )}
      {props.showHistoryChart && (
        <div className="text-sm text-gray-400 mt-1 flex justify-between">
          <div>90 days ago</div>
          <div>Today</div>
        </div>
      )}
    </div>
  );
};

export default MonitorOverview;
