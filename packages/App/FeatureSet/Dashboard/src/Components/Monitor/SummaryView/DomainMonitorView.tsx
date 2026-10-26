import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import DomainMonitorResponse from "Common/Types/Monitor/DomainMonitor/DomainMonitorResponse";
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

const DomainMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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

  /*
   * The lookup's own reason for failing is the useful one - "the WHOIS server
   * for .digital answered without any registration data" rather than a blank
   * card. It is normally copied onto the envelope, but read both so a probe
   * that only filled one of them still explains itself.
   */
  const failureCause: string =
    props.probeMonitorResponse.failureCause?.toString() ||
    domainResponse?.failureCause ||
    "";

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="domain-monitor-summary">
      <SummaryFacts>
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Status"
          value={translator.translateTemplate(
            props.probeMonitorResponse.isOnline ? "Online" : "Offline",
          )}
        />
        <SummaryFact
          title="Expires At"
          value={formatDateText(domainResponse?.expiresDate)}
        />
        <SummaryFact
          title="Created"
          value={formatDateText(domainResponse?.createdDate)}
        />
        <SummaryFact
          isWide={true}
          title="Registrar"
          value={domainResponse?.registrar || "-"}
        />
        <SummaryFact title="DNSSEC" value={domainResponse?.dnssec || "-"} />
        {/* With the Auto lookup method this varies by TLD, so it is worth showing. */}
        <SummaryFact
          title="Lookup Method"
          value={domainResponse?.lookupMethod || "-"}
        />
        <SummaryFact
          title="Response Time"
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
        {failureCause ? (
          <SummaryFact isWide={true} title="Error" value={failureCause} />
        ) : (
          <></>
        )}
      </SummaryFacts>

      {/* Name Servers Section */}
      {domainResponse?.nameServers && domainResponse.nameServers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">
            {translator.translateText("Name Servers")}
          </h3>
          <div className={SUMMARY_TABLE_FRAME_CLASS_NAME}>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {translator.translateText("Name Server")}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {domainResponse.nameServers.map((ns: string, index: number) => {
                  return (
                    <tr key={index}>
                      <td
                        className={`px-4 py-2 text-sm text-gray-900 font-mono ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                      >
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
              {translator.translateText("Domain Status Codes")}
            </h3>
            <div className={SUMMARY_TABLE_FRAME_CLASS_NAME}>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {translator.translateText("Status")}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {domainResponse.domainStatus.map(
                    (status: string, index: number) => {
                      return (
                        <tr key={index}>
                          <td
                            className={`px-4 py-2 text-sm text-gray-900 font-mono ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                          >
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

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}
    </SummaryView>
  );
};

export default DomainMonitorView;
