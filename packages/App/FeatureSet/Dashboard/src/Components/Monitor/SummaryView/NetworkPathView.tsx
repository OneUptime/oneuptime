import TracerouteHopsTable from "../../NetworkDevice/TracerouteHopsTable";
import NetworkPathTrace, {
  TraceRoute,
  TraceRouteHop,
} from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import React, { FunctionComponent, ReactElement } from "react";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

export interface ComponentProps {
  networkPathTrace: NetworkPathTrace;
}

// The line under the hop table: the verdict, then the trace's own message.
export const NETWORK_PATH_VERDICT_TEST_ID: string = "network-path-verdict";

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
    const failedHop: number = traceRoute.failedHop;

    // The hop's number in the sentence's digits, as the hop table writes it.
    return translator.translateTemplate("Route broke at hop {{hop}}.", {
      hop: composedValue((sentence: Translator): string => {
        return sentence.formatNumber(failedHop);
      }),
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
        {translator.translateText("Network Path at Time of Failure")}
      </div>
      <div className="text-xs text-gray-500 mb-3">
        {translator.translateText(
          "Traceroute captured by the probe when this check failed.",
        )}
      </div>

      {trace.dnsLookup && (
        <div className="mb-3 text-sm text-gray-700">
          <span className="font-medium">
            {translator.translateText("DNS:")}
          </span>{" "}
          {trace.dnsLookup.isSuccess ? (
            <span>
              <TranslatedSentence
                template="{{host}} resolved to {{addresses}} in {{time}} ms"
                values={{
                  host: trace.dnsLookup.hostName,
                  // In the sentence's digits: Persian ones in a Persian sentence.
                  time: composedValue((sentence: Translator): string => {
                    return sentence.formatNumber(trace.dnsLookup!.resolvedInMS);
                  }),
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
              {trace.dnsLookup.errorMessage ? (
                <ErrorSentence
                  template="Lookup for {{host}} failed — {{error}}"
                  error={trace.dnsLookup.errorMessage}
                  values={{ host: trace.dnsLookup.hostName }}
                />
              ) : (
                translator.translateTemplate("Lookup for {{host}} failed", {
                  host: trace.dnsLookup.hostName,
                })
              )}
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

      {/*
       * The trace's own message is the probe's, as it wrote it (English):
       * set apart from the verdict, so on an Arabic or Persian page it
       * reads left to right with its full stop at its end.
       */}
      {trace.traceRoute && (
        <div
          className="mt-2 text-xs text-gray-500"
          data-testid={NETWORK_PATH_VERDICT_TEST_ID}
        >
          {getRouteVerdict(trace.traceRoute, translator)}
          {trace.traceRoute.failureMessage ? (
            <>
              {" "}
              <IsolatedText text={trace.traceRoute.failureMessage} />
            </>
          ) : (
            <></>
          )}
        </div>
      )}
    </div>
  );
};

export default NetworkPathView;
