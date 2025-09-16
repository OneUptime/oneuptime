import React, { FunctionComponent, ReactElement } from "react";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Log from "Common/Models/AnalyticsModels/Log";
import LogSeverity from "Common/Types/Log/LogSeverity";
import { VirtualItem } from "../AdvancedLogViewer";

export interface LogListVirtualizedProps {
  containerRef: React.RefObject<HTMLDivElement>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  isLoading: boolean;
  filteredLogs: Array<Log>;
  totalHeight: number;
  virtualItems: Array<VirtualItem>;
  wrapLines: boolean;
  showJSON: boolean;
  liveTail: boolean;
  enableRealtime: boolean;
  noLogsMessage?: string | undefined;
  onClearFilters: () => void;
  setSelectedLog: (l: Log) => void;
  selectedLog: Log | null;
  getSeverityColor: (s?: LogSeverity) => string;
  OneUptimeDate: any;
  fetchLogs: () => void;
  setLiveTail: (v: boolean) => void;
}

const LogListVirtualized: FunctionComponent<LogListVirtualizedProps> = (
  props: LogListVirtualizedProps,
): ReactElement => {
  return (
    <div
      ref={props.containerRef}
      onScroll={props.onScroll}
      className="relative bg-slate-900 rounded-lg border border-slate-800 h-[600px] overflow-auto text-xs font-mono dark-scrollbar"
    >
      {props.isLoading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm z-10">
          <ComponentLoader />
        </div>
      ) : null}
      {!props.isLoading && props.filteredLogs.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-3">
          <div className="text-slate-300 font-medium">
            {props.noLogsMessage || "No logs match the current criteria."}
          </div>
          <div className="text-slate-500 text-xs max-w-md">
            Try adjusting time range, removing filters, or enabling Live Tail to
            stream new logs.
          </div>
          <div className="flex space-x-2">
            <Button
              title="Clear Filters"
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              onClick={() => {
                return props.onClearFilters();
              }}
            />
            {props.enableRealtime && !props.liveTail && (
              <Button
                title="Enable Live Tail"
                buttonStyle={ButtonStyleType.PRIMARY}
                buttonSize={ButtonSize.Small}
                onClick={() => {
                  return props.setLiveTail(true);
                }}
              />
            )}
          </div>
        </div>
      ) : null}
      {!props.liveTail && props.enableRealtime ? (
        <div className="sticky top-0 z-20 w-full bg-amber-50 text-amber-700 text-xs px-3 py-1 flex items-center space-x-2 border-b border-amber-200">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span>Live tail paused. New logs will not stream automatically.</span>
          <Button
            title="Resume"
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              return props.setLiveTail(true);
            }}
          />
          <Button
            title="Reload"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.LINK}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              return props.fetchLogs();
            }}
          />
        </div>
      ) : null}
      <div
        style={{ height: props.totalHeight }}
        className={props.wrapLines ? "whitespace-pre-wrap" : "whitespace-pre"}
      >
        {props.virtualItems.map((vi) => {
          const log = props.filteredLogs[vi.index];
          if (!log) {
            return null;
          }
          const body = log.body?.toString() || "";
          let jsonBody: string | null = null;
          if (props.showJSON) {
            try {
              jsonBody = JSON.stringify(JSON.parse(body), null, 2);
            } catch {
              jsonBody = null;
            }
          }
          const sevColor = props.getSeverityColor(
            log.severityText as LogSeverity,
          );
          return (
            <div
              key={vi.index}
              style={{ position: "absolute", top: vi.start, left: 0, right: 0 }}
              className={`group flex items-start px-4 py-1.5 cursor-pointer hover:bg-slate-800/60 border-l-2 ${props.selectedLog === log ? "bg-slate-800 border-indigo-400" : "border-transparent"}`}
              onClick={() => {
                return props.setSelectedLog(log);
              }}
            >
              <span className="w-48 text-slate-500 shrink-0">
                {log.time
                  ? props.OneUptimeDate.getDateAsUserFriendlyFormattedString(
                      log.time,
                    )
                  : ""}
              </span>
              <span className={`w-28 shrink-0 font-semibold ${sevColor}`}>
                [{log.severityText}]
              </span>
              <span className="flex-1 text-slate-200 truncate pr-4">
                {jsonBody ? jsonBody.split("\n")[0] : body.substring(0, 300)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LogListVirtualized;
