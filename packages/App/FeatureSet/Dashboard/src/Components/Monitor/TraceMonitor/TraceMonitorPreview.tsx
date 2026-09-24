import React, { FunctionComponent, ReactElement, useMemo } from "react";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import TraceTable from "../../Traces/TraceTable";
import Query from "Common/Types/BaseDatabase/Query";
import Span from "Common/Models/AnalyticsModels/Span";
import Card from "Common/UI/Components/Card/Card";

export interface ComponentProps {
  monitorStepTraceMonitor: MonitorStepTraceMonitor | undefined;
  /*
   * "form" (the default) is the criteria editor, which draws its own
   * heading around the table. "overview" is the monitor overview, where the
   * preview is a card of its own.
   */
  context?: "form" | "overview" | undefined;
  // Overrides the overview card's description.
  description?: string | undefined;
}

const TraceMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const traceMonitorKey: string = JSON.stringify(
    props.monitorStepTraceMonitor || null,
  );

  /*
   * TraceTable re-syncs its query whenever it is handed a new object, and
   * every sync is a fetch, so the query is rebuilt only when the filter
   * itself changes - not on every render of the page around it.
   */
  const spanQuery: Query<Span> = useMemo(() => {
    if (!props.monitorStepTraceMonitor) {
      return {};
    }

    const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(
      props.monitorStepTraceMonitor,
    );

    /*
     * Drop the evaluation window. toQuery() stamps `now - lastXSecondsOfSpans
     * .. now`, resolved once when this renders, so the preview would keep
     * showing "the 60 seconds before the page opened" - which empties out a
     * minute later and reads as "my filter matches nothing". Without it the
     * table lists the newest matching spans, which is what a preview of the
     * filter is for. LogMonitorPreview drops its window for the same reason.
     */
    delete (query as Record<string, unknown>)["startTime"];

    return query;
  }, [traceMonitorKey]);

  /*
   * A preview must not read or write the page URL: a "Seen At" filter
   * restored from the URL would silently replace the monitor's own filter.
   */
  const table: ReactElement = (
    <TraceTable
      spanQuery={spanQuery}
      isMinimalTable={true}
      disableUrlState={true}
      noItemsMessage="No spans match this monitor's filter right now."
    />
  );

  if (props.context === "overview") {
    return (
      <Card
        title="Traces preview"
        description={
          props.description ||
          "The newest spans that match this monitor's filter."
        }
      >
        {table}
      </Card>
    );
  }

  return table;
};

export default TraceMonitorPreview;
