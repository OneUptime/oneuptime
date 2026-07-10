import NetworkPathTrace, {
  TraceRouteHop,
} from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  networkPathTrace: NetworkPathTrace;
}

/*
 * Renders the traceroute + DNS lookup the probe captured when a network
 * check failed — the path evidence for "where did it break?".
 */
const NetworkPathView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const trace: NetworkPathTrace = props.networkPathTrace;

  if (!trace.dnsLookup && !trace.traceRoute) {
    return null;
  }

  return (
    <div className="rounded-md border-2 border-gray-100 p-4">
      <div className="text-sm font-medium text-gray-900 mb-1">
        Network Path at Time of Failure
      </div>
      <div className="text-xs text-gray-500 mb-3">
        Traceroute captured by the probe when this check failed.
      </div>

      {trace.dnsLookup && (
        <div className="mb-3 text-sm text-gray-700">
          <span className="font-medium">DNS:</span>{" "}
          {trace.dnsLookup.isSuccess ? (
            <span>
              {trace.dnsLookup.hostName} resolved to{" "}
              <span className="font-mono">
                {trace.dnsLookup.resolvedAddresses.join(", ")}
              </span>{" "}
              in {trace.dnsLookup.resolvedInMS} ms
            </span>
          ) : (
            <span className="text-red-700">
              Lookup for {trace.dnsLookup.hostName} failed
              {trace.dnsLookup.errorMessage
                ? ` — ${trace.dnsLookup.errorMessage}`
                : ""}
            </span>
          )}
        </div>
      )}

      {trace.traceRoute && trace.traceRoute.hops.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-gray-700">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="pr-4 pb-2 font-medium">Hop</th>
                <th className="pr-4 pb-2 font-medium">Host</th>
                <th className="pb-2 font-medium">RTT</th>
              </tr>
            </thead>
            <tbody>
              {trace.traceRoute.hops.map((hop: TraceRouteHop) => {
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
      )}

      {trace.traceRoute && (
        <div className="mt-2 text-xs text-gray-500">
          {trace.traceRoute.isComplete
            ? "Route reached the destination."
            : trace.traceRoute.failedHop !== undefined
              ? `Route broke at hop ${trace.traceRoute.failedHop}.`
              : "Route did not reach the destination."}
          {trace.traceRoute.failureMessage
            ? ` ${trace.traceRoute.failureMessage}`
            : ""}
        </div>
      )}
    </div>
  );
};

export default NetworkPathView;
