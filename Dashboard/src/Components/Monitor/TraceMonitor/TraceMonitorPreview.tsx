import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import TraceTable from "../../Traces/TraceTable";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";
import JSONFunctions from "Common/Types/JSONFunctions";

export interface ComponentProps {
  monitorStepTraceMonitor: MonitorStepTraceMonitor | undefined;
}

const TraceMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  type RefreshQueryFunction = () => Query<Span>;

  const refreshQuery: RefreshQueryFunction = (): Query<Span> => {
    if (!props.monitorStepTraceMonitor) {
      return {};
    }
    return MonitorStepTraceMonitorUtil.toQuery(props.monitorStepTraceMonitor);
  };

  const [spanQuery, setSpanQuery] = React.useState<Query<Span>>(refreshQuery());

  useEffect(() => {
    const query: Query<Span> = refreshQuery();

    if (JSONFunctions.isJSONObjectDifferent(spanQuery, query)) {
      setSpanQuery(query);
    }
  }, [props.monitorStepTraceMonitor]);

  return <TraceTable isMinimalTable={true} spanQuery={spanQuery} />;
};

export default TraceMonitorPreview;
