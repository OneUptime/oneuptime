import dns from "dns";
import net from "net";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CLOUD_ENDPOINT_MAX_MONITOR_HOSTS,
  CloudEndpointName,
  CloudEndpointSuggestion,
  getCloudEndpointComparisonNames,
  getMonitorDestinationHosts,
  matchCloudEndpoints,
} from "../../../Types/Cloud/CloudEndpointMatch";
import { normalizeCloudHost } from "../../../Types/Cloud/CloudInventory";
import ObjectID from "../../../Types/ObjectID";
import CloudResourceService from "../../Services/CloudResourceService";
import MonitorService from "../../Services/MonitorService";
import logger from "../Logger";

/*
 * THE CLOUD RESOURCES A MONITOR SEEMS TO CHECK, OFFERED AS LINKS.
 *
 * A monitor's hosts (CloudEndpointMatch.getMonitorDestinationHosts) are
 * followed through DNS - the CNAME chain, then the addresses the last name
 * resolves to - and every name met is compared with the endpoints the
 * project's cloud connections listed. What matches, and is not linked to
 * the monitor yet, is suggested on the monitor's Linked Resources card;
 * linking stays a person's choice.
 *
 * Everything is read as the caller: the monitor with the caller's rights
 * (so a monitor the caller may not read suggests nothing), the resources
 * with theirs. DNS answers are never returned, only the caller's own
 * resources that match them. Lookups are bounded: a few hosts, a short
 * chain, a timeout each.
 */

// A CNAME chain is followed this far, at most.
export const CLOUD_ENDPOINT_CNAME_DEPTH: number = 5;
// Each DNS lookup gets this long.
export const CLOUD_ENDPOINT_DNS_TIMEOUT_MS: number = 2000;
// Resources compared, and suggestions made, at most.
export const CLOUD_ENDPOINT_CANDIDATE_LIMIT: number = 50;
export const CLOUD_ENDPOINT_SUGGESTION_LIMIT: number = 20;

export interface CloudEndpointDns {
  // The CNAME targets of a name; [] when it has none or cannot be read.
  resolveCname: (host: string) => Promise<Array<string>>;
  // The addresses a name resolves to; [] when it cannot be resolved.
  resolveAddresses: (host: string) => Promise<Array<string>>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: Error) => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        reject(new Error("DNS lookup timed out"));
      }, ms);
      timer.unref?.();

      promise
        .then((value: T) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
    },
  );
}

export const SYSTEM_CLOUD_ENDPOINT_DNS: CloudEndpointDns = {
  resolveCname: async (host: string): Promise<Array<string>> => {
    try {
      return await withTimeout(
        dns.promises.resolveCname(host),
        CLOUD_ENDPOINT_DNS_TIMEOUT_MS,
      );
    } catch {
      return [];
    }
  },
  resolveAddresses: async (host: string): Promise<Array<string>> => {
    try {
      const results: Array<dns.LookupAddress> = await withTimeout(
        dns.promises.lookup(host, { all: true, verbatim: true }),
        CLOUD_ENDPOINT_DNS_TIMEOUT_MS,
      );

      return results.map((result: dns.LookupAddress): string => {
        return result.address;
      });
    } catch {
      return [];
    }
  },
};

/*
 * Every name a host answers under, in order: the host, each name of its
 * CNAME chain, and the addresses the chain ends on. An address is its own
 * only name.
 */
export async function getCloudEndpointNames(
  host: string,
  lookups: CloudEndpointDns,
): Promise<Array<CloudEndpointName>> {
  const start: string = normalizeCloudHost(host);

  if (!start) {
    return [];
  }

  const names: Array<CloudEndpointName> = [{ name: start, via: start }];

  if (net.isIP(start)) {
    return names;
  }

  const seen: Set<string> = new Set<string>([start]);
  let current: string = start;

  for (let depth: number = 0; depth < CLOUD_ENDPOINT_CNAME_DEPTH; depth++) {
    const targets: Array<string> = await lookups.resolveCname(current);
    const next: string = normalizeCloudHost(targets[0] || "");

    if (!next || seen.has(next)) {
      break;
    }

    seen.add(next);
    names.push({ name: next, via: start });
    current = next;
  }

  for (const address of await lookups.resolveAddresses(current)) {
    const normalized: string = normalizeCloudHost(address);

    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      names.push({ name: normalized, via: start });
    }
  }

  return names;
}

export default class CloudEndpointSuggestions {
  /*
   * The resources the monitor seems to check and is not linked to, for
   * the caller. Nothing when the caller may not read the monitor, or it
   * checks no host.
   */
  public static async forMonitor(
    data: {
      monitorId: ObjectID;
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
    },
    lookups: CloudEndpointDns = SYSTEM_CLOUD_ENDPOINT_DNS,
  ): Promise<Array<CloudEndpointSuggestion>> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: {
        projectId: true,
        monitorSteps: true,
        cloudResources: {
          _id: true,
        },
      },
      props: data.props,
    });

    if (
      !monitor ||
      monitor.projectId?.toString() !== data.projectId.toString()
    ) {
      return [];
    }

    const hosts: Array<string> = getMonitorDestinationHosts(
      monitor.monitorSteps,
    ).slice(0, CLOUD_ENDPOINT_MAX_MONITOR_HOSTS);

    if (hosts.length === 0) {
      return [];
    }

    const names: Array<CloudEndpointName> = (
      await Promise.all(
        hosts.map((host: string): Promise<Array<CloudEndpointName>> => {
          return getCloudEndpointNames(host, lookups).catch(
            (err: Error): Array<CloudEndpointName> => {
              logger.debug(
                `Cloud link suggestions: ${host} could not be followed: ${err.message}`,
              );
              return [{ name: host, via: host }];
            },
          );
        }),
      )
    ).flat();

    const ids: Array<ObjectID> = await CloudResourceService.findIdsByEndpoints({
      projectId: data.projectId,
      endpoints: names.flatMap((name: CloudEndpointName): Array<string> => {
        return getCloudEndpointComparisonNames(name.name);
      }),
      limit: CLOUD_ENDPOINT_CANDIDATE_LIMIT,
    });

    if (ids.length === 0) {
      return [];
    }

    const linked: Set<string> = new Set<string>(
      (monitor.cloudResources || []).map((resource: CloudResource): string => {
        return resource._id?.toString() || "";
      }),
    );

    // The caller's own read of them: what they may not read is not offered.
    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        _id: new Includes(ids),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        cloudResourceType: true,
        cloudProvider: true,
        cloudEndpoints: true,
      },
      skip: 0,
      limit: CLOUD_ENDPOINT_CANDIDATE_LIMIT,
      props: data.props,
    });

    return matchCloudEndpoints({
      names,
      candidates: resources
        .filter((resource: CloudResource): boolean => {
          return Boolean(resource._id) && !linked.has(resource._id!.toString());
        })
        .map((resource: CloudResource) => {
          return {
            id: resource._id!.toString(),
            name: (resource.name as string) || "",
            type: (resource.cloudResourceType as string) || "",
            provider: (resource.cloudProvider as string) || "",
            endpoints: resource.cloudEndpoints,
          };
        }),
    }).slice(0, CLOUD_ENDPOINT_SUGGESTION_LIMIT);
  }
}
