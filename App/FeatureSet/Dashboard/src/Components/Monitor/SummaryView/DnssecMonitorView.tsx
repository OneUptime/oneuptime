import OneUptimeDate from "Common/Types/Date";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import DnssecMonitorResponse, {
  DnssecNameserverCheck,
  DnssecResolverCheck,
} from "Common/Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const DnssecMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dnssecResponse: DnssecMonitorResponse | undefined =
    props.probeMonitorResponse?.dnssecResponse;

  let responseTimeInMs: number = dnssecResponse?.responseTimeInMs || 0;
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

  const yesNo: (value: boolean | undefined) => string = (
    value: boolean | undefined,
  ): string => {
    if (value === undefined) {
      return "-";
    }
    return value ? "Yes" : "No";
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
          title="Chain Valid"
          value={yesNo(dnssecResponse?.isChainValid)}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Zone Signed"
          value={yesNo(dnssecResponse?.isZoneSigned)}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="DS at Parent"
          value={yesNo(dnssecResponse?.isParentDsPresent)}
        />
        <InfoCard
          className="w-1/5 shadow-none border-2 border-gray-100"
          title="Response Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
      </div>

      <div className="flex space-x-3">
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="Resolver Consensus (AD)"
          value={yesNo(dnssecResponse?.resolverConsensusAd)}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="Nameservers Consistent"
          value={yesNo(dnssecResponse?.isNameserverConsistent)}
        />
        <InfoCard
          className="w-1/3 shadow-none border-2 border-gray-100"
          title="Signature Expires"
          value={
            dnssecResponse?.daysUntilSignatureExpiry !== undefined
              ? `${dnssecResponse.daysUntilSignatureExpiry} days (${formatDateText(dnssecResponse.earliestSignatureExpiration)})`
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

      {dnssecResponse?.resolverChecks &&
        dnssecResponse.resolverChecks.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">
              Resolver Checks
            </h3>
            <div className="border rounded-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Resolver
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      AD Flag
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SERVFAIL on validate
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dnssecResponse.resolverChecks.map(
                    (check: DnssecResolverCheck, index: number) => {
                      return (
                        <tr key={index}>
                          <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                            {check.resolver}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {yesNo(check.adFlag)}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {yesNo(check.servfailWhenValidating)}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {check.error || "-"}
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

      {dnssecResponse?.nameserverChecks &&
        dnssecResponse.nameserverChecks.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">
              Nameserver Consistency
            </h3>
            <div className="border rounded-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Nameserver
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SOA Serial
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      RRSIG Expires
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dnssecResponse.nameserverChecks.map(
                    (check: DnssecNameserverCheck, index: number) => {
                      return (
                        <tr key={index}>
                          <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                            {check.nameServer}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                            {check.soaSerial || "-"}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {formatDateText(check.rrsigExpiration)}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {check.error || "-"}
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

export default DnssecMonitorView;
