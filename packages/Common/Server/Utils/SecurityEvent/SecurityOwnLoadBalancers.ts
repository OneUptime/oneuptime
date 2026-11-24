import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  OWN_LOAD_BALANCER_RESOURCE_TYPES,
  OwnLoadBalancerKind,
  OwnLoadBalancerReading,
  addResolvedAddresses,
  readOwnLoadBalancer,
} from "../../../Utils/SecurityEvent/OwnLoadBalancers";
import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import CloudResourceService from "../../Services/CloudResourceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DnsResolutionCache, {
  DnsResolution,
} from "../Monitor/DnsResolutionCache";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE PROJECT'S OWN LOAD BALANCERS, AS SECURITY EVENTS TRUSTS THEM (#10546).
 *
 * Which of the project's cloud resources forward its clients, and why only
 * those, is Utils/SecurityEvent/OwnLoadBalancers. This reads them: the
 * project's resources of those types in one bounded query - its connected
 * cloud accounts' AWS ELB load balancers, Google Cloud forwarding rules and
 * Azure public IP addresses - and the DNS names AWS lists a load balancer by,
 * looked up at most every five minutes.
 *
 *   - For the scans (getTrustedBlocks): read as OneUptime, kept five minutes
 *     a project - a load balancer added or gone reaches the scans within
 *     five, as its DNS answers do. A read that fails throws, and the scans
 *     trust what they could read without it (SecurityTrustedProxies). A
 *     name whose lookup failed adds no address: trusting less, never more.
 *   - For Trusted Proxies (read with the reader's props): what is trusted,
 *     each load balancer named with its kind and the cloud account it is
 *     in. A reader who may not read cloud resources is told nothing of them
 *     (SecurityTrustedProxiesAPI).
 *
 * The cost, for a project with Security Events' scans on: one query a five
 * minutes on (projectId, isArchived), and a lookup of each AWS load
 * balancer's name, ten at a time, each answer kept five minutes.
 */

// The most rows one read takes: load balancers, forwarding rules and Azure public IP addresses together.
export const OWN_LOAD_BALANCER_ROWS_READ: number = 1000;

// The most AWS load balancer names one read looks up.
export const OWN_LOAD_BALANCER_NAMES_RESOLVED: number = 200;

// How many names are looked up at once.
const NAMES_RESOLVED_AT_ONCE: number = 10;

// How long the scans keep a project's trusted load balancers.
export const OWN_LOAD_BALANCERS_CACHE_TTL_MS: number = 5 * 60 * 1000;

// How soon a name whose lookup failed is asked again.
export const OWN_LOAD_BALANCER_DNS_RETRY_IN_MS: number = 30 * 1000;

const MAX_CACHED_PROJECTS: number = 10_000;

export interface SecurityOwnLoadBalancer {
  kind: OwnLoadBalancerKind;
  // The load balancer's name, the forwarding rule's, the gateway's.
  name: string;
  // The cloud resource it was read from.
  recordId: string;
  // The cloud account it is in, by its connection's name.
  where: string;
  // Its public addresses: as the record names them, and as its names resolved.
  addresses: Array<string>;
}

export interface SecurityOwnLoadBalancersRead {
  loadBalancers: Array<SecurityOwnLoadBalancer>;
  /*
   * False when there were more rows or names than one read takes, or a
   * name's lookup failed: a load balancer may be left out, and is then not
   * trusted.
   */
  isComplete: boolean;
}

const trustedCache: InMemoryTTLCache<Array<NetworkAddressBlock>> =
  new InMemoryTTLCache<Array<NetworkAddressBlock>>(MAX_CACHED_PROJECTS);

export default class SecurityOwnLoadBalancers {
  private static dnsCache: DnsResolutionCache = new DnsResolutionCache({
    failureTtlInMs: OWN_LOAD_BALANCER_DNS_RETRY_IN_MS,
  });

  // For tests: how load balancers' names are resolved.
  public static setDnsCacheForTests(cache: DnsResolutionCache): void {
    this.dnsCache = cache;
  }

  // Forget what the scans read, so a test reads the load balancers it set up.
  public static clearCache(): void {
    trustedCache.clear();
  }

  /*
   * The project's own load balancers that forward its clients, each with
   * its public addresses, read as `props` reads. Throws when the inventory
   * cannot be read.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityOwnLoadBalancersRead> {
    const rows: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        cloudResourceType: QueryHelper.any([
          ...OWN_LOAD_BALANCER_RESOURCE_TYPES,
        ]) as never,
      },
      select: {
        _id: true,
        name: true,
        cloudResourceType: true,
        providerResourceId: true,
        cloudProperties: true,
        cloudEndpoints: true,
        cloudRelationships: true,
        cloudConnection: { name: true },
      },
      skip: 0,
      limit: OWN_LOAD_BALANCER_ROWS_READ + 1,
      props: data.props,
    });

    let isComplete: boolean = rows.length <= OWN_LOAD_BALANCER_ROWS_READ;

    const found: Array<{ row: CloudResource; reading: OwnLoadBalancerReading }> =
      [];

    for (const row of rows.slice(0, OWN_LOAD_BALANCER_ROWS_READ)) {
      const reading: OwnLoadBalancerReading | null = readOwnLoadBalancer(row);

      if (reading) {
        found.push({ row, reading });
      }
    }

    const loadBalancers: Array<SecurityOwnLoadBalancer> = [];
    let namesLookedUp: number = 0;

    for (
      let index: number = 0;
      index < found.length;
      index += NAMES_RESOLVED_AT_ONCE
    ) {
      const batch: Array<{
        row: CloudResource;
        reading: OwnLoadBalancerReading;
      }> = found.slice(index, index + NAMES_RESOLVED_AT_ONCE);

      // Each load balancer's names, up to what one read looks up.
      const names: Array<Array<string>> = batch.map(
        (item: { reading: OwnLoadBalancerReading }): Array<string> => {
          const allowed: number = Math.max(
            0,
            OWN_LOAD_BALANCER_NAMES_RESOLVED - namesLookedUp,
          );
          const kept: Array<string> = item.reading.hostNames.slice(0, allowed);

          if (kept.length < item.reading.hostNames.length) {
            isComplete = false;
          }

          namesLookedUp += kept.length;

          return kept;
        },
      );

      const resolutions: Array<Array<DnsResolution>> = await Promise.all(
        names.map((list: Array<string>): Promise<Array<DnsResolution>> => {
          return Promise.all(
            list.map((name: string): Promise<DnsResolution> => {
              return this.dnsCache.lookup(name);
            }),
          );
        }),
      );

      batch.forEach(
        (
          item: { row: CloudResource; reading: OwnLoadBalancerReading },
          position: number,
        ): void => {
          const resolved: Array<string> = [];

          for (const resolution of resolutions[position] || []) {
            isComplete = isComplete && resolution.isResolved;
            resolved.push(...resolution.addresses);
          }

          const addresses: Array<string> = addResolvedAddresses(
            item.reading,
            resolved,
          );

          if (addresses.length === 0) {
            return;
          }

          loadBalancers.push({
            kind: item.reading.kind,
            name: item.reading.name,
            recordId: item.row.id?.toString() || "",
            where: item.row.cloudConnection?.name || "",
            addresses,
          });
        },
      );
    }

    return { loadBalancers, isComplete };
  }

  /*
   * The public addresses of the project's own load balancers, as blocks of
   * one address each: what the scans add to its trusted proxies. Read as
   * OneUptime - a proxy is trusted whoever's events are read - and kept
   * five minutes. Throws when the inventory cannot be read, and keeps
   * nothing then: the next scan reads again.
   */
  public static async getTrustedBlocks(
    projectId: ObjectID,
  ): Promise<Array<NetworkAddressBlock>> {
    const key: string = projectId.toString();
    const cached: Array<NetworkAddressBlock> | undefined = trustedCache.get(key);

    if (cached) {
      return cached;
    }

    const read: SecurityOwnLoadBalancersRead = await this.read({
      projectId,
      props: { isRoot: true },
    });

    const blocks: Array<NetworkAddressBlock> = [];
    const seen: Set<string> = new Set<string>();

    for (const loadBalancer of read.loadBalancers) {
      for (const address of loadBalancer.addresses) {
        const block: NetworkAddressBlock | null =
          NetworkAddressBlockUtil.parse(address);

        if (block && !seen.has(block.text)) {
          seen.add(block.text);
          blocks.push(block);
        }
      }
    }

    trustedCache.set(key, blocks, OWN_LOAD_BALANCERS_CACHE_TTL_MS);

    return blocks;
  }
}
