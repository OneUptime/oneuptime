import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import NetworkDeviceLabelRuleEngineService from "./NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "./NetworkDeviceOwnerRuleEngineService";
import NetworkSiteAssignmentRuleService from "./NetworkSiteAssignmentRuleService";
import NetworkSiteService from "./NetworkSiteService";
import Model from "../../Models/DatabaseModels/NetworkDevice";
import Monitor from "../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import Query from "../Types/Database/Query";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import CidrMatchUtil from "../../Utils/NetworkSite/CidrMatchUtil";
import { SiteAssignmentRuleRunResult } from "../../Types/NetworkAutomation/RuleRunResult";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import NetworkDeviceOidTemplate from "../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import NetworkDeviceOidTemplateService from "./NetworkDeviceOidTemplateService";
import SnmpOid from "../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpOidListUtil, {
  MAX_DEVICE_SPECIFIC_OIDS,
  MAX_EFFECTIVE_OIDS_PER_DEVICE,
} from "../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import { EntityManager } from "typeorm";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import { AggregateRow } from "../Types/Database/AggregateBy";
import AggregateResultUtil from "../Types/Database/AggregateResultUtil";
import {
  DEVICE_HEALTH_AGGREGATES,
  DEVICE_HEALTH_GROUP_COLUMNS,
  DEVICE_HEALTH_GROUP_ORDER,
  DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE,
  DEVICE_HEALTH_NOW_PARAMETER,
  DeviceHealthGroup,
  parseDeviceHealthGroup,
} from "../Utils/NetworkDevice/DeviceHealthAggregation";

/**
 * The fleet-wide numbers the device summary strip and the network overview
 * both print. Counted in Postgres — see `Service.getFleetSummary`.
 */
export interface DeviceFleetSummary {
  devicesUp: number;
  devicesDown: number;
  devicesPending: number;
  // Interfaces, not devices: a switch with three dark ports contributes three.
  interfacesDown: number;
  totalDevices: number;
  devicesWithoutSite: number;
}

/*
 * Columns a NetworkSiteAssignmentRule's hostname pattern is matched against.
 * A write to any of them can change which rule wins for the device, so
 * onUpdateSuccess re-evaluates the rules. `sysName` matters most in practice:
 * a discovery import stores the responding IP in `hostname` and only the SNMP
 * walk fills `sysName` in later, so a device's real identity usually lands
 * AFTER creation.
 */
const SITE_RULE_IDENTITY_COLUMNS: Array<string> = [
  "hostname",
  "name",
  "sysName",
];

/*
 * Both spellings of "the device's site" in a write payload - see
 * RelationIdUtil for why a hook has to watch for both.
 */
const SITE_KEYS: Array<string> = ["siteId", "site"];

/*
 * Null, undefined and "  Core-SW " all mean the same thing to a
 * case-insensitive wildcard match, so compare identity values normalised -
 * otherwise a no-op rewrite of sysName on every SNMP walk would look like a
 * change and re-run the rules for the whole fleet every polling cycle.
 */
function normalizeIdentityValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim().toLowerCase();
}

// True when the payload sets the device's site, under either spelling.
function isSiteWrite(dataKeys: Array<string>): boolean {
  return RelationIdUtil.isWritten(dataKeys, SITE_KEYS);
}

/*
 * The site a payload moves the device to, or null when it clears the site (or
 * carries no resolvable id).
 */
function readSiteIdFromData(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.read(data, SITE_KEYS);
}

// Both spellings of "the monitor that reports this device's health".
const MONITOR_KEYS: Array<string> = ["monitorId", "monitor"];

/*
 * Both spellings of "the OID Collection Template this device collects". The
 * settings page posts the `oidTemplate` relation and the bulk action posts
 * the `oidTemplateId` column, so a guard that watched only one of them would
 * be trivially bypassable from the UI.
 */
const OID_TEMPLATE_KEYS: Array<string> = ["oidTemplateId", "oidTemplate"];

function readOidTemplateIdFromData(
  data: Record<string, unknown>,
): ObjectID | null {
  /*
   * readConsistent, not read: a payload that writes BOTH spellings with
   * different ids would otherwise have one of them validated and the other
   * persisted, which turns the cross-project guard below into something a
   * caller can steer. It refuses the contradiction instead of picking.
   */
  return RelationIdUtil.readConsistent(
    data,
    OID_TEMPLATE_KEYS,
    "OID Collection Template",
  );
}

function readMonitorIdFromData(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.read(data, MONITOR_KEYS);
}

/*
 * How many devices a single manual "Run now" of an assignment rule walks.
 * The automatic path only ever sees one device at a time, so this cap is the
 * only thing standing between a rule run and a full-fleet table scan inside
 * one HTTP request. Runs that hit it report isTruncated so the caller can say
 * "run it again" rather than quietly leave half the estate unassigned.
 */
export const MAX_DEVICES_PER_RULE_RUN: number = LIMIT_PER_PROJECT;

// Devices are read in pages so a large estate never lands in memory at once.
const RULE_RUN_PAGE_SIZE: number = 1000;

/*
 * How many addresses one "are these already registered" lookup asks about.
 * Bounded because the list is rendered into the statement as a literal IN.
 */
const HOSTNAME_LOOKUP_CHUNK_SIZE: number = 500;

/*
 * The identity a rule is matched against. The hostname column holds an IP
 * address or a DNS name depending on how the device got here, so it is passed
 * as both — ipInCidr rejects non-IP strings safely. Mirrors the single-device
 * path in applySiteAssignmentRulesToDevice; both must stay in step or a
 * manual run would disagree with what discovery does.
 */
function toRuleMatchTarget(device: Model): {
  ip: string | undefined;
  hostname: string | undefined;
  sysName: string | undefined;
  name: string | undefined;
} {
  return {
    ip: device.hostname,
    hostname: device.hostname,
    sysName: device.sysName,
    name: device.name,
  };
}

/*
 * How long "this project has no site-assignment rules at all" is trusted
 * without asking Postgres again.
 *
 * Every successful walk writes `sysName`, an identity column, so
 * onUpdateSuccess re-evaluates the rules for every device that has no site.
 * That rule is correct and stays (see shouldReapplySiteAssignmentRules), but
 * on a project mid-rollout — devices imported, rules not written yet — it is
 * EVERY device, and each one re-read the same empty rule set to conclude
 * nothing: a findOneById plus an uncached findBy per device per poll, i.e.
 * ~160,000 queries per five-minute cycle on an 80,000-device fleet.
 *
 * Ten seconds is measured against the thing a user would actually notice.
 * The earliest a newly saved rule can reach an already-imported device is
 * that device's next poll — five minutes by default — or the rule's "Run
 * now" button, which never consults this cache. Ten seconds is a rounding
 * error against that window, so this can never be the reason a rule looks
 * like it did not take.
 */
export const EMPTY_SITE_ASSIGNMENT_RULE_CACHE_TTL_IN_MS: number = 10 * 1000;

/*
 * Bounded so an instance serving many projects cannot grow this forever.
 * Only ever holds projects that had NO rules, so in practice it is small.
 */
const EMPTY_SITE_ASSIGNMENT_RULE_CACHE_MAX_PROJECTS: number = 10000;

/*
 * Remembers ONLY the negative answer: "this project had zero site-assignment
 * rules when we last looked."
 *
 * Deliberately not a cache of the rules themselves. A stale rule set causes a
 * WRONG WRITE — a device assigned to a site by a rule that was edited or
 * deleted seconds ago, and nothing ever moves it back — whereas a stale "no
 * rules" only defers work that the polling interval already defers by
 * minutes. The two failure modes are not comparable, so only the safe half is
 * cached.
 *
 * Every read of the rule set feeds `record`, so the instant any code path in
 * this process observes that the project does have rules, the skip is
 * dropped. Across replicas nothing is invalidated by another replica's write
 * — which is precisely why the TTL, not the invalidation, is the guarantee.
 */
export class EmptySiteAssignmentRuleCache {
  private knownEmptyUntil: Map<string, number> = new Map<string, number>();

  private ttlInMs: number;
  private maxProjects: number;
  private now: () => number;

  public constructor(options?: {
    ttlInMs?: number | undefined;
    maxProjects?: number | undefined;
    now?: (() => number) | undefined;
  }) {
    this.ttlInMs =
      options?.ttlInMs ?? EMPTY_SITE_ASSIGNMENT_RULE_CACHE_TTL_IN_MS;
    this.maxProjects =
      options?.maxProjects ?? EMPTY_SITE_ASSIGNMENT_RULE_CACHE_MAX_PROJECTS;
    /*
     * Wrapped rather than stored as `Date.now` itself, so moving the clock
     * (a test, or a future injected clock) is actually observed here.
     */
    this.now =
      options?.now ??
      ((): number => {
        return Date.now();
      });
  }

  public isKnownEmpty(projectId: ObjectID): boolean {
    const key: string = projectId.toString();
    const expiresAt: number | undefined = this.knownEmptyUntil.get(key);

    if (expiresAt === undefined) {
      return false;
    }

    if (expiresAt <= this.now()) {
      // Dropped on read, so an idle project's entry does not linger.
      this.knownEmptyUntil.delete(key);
      return false;
    }

    return true;
  }

  public record(data: { projectId: ObjectID; isEmpty: boolean }): void {
    const key: string = data.projectId.toString();

    if (!data.isEmpty) {
      this.knownEmptyUntil.delete(key);
      return;
    }

    if (
      this.knownEmptyUntil.size >= this.maxProjects &&
      !this.knownEmptyUntil.has(key)
    ) {
      // Evict the oldest — a Map iterates in insertion order.
      const oldestKey: string | undefined = this.knownEmptyUntil
        .keys()
        .next().value;

      if (oldestKey !== undefined) {
        this.knownEmptyUntil.delete(oldestKey);
      }
    }

    this.knownEmptyUntil.set(key, this.now() + this.ttlInMs);
  }

  public clear(): void {
    this.knownEmptyUntil.clear();
  }
}

export class Service extends DatabaseService<Model> {
  /*
   * The projects known to have no site-assignment rules. Exposed so tests can
   * reset it between cases, and so a future invalidation hook on
   * NetworkSiteAssignmentRuleService has something to call — note that such a
   * hook only clears the replica that ran the write, which is why the TTL
   * above is what actually bounds staleness.
   */
  public readonly emptySiteAssignmentRuleCache: EmptySiteAssignmentRuleCache =
    new EmptySiteAssignmentRuleCache();

  public constructor() {
    super(Model);
  }

  /**
   * The four numbers in the summary strip above the device list, in one
   * round trip and one SQL statement.
   *
   * The three status counts partition the fleet exactly — `isReachable` is
   * true, false, or NULL — which is what lets the strip agree with the rows
   * underneath it: the Status chip filters on the same column, so clicking a
   * tile opens exactly the devices it counted.
   *
   * `interfacesDown` is a real SUM over the whole fleet. It used to be
   * computed by fetching every device with a down interface and adding them
   * up in the browser, which was not only slow but WRONG past ten thousand
   * such devices — the fetch was capped, so the tile understated the fleet
   * without saying so.
   */
  @CaptureSpan()
  public async getFleetSummary(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DeviceFleetSummary> {
    const rows: Array<AggregateRow> = await this.aggregateBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
      },
      select: [
        {
          expression: `COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" = true)`,
          alias: "devicesUp",
        },
        {
          expression: `COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" = false)`,
          alias: "devicesDown",
        },
        {
          expression: `COUNT(*) FILTER (WHERE "NetworkDevice"."isReachable" IS NULL)`,
          alias: "devicesPending",
        },
        {
          expression: `COALESCE(SUM("NetworkDevice"."interfacesDown"), 0)`,
          alias: "interfacesDown",
        },
        {
          expression: `COUNT(*)`,
          alias: "totalDevices",
        },
        {
          expression: `COUNT(*) FILTER (WHERE "NetworkDevice"."siteId" IS NULL)`,
          alias: "devicesWithoutSite",
        },
      ],
      props: data.props,
    });

    const row: AggregateRow | undefined = rows[0];

    return {
      devicesUp: AggregateResultUtil.toNumber(row, "devicesUp"),
      devicesDown: AggregateResultUtil.toNumber(row, "devicesDown"),
      devicesPending: AggregateResultUtil.toNumber(row, "devicesPending"),
      interfacesDown: AggregateResultUtil.toNumber(row, "interfacesDown"),
      totalDevices: AggregateResultUtil.toNumber(row, "totalDevices"),
      devicesWithoutSite: AggregateResultUtil.toNumber(
        row,
        "devicesWithoutSite",
      ),
    };
  }

  /**
   * How many devices of each vendor, biggest first.
   *
   * `GROUP BY vendor` in the database rather than a Map built over every
   * device row in the browser. Unenriched devices — no SNMP walk yet, so no
   * vendor — group under the empty string here and are named by the caller,
   * because "Unknown" is a label rather than a fact about the row.
   */
  @CaptureSpan()
  public async getVendorBreakdown(data: {
    projectId: ObjectID;
    limit: number;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<{ vendor: string; count: number }>> {
    const rows: Array<AggregateRow> = await this.aggregateBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
      },
      groupBy: [
        {
          expression: `COALESCE(NULLIF(TRIM("NetworkDevice"."vendor"), ''), '')`,
          alias: "vendor",
        },
      ],
      select: [
        {
          expression: `COUNT(*)`,
          alias: "deviceCount",
        },
      ],
      orderBy: [
        // Ties break by name so the list is stable across refreshes.
        { expression: `"deviceCount"`, sortOrder: SortOrder.Descending },
        { expression: `"vendor"`, sortOrder: SortOrder.Ascending },
      ],
      limit: data.limit,
      props: data.props,
    });

    return rows.map((row: AggregateRow) => {
      return {
        vendor: AggregateResultUtil.toStringOrNull(row, "vendor") || "",
        count: AggregateResultUtil.toNumber(row, "deviceCount"),
      };
    });
  }

  /**
   * Which of these addresses already have a device in this project.
   *
   * Answers "is 10.4.2.17 already registered" for the few hundred hosts a
   * discovery sweep actually found, rather than by loading every hostname in
   * the project into a Set and asking the Set.
   *
   * That walk was not just expensive — it was WRONG in the exact scenario it
   * served. It paged `ORDER BY createdAt`, and a bulk discovery import stamps
   * every device it creates with the same `createdAt`: on a fleet of 80,000
   * devices, all 80,000 shared one value, so `LIMIT 10000 OFFSET n` over a
   * single-valued sort key returned an arbitrary, non-deterministic slice per
   * call. Pages overlapped and skipped, and a skipped hostname reads as "not
   * registered" — which creates a duplicate device, the very thing the paging
   * was added to prevent.
   *
   * `hostname` is indexed, so each chunk here is an index lookup.
   */
  @CaptureSpan()
  public async getRegisteredHostnames(data: {
    projectId: ObjectID;
    hostnames: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    return new Set<string>(
      (
        await this.getDevicesByHostnames({
          projectId: data.projectId,
          hostnames: data.hostnames,
          select: { hostname: true },
          props: data.props,
        })
      ).keys(),
    );
  }

  /**
   * The devices at these addresses, keyed by hostname.
   *
   * The row-returning form of `getRegisteredHostnames`, for callers that need
   * more than "does it exist" — the auto-import engine reads back the device's
   * id and monitoring method to decide whether it also needs a monitor
   * provisioned. Same chunked, indexed lookup; same reason for existing.
   */
  @CaptureSpan()
  public async getDevicesByHostnames(data: {
    projectId: ObjectID;
    hostnames: Array<string>;
    select: Select<Model>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Model>> {
    const registered: Map<string, Model> = new Map<string, Model>();

    const wanted: Array<string> = Array.from(
      new Set<string>(
        data.hostnames.filter((hostname: string): boolean => {
          return Boolean(hostname);
        }),
      ),
    );

    /*
     * Chunked, because the whole list becomes a literal `IN (...)` in the
     * statement text. A scan may cover tens of thousands of addresses
     * (ScanTargetUtil.MAX_SCAN_HOSTS), and a single IN list that long costs
     * more to parse and plan than the lookups it saves.
     */
    for (
      let offset: number = 0;
      offset < wanted.length;
      offset += HOSTNAME_LOOKUP_CHUNK_SIZE
    ) {
      const chunk: Array<string> = wanted.slice(
        offset,
        offset + HOSTNAME_LOOKUP_CHUNK_SIZE,
      );

      const found: Array<Model> = await this.findBy({
        query: {
          projectId: data.projectId,
          hostname: QueryHelper.any(chunk),
        },
        select: {
          ...data.select,
          hostname: true,
        },
        sort: {},
        limit: LIMIT_MAX,
        skip: 0,
        props: data.props,
      });

      for (const device of found) {
        if (device.hostname) {
          registered.set(device.hostname, device);
        }
      }
    }

    return registered;
  }

  /**
   * How many live devices are attached to each site in the project — one row
   * per site that has any, counted in the database.
   *
   * The Sites page's hierarchy tree used to work this out by fetching every
   * device in the project and tallying `siteId` in the browser. Capped at
   * LIMIT_PER_PROJECT, that is not slow so much as WRONG: on a fleet of
   * 80,000 devices across 1,188 sites it returned an arbitrary 10,000 of them
   * — no ORDER BY, so which 10,000 was up to Postgres — and every store in the
   * tree read "8 devices" when it had 65.
   *
   * Sites with no devices are simply absent, which is what the caller's
   * `count || 0` already assumed.
   */
  @CaptureSpan()
  public async getDeviceCountsBySite(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<{ siteId: string; deviceCount: number }>> {
    const rows: Array<AggregateRow> = await this.aggregateBy({
      query: {
        projectId: data.projectId,
        isArchived: false,
        siteId: QueryHelper.notNull(),
      },
      groupBy: [
        {
          expression: `"NetworkDevice"."siteId"`,
          alias: "siteId",
        },
      ],
      select: [
        {
          expression: `COUNT(*)`,
          alias: "deviceCount",
        },
      ],
      props: data.props,
    });

    const counts: Array<{ siteId: string; deviceCount: number }> = [];

    for (const row of rows) {
      const siteId: string | null = AggregateResultUtil.toStringOrNull(
        row,
        "siteId",
      );

      if (!siteId) {
        continue;
      }

      counts.push({
        siteId: siteId,
        deviceCount: AggregateResultUtil.toNumber(row, "deviceCount"),
      });
    }

    return counts;
  }

  /**
   * Device health, bucketed by the discriminating columns and broken down by
   * site — the input a per-site rollup needs, without reading the devices.
   *
   * The buckets are NOT verdicts: they are the raw facts
   * `DeviceHealthStateUtil` classifies, so the caller runs the one real
   * classifier over a few hundred buckets instead of eighty thousand rows.
   * See DeviceHealthAggregation for why the rule is not reimplemented in SQL.
   */
  @CaptureSpan()
  public async getHealthGroups(data: {
    projectId: ObjectID;
    // Restricts to devices attached to a site. Off by default.
    onlyAttachedToSite?: boolean | undefined;
    groupBySite: boolean;
    now: Date;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<DeviceHealthGroup>> {
    const query: Query<Model> = {
      projectId: data.projectId,
      isArchived: false,
    };

    if (data.onlyAttachedToSite) {
      query.siteId = QueryHelper.notNull();
    }

    const rows: Array<AggregateRow> = await this.aggregateBy({
      query: query,
      groupBy: data.groupBySite
        ? DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE
        : DEVICE_HEALTH_GROUP_COLUMNS,
      select: DEVICE_HEALTH_AGGREGATES,
      orderBy: DEVICE_HEALTH_GROUP_ORDER,
      parameters: {
        [DEVICE_HEALTH_NOW_PARAMETER]: data.now,
      },
      props: data.props,
    });

    return rows.map(parseDeviceHealthGroup);
  }

  /**
   * Health buckets for the devices attached to a specific set of sites — the
   * subtree read the persisted rollup engine runs on.
   *
   * Not broken down by site: the caller wants one verdict for the whole
   * subtree, so bucketing across all of it produces the fewest rows that can
   * still answer the question.
   */
  @CaptureSpan()
  public async getHealthGroupsForSites(data: {
    projectId: ObjectID;
    siteIds: Array<ObjectID>;
    /*
     * Whether each bucket is labelled with the site it came from. The site
     * rollup engine wants one verdict for the whole subtree and does not care
     * (fewer buckets); the hierarchy drill-down needs a breakdown per site.
     */
    groupBySite?: boolean | undefined;
    now: Date;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<DeviceHealthGroup>> {
    if (data.siteIds.length === 0) {
      return [];
    }

    const rows: Array<AggregateRow> = await this.aggregateBy({
      query: {
        projectId: data.projectId,
        siteId: QueryHelper.any(data.siteIds),
        isArchived: false,
      },
      groupBy: data.groupBySite
        ? DEVICE_HEALTH_GROUP_COLUMNS_BY_SITE
        : DEVICE_HEALTH_GROUP_COLUMNS,
      select: DEVICE_HEALTH_AGGREGATES,
      orderBy: DEVICE_HEALTH_GROUP_ORDER,
      parameters: {
        [DEVICE_HEALTH_NOW_PARAMETER]: data.now,
      },
      props: data.props,
    });

    return rows.map(parseDeviceHealthGroup);
  }

  /*
   * The provenance FK uses RESTRICT as a final race backstop: PostgreSQL must
   * never silently remove an active monitor with its device. An ordinary
   * service deletion therefore authorizes and resolves the exact device rows
   * first, then deletes their automatic monitors through MonitorService so
   * Monitor delete permissions, workspace cleanup, workflows, audit,
   * realtime, and billing hooks all run before the devices are removed.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const authorizedQuery: Query<Model> =
      await ModelPermission.checkDeleteQueryPermission(
        Model,
        deleteBy.query,
        deleteBy.props,
      );

    const devices: Array<Model> = await this.findBy({
      query: authorizedQuery,
      select: {
        _id: true,
        projectId: true,
      },
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: { isRoot: true },
    });

    const countAutomaticMonitors: (
      query: Query<Monitor>,
    ) => Promise<number> = async (query: Query<Monitor>): Promise<number> => {
      return (
        await MonitorService.countBy({
          query,
          props: { isRoot: true },
        })
      ).toNumber();
    };
    const cleanupPlans: Array<{
      automaticMonitorQuery: Query<Monitor>;
      monitorDeleteProps: DatabaseCommonInteractionProps;
      monitorCount: number;
    }> = [];

    /*
     * Preflight every device in the bulk request before deleting the first
     * monitor. Otherwise a later inaccessible device could abort the request
     * after earlier devices had already lost their automatic monitors.
     */
    for (const device of devices) {
      if (!device.id || !device.projectId) {
        continue;
      }

      const automaticMonitorQuery: Query<Monitor> = {
        projectId: device.projectId,
        autoProvisionedNetworkDeviceId: device.id,
      };
      const monitorDeleteProps: DatabaseCommonInteractionProps = {
        ...deleteBy.props,
        tenantId: device.projectId,
      };
      const monitorCount: number = await countAutomaticMonitors(
        automaticMonitorQuery,
      );

      if (monitorCount === 0) {
        continue;
      }

      /*
       * Prove access BEFORE deleting anything. Without this preflight an
       * access-control query could delete only the monitors visible to the
       * caller before the RESTRICT constraint rejects the device deletion,
       * leaving a partially cleaned-up request. The authorized query is a
       * subset of automaticMonitorQuery, so equal counts prove that it covers
       * the full set at this instant.
       */
      const authorizedMonitorQuery: Query<Monitor> =
        await ModelPermission.checkDeleteQueryPermission(
          Monitor,
          automaticMonitorQuery,
          monitorDeleteProps,
        );
      const authorizedMonitorCount: number = await countAutomaticMonitors(
        authorizedMonitorQuery,
      );

      if (authorizedMonitorCount !== monitorCount) {
        throw new NotAuthorizedException(
          "You do not have permission to delete every auto-provisioned monitor linked to this Network Device.",
        );
      }

      cleanupPlans.push({
        automaticMonitorQuery,
        monitorDeleteProps,
        monitorCount,
      });
    }

    for (const cleanupPlan of cleanupPlans) {
      /*
       * LIMIT_MAX is a per-service-call cap, not a lifecycle cap. Always
       * delete from offset zero because each successful batch shrinks the
       * result set. Recount as root after every batch: a permission change or
       * concurrent inaccessible insert must fail closed, with the FK's
       * RESTRICT policy remaining the last guard before device deletion.
       */
      let remainingMonitorCount: number = cleanupPlan.monitorCount;
      while (remainingMonitorCount > 0) {
        await MonitorService.deleteBy({
          query: cleanupPlan.automaticMonitorQuery,
          limit: LIMIT_MAX,
          skip: 0,
          props: cleanupPlan.monitorDeleteProps,
        });

        const previousMonitorCount: number = remainingMonitorCount;
        remainingMonitorCount = await countAutomaticMonitors(
          cleanupPlan.automaticMonitorQuery,
        );

        if (remainingMonitorCount >= previousMonitorCount) {
          throw new NotAuthorizedException(
            "Could not delete every auto-provisioned monitor linked to this Network Device.",
          );
        }
      }
    }

    return {
      deleteBy: {
        ...deleteBy,
        query: {
          _id: QueryHelper.any(
            devices.flatMap((device: Model): Array<ObjectID> => {
              return device.id ? [device.id] : [];
            }),
          ),
        },
        skip: 0,
      },
      carryForward: null,
    };
  }

  /*
   * The FK behind siteId only requires the NetworkSite row to exist, not that
   * it belongs to the device's project. Without this check a tenant can point
   * a device at another project's site and make onUpdateSuccess drive rollup
   * writes there under root props. Mirrors the parentSiteId guard in
   * NetworkSiteService.onBeforeCreate.
   */
  private async assertSiteBelongsToProject(data: {
    siteId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const site: NetworkSite | null = await NetworkSiteService.findOneById({
      id: data.siteId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!site) {
      throw new BadDataException("Network site not found.");
    }

    if (
      site.projectId &&
      site.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "Network site must belong to the same project.",
      );
    }
  }

  /*
   * Same hole as siteId, and it matters more here: the FK behind
   * oidTemplateId only requires the row to exist, not that it belongs to the
   * device's project. Tenant scoping is applied to the ROOT query only, so a
   * device pointed at another project's template would leak that template's
   * name and OID list through every nested `select: { oidTemplate: ... }` the
   * dashboard makes - and the poll would ship those OIDs to this project's
   * probe. Refuse the link at the point it is written, rather than auditing
   * it afterwards at poll time.
   */
  private async assertOidTemplateBelongsToProject(data: {
    oidTemplateId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const oidTemplate: NetworkDeviceOidTemplate | null =
      await NetworkDeviceOidTemplateService.findOneById({
        id: data.oidTemplateId,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!oidTemplate) {
      throw new BadDataException("OID Collection Template not found.");
    }

    if (
      oidTemplate.projectId &&
      oidTemplate.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "OID Collection Template must belong to the same project.",
      );
    }
  }

  /*
   * onBeforeUpdate runs before DatabaseService permission-checks the query,
   * so reading the raw client query as root would hand the hook rows from
   * other projects. Re-apply the caller's tenant here.
   */
  private scopeQueryToCallerTenant(
    query: Query<Model>,
    props: DatabaseCommonInteractionProps,
  ): Query<Model> {
    if (props.isRoot || !props.tenantId) {
      return query;
    }

    return {
      ...query,
      projectId: props.tenantId,
    };
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Read both spellings: the dashboard posts the `site` relation, not the
     * `siteId` column, so guarding only `siteId` let a UI-created device
     * point at another project's site.
     */
    const siteId: ObjectID | null = readSiteIdFromData(
      createBy.data as unknown as Record<string, unknown>,
    );

    if (siteId) {
      await this.assertSiteBelongsToProject({
        siteId: siteId,
        projectId: createBy.data.projectId,
      });
    }

    const createOidTemplateId: ObjectID | null = readOidTemplateIdFromData(
      createBy.data as unknown as Record<string, unknown>,
    );

    if (createOidTemplateId) {
      await this.assertOidTemplateBelongsToProject({
        oidTemplateId: createOidTemplateId,
        projectId: createBy.data.projectId,
      });
    }

    if (createBy.data.snmpOids !== undefined) {
      // Same budget rule as onBeforeUpdate: the tight cap is what linking costs.
      createBy.data.snmpOids = SnmpOidListUtil.validateOidList(
        createBy.data.snmpOids,
        {
          max: createOidTemplateId
            ? MAX_DEVICE_SPECIFIC_OIDS
            : MAX_EFFECTIVE_OIDS_PER_DEVICE,
          label: "Device-Specific Health OIDs",
        },
      );
    }

    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        createBy.data.monitoringMethod,
      )
    ) {
      const monitorId: ObjectID | null = readMonitorIdFromData(
        createBy.data as unknown as Record<string, unknown>,
      );

      /*
       * The monitor is NOT required here, though the create form asks for
       * one. Discovery import is why: a subnet sweep finds ping-only hosts
       * in bulk and there is no monitor to bind them to yet. Such a device
       * is still worth recording — it belongs to a site, carries labels, and
       * appears on the topology map — and its status reads "pending", which
       * is exactly true until somebody points a monitor at it.
       */
      if (monitorId) {
        await this.assertMonitorBelongsToProject({
          monitorId: monitorId,
          projectId: createBy.data.projectId,
        });
      }

      /*
       * Not a preference: a monitor-backed device has no probe and no
       * credentials, so leaving polling on would queue a walk that can only
       * ever fail. claimDevicesForPolling refuses these rows too — this is
       * the half that keeps the column honest for anything reading it.
       */
      createBy.data.isPollingEnabled = false;
    }

    return { createBy, carryForward: null };
  }

  /*
   * The FK behind monitorId only requires the Monitor row to exist, not that
   * it belongs to the device's project — the same hole assertSiteBelongsToProject
   * closes for sites. Without this a tenant could bind a device to another
   * project's monitor and read its status through the device.
   */
  @CaptureSpan()
  private async assertMonitorBelongsToProject(data: {
    monitorId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: {
        _id: data.monitorId,
        projectId: data.projectId,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!monitor) {
      throw new BadDataException("Monitor not found.");
    }
  }

  /*
   * Owner/label rules fire whenever a device is created — manually or via
   * subnet discovery import. Applied out-of-band: rule failures must never
   * fail device creation. Site auto-assignment rides the same chain: a
   * device created without a site is matched against the project's
   * NetworkSiteAssignmentRules, and a device created directly into a site
   * refreshes that site's rollup.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await NetworkDeviceLabelRuleEngineService.applyRulesToNetworkDevice(
            createdItem,
          );
        })
        .then(async () => {
          await NetworkDeviceOwnerRuleEngineService.applyRulesToNetworkDevice(
            createdItem,
          );
        })
        .then(async () => {
          /*
           * `site` (relation) or `siteId` (column) - a device created from
           * the dashboard carries only the former.
           */
          const createdSiteId: ObjectID | null =
            createdItem.siteId || createdItem.site?.id || null;

          if (createdSiteId) {
            await NetworkSiteService.recomputeRollupForSiteAndAncestors(
              createdSiteId,
            );
          } else {
            await this.applySiteAssignmentRulesToDevice(createdItem.id!);
          }
        })
        .then(async () => {
          /*
           * A device created monitor-backed adopts its monitor's CURRENT
           * status right away rather than waiting for that monitor's next
           * status CHANGE. Skipped for SNMP devices, which are judged by
           * their own walk.
           */
          if (
            NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
              createdItem.monitoringMethod,
            )
          ) {
            await this.refreshStampedMonitorStatus({
              deviceId: createdItem.id!,
              clearWhenNotMonitorBacked: false,
            });
          }
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying network device rules in NetworkDeviceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              networkDeviceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  /*
   * Capture the previous state of every matched device when an update
   * touches siteId (so onUpdateSuccess can refresh the OLD site's rollup as
   * well as the new one) or touches one of the columns site assignment rules
   * match on (so onUpdateSuccess can tell a real rename from the identical
   * sysName the SNMP walk rewrites on every poll).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    /*
     * Switching a device to monitor-backed turns polling off with it. The
     * two are one decision, not two: a device with no probe and no
     * credentials cannot be walked, so leaving the flag on would queue a
     * walk per interval that can only fail and then paint the device down.
     */
    const isMethodWrite: boolean = dataKeys.includes("monitoringMethod");
    /*
     * An update payload is a QueryDeepPartialEntity, so a column can hold a
     * raw value OR a SQL-expression function. Only a plain string is a
     * method we can reason about; anything else falls through to the SNMP
     * default, which changes nothing.
     */
    const writtenMethod: unknown = (
      updateBy.data as unknown as Record<string, unknown>
    )["monitoringMethod"];
    const becomesMonitorBacked: boolean =
      isMethodWrite &&
      typeof writtenMethod === "string" &&
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(writtenMethod);

    if (becomesMonitorBacked) {
      updateBy.data.isPollingEnabled = false;
    }

    /*
     * Turning polling back ON is the other direction, and it has to be
     * refused rather than quietly ignored: claimDevicesForPolling skips
     * monitor-backed rows whatever this column says, so a device left with
     * the flag on would read "polling enabled" in the UI forever while
     * nothing ever polled it. Only checked when the payload actually asks
     * for it, so the ordinary update path costs no extra query.
     */
    if (
      !becomesMonitorBacked &&
      dataKeys.includes("isPollingEnabled") &&
      updateBy.data.isPollingEnabled === true
    ) {
      const targets: Array<Model> = await this.findBy({
        query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
        select: {
          _id: true,
          monitoringMethod: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const isTargetMonitorBacked: boolean = targets.some((target: Model) => {
        return NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
          target.monitoringMethod,
        );
      });

      // Unless the same write is moving it back to SNMP, which is allowed.
      if (isTargetMonitorBacked && !(isMethodWrite && !becomesMonitorBacked)) {
        throw new BadDataException(
          "This device is monitor-backed, so there is nothing to poll — it has no probe and no SNMP credentials. Switch its monitoring method to SNMP first.",
        );
      }
    }

    const isSiteChange: boolean = isSiteWrite(dataKeys);
    const isIdentityChange: boolean = SITE_RULE_IDENTITY_COLUMNS.some(
      (column: string) => {
        return dataKeys.includes(column);
      },
    );
    /*
     * The OID writes have to get past this return too, and that is the whole
     * reason they are named here.
     *
     * The early return exists so a write that changes neither site nor
     * identity skips a read it does not need — but linking a template and
     * editing snmpOids are EXACTLY such writes, so a guard placed below the
     * return would be dead code on the only path it exists for. Both need the
     * read: the tenancy check needs each matched device's projectId, and the
     * OID cap needs to know whether the device is linked to a template.
     *
     * `!== undefined` rather than truthiness for the OID list: every poll
     * writes device columns through this path (NetworkInventoryUtil), and an
     * explicit empty array is a legitimate "collect nothing device-specific"
     * edit.
     */
    const isOidTemplateChange: boolean = RelationIdUtil.isWritten(
      dataKeys,
      OID_TEMPLATE_KEYS,
    );
    const isDeviceOidsChange: boolean = updateBy.data.snmpOids !== undefined;

    if (
      !isSiteChange &&
      !isIdentityChange &&
      !isOidTemplateChange &&
      !isDeviceOidsChange
    ) {
      return { updateBy, carryForward: null };
    }

    const previousDevices: Array<Model> = await this.findBy({
      query: this.scopeQueryToCallerTenant(updateBy.query, updateBy.props),
      select: {
        _id: true,
        projectId: true,
        siteId: true,
        hostname: true,
        name: true,
        sysName: true,
        // Decide which OID budget applies below, and whether a link would truncate.
        oidTemplateId: true,
        snmpOids: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const newSiteId: ObjectID | null = readSiteIdFromData(
      updateBy.data as unknown as Record<string, unknown>,
    );

    if (newSiteId) {
      const checkedProjectIds: Set<string> = new Set();

      for (const previousDevice of previousDevices) {
        if (
          !previousDevice.projectId ||
          checkedProjectIds.has(previousDevice.projectId.toString())
        ) {
          continue;
        }
        checkedProjectIds.add(previousDevice.projectId.toString());

        await this.assertSiteBelongsToProject({
          siteId: newSiteId,
          projectId: previousDevice.projectId,
        });
      }
    }

    const newOidTemplateId: ObjectID | null = readOidTemplateIdFromData(
      updateBy.data as unknown as Record<string, unknown>,
    );

    /*
     * Same shape as the site guard above: one check per distinct project in
     * the matched set, because a single updateBy can span devices from more
     * than one project when a root caller issues it.
     */
    if (newOidTemplateId) {
      const checkedTemplateProjectIds: Set<string> = new Set();

      for (const previousDevice of previousDevices) {
        if (
          !previousDevice.projectId ||
          checkedTemplateProjectIds.has(previousDevice.projectId.toString())
        ) {
          continue;
        }
        checkedTemplateProjectIds.add(previousDevice.projectId.toString());

        await this.assertOidTemplateBelongsToProject({
          oidTemplateId: newOidTemplateId,
          projectId: previousDevice.projectId,
        });
      }
    }

    /*
     * How many OIDs a device may carry of its own.
     *
     * The tight budget is a consequence of ADOPTING a template, not a
     * retroactive limit on every device that already exists. A device with no
     * template collects only its own list, so its ceiling is the full
     * per-device budget; the moment it links to one, template plus
     * device-specific has to fit inside that same ceiling, and the
     * device-specific half is what gives.
     *
     * Enforcing the tight budget unconditionally would have been hostile in
     * exactly the wrong direction: a device that predates this feature, with a
     * long hand-built list, could no longer save ANY polling setting — the
     * fleet in issue #3507 being the likeliest example.
     */
    /*
     * Linking a device whose STORED list already exceeds the device-specific
     * budget would leave the merge over the effective ceiling, and truncation
     * drops from the end — so the operator's own OIDs would silently stop
     * being polled, on a write that never mentioned them. Refuse the link and
     * say what to trim, rather than accepting it and losing data at poll time.
     */
    if (isOidTemplateChange && newOidTemplateId && !isDeviceOidsChange) {
      for (const previousDevice of previousDevices) {
        const storedOidCount: number = (previousDevice.snmpOids || []).length;

        if (storedOidCount > MAX_DEVICE_SPECIFIC_OIDS) {
          throw new BadDataException(
            `This device has ${storedOidCount} device-specific Health OIDs, and a device linked to an OID Collection Template may keep at most ${MAX_DEVICE_SPECIFIC_OIDS} of its own. Remove ${storedOidCount - MAX_DEVICE_SPECIFIC_OIDS} of them - or move them onto the template - before linking it.`,
          );
        }
      }
    }

    if (isDeviceOidsChange) {
      const becomesLinked: boolean = isOidTemplateChange
        ? Boolean(newOidTemplateId)
        : previousDevices.some((previousDevice: Model) => {
            return Boolean(previousDevice.oidTemplateId);
          });

      updateBy.data.snmpOids = SnmpOidListUtil.validateOidList(
        updateBy.data.snmpOids as Array<SnmpOid>,
        {
          max: becomesLinked
            ? MAX_DEVICE_SPECIFIC_OIDS
            : MAX_EFFECTIVE_OIDS_PER_DEVICE,
          label: "Device-Specific Health OIDs",
        },
      );
    }

    return {
      updateBy,
      carryForward: {
        previousDevices: previousDevices,
      },
    };
  }

  /*
   * Re-derives one device's stamped `currentMonitorStatusId` from its
   * binding, and refreshes its site chain if the stamp moved.
   *
   * The stamp is what every monitor-backed surface reads — the device list
   * pill, the site rollup, the topology node — and until this existed the
   * ONLY thing that ever wrote it was
   * `NetworkSiteService.onMonitorStatusChanged`, which fires on a monitor's
   * next status CHANGE. Bind a device to a Ping monitor that is already Up
   * and staying Up and nothing writes the stamp at all, so the device sits
   * on "Pending" until the monitor happens to go down — which is
   * OneUptime/oneuptime#3392. Binding is itself an event that decides the
   * device's status, so it stamps here.
   *
   * `clearWhenNotMonitorBacked` is for the write that moves a device OFF
   * monitor-backed: the ping monitor's verdict must not outlive the binding
   * (DeviceHealthStateUtil lets a stamped status beat reachability, so a
   * stale one would poison the site rollup of a device that is now walked).
   * It is deliberately NOT set when a write only touches the monitor
   * binding of an SNMP device, because an SNMP device's stamp comes from
   * the Network Device monitor that watches it, and that binding lives in
   * the monitor's step data rather than in this column.
   */
  @CaptureSpan()
  public async refreshStampedMonitorStatus(data: {
    deviceId: ObjectID;
    clearWhenNotMonitorBacked: boolean;
  }): Promise<void> {
    const device: Model | null = await this.findOneById({
      id: data.deviceId,
      select: {
        _id: true,
        projectId: true,
        siteId: true,
        monitoringMethod: true,
        monitorId: true,
        currentMonitorStatusId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!device || !device.projectId) {
      return;
    }

    const isMonitorBacked: boolean =
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        device.monitoringMethod,
      );

    if (!isMonitorBacked && !data.clearWhenNotMonitorBacked) {
      return;
    }

    let monitorStatusId: ObjectID | null = null;

    if (isMonitorBacked && device.monitorId) {
      /*
       * Scoped to the device's project on the read as well as on the write
       * path in onBeforeCreate/onBeforeUpdate: a monitor from another
       * tenant must never be able to stamp a status here.
       */
      const monitor: Monitor | null = await MonitorService.findOneBy({
        query: {
          _id: device.monitorId,
          projectId: device.projectId,
        },
        select: {
          _id: true,
          currentMonitorStatusId: true,
        },
        props: {
          isRoot: true,
        },
      });

      monitorStatusId = monitor?.currentMonitorStatusId || null;
    }

    const currentStampId: string | null =
      device.currentMonitorStatusId?.toString() || null;
    const nextStampId: string | null = monitorStatusId?.toString() || null;

    if (currentStampId === nextStampId) {
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.deviceId,
      data: {
        currentMonitorStatusId: monitorStatusId,
      },
    });

    if (device.siteId) {
      await NetworkSiteService.recomputeRollupForSiteAndAncestors(
        device.siteId,
      );
    }
  }

  /*
   * Site maintenance after device updates. Resilient by design: a rollup
   * or rule-engine failure must never fail the device update itself.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Re-stamp before the site maintenance below, and in its own try: the
     * two are independent, and a rollup failure must not cost the device
     * its status (nor the other way round).
     */
    try {
      const dataKeys: Array<string> = Object.keys(onUpdate.updateBy.data || {});
      const isMethodWrite: boolean = dataKeys.includes("monitoringMethod");
      const isMonitorWrite: boolean = RelationIdUtil.isWritten(
        dataKeys,
        MONITOR_KEYS,
      );

      if (isMethodWrite || isMonitorWrite) {
        for (const deviceId of updatedItemIds) {
          await this.refreshStampedMonitorStatus({
            deviceId: deviceId,
            clearWhenNotMonitorBacked: isMethodWrite,
          });
        }
      }
    } catch (error) {
      logger.error(
        `Error in NetworkDeviceService.onUpdateSuccess monitor status refresh: ${error}`,
      );
    }

    try {
      const dataKeys: Array<string> = Object.keys(onUpdate.updateBy.data || {});

      if (isSiteWrite(dataKeys)) {
        // Manual or rule-driven site change: refresh old + new site chains.
        const affectedSiteIds: Map<string, ObjectID> = new Map();

        const previousDevices: Array<Model> =
          (onUpdate.carryForward?.previousDevices as Array<Model>) || [];

        /*
         * onUpdateSuccess runs even when the permission-scoped UPDATE matched
         * nothing, so only devices the UPDATE actually touched may drive
         * rollup writes.
         */
        const updatedIds: Set<string> = new Set(
          updatedItemIds.map((id: ObjectID) => {
            return id.toString();
          }),
        );

        for (const previousDevice of previousDevices) {
          if (
            !previousDevice.id ||
            !updatedIds.has(previousDevice.id.toString())
          ) {
            continue;
          }

          if (previousDevice.siteId) {
            affectedSiteIds.set(
              previousDevice.siteId.toString(),
              previousDevice.siteId,
            );
          }
        }

        const newSiteId: ObjectID | null = readSiteIdFromData(
          onUpdate.updateBy.data as unknown as Record<string, unknown>,
        );
        if (newSiteId && updatedItemIds.length > 0) {
          affectedSiteIds.set(newSiteId.toString(), newSiteId);
        }

        for (const siteId of affectedSiteIds.values()) {
          await NetworkSiteService.recomputeRollupForSiteAndAncestors(siteId);
        }
      } else if (
        SITE_RULE_IDENTITY_COLUMNS.some((column: string) => {
          return dataKeys.includes(column);
        })
      ) {
        /*
         * The device's address or name changed, so subnet/hostname rules may
         * now resolve differently — re-evaluate each updated device whose
         * identity actually moved (or that has no site yet).
         */
        const previousDevicesById: Map<string, Model> = new Map();

        const previousDevices: Array<Model> =
          (onUpdate.carryForward?.previousDevices as Array<Model>) || [];

        for (const previousDevice of previousDevices) {
          if (previousDevice.id) {
            previousDevicesById.set(
              previousDevice.id.toString(),
              previousDevice,
            );
          }
        }

        for (const deviceId of updatedItemIds) {
          const previousDevice: Model | undefined = previousDevicesById.get(
            deviceId.toString(),
          );

          if (
            previousDevice &&
            !this.shouldReapplySiteAssignmentRules(
              previousDevice,
              onUpdate.updateBy.data as Record<string, unknown>,
            )
          ) {
            continue;
          }

          /*
           * The previous snapshot already carries the device's project, so
           * hand it over: it lets a project with no rules at all skip both
           * the device read and the rule read, which is the whole cost of
           * this branch for a fleet that has not been given rules yet.
           *
           * ...but ONLY for a device with no site, and that distinction is
           * the whole safety of the skip. Those devices are re-evaluated on
           * every poll, so a skip there defers work by one cycle and the next
           * poll picks it up. A device that already HAS a site is re-evaluated
           * only when its identity actually changed — a one-shot event, not a
           * retry. Skipping that is not a deferral, it is a LOSS: the rename
           * never happens again, the device keeps its old site indefinitely,
           * and nothing says so. Ten seconds of staleness is a fine price for
           * a deferral and an unacceptable one for a loss, so the identity
           * path always reads the rules.
           */
          await this.applySiteAssignmentRulesToDevice(
            deviceId,
            previousDevice?.siteId ? undefined : previousDevice?.projectId,
          );
        }
      }
    } catch (error) {
      logger.error(
        `Error in NetworkDeviceService.onUpdateSuccess site maintenance: ${error}`,
      );
    }

    return onUpdate;
  }

  /*
   * True when an update that touched an identity column is worth re-running
   * the assignment rules for.
   *
   * A device with no site is always re-evaluated: rules are usually written
   * (or corrected) after the devices were imported, and the SNMP walk is the
   * only thing that ever touches such a device again — without this, a
   * matching rule would never reach it. Assigning a site to a device that has
   * none cannot undo a human's choice.
   *
   * A device that already sits in a site is only re-evaluated when its
   * identity really changed, so the sysName the walk rewrites verbatim every
   * polling cycle does not keep dragging a manually placed device back to
   * whatever a rule prefers.
   */
  private shouldReapplySiteAssignmentRules(
    previousDevice: Model,
    data: Record<string, unknown>,
  ): boolean {
    if (!previousDevice.siteId) {
      return true;
    }

    const dataKeys: Array<string> = Object.keys(data || {});

    return SITE_RULE_IDENTITY_COLUMNS.some((column: string) => {
      if (!dataKeys.includes(column)) {
        return false;
      }

      return (
        normalizeIdentityValue(data[column]) !==
        normalizeIdentityValue((previousDevice as any)[column])
      );
    });
  }

  /*
   * Matches one device against the project's NetworkSiteAssignmentRules
   * (highest priority wins) and assigns the winning site. The assignment
   * goes through updateOneById so onUpdateSuccess refreshes the rollups of
   * both the old and the new site.
   */
  @CaptureSpan()
  public async applySiteAssignmentRulesToDevice(
    deviceId: ObjectID,
    /*
     * The device's project, when the caller already knows it AND the call is
     * one that will happen again if it is skipped. Purely an optimisation,
     * and only ever a SKIP: it lets the known-empty check run before the
     * device read, so a project with no rules costs nothing per poll.
     *
     * Leaving it out gets the unconditional, always-fresh path, and two
     * callers deliberately do: device creation (a rule saved moments ago must
     * apply to the device being imported right now) and the identity-change
     * branch of onUpdateSuccess (a one-shot event — see the note there).
     */
    projectId?: ObjectID | undefined,
  ): Promise<void> {
    if (
      projectId &&
      this.emptySiteAssignmentRuleCache.isKnownEmpty(projectId)
    ) {
      return;
    }

    const device: Model | null = await this.findOneById({
      id: deviceId,
      select: {
        _id: true,
        projectId: true,
        siteId: true,
        hostname: true,
        sysName: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!device || !device.id || !device.projectId) {
      return;
    }

    const rules: Array<NetworkSiteAssignmentRule> =
      await NetworkSiteAssignmentRuleService.findBy({
        query: {
          projectId: device.projectId,
        },
        select: {
          _id: true,
          siteId: true,
          subnetCidr: true,
          hostnamePattern: true,
          priority: true,
          createdAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    /*
     * Feed the answer back either way: an empty set starts (or renews) the
     * skip, and a non-empty one cancels it immediately — so a project that
     * gains its first rule stops being skipped on this replica as soon as
     * anything here looks at the rules, without waiting for the TTL.
     */
    this.emptySiteAssignmentRuleCache.record({
      projectId: device.projectId,
      isEmpty: rules.length === 0,
    });

    if (rules.length === 0) {
      return;
    }

    /*
     * `name` is matched on as well as `hostname` because a discovery import
     * puts the responding IP in `hostname` and the device's real identity in
     * `name`, so a hostname pattern that only ever saw `hostname` could not
     * match anything a user recognises. See toRuleMatchTarget.
     */
    const winner: NetworkSiteAssignmentRule | null = CidrMatchUtil.pickRule(
      rules,
      toRuleMatchTarget(device),
    );

    if (!winner || !winner.siteId) {
      return;
    }

    if (
      device.siteId &&
      device.siteId.toString() === winner.siteId.toString()
    ) {
      return;
    }

    await this.updateOneById({
      id: device.id,
      data: {
        siteId: winner.siteId,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Runs ONE assignment rule against the devices that already exist, which is
   * the half the automatic path cannot do: rules only ever fire on create, on
   * an identity change, or on the next poll of a device that has no site, so
   * a rule written after the estate was imported would never reach it
   * (OneUptime/oneuptime#3191).
   *
   * Two rules of the automatic path are kept deliberately:
   *
   *   - priority still decides. A device this rule matches but a
   *     higher-priority rule also matches is REPORTED, not moved: running one
   *     rule must never quietly do another rule's work, or the button would
   *     produce a placement no rule alone explains.
   *   - a device already in a site is left alone unless the caller explicitly
   *     asks otherwise. Nothing records whether a site was chosen by a human
   *     or by a rule, so overwriting is the caller's decision to make, with
   *     the warning that goes with it — and it is not needed for the case the
   *     button exists for, since a device imported before the rule existed
   *     has no site at all.
   */
  @CaptureSpan()
  public async applySiteAssignmentRuleToExistingDevices(data: {
    ruleId: ObjectID;
    projectId: ObjectID;
    reassignDevicesAlreadyInASite: boolean;
  }): Promise<SiteAssignmentRuleRunResult> {
    /*
     * Every rule in the project, not just the one being run — pickRule needs
     * the whole set to answer "does something outrank this rule here?".
     * Loading them by project is also what scopes the run to the tenant: a
     * rule id from another project simply is not in this list.
     */
    const rules: Array<NetworkSiteAssignmentRule> =
      await NetworkSiteAssignmentRuleService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          siteId: true,
          subnetCidr: true,
          hostnamePattern: true,
          priority: true,
          createdAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    /*
     * Read fresh above and never from the negative cache: this is the button
     * an operator presses right after saving a rule, so it must see the rule
     * it was pressed for. Recording the answer here also means pressing it
     * lifts any "no rules" skip the poll path had cached for the project.
     */
    this.emptySiteAssignmentRuleCache.record({
      projectId: data.projectId,
      isEmpty: rules.length === 0,
    });

    const rule: NetworkSiteAssignmentRule | undefined = rules.find(
      (candidate: NetworkSiteAssignmentRule) => {
        return candidate._id?.toString() === data.ruleId.toString();
      },
    );

    if (!rule) {
      throw new BadDataException("Assignment rule not found.");
    }

    if (!rule.siteId) {
      throw new BadDataException(
        "This assignment rule has no site to assign devices to.",
      );
    }

    const ruleSiteId: ObjectID = rule.siteId;

    const result: SiteAssignmentRuleRunResult = {
      devicesEvaluated: 0,
      devicesMatched: 0,
      devicesAssigned: 0,
      devicesAlreadyInRuleSite: 0,
      devicesSkippedAlreadyInAnotherSite: 0,
      devicesClaimedByHigherPriorityRule: 0,
      devicesFailed: 0,
      isTruncated: false,
    };

    let skip: number = 0;

    for (;;) {
      const devices: Array<Model> = await this.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          siteId: true,
          hostname: true,
          sysName: true,
          name: true,
        },
        /*
         * Sorted by id so paging stays stable while the run writes to the
         * very rows it is paging over. Assigning a site never changes an id,
         * so no device can be skipped or seen twice.
         */
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: RULE_RUN_PAGE_SIZE,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      if (devices.length === 0) {
        break;
      }

      for (const device of devices) {
        result.devicesEvaluated++;

        const target: ReturnType<typeof toRuleMatchTarget> =
          toRuleMatchTarget(device);

        if (!CidrMatchUtil.ruleMatches(rule, target)) {
          continue;
        }

        result.devicesMatched++;

        if (device.siteId?.toString() === ruleSiteId.toString()) {
          result.devicesAlreadyInRuleSite++;
          continue;
        }

        if (device.siteId && !data.reassignDevicesAlreadyInASite) {
          result.devicesSkippedAlreadyInAnotherSite++;
          continue;
        }

        const winner: NetworkSiteAssignmentRule | null = CidrMatchUtil.pickRule(
          rules,
          target,
        );

        if (winner?._id?.toString() !== rule._id?.toString()) {
          result.devicesClaimedByHigherPriorityRule++;
          continue;
        }

        /*
         * Counted as a failure rather than skipped silently: every matched
         * device has to land in exactly one bucket, or the summary the
         * operator reads would not add up.
         */
        if (!device.id) {
          result.devicesFailed++;
          continue;
        }

        /*
         * Through updateOneById, not a bulk UPDATE: onUpdateSuccess is what
         * refreshes the rollups of the site the device left and the site it
         * joined, and a raw write would leave both stale.
         */
        try {
          await this.updateOneById({
            id: device.id,
            data: {
              siteId: ruleSiteId,
            },
            props: {
              isRoot: true,
            },
          });

          result.devicesAssigned++;
        } catch (error) {
          // One unhappy device must not abandon the rest of the estate.
          result.devicesFailed++;
          logger.error(
            `Error assigning site from assignment rule ${data.ruleId.toString()} to device ${device.id.toString()}: ${error}`,
            {
              projectId: data.projectId.toString(),
              networkDeviceId: device.id.toString(),
            } as LogAttributes,
          );
        }
      }

      skip += devices.length;

      if (devices.length < RULE_RUN_PAGE_SIZE) {
        break;
      }

      if (skip >= MAX_DEVICES_PER_RULE_RUN) {
        /*
         * A full last page does not prove there is an eleventh thousand of
         * devices — an estate of exactly the cap would report a truncation
         * that never happened, and the UI would tell the user to run it
         * again forever. One row is enough to settle it.
         */
        const nextDevice: Array<Model> = await this.findBy({
          query: {
            projectId: data.projectId,
          },
          select: {
            _id: true,
          },
          sort: {
            _id: SortOrder.Ascending,
          },
          limit: 1,
          skip: skip,
          props: {
            isRoot: true,
          },
        });

        result.isTruncated = nextDevice.length > 0;
        break;
      }
    }

    return result;
  }

  /*
   * Atomically claims the devices this probe should poll now and advances
   * each device's nextPollAt by its own polling interval — the device-owned
   * twin of MonitorProbeService.claimMonitorProbesForProbing. FOR UPDATE
   * SKIP LOCKED keeps horizontally-scaled probe ingest instances from
   * handing the same device to two pollers.
   *
   * Suspended projects are skipped for the same reason monitor claiming
   * skips them; archived devices keep polling on purpose ("archived devices
   * keep collecting telemetry").
   */
  @CaptureSpan()
  public async claimDevicesForPolling(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const currentDate: Date = OneUptimeDate.getCurrentDate();

    const claimedIds: Array<ObjectID> = await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const selectQuery: string = `
        SELECT nd."_id", nd."pollingIntervalInMinutes"
        FROM "NetworkDevice" nd
        INNER JOIN "Project" p ON nd."projectId" = p."_id"
        WHERE nd."probeId" = $1
          AND nd."isPollingEnabled" = true
          AND nd."deletedAt" IS NULL
          AND nd."hostname" IS NOT NULL
          -- A monitor-backed device has no credentials to walk with. NULL is
          -- every device created before the column existed: those are SNMP.
          AND (nd."monitoringMethod" IS NULL OR nd."monitoringMethod" <> 'Monitor')
          AND nd."nextPollAt" <= $2
          AND p."deletedAt" IS NULL
          AND (p."paymentProviderSubscriptionStatus" IS NULL
               OR p."paymentProviderSubscriptionStatus" IN ('active', 'trialing'))
          AND (p."paymentProviderMeteredSubscriptionStatus" IS NULL
               OR p."paymentProviderMeteredSubscriptionStatus" IN ('active', 'trialing'))
        -- Plain ASC, which is the order the (probeId, nextPollAt) btree is
        -- already in, so this is a range scan that stops at LIMIT rather than
        -- a scan-and-sort of the probe's whole slice of the fleet. See the
        -- column's NOT NULL note on the model for why there are no NULLs to
        -- order around any more.
        ORDER BY nd."nextPollAt" ASC
        LIMIT $3
        FOR UPDATE OF nd SKIP LOCKED
      `;

        const selectedRows: Array<{
          _id: string;
          pollingIntervalInMinutes: number | null;
        }> = await transactionalEntityManager.query(selectQuery, [
          data.probeId.toString(),
          currentDate,
          data.limit,
        ]);

        if (selectedRows.length === 0) {
          return [];
        }

        const ids: Array<string> = [];
        const caseFragments: Array<string> = [];
        const parameters: Array<string | Date> = [];
        let parameterIndex: number = 1;

        for (const row of selectedRows) {
          /*
           * Guard the interval: NULL falls back to the 5-minute default,
           * and anything below 1 minute is clamped — a walk can take tens
           * of seconds, so sub-minute schedules would only stack up.
           */
          const intervalInMinutes: number = Math.max(
            row.pollingIntervalInMinutes || 5,
            1,
          );

          const nextPollAt: Date = OneUptimeDate.addRemoveMinutes(
            currentDate,
            intervalInMinutes,
          );

          ids.push(row._id);
          /*
           * ::timestamptz, not ::timestamp. node-postgres serialises a Date
           * parameter as local wall-clock digits plus an explicit offset; a
           * ::timestamp cast throws the offset away and the timestamptz
           * column then re-reads those digits in the Postgres session's
           * timezone. The claim query above compares nextPollAt without a
           * cast (correctly, as timestamptz), so writing it as timestamp
           * skews every schedule by the difference between the app's UTC
           * offset and the database session timezone — devices then get
           * re-polled on every cron tick, or not for hours.
           */
          caseFragments.push(
            `WHEN $${parameterIndex} THEN $${parameterIndex + 1}::timestamptz`,
          );
          parameters.push(row._id, nextPollAt);
          parameterIndex += 2;
        }

        const idPlaceholders: Array<string> = ids.map(
          (_id: string, index: number) => {
            return `$${parameterIndex + index}`;
          },
        );
        parameters.push(...ids);

        const updateQuery: string = `
        UPDATE "NetworkDevice"
        SET "nextPollAt" = CASE "_id" ${caseFragments.join(" ")} END
        WHERE "_id" IN (${idPlaceholders.join(", ")})
      `;

        await transactionalEntityManager.query(updateQuery, parameters);

        return ids.map((id: string) => {
          return new ObjectID(id);
        });
      },
    );

    return claimedIds;
  }
}

export default new Service();
