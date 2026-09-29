import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import SqlMonitorResponse from "Common/Types/Monitor/SqlMonitor/SqlMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const SqlMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Probe"
          value={props.probeName || "-"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Status"
          value={props.probeMonitorResponse.isOnline ? "Online" : "Offline"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Row Count"
          value={
            sqlResponse?.rowCount === null ||
            sqlResponse?.rowCount === undefined
              ? "-"
              : sqlResponse.rowCount.toString()
          }
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Value"
          value={scalarValue}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Execution Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
      </div>

      <div className="flex space-x-3">
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100"
          title="Rows Truncated"
          value={sqlResponse?.isRowsCapped ? "Yes (result capped)" : "No"}
        />
        <InfoCard
          className="w-1/2 shadow-none border-2 border-gray-100"
          title="Monitored At"
          value={
            props.probeMonitorResponse?.monitoredAt
              ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  props.probeMonitorResponse.monitoredAt,
                )
              : "-"
          }
        />
      </div>

      {(sqlResponse?.queryError || props.probeMonitorResponse.failureCause) && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100"
            title="Error"
            value={
              sqlResponse?.queryError ||
              props.probeMonitorResponse.failureCause?.toString() ||
              "-"
            }
          />
        </div>
      )}

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}

      {sqlResponse?.firstRow &&
        Object.keys(sqlResponse.firstRow).length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">First Row</h3>
            <div className="border rounded-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Column
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Value
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
    </div>
  );
};

export default SqlMonitorView;
