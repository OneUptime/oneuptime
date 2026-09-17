import TracerouteHopsTable from "../../NetworkDevice/TracerouteHopsTable";
import NetworkPathTrace from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
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

      {/*
       * The hop table is shared with the on-demand device traceroute
       * (issue #3745); it renders nothing for an empty hop list.
       */}
      {trace.traceRoute && <TracerouteHopsTable hops={trace.traceRoute.hops} />}

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
