import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import DnsMonitorResponse, {
  DnsRecordResponse,
} from "Common/Types/Monitor/DnsMonitor/DnsMonitorResponse";
import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import ProbeAttemptsView from "./ProbeAttemptsView";
import {
  SUMMARY_TABLE_FRAME_CLASS_NAME,
  SUMMARY_TABLE_VALUE_CLASS_NAME,
  SummaryFact,
  SummaryFacts,
  SummaryView,
} from "./SummaryFacts";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  probeMonitorResponse: ProbeMonitorResponse;
  probeName?: string | undefined;
}

const DnsMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dnsResponse: DnsMonitorResponse | undefined =
    props.probeMonitorResponse?.dnsResponse;

  /*
   * The records' columns as wide as a person makes them (Common's
   * Table/ColumnResize): a record's value gives way, its type and TTL never.
   */
  const recordColumns: ResizableColumns = useResizableColumns({
    tableKey: "dns-monitor-records-table",
    columns: [
      { id: "type", cellNumber: 1 },
      { id: "value", cellNumber: 2 },
      { id: "ttl", cellNumber: 3 },
    ],
  });

  let responseTimeInMs: number = dnsResponse?.responseTimeInMs || 0;

  if (responseTimeInMs > 0) {
    responseTimeInMs = Math.round(responseTimeInMs);
  }

  type GetDnssecStatusText = () => string;

  /*
   * English, looked up where it is drawn. What the probe checks is whether a
   * validating resolver set the AD flag, and an unsigned zone never gets it:
   * "Not validated", not "Invalid", which would accuse every unsigned zone.
   */
  const getDnssecStatusText: GetDnssecStatusText = (): string => {
    if (dnsResponse?.isDnssecValid === undefined) {
      return translationKey("Unknown");
    }
    return dnsResponse.isDnssecValid
      ? translationKey("Validated")
      : translationKey("Not validated");
  };

  const probeAttempts: Array<ProbeAttempt> =
    props.probeMonitorResponse.probeAttempts || [];
  const totalAttempts: number =
    props.probeMonitorResponse.totalAttempts ?? probeAttempts.length;
  const hadRetries: boolean = totalAttempts > 1;

  return (
    <SummaryView dataTestId="dns-monitor-summary">
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
        <SummaryFact
          title="DNSSEC"
          value={translator.translateTemplate(getDnssecStatusText())}
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

      {hadRetries && (
        <ProbeAttemptsView
          attempts={probeAttempts}
          totalAttempts={totalAttempts}
        />
      )}

      {/* DNS Records Section */}
      {dnsResponse?.records && dnsResponse.records.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">
            {translator.translateText("DNS Records")}
          </h3>
          <div className={SUMMARY_TABLE_FRAME_CLASS_NAME}>
            {recordColumns.styles}
            <table
              className={`${recordColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200`}
              {...recordColumns.tableAttributes}
            >
              <thead className="bg-gray-50">
                <tr>
                  <ResizableHeaderCell
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    resize={recordColumns.getResize(
                      "type",
                      translator.translateText("Type") || "Type",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Type")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    resize={recordColumns.getResize(
                      "value",
                      translator.translateText("Value") || "Value",
                      ColumnWidthKind.Prose,
                    )}
                  >
                    <span>{translator.translateText("Value")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    resize={recordColumns.getResize(
                      "ttl",
                      translator.translateText("TTL") || "TTL",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("TTL")}</span>
                  </ResizableHeaderCell>
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
                        <td
                          className={`px-4 py-2 text-sm text-gray-900 font-mono ${SUMMARY_TABLE_VALUE_CLASS_NAME}`}
                        >
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
    </SummaryView>
  );
};

export default DnsMonitorView;
