import React, { FunctionComponent, ReactElement, useRef, useState } from "react";
import LiveLogsToggle from "./LiveLogsToggle";
import LogTimeRangePicker from "./LogTimeRangePicker";
import ColumnSelector from "./ColumnSelector";
import SavedViewsDropdown from "./SavedViewsDropdown";
import KeyboardShortcutsHelp from "./KeyboardShortcutsHelp";
import {
  LiveLogsOptions,
  LogsSavedViewOption,
  LogsTableColumnOption,
  LogsViewMode,
} from "../types";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";

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
  selectedSavedViewId?: string | null | undefined;
  onSavedViewSelect?: ((viewId: string) => void) | undefined;
  onEditSavedView?: ((viewId: string) => void) | undefined;
  onDeleteSavedView?: ((viewId: string) => void) | undefined;
  onUpdateCurrentSavedView?: (() => void) | undefined;
  availableColumns?: Array<LogsTableColumnOption> | undefined;
  selectedColumns?: Array<string> | undefined;
  onSelectedColumnsChange?: ((columns: Array<string>) => void) | undefined;
  viewMode?: LogsViewMode | undefined;
  onViewModeChange?: ((mode: LogsViewMode) => void) | undefined;
  onExportCSV?: (() => void) | undefined;
  onExportJSON?: (() => void) | undefined;
  showKeyboardShortcuts?: boolean | undefined;
  onToggleKeyboardShortcuts?: (() => void) | undefined;
}

const LogsViewerToolbar: FunctionComponent<LogsViewerToolbarProps> = (
  props: LogsViewerToolbarProps,
): ReactElement => {
  const { currentPage, totalPages } = props;
  const hasPaginationSummary: boolean = Boolean(
    currentPage && totalPages && totalPages > 0,
  );

  const exportDropdownRef: React.RefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  useComponentOutsideClick(exportDropdownRef, () => {
    setIsExportOpen(false);
  });

  const showExport: boolean = Boolean(props.onExportCSV || props.onExportJSON);

  return (
    <div
      className={`flex items-center justify-between gap-3 ${props.className || ""}`}
    >
      {/* Left group: View management + stats */}
      <div className="flex flex-wrap items-center gap-3">
        {props.viewMode && props.onViewModeChange && (
          <div className="inline-flex rounded-md shadow-sm" role="group">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-l-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                props.viewMode === "list"
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
              onClick={() => {
                props.onViewModeChange!("list");
              }}
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z"
                />
              </svg>
              List
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-r-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                props.viewMode === "analytics"
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
              onClick={() => {
                props.onViewModeChange!("analytics");
              }}
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
                />
              </svg>
              Analytics
            </button>
          </div>
        )}

        {props.savedViews && props.onSavedViewSelect && (
          <SavedViewsDropdown
            savedViews={props.savedViews}
            selectedSavedViewId={props.selectedSavedViewId}
            onSelect={props.onSavedViewSelect}
            onCreate={props.onCreateSavedView}
            onEdit={props.onEditSavedView}
            onDelete={props.onDeleteSavedView}
            onUpdateCurrent={props.onUpdateCurrentSavedView}
          />
        )}

        <div className="flex items-center gap-2 text-xs text-gray-500">
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
      </div>

      {/* Right group: Display controls */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {props.availableColumns &&
          props.selectedColumns &&
          props.onSelectedColumnsChange && (
            <ColumnSelector
              availableColumns={props.availableColumns}
              selectedColumns={props.selectedColumns}
              onChange={props.onSelectedColumnsChange}
            />
          )}

        {props.onToggleKeyboardShortcuts && (
          <div className="relative">
            <button
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
                props.showKeyboardShortcuts
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
              }`}
              onClick={props.onToggleKeyboardShortcuts}
              title="Keyboard shortcuts (?)"
            >
              <kbd className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded border border-current px-0.5 font-mono text-[10px] font-semibold leading-none">
                ?
              </kbd>
            </button>
            {props.showKeyboardShortcuts && (
              <KeyboardShortcutsHelp
                onClose={props.onToggleKeyboardShortcuts}
              />
            )}
          </div>
        )}

        {showExport && (
          <div className="relative" ref={exportDropdownRef}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
              onClick={() => {
                setIsExportOpen(!isExportOpen);
              }}
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                />
              </svg>
              Export
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m19.5 8.25-7.5 7.5-7.5-7.5"
                />
              </svg>
            </button>
            {isExportOpen && (
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                {props.onExportCSV && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setIsExportOpen(false);
                      props.onExportCSV!();
                    }}
                  >
                    Export as CSV
                  </button>
                )}
                {props.onExportJSON && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setIsExportOpen(false);
                      props.onExportJSON!();
                    }}
                  >
                    Export as JSON
                  </button>
                )}
              </div>
            )}
          </div>
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
