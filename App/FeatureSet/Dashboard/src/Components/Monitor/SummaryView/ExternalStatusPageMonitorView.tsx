import OneUptimeDate from "Common/Types/Date";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const ExternalStatusPageMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const externalStatusPageResponse:
    | ExternalStatusPageMonitorResponse
    | undefined = props.probeMonitorResponse?.externalStatusPageResponse;

  let responseTimeInMs: number =
    externalStatusPageResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

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
          title="Overall Status"
          value={externalStatusPageResponse?.overallStatus || "-"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Response Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
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

      <div className="flex space-x-3">
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="Active Incidents"
          value={
            externalStatusPageResponse?.activeIncidentCount?.toString() || "0"
          }
        />
      </div>

      {props.probeMonitorResponse.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100"
            title="Error"
            value={props.probeMonitorResponse.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {/* Component Statuses Section */}
      {externalStatusPageResponse?.componentStatuses &&
        externalStatusPageResponse.componentStatuses.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">
              Component Statuses
            </h3>
            <div className="border rounded-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Component
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {externalStatusPageResponse.componentStatuses.map(
                    (
                      component: ExternalStatusPageComponentStatus,
                      index: number,
                    ) => {
                      return (
                        <tr key={index}>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {component.name}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500 font-mono">
                            {component.status}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">
                            {component.description || "-"}
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

export default ExternalStatusPageMonitorView;
