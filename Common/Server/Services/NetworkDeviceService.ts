import DatabaseService from "./DatabaseService";
import MonitorService from "./MonitorService";
import NetworkAlertPolicyEngineService, {
  MAX_INLINE_RECONCILE_DEVICES,
} from "./NetworkAlertPolicyEngineService";
import NetworkDeviceLabelRuleEngineService from "./NetworkDeviceLabelRuleEngineService";
import NetworkDeviceOwnerRuleEngineService from "./NetworkDeviceOwnerRuleEngineService";
import NetworkSiteAssignmentRuleService from "./NetworkSiteAssignmentRuleService";
import NetworkSiteService from "./NetworkSiteService";
import NetworkSnmpCredentialProfileService from "./NetworkSnmpCredentialProfileService";
import ProbeService from "./ProbeService";
import Model from "../../Models/DatabaseModels/NetworkDevice";
import Monitor from "../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../Models/DatabaseModels/NetworkSite";
import NetworkSiteAssignmentRule from "../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import NetworkSnmpCredentialProfile from "../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import PartialEntity from "../../Types/Database/PartialEntity";
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

/*
 * readConsistent for the same reason as the OID template above: the create
 * and update guards validate the id this returns, and TypeORM's precedence
 * between `monitorId` and `monitor` is not a security boundary. A payload
 * that writes both spellings with different ids would have one of them
 * validated and the other persisted, so the contradiction is refused
 * instead of picked from.
 */
function readMonitorIdFromData(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.readConsistent(data, MONITOR_KEYS, "Monitor");
}

/*
 * Both spellings of "the probe that polls this device", and of "the SNMP
 * credentials it is walked with".
 *
 * These two are the tenancy boundary of device polling. The probe decides
 * WHO reaches into the customer's network on this device's behalf, and the
 * credential profile decides WHAT is put on the wire when it gets there —
 * so a cross-project value in either is not a mislabelled row, it is one
 * project's infrastructure being pointed at another's. Both are read
 * through readConsistent for the reason the monitor reference above is: a
 * payload writing the FK and the relation at different rows would otherwise
 * have one validated and the other persisted.
 */
const PROBE_KEYS: Array<string> = ["probeId", "probe"];
const PROFILE_KEYS: Array<string> = [
  "snmpCredentialProfileId",
  "snmpCredentialProfile",
];

/*
 * Both spellings of "what kind of thing this device is". A role is one of
 * the three axes a Network Alert Policy's scope selects on, so a write to it
 * can add a device to a policy or take it out of one.
 */
const ROLE_KEYS: Array<string> = ["networkDeviceRoleId", "networkDeviceRole"];

/*
 * Every write that can change which Network Alert Policies cover a device,
 * or whether it may carry a policy monitor at all.
 *
 * The first three are the scope axes (site, role, labels); the last three
 * are provisionability — an archived device, a monitor-backed device and a
 * device with no probe each keep no policy monitors (see the engine).
 *
 * Writing any of them makes onUpdateSuccess reconcile, and reconciling needs
 * each matched device's PROJECT, which only the pre-write snapshot carries
 * for a root caller with no tenant in props. That is why these are named in
 * onBeforeUpdate's early return as well: without them a bulk re-label would
 * skip the snapshot and the success hook would have no project to reconcile
 * against.
 */
function isAlertPolicyRelevantWrite(dataKeys: Array<string>): boolean {
  return (
    isSiteWrite(dataKeys) ||
    RelationIdUtil.isWritten(dataKeys, ROLE_KEYS) ||
    dataKeys.includes("labels") ||
    dataKeys.includes("isArchived") ||
    dataKeys.includes("monitoringMethod") ||
    RelationIdUtil.isWritten(dataKeys, PROBE_KEYS)
  );
}

function readProbeIdFromData(data: Record<string, unknown>): ObjectID | null {
  return RelationIdUtil.readConsistent(data, PROBE_KEYS, "Probe");
}

function readSnmpCredentialProfileIdFromData(
  data: Record<string, unknown>,
): ObjectID | null {
  return RelationIdUtil.readConsistent(
    data,
    PROFILE_KEYS,
    "SNMP Credential Profile",
  );
}

/*
 * The poll columns a probe's poll writes and nothing else ever should. On a
 * device switched to monitor-backed they are residue — the last thing a
 * probe found before it stopped asking — and left in place they keep
 * describing a device nothing polls: DeviceReachabilityUtil's legacy branch
 * judges a row with `lastSeenAt` and no `isReachable` by freshness, and the
 * network summary's "degraded" query is `isReachable = true AND
 * interfacesDown > 0`. The SNMP pair goes with them: a monitor-backed device
 * has no walk, so `isSnmpReachable` and `lastSnmpSeenAt` can only ever be
 * what the last walk left behind. Cleared on the Probe -> Monitor transition
 * (onUpdateSuccess) and once on upgrade
 * (BackfillMonitorBackedDeviceReachability), as a root write in both places:
 * these columns are updatable by fewer roles than `monitoringMethod` is, so
 * putting them on the caller's own payload would refuse a project member's
 * legitimate switch.
 */
function pollResidueReset(): PartialEntity<Model> {
  return {
    lastSeenAt: null,
    lastPolledAt: null,
    isReachable: null,
    isSnmpReachable: null,
    lastSnmpSeenAt: null,
    interfacesUp: null,
    interfacesDown: null,
  };
}

/*
 * What onBeforeUpdate hands onUpdateSuccess.
 *
 * `previousDevices` is the pre-write snapshot of every matched device, for
 * the site and identity maintenance. `wasMonitorBackedByDeviceId` is only
 * present on a write that carries `monitoringMethod`, and records which of
 * those devices were monitor-backed BEFORE the write. By the time
 * onUpdateSuccess runs only the NEW method is on the row, and the payload
 * alone cannot tell a real Monitor -> Probe transition from the Settings form
 * re-sending "Probe" on a Probe device — which it does on every save, and
 * which used to wipe the stamp that device's Network Device monitor had put
 * there.
 */
interface DeviceUpdateCarryForward {
  previousDevices: Array<Model>;
  wasMonitorBackedByDeviceId?: Record<string, boolean>;
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
   *
   * POLICY-OWNED MONITORS ARE HANDLED SEPARATELY, and deliberately so. A
   * monitor a Network Alert Policy provisioned is system-managed — the API
   * can neither set nor clear its `networkAlertPolicyId` — so nobody chose
   * it individually and nobody should need monitor-delete permission on it
   * individually to remove the device it describes. They are excluded from
   * the caller-authorized preflight below and removed as root by the engine,
   * once every device in the request has cleared that preflight.
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
        /*
         * Rule-provisioned and hand-made monitors only. A policy's monitors
         * go through the engine as root (see the hook comment), so requiring
         * the caller's permission on them here would refuse a device delete
         * over rows the caller never chose to own.
         */
        networkAlertPolicyId: QueryHelper.isNull(),
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

    /*
     * Every device in the request has now proved the caller may delete its
     * ordinary automatic monitors, so nothing after this point can throw for
     * an authorization reason. That is the moment to remove the policy-owned
     * monitors: doing it earlier would let a later device's failed preflight
     * abort the request after a policy's monitors — and their incident
     * history — were already gone from devices that then survived.
     */
    const devicesByProjectId: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    for (const device of devices) {
      if (!device.id || !device.projectId) {
        continue;
      }

      const key: string = device.projectId.toString();
      const deviceIds: Array<ObjectID> = devicesByProjectId.get(key) || [];
      deviceIds.push(device.id);
      devicesByProjectId.set(key, deviceIds);
    }

    for (const [projectIdString, deviceIds] of devicesByProjectId) {
      await NetworkAlertPolicyEngineService.deletePolicyMonitorsForDevices({
        projectId: new ObjectID(projectIdString),
        deviceIds: deviceIds,
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
   * The FK behind `probeId` only requires the Probe row to exist. Probe ids
   * reach the server from the browser — the device create form, the settings
   * page and the bulk "Set probe" action all post one — so without this
   * check a device can be pointed at another project's probe, and that probe
   * then claims it on its next poll: it reads the device's hostname and its
   * SNMP credentials, and reports status back into this project. That is a
   * cross-tenant read of both configuration and network position.
   *
   * A GLOBAL probe has no project and is attachable anywhere, so this
   * delegates to ProbeService rather than comparing projectIds — the same
   * predicate that decides which probes a monitor may use.
   *
   * `claimDevicesForPolling` re-checks the pairing in SQL as a backstop, for
   * rows written before this guard existed. Both halves are load-bearing:
   * this one gives the operator an error at the point of the mistake, the
   * other one makes a stale row unpollable rather than merely unwritable.
   */
  @CaptureSpan()
  private async assertProbeIsAttachableToProject(data: {
    probeId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const isAttachable: boolean = await ProbeService.isProbeAttachableToProject(
      {
        probeId: data.probeId,
        projectId: data.projectId,
      },
    );

    if (!isAttachable) {
      throw new BadDataException(
        "Probe not found or it does not belong to this project.",
      );
    }
  }

  /*
   * Same hole as the probe, on the other half of the poll: a credential
   * profile is read LIVE at poll time
   * (NetworkDeviceHydrationUtil.resolveSnmpCredentials), so a device pointed
   * at another project's profile would be walked with that project's
   * community string or v3 credentials — put on the wire, inside this
   * project's network, by this project's probe.
   *
   * The resolver drops a mismatched reference as a backstop and pings the
   * device instead. This is the half that stops the reference being written
   * at all, and it is the half that tells the operator why.
   */
  @CaptureSpan()
  private async assertSnmpCredentialProfileBelongsToProject(data: {
    snmpCredentialProfileId: ObjectID;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      return;
    }

    const profile: NetworkSnmpCredentialProfile | null =
      await NetworkSnmpCredentialProfileService.findOneById({
        id: data.snmpCredentialProfileId,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!profile) {
      throw new BadDataException("SNMP Credential Profile not found.");
    }

    if (
      profile.projectId &&
      profile.projectId.toString() !== data.projectId.toString()
    ) {
      throw new BadDataException(
        "SNMP Credential Profile must belong to the same project.",
      );
    }
  }

  /*
   * The site's default probe, resolved for a device that is landing in that
   * site without one of its own — this site's `probeId`, or the nearest
   * ancestor that has one.
   *
   * Returns null rather than throwing when the inherited probe is not
   * attachable to the device's project. A site row written before the
   * tenancy guards existed must not be able to fail an unrelated device
   * write; the honest outcome is that the device is created with NO probe
   * (it reads Pending, and the operator picks one) rather than silently
   * copying another project's probe onto it.
   */
  @CaptureSpan()
  private async resolveInheritedSiteProbeId(data: {
    siteId: ObjectID;
    projectIds: Array<ObjectID>;
  }): Promise<ObjectID | null> {
    const inheritedProbeId: ObjectID | null =
      await NetworkSiteService.resolveDefaultProbeIdForSite(data.siteId);

    if (!inheritedProbeId) {
      return null;
    }

    for (const projectId of data.projectIds) {
      const isAttachable: boolean =
        await ProbeService.isProbeAttachableToProject({
          probeId: inheritedProbeId,
          projectId: projectId,
        });

      if (!isAttachable) {
        logger.error(
          `Network site ${data.siteId.toString()} names default probe ${inheritedProbeId.toString()}, which is not attachable to project ${projectId.toString()}. Not inheriting it; the device is left without a probe.`,
        );
        return null;
      }
    }

    return inheritedProbeId;
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

    /*
     * DatabaseService stamps the tenant column AFTER this hook runs, so a
     * device created from the dashboard reaches here with `projectId` still
     * unset and only `props.tenantId` to go on. The guards below are the
     * tenancy boundary of polling, so they must not be skipped for the one
     * write shape every UI create takes.
     */
    const createProjectId: ObjectID | undefined =
      createBy.data.projectId ||
      createBy.data.project?.id ||
      createBy.props.tenantId ||
      undefined;

    const createProbeId: ObjectID | null = readProbeIdFromData(
      createBy.data as unknown as Record<string, unknown>,
    );

    if (createProbeId) {
      await this.assertProbeIsAttachableToProject({
        probeId: createProbeId,
        projectId: createProjectId,
      });
    }

    const createSnmpCredentialProfileId: ObjectID | null =
      readSnmpCredentialProfileIdFromData(
        createBy.data as unknown as Record<string, unknown>,
      );

    if (createSnmpCredentialProfileId) {
      await this.assertSnmpCredentialProfileBelongsToProject({
        snmpCredentialProfileId: createSnmpCredentialProfileId,
        projectId: createProjectId,
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

    const monitorId: ObjectID | null = readMonitorIdFromData(
      createBy.data as unknown as Record<string, unknown>,
    );

    /*
     * The monitor is NOT required. Discovery import is why: a subnet sweep
     * finds ping-only hosts in bulk and there is no monitor to bind them to
     * yet. Such a device is still worth recording — it belongs to a site,
     * carries labels, and appears on the topology map — and its status reads
     * Pending, tagged "No monitor", which is exactly true until somebody
     * points a monitor at it.
     *
     * But any binding that IS supplied is tenant-checked, whatever the
     * monitoring method. This guard used to sit inside the monitor-backed
     * branch below, which left a Probe-method create (or one with the method
     * omitted) free to persist another project's monitor FK: the FK only
     * proves the Monitor row exists, a Probe device may legitimately carry a
     * monitorId (NetworkSiteService.onMonitorStatusChanged stamps from it),
     * and a nested select through the relation reads that monitor's
     * configuration. The update path runs the same check.
     */
    if (monitorId) {
      await this.assertMonitorBelongsToProject({
        monitorId: monitorId,
        projectId: createBy.data.projectId,
      });
    }

    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        createBy.data.monitoringMethod,
      )
    ) {
      /*
       * Not a preference: nothing polls a monitor-backed device — its bound
       * monitor's status is its status — so leaving polling on would queue
       * a poll whose verdict nothing may read. claimDevicesForPolling
       * refuses these rows too — this is the half that keeps the column
       * honest for anything reading it.
       */
      createBy.data.isPollingEnabled = false;
    } else if (siteId && !createProbeId) {
      /*
       * Site default probe, COPIED AT WRITE.
       *
       * This is what lets an operator register a device with a name and an
       * address and nothing else: the site (or the nearest ancestor site
       * that names one) supplies the probe, and the device polls from its
       * first cycle instead of sitting Pending until somebody notices the
       * empty field.
       *
       * Copied, not read through, and that distinction is the whole design.
       * Nothing re-reads the site later, so editing a site's default probe
       * decides where FUTURE devices poll from and never re-points a fleet
       * that is already polling — a read-through default would turn one
       * dropdown change into a silent migration of every device in the
       * subtree onto a probe that may not even reach them.
       *
       * A device that names its own probe keeps it: `createProbeId` above is
       * the caller's explicit choice and always wins.
       */
      const inheritedProbeId: ObjectID | null =
        await this.resolveInheritedSiteProbeId({
          siteId: siteId,
          projectIds: createProjectId ? [createProjectId] : [],
        });

      if (inheritedProbeId) {
        createBy.data.probeId = inheritedProbeId;
      }
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
           * status CHANGE. Skipped for Probe devices, which are judged by
           * their own poll.
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
        .then(async () => {
          /*
           * LAST, and that ordering is the whole point. A Network Alert
           * Policy can be scoped by site, by role and by LABEL, and the
           * label and site links above are what put those on a newly
           * imported device — a discovery import arrives with neither. Asking
           * the policy engine before they land would reconcile the device
           * against a scope it does not match yet, provision nothing, and
           * leave the device uncovered until the five-minute sweep.
           */
          await NetworkAlertPolicyEngineService.reconcileDevice({
            projectId: createdItem.projectId!,
            deviceId: createdItem.id!,
          });
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
   * well as the new one), touches one of the columns site assignment rules
   * match on (so onUpdateSuccess can tell a real rename from the identical
   * sysName the SNMP walk rewrites on every poll), or touches
   * monitoringMethod (so onUpdateSuccess can tell a real Monitor -> Probe
   * transition from a form re-sending the method the device already has).
   * The same read feeds the tenancy guards on the site, monitor and OID
   * template references.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const dataKeys: Array<string> = Object.keys(updateBy.data || {});

    /*
     * Switching a device to monitor-backed turns polling off with it. The
     * two are one decision, not two: a monitor-backed device's health is
     * its bound monitor's, so leaving the flag on would queue a poll per
     * interval whose verdict nothing may read. The way back is the mirror
     * image — onUpdateSuccess restores polling on a real Monitor -> Probe
     * transition, per device, once the write has committed.
     */
    const isMethodWrite: boolean = dataKeys.includes("monitoringMethod");
    /*
     * An update payload is a QueryDeepPartialEntity, so a column can hold a
     * raw value OR a SQL-expression function. Only a plain string is a
     * method we can reason about; anything else falls through to the Probe
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
      /*
       * Only the polling flag is forced onto the payload, deliberately. The
       * poll residue the device carries over from its probe-polled days has to go
       * too, but the column-permission check runs on this payload AFTER the
       * hook, and those columns are updatable by fewer roles than
       * monitoringMethod is — so adding them here would turn a project
       * member's legitimate switch into a permission failure.
       * onUpdateSuccess clears them as root once the transition has
       * committed; see pollResidueReset.
       */
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
    const isPollingTurnOn: boolean =
      !becomesMonitorBacked &&
      dataKeys.includes("isPollingEnabled") &&
      updateBy.data.isPollingEnabled === true;

    /*
     * Read — and, for conflicting spellings, refused — before the early
     * return below, so a payload that points `monitorId` and `monitor` at
     * different rows is rejected on every write shape rather than only on
     * the ones that happen to need the snapshot. Null means the write
     * unbinds the monitor, or does not mention it; neither needs a lookup.
     */
    const newMonitorId: ObjectID | null = readMonitorIdFromData(
      updateBy.data as unknown as Record<string, unknown>,
    );

    /*
     * Read here, above the early return, for the same reason the monitor id
     * is: a payload that points `probeId` and `probe` (or the two credential
     * profile spellings) at different rows is a contradiction, and it is
     * refused on every write shape rather than only on the ones that happen
     * to need the snapshot below.
     */
    const newProbeId: ObjectID | null = readProbeIdFromData(
      updateBy.data as unknown as Record<string, unknown>,
    );
    const newSnmpCredentialProfileId: ObjectID | null =
      readSnmpCredentialProfileIdFromData(
        updateBy.data as unknown as Record<string, unknown>,
      );

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
    /*
     * The polling tenancy pair, named in the early return for exactly the
     * reason the OID template is: assigning a probe or a credential profile
     * changes neither site nor identity, so a guard placed below the return
     * would be dead code on the only writes it exists for — the settings
     * page's Monitoring section and the device-list bulk actions, which post
     * precisely these columns and nothing else.
     */
    const isProbeChange: boolean = RelationIdUtil.isWritten(
      dataKeys,
      PROBE_KEYS,
    );
    const isSnmpCredentialProfileChange: boolean = RelationIdUtil.isWritten(
      dataKeys,
      PROFILE_KEYS,
    );

    /*
     * One snapshot read serves every guard and carry-forward below, and the
     * SNMP walk's per-poll column writes — the hot path through here — need
     * none of them. Binding a monitor is on the list for the same reason the
     * OID template is: it is exactly the write shape that changes neither
     * site nor identity, so a tenancy guard placed below a narrower return
     * would never run on the only write it exists for.
     */
    /*
     * The alert-policy axes ride the same return, and for the same reason
     * the OID template does: re-labelling a device or moving it to a role
     * changes neither its site nor its identity, so a snapshot taken below a
     * narrower return would be absent on exactly the writes onUpdateSuccess
     * needs it for. See isAlertPolicyRelevantWrite.
     */
    const isAlertPolicyChange: boolean = isAlertPolicyRelevantWrite(dataKeys);

    if (
      !isMethodWrite &&
      !isPollingTurnOn &&
      !newMonitorId &&
      !isSiteChange &&
      !isIdentityChange &&
      !isOidTemplateChange &&
      !isDeviceOidsChange &&
      !isProbeChange &&
      !isSnmpCredentialProfileChange &&
      !isAlertPolicyChange
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
        /*
         * Whether the device already has a probe. The site-default
         * inheritance below must never overwrite one, and this column is
         * the only way to tell "no probe yet" from "a probe the operator
         * chose" once the write has committed.
         */
        probeId: true,
        // Decide which OID budget applies below, and whether a link would truncate.
        oidTemplateId: true,
        snmpOids: true,
        // The polling guard and the method transition both need the OLD method.
        monitoringMethod: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (isPollingTurnOn) {
      const isTargetMonitorBacked: boolean = previousDevices.some(
        (target: Model) => {
          return NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            target.monitoringMethod,
          );
        },
      );

      // Unless the same write is moving it back to Probe, which is allowed.
      if (isTargetMonitorBacked && !(isMethodWrite && !becomesMonitorBacked)) {
        throw new BadDataException(
          "This device is monitor-backed, so there is nothing to poll — its bound monitor's status is its status. Switch its monitoring method to Probe first.",
        );
      }
    }

    /*
     * Which of the matched devices were monitor-backed BEFORE this write.
     * Only recorded on a method write, because only a method write can be a
     * transition; see DeviceUpdateCarryForward for what onUpdateSuccess does
     * with it and why the payload alone is not enough.
     */
    let wasMonitorBackedByDeviceId: Record<string, boolean> | undefined =
      undefined;

    if (isMethodWrite) {
      wasMonitorBackedByDeviceId = {};

      for (const previousDevice of previousDevices) {
        if (!previousDevice.id) {
          continue;
        }

        wasMonitorBackedByDeviceId[previousDevice.id.toString()] =
          NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            previousDevice.monitoringMethod,
          );
      }
    }

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

    /*
     * The monitor guard on the UPDATE path. Until this existed only
     * onBeforeCreate checked the binding, so a device could be created
     * clean and then re-pointed at another project's monitor with a plain
     * update — and read that monitor's status through the device, since
     * refreshStampedMonitorStatus stamps whatever `monitorId` names. One
     * check per distinct project in the matched set, like the site guard
     * above. An unbind (null) has nothing to check.
     */
    if (newMonitorId) {
      const checkedMonitorProjectIds: Set<string> = new Set();

      for (const previousDevice of previousDevices) {
        if (
          !previousDevice.projectId ||
          checkedMonitorProjectIds.has(previousDevice.projectId.toString())
        ) {
          continue;
        }
        checkedMonitorProjectIds.add(previousDevice.projectId.toString());

        await this.assertMonitorBelongsToProject({
          monitorId: newMonitorId,
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
     * The polling tenancy guards on the UPDATE path. A device created clean
     * and then re-pointed with a plain update is the same breach as one
     * created that way, so both hooks check both references. One check per
     * distinct project in the matched set, like the guards above — a single
     * updateBy can span projects when a root caller issues it, and the
     * payload names ONE probe and ONE profile for all of them.
     *
     * A clear (null) points at nothing and has nothing to check.
     */
    const distinctProjectIds: Array<ObjectID> = [];
    const seenProjectIds: Set<string> = new Set();

    for (const previousDevice of previousDevices) {
      if (
        !previousDevice.projectId ||
        seenProjectIds.has(previousDevice.projectId.toString())
      ) {
        continue;
      }
      seenProjectIds.add(previousDevice.projectId.toString());
      distinctProjectIds.push(previousDevice.projectId);
    }

    for (const projectId of distinctProjectIds) {
      if (newProbeId) {
        await this.assertProbeIsAttachableToProject({
          probeId: newProbeId,
          projectId: projectId,
        });
      }

      if (newSnmpCredentialProfileId) {
        await this.assertSnmpCredentialProfileBelongsToProject({
          snmpCredentialProfileId: newSnmpCredentialProfileId,
          projectId: projectId,
        });
      }
    }

    await this.applySiteDefaultProbeOnMove({
      updateBy: updateBy,
      previousDevices: previousDevices,
      distinctProjectIds: distinctProjectIds,
      newSiteId: newSiteId,
      isProbeChange: isProbeChange,
      isMethodWrite: isMethodWrite,
      becomesMonitorBacked: becomesMonitorBacked,
    });

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

    const carryForward: DeviceUpdateCarryForward = {
      previousDevices: previousDevices,
    };

    if (wasMonitorBackedByDeviceId) {
      carryForward.wasMonitorBackedByDeviceId = wasMonitorBackedByDeviceId;
    }

    return {
      updateBy,
      carryForward: carryForward,
    };
  }

  /*
   * Site default probe on a MOVE: a device with no probe of its own that is
   * moved into a site inherits that site's default (or the nearest
   * ancestor's), copied onto this same write.
   *
   * The create path's twin, and the same copy-at-write rule: this runs only
   * because the payload moves the device, never because a site's default
   * changed. Editing a site's probe re-points nothing — the device-list bulk
   * "Set probe" action is the deliberate way to move a fleet.
   *
   * Three things stop it: the caller writing a probe of its own (their
   * choice wins, including an explicit clear), the device already having one
   * (a probe an operator chose must survive being filed under a site), and
   * the device being monitor-backed after this write (nothing polls it, so a
   * probe would be a lie on the row).
   *
   * "Already having one" is judged across the WHOLE matched set, because a
   * single payload writes one probeId to every row it matches: if any
   * matched device has a probe, inheriting would re-point it, so the
   * inheritance is skipped for the batch rather than applied to some of it.
   * The bulk path a user actually takes — "move these devices to this site"
   * — is overwhelmingly devices in the same state.
   */
  private async applySiteDefaultProbeOnMove(data: {
    updateBy: UpdateBy<Model>;
    previousDevices: Array<Model>;
    distinctProjectIds: Array<ObjectID>;
    newSiteId: ObjectID | null;
    isProbeChange: boolean;
    isMethodWrite: boolean;
    becomesMonitorBacked: boolean;
  }): Promise<void> {
    if (
      !data.newSiteId ||
      data.isProbeChange ||
      data.previousDevices.length === 0
    ) {
      return;
    }

    for (const previousDevice of data.previousDevices) {
      if (previousDevice.probeId) {
        return;
      }

      /*
       * The method AFTER this write: what the payload sets when it sets one,
       * otherwise what the row already says. A device that stays (or
       * becomes) monitor-backed is not polled by a probe at all.
       */
      const isMonitorBackedAfterWrite: boolean = data.isMethodWrite
        ? data.becomesMonitorBacked
        : NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
            previousDevice.monitoringMethod,
          );

      if (isMonitorBackedAfterWrite) {
        return;
      }
    }

    const inheritedProbeId: ObjectID | null =
      await this.resolveInheritedSiteProbeId({
        siteId: data.newSiteId,
        projectIds: data.distinctProjectIds,
      });

    if (inheritedProbeId) {
      data.updateBy.data.probeId = inheritedProbeId;
    }
  }

  /*
   * Re-derives one device's stamped `currentMonitorStatusId` — and, for a
   * monitor-backed device, its `isReachable` — from its binding, and
   * refreshes its site chain if either moved.
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
   * `isReachable` rides along because the device list's summary tiles and
   * its Status facet count and filter in SQL, over that column alone — they
   * cannot evaluate the stamp's ladder per row — so a monitor-backed device
   * whose stamp said Operational still counted as "Pending" there. The
   * value written is `!MonitorStatus.isOfflineState`: the OFFLINE end of the
   * ladder, not the operational one, because that is exactly what
   * DeviceReachabilityUtil reads for the pill (a "Degraded" row is neither
   * operational nor offline, and reads as reachable on both). NULL when
   * nothing is bound or the monitor has no status, which is the honest
   * "Pending" the util renders for `undefined`. For a Probe device the poll
   * owns `isReachable`, and this method never touches it.
   *
   * `clearWhenNotMonitorBacked` is for the write that moves a device OFF
   * monitor-backed: the ping monitor's verdict must not outlive the binding
   * (DeviceHealthStateUtil lets a stamped status beat reachability, so a
   * stale one would poison the site rollup of a device that is now walked).
   * It is deliberately NOT set when a write only touches the monitor
   * binding of a Probe device, nor when a form re-sends "Probe" on a device
   * that already is one, because a Probe device's stamp comes from the
   * Network Device monitor that watches it, and that binding lives in the
   * monitor's step data rather than in this column. onBeforeUpdate records
   * the old method so onUpdateSuccess can tell the two apart.
   *
   * Idempotent: everything is re-derived from the binding, nothing from what
   * a previous call wrote, and nothing is written when the row already
   * agrees — which is what makes it safe from every save, from monitor
   * deletion, and from a backfill running twice concurrently.
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
        isReachable: true,
        // Read only to decide whether the clear below has anything to clear.
        isSnmpReachable: true,
        lastSnmpSeenAt: true,
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

    if (!isMonitorBacked) {
      if (!data.clearWhenNotMonitorBacked) {
        return;
      }

      /*
       * The device has just left monitor-backed. While it was monitor-backed
       * its `isReachable` could only ever be the bound monitor's mirror: the
       * poll's value was NULLed on the way in (pollResidueReset), and
       * NetworkInventoryUtil never writes it for a monitor-backed row. So the
       * mirror goes with the stamp — otherwise a device switched back to
       * Probe would read "Down — the last poll could not reach it" (or Up)
       * on every surface, from the verdict of a monitor that no longer
       * governs it, until a poll happens to land. NULL is the honest answer:
       * Pending until the first poll decides.
       *
       * The SNMP pair is cleared with them for the same reason: nothing
       * walked the device while it was monitor-backed, so anything on those
       * two columns predates the binding, and a device switched back to
       * Probe starts clean — its first poll decides whether SNMP answers.
       *
       * Nothing to clear means nothing to write — a null-over-null write
       * would still recompute the site chain for nothing.
       */
      const hasStamp: boolean = Boolean(device.currentMonitorStatusId);
      const hasMirroredReachability: boolean =
        typeof device.isReachable === "boolean";
      const hasSnmpResidue: boolean =
        typeof device.isSnmpReachable === "boolean" ||
        (device.lastSnmpSeenAt !== null && device.lastSnmpSeenAt !== undefined);

      if (!hasStamp && !hasMirroredReachability && !hasSnmpResidue) {
        return;
      }

      await this.updateColumnsByIdWithoutHooks({
        id: data.deviceId,
        data: {
          currentMonitorStatusId: null,
          isReachable: null,
          isSnmpReachable: null,
          lastSnmpSeenAt: null,
        },
      });

      if (device.siteId) {
        await NetworkSiteService.recomputeRollupForSiteAndAncestors(
          device.siteId,
        );
      }

      return;
    }

    let monitorStatusId: ObjectID | null = null;
    let nextReachable: boolean | null = null;

    if (device.monitorId) {
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
          currentMonitorStatus: {
            isOfflineState: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      monitorStatusId = monitor?.currentMonitorStatusId || null;

      if (monitorStatusId) {
        nextReachable = monitor?.currentMonitorStatus?.isOfflineState !== true;
      }
    }

    const currentStampId: string | null =
      device.currentMonitorStatusId?.toString() || null;
    const nextStampId: string | null = monitorStatusId?.toString() || null;

    /*
     * A NULL column reads back as undefined on the model; both mean "no
     * verdict", and comparing them as one keeps a device that already
     * agrees from being rewritten on every save.
     */
    const currentReachable: boolean | null =
      typeof device.isReachable === "boolean" ? device.isReachable : null;

    if (currentStampId === nextStampId && currentReachable === nextReachable) {
      return;
    }

    // One write, so the two columns can never be seen disagreeing.
    await this.updateColumnsByIdWithoutHooks({
      id: data.deviceId,
      data: {
        currentMonitorStatusId: monitorStatusId,
        isReachable: nextReachable,
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
        // Same parse as onBeforeUpdate: only a plain string is a method.
        const writtenMethod: unknown = (
          onUpdate.updateBy.data as unknown as Record<string, unknown>
        )["monitoringMethod"];
        const becomesMonitorBacked: boolean =
          isMethodWrite &&
          typeof writtenMethod === "string" &&
          NetworkDeviceMonitoringMethodUtil.isMonitorBacked(writtenMethod);

        /*
         * Recorded by onBeforeUpdate on every method write. Absent on a
         * binding-only write, where nothing can have transitioned.
         */
        const wasMonitorBackedByDeviceId: Record<string, boolean> =
          (onUpdate.carryForward as DeviceUpdateCarryForward | null)
            ?.wasMonitorBackedByDeviceId || {};

        for (const deviceId of updatedItemIds) {
          const wasMonitorBacked: boolean | undefined =
            wasMonitorBackedByDeviceId[deviceId.toString()];

          /*
           * Probe -> Monitor: the probe's last findings are now residue on a
           * device nothing polls, and they would keep feeding the legacy
           * staleness rule and the "degraded" query. Cleared as root here
           * rather than on the caller's payload (see onBeforeUpdate for the
           * permission reason), and BEFORE the re-stamp, so a device bound
           * in the same write ends up with its monitor's verdict rather
           * than the walk's. A device the snapshot did not record is
           * cleared too: the write is idempotent, and "unknown" must not
           * mean "keep the residue".
           */
          if (becomesMonitorBacked && wasMonitorBacked !== true) {
            try {
              await this.updateColumnsByIdWithoutHooks({
                id: deviceId,
                data: pollResidueReset(),
              });
            } catch (error) {
              /*
               * Bookkeeping, and separable from the re-stamp: the monitor's
               * verdict below still lands, and a set isReachable keeps the
               * legacy freshness branch out of play even with the dates
               * left behind.
               */
              logger.error(
                `Error in NetworkDeviceService.onUpdateSuccess poll residue reset for device ${deviceId.toString()}: ${error}`,
              );
            }
          }

          /*
           * Monitor -> Probe: the mirror image. Arriving at monitor-backed
           * turned polling off (onBeforeUpdate), so leaving it turns polling
           * back on — otherwise the device would sit on "Pending" under a
           * method whose whole point is that the probe polls it. Decided
           * per device from the snapshot, never from the payload: one bulk
           * write of "Probe" also matches devices that already were Probe,
           * and one of those may have had polling turned off on purpose.
           * A root write, like the residue reset above, because the two
           * columns are updatable by fewer roles than the method is.
           * `nextPollAt = now` makes the device due at once rather than at
           * whatever moment its last claim — months ago, or never — left
           * behind. The caller's own word wins when it says the opposite:
           * a payload writing `isPollingEnabled: false` beside the method
           * wants a Probe device that is not polled yet. No probe is
           * required here — the forms require one, the API and Terraform
           * may assign it in a later write — and a Probe device without one
           * is simply not claimed until it has one.
           */
          const isMonitorToProbeTransition: boolean =
            wasMonitorBacked === true && !becomesMonitorBacked;
          const payloadTurnsPollingOff: boolean =
            dataKeys.includes("isPollingEnabled") &&
            (onUpdate.updateBy.data as unknown as Record<string, unknown>)[
              "isPollingEnabled"
            ] === false;

          if (isMonitorToProbeTransition && !payloadTurnsPollingOff) {
            try {
              await this.updateColumnsByIdWithoutHooks({
                id: deviceId,
                data: {
                  isPollingEnabled: true,
                  nextPollAt: OneUptimeDate.getCurrentDate(),
                },
              });
            } catch (error) {
              /*
               * Bookkeeping, and separable from the re-stamp below: the
               * stale stamp still goes, and the operator can turn polling
               * on from Settings if this write was the one that failed.
               */
              logger.error(
                `Error in NetworkDeviceService.onUpdateSuccess polling restore for device ${deviceId.toString()}: ${error}`,
              );
            }
          }

          /*
           * Only a device that WAS monitor-backed and now is not may have
           * its stamp cleared. The Settings form re-sends monitoringMethod
           * on every save, so "the payload says Probe" is not a transition —
           * treating it as one wiped the stamp a Network Device monitor had
           * put on every Probe device that was ever saved.
           */
          await this.refreshStampedMonitorStatus({
            deviceId: deviceId,
            clearWhenNotMonitorBacked:
              wasMonitorBacked === true && !becomesMonitorBacked,
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

    try {
      await this.reconcileAlertPoliciesAfterUpdate(onUpdate, updatedItemIds);
    } catch (error) {
      /*
       * Isolated from the site maintenance above for the same reason that is
       * isolated from the status re-stamp: a policy that cannot provision
       * must not cost the device its site rollup, and the five-minute sweep
       * recomputes the same difference either way.
       */
      logger.error(
        `Error in NetworkDeviceService.onUpdateSuccess alert policy reconciliation: ${error}`,
      );
    }

    return onUpdate;
  }

  /*
   * Keep the device's policy-provisioned monitors in step with what the
   * update just changed about it.
   *
   * INLINE ONLY FOR A HANDFUL OF DEVICES. Reconciling one device is a few
   * queries and, at most, one monitor create — worth doing inside the write
   * so the monitor is there by the operator's next page load. A BULK write is
   * a different animal: "move 1,200 devices into this site" or "archive the
   * warehouse" matches thousands of rows, and reconciling thousands of
   * devices inside the request would turn one statement into an hour of
   * monitor provisioning with the caller still waiting on it. Past
   * MAX_INLINE_RECONCILE_DEVICES the write returns and the five-minute sweep
   * converges the fleet — it computes the same difference from the same
   * columns, so nothing is lost but latency.
   *
   * The project comes from the pre-write snapshot rather than from
   * props.tenantId, because a root caller (a worker, a data migration) has no
   * tenant and its update can legitimately span projects.
   */
  private async reconcileAlertPoliciesAfterUpdate(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const dataKeys: Array<string> = Object.keys(onUpdate.updateBy.data || {});

    if (!isAlertPolicyRelevantWrite(dataKeys) || updatedItemIds.length === 0) {
      return;
    }

    if (updatedItemIds.length > MAX_INLINE_RECONCILE_DEVICES) {
      logger.debug(
        `NetworkDeviceService.onUpdateSuccess: ${updatedItemIds.length} devices changed an alert-policy scope column; leaving reconciliation to the NetworkAlertPolicy sweep.`,
      );

      return;
    }

    const previousDevices: Array<Model> =
      (onUpdate.carryForward?.previousDevices as Array<Model>) || [];

    const projectIdByDeviceId: Map<string, ObjectID> = new Map<
      string,
      ObjectID
    >();

    for (const previousDevice of previousDevices) {
      if (previousDevice.id && previousDevice.projectId) {
        projectIdByDeviceId.set(
          previousDevice.id.toString(),
          previousDevice.projectId,
        );
      }
    }

    for (const deviceId of updatedItemIds) {
      const projectId: ObjectID | undefined =
        projectIdByDeviceId.get(deviceId.toString()) ||
        onUpdate.updateBy.props.tenantId ||
        undefined;

      if (!projectId) {
        /*
         * No snapshot row and no tenant: the update matched a device this
         * hook cannot attribute to a project, so it cannot be reconciled
         * safely. The sweep, which starts from the policies, will reach it.
         */
        logger.debug(
          `NetworkDeviceService.onUpdateSuccess: no project known for device ${deviceId.toString()}; leaving its alert-policy monitors to the sweep.`,
        );

        continue;
      }

      await NetworkAlertPolicyEngineService.reconcileDevice({
        projectId: projectId,
        deviceId: deviceId,
      });
    }
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
   *
   * The Probe join is a TENANCY backstop rather than a lookup — nothing from
   * the probe row is selected. See the predicate for why the write-time
   * guard is not enough on its own.
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
        INNER JOIN "Probe" pr ON nd."probeId" = pr."_id"
        WHERE nd."probeId" = $1
          AND nd."isPollingEnabled" = true
          AND nd."deletedAt" IS NULL
          AND nd."hostname" IS NOT NULL
          -- The tenancy backstop. onBeforeCreate/onBeforeUpdate refuse a
          -- probe that is not attachable to the device's project, but rows
          -- written before those guards existed are still on disk, and a
          -- probe that can CLAIM a device reads its hostname and its SNMP
          -- credentials. A global probe has no project and may poll anyone;
          -- anything else must match the device's own project or the row is
          -- simply never handed out. isGlobalProbe is NOT NULL DEFAULT false,
          -- so there is no third state here to reason about.
          AND (pr."isGlobalProbe" = true OR pr."projectId" = nd."projectId")
          -- Nothing polls a monitor-backed device. NULL is every device
          -- created before the column existed: those are probe-polled.
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
