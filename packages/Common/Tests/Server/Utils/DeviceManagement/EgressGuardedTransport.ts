import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import DataSourceEgressGuard, {
  ResolvedAddress,
} from "../../../../Server/Utils/DataSource/EgressGuard";
import { DeviceManagementTransport } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";

/*
 * A transport that does what DataSourceHttpFetch does first - the egress
 * guard's check of the request's URL, with the request's own egress options
 * (its label, its private network hint) - before a fake answers it. What
 * the guard checks is real; only DNS is played, by `addresses`, and the
 * deployment's policy, by `blockPrivateAddresses` (true: OneUptime Cloud's;
 * false: a self-hosted install's). So a test can say where a host resolves,
 * and see that every request - the first, a page, a redirect, a retry - is
 * checked where it resolves then, and nothing is sent once one is refused.
 */

export interface EgressGuardedTransport {
  transport: DeviceManagementTransport;
  // The URLs the guard let through to the fake, in order.
  allowed: Array<string>;
  // The URLs the guard refused, in order.
  refused: Array<string>;
}

export function createEgressGuardedTransport(data: {
  inner: DeviceManagementTransport;
  // Host name (lowercased) to the addresses it resolves to; each call takes the next set, the last one repeating.
  addresses: Record<string, Array<Array<string>>>;
  blockPrivateAddresses: boolean;
}): EgressGuardedTransport {
  const allowed: Array<string> = [];
  const refused: Array<string> = [];
  const lookups: Map<string, number> = new Map<string, number>();

  const transport: DeviceManagementTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    try {
      await DataSourceEgressGuard.assertUrlAllowed(request.url, {
        ...(request.egressOptions || {}),
        blockPrivateAddresses: data.blockPrivateAddresses,
        resolveFunction: async (
          hostname: string,
        ): Promise<Array<ResolvedAddress>> => {
          const sets: Array<Array<string>> | undefined =
            data.addresses[hostname.toLowerCase()];

          if (!sets || sets.length === 0) {
            throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
          }

          const used: number = lookups.get(hostname.toLowerCase()) || 0;
          lookups.set(hostname.toLowerCase(), used + 1);

          return sets[Math.min(used, sets.length - 1)]!.map(
            (address: string): ResolvedAddress => {
              return { address, family: address.includes(":") ? 6 : 4 };
            },
          );
        },
      });
    } catch (error) {
      refused.push(request.url);
      throw error;
    }

    allowed.push(request.url);

    return data.inner(request);
  };

  return { transport, allowed, refused };
}
