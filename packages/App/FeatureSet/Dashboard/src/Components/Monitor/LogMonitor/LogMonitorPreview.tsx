import React, { FunctionComponent, ReactElement, useMemo } from "react";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import DashboardLogsViewer from "../../Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";

export interface ComponentProps {
  monitorStepLogMonitor: MonitorStepLogMonitor | undefined;
}

const LogMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const logMonitorKey: string = props.monitorStepLogMonitor
    ? JSON.stringify(
        MonitorStepLogMonitorUtil.toJSON(props.monitorStepLogMonitor),
      )
    : "";

  /*
   * The logs viewer resets its filters and page and refetches whenever it
   * is handed a new query object. The monitor overview polls every minute
   * and hands down a freshly read monitor each time, so the query is
   * rebuilt only when the filter itself changes: an identity-keyed rebuild
   * re-ran the log query every minute and threw anyone paging through the
   * preview back to page 1.
   */
  const logQuery: Query<Log> = useMemo(() => {
    if (!props.monitorStepLogMonitor) {
      return {};
    }

    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(
      props.monitorStepLogMonitor,
    );

    /*
     * Drop the evaluation window. toQuery() stamps `now - lastXSecondsOfLogs
     * .. now`, resolved once when the form renders, and the viewer now honours
     * an explicit window by pinning its picker to it. Pinning is right for an
     * incident — that window is the moment being investigated — but wrong
     * here: this preview exists to help someone tune filters, and a window
     * frozen at "the 60 seconds before I opened this form" empties out a
     * minute later and reads as "my filter matches nothing". Leaving it off
     * keeps the viewer's own rolling range, which is what this preview has
     * always shown.
     */
    delete (query as Record<string, unknown>)["time"];

    return query;
  }, [logMonitorKey]);

  return (
    <DashboardLogsViewer
      id="logs-preview"
      logQuery={logQuery}
      limit={10}
      noLogsMessage="No logs found"
    />
  );
};

export default LogMonitorPreview;
