import OneUptimeDate from "Common/Types/Date";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import DnsMonitorResponse, {
  DnsRecordResponse,
} from "Common/Types/Monitor/DnsMonitor/DnsMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const DnsMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dnsResponse: DnsMonitorResponse | undefined =
    props.probeMonitorResponse?.dnsResponse;

  let responseTimeInMs: number = dnsResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const getDnssecStatusText = (): string => {
    if (dnsResponse?.isDnssecValid === undefined) {
      return "Unknown";
    }
    return dnsResponse.isDnssecValid ? "Valid" : "Invalid";
  };

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
          title="Response Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="DNSSEC"
          value={getDnssecStatusText()}
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

      {props.probeMonitorResponse.failureCause && (
        <div className="flex space-x-3">
          <InfoCard
            className="w-full shadow-none border-2 border-gray-100"
            title="Error"
            value={props.probeMonitorResponse.failureCause?.toString() || "-"}
          />
        </div>
      )}

      {/* DNS Records Section */}
      {dnsResponse?.records && dnsResponse.records.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">DNS Records</h3>
          <div className="border rounded-md overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Value
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    TTL
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dnsResponse.records.map(
                  (record: DnsRecordResponse, index: number) => {
                    return (
                      <tr key={index}>
                        <td className="px-4 py-2 text-sm text-gray-500 font-mono">
                          {record.type}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                          {record.value}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {record.ttl !== undefined ? record.ttl : "-"}
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

export default DnsMonitorView;
