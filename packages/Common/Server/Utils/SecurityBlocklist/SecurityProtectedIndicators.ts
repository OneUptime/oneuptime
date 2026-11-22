import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Domain from "../../../Models/DatabaseModels/Domain";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import SecurityProtectedEntity from "../../../Models/DatabaseModels/SecurityProtectedEntity";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import { Host, StatusPageCNameRecord } from "../../EnvironmentConfig";
import CloudResourceService from "../../Services/CloudResourceService";
import DomainService from "../../Services/DomainService";
import MonitorService from "../../Services/MonitorService";
import SecurityProtectedEntityService from "../../Services/SecurityProtectedEntityService";
import StatusPageDomainService from "../../Services/StatusPageDomainService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityProtectedAddresses, {
  SecurityProtectionCheck,
} from "./SecurityProtectedAddresses";
import { readCloudEndpoints } from "../../../Types/Cloud/CloudInventory";
import { getCloudResourceTypeLabel } from "../../../Types/Cloud/CloudResourceCatalog";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityBlockIndicatorValue,
  isSecurityBlockFileType,
  readSecurityBlockValue,
  SecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  isEmptyFileHash,
  readSecurityBlockDomain,
} from "../../../Types/SecurityBlocklist/SecurityBlockIndicator";
import {
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
} from "../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import {
  PROTECTED_SUBDOMAINS_PREFIX,
  matchesProtectedDomain,
  matchesProtectedFileHash,
  normalizeProtectedDomainValue,
} from "../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import { getMonitorTargetHosts } from "../../../Utils/SecurityCase/SecurityConnectionMatch";

/*
 * WHETHER A BLOCK WOULD TOUCH ONE OF THE PROJECT'S OWN DOMAINS, OR A FILE
 * IT SHIPS (#10346) - the domains, URLs and files beside the addresses of
 * SecurityProtectedAddresses, read the same way: as OneUptime (a value is
 * protected whoever asks), each source in one bounded query, and a source
 * that cannot be read, or holds more than one read takes, leaving the
 * answer open - the block is refused, not risked.
 *
 * A domain is protected - and so is every name above it, since a block of
 * a domain blocks the names under it (Microsoft Defender's indicators do),
 * and every URL on it - when it is:
 *
 *   - on the project's Protected Entities list (a name, or *. and a name
 *     for every name under it);
 *   - OneUptime's own host, where the Dashboard, its API and every agent
 *     report to, or the host the project's status pages point their DNS at;
 *   - an endpoint product's own service (Microsoft Defender's, CrowdStrike
 *     Falcon's): blocking it cuts every machine off from the product that
 *     does the blocking;
 *   - the host one of the project's monitors checks;
 *   - the domain of one of its status pages;
 *   - a domain it verified it owns, with every name under it;
 *   - a DNS name its cloud inventory lists for a resource, or a DNS zone it
 *     holds there, with every name under it.
 *
 * A URL whose host is an address is an address's block, held to
 * SecurityProtectedAddresses.
 *
 * A file is protected when its hash is on the Protected Entities list -
 * OneUptime knows no file a project ships by itself, so the project lists
 * the hashes of its own builds and installers - or when it is the hash of
 * an empty file, which every machine holds many of.
 */

// The most rows one source is read for in one check.
export const PROTECTED_INDICATOR_ROWS_PER_SOURCE: number = 2000;

/*
 * The endpoint products' own services, which blocking cuts every machine
 * off from: their sensors' and consoles' hosts, their sign-in, and the
 * update and storage hosts they reach. Each protects the names above it as
 * well, so microsoft.com, windows.net and crowdstrike.com are never blocked
 * whole, while a name under one - a page on someone's storage account - can
 * be.
 */
export const ENDPOINT_PRODUCT_DOMAINS: ReadonlyArray<{
  name: string;
  domains: ReadonlyArray<string>;
}> = [
  {
    name: "Microsoft Defender",
    domains: [
      "security.microsoft.com",
      "securitycenter.microsoft.com",
      "securitycenter.windows.com",
      "smartscreen.microsoft.com",
      "events.data.microsoft.com",
      "login.microsoftonline.com",
      "blob.core.windows.net",
      "update.microsoft.com",
      "windowsupdate.com",
    ],
  },
  {
    name: "CrowdStrike Falcon",
    domains: [
      "falcon.crowdstrike.com",
      "api.crowdstrike.com",
      "ts01-b.cloudsink.net",
      "lfodown01-b.cloudsink.net",
    ],
  },
];

/*
 * The cloud resource types that are a DNS zone: the zone's own name, and
 * every name under it, is the project's.
 */
export const DNS_ZONE_RESOURCE_TYPES: ReadonlyArray<string> = [
  "Microsoft.Network/dnszones",
  "Microsoft.Network/dnsZones",
  "Microsoft.Network/privateDnsZones",
  "AWS::Route53::HostedZone",
  "dns.googleapis.com/ManagedZone",
];

const ROOT: { isRoot: true } = { isRoot: true };

// A domain a source protects, and whether it protects every name under it too.
interface ProtectedDomain {
  protection: SecurityAddressProtection;
  coversNamesUnder: boolean;
}

interface DomainReading {
  domains: Array<ProtectedDomain>;
  isComplete: boolean;
}

// A host name as blocks write it, from what a record says: a URL's host, a bare name, a name and a port.
function toDomain(text: unknown): string | null {
  if (typeof text !== "string") {
    return null;
  }

  let host: string = text.trim();

  if (!host || host.includes("{{")) {
    return null;
  }

  const schemeEnd: number = host.indexOf("://");

  if (schemeEnd !== -1) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }

  // A name and a port: "oneuptime.example.com:3000".
  host = host.replace(/:\d+$/, "");

  const domain: { domain: string } | null = readSecurityBlockDomain(host);

  return domain ? domain.domain : null;
}

// The domains a source protects, each once.
function domainsOf(data: {
  values: Array<unknown>;
  source: SecurityProtectedAddressSource;
  name: string;
  coversNamesUnder: boolean;
  recordId?: string | undefined;
  kind?: string | undefined;
  where?: string | undefined;
}): Array<ProtectedDomain> {
  const domains: Array<ProtectedDomain> = [];
  const seen: Set<string> = new Set();

  for (const value of data.values) {
    const domain: string | null = toDomain(value);

    if (!domain || seen.has(domain)) {
      continue;
    }

    seen.add(domain);
    domains.push({
      protection: {
        source: data.source,
        protectedValue: domain,
        name: data.name,
        ...(data.recordId ? { recordId: data.recordId } : {}),
        ...(data.kind ? { kind: data.kind } : {}),
        ...(data.where ? { where: data.where } : {}),
      },
      coversNamesUnder: data.coversNamesUnder,
    });
  }

  return domains;
}

// The domain a value would block, for the narrowing a source's query takes.
function domainText(indicator: SecurityBlockIndicatorValue): string {
  return (indicator.domain || "").toLowerCase();
}

// Whether a protected domain is one a block of this value touches.
function touches(
  indicator: SecurityBlockIndicatorValue,
  domain: ProtectedDomain,
): boolean {
  const entry: string = domain.coversNamesUnder
    ? `${PROTECTED_SUBDOMAINS_PREFIX}${domain.protection.protectedValue}`
    : domain.protection.protectedValue;

  return matchesProtectedDomain(entry, indicator.value);
}

export default class SecurityProtectedIndicators {
  /*
   * What protects a block of a domain, a URL or a file, if anything: the
   * first protection found, the project's own list first. Never throws: a
   * source that fails is named in unreadSources.
   */
  @CaptureSpan()
  public static async findProtection(data: {
    projectId: ObjectID;
    indicator: SecurityBlockIndicatorValue;
  }): Promise<SecurityProtectionCheck> {
    const { indicator } = data;

    // A URL on an address is that address's block.
    if (indicator.address) {
      const address: SecurityBlockValue | null = readSecurityBlockValue(
        indicator.address,
      );

      return address
        ? await SecurityProtectedAddresses.findProtection({
            projectId: data.projectId,
            block: address.block,
          })
        : { protection: null, unreadSources: [] };
    }

    if (isSecurityBlockFileType(indicator.indicatorType)) {
      return await this.findFileProtection(data);
    }

    if (!indicator.domain) {
      return { protection: null, unreadSources: [] };
    }

    const readers: Array<{
      source: SecurityProtectedAddressSource;
      read: () => Promise<DomainReading>;
    }> = [
      {
        source: SecurityProtectedAddressSource.ProtectedEntity,
        read: () => {
          return this.readProtectedDomains(data.projectId);
        },
      },
      {
        source: SecurityProtectedAddressSource.OneUptime,
        read: async () => {
          return { domains: this.getOneUptimeDomains(), isComplete: true };
        },
      },
      {
        source: SecurityProtectedAddressSource.EndpointProduct,
        read: async () => {
          return {
            domains: this.getEndpointProductDomains(),
            isComplete: true,
          };
        },
      },
      {
        source: SecurityProtectedAddressSource.Monitor,
        read: () => {
          return this.readMonitors(data.projectId, domainText(indicator));
        },
      },
      {
        source: SecurityProtectedAddressSource.StatusPage,
        read: () => {
          return this.readStatusPages(data.projectId, domainText(indicator));
        },
      },
      {
        source: SecurityProtectedAddressSource.ProjectDomain,
        read: () => {
          return this.readProjectDomains(data.projectId);
        },
      },
      {
        source: SecurityProtectedAddressSource.CloudResource,
        read: () => {
          return this.readCloudResources(data.projectId, domainText(indicator));
        },
      },
    ];

    const unreadSources: Array<SecurityProtectedAddressSource> = [];

    for (const reader of readers) {
      let reading: DomainReading;

      try {
        reading = await reader.read();
      } catch (error) {
        logger.warn(
          `SecurityProtectedIndicators: could not read the project's ${reader.source} domains for ${indicator.value}; the block is not made. ${String(error)}`,
        );

        if (!unreadSources.includes(reader.source)) {
          unreadSources.push(reader.source);
        }

        continue;
      }

      const found: ProtectedDomain | undefined = reading.domains.find(
        (domain: ProtectedDomain): boolean => {
          return touches(indicator, domain);
        },
      );

      if (found) {
        return { protection: found.protection, unreadSources: [] };
      }

      if (!reading.isComplete && !unreadSources.includes(reader.source)) {
        unreadSources.push(reader.source);
      }
    }

    return { protection: null, unreadSources };
  }

  // A file's: the hash of an empty file, or a hash on the project's list.
  private static async findFileProtection(data: {
    projectId: ObjectID;
    indicator: SecurityBlockIndicatorValue;
  }): Promise<SecurityProtectionCheck> {
    if (isEmptyFileHash(data.indicator.value)) {
      return {
        protection: {
          source: SecurityProtectedAddressSource.EmptyFile,
          protectedValue: data.indicator.value,
        },
        unreadSources: [],
      };
    }

    let rows: Array<SecurityProtectedEntity>;

    try {
      rows = await SecurityProtectedEntityService.findBy({
        query: {
          projectId: data.projectId,
          entityType: SecurityEntityType.FileHash,
        },
        select: { _id: true, value: true, description: true },
        skip: 0,
        limit: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1,
        props: ROOT,
      });
    } catch (error) {
      logger.warn(
        `SecurityProtectedIndicators: could not read the project's protected files for ${data.indicator.value}; the block is not made. ${String(error)}`,
      );

      return {
        protection: null,
        unreadSources: [SecurityProtectedAddressSource.ProtectedEntity],
      };
    }

    const entry: SecurityProtectedEntity | undefined = rows.find(
      (row: SecurityProtectedEntity): boolean => {
        return matchesProtectedFileHash(row.value || "", data.indicator.value);
      },
    );

    if (entry) {
      return {
        protection: {
          source: SecurityProtectedAddressSource.ProtectedEntity,
          protectedValue: (entry.value || "").trim().toLowerCase(),
          ...(entry.description ? { name: entry.description } : {}),
          ...(entry.id ? { recordId: entry.id.toString() } : {}),
        },
        unreadSources: [],
      };
    }

    return {
      protection: null,
      unreadSources:
        rows.length > PROTECTED_INDICATOR_ROWS_PER_SOURCE
          ? [SecurityProtectedAddressSource.ProtectedEntity]
          : [],
    };
  }

  // ---------- The sources ----------

  // The domain entries of the project's Protected Entities list, by their descriptions.
  public static async readProtectedDomains(
    projectId: ObjectID,
  ): Promise<DomainReading> {
    const rows: Array<SecurityProtectedEntity> =
      await SecurityProtectedEntityService.findBy({
        query: { projectId, entityType: SecurityEntityType.Domain },
        select: { _id: true, value: true, description: true },
        skip: 0,
        limit: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1,
        props: ROOT,
      });

    const domains: Array<ProtectedDomain> = [];

    for (const row of rows.slice(0, PROTECTED_INDICATOR_ROWS_PER_SOURCE)) {
      const entry: string | null = normalizeProtectedDomainValue(row.value);

      if (!entry) {
        continue;
      }

      // Kept as written - "*.example.com" is matched as one - so it is never widened here.
      domains.push({
        protection: {
          source: SecurityProtectedAddressSource.ProtectedEntity,
          protectedValue: entry,
          ...(row.description ? { name: row.description } : {}),
          ...(row.id ? { recordId: row.id.toString() } : {}),
        },
        coversNamesUnder: false,
      });
    }

    return {
      domains,
      isComplete: rows.length <= PROTECTED_INDICATOR_ROWS_PER_SOURCE,
    };
  }

  /*
   * OneUptime's own host - the HOST setting, where the Dashboard, its API
   * and every agent report to - and the host status pages point their DNS
   * at (STATUS_PAGE_CNAME_RECORD).
   */
  public static getOneUptimeDomains(
    settings: { host: string; statusPageCName: string } = {
      host: Host,
      statusPageCName: StatusPageCNameRecord,
    },
  ): Array<ProtectedDomain> {
    return domainsOf({
      values: [settings.host, settings.statusPageCName],
      source: SecurityProtectedAddressSource.OneUptime,
      name: "OneUptime",
      coversNamesUnder: false,
    });
  }

  // The endpoint products' own services (ENDPOINT_PRODUCT_DOMAINS).
  public static getEndpointProductDomains(): Array<ProtectedDomain> {
    return ENDPOINT_PRODUCT_DOMAINS.flatMap(
      (product: {
        name: string;
        domains: ReadonlyArray<string>;
      }): Array<ProtectedDomain> => {
        return domainsOf({
          values: [...product.domains],
          source: SecurityProtectedAddressSource.EndpointProduct,
          name: product.name,
          coversNamesUnder: false,
        });
      },
    );
  }

  /*
   * The hosts the project's monitors check, narrowed to the monitors whose
   * steps name the domain: a monitor of the same name, or of a name under
   * it, writes it whole.
   */
  public static async readMonitors(
    projectId: ObjectID,
    domain: string,
  ): Promise<DomainReading> {
    const rows: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId,
        monitorSteps: QueryHelper.search(domain) as never,
      },
      select: { _id: true, name: true, monitorSteps: true },
      skip: 0,
      limit: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1,
      props: ROOT,
    });

    return {
      domains: rows
        .slice(0, PROTECTED_INDICATOR_ROWS_PER_SOURCE)
        .flatMap((monitor: Monitor): Array<ProtectedDomain> => {
          return domainsOf({
            values: getMonitorTargetHosts(monitor.monitorSteps),
            source: SecurityProtectedAddressSource.Monitor,
            name: monitor.name || "",
            coversNamesUnder: false,
            ...(monitor.id ? { recordId: monitor.id.toString() } : {}),
          });
        }),
      isComplete: rows.length <= PROTECTED_INDICATOR_ROWS_PER_SOURCE,
    };
  }

  // The project's status pages' own domains, narrowed as the monitors are.
  public static async readStatusPages(
    projectId: ObjectID,
    domain: string,
  ): Promise<DomainReading> {
    const rows: Array<StatusPageDomain> = await StatusPageDomainService.findBy({
      query: {
        projectId,
        fullDomain: QueryHelper.search(domain) as never,
      },
      select: { _id: true, fullDomain: true, statusPage: { name: true } },
      skip: 0,
      limit: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1,
      props: ROOT,
    });

    return {
      domains: rows
        .slice(0, PROTECTED_INDICATOR_ROWS_PER_SOURCE)
        .flatMap((row: StatusPageDomain): Array<ProtectedDomain> => {
          return domainsOf({
            values: [row.fullDomain],
            source: SecurityProtectedAddressSource.StatusPage,
            name: row.statusPage?.name || row.fullDomain || "",
            coversNamesUnder: false,
            ...(row.id ? { recordId: row.id.toString() } : {}),
          });
        }),
      isComplete: rows.length <= PROTECTED_INDICATOR_ROWS_PER_SOURCE,
    };
  }

  /*
   * The domains the project verified it owns, each with every name under
   * it. Read whole: a name under one shares no text with the block above it.
   */
  public static async readProjectDomains(
    projectId: ObjectID,
  ): Promise<DomainReading> {
    const rows: Array<Domain> = await DomainService.findBy({
      query: { projectId, isVerified: true },
      select: { _id: true, domain: true },
      skip: 0,
      limit: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1,
      props: ROOT,
    });

    return {
      domains: rows
        .slice(0, PROTECTED_INDICATOR_ROWS_PER_SOURCE)
        .flatMap((row: Domain): Array<ProtectedDomain> => {
          const name: string = row.domain ? row.domain.toString() : "";

          return domainsOf({
            values: [name],
            source: SecurityProtectedAddressSource.ProjectDomain,
            name,
            coversNamesUnder: true,
            ...(row.id ? { recordId: row.id.toString() } : {}),
          });
        }),
      isComplete: rows.length <= PROTECTED_INDICATOR_ROWS_PER_SOURCE,
    };
  }

  /*
   * The DNS names the project's cloud inventory lists for its resources,
   * narrowed as the monitors are, and its DNS zones, each with every name
   * under it, read whole.
   */
  public static async readCloudResources(
    projectId: ObjectID,
    domain: string,
  ): Promise<DomainReading> {
    const select: {
      _id: true;
      name: true;
      cloudProvider: true;
      cloudResourceType: true;
      cloudEndpoints: true;
      cloudConnection: { name: true };
    } = {
      _id: true,
      name: true,
      cloudProvider: true,
      cloudResourceType: true,
      cloudEndpoints: true,
      cloudConnection: { name: true },
    };

    const [byEndpoint, zones]: [Array<CloudResource>, Array<CloudResource>] =
      await Promise.all([
        CloudResourceService.findBy({
          query: {
            projectId,
            isArchived: false,
            cloudEndpoints: QueryHelper.search(domain) as never,
          },
          select,
          skip: 0,
          limit: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1,
          props: ROOT,
        }),
        CloudResourceService.findBy({
          query: {
            projectId,
            isArchived: false,
            cloudResourceType: QueryHelper.any([
              ...DNS_ZONE_RESOURCE_TYPES,
            ]) as never,
          },
          select,
          skip: 0,
          limit: PROTECTED_INDICATOR_ROWS_PER_SOURCE + 1,
          props: ROOT,
        }),
      ]);

    const describe: (resource: CloudResource) => {
      recordId?: string | undefined;
      kind?: string | undefined;
      where?: string | undefined;
    } = (resource: CloudResource) => {
      return {
        ...(resource.id ? { recordId: resource.id.toString() } : {}),
        kind:
          getCloudResourceTypeLabel(
            resource.cloudProvider,
            resource.cloudResourceType,
          ) || undefined,
        where: resource.cloudConnection?.name || undefined,
      };
    };

    const domains: Array<ProtectedDomain> = [
      ...byEndpoint
        .slice(0, PROTECTED_INDICATOR_ROWS_PER_SOURCE)
        .flatMap((resource: CloudResource): Array<ProtectedDomain> => {
          return domainsOf({
            values: readCloudEndpoints(resource.cloudEndpoints),
            source: SecurityProtectedAddressSource.CloudResource,
            name: resource.name || "",
            coversNamesUnder: false,
            ...describe(resource),
          });
        }),
      ...zones
        .slice(0, PROTECTED_INDICATOR_ROWS_PER_SOURCE)
        .flatMap((resource: CloudResource): Array<ProtectedDomain> => {
          return domainsOf({
            values: [resource.name],
            source: SecurityProtectedAddressSource.CloudResource,
            name: resource.name || "",
            coversNamesUnder: true,
            ...describe(resource),
          });
        }),
    ];

    return {
      domains,
      isComplete:
        byEndpoint.length <= PROTECTED_INDICATOR_ROWS_PER_SOURCE &&
        zones.length <= PROTECTED_INDICATOR_ROWS_PER_SOURCE,
    };
  }
}
