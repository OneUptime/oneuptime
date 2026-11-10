import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import { DiscoveredNetworkDevice } from "../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceNamingRule from "../../Models/DatabaseModels/NetworkDeviceNamingRule";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import SnmpVendorTemplateUtil from "../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import {
  DeviceNamingApplyResult,
  DeviceNamingOutcome,
  DeviceNamingPlan,
  DeviceNamingPlanItem,
  DeviceNamingPreview,
  DeviceNamingPreviewItem,
  DeviceNamingRename,
  DeviceNamingResult,
  MAX_DEVICES_PER_NAMING_PLAN,
  MAX_RENAMES_PER_NAMING_APPLY,
  NAMING_APPLY_DEVICE_GONE_REASON,
  NAMING_APPLY_NAME_CHANGED_REASON,
  NAMING_APPLY_RULES_CHANGED_REASON,
  isDeviceNamedByPerson,
} from "../../Types/NetworkDevice/DeviceNaming";
import { DeviceNameSource } from "../../Types/NetworkDevice/DeviceNameSource";
import { DiscoveredDeviceImportFacts } from "../../Types/NetworkDevice/DiscoveredDevice";
import { getDiscoveryImportHostKey } from "../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../Types/ObjectID";
import {
  DiscoveredHostNaming,
  buildDeviceName,
} from "../../Utils/NetworkDiscovery/DiscoveredDeviceBuilder";
import {
  DeviceNameRegistry,
  DeviceNamingSession,
  DeviceNamingSubject,
  PreparedNamingRule,
  planDeviceNames,
  prepareNamingRules,
} from "../../Utils/NetworkDevice/Naming/DeviceNamingPlanner";
import { DeviceNamingFacts } from "../../Utils/NetworkDevice/Naming/NamingRuleMatcher";
import {
  getNetworkDeviceAssetFacts,
  getNetworkDeviceManufacturer,
} from "../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import CidrMatchUtil from "../../Utils/NetworkSite/CidrMatchUtil";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import { RuleEvaluation } from "../Utils/PatternWorkScope";
import { RuleRunWriteProps } from "../Utils/Rules/RuleRun/RuleApplication";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import NetworkDeviceNamingRuleService from "./NetworkDeviceNamingRuleService";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkSiteAssignmentRuleService from "./NetworkSiteAssignmentRuleService";
import NetworkSiteService from "./NetworkSiteService";

/*
 * THE NAMING RULES, ON THE SERVER (OneUptime issue #6619).
 *
 * The rules are pure (Utils/NetworkDevice/Naming); this reads what they need
 * and acts on what they say, in four places:
 *
 *   import   the discovery import (Review Results, Add to Monitoring) and
 *            the auto import rules name each device they create: the
 *            rules' name, with the name discovery found kept as its
 *            Discovered Name. A host whose rules cannot name it is created
 *            under its discovered name, exactly as before.
 *   preview  the import's Choose step shows, beside each host, the name it
 *            will be created under and why a rule could not name it.
 *   plan     the devices already in the project that do not follow the
 *            rules, with what each would be called.
 *   apply    renames the devices a person confirmed from a plan.
 *
 * WHAT A DEVICE IS NAMED FROM. A host of a scan: its address, the name
 * discovery gives it (under the scan's short-name choice), the vendor its
 * SNMP answer names, and the site the project's site assignment rules put it
 * in - read now, by the same rule picker that places it once it is created,
 * since a name like "UN{site.code}..." needs its site before the device
 * exists. A device the Discovered Devices list adds: its address, the name
 * the list shows, its MAC, its vendor and the site it was seen in. A device
 * already in the project: its address, its discovered name (else its name),
 * its MAC and vendor as its Overview shows them, and its site.
 *
 * The site's code and the sites above it come from one read of the
 * project's sites, so a rule for a region names every store in it.
 */

/*
 * The most rules one naming pass reads: far more than anyone keeps, and a
 * bound on what one import or plan evaluates per device.
 */
const MAX_NAMING_RULES: number = MAX_RULES_EVALUATED_PER_PROJECT;

// Devices read per page when the project's names and devices are read.
const DEVICE_PAGE_SIZE: number = 5000;

export interface NamingSiteRow {
  id: string;
  name?: string | undefined;
  code?: string | undefined;
  parentSiteId?: string | undefined;
}

export interface NamingSiteInfo {
  id: string;
  name?: string | undefined;
  code?: string | undefined;
  // The site and every site above it, nearest first.
  siteIds: Array<string>;
}

/*
 * THE PROJECT'S SITES, for naming: each site's name and code, and the sites
 * above it - read through parentSiteId, a cycle in which (a half-applied
 * move) ends the walk rather than looping.
 */
export class NamingSiteDirectory {
  private readonly rows: Map<string, NamingSiteRow> = new Map<
    string,
    NamingSiteRow
  >();

  public constructor(rows: ReadonlyArray<NamingSiteRow>) {
    for (const row of rows) {
      if (row && row.id) {
        this.rows.set(row.id, row);
      }
    }
  }

  public describe(siteId: string | null | undefined): NamingSiteInfo | undefined {
    const id: string = (siteId || "").trim();
    const site: NamingSiteRow | undefined = id ? this.rows.get(id) : undefined;

    if (!site) {
      return undefined;
    }

    const siteIds: Array<string> = [];
    let current: NamingSiteRow | undefined = site;

    while (current && !siteIds.includes(current.id)) {
      siteIds.push(current.id);
      current = current.parentSiteId
        ? this.rows.get(current.parentSiteId)
        : undefined;
    }

    return {
      id: site.id,
      name: site.name,
      code: site.code,
      siteIds: siteIds,
    };
  }
}

/*
 * Everything a naming pass of one project reads once: the enabled rules in
 * order, the sites, the site assignment rules a scan's host is placed by,
 * and every name the project's devices have.
 */
export interface DeviceNamingContext {
  projectId: ObjectID;
  rules: Array<PreparedNamingRule>;
  sites: NamingSiteDirectory;
  siteAssignmentRules: Array<NetworkSiteAssignmentRule>;
  registry: DeviceNameRegistry;
}

/*
 * What naming a host for an import decided: the name to create it under
 * (with the name discovery found kept beside it), and the site the name was
 * made for, so the device is created in it.
 */
export interface ImportNaming {
  result: DeviceNamingResult;
  // The rules' name, when they named the host.
  name?: string | undefined;
  discoveredName: string;
  // The site the host's name was made for: the device is created in it.
  siteId?: string | undefined;
}

// The device columns a plan reads.
const PLAN_DEVICE_SELECT: Select<NetworkDevice> = {
  _id: true,
  name: true,
  hostname: true,
  dnsName: true,
  sysName: true,
  discoveredName: true,
  discoveredNameSource: true,
  ruleAssignedName: true,
  macAddress: true,
  isMacAddressLearned: true,
  vendor: true,
  deviceModel: true,
  sysDescr: true,
  sysObjectId: true,
  discoveredDetails: true,
  siteId: true,
  createdAt: true,
};

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function idOf(value: unknown): string {
  if (!value) {
    return "";
  }

  return String(value).trim();
}

class NetworkDeviceNamingRuleEngineServiceClass {
  public readonly ruleSelect: Select<NetworkDeviceNamingRule> = {
    _id: true,
    name: true,
    priority: true,
    createdAt: true,
    isEnabled: true,
    criteria: true,
    ipMatchTarget: true,
    discoveredNamePattern: true,
    macAddressPattern: true,
    vendorPattern: true,
    sites: { _id: true },
    namePattern: true,
    lookupKey: true,
    lookupEntries: true,
  };

  // The project's enabled naming rules, in the order they are tried.
  @CaptureSpan()
  public async loadRules(
    projectId: ObjectID,
  ): Promise<Array<PreparedNamingRule>> {
    const rules: Array<NetworkDeviceNamingRule> =
      await NetworkDeviceNamingRuleService.findBy({
        query: {
          projectId: projectId,
          isEnabled: true,
        },
        select: this.ruleSelect,
        sort: { priority: SortOrder.Descending, createdAt: SortOrder.Ascending },
        limit: MAX_NAMING_RULES,
        skip: 0,
        props: { isRoot: true },
      });

    return prepareNamingRules(rules);
  }

  @CaptureSpan()
  public async loadSites(projectId: ObjectID): Promise<NamingSiteDirectory> {
    const sites: Array<NetworkSite> = await NetworkSiteService.findAllBy({
      query: { projectId: projectId },
      select: { _id: true, name: true, code: true, parentSiteId: true },
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });

    return new NamingSiteDirectory(
      sites.map((site: NetworkSite): NamingSiteRow => {
        return {
          id: idOf(site._id),
          name: toText(site.name) || undefined,
          code: toText(site.code) || undefined,
          parentSiteId: site.parentSiteId
            ? site.parentSiteId.toString()
            : undefined,
        };
      }),
    );
  }

  /*
   * Every name the project's devices have, with the device holding it -
   * archived devices included: their names are as taken as any.
   */
  @CaptureSpan()
  public async loadNameRegistry(
    projectId: ObjectID,
  ): Promise<DeviceNameRegistry> {
    const devices: Array<NetworkDevice> = await NetworkDeviceService.findAllBy({
      query: { projectId: projectId },
      select: { _id: true, name: true },
      sort: { createdAt: SortOrder.Ascending },
      props: { isRoot: true },
    });

    return new DeviceNameRegistry(
      devices.map((device: NetworkDevice) => {
        return { name: device.name, deviceId: idOf(device._id) };
      }),
    );
  }

  @CaptureSpan()
  public async loadSiteAssignmentRules(
    projectId: ObjectID,
  ): Promise<Array<NetworkSiteAssignmentRule>> {
    return await NetworkSiteAssignmentRuleService.findBy({
      query: { projectId: projectId },
      select: {
        _id: true,
        siteId: true,
        subnetCidr: true,
        hostnamePattern: true,
        criteria: true,
        priority: true,
        createdAt: true,
      },
      limit: MAX_NAMING_RULES,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /**
   * What a naming pass of the project reads, or null when the project has no
   * enabled naming rule - the common case, which then costs one query.
   */
  @CaptureSpan()
  public async loadContext(
    projectId: ObjectID,
  ): Promise<DeviceNamingContext | null> {
    const rules: Array<PreparedNamingRule> = await this.loadRules(projectId);

    if (rules.length === 0) {
      return null;
    }

    const [sites, siteAssignmentRules, registry]: [
      NamingSiteDirectory,
      Array<NetworkSiteAssignmentRule>,
      DeviceNameRegistry,
    ] = await Promise.all([
      this.loadSites(projectId),
      this.loadSiteAssignmentRules(projectId),
      this.loadNameRegistry(projectId),
    ]);

    return {
      projectId: projectId,
      rules: rules,
      sites: sites,
      siteAssignmentRules: siteAssignmentRules,
      registry: registry,
    };
  }

  private withSite(
    facts: DeviceNamingFacts,
    site: NamingSiteInfo | undefined,
  ): DeviceNamingFacts {
    if (!site) {
      return facts;
    }

    return {
      ...facts,
      siteId: site.id,
      siteIds: site.siteIds,
      siteName: site.name,
      siteCode: site.code,
    };
  }

  /*
   * The site the project's site assignment rules put a scan's host in, read
   * the way the rules read the device once it is created: its address, and
   * the names discovery has for it.
   */
  public predictSiteOfScanHost(data: {
    context: DeviceNamingContext;
    host: DiscoveredNetworkDevice;
    discoveredName: string;
  }): string | undefined {
    if (data.context.siteAssignmentRules.length === 0) {
      return undefined;
    }

    const winner: NetworkSiteAssignmentRule | null = CidrMatchUtil.pickRule(
      data.context.siteAssignmentRules,
      {
        ip: data.host.ipAddress,
        hostname: data.host.ipAddress,
        sysName: toText(data.host.sysName) || undefined,
        name: data.discoveredName || undefined,
        dnsName: toText(data.host.dnsHostname) || undefined,
      },
    );

    return winner?.siteId ? winner.siteId.toString() : undefined;
  }

  // What a scan's host is named from, and the site it will be placed in.
  public factsOfScanHost(data: {
    context: DeviceNamingContext;
    host: DiscoveredNetworkDevice;
    scan: DiscoveredHostNaming;
  }): { facts: DeviceNamingFacts; discoveredName: string } {
    const discoveredName: string =
      buildDeviceName(data.host, data.scan) || data.host.ipAddress;
    const siteId: string | undefined = this.predictSiteOfScanHost({
      context: data.context,
      host: data.host,
      discoveredName: discoveredName,
    });
    const vendor: string | undefined = SnmpVendorTemplateUtil.getVendorName({
      sysObjectId: toText(data.host.sysObjectId) || undefined,
      sysDescr: toText(data.host.sysDescr) || undefined,
    });

    return {
      discoveredName: discoveredName,
      facts: this.withSite(
        {
          ipAddress: data.host.ipAddress,
          discoveredName: discoveredName,
          vendor: vendor,
        },
        data.context.sites.describe(siteId),
      ),
    };
  }

  // What a device the Discovered Devices list adds is named from.
  public factsOfDiscoveredDevice(data: {
    context: DeviceNamingContext;
    ipAddress: string;
    facts: DiscoveredDeviceImportFacts;
  }): { facts: DeviceNamingFacts; discoveredName: string } {
    const discoveredName: string =
      toText(data.facts.name) || data.ipAddress.trim();

    return {
      discoveredName: discoveredName,
      facts: this.withSite(
        {
          ipAddress: data.ipAddress.trim(),
          macAddress: toText(data.facts.macAddress) || undefined,
          vendor: toText(data.facts.vendor) || undefined,
          discoveredName: discoveredName,
        },
        data.context.sites.describe(data.facts.siteId),
      ),
    };
  }

  // What a device already in the project is named from.
  public factsOfDevice(
    context: DeviceNamingContext,
    device: NetworkDevice,
  ): DeviceNamingFacts {
    const assetFacts: { macAddress?: string | undefined } =
      getNetworkDeviceAssetFacts(device);

    return this.withSite(
      {
        ipAddress: toText(device.hostname) || undefined,
        macAddress: assetFacts.macAddress || toText(device.macAddress) || undefined,
        vendor: getNetworkDeviceManufacturer(device) || undefined,
        discoveredName:
          toText(device.discoveredName) || toText(device.name) || undefined,
      },
      context.sites.describe(device.siteId ? device.siteId.toString() : ""),
    );
  }

  /*
   * A session for one import: names each host as it is created, holding
   * every name between them. Null when the project has no enabled rule.
   */
  @CaptureSpan()
  public async startImportSession(
    projectId: ObjectID,
  ): Promise<ImportNamingSession | null> {
    const context: DeviceNamingContext | null =
      await this.loadContext(projectId);

    return context ? new ImportNamingSession(context, this) : null;
  }

  /**
   * The names a scan's hosts will be imported under, in the order the
   * import creates them, so the numbers shown are the numbers given.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async previewScanHosts(data: {
    projectId: ObjectID;
    hosts: ReadonlyArray<DiscoveredNetworkDevice>;
    scan: DiscoveredHostNaming;
  }): Promise<DeviceNamingPreview> {
    const context: DeviceNamingContext | null = await this.loadContext(
      data.projectId,
    );

    if (!context) {
      return { hasRules: false, items: [] };
    }

    const session: ImportNamingSession = new ImportNamingSession(context, this);
    const items: Array<DeviceNamingPreviewItem> = [];

    for (const host of data.hosts) {
      const naming: ImportNaming = session.nameScanHost(host, data.scan);

      items.push({
        key: getDiscoveryImportHostKey({ ipAddress: host.ipAddress }),
        discoveredName: naming.discoveredName,
        ...naming.result,
      });
    }

    return { hasRules: true, items: items };
  }

  // The names devices the Discovered Devices list adds will be created under.
  @CaptureSpan()
  @RuleEvaluation()
  public async previewDiscoveredDevices(data: {
    projectId: ObjectID;
    hosts: ReadonlyArray<{ ipAddress: string; facts: DiscoveredDeviceImportFacts }>;
  }): Promise<DeviceNamingPreview> {
    const context: DeviceNamingContext | null = await this.loadContext(
      data.projectId,
    );

    if (!context) {
      return { hasRules: false, items: [] };
    }

    const session: ImportNamingSession = new ImportNamingSession(context, this);
    const items: Array<DeviceNamingPreviewItem> = [];

    for (const host of data.hosts) {
      const naming: ImportNaming = session.nameDiscoveredDevice(
        host.ipAddress,
        host.facts,
      );

      items.push({
        key: getDiscoveryImportHostKey({
          ipAddress: host.ipAddress,
          endpointId: host.facts.endpointId,
        }),
        discoveredName: naming.discoveredName,
        ...naming.result,
      });
    }

    return { hasRules: true, items: items };
  }

  private async readDevicesForPlan(data: {
    projectId: ObjectID;
    deviceIds?: Array<string> | undefined;
  }): Promise<{ devices: Array<NetworkDevice>; isTruncated: boolean }> {
    if (data.deviceIds) {
      const ids: Array<string> = Array.from(
        new Set<string>(
          data.deviceIds.filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
        ),
      ).slice(0, MAX_DEVICES_PER_NAMING_PLAN);
      const devices: Array<NetworkDevice> = [];

      for (let index: number = 0; index < ids.length; index += DEVICE_PAGE_SIZE) {
        devices.push(
          ...(await NetworkDeviceService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(ids.slice(index, index + DEVICE_PAGE_SIZE)),
            },
            select: PLAN_DEVICE_SELECT,
            limit: DEVICE_PAGE_SIZE,
            skip: 0,
            props: { isRoot: true },
          })),
        );
      }

      return { devices: devices, isTruncated: false };
    }

    const devices: Array<NetworkDevice> = await NetworkDeviceService.findAllBy({
      query: { projectId: data.projectId, isArchived: false },
      select: PLAN_DEVICE_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: MAX_DEVICES_PER_NAMING_PLAN + 1,
      props: { isRoot: true },
    });

    return {
      devices: devices.slice(0, MAX_DEVICES_PER_NAMING_PLAN),
      isTruncated: devices.length > MAX_DEVICES_PER_NAMING_PLAN,
    };
  }

  /*
   * The order a plan names devices in: the oldest first (then by id), so
   * the device imported first takes the first number, and the outcome never
   * depends on the order the database returned the rows in.
   */
  private sortForPlan(devices: Array<NetworkDevice>): Array<NetworkDevice> {
    return [...devices].sort((left: NetworkDevice, right: NetworkDevice) => {
      const leftTime: number = left.createdAt
        ? new Date(left.createdAt).getTime()
        : 0;
      const rightTime: number = right.createdAt
        ? new Date(right.createdAt).getTime()
        : 0;

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      const leftId: string = idOf(left._id);
      const rightId: string = idOf(right._id);

      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  }

  /**
   * The devices that do not follow the naming rules - every device of the
   * project, or the ones asked about - with what each would be called. The
   * devices that already follow the rules are counted, not listed.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async planExistingDevices(data: {
    projectId: ObjectID;
    deviceIds?: Array<string> | undefined;
  }): Promise<DeviceNamingPlan> {
    const context: DeviceNamingContext | null = await this.loadContext(
      data.projectId,
    );

    if (!context) {
      return {
        hasRules: false,
        devicesChecked: 0,
        items: [],
        followingCount: 0,
        isTruncated: false,
      };
    }

    const read: { devices: Array<NetworkDevice>; isTruncated: boolean } =
      await this.readDevicesForPlan(data);
    const devices: Array<NetworkDevice> = this.sortForPlan(read.devices);
    const subjects: Array<DeviceNamingSubject> = devices.map(
      (device: NetworkDevice): DeviceNamingSubject => {
        return {
          key: idOf(device._id),
          deviceId: idOf(device._id),
          currentName: toText(device.name),
          facts: this.factsOfDevice(context, device),
        };
      },
    );

    /*
     * Planned in two passes. The devices whose names a person typed keep
     * their names unless someone ticks them, so their names are held while
     * the rest are numbered: a device named "UN1216LANSWI01" by hand is not
     * given away to another switch. They are planned after, for the list.
     */
    const byPerson: Set<string> = new Set<string>(
      devices
        .filter((device: NetworkDevice): boolean => {
          return isDeviceNamedByPerson(device);
        })
        .map((device: NetworkDevice): string => {
          return idOf(device._id);
        }),
    );
    const results: Map<string, DeviceNamingResult> = planDeviceNames({
      rules: context.rules,
      subjects: subjects.filter((subject: DeviceNamingSubject): boolean => {
        return !byPerson.has(subject.key);
      }),
      registry: context.registry,
    });
    const personResults: Map<string, DeviceNamingResult> = planDeviceNames({
      rules: context.rules,
      subjects: subjects.filter((subject: DeviceNamingSubject): boolean => {
        return byPerson.has(subject.key);
      }),
      registry: context.registry,
    });

    const items: Array<DeviceNamingPlanItem> = [];
    let followingCount: number = 0;

    for (const device of devices) {
      const deviceId: string = idOf(device._id);
      const result: DeviceNamingResult | undefined =
        results.get(deviceId) || personResults.get(deviceId);

      if (!result) {
        continue;
      }

      if (result.outcome === DeviceNamingOutcome.FollowsRules) {
        followingCount++;
        continue;
      }

      items.push({
        deviceId: deviceId,
        currentName: toText(device.name),
        isNamedByPerson: byPerson.has(deviceId),
        ...result,
      });
    }

    return {
      hasRules: true,
      devicesChecked: devices.length,
      items: items,
      followingCount: followingCount,
      isTruncated: read.isTruncated,
    };
  }

  /**
   * Renames the devices a person confirmed from a plan. Each is planned
   * again first, together with the others, and renamed only if it still has
   * the name the person saw and the rules still give it the name they
   * confirmed - a device renamed meanwhile, or rules changed meanwhile, are
   * left alone with the reason. Written as the person (RuleRunWriteProps),
   * so the audit log credits them; the route has asked they may rename every
   * device.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async applyRenames(data: {
    projectId: ObjectID;
    renames: Array<DeviceNamingRename>;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<DeviceNamingApplyResult> {
    if (data.renames.length > MAX_RENAMES_PER_NAMING_APPLY) {
      throw new BadDataException(
        `Rename at most ${MAX_RENAMES_PER_NAMING_APPLY} devices at once.`,
      );
    }

    const result: DeviceNamingApplyResult = { renamed: 0, skipped: [] };

    if (data.renames.length === 0) {
      return result;
    }

    const plan: DeviceNamingPlan = await this.planExistingDevices({
      projectId: data.projectId,
      deviceIds: data.renames.map((rename: DeviceNamingRename): string => {
        return rename.deviceId;
      }),
    });
    const planned: Map<string, DeviceNamingPlanItem> = new Map<
      string,
      DeviceNamingPlanItem
    >(
      plan.items.map((item: DeviceNamingPlanItem): [string, DeviceNamingPlanItem] => {
        return [item.deviceId, item];
      }),
    );
    const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(
          data.renames
            .map((rename: DeviceNamingRename): string => {
              return rename.deviceId;
            })
            .filter((id: string): boolean => {
              return ObjectID.isValidUUID(id);
            }),
        ),
      },
      select: { _id: true, name: true },
      limit: data.renames.length,
      skip: 0,
      props: { isRoot: true },
    });
    const currentNames: Map<string, string> = new Map<string, string>(
      devices.map((device: NetworkDevice): [string, string] => {
        return [idOf(device._id), toText(device.name)];
      }),
    );

    for (const rename of data.renames) {
      const currentName: string | undefined = currentNames.get(rename.deviceId);

      if (currentName === undefined) {
        result.skipped.push({
          deviceId: rename.deviceId,
          reason: NAMING_APPLY_DEVICE_GONE_REASON,
        });
        continue;
      }

      if (currentName !== rename.fromName.trim()) {
        result.skipped.push({
          deviceId: rename.deviceId,
          reason: NAMING_APPLY_NAME_CHANGED_REASON,
        });
        continue;
      }

      const item: DeviceNamingPlanItem | undefined = planned.get(
        rename.deviceId,
      );

      if (
        !item ||
        item.outcome !== DeviceNamingOutcome.Named ||
        item.name !== rename.toName.trim()
      ) {
        result.skipped.push({
          deviceId: rename.deviceId,
          reason: NAMING_APPLY_RULES_CHANGED_REASON,
        });
        continue;
      }

      try {
        await NetworkDeviceService.updateOneById({
          id: new ObjectID(rename.deviceId),
          data: {
            name: item.name,
            ruleAssignedName: item.name,
          },
          props: RuleRunWriteProps.get(data.props),
        });
        result.renamed++;
      } catch (error) {
        logger.error(
          `Naming rules: could not rename network device ${rename.deviceId}: ${error}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        result.skipped.push({
          deviceId: rename.deviceId,
          reason:
            error instanceof Error && error.message
              ? error.message
              : "The device could not be renamed.",
        });
      }
    }

    return result;
  }
}

/**
 * The device a naming rule named, as an import builds it: created under the
 * rule's name, which it records as its rule-assigned name, with the name
 * discovery found kept as its discovered name - and in the site the name was
 * made for. A scan's host is placed in its site by the project's site
 * assignment rules once it exists, and some of them match the name it is
 * created under; a rule-named device is created straight into the site those
 * rules gave it while it still had its discovered name, so a name like
 * "UN{site.code}..." always belongs to the site it is in.
 */
export function nameDeviceByRule(data: {
  device: NetworkDevice;
  naming: ImportNaming;
  address: string;
  isDiscoveredDevice: boolean;
}): NetworkDevice {
  const device: NetworkDevice = data.device;

  if (device.name) {
    device.ruleAssignedName = device.name;
  }

  if (data.isDiscoveredDevice) {
    // Named by its address, as the list showed it: recorded as such.
    if (data.naming.discoveredName === data.address.trim()) {
      device.discoveredNameSource = DeviceNameSource.Address;
      device.discoveredName = data.naming.discoveredName;
    }
  } else if (device.discoveredNameSource) {
    device.discoveredName = data.naming.discoveredName;
  }

  if (!device.siteId && data.naming.siteId) {
    device.siteId = new ObjectID(data.naming.siteId);
  }

  return device;
}

const NetworkDeviceNamingRuleEngineService: NetworkDeviceNamingRuleEngineServiceClass =
  new NetworkDeviceNamingRuleEngineServiceClass();

/*
 * ONE IMPORT'S NAMING: the hosts named one at a time, in the order they are
 * created, every name given held for the rest - by the rules, and the names
 * the import's collision fallback creates devices under.
 */
export class ImportNamingSession {
  private readonly session: DeviceNamingSession;

  public constructor(
    private readonly context: DeviceNamingContext,
    private readonly engine: NetworkDeviceNamingRuleEngineServiceClass,
  ) {
    this.session = new DeviceNamingSession({
      rules: context.rules,
      registry: context.registry,
    });
  }

  private finish(
    key: string,
    facts: DeviceNamingFacts,
    discoveredName: string,
  ): ImportNaming {
    const result: DeviceNamingResult = this.session.name({
      key: key,
      facts: facts,
    });

    if (result.outcome !== DeviceNamingOutcome.Named || !result.name) {
      return { result: result, discoveredName: discoveredName };
    }

    return {
      result: result,
      name: result.name,
      discoveredName: discoveredName,
      siteId: facts.siteId,
    };
  }

  public nameScanHost(
    host: DiscoveredNetworkDevice,
    scan: DiscoveredHostNaming,
  ): ImportNaming {
    const read: { facts: DeviceNamingFacts; discoveredName: string } =
      this.engine.factsOfScanHost({
        context: this.context,
        host: host,
        scan: scan,
      });

    return this.finish(host.ipAddress, read.facts, read.discoveredName);
  }

  public nameDiscoveredDevice(
    ipAddress: string,
    facts: DiscoveredDeviceImportFacts,
  ): ImportNaming {
    const read: { facts: DeviceNamingFacts; discoveredName: string } =
      this.engine.factsOfDiscoveredDevice({
        context: this.context,
        ipAddress: ipAddress,
        facts: facts,
      });

    return this.finish(
      getDiscoveryImportHostKey({
        ipAddress: ipAddress,
        endpointId: facts.endpointId,
      }),
      read.facts,
      read.discoveredName,
    );
  }

  // A name a device was created under outside the rules: held from now on.
  public hold(name: string | undefined): void {
    if (name && name.trim()) {
      this.session.hold(name.trim());
    }
  }
}

export default NetworkDeviceNamingRuleEngineService;
