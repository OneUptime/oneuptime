import SnmpInterface from "Common/Types/Monitor/SnmpMonitor/SnmpInterface";
import React, { FunctionComponent, ReactElement } from "react";
import useResizableColumns, {
  ResizableColumns,
} from "Common/UI/Components/Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  interfaces: Array<SnmpInterface>;
  interfaceWalkFailure?: string | undefined;
}

const formatBitsPerSecond: (bps: number | undefined) => string = (
  bps: number | undefined,
): string => {
  if (bps === undefined) {
    return "-";
  }

  if (bps >= 1000000000) {
    return `${(bps / 1000000000).toFixed(2)} Gbps`;
  }

  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(2)} Mbps`;
  }

  if (bps >= 1000) {
    return `${(bps / 1000).toFixed(2)} Kbps`;
  }

  return `${Math.round(bps)} bps`;
};

/*
 * Interface inventory table for SNMP monitors with interface monitoring
 * enabled. Rates and utilization come from the server-side counter delta,
 * so they are blank on the very first check.
 */
const SnmpInterfacesView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  /*
   * The interfaces' columns as wide as a person makes them (Common's
   * Table/ColumnResize): an interface's name gives way, a reading never.
   */
  const interfaceColumns: ResizableColumns = useResizableColumns({
    tableKey: "snmp-interfaces-table",
    columns: [
      { id: "interface", cellNumber: 1 },
      { id: "status", cellNumber: 2 },
      { id: "speed", cellNumber: 3 },
      { id: "in", cellNumber: 4 },
      { id: "out", cellNumber: 5 },
      { id: "utilization", cellNumber: 6 },
      { id: "errors", cellNumber: 7 },
    ],
  });

  if (props.interfaceWalkFailure) {
    return (
      <div className="rounded-md border-2 border-gray-100 p-4 text-sm text-gray-700">
        <span className="font-medium">
          {translator.translateText("Interface walk failed:")}
        </span>{" "}
        {props.interfaceWalkFailure}
      </div>
    );
  }

  if (props.interfaces.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border-2 border-gray-100 p-4">
      <div className="text-sm font-medium text-gray-900 mb-1">
        {translator.translateTemplate("Network Interfaces ({{count}})", {
          count: props.interfaces.length,
        })}
      </div>
      <div className="text-xs text-gray-500 mb-3">
        {translator.translateText(
          "Live interface inventory from the last check. Bandwidth and utilization are averaged between checks.",
        )}
      </div>
      <div className="overflow-x-auto">
        {interfaceColumns.styles}
        <table
          className={`${interfaceColumns.getTableWidthClassName("min-w-full")} text-sm text-gray-700`}
          {...interfaceColumns.tableAttributes}
        >
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <ResizableHeaderCell
                className="pr-4 pb-2 font-medium"
                resize={interfaceColumns.getResize(
                  "interface",
                  translator.translateText("Interface") || "Interface",
                  ColumnWidthKind.Name,
                )}
              >
                <span>{translator.translateText("Interface")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="pr-4 pb-2 font-medium"
                resize={interfaceColumns.getResize(
                  "status",
                  translator.translateText("Status") || "Status",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Status")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="pr-4 pb-2 font-medium"
                resize={interfaceColumns.getResize(
                  "speed",
                  translator.translateText("Speed") || "Speed",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Speed")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="pr-4 pb-2 font-medium"
                resize={interfaceColumns.getResize(
                  "in",
                  translator.translateText("In") || "In",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("In")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="pr-4 pb-2 font-medium"
                resize={interfaceColumns.getResize(
                  "out",
                  translator.translateText("Out") || "Out",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Out")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="pr-4 pb-2 font-medium"
                resize={interfaceColumns.getResize(
                  "utilization",
                  translator.translateText("Utilization") || "Utilization",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Utilization")}</span>
              </ResizableHeaderCell>
              <ResizableHeaderCell
                className="pb-2 font-medium"
                resize={interfaceColumns.getResize(
                  "errors",
                  translator.translateText("Errors/s") || "Errors/s",
                  ColumnWidthKind.Whole,
                )}
              >
                <span>{translator.translateText("Errors/s")}</span>
              </ResizableHeaderCell>
            </tr>
          </thead>
          <tbody>
            {props.interfaces.map((snmpInterface: SnmpInterface) => {
              const isDown: boolean =
                snmpInterface.isAdministrativelyUp &&
                !snmpInterface.isOperationallyUp;

              return (
                <tr key={snmpInterface.interfaceIndex}>
                  <td className="pr-4 py-1">
                    <span className="font-mono">{snmpInterface.name}</span>
                    {snmpInterface.alias && (
                      <span className="ml-2 text-xs text-gray-500">
                        {snmpInterface.alias}
                      </span>
                    )}
                  </td>
                  <td className="pr-4 py-1">
                    {!snmpInterface.isAdministrativelyUp ? (
                      <span className="text-gray-400">
                        {translator.translateText("Disabled")}
                      </span>
                    ) : isDown ? (
                      <span className="font-medium text-red-700">
                        {translator.translateText("Down")}
                      </span>
                    ) : (
                      <span className="text-green-700">
                        {translator.translateText("Up")}
                      </span>
                    )}
                  </td>
                  <td className="pr-4 py-1">
                    {formatBitsPerSecond(snmpInterface.speedInBitsPerSecond)}
                  </td>
                  <td className="pr-4 py-1">
                    {formatBitsPerSecond(snmpInterface.inBitsPerSecond)}
                  </td>
                  <td className="pr-4 py-1">
                    {formatBitsPerSecond(snmpInterface.outBitsPerSecond)}
                  </td>
                  <td className="pr-4 py-1">
                    {snmpInterface.utilizationPercent !== undefined
                      ? `${snmpInterface.utilizationPercent}%`
                      : "-"}
                  </td>
                  <td className="py-1">
                    {snmpInterface.errorsPerSecond !== undefined ? (
                      <span
                        className={
                          snmpInterface.errorsPerSecond > 0
                            ? "text-red-700"
                            : ""
                        }
                      >
                        {snmpInterface.errorsPerSecond}
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SnmpInterfacesView;
