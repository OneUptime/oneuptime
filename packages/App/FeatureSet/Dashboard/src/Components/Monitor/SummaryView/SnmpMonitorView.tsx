import OneUptimeDate from "Common/Types/Date";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import ProbeAttemptsView from "./ProbeAttemptsView";
import SnmpInterfacesView from "./SnmpInterfacesView";
import {
  SUMMARY_TABLE_FRAME_CLASS_NAME,
  SUMMARY_TABLE_TEXT_CLASS_NAME,
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

/*
 * An OID that may wrap after any of its dots, and only there: a long one
 * breaks at a dot rather than inside a number (or not at all, which left
 * the value beside it a sliver of the table), and still copies whole.
 */
export const OidBreakingAtDots: FunctionComponent<{ oid: string }> = (props: {
  oid: string;
}): ReactElement => {
  const parts: Array<string> = props.oid.split(".");

  return (
    <>
      {parts.map((part: string, index: number): ReactElement => {
        return (
          <Fragment key={index}>
            {part}
            {index < parts.length - 1 ? (
              <>
                .<wbr />
              </>
            ) : (
              <></>
            )}
          </Fragment>
        );
      })}
    </>
  );
};

const SnmpMonitorView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const snmpResponse: SnmpMonitorResponse | undefined =
    props.probeMonitorResponse?.snmpResponse;

  /*
   * The values' columns as wide as a person makes them (Common's
   * Table/ColumnResize): an OID, a name or a value gives way, a type never.
   */
  const valueColumns: ResizableColumns = useResizableColumns({
    tableKey: "snmp-monitor-values-table",
    columns: [
      { id: "oid", cellNumber: 1 },
      { id: "name", cellNumber: 2 },
      { id: "value", cellNumber: 3 },
      { id: "type", cellNumber: 4 },
    ],
  });

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
            {valueColumns.styles}
            <table
              className={`${valueColumns.getTableWidthClassName("min-w-full")} divide-y divide-gray-200`}
              {...valueColumns.tableAttributes}
            >
              <thead className="bg-gray-50">
                <tr>
                  <ResizableHeaderCell
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    resize={valueColumns.getResize(
                      "oid",
                      translator.translateText("OID") || "OID",
                      ColumnWidthKind.Text,
                    )}
                  >
                    <span>{translator.translateText("OID")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    resize={valueColumns.getResize(
                      "name",
                      translator.translateText("Name") || "Name",
                      ColumnWidthKind.Name,
                    )}
                  >
                    <span>{translator.translateText("Name")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    resize={valueColumns.getResize(
                      "value",
                      translator.translateText("Value") || "Value",
                      ColumnWidthKind.Prose,
                    )}
                  >
                    <span>{translator.translateText("Value")}</span>
                  </ResizableHeaderCell>
                  <ResizableHeaderCell
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    resize={valueColumns.getResize(
                      "type",
                      translator.translateText("Type") || "Type",
                      ColumnWidthKind.Whole,
                    )}
                  >
                    <span>{translator.translateText("Type")}</span>
                  </ResizableHeaderCell>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {snmpResponse.oidResponses.map(
                  (oidResponse: SnmpOidResponse, index: number) => {
                    return (
                      <tr key={index}>
                        <td
                          className={`px-4 py-2 text-sm text-gray-900 font-mono ${SUMMARY_TABLE_TEXT_CLASS_NAME}`}
                        >
                          <OidBreakingAtDots oid={oidResponse.oid} />
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
