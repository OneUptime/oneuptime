import React, { FunctionComponent, ReactElement } from "react";
import Button, { ButtonSize, ButtonStyleType } from "../../Button/Button";

export interface LogsViewerToolbarProps {
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
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="font-medium text-slate-300">
          {props.resultCount.toLocaleString()} result
          {props.resultCount === 1 ? "" : "s"}
        </span>
        {hasPaginationSummary && (
          <span className="text-slate-500">
            Page {currentPage} of {totalPages}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {props.showApplyButton && props.onApplyFilters && (
          <Button
            title="Apply Filters"
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
