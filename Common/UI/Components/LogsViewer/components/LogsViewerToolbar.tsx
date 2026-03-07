import React, { FunctionComponent, ReactElement } from "react";
import LiveLogsToggle from "./LiveLogsToggle";
import LogTimeRangePicker from "./LogTimeRangePicker";
import { LiveLogsOptions } from "../types";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";

export interface LogsViewerToolbarProps {
  resultCount: number;
  currentPage?: number;
  totalPages?: number;
  className?: string;
  liveOptions?: LiveLogsOptions;
  timeRange?: RangeStartAndEndDateTime;
  onTimeRangeChange?: (value: RangeStartAndEndDateTime) => void;
}

const LogsViewerToolbar: FunctionComponent<LogsViewerToolbarProps> = (
  props: LogsViewerToolbarProps,
): ReactElement => {
  const { currentPage, totalPages } = props;
  const hasPaginationSummary: boolean = Boolean(
    currentPage && totalPages && totalPages > 0,
  );

  return (
    <div
      className={`flex items-center justify-between gap-3 ${props.className || ""}`}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="font-medium text-gray-700">
          {props.resultCount.toLocaleString()} result
          {props.resultCount === 1 ? "" : "s"}
        </span>
        {hasPaginationSummary && (
          <span className="text-gray-400">
            Page {currentPage} of {totalPages}
          </span>
        )}
      </div>

      {props.timeRange && props.onTimeRangeChange && (
        <LogTimeRangePicker
          value={props.timeRange}
          onChange={props.onTimeRangeChange}
        />
      )}

      {props.liveOptions && <LiveLogsToggle {...props.liveOptions} />}
    </div>
  );
};

export default LogsViewerToolbar;
