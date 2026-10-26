import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import React, { FunctionComponent, ReactElement } from "react";
import ProbeAttemptsView from "./ProbeAttemptsView";
import SnmpInterfacesView from "./SnmpInterfacesView";
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

const SnmpMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const snmpResponse: SnmpMonitorResponse | undefined =
    props.probeMonitorResponse?.snmpResponse;

  let responseTimeInMs: number = snmpResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="snmp-monitor-summary">
      <SummaryFacts>
        <SummaryFact title="Probe" value={props.probeName || "-"} />
        <SummaryFact
          title="Status"
          value={translator.translateTemplate(
            props.probeMonitorResponse.isOnline ? "Online" : "Offline",
          )}
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

      {(snmpResponse?.interfaces || snmpResponse?.interfaceWalkFailure) && (
        <SnmpInterfacesView
          interfaces={snmpResponse?.interfaces || []}
          interfaceWalkFailure={snmpResponse?.interfaceWalkFailure}
        />
      )}

      {/* OID Responses Section */}
      {snmpResponse?.oidResponses && snmpResponse.oidResponses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">
            {translator.translateText("OID Responses")}
          </h3>
          <div className={SUMMARY_TABLE_FRAME_CLASS_NAME}>
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {translator.translateText("OID")}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {translator.translateText("Name")}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {translator.translateText("Value")}
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {translator.translateText("Type")}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {snmpResponse.oidResponses.map(
                  (oidResponse: SnmpOidResponse, index: number) => {
                    return (
                      <tr key={index}>
                        <td
                          className={`px-4 py-2 text-sm text-gray-900 font-mono ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                        >
                          {oidResponse.oid}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {oidResponse.name || "-"}
                        </td>
                        <td
                          className={`px-4 py-2 text-sm text-gray-900 ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                        >
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

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}
    </SummaryView>
  );
};

export default SnmpMonitorView;
