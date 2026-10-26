import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import SqlMonitorResponse from "Common/Types/Monitor/SqlMonitor/SqlMonitorResponse";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";
import {
  SUMMARY_TABLE_FRAME_CLASS_NAME,
  SummaryFact,
  SummaryFacts,
  SummaryView,
} from "./SummaryFacts";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const SqlMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const sqlResponse: SqlMonitorResponse | undefined =
    props.probeMonitorResponse?.sqlQueryMonitorResponse;

  let responseTimeInMs: number = sqlResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const scalarValue: string =
    sqlResponse?.scalarValue === null || sqlResponse?.scalarValue === undefined
      ? "-"
      : String(sqlResponse.scalarValue);

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="sql-monitor-summary">
      <SummaryFacts>
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Status"
          value={translator.translateTemplate(
            props.probeMonitorResponse.isOnline ? "Online" : "Offline",
          )}
        />
        <SummaryFact
          title="Row Count"
          value={
            sqlResponse?.rowCount === null ||
            sqlResponse?.rowCount === undefined
              ? "-"
              : sqlResponse.rowCount.toString()
          }
        />
        <SummaryFact
          title="Rows Truncated"
          value={
            translator.translateText(
              sqlResponse?.isRowsCapped ? "Yes (result capped)" : "No",
            ) || ""
          }
        />
        {/* A query's value may be text of any length: the row is its own. */}
        <SummaryFact isWide={true} title="Value" value={scalarValue} />
        <SummaryFact
          title="Execution Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <SummaryFact
          title="Monitored At"
          value={
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
        {sqlResponse?.queryError || props.probeMonitorResponse.failureCause ? (
          <SummaryFact
            isWide={true}
            title="Error"
            value={
              sqlResponse?.queryError ||
              props.probeMonitorResponse.failureCause?.toString() ||
              "-"
            }
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}

      {sqlResponse?.firstRow &&
        Object.keys(sqlResponse.firstRow).length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">
              {translator.translateText("First Row")}
            </h3>
            <div className={SUMMARY_TABLE_FRAME_CLASS_NAME}>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("Column")}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("Value")}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.keys(sqlResponse.firstRow).map(
                    (columnName: string, index: number) => {
                      const cellValue: unknown = (
                        sqlResponse.firstRow as Record<string, unknown>
                      )[columnName];
                      return (
                        <tr key={index}>
                          <td className="px-4 py-2 text-sm text-gray-500 font-mono">
                            {columnName}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900 font-mono break-all">
                            {cellValue === null || cellValue === undefined
                              ? "-"
                              : String(cellValue)}
                          </td>
                        </tr>
                      );
                    },
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </SummaryView>
  );
};

export default SqlMonitorView;
