import ComponentLoader from "../ComponentLoader/ComponentLoader";
import LogItem from "./LogItem";
import LogsFilters, { FilterOption } from "./LogsFilters";
import { VoidFunction } from "Common/Types/FunctionTypes";
import Log from "Model/AnalyticsModels/Log";
import React, { FunctionComponent, ReactElement, Ref } from "react";

export interface ComponentProps {
  logs: Array<Log>;
  onFilterChanged: (filterOptions: FilterOption) => void;
  isLoading: boolean;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
}

const LogsViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [screenHeight, setScreenHeight] = React.useState<number>(
    window.innerHeight,
  );
  const [autoScroll, setAutoScroll] = React.useState<boolean>(true);
  const logsViewerRef: Ref<HTMLDivElement> = React.useRef<HTMLDivElement>(null);

  // Update the screen height when the window is resized

  React.useEffect(() => {
    const handleResize: any = (): void => {
      setScreenHeight(window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Keep scroll to the bottom of the log

  const scrollToBottom: VoidFunction = (): void => {
    const logsViewer: HTMLDivElement | null = logsViewerRef.current;

    if (logsViewer) {
      logsViewer.scrollTop = logsViewer.scrollHeight;
    }
  };

  React.useEffect(() => {
    if (!autoScroll) {
      return;
    }

    scrollToBottom();
  }, [props.logs]);

  return (
    <div>
      {props.showFilters && (
        <div className="mb-5">
          <LogsFilters
            onAutoScrollChanged={(autoscroll: boolean) => {
              setAutoScroll(autoscroll);

              if (autoScroll) {
                scrollToBottom();
              }
            }}
            onFilterChanged={props.onFilterChanged}
          />
        </div>
      )}
      {!props.isLoading && (
        <div
          ref={logsViewerRef}
          className="shadow-xl rounded-xl bg-slate-800 p-5 overflow-hidden hover:overflow-y-auto dark-scrollbar"
          style={{
            height: screenHeight - 520,
          }}
        >
          {props.logs.map((log: Log, i: number) => {
            return <LogItem key={i} log={log} />;
          })}

          {props.logs.length === 0 && (
            <div className={`text-slate-200 courier-prime`}>
              {props.noLogsMessage || "No logs found for this service."}
            </div>
          )}
        </div>
      )}
      {props.isLoading && <ComponentLoader />}
    </div>
  );
};

export default LogsViewer;
