import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesResource from "../../../Models/DatabaseModels/KubernetesResource";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import NetworkAddressName from "../../../Models/DatabaseModels/NetworkAddressName";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "../../../Models/DatabaseModels/NetworkEndpoint";
import Probe from "../../../Models/DatabaseModels/Probe";
import SecurityProtectedEntity from "../../../Models/DatabaseModels/SecurityProtectedEntity";
import { IpWhitelist } from "../../EnvironmentConfig";
import CloudResourceService from "../../Services/CloudResourceService";
import HostService from "../../Services/HostService";
import KubernetesResourceService from "../../Services/KubernetesResourceService";
import NetworkAddressNameService from "../../Services/NetworkAddressNameService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import SecurityProtectedEntityService from "../../Services/SecurityProtectedEntityService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import DnsResolutionCache, {
  DnsResolution,
} from "../Monitor/DnsResolutionCache";
import NetworkAddressNamesUtil from "../NetworkFlow/NetworkAddressNames";
import OneUptimeProbeAddresses, {
  OneUptimeProbe,
  OneUptimeProbeAddress,
  OneUptimeProbeRead,
} from "../Probe/OneUptimeProbeAddresses";
import CallerPermission from "../Permission/CallerPermission";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityEdgeRanges, { SecurityEdge } from "./SecurityEdgeRanges";
import {
  flattenCloudProperties,
  readCloudEndpoints,
} from "../../../Types/Cloud/CloudInventory";
import { getCloudResourceTypeLabel } from "../../../Types/Cloud/CloudResourceCatalog";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_LOCAL_ADDRESS_RANGES,
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
  findLocalRangeProtection,
  findProtectionAmong,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import { readSecurityAddress } from "../../../Types/SecurityBlocklist/SecurityAddressSpellings";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";

/*
 * WHETHER A BLOCK WOULD TOUCH ONE OF THE PROJECT'S OWN ADDRESSES (#10338),
 * and what OneUptime protects automatically.
 *
 * The rules are Types/SecurityBlocklist/SecurityProtectedAddress; this reads
 * what they are applied to, as OneUptime (root): an address is protected
 * whoever asks, so a check never comes out "not protected" because the
 * person blocking cannot read the host that holds it.
 *
 *   - the project's Protected Entities list (its address entries);
 *   - ranges that are not on the internet, and OneUptime Cloud's probe
 *     addresses (IP_WHITELIST);
 *   - the address each of the project's probes, and each of OneUptime's,
 *     checks in from (Probe.egressIpAddress), and the addresses on the
 *     project's probes' own network interfaces (Probe.interfaceIpAddresses):
 *     the one list of OneUptime's own probe addresses, which Security
 *     Events reads too (Probe/OneUptimeProbeAddresses);
 *   - the addresses and ranges its people named (Address Names);
 *   - its hosts' addresses (host.ip), its Kubernetes nodes' InternalIP and
 *     ExternalIP, its cloud resources' endpoints and properties - and its
 *     load balancers' DNS names, resolved when it is checked, as AWS lists a
 *     load balancer by its name alone - its network devices' addresses and
 *     its network endpoints';
 *   - the published ranges of the edge in front of the app, when the project
 *     has connected one (SecurityEdgeRanges).
 *
 * Each record source is read in one bounded query, narrowed by the text an
 * address of the block starts with ("35.205.11." for 35.205.11.0/24), and
 * held to the block exactly here (NetworkAddressBlockUtil): a range is
 * refused when it holds any protected address, an address when a protected
 * range holds it. A source that cannot be read, or holds more matches than
 * one read takes, leaves the answer open: the check says it could not tell,
 * and the block is refused rather than risk taking the project's own site
 * down.
 */

// The most rows one source is read for in one check.
export const PROTECTED_ADDRESS_ROWS_PER_SOURCE: number = 2000;

// The most of a source's addresses the Protected Entities page lists.
export const PROTECTED_ADDRESSES_LISTED_PER_SOURCE: number = 50;

// The most load balancers whose DNS names a check resolves.
export const LOAD_BALANCERS_RESOLVED_PER_CHECK: number = 200;

// How many DNS names are resolved at once.
const DNS_NAMES_RESOLVED_AT_ONCE: number = 10;

// How long a load balancer's name that could not be resolved waits to be asked again.
export const DNS_FAILURE_RETRY_IN_MS: number = 30 * 1000;

/*
 * The cloud resource types listed by a DNS name and no address: AWS's
 * Application, Network and Gateway Load Balancers and Classic Load
 * Balancers, whose addresses change behind their name.
 */
export const LOAD_BALANCER_TYPES: ReadonlyArray<string> = [
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::ElasticLoadBalancing::LoadBalancer",
];

export interface SecurityProtectionCheck {
  // What protects the block, if anything does.
  protection: SecurityAddressProtection | null;
  /*
   * The sources OneUptime could not read in full: while any is, a block
   * not found protected may still be, and is not made.
   */
  unreadSources: Array<SecurityProtectedAddressSource>;
}

/*
 * Everything the project protects, read whole (readAllProtections): what a
 * blocklist feed holds its entries to.
 */
export interface SecurityProtectionSnapshot {
  protections: Array<SecurityAddressProtection>;
  // The sources that could not be read: nothing is known of what they protect.
  unreadSources: Array<SecurityProtectedAddressSource>;
  // The sources that hold more rows than one read takes.
  incompleteSources: Array<SecurityProtectedAddressSource>;
}

// The addresses one source protects, as the Protected Entities page lists them.
export interface SecurityProtectedAddressGroup {
  source: SecurityProtectedAddressSource;
  protections: Array<SecurityAddressProtection>;
  // More than the page lists.
  hasMore: boolean;
  // False when the source could not be read: its addresses are protected, but not listed.
  isRead: boolean;
}

// What one source read: the protections it holds, and whether it read them all.
interface SourceReading {
  protections: Array<SecurityAddressProtection>;
  isComplete: boolean;
}

/*
 * What a source is asked for: the text an address it holds must contain -
 * null for every address it holds - how many rows to read at most, and as
 * whom: OneUptime, for a check (an address is protected whoever asks), or
 * the reader, for a list a page shows (nobody is shown a record they may
 * not read).
 */
interface SourceScan {
  contains: string | null;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

type SourceReader = (
  projectId: ObjectID,
  scan: SourceScan,
) => Promise<SourceReading>;

/*
 * The text every address of the block contains, as the records write
 * addresses: an IPv4 block's whole octets ("35.205.11." for a /24, the
 * address itself for a /32), an IPv6 block's first group ("2001:"). Null
 * when it narrows nothing. Matched without case, and then held to the block
 * exactly, so text that only looks alike ("135.205.11.7") is read and
 * dropped.
 */
export function getProtectedAddressPrefilter(
  block: NetworkAddressBlock,
): string | null {
  if (block.family === 4) {
    const octets: Array<string> = (block.text.split("/")[0] || "").split(".");
    const kept: number = Math.min(4, Math.floor(block.prefixLength / 8));

    if (kept === 0) {
      return null;
    }

    return kept === 4
      ? octets.join(".")
      : `${octets.slice(0, kept).join(".")}.`;
  }

  const first: number = block.groups[0] || 0;

  // An address in ::/16 is written from "::": any IPv6 text.
  if (block.prefixLength < 16 || first === 0) {
    return ":";
  }

  return `${first.toString(16)}:`;
}

// The addresses in a list a record reports: comma- or space-separated.
function listEntries(text: string | undefined | null): Array<string> {
  return (text || "")
    .split(",")
    .flatMap((part: string): Array<string> => {
      return part.split(" ");
    })
    .map((part: string): string => {
      return part.trim();
    })
    .filter(Boolean);
}

// The protections a record holds: one per address of it, each once.
function protectionsOf(data: {
  values: Array<unknown>;
  source: SecurityProtectedAddressSource;
  name: string;
  recordId?: string | undefined;
  kind?: string | undefined;
  where?: string | undefined;
}): Array<SecurityAddressProtection> {
  const protections: Array<SecurityAddressProtection> = [];
  const seen: Set<string> = new Set();

  for (const value of data.values) {
    if (typeof value !== "string") {
      continue;
    }

    /*
     * An address however the record wrote it - in brackets, with a port or
     * a zone too, which a parse of it alone refuses (#10744) - and a range
     * as it is: a protection missed lets a block take the project's own
     * site down.
     */
    const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
      readSecurityAddress(value) || value,
    );

    if (!block || seen.has(block.text)) {
      continue;
    }

    seen.add(block.text);
    protections.push({
      source: data.source,
      protectedValue: block.text,
      name: data.name,
      ...(data.recordId ? { recordId: data.recordId } : {}),
      ...(data.kind ? { kind: data.kind } : {}),
      ...(data.where ? { where: data.where } : {}),
    });
  }

  return protections;
}

/*
 * The protections OneUptime's own probes hold: one per address of each, the
 * address it checks in from first, named by the probe.
 */
function protectionsOfProbes(
  probes: Array<OneUptimeProbe>,
  source: SecurityProtectedAddressSource,
): Array<SecurityAddressProtection> {
  return probes.flatMap(
    (probe: OneUptimeProbe): Array<SecurityAddressProtection> => {
      return protectionsOf({
        values: probe.addresses.map(
          (address: OneUptimeProbeAddress): string => {
            return address.value;
          },
        ),
        source,
        name: probe.name,
        recordId: probe.probeId || undefined,
      });
    },
  );
}

// A text column narrowed to the scan's text, or to any value at all.
function textFilter(scan: SourceScan): unknown {
  return scan.contains === null
    ? QueryHelper.notNull()
    : QueryHelper.search(scan.contains);
}

// A query reads one row more than it keeps, to know whether it read them all.
function readLimit(scan: SourceScan): number {
  return scan.limit + 1;
}

function keepRead<T>(
  rows: Array<T>,
  scan: SourceScan,
): {
  rows: Array<T>;
  isComplete: boolean;
} {
  return {
    rows: rows.slice(0, scan.limit),
    isComplete: rows.length <= scan.limit,
  };
}

const ROOT: { isRoot: true } = { isRoot: true };

// The kind of record each record source names, as asSeenBy holds a reader to it.
const PROTECTION_RECORD_MODELS: Partial<
  Record<SecurityProtectedAddressSource, { new (): BaseModel }>
> = {
  [SecurityProtectedAddressSource.ProtectedEntity]: SecurityProtectedEntity,
  [SecurityProtectedAddressSource.Host]: Host,
  [SecurityProtectedAddressSource.KubernetesNode]: KubernetesResource,
  [SecurityProtectedAddressSource.CloudResource]: CloudResource,
  [SecurityProtectedAddressSource.NetworkDevice]: NetworkDevice,
  [SecurityProtectedAddressSource.NetworkEndpoint]: NetworkEndpoint,
  [SecurityProtectedAddressSource.AddressName]: NetworkAddressName,
  [SecurityProtectedAddressSource.Probe]: Probe,
  // A domain's (#10346): the monitor that checks it, the status page it serves.
  [SecurityProtectedAddressSource.Monitor]: Monitor,
  [SecurityProtectedAddressSource.StatusPage]: StatusPage,
};

export default class SecurityProtectedAddresses {
  /*
   * Load balancers' DNS names, resolved at most every five minutes; a
   * lookup that failed is tried again after half a minute, since until it
   * answers no block is made.
   */
  private static dnsCache: DnsResolutionCache = new DnsResolutionCache({
    failureTtlInMs: DNS_FAILURE_RETRY_IN_MS,
  });

  // For tests: how load balancers' names are resolved.
  public static setDnsCacheForTests(cache: DnsResolutionCache): void {
    this.dnsCache = cache;
  }

  /*
   * What protects a block of `block` in the project, if anything: the
   * first protection found, the project's own list first. Never throws: a
   * source that fails is named in unreadSources.
   */
  @CaptureSpan()
  public static async findProtection(data: {
    projectId: ObjectID;
    block: NetworkAddressBlock;
  }): Promise<SecurityProtectionCheck> {
    const unreadSources: Array<SecurityProtectedAddressSource> = [];

    const found: (
      protections: Array<SecurityAddressProtection>,
    ) => SecurityAddressProtection | null = (
      protections: Array<SecurityAddressProtection>,
    ): SecurityAddressProtection | null => {
      return findProtectionAmong({ block: data.block, protections });
    };

    // The ranges that are not on the internet: no read needed.
    const local: SecurityAddressProtection | null = findLocalRangeProtection(
      data.block,
    );

    if (local) {
      return { protection: local, unreadSources };
    }

    // OneUptime Cloud's probe addresses: the server's own setting.
    const cloud: SecurityAddressProtection | null = found(
      this.getOneUptimeCloudProtections(),
    );

    if (cloud) {
      return { protection: cloud, unreadSources };
    }

    // Read as OneUptime: an address is protected whoever asks.
    const scan: SourceScan = {
      contains: getProtectedAddressPrefilter(data.block),
      limit: PROTECTED_ADDRESS_ROWS_PER_SOURCE,
      props: ROOT,
    };

    /*
     * The sources, the project's own list first. A source that keeps ranges
     * (the list, Address Names, the edge's) is read whole, since a range
     * that holds the block shares no text with it; a source of addresses is
     * read by the block's text.
     */
    const readers: Array<{
      source: SecurityProtectedAddressSource;
      read: () => Promise<SourceReading>;
    }> = [
      {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        read: () => {
          return this.readProtectedEntities(data.projectId, ROOT);
        },
      },
      {
        source: SecurityProtectedAddressSource.Probe,
        read: () => {
          return this.readProbes(data.projectId, scan);
        },
      },
      {
        source: SecurityProtectedAddressSource.AddressName,
        read: () => {
          return this.readAddressNames(data.projectId, scan);
        },
      },
      ...this.getRecordReaders().map(
        (reader: {
          source: SecurityProtectedAddressSource;
          read: SourceReader;
        }): {
          source: SecurityProtectedAddressSource;
          read: () => Promise<SourceReading>;
        } => {
          return {
            source: reader.source,
            read: () => {
              return reader.read(data.projectId, scan);
            },
          };
        },
      ),
      {
        source: SecurityProtectedAddressSource.CloudResource,
        read: () => {
          return this.readLoadBalancers(data.projectId, ROOT);
        },
      },
      {
        source: SecurityProtectedAddressSource.Edge,
        read: () => {
          return this.readEdges(data.projectId);
        },
      },
    ];

    for (const reader of readers) {
      let reading: SourceReading;

      try {
        reading = await reader.read();
      } catch (error) {
        logger.warn(
          `SecurityProtectedAddresses: could not read the project's ${reader.source} addresses for ${data.block.text}; the block is not made. ${String(error)}`,
        );

        if (!unreadSources.includes(reader.source)) {
          unreadSources.push(reader.source);
        }

        continue;
      }

      const protection: SecurityAddressProtection | null = found(
        reading.protections,
      );

      if (protection) {
        return { protection, unreadSources: [] };
      }

      if (!reading.isComplete && !unreadSources.includes(reader.source)) {
        unreadSources.push(reader.source);
      }
    }

    return { protection: null, unreadSources };
  }

  /*
   * Every address and range OneUptime protects in the project, read whole
   * and as OneUptime, from the very sources findProtection reads: what a
   * blocklist feed holds each entry to before it serves it (#10345), since
   * an address can become a protected one after it was blocked - a new
   * host, an entry added to Protected Entities. Each source is read once,
   * up to `limitPerSource` rows: one that could not be read is named in
   * unreadSources, one that holds more rows than that in incompleteSources.
   * Never throws.
   */
  @CaptureSpan()
  public static async readAllProtections(data: {
    projectId: ObjectID;
    limitPerSource: number;
  }): Promise<SecurityProtectionSnapshot> {
    const scan: SourceScan = {
      contains: null,
      limit: data.limitPerSource,
      props: ROOT,
    };

    const snapshot: SecurityProtectionSnapshot = {
      protections: [
        ...this.getLocalRangeProtections(),
        ...this.getOneUptimeCloudProtections(),
      ],
      unreadSources: [],
      incompleteSources: [],
    };

    const readers: Array<{
      source: SecurityProtectedAddressSource;
      read: () => Promise<SourceReading>;
    }> = [
      {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        read: () => {
          return this.readProtectedEntities(data.projectId, ROOT);
        },
      },
      {
        source: SecurityProtectedAddressSource.Probe,
        read: () => {
          return this.readProbes(data.projectId, scan);
        },
      },
      {
        source: SecurityProtectedAddressSource.AddressName,
        read: () => {
          return this.readAddressNames(data.projectId, scan);
        },
      },
      ...this.getRecordReaders().map(
        (reader: {
          source: SecurityProtectedAddressSource;
          read: SourceReader;
        }): {
          source: SecurityProtectedAddressSource;
          read: () => Promise<SourceReading>;
        } => {
          return {
            source: reader.source,
            read: () => {
              return reader.read(data.projectId, scan);
            },
          };
        },
      ),
      {
        source: SecurityProtectedAddressSource.CloudResource,
        read: () => {
          return this.readLoadBalancers(data.projectId, ROOT);
        },
      },
      {
        source: SecurityProtectedAddressSource.Edge,
        read: () => {
          return this.readEdges(data.projectId);
        },
      },
    ];

    for (const reader of readers) {
      try {
        const reading: SourceReading = await reader.read();

        snapshot.protections.push(...reading.protections);

        if (
          !reading.isComplete &&
          !snapshot.incompleteSources.includes(reader.source)
        ) {
          snapshot.incompleteSources.push(reader.source);
        }
      } catch (error) {
        logger.warn(
          `SecurityProtectedAddresses: could not read the project's ${reader.source} addresses for its blocklist feeds. ${String(error)}`,
        );

        if (!snapshot.unreadSources.includes(reader.source)) {
          snapshot.unreadSources.push(reader.source);
        }
      }
    }

    return snapshot;
  }

  /*
   * What OneUptime protects of the project automatically, source by source,
   * at most PROTECTED_ADDRESSES_LISTED_PER_SOURCE of each: what the
   * Protected Entities page lists, read-only, with where each came from.
   * Read as the reader reads: a kind of record they may not read is listed
   * as not read (its addresses are protected all the same). Never throws.
   */
  @CaptureSpan()
  public static async listAutomaticProtections(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<SecurityProtectedAddressGroup>> {
    const scan: SourceScan = {
      contains: null,
      limit: PROTECTED_ADDRESSES_LISTED_PER_SOURCE,
      props: data.props,
    };

    const groups: Array<SecurityProtectedAddressGroup> = [];

    const add: (
      source: SecurityProtectedAddressSource,
      read: () => Promise<SourceReading>,
    ) => Promise<void> = async (
      source: SecurityProtectedAddressSource,
      read: () => Promise<SourceReading>,
    ): Promise<void> => {
      try {
        const reading: SourceReading = await read();

        groups.push({
          source,
          protections: reading.protections.slice(
            0,
            PROTECTED_ADDRESSES_LISTED_PER_SOURCE,
          ),
          hasMore:
            !reading.isComplete ||
            reading.protections.length > PROTECTED_ADDRESSES_LISTED_PER_SOURCE,
          isRead: true,
        });
      } catch (error) {
        logger.warn(
          `SecurityProtectedAddresses: could not list the project's ${source} addresses. ${String(error)}`,
        );
        groups.push({ source, protections: [], hasMore: false, isRead: false });
      }
    };

    await add(SecurityProtectedAddressSource.LocalRange, async () => {
      return { protections: this.getLocalRangeProtections(), isComplete: true };
    });

    await add(SecurityProtectedAddressSource.OneUptimeCloud, async () => {
      return {
        protections: this.getOneUptimeCloudProtections(),
        isComplete: true,
      };
    });

    // The project's probes and OneUptime's: two sources, each listed and counted apart.
    await add(SecurityProtectedAddressSource.Probe, () => {
      return this.readProjectProbes(data.projectId, scan);
    });

    await add(SecurityProtectedAddressSource.GlobalProbe, () => {
      return this.readGlobalProbes(scan);
    });

    await add(SecurityProtectedAddressSource.AddressName, () => {
      return this.readAddressNames(data.projectId, scan);
    });

    for (const reader of this.getRecordReaders()) {
      await add(reader.source, () => {
        return reader.read(data.projectId, scan);
      });
    }

    await add(SecurityProtectedAddressSource.Edge, () => {
      return this.readEdges(data.projectId);
    });

    return groups;
  }

  // ---------- The sources ----------

  // The ranges that are not on the internet.
  public static getLocalRangeProtections(): Array<SecurityAddressProtection> {
    return protectionsOf({
      values: [...SECURITY_LOCAL_ADDRESS_RANGES],
      source: SecurityProtectedAddressSource.LocalRange,
      name: "",
    }).map(
      (protection: SecurityAddressProtection): SecurityAddressProtection => {
        return {
          source: protection.source,
          protectedValue: protection.protectedValue,
        };
      },
    );
  }

  /*
   * OneUptime Cloud's probe addresses: the IP_WHITELIST setting, each an
   * address or a range, as the one list of OneUptime's own probe addresses
   * holds it (Probe/OneUptimeProbeAddresses).
   */
  public static getOneUptimeCloudProtections(
    setting: string = IpWhitelist,
  ): Array<SecurityAddressProtection> {
    const cloud: OneUptimeProbe | null =
      OneUptimeProbeAddresses.getOneUptimeCloud(setting);

    return cloud
      ? protectionsOf({
          values: cloud.addresses.map(
            (address: OneUptimeProbeAddress): string => {
              return address.value;
            },
          ),
          source: SecurityProtectedAddressSource.OneUptimeCloud,
          name: cloud.name,
        })
      : [];
  }

  // The address entries of the project's Protected Entities list, by their descriptions.
  public static async readProtectedEntities(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<SourceReading> {
    const rows: Array<SecurityProtectedEntity> =
      await SecurityProtectedEntityService.findBy({
        query: {
          projectId,
          entityType: SecurityEntityType.IpAddress,
        },
        select: { _id: true, value: true, description: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props,
      });

    return {
      protections: rows.flatMap(
        (row: SecurityProtectedEntity): Array<SecurityAddressProtection> => {
          return protectionsOf({
            values: [row.value],
            source: SecurityProtectedAddressSource.ProtectedEntity,
            name: (row.description || "").trim() || row.value || "",
            recordId: row.id?.toString(),
          });
        },
      ),
      isComplete: rows.length < LIMIT_PER_PROJECT,
    };
  }

  /*
   * The addresses the project's probes check in from, and OneUptime's own
   * probes': a check of the project's site from one of them must never be
   * turned away. Each is a source of its own on the page.
   */
  public static async readProbes(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const [own, global]: [SourceReading, SourceReading] = await Promise.all([
      this.readProjectProbes(projectId, scan),
      this.readGlobalProbes(scan),
    ]);

    return {
      protections: [...own.protections, ...global.protections],
      isComplete: own.isComplete && global.isComplete,
    };
  }

  /*
   * The project's own probes, by the address each checks in from and the
   * addresses on its own network interfaces (#10429): the one list of
   * OneUptime's own probe addresses (Probe/OneUptimeProbeAddresses), which
   * Security Events reads too.
   */
  public static async readProjectProbes(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readProjectProbes({
        projectId,
        contains: scan.contains,
        limit: scan.limit,
        props: scan.props,
      });

    return {
      protections: protectionsOfProbes(
        read.probes,
        SecurityProtectedAddressSource.Probe,
      ),
      isComplete: read.isComplete,
    };
  }

  /*
   * OneUptime's own probes, which belong to no project: read as OneUptime,
   * as the IP addresses page lists them, whoever asks.
   */
  public static async readGlobalProbes(
    scan: SourceScan,
  ): Promise<SourceReading> {
    const read: OneUptimeProbeRead =
      await OneUptimeProbeAddresses.readGlobalProbes({
        contains: scan.contains,
        limit: scan.limit,
      });

    return {
      protections: protectionsOfProbes(
        read.probes,
        SecurityProtectedAddressSource.GlobalProbe,
      ),
      isComplete: read.isComplete,
    };
  }

  /*
   * The addresses and ranges people named (Network > Address Names): the
   * addresses the scan's text finds, and every range, since a range that
   * holds the block shares no text with it.
   */
  public static async readAddressNames(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const select: { _id: true; name: true; address: true } = {
      _id: true,
      name: true,
      address: true,
    };

    const [addresses, ranges]: [
      Array<NetworkAddressName>,
      Array<NetworkAddressName>,
    ] = await Promise.all([
      NetworkAddressNameService.findBy({
        query: { projectId, address: textFilter(scan) as never },
        select,
        skip: 0,
        limit: readLimit(scan),
        props: scan.props,
      }),
      scan.contains === null
        ? Promise.resolve([])
        : NetworkAddressNameService.findBy({
            query: { projectId, address: QueryHelper.search("/") },
            select,
            skip: 0,
            limit: LIMIT_PER_PROJECT + 1,
            props: scan.props,
          }),
    ]);

    const addressRead: {
      rows: Array<NetworkAddressName>;
      isComplete: boolean;
    } = keepRead(addresses, scan);

    return {
      protections: [
        ...addressRead.rows,
        ...ranges.slice(0, LIMIT_PER_PROJECT),
      ].flatMap((row: NetworkAddressName): Array<SecurityAddressProtection> => {
        return protectionsOf({
          values: [row.address],
          source: SecurityProtectedAddressSource.AddressName,
          name: (row.name || "").trim() || row.address || "",
          recordId: row.id?.toString(),
        });
      }),
      isComplete: addressRead.isComplete && ranges.length <= LIMIT_PER_PROJECT,
    };
  }

  // The project's records that hold addresses, each read by the scan's text.
  public static getRecordReaders(): Array<{
    source: SecurityProtectedAddressSource;
    read: SourceReader;
  }> {
    return [
      {
        source: SecurityProtectedAddressSource.Host,
        read: (projectId: ObjectID, scan: SourceScan) => {
          return this.readHosts(projectId, scan);
        },
      },
      {
        source: SecurityProtectedAddressSource.KubernetesNode,
        read: (projectId: ObjectID, scan: SourceScan) => {
          return this.readKubernetesNodes(projectId, scan);
        },
      },
      {
        source: SecurityProtectedAddressSource.CloudResource,
        read: (projectId: ObjectID, scan: SourceScan) => {
          return this.readCloudResources(projectId, scan);
        },
      },
      {
        source: SecurityProtectedAddressSource.NetworkDevice,
        read: (projectId: ObjectID, scan: SourceScan) => {
          return this.readNetworkDevices(projectId, scan);
        },
      },
      {
        source: SecurityProtectedAddressSource.NetworkEndpoint,
        read: (projectId: ObjectID, scan: SourceScan) => {
          return this.readNetworkEndpoints(projectId, scan);
        },
      },
    ];
  }

  // Hosts whose agent reports an address (host.ip). Archived hosts protect nothing.
  public static async readHosts(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const rows: Array<Host> = await HostService.findBy({
      query: {
        projectId,
        isArchived: false,
        hostIpAddresses: textFilter(scan) as never,
      },
      select: {
        _id: true,
        name: true,
        hostIdentifier: true,
        hostIpAddresses: true,
      },
      skip: 0,
      limit: readLimit(scan),
      props: scan.props,
    });

    const read: { rows: Array<Host>; isComplete: boolean } = keepRead(
      rows,
      scan,
    );

    return {
      protections: read.rows.flatMap(
        (host: Host): Array<SecurityAddressProtection> => {
          return protectionsOf({
            values: listEntries(host.hostIpAddresses),
            source: SecurityProtectedAddressSource.Host,
            name: host.name || host.hostIdentifier || "",
            recordId: host.id?.toString(),
          });
        },
      ),
      isComplete: read.isComplete,
    };
  }

  // Kubernetes nodes, by their InternalIP and ExternalIP addresses.
  public static async readKubernetesNodes(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const rows: Array<KubernetesResource> =
      await KubernetesResourceService.findBy({
        query: {
          projectId,
          kind: "Node",
          status: textFilter(scan) as never,
        },
        select: { _id: true, name: true, kind: true, status: true },
        skip: 0,
        limit: readLimit(scan),
        props: scan.props,
      });

    const read: { rows: Array<KubernetesResource>; isComplete: boolean } =
      keepRead(rows, scan);

    return {
      protections: read.rows.flatMap(
        (node: KubernetesResource): Array<SecurityAddressProtection> => {
          return protectionsOf({
            values: NetworkAddressNamesUtil.kubernetesAddresses(node),
            source: SecurityProtectedAddressSource.KubernetesNode,
            name: node.name || "",
            recordId: node.id?.toString(),
          });
        },
      ),
      isComplete: read.isComplete,
    };
  }

  /*
   * Cloud resources whose cloud lists an address among their endpoints
   * (an EC2 instance's public and private addresses) or their properties
   * (a Google Cloud instance's natIP, an Azure address's ipAddress). Read
   * twice, once by each, as a query holds one column to the text.
   */
  public static async readCloudResources(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const select: {
      _id: true;
      name: true;
      cloudProvider: true;
      cloudResourceType: true;
      cloudEndpoints: true;
      cloudProperties: true;
      cloudConnection: { name: true };
    } = {
      _id: true,
      name: true,
      cloudProvider: true,
      cloudResourceType: true,
      cloudEndpoints: true,
      cloudProperties: true,
      cloudConnection: { name: true },
    };

    const [byEndpoint, byProperty]: [
      Array<CloudResource>,
      Array<CloudResource>,
    ] = await Promise.all([
      CloudResourceService.findBy({
        query: {
          projectId,
          isArchived: false,
          cloudEndpoints: textFilter(scan) as never,
        },
        select,
        skip: 0,
        limit: readLimit(scan),
        props: scan.props,
      }),
      scan.contains === null
        ? Promise.resolve([])
        : CloudResourceService.findBy({
            query: {
              projectId,
              isArchived: false,
              cloudProperties: QueryHelper.search(scan.contains) as never,
            },
            select,
            skip: 0,
            limit: readLimit(scan),
            props: scan.props,
          }),
    ]);

    const endpointRead: { rows: Array<CloudResource>; isComplete: boolean } =
      keepRead(byEndpoint, scan);
    const propertyRead: { rows: Array<CloudResource>; isComplete: boolean } =
      keepRead(byProperty, scan);

    const seen: Set<string> = new Set();
    const protections: Array<SecurityAddressProtection> = [];

    for (const resource of [...endpointRead.rows, ...propertyRead.rows]) {
      const id: string = resource.id?.toString() || "";

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      protections.push(
        ...protectionsOf({
          values: [
            ...readCloudEndpoints(resource.cloudEndpoints),
            ...Object.values(flattenCloudProperties(resource.cloudProperties)),
          ],
          source: SecurityProtectedAddressSource.CloudResource,
          name: resource.name || "",
          recordId: id,
          kind:
            getCloudResourceTypeLabel(
              resource.cloudProvider,
              resource.cloudResourceType,
            ) || undefined,
          where: resource.cloudConnection?.name || undefined,
        }),
      );
    }

    return {
      protections,
      isComplete: endpointRead.isComplete && propertyRead.isComplete,
    };
  }

  /*
   * Load balancers, which AWS lists by a DNS name: the addresses each name
   * resolves to now, again within five minutes. A name that exists nowhere
   * protects nothing; one whose lookup failed - timed out, or the resolver
   * could not answer - leaves the reading incomplete, so no block is made
   * until it answers: its addresses may be any.
   */
  public static async readLoadBalancers(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<SourceReading> {
    const rows: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId,
        isArchived: false,
        cloudResourceType: QueryHelper.any([...LOAD_BALANCER_TYPES]),
      },
      select: {
        _id: true,
        name: true,
        cloudProvider: true,
        cloudResourceType: true,
        cloudEndpoints: true,
        cloudConnection: { name: true },
      },
      skip: 0,
      limit: LOAD_BALANCERS_RESOLVED_PER_CHECK + 1,
      props,
    });

    const balancers: Array<CloudResource> = rows.slice(
      0,
      LOAD_BALANCERS_RESOLVED_PER_CHECK,
    );

    const protections: Array<SecurityAddressProtection> = [];
    let isEveryNameResolved: boolean = true;

    for (
      let index: number = 0;
      index < balancers.length;
      index += DNS_NAMES_RESOLVED_AT_ONCE
    ) {
      const batch: Array<CloudResource> = balancers.slice(
        index,
        index + DNS_NAMES_RESOLVED_AT_ONCE,
      );

      const resolved: Array<SourceReading> = await Promise.all(
        batch.map((balancer: CloudResource): Promise<SourceReading> => {
          return this.resolveLoadBalancer(balancer);
        }),
      );

      for (const reading of resolved) {
        protections.push(...reading.protections);
        isEveryNameResolved = isEveryNameResolved && reading.isComplete;
      }
    }

    return {
      protections,
      isComplete:
        isEveryNameResolved && rows.length <= LOAD_BALANCERS_RESOLVED_PER_CHECK,
    };
  }

  /*
   * One load balancer's addresses, from the DNS names it is listed by (an
   * endpoint that is an address is read as one elsewhere): complete only
   * when every name was looked up.
   */
  private static async resolveLoadBalancer(
    balancer: CloudResource,
  ): Promise<SourceReading> {
    const names: Array<string> = readCloudEndpoints(
      balancer.cloudEndpoints,
    ).filter((endpoint: string): boolean => {
      return !NetworkAddressBlockUtil.readAddress(endpoint);
    });

    const addresses: Array<string> = [];
    let isComplete: boolean = true;

    for (const name of names) {
      const resolution: DnsResolution = await this.dnsCache.lookup(name);

      isComplete = isComplete && resolution.isResolved;
      addresses.push(...resolution.addresses);
    }

    return {
      protections: protectionsOf({
        values: addresses,
        source: SecurityProtectedAddressSource.CloudResource,
        name: balancer.name || "",
        recordId: balancer.id?.toString(),
        kind:
          getCloudResourceTypeLabel(
            balancer.cloudProvider,
            balancer.cloudResourceType,
          ) || undefined,
        where: balancer.cloudConnection?.name || undefined,
      }),
      isComplete,
    };
  }

  /*
   * Network devices, by the address they are polled at and their Other
   * Addresses. Archived devices protect nothing.
   */
  public static async readNetworkDevices(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const select: {
      _id: true;
      name: true;
      hostname: true;
      otherAddresses: true;
    } = { _id: true, name: true, hostname: true, otherAddresses: true };

    const [polled, other]: [Array<NetworkDevice>, Array<NetworkDevice>] =
      await Promise.all([
        NetworkDeviceService.findBy({
          query: {
            projectId,
            isArchived: false,
            hostname: textFilter(scan) as never,
          },
          select,
          skip: 0,
          limit: readLimit(scan),
          props: scan.props,
        }),
        scan.contains === null
          ? Promise.resolve([])
          : NetworkDeviceService.findBy({
              query: {
                projectId,
                isArchived: false,
                otherAddresses: QueryHelper.search(scan.contains) as never,
              },
              select,
              skip: 0,
              limit: readLimit(scan),
              props: scan.props,
            }),
      ]);

    const polledRead: { rows: Array<NetworkDevice>; isComplete: boolean } =
      keepRead(polled, scan);
    const otherRead: { rows: Array<NetworkDevice>; isComplete: boolean } =
      keepRead(other, scan);

    const seen: Set<string> = new Set();
    const protections: Array<SecurityAddressProtection> = [];

    for (const device of [...polledRead.rows, ...otherRead.rows]) {
      const id: string = device.id?.toString() || "";

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      protections.push(
        ...protectionsOf({
          values: [device.hostname, ...listEntries(device.otherAddresses)],
          source: SecurityProtectedAddressSource.NetworkDevice,
          name: device.name || device.hostname || "",
          recordId: id,
        }),
      );
    }

    return {
      protections,
      isComplete: polledRead.isComplete && otherRead.isComplete,
    };
  }

  // Network endpoints - the LAN's printers, terminals and cameras - by their address.
  public static async readNetworkEndpoints(
    projectId: ObjectID,
    scan: SourceScan,
  ): Promise<SourceReading> {
    const rows: Array<NetworkEndpoint> = await NetworkEndpointService.findBy({
      query: {
        projectId,
        ipAddress: textFilter(scan) as never,
      },
      select: { _id: true, ipAddress: true, hostname: true },
      skip: 0,
      limit: readLimit(scan),
      props: scan.props,
    });

    const read: { rows: Array<NetworkEndpoint>; isComplete: boolean } =
      keepRead(rows, scan);

    return {
      protections: read.rows.flatMap(
        (endpoint: NetworkEndpoint): Array<SecurityAddressProtection> => {
          return protectionsOf({
            values: [endpoint.ipAddress],
            source: SecurityProtectedAddressSource.NetworkEndpoint,
            name: endpoint.hostname || endpoint.ipAddress || "",
            recordId: endpoint.id?.toString(),
          });
        },
      ),
      isComplete: read.isComplete,
    };
  }

  /*
   * A protection as a reader may be told of it: the record a record source
   * names - which host, which load balancer - left out for a reader who may
   * not read that kind of record, who is told only that the address is the
   * project's own. OneUptime and a server admin are told all.
   */
  public static asSeenBy(data: {
    protection: SecurityAddressProtection;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): SecurityAddressProtection {
    const { protection, props } = data;

    if (props.isRoot || props.isMasterAdmin) {
      return protection;
    }

    const modelType: { new (): BaseModel } | undefined =
      PROTECTION_RECORD_MODELS[protection.source];

    if (
      !modelType ||
      CallerPermission.holdsModelPermission(
        props,
        { model: new modelType(), operation: "read" },
        { projectId: data.projectId },
      )
    ) {
      return protection;
    }

    return {
      source: protection.source,
      protectedValue: protection.protectedValue,
    };
  }

  // The published ranges of the edges the project has connected.
  public static async readEdges(projectId: ObjectID): Promise<SourceReading> {
    const edges: Array<SecurityEdge> =
      await SecurityEdgeRanges.findConnectedEdges(projectId);

    const protections: Array<SecurityAddressProtection> = [];

    for (const edge of edges) {
      protections.push(
        ...protectionsOf({
          values: await SecurityEdgeRanges.getRanges(edge),
          source: SecurityProtectedAddressSource.Edge,
          name: edge.name,
        }),
      );
    }

    return { protections, isComplete: true };
  }
}
