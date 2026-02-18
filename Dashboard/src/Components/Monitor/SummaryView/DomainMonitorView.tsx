import OneUptimeDate from "Common/Types/Date";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import DomainMonitorResponse from "Common/Types/Monitor/DomainMonitor/DomainMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const DomainMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const domainResponse: DomainMonitorResponse | undefined =
    props.probeMonitorResponse?.domainResponse;

  let responseTimeInMs: number = domainResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  type FormatDateText = (dateStr: string | undefined) => string;

  const formatDateText: FormatDateText = (
    dateStr: string | undefined,
  ): string => {
    if (!dateStr) {
      return "-";
    }
    try {
      const date: Date = new Date(dateStr);
      return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
    } catch {
      return dateStr;
    }
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
          title="Expires At"
          value={formatDateText(domainResponse?.expiresDate)}
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
          title="Registrar"
          value={domainResponse?.registrar || "-"}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="Created"
          value={formatDateText(domainResponse?.createdDate)}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="DNSSEC"
          value={domainResponse?.dnssec || "-"}
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

      {/* Name Servers Section */}
      {domainResponse?.nameServers && domainResponse.nameServers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">Name Servers</h3>
          <div className="border rounded-md overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name Server
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {domainResponse.nameServers.map((ns: string, index: number) => {
                  return (
                    <tr key={index}>
                      <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                        {ns}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Domain Status Section */}
      {domainResponse?.domainStatus &&
        domainResponse.domainStatus.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">
              Domain Status Codes
            </h3>
            <div className="border rounded-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {domainResponse.domainStatus.map(
                    (status: string, index: number) => {
                      return (
                        <tr key={index}>
                          <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                            {status}
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

export default DomainMonitorView;
