import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  GOOGLE_FRONT_END_RANGES,
  GoogleFrontEndUse,
  OWN_LOAD_BALANCER_RESOURCE_TYPES,
  OwnLoadBalancerKind,
  OwnLoadBalancerReading,
  addResolvedAddresses,
  readGoogleFrontEndUse,
  readOwnLoadBalancer,
} from "../../../Utils/SecurityEvent/OwnLoadBalancers";
import {
  GCP_SUBNETWORK_TYPE,
  GoogleProxyOnlyReading,
  PassOnLoadBalancerReading,
  PassOnRecord,
  readAwsPassOnLoadBalancer,
  readGoogleFrontEndPassOnLoadBalancer,
  readGoogleProxyOnlySubnetUses,
} from "../../../Utils/SecurityEvent/PassOnLoadBalancers";
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
 *
 * The same rows say whether Google's front ends are trusted (#11047,
 * readGoogleFrontEnds): an Application Load Balancer of the project's
 * connects from them, and nothing of it that passes a client's request on
 * as sent - a TCP or SSL proxy - connects from them too.
 */

// The most rows one read takes: load balancers, forwarding rules and Azure public IP addresses together.
export const OWN_LOAD_BALANCER_ROWS_READ: number = 1000;

// The most Google Cloud proxy-only subnets each of its two searches takes (#11389).
export const OWN_PROXY_ONLY_SUBNET_ROWS_READ: number = 500;

/*
 * What a proxy-only subnet's purpose holds (#11389): REGIONAL_MANAGED_PROXY
 * and GLOBAL_MANAGED_PROXY, and INTERNAL_HTTPS_LOAD_BALANCER, its name
 * before them. Read whole by PassOnLoadBalancers.readGoogleProxyOnlySubnet.
 */
const PROXY_ONLY_SUBNET_SEARCHES: ReadonlyArray<string> = [
  "MANAGED_PROXY",
  "INTERNAL_HTTPS_LOAD_BALANCER",
];

// A row as the pass-on readers read it, with the cloud account it is in.
function toPassOnRecord(row: CloudResource): PassOnRecord {
  return {
    cloudResourceType: row.cloudResourceType,
    providerResourceId: row.providerResourceId,
    name: row.name,
    cloudProperties: row.cloudProperties,
    cloudEndpoints: row.cloudEndpoints,
    cloudRelationships: row.cloudRelationships,
    where: row.cloudConnection?.name || "",
  };
}

function isReading(
  reading: PassOnLoadBalancerReading | null,
): reading is PassOnLoadBalancerReading {
  return reading !== null;
}

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

// A load balancer named where Google's front ends are said (#11047).
export interface SecurityGoogleFrontEndLoadBalancer {
  name: string;
  // The cloud account it is in, by its connection's name.
  where: string;
}

/*
 * Google's front ends (#11047, Utils/SecurityEvent/OwnLoadBalancers): the
 * ranges a connected Google Cloud project's Application Load Balancers
 * reach the project's apps from, and whether they are trusted.
 */
export interface SecurityGoogleFrontEnds {
  ranges: Array<string>;
  // The Application Load Balancers that bring them.
  broughtBy: Array<SecurityGoogleFrontEndLoadBalancer>;
  // The TCP or SSL proxy load balancers that keep them untrusted: they pass on what a client wrote.
  withheldBy: Array<SecurityGoogleFrontEndLoadBalancer>;
  // True when not every load balancer could be read: one that passes on may be left out.
  isWithheldForIncompleteRead: boolean;
  // Trusted: brought by one, withheld by none, and read whole.
  isTrusted: boolean;
}

export interface SecurityOwnLoadBalancersRead {
  loadBalancers: Array<SecurityOwnLoadBalancer>;
  /*
   * False when there were more rows or names than one read takes, or a
   * name's lookup failed: a load balancer may be left out, and is then not
   * trusted.
   */
  isComplete: boolean;
  /*
   * Google's front ends, when an Application Load Balancer of the
   * project's connects from them (#11047); null when none does.
   */
  googleFrontEnds: SecurityGoogleFrontEnds | null;
  /*
   * The project's load balancers that pass on what a client wrote (#11389,
   * Utils/SecurityEvent/PassOnLoadBalancers), each with the ranges it
   * connects from: never trusted, whatever lists them, and whether or not
   * Your Load Balancers is on.
   */
  passOnLoadBalancers: Array<PassOnLoadBalancerReading>;
}

// What the scans trust of the project's own load balancers, kept apart so a check can say which is which.
export interface SecurityOwnLoadBalancerBlocks {
  /*
   * Their own addresses, public and private, and the proxy-only subnets
   * only their Application Load Balancers connect from (#11389).
   */
  loadBalancers: Array<NetworkAddressBlock>;
  // Google's front ends, while trusted (SecurityGoogleFrontEnds.isTrusted).
  googleFrontEnds: Array<NetworkAddressBlock>;
  /*
   * Where the project's load balancers that pass on what a client wrote
   * connect from (#11389): never trusted.
   */
  untrusted: Array<NetworkAddressBlock>;
}

const trustedCache: InMemoryTTLCache<SecurityOwnLoadBalancerBlocks> =
  new InMemoryTTLCache<SecurityOwnLoadBalancerBlocks>(MAX_CACHED_PROJECTS);

/*
 * Google's front ends as the project's forwarding rules bring and withhold
 * them; null when none of its rules connects from them. A rule that passes
 * a client's request on keeps them untrusted, and so does a read cut short,
 * which may have left one out.
 */
export function readGoogleFrontEnds(data: {
  rows: ReadonlyArray<CloudResource>;
  isCut: boolean;
}): SecurityGoogleFrontEnds | null {
  const broughtBy: Array<SecurityGoogleFrontEndLoadBalancer> = [];
  const withheldBy: Array<SecurityGoogleFrontEndLoadBalancer> = [];

  for (const row of data.rows) {
    const use: GoogleFrontEndUse | null = readGoogleFrontEndUse(row);

    if (!use) {
      continue;
    }

    const named: SecurityGoogleFrontEndLoadBalancer = {
      name: (row.name || "").trim(),
      where: row.cloudConnection?.name || "",
    };

    if (use === GoogleFrontEndUse.Forwards) {
      broughtBy.push(named);
    } else {
      withheldBy.push(named);
    }
  }

  if (broughtBy.length === 0) {
    return null;
  }

  return {
    ranges: [...GOOGLE_FRONT_END_RANGES],
    broughtBy,
    withheldBy,
    isWithheldForIncompleteRead: data.isCut,
    isTrusted: withheldBy.length === 0 && !data.isCut,
  };
}

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

    const isCut: boolean = rows.length > OWN_LOAD_BALANCER_ROWS_READ;
    let isComplete: boolean = !isCut;
    const read: Array<CloudResource> = rows.slice(
      0,
      OWN_LOAD_BALANCER_ROWS_READ,
    );

    const found: Array<{
      row: CloudResource;
      reading: OwnLoadBalancerReading;
    }> = [];

    for (const row of read) {
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
      const names: Array<Array<string>> = [];

      for (const item of batch) {
        const allowed: number = Math.max(
          0,
          OWN_LOAD_BALANCER_NAMES_RESOLVED - namesLookedUp,
        );
        const kept: Array<string> = item.reading.hostNames.slice(0, allowed);

        if (kept.length < item.reading.hostNames.length) {
          isComplete = false;
        }

        namesLookedUp += kept.length;
        names.push(kept);
      }

      const resolutions: Array<Array<DnsResolution>> = await Promise.all(
        names.map((list: Array<string>): Promise<Array<DnsResolution>> => {
          return Promise.all(
            list.map((name: string): Promise<DnsResolution> => {
              return this.dnsCache.lookup(name);
            }),
          );
        }),
      );

      for (let position: number = 0; position < batch.length; position++) {
        const item: { row: CloudResource; reading: OwnLoadBalancerReading } =
          batch[position]!;
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
          continue;
        }

        loadBalancers.push({
          kind: item.reading.kind,
          name: item.reading.name,
          recordId: item.row.id?.toString() || "",
          where: item.row.cloudConnection?.name || "",
          addresses,
        });
      }
    }

    /*
     * The load balancers that pass on what a client wrote, and the
     * proxy-only subnets the project's Google Cloud load balancers connect
     * from (#11389): one only Application Load Balancers use is theirs.
     */
    const subnets: { rows: Array<CloudResource>; isCut: boolean } =
      await this.readProxyOnlySubnets(data);

    isComplete = isComplete && !subnets.isCut;

    const records: Array<PassOnRecord> = [...read, ...subnets.rows].map(
      toPassOnRecord,
    );
    const google: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records,
    });

    for (const use of google.uses) {
      if (
        use.passedOnBy.length === 0 &&
        use.forwardedBy.length > 0 &&
        use.subnet.ranges.length > 0
      ) {
        loadBalancers.push({
          kind: OwnLoadBalancerKind.GoogleCloudProxyOnlySubnet,
          name: use.subnet.name,
          recordId: "",
          where: use.subnet.where,
          addresses: [...use.subnet.ranges],
        });
      }
    }

    const passOnLoadBalancers: Array<PassOnLoadBalancerReading> = [
      ...records
        .map((record: PassOnRecord): PassOnLoadBalancerReading | null => {
          return readAwsPassOnLoadBalancer(record);
        })
        .filter(isReading),
      ...google.passOn,
      ...records
        .map((record: PassOnRecord): PassOnLoadBalancerReading | null => {
          return readGoogleFrontEndPassOnLoadBalancer(record);
        })
        .filter(isReading),
    ];

    return {
      loadBalancers,
      isComplete,
      googleFrontEnds: readGoogleFrontEnds({ rows: read, isCut }),
      passOnLoadBalancers,
    };
  }

  /*
   * The project's Google Cloud proxy-only subnets, read as `props` reads:
   * each of its subnets whose purpose names one, in two bounded queries (the
   * purposes of today and the one before them). Cut when there are more
   * than one read takes.
   */
  private static async readProxyOnlySubnets(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{ rows: Array<CloudResource>; isCut: boolean }> {
    const read: (purpose: string) => Promise<Array<CloudResource>> = (
      purpose: string,
    ): Promise<Array<CloudResource>> => {
      return CloudResourceService.findBy({
        query: {
          projectId: data.projectId,
          isArchived: false,
          cloudResourceType: GCP_SUBNETWORK_TYPE,
          cloudProperties: QueryHelper.search(purpose) as never,
        },
        select: {
          _id: true,
          name: true,
          cloudResourceType: true,
          providerResourceId: true,
          cloudProperties: true,
          cloudRelationships: true,
          cloudConnection: { name: true },
        },
        skip: 0,
        limit: OWN_PROXY_ONLY_SUBNET_ROWS_READ + 1,
        props: data.props,
      });
    };

    const answers: Array<Array<CloudResource>> = await Promise.all(
      PROXY_ONLY_SUBNET_SEARCHES.map((purpose: string) => {
        return read(purpose);
      }),
    );
    const rows: Array<CloudResource> = [];
    const seen: Set<string> = new Set<string>();

    for (const answer of answers) {
      for (const row of answer.slice(0, OWN_PROXY_ONLY_SUBNET_ROWS_READ)) {
        const id: string = row.id?.toString() || row.providerResourceId || "";

        // A subnet, each once: both searches can find the same one.
        if (row.cloudResourceType === GCP_SUBNETWORK_TYPE && !seen.has(id)) {
          seen.add(id);
          rows.push(row);
        }
      }
    }

    return {
      rows,
      isCut: answers.some((answer: Array<CloudResource>): boolean => {
        return answer.length > OWN_PROXY_ONLY_SUBNET_ROWS_READ;
      }),
    };
  }

  /*
   * What the scans add to the project's trusted proxies of its own load
   * balancers: their public addresses, as blocks of one address each, and
   * Google's front ends while trusted (#11047). Read as OneUptime - a proxy
   * is trusted whoever's events are read - and kept five minutes. Throws
   * when the inventory cannot be read, and keeps nothing then: the next
   * scan reads again.
   */
  public static async getTrusted(
    projectId: ObjectID,
  ): Promise<SecurityOwnLoadBalancerBlocks> {
    const key: string = projectId.toString();
    const cached: SecurityOwnLoadBalancerBlocks | undefined =
      trustedCache.get(key);

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

    const googleFrontEnds: Array<NetworkAddressBlock> = read.googleFrontEnds
      ?.isTrusted
      ? read.googleFrontEnds.ranges
          .map((range: string): NetworkAddressBlock | null => {
            return NetworkAddressBlockUtil.parse(range);
          })
          .filter(
            (
              block: NetworkAddressBlock | null,
            ): block is NetworkAddressBlock => {
              return block !== null;
            },
          )
      : [];

    // Where the load balancers that pass on what a client wrote connect from (#11389).
    const untrusted: Array<NetworkAddressBlock> = [];
    const untrustedSeen: Set<string> = new Set<string>();

    for (const loadBalancer of read.passOnLoadBalancers) {
      for (const range of loadBalancer.ranges) {
        const block: NetworkAddressBlock | null =
          NetworkAddressBlockUtil.parse(range);

        if (block && !untrustedSeen.has(block.text)) {
          untrustedSeen.add(block.text);
          untrusted.push(block);
        }
      }
    }

    const trusted: SecurityOwnLoadBalancerBlocks = {
      loadBalancers: blocks,
      googleFrontEnds,
      untrusted,
    };

    trustedCache.set(key, trusted, OWN_LOAD_BALANCERS_CACHE_TTL_MS);

    return trusted;
  }

  // Every block getTrusted holds, the load balancers' own first.
  public static async getTrustedBlocks(
    projectId: ObjectID,
  ): Promise<Array<NetworkAddressBlock>> {
    const trusted: SecurityOwnLoadBalancerBlocks =
      await this.getTrusted(projectId);

    return [...trusted.loadBalancers, ...trusted.googleFrontEnds];
  }
}
