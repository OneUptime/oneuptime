import TracerouteHopsTable from "../../NetworkDevice/TracerouteHopsTable";
import NetworkPathTrace, {
  TraceRoute,
  TraceRouteHop,
} from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import React, { FunctionComponent, ReactElement } from "react";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

export interface ComponentProps {
  networkPathTrace: NetworkPathTrace;
}

/*
 * The one-line verdict under the hop table.
 *
 * With no hops the probe recorded no path at all: traceroute never ran (a
 * probe with no IPv6 fails "connect: Cannot assign requested address"
 * before one packet leaves it), hit its deadline, or printed nothing we
 * could read. "Route did not reach the destination." there told the
 * customer their host was off the network when the path was never walked,
 * so nothing is said about the route; the trace's own failure message,
 * shown right after, says why.
 */
type GetRouteVerdictFunction = (
  traceRoute: TraceRoute,
  translator: Translator,
) => string;

const getRouteVerdict: GetRouteVerdictFunction = (
  traceRoute: TraceRoute,
  translator: Translator,
): string => {
  const hops: Array<TraceRouteHop> = traceRoute.hops || [];

  if (hops.length === 0) {
    return translator.translateTemplate("No path was recorded.");
  }

  if (traceRoute.isComplete) {
    return translator.translateTemplate("Route reached the destination.");
  }

  if (traceRoute.failedHop !== undefined) {
    return translator.translateTemplate("Route broke at hop {{hop}}.", {
      hop: traceRoute.failedHop,
    });
  }

  return translator.translateTemplate("Route did not reach the destination.");
};

/*
 * Renders the traceroute + DNS lookup the probe captured when a network
 * check failed — the path evidence for "where did it break?".
 */
const NetworkPathView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const trace: NetworkPathTrace = props.networkPathTrace;

  if (!trace.dnsLookup && !trace.traceRoute) {
    return null;
  }

  return (
    <div className="rounded-md border-2 border-gray-100 p-4">
      <div className="text-sm font-medium text-gray-900 mb-1">
        {translator.translateText("Network Path at Time of Failure")}</div>
      <div className="text-xs text-gray-500 mb-3">
        {translator.translateText("Traceroute captured by the probe when this check failed.")}</div>

      {trace.dnsLookup && (
        <div className="mb-3 text-sm text-gray-700">
          <span className="font-medium">{translator.translateText("DNS:")}</span>{" "}
          {trace.dnsLookup.isSuccess ? (
            <span>
              <TranslatedSentence
                template="{{host}} resolved to {{addresses}} in {{time}} ms"
                values={{
                  host: trace.dnsLookup.hostName,
                  time: trace.dnsLookup.resolvedInMS,
                }}
                slots={{
                  addresses: (
                    <span className="font-mono">
                      {trace.dnsLookup.resolvedAddresses.join(", ")}
                    </span>
                  ),
                }}
              />
            </span>
          ) : (
            <span className="text-red-700">
              {trace.dnsLookup.errorMessage
                ? translator.translateTemplate(
                    "Lookup for {{host}} failed — {{error}}",
                    {
                      host: trace.dnsLookup.hostName,
                      error: trace.dnsLookup.errorMessage,
                    },
                  )
                : translator.translateTemplate("Lookup for {{host}} failed", {
                    host: trace.dnsLookup.hostName,
                  })}
            </span>
          )}
        </div>
      )}

      {/*
       * The hop table is shared with the on-demand device traceroute
       * (issue #3745); it renders nothing for an empty hop list.
       */}
      {trace.traceRoute && (
        <TracerouteHopsTable hops={trace.traceRoute.hops || []} />
      )}

      {trace.traceRoute && (
        <div className="mt-2 text-xs text-gray-500">
          {getRouteVerdict(trace.traceRoute, translator)}
          {trace.traceRoute.failureMessage
            ? ` ${trace.traceRoute.failureMessage}`
            : ""}
        </div>
      )}
    </div>
  );
};

export default NetworkPathView;
