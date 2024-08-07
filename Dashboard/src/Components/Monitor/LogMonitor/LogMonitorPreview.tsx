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
    return MonitorStepLogMonitorUtil.toQuery(props.monitorStepLogMonitor);
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
