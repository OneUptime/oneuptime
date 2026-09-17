import React, { FunctionComponent, ReactElement, useEffect } from "react";
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
  type RefreshQueryFunction = () => Query<Log>;

  const refreshQuery: RefreshQueryFunction = (): Query<Log> => {
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
  };

  const [logQuery, setLogQuery] = React.useState<Query<Log>>(refreshQuery());

  useEffect(() => {
    setLogQuery(refreshQuery());
  }, [props.monitorStepLogMonitor]);

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
