import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import DnssecMonitorResponse, {
  DnssecNameserverCheck,
  DnssecResolverCheck,
} from "Common/Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";
import {
  SUMMARY_TABLE_FRAME_CLASS_NAME,
  SUMMARY_TABLE_VALUE_CLASS_NAME,
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

const DnssecMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
    return translator.translateTemplate(value ? "Yes" : "No");
  };

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="dnssec-monitor-summary">
      <SummaryFacts>
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Chain Valid"
          value={yesNo(dnssecResponse?.isChainValid)}
        />
        <SummaryFact
          title="Zone Signed"
          value={yesNo(dnssecResponse?.isZoneSigned)}
        />
        <SummaryFact
          title="DS at Parent"
          value={yesNo(dnssecResponse?.isParentDsPresent)}
        />
        <SummaryFact
          title="Resolver Consensus (AD)"
          value={yesNo(dnssecResponse?.resolverConsensusAd)}
        />
        <SummaryFact
          title="Nameservers Consistent"
          value={yesNo(dnssecResponse?.isNameserverConsistent)}
        />
        <SummaryFact
          title="Signature Expires"
          value={
            dnssecResponse?.daysUntilSignatureExpiry !== undefined
              ? translator.translatePlural(
                  {
                    one: "{{count}} day ({{date}})",
                    other: "{{count}} days ({{date}})",
                  },
                  dnssecResponse.daysUntilSignatureExpiry,
                  {
                    date: formatDateText(
                      dnssecResponse.earliestSignatureExpiration,
                    ),
                  },
                )
              : "-"
          }
        />
        <SummaryFact
          title="Response Time"
          value={responseTimeInMs ? responseTimeInMs + " ms" : "-"}
        />
        {props.probeMonitorResponse.failureCause ? (
          <SummaryFact
            isWide={true}
            title="Error"
            value={props.probeMonitorResponse.failureCause.toString()}
          />
        ) : (
          <></>
        )}
      </SummaryFacts>

      {dnssecResponse?.resolverChecks &&
        dnssecResponse.resolverChecks.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700">
              {translator.translateText("Resolver Checks")}
            </h3>
            <div className={SUMMARY_TABLE_FRAME_CLASS_NAME}>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("Resolver")}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("AD Flag")}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("SERVFAIL on validate")}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("Error")}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dnssecResponse.resolverChecks.map(
                    (check: DnssecResolverCheck, index: number) => {
                      return (
                        <tr key={index}>
                          <td
                            className={`px-4 py-2 text-sm text-gray-900 font-mono ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                          >
                            {check.resolver}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {yesNo(check.adFlag)}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {yesNo(check.servfailWhenValidating)}
                          </td>
                          <td
                            className={`px-4 py-2 text-sm text-gray-900 ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                          >
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
              {translator.translateText("Nameserver Consistency")}
            </h3>
            <div className={SUMMARY_TABLE_FRAME_CLASS_NAME}>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("Nameserver")}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("SOA Serial")}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("RRSIG Expires")}
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("Error")}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dnssecResponse.nameserverChecks.map(
                    (check: DnssecNameserverCheck, index: number) => {
                      return (
                        <tr key={index}>
                          <td
                            className={`px-4 py-2 text-sm text-gray-900 font-mono ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                          >
                            {check.nameServer}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900 font-mono">
                            {check.soaSerial || "-"}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            {formatDateText(check.rrsigExpiration)}
                          </td>
                          <td
                            className={`px-4 py-2 text-sm text-gray-900 ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                          >
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

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}
    </SummaryView>
  );
};

export default DnssecMonitorView;
