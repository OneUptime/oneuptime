import { DataStorePostureReadFrom } from "../../../../Types/DataSecurity/DataStorePosture";
import { EgressGuardOptions } from "../../DataSource/EgressGuard";
import DataSourceHttpFetch, {
  DataSourceHttpResponse,
} from "../../DataSource/HttpFetch";
import {
  SearchHttpRequest,
  SearchHttpResponse,
  SearchHttpTransport,
  SearchTransportError,
} from "./SearchStoreSampler";

/*
 * HOW A SEARCH CLUSTER'S SAMPLER SENDS ITS REQUESTS (#11140).
 *
 * Through DataSourceHttpFetch, as every request to an address a tenant
 * chose goes: the host checked by the egress guard and the checked address
 * pinned, no redirect followed, the answer capped at 20 MB, through the
 * outbound proxy the operator set. Every status comes back as an answer -
 * the sampler reads a 401 or a 404 itself - and what came back with no
 * answer is a SearchTransportError that says why, so a page too large to
 * take can be asked for again halved, and a dropped plaintext connection
 * read as a cluster that requires TLS.
 *
 * On OneUptime's workers the guard holds the deployment's policy: no
 * private address on OneUptime Cloud. A probe runs in the customer's own
 * network, for the clusters only that network reaches, so it reaches
 * private addresses (never loopback or link-local, which no guarded
 * request reaches), and its errors say what the address resolved to: whoever
 * reads them runs that network.
 */

const TIMEOUT: RegExp = /timeout/i;
// Axios's own words: "maxContentLength size of 20971520 exceeded".
const TOO_LARGE: RegExp = /maxContentLength|maxBodyLength/i;
const DROPPED: RegExp =
  /socket hang up|connection reset|connection closed|connection aborted|econnreset|eproto|wrong version number|request aborted/i;

export const SEARCH_CLUSTER_TARGET_LABEL: string = "Search cluster";

export function toSearchTransportError(error: unknown): SearchTransportError {
  if (error instanceof SearchTransportError) {
    return error;
  }

  const message: string =
    error instanceof Error ? error.message : String(error || "no answer");

  if (TOO_LARGE.test(message)) {
    return new SearchTransportError("tooLarge", message);
  }

  if (TIMEOUT.test(message)) {
    return new SearchTransportError("timeout", message);
  }

  if (DROPPED.test(message)) {
    return new SearchTransportError("dropped", message);
  }

  return new SearchTransportError("unreachable", message);
}

export function createSearchTransport(
  egressOptions: EgressGuardOptions = {
    targetLabel: SEARCH_CLUSTER_TARGET_LABEL,
  },
): SearchHttpTransport {
  return async (request: SearchHttpRequest): Promise<SearchHttpResponse> => {
    try {
      const response: DataSourceHttpResponse = await DataSourceHttpFetch.fetch({
        method: request.method,
        url: request.url,
        headers: request.headers,
        timeoutInMs: request.timeoutInMs,
        acceptAnyStatus: true,
        tls: request.tls,
        egressOptions,
      });

      return { statusCode: response.statusCode, bodyText: response.bodyText };
    } catch (error) {
      throw toSearchTransportError(error);
    }
  };
}

// A probe's: inside the customer's network, private addresses and all.
export function createProbeSearchTransport(): SearchHttpTransport {
  return createSearchTransport({
    targetLabel: SEARCH_CLUSTER_TARGET_LABEL,
    blockPrivateAddresses: false,
    includeResolvedAddressInError: true,
  });
}

/*
 * Where OneUptime's own workers check a store from: outside every
 * customer's network on OneUptime Cloud, whose workers reach no private
 * address, so a store they reach is reachable from the internet; inside a
 * network they share with it on a OneUptime someone hosts, where that
 * says nothing of the internet.
 */
export function getWorkersPostureReadFrom(
  isBillingEnabled: boolean,
): DataStorePostureReadFrom {
  return isBillingEnabled
    ? DataStorePostureReadFrom.Internet
    : DataStorePostureReadFrom.Network;
}
