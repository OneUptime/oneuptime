import SnmpInterface from "Common/Types/Monitor/SnmpMonitor/SnmpInterface";
import React, { FunctionComponent, ReactElement } from "react";

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
  if (props.interfaceWalkFailure) {
    return (
      <div className="rounded-md border-2 border-gray-100 p-4 text-sm text-gray-700">
        <span className="font-medium">Interface walk failed:</span>{" "}
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
        Network Interfaces ({props.interfaces.length})
      </div>
      <div className="text-xs text-gray-500 mb-3">
        Live interface inventory from the last check. Bandwidth and utilization
        are averaged between checks.
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-gray-700">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="pr-4 pb-2 font-medium">Interface</th>
              <th className="pr-4 pb-2 font-medium">Status</th>
              <th className="pr-4 pb-2 font-medium">Speed</th>
              <th className="pr-4 pb-2 font-medium">In</th>
              <th className="pr-4 pb-2 font-medium">Out</th>
              <th className="pr-4 pb-2 font-medium">Utilization</th>
              <th className="pb-2 font-medium">Errors/s</th>
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
                      <span className="text-gray-400">Disabled</span>
                    ) : isDown ? (
                      <span className="font-medium text-red-700">Down</span>
                    ) : (
                      <span className="text-green-700">Up</span>
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
