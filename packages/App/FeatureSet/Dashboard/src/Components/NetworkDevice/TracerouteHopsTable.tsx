import { NETWORK_DEVICE_METRIC_DESCRIPTIONS } from "../MetricDescriptions/NetworkDeviceMetricDescriptions";
import { TraceRouteHop } from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  hops: Array<TraceRouteHop>;
}

/*
 * The hop-by-hop table of a traceroute: hop number, the host that answered
 * (or "* * *" when nothing did), and its round-trip time. Extracted from the
 * Network monitor's NetworkPathView so the on-demand device traceroute
 * (issue #3745) renders the same table — one place to keep the timeout
 * spelling and the red-row rule.
 */
const TracerouteHopsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.hops.length === 0) {
    return <></>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm text-gray-700">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="pr-4 pb-2 font-medium">Hop</th>
            <th className="pr-4 pb-2 font-medium">Host</th>
            <th className="pb-2 font-medium">
              {/*
               * Only the first of the probe's replies per hop is kept, and
               * routers often put answering these probes last — the (i)
               * says so before a high hop reads as the fault.
               */}
              <span className="inline-flex items-center gap-1">
                RTT
                <InfoTooltip
                  label="RTT"
                  text={NETWORK_DEVICE_METRIC_DESCRIPTIONS.tracerouteRtt}
                />
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.hops.map((hop: TraceRouteHop): ReactElement => {
            return (
              <tr
                key={hop.hopNumber}
                className={hop.isTimeout ? "text-red-700" : ""}
              >
                <td className="pr-4 py-1 font-mono">{hop.hopNumber}</td>
                <td className="pr-4 py-1 font-mono break-all">
                  {hop.isTimeout
                    ? "* * *"
                    : `${hop.hostName ? hop.hostName + " " : ""}${
                        hop.address ? `(${hop.address})` : ""
                      }`}
                </td>
                <td className="py-1">
                  {hop.roundTripTimeInMS !== undefined
                    ? `${hop.roundTripTimeInMS} ms`
                    : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default TracerouteHopsTable;
