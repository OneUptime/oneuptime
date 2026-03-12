import React, { FunctionComponent, ReactElement } from "react";
import LiveLogsToggle from "./LiveLogsToggle";
import LogTimeRangePicker from "./LogTimeRangePicker";
import ColumnSelector from "./ColumnSelector";
import SavedViewsDropdown from "./SavedViewsDropdown";
import {
  LiveLogsOptions,
  LogsSavedViewOption,
  LogsTableColumnOption,
} from "../types";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";

export interface LogsViewerToolbarProps {
  resultCount: number;
  currentPage?: number;
  totalPages?: number;
  className?: string;
  liveOptions?: LiveLogsOptions;
  timeRange?: RangeStartAndEndDateTime;
  onTimeRangeChange?: (value: RangeStartAndEndDateTime) => void;
  onCreateSavedView?: (() => void) | undefined;
  savedViews?: Array<LogsSavedViewOption> | undefined;
  selectedSavedViewId?: string | null;
  onSavedViewSelect?: ((viewId: string) => void) | undefined;
  onEditSavedView?: ((viewId: string) => void) | undefined;
  onDeleteSavedView?: ((viewId: string) => void) | undefined;
  onUpdateCurrentSavedView?: (() => void) | undefined;
  availableColumns?: Array<LogsTableColumnOption> | undefined;
  selectedColumns?: Array<string> | undefined;
  onSelectedColumnsChange?: ((columns: Array<string>) => void) | undefined;
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

      <div className="flex flex-wrap items-center justify-end gap-3">
        {props.onCreateSavedView && (
          <button
            type="button"
            className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            onClick={() => {
              props.onCreateSavedView?.();
            }}
          >
            Save View
          </button>
        )}

        {props.savedViews && props.onSavedViewSelect && (
          <SavedViewsDropdown
            savedViews={props.savedViews}
            selectedSavedViewId={props.selectedSavedViewId}
            onSelect={props.onSavedViewSelect}
            onEdit={props.onEditSavedView}
            onDelete={props.onDeleteSavedView}
            onUpdateCurrent={props.onUpdateCurrentSavedView}
          />
        )}

        {props.availableColumns &&
          props.selectedColumns &&
          props.onSelectedColumnsChange && (
            <ColumnSelector
              availableColumns={props.availableColumns}
              selectedColumns={props.selectedColumns}
              onChange={props.onSelectedColumnsChange}
            />
          )}

        {props.timeRange && props.onTimeRangeChange && (
          <LogTimeRangePicker
            value={props.timeRange}
            onChange={props.onTimeRangeChange}
          />
        )}

        {props.liveOptions && <LiveLogsToggle {...props.liveOptions} />}
      </div>
    </div>
  );
};

export default LogsViewerToolbar;
