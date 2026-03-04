import OneUptimeDate from "Common/Types/Date";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const SnmpMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const snmpResponse: SnmpMonitorResponse | undefined =
    props.probeMonitorResponse?.snmpResponse;

  let responseTimeInMs: number = snmpResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  return (
    <div className="space-y-5">
      <div className="flex space-x-3">
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100"
          title="Probe"
          value={props.probeName || "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100"
          title="Status"
          value={props.probeMonitorResponse.isOnline ? "Online" : "Offline"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100"
          title="Response Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/4 shadow-none border-2 border-gray-100"
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

      {props.probeMonitorResponse.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100"
            title="Error"
            value={props.probeMonitorResponse.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {/* OID Responses Section */}
      {snmpResponse?.oidResponses && snmpResponse.oidResponses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">OID Responses</h3>
          <div className="border rounded-md overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    OID
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Value
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {snmpResponse.oidResponses.map(
                  (oidResponse: SnmpOidResponse, index: number) => {
                    return (
                      <tr key={index}>
                        <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                          {oidResponse.oid}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {oidResponse.name || "-"}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900">
                          {oidResponse.value !== null
                            ? String(oidResponse.value)
                            : "-"}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {oidResponse.type}
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

export default SnmpMonitorView;
