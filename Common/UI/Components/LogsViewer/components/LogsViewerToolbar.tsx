import React, { FunctionComponent, ReactElement } from "react";
import Toggle from "../../Toggle/Toggle";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface LogsViewerToolbarProps {
  autoScroll: boolean;
  onAutoScrollChange: (checked: boolean) => void;
  isDescending: boolean;
  onSortDirectionChange: (nextDescending: boolean) => void;
  resultCount: number;
  showApplyButton?: boolean;
  onApplyFilters?: () => void;
  currentPage?: number;
  totalPages?: number;
  className?: string;
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
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${props.className || ""}`}
    >
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <Toggle
            title="Autoscroll"
            value={props.autoScroll}
            onChange={props.onAutoScrollChange}
          />
          <span className="font-medium text-slate-500">
            {props.autoScroll ? "Live" : "Paused"}
          </span>
        </div>
        <span className="hidden h-4 w-px bg-slate-300/20 sm:block" />
        <span className="text-slate-500">
          {props.resultCount.toLocaleString()} result
          {props.resultCount === 1 ? "" : "s"}
        </span>
        {hasPaginationSummary && (
          <span className="text-slate-500">
            · Page {currentPage} of {totalPages}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-full border border-slate-300/30 bg-white/10 p-1 text-xs shadow-sm ring-1 ring-slate-200/30 backdrop-blur">
          <button
            type="button"
            aria-pressed={props.isDescending}
            onClick={() => {
              props.onSortDirectionChange(true);
            }}
            className={`flex items-center gap-2 rounded-full px-3 py-1 font-semibold tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
              props.isDescending
                ? "bg-indigo-600 text-white shadow ring-1 ring-indigo-400/40"
                : "text-slate-500 hover:text-indigo-600"
            }`}
          >
            <Icon
              icon={IconProp.BarsArrowDown}
              className={`h-4 w-4 ${
                props.isDescending ? "text-white/90" : "text-slate-400"
              }`}
            />
            <span>Newest first</span>
          </button>
          <button
            type="button"
            aria-pressed={!props.isDescending}
            onClick={() => {
              props.onSortDirectionChange(false);
            }}
            className={`flex items-center gap-2 rounded-full px-3 py-1 font-semibold tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
              !props.isDescending
                ? "bg-indigo-600 text-white shadow ring-1 ring-indigo-400/40"
                : "text-slate-500 hover:text-indigo-600"
            }`}
          >
            <Icon
              icon={IconProp.BarsArrowUp}
              className={`h-4 w-4 ${
                !props.isDescending ? "text-white/90" : "text-slate-400"
              }`}
            />
            <span>Oldest first</span>
          </button>
        </div>

        {props.showApplyButton && props.onApplyFilters && (
          <Button
            title="Apply Filters"
            icon={IconProp.Search}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            onClick={props.onApplyFilters}
          />
        )}
      </div>
    </div>
  );
};

export default LogsViewerToolbar;
