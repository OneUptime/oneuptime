import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useMemo,
} from "react";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import DashboardLogsViewer from "../../Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

export interface ComponentProps {
  monitorStepLogMonitor: MonitorStepLogMonitor | undefined;
}

const LogMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Group By does not change which logs match, so it is left out of the
   * key: editing it must not reset and refetch the logs below.
   */
  const logMonitorKey: string = props.monitorStepLogMonitor
    ? JSON.stringify(
        MonitorStepLogMonitorUtil.toJSON({
          ...props.monitorStepLogMonitor,
          groupByAttributes: [],
        }),
      )
    : "";

  const groupByAttributes: Array<string> =
    MonitorStepLogMonitorUtil.getGroupByAttributes(props.monitorStepLogMonitor);

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
    <div>
      {groupByAttributes.length > 0 && (
        <p
          className="mb-3 rounded-md border border-indigo-100 bg-indigo-50/40 p-3 text-xs text-gray-600"
          data-testid="log-monitor-group-by-summary"
        >
          <TranslatedSentence
            template="Grouped by {{attributes}}: the criteria is checked separately for every distinct value, and each group that meets it raises its own alert or incident. Logs without the attribute count as one group with an empty value."
            slots={{
              attributes: (
                <Fragment>
                  {groupByAttributes.map((key: string, index: number) => {
                    return (
                      <Fragment key={key}>
                        {index > 0 ? ", " : ""}
                        <code className="rounded bg-indigo-100 px-1 py-0.5 text-[11px] text-indigo-700">
                          {key}
                        </code>
                      </Fragment>
                    );
                  })}
                </Fragment>
              ),
            }}
          />
        </p>
      )}
      <DashboardLogsViewer
        id="logs-preview"
        logQuery={logQuery}
        limit={10}
        noLogsMessage="No logs found"
      />
    </div>
  );
};

export default LogMonitorPreview;
