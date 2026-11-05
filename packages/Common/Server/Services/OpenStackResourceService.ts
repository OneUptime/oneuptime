import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OpenStackResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import {
  OPENSTACK_QUOTA_STALE_MINUTES,
  getOpenStackQuotaAtLineSql,
} from "../../Types/OpenStack/OpenStackQuota";
import { OPENSTACK_TOPOLOGY_FULL_PART_LIMIT } from "../../Types/OpenStack/OpenStackTopology";
import {
  OpenStackInstancesOnHost,
  OpenStackInventoryField,
  getOpenStackInventoryFactKey,
} from "../../Types/OpenStack/OpenStackCapacity";
import { JSONObject } from "../../Types/JSON";
import {
  OpenStackResourceKind,
  OpenStackServiceFamily,
  OpenStackServiceType,
  OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES,
  OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES,
  OPENSTACK_CONTAINER_CLUSTER_UNHEALTHY,
  OPENSTACK_BARE_METAL_ERROR_STATES,
  OPENSTACK_BARE_METAL_IN_MAINTENANCE,
  OPENSTACK_BARE_METAL_TRANSITIONAL_STATES,
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_KINDS_BY_SERVICE,
  OPENSTACK_SERVICES_EVERY_CLOUD_RUNS,
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_SERVICE_STATUS_UP,
  OPENSTACK_STACK_FAILED_STATUSES,
  OPENSTACK_STACK_IN_PROGRESS_STATUSES,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
  OPENSTACK_WORKER_FAMILY_BY_SERVICE,
} from "../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_EMPTY_ANSWER_SINCE_FACT,
  getOpenStackOptionalService,
  hasOpenStackOptionalServiceLeft,
  isOpenStackOptionalService,
} from "../../Types/OpenStack/OpenStackOptionalServices";
import {
  OpenStackRegionSummary,
  OpenStackRowState,
  OpenStackRowsLeftOut,
  OpenStackTopConsumer,
  OpenStackTopConsumers,
} from "../../Types/OpenStack/OpenStackOverview";
import {
  OPENSTACK_BARE_METAL_CLASS_LIMIT,
  OpenStackBareMetalClass,
} from "../../Types/OpenStack/OpenStackBareMetal";
import {
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  OpenStackBlastRadiusOwner,
  buildOpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "../../Types/OpenStack/OpenStackBlastRadius";
import {
  OPENSTACK_COUNT_LIMIT,
  OpenStackCountBy,
  OpenStackCountRow,
} from "../../Types/OpenStack/OpenStackCounts";
import {
  OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
  OPENSTACK_ALLOCATION_WARNING_PERCENT,
  OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS,
  OPENSTACK_BARE_METAL_STUCK_MINUTES,
  OPENSTACK_IMAGE_STUCK_MINUTES,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
  OPENSTACK_STACK_STUCK_MINUTES,
  OPENSTACK_QUIET_SERVICE_FORGOTTEN_DAYS,
  OPENSTACK_QUIET_SERVICE_MINUTES,
  OPENSTACK_REDUNDANT_WORKERS,
  OPENSTACK_STORAGE_POOL_WARNING_PERCENT,
  OPENSTACK_VOLUME_STUCK_MINUTES,
  OpenStackL3AgentFact,
  getOpenStackRouterAgents,
  getOpenStackShortHostName,
} from "../../Types/OpenStack/OpenStackHealthRules";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import logger from "../Utils/Logger";
import {
  OpenStackOptionalServiceScrape,
  getOpenStackApiRowExternalId,
} from "../Utils/Telemetry/OpenStackSnapshotScan";

/*
 * ------------------------------------------------------------------
 * OpenStackResourceService
 *
 * Writes and reads the OpenStack inventory table populated by the telemetry
 * ingest path. Callers are OtelMetricsIngestService (bulkUpsert, from the
 * openstack_* snapshot scan), the CleanupStaleResources worker
 * (deleteStaleForCloud) and OpenStackResourceAPI and the dashboard pages (reads
 * through the inherited DatabaseService CRUD).
 * ------------------------------------------------------------------
 */

export interface ParsedOpenStackResource {
  kind: OpenStackResourceKind;
  externalId: string;
  name: string | null;
  regionName: string | null;
  availabilityZone: string | null;
  hypervisorName: string | null;
  openStackProjectId: string | null;
  status: string | null;
  adminState: string | null;
  disabledReason: string | null;
  vcpuCapacity: number | null;
  vcpuAllocated: number | null;
  memoryCapacityBytes: number | null;
  memoryAllocatedBytes: number | null;
  diskCapacityBytes: number | null;
  diskAllocatedBytes: number | null;
  instanceCount: number | null;
  facts: JSONObject;
  lastSeenAt: Date;
}

/*
 * What the cloud's snapshot columns hold: recounted from these rows after each
 * flush, because one batch only ever holds one service of one region.
 */
export interface OpenStackInventorySummary {
  regionCount: number;
  availabilityZoneCount: number;
  hypervisorCount: number;
  instanceCount: number;
  activeInstanceCount: number;
  volumeCount: number;
  networkCount: number;
  routerCount: number;
  floatingIpCount: number;
  projectCount: number;
  serviceCount: number;
  downServiceCount: number;
  bareMetalNodeCount: number;
  /*
   * How many nodes Placement holds, whatever Ironic shows this credential: it answers a project
   * with what that project owns, and Placement answers everyone.
   */
  bareMetalProviderCount: number;
  // The services a read has heard from, with what each is called in Keystone's catalog.
  services: Array<string>;
  vcpuCapacity: number;
  vcpuAllocated: number;
  memoryCapacityBytes: number;
  memoryAllocatedBytes: number;
  storageCapacityBytes: number;
  storageUsedBytes: number;
  // Of a service a cloud may not run, so 0 on one that doesn't.
  stackCount: number;
  containerClusterCount: number;
}

// What a cloud's capacity is worked out from: see OpenStackCapacityRefresh.
export interface OpenStackCapacityRows {
  hypervisors: Array<JSONObject>;
  flavors: Array<JSONObject>;
  storagePools: Array<JSONObject>;
  externalNetworks: Array<JSONObject>;
}

export interface OpenStackAttentionRows {
  // The rows that may need someone, at most ATTENTION_ROWS_PER_KIND of each kind.
  rows: Array<JSONObject>;
  // How many there are of each kind, so a list can say "and 1,240 more".
  totalsByKind: Record<string, number>;
  // Hosts and workers past OPENSTACK_WHOLE_KIND_ROWS that were counted and not read.
  leftOut: Array<OpenStackRowsLeftOut>;
}

export interface OpenStackServiceRowsRead {
  workers: Array<JSONObject>;
  leftOut: Array<OpenStackRowsLeftOut>;
}

const OPENSTACK_TOP_CONSUMERS_LIMIT: number = 5;

// What one project runs and how much of it needs someone: the Projects list reads these.
export interface OpenStackProjectSummary {
  projectId: string;
  instanceCount: number;
  activeInstanceCount: number;
  volumeCount: number;
  networkCount: number;
  routerCount: number;
  floatingIpCount: number;
  stackCount: number;
  containerClusterCount: number;
}

export interface OpenStackProjectLabel {
  key: string;
  value: string;
  instanceCount: number;
}

// A hypervisor that is down with some of this project's instances on it.
export interface OpenStackProjectHostDown {
  hypervisorName: string;
  regionName: string | null;
  externalId: string;
  instanceCount: number;
}

export interface OpenStackProjectOverview {
  summary: OpenStackProjectSummary;
  // The project's own parts that may need someone. OpenStackHealth has the last word.
  attention: OpenStackAttentionRows;
  hostsDown: Array<OpenStackProjectHostDown>;
  labels: Array<OpenStackProjectLabel>;
}

export interface OpenStackDomainSummary {
  domainId: string;
  projectCount: number;
  enabledProjectCount: number;
}

/*
 * What a cloud's map is drawn from. Up to OPENSTACK_TOPOLOGY_FULL_PART_LIMIT parts it is
 * all of them. Past that, drawing everything answers nothing and reads too much, so it
 * is the structure (regions, zones, hypervisors, services, pools, external networks and
 * routers) with counts of what each hypervisor holds, and of the rest only what has
 * failed and what that affects.
 */
export interface OpenStackTopologyRead {
  rows: Array<JSONObject>;
  // How many of each kind the cloud holds, read or not.
  totalsByKind: Record<string, number>;
  instancesByHost: Array<{
    regionName: string | null;
    hypervisorName: string;
    instanceCount: number;
  }>;
  isSummarized: boolean;
  // The names of the projects the rows name, so a card can say whose it is.
  projectNames: Record<string, string>;
}

// How many of each kind of failed part a summarized map reads.
const OPENSTACK_TOPOLOGY_FAILED_PER_KIND: number = 2000;

// How many instances a summarized map draws beneath the hypervisors that are down.
const OPENSTACK_TOPOLOGY_AFFECTED_INSTANCES: number = 2000;

// The most hypervisors, services or routers one read holds, however large the cloud.
const OPENSTACK_TOPOLOGY_STRUCTURE_LIMIT: number = 20000;

// The most of each a capacity read holds. Past these a cloud is not one this was built to read.
const OPENSTACK_CAPACITY_FLAVOR_ROWS: number = 5000;
const OPENSTACK_CAPACITY_POOL_ROWS: number = 2000;
// A host and a flavor per row: every flavor there is, on every one of 5,000 hosts.
const OPENSTACK_CAPACITY_INSTANCES_ON_HOSTS_ROWS: number = 200000;

// A page of a list asks about this many projects at once, and a read answers no more.
const OPENSTACK_PROJECTS_PER_READ: number = 200;

const OPENSTACK_PROJECT_LABEL_LIMIT: number = 50;
const OPENSTACK_PROJECT_ATTENTION_ROWS_PER_KIND: number = 200;
const OPENSTACK_PROJECT_HOSTS_DOWN_LIMIT: number = 100;
const OPENSTACK_DOMAIN_PROJECT_ID_LIMIT: number = 5000;

// The columns every read of a whole row returns, so a page can run the health rules.
const ROW_COLUMNS: string = `"_id", "kind", "externalId", "name", "regionName", "availabilityZone",
  "hypervisorName", "openStackProjectId", "status", "adminState",
  "disabledReason", "stateChangedAt", "vcpuCapacity", "vcpuAllocated",
  "memoryCapacityBytes", "memoryAllocatedBytes", "diskCapacityBytes",
  "diskAllocatedBytes", "instanceCount", "facts", "lastSeenAt"`;

// Postgres hands a bigint back as a string, and the health rules compare numbers.
const BIGINT_COLUMNS: ReadonlyArray<string> = [
  "memoryCapacityBytes",
  "memoryAllocatedBytes",
  "diskCapacityBytes",
  "diskAllocatedBytes",
];

function toRowWithNumbers(row: JSONObject): JSONObject {
  const result: JSONObject = { ...row };
  for (const column of BIGINT_COLUMNS) {
    const value: unknown = result[column];
    if (typeof value === "string") {
      const parsed: number = Number.parseFloat(value);
      result[column] = Number.isFinite(parsed) ? parsed : null;
    }
  }
  return result;
}

/*
 * Whether a row's capacity counts: see getInventorySummary. Only a hypervisor has a
 * state and capacity both, so this leaves storage pools alone.
 */
const CAN_GIVE: string = `COALESCE("status", '') <> '${OPENSTACK_SERVICE_STATUS_DOWN}'
  AND COALESCE("adminState", '') NOT IN ('disabled', 'down')`;

// What each thing a kind can be counted by reads. A closed list: see OpenStackCounts.
const COUNT_COLUMNS: Record<OpenStackCountBy, string> = {
  flavor: `"facts"->>'flavorId'`,
  volumeType: `"facts"->>'volumeType'`,
  project: `"openStackProjectId"`,
};

const UPSERT_BATCH_SIZE: number = 500;

/*
 * How long a row nothing has changed on can go without being rewritten: at most this, and never
 * more than a third of the stale window. Rewriting every row of a large cloud on every scrape
 * is most of what a scrape costs Postgres: on 200,000 unchanged rows, 313 MiB of WAL against
 * 11 MiB (measured: OpenStackScalePostgres).
 *
 * What holds this inside the stale rule. The sweep measures from the read before the latest one
 * (deleteStaleForCloud), so a read's rows have that long to land. A read skips a row only when the
 * row's lastSeenAt is within this of the read, so once any read's rows have landed, a part it
 * reported is at most this far behind it: a third of the window, at any window the setting allows.
 * A read that lost its rows altogether adds its own interval, and the two still fit, because an
 * interval longer than this never skips anything.
 */
const MAX_ROW_TOUCH_INTERVAL_IN_SECONDS: number = 5 * 60;
const STALE_DELETE_BATCH_SIZE: number = 5000;
// How far ahead of this server a cloud's clock may be before its dates are refused.
const MAX_STATE_CHANGE_CLOCK_SKEW_IN_MS: number = 10 * 60 * 1000;
const ATTENTION_ROWS_PER_KIND: number = 100;
/*
 * The most hosts or workers a read brings. Up to this it brings all of them, as it does on nearly
 * every cloud. Past it the ones that may need someone, these many at most however bad a day it is,
 * and how many others there are: see OpenStackRowsLeftOut.
 */
const OPENSTACK_WHOLE_KIND_ROWS: number = 1000;
const STALE_DELETE_WARN_THRESHOLD: number = 1000;
const DEFAULT_STALE_MINUTES: number = 15;
const MINIMUM_STALE_MINUTES: number = 5;

// A row of a list read in order of its ID, whatever else it is filtered by.
const OPENSTACK_ROWS_PER_READ: number = 1000;

const UPSERT_COLUMNS: ReadonlyArray<string> = [
  "projectId",
  "openStackCloudId",
  "kind",
  "externalId",
  "name",
  "regionName",
  "availabilityZone",
  "hypervisorName",
  "openStackProjectId",
  "status",
  "adminState",
  "disabledReason",
  "stateChangedAt",
  "vcpuCapacity",
  "vcpuAllocated",
  "memoryCapacityBytes",
  "memoryAllocatedBytes",
  "diskCapacityBytes",
  "diskAllocatedBytes",
  "instanceCount",
  "facts",
  "metricsUpdatedAt",
  "lastSeenAt",
  "version",
];

/*
 * The text columns are ShortText, and the bulk paths go through manager.query(),
 * which skips the length validation ordinary writes get, so one oversized value
 * would abort the whole chunk it rides in. OpenStack names are free text set by
 * tenants, so clamp each one and never lose a scrape to somebody's long name.
 */
function sanitize(resource: ParsedOpenStackResource): ParsedOpenStackResource {
  return {
    ...resource,
    externalId: truncateShortText(resource.externalId) as string,
    name: truncateShortText(resource.name),
    regionName: truncateShortText(resource.regionName),
    availabilityZone: truncateShortText(resource.availabilityZone),
    hypervisorName: truncateShortText(resource.hypervisorName),
    openStackProjectId: truncateShortText(resource.openStackProjectId),
    status: truncateShortText(resource.status),
    adminState: truncateShortText(resource.adminState),
    disabledReason: truncateLongText(resource.disabledReason),
  };
}

function toBigIntParam(value: number | null): string | null {
  return value === null ? null : Math.trunc(value).toString();
}

function toIntParam(value: number | null): number | null {
  return value === null ? null : Math.trunc(value);
}

/*
 * When a part changed state, by what names it: its own id, or for a worker, its binary
 * and host. See recordStateChanges.
 */
export interface OpenStackStateChange {
  kind: OpenStackResourceKind;
  externalId: string;
  binary: string;
  host: string;
  at: Date;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of rows for one cloud. ON CONFLICT on the unique
   * (projectId, openStackCloudId, kind, externalId) index, guarded on lastSeenAt
   * so an out-of-order batch never regresses a newer snapshot.
   *
   * Every column COALESCEs against the row, because a scrape can leave things out:
   * a slow metric that is off, or Nova's hypervisor series while Placement answers.
   * `facts` merges key by key for the same reason. `stateChangedAt` moves only when
   * the status or admin state really changes, and that is what the time-based rules
   * read: how long a volume has been `attaching`, or a service disabled.
   *
   * Capped by construction: at most UPSERT_BATCH_SIZE rows a statement, each statement a
   * transaction of its own, so no writer holds a large cloud's rows for long. Always in the
   * same order, so two batches that overlap wait for each other rather than deadlock.
   *
   * A row that would come out exactly as it stands, and was seen within the touch interval,
   * is not rewritten (getRowTouchIntervalInSeconds has why that is safe). So lastSeenAt says
   * "seen at this time or later", which is all the stale rule and a part page's "last report"
   * want of it. One thing the guard above gives up for that: a state that flapped between two
   * scrapes whose batches crossed can read the older state until the next scrape.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    resources: Array<ParsedOpenStackResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    const resources: Array<ParsedOpenStackResource> = data.resources
      .map((resource: ParsedOpenStackResource) => {
        const sanitized: ParsedOpenStackResource = sanitize(resource);
        if (sanitized.externalId !== resource.externalId) {
          logger.warn(
            `OpenStackResource externalId exceeds ${ColumnLength.ShortText} chars; truncated to "${sanitized.externalId}" (cloud ${data.openStackCloudId.toString()}).`,
          );
        }
        return sanitized;
      })
      .sort(
        (first: ParsedOpenStackResource, second: ParsedOpenStackResource) => {
          const a: string = `${first.kind}/${first.externalId}`;
          const b: string = `${second.kind}/${second.externalId}`;
          return a < b ? -1 : a > b ? 1 : 0;
        },
      );

    const touchInterval: number = this.getRowTouchIntervalInSeconds();

    for (let i: number = 0; i < resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedOpenStackResource> = resources.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const resource of chunk) {
        const placeholders: Array<string> = [];
        for (const column of UPSERT_COLUMNS) {
          const placeholder: string = `$${paramIndex++}`;
          placeholders.push(
            column === "facts" ? `${placeholder}::jsonb` : placeholder,
          );
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          resource.kind,
          resource.externalId,
          resource.name,
          resource.regionName,
          resource.availabilityZone,
          resource.hypervisorName,
          resource.openStackProjectId,
          resource.status,
          resource.adminState,
          resource.disabledReason,
          // A new row's state began when it was first seen.
          resource.status === null ? null : resource.lastSeenAt,
          toIntParam(resource.vcpuCapacity),
          toIntParam(resource.vcpuAllocated),
          toBigIntParam(resource.memoryCapacityBytes),
          toBigIntParam(resource.memoryAllocatedBytes),
          toBigIntParam(resource.diskCapacityBytes),
          toBigIntParam(resource.diskAllocatedBytes),
          toIntParam(resource.instanceCount),
          JSON.stringify(resource.facts || {}),
          resource.lastSeenAt,
          resource.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const quoted: string = UPSERT_COLUMNS.map((column: string) => {
        return `"${column}"`;
      }).join(", ");

      const coalesce: (column: string) => string = (column: string): string => {
        return `"${column}" = COALESCE(EXCLUDED."${column}", "OpenStackResource"."${column}")`;
      };

      // What coalesce would really change: a null never does.
      const isNewValue: (column: string) => string = (
        column: string,
      ): string => {
        return `(EXCLUDED."${column}" IS NOT NULL AND EXCLUDED."${column}" IS DISTINCT FROM "OpenStackResource"."${column}")`;
      };

      const sql: string = `
        INSERT INTO "OpenStackResource" (${quoted})
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "openStackCloudId", "kind", "externalId")
        DO UPDATE SET
          ${coalesce("name")},
          ${coalesce("regionName")},
          ${coalesce("availabilityZone")},
          ${coalesce("hypervisorName")},
          ${coalesce("openStackProjectId")},
          ${coalesce("status")},
          ${coalesce("adminState")},
          "disabledReason" = CASE
            WHEN EXCLUDED."adminState" IS NOT NULL THEN EXCLUDED."disabledReason"
            ELSE "OpenStackResource"."disabledReason"
          END,
          "stateChangedAt" = CASE
            WHEN (EXCLUDED."status" IS NOT NULL
                AND EXCLUDED."status" IS DISTINCT FROM "OpenStackResource"."status")
              OR (EXCLUDED."adminState" IS NOT NULL
                AND EXCLUDED."adminState" IS DISTINCT FROM "OpenStackResource"."adminState")
            THEN CASE
              -- An event since the last scrape already said when: see recordStateChanges.
              WHEN "OpenStackResource"."stateChangedAt" > "OpenStackResource"."lastSeenAt"
              THEN "OpenStackResource"."stateChangedAt"
              ELSE EXCLUDED."lastSeenAt"
            END
            ELSE COALESCE("OpenStackResource"."stateChangedAt", EXCLUDED."stateChangedAt")
          END,
          ${coalesce("vcpuCapacity")},
          ${coalesce("vcpuAllocated")},
          ${coalesce("memoryCapacityBytes")},
          ${coalesce("memoryAllocatedBytes")},
          ${coalesce("diskCapacityBytes")},
          ${coalesce("diskAllocatedBytes")},
          ${coalesce("instanceCount")},
          "facts" = COALESCE("OpenStackResource"."facts", '{}'::jsonb) || EXCLUDED."facts"
            -- The read this one follows, which is what the stale rule measures from.
            || CASE
              WHEN EXCLUDED."facts" ? 'vouchedAt'
                AND "OpenStackResource"."facts" ? 'vouchedAt'
                AND EXCLUDED."facts"->>'vouchedAt' IS DISTINCT FROM "OpenStackResource"."facts"->>'vouchedAt'
              THEN jsonb_build_object(
                'previousVouchedAt', "OpenStackResource"."facts"->'vouchedAt',
                'previousRefreshCycleMinutes', "OpenStackResource"."facts"->'refreshCycleMinutes'
              )
              ELSE '{}'::jsonb
            END,
          "metricsUpdatedAt" = EXCLUDED."metricsUpdatedAt",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "OpenStackResource"."lastSeenAt"
          AND (
            "OpenStackResource"."lastSeenAt" < EXCLUDED."lastSeenAt" - INTERVAL '${touchInterval} seconds'
            OR ${isNewValue("name")}
            OR ${isNewValue("regionName")}
            OR ${isNewValue("availabilityZone")}
            OR ${isNewValue("hypervisorName")}
            OR ${isNewValue("openStackProjectId")}
            OR ${isNewValue("status")}
            OR ${isNewValue("adminState")}
            OR (EXCLUDED."adminState" IS NOT NULL
              AND EXCLUDED."disabledReason" IS DISTINCT FROM "OpenStackResource"."disabledReason")
            OR ${isNewValue("vcpuCapacity")}
            OR ${isNewValue("vcpuAllocated")}
            OR ${isNewValue("memoryCapacityBytes")}
            OR ${isNewValue("memoryAllocatedBytes")}
            OR ${isNewValue("diskCapacityBytes")}
            OR ${isNewValue("diskAllocatedBytes")}
            OR ${isNewValue("instanceCount")}
            OR ("OpenStackResource"."stateChangedAt" IS NULL
              AND EXCLUDED."stateChangedAt" IS NOT NULL)
            -- An event said when since the last write: the next scrape closes that gap as ever.
            OR "OpenStackResource"."stateChangedAt" > "OpenStackResource"."lastSeenAt"
            -- A key set to null is a change too: it is how a fact that went away says so.
            OR (COALESCE("OpenStackResource"."facts", '{}'::jsonb) || EXCLUDED."facts")
              IS DISTINCT FROM "OpenStackResource"."facts"
          )
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * When parts really changed state, from what the cloud's own notifications say, where
   * a scrape could only say when it noticed. Returns the changes that matched no row
   * that exists: a part the scrape has not reported yet, which OpenStackEventRecorder
   * tries again after the next scrape.
   *
   * An event only ever moves a date forward, so one arriving late cannot undo a newer one.
   * The exception is a row a scrape dated in the same round, whose date is the scrape's
   * and never the real one: the event's is better, so long as it is close enough to be
   * about the same change. A scrape in turn leaves alone a date an event set since the
   * scrape before (bulkUpsert), so the two cannot take turns overwriting each other.
   */
  @CaptureSpan()
  public async recordStateChanges(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    changes: Array<OpenStackStateChange>;
  }): Promise<Array<OpenStackStateChange>> {
    const now: number = Date.now();
    const usable: Array<OpenStackStateChange> = data.changes.filter(
      (change: OpenStackStateChange): boolean => {
        // A date from a clock that is ahead would hold every later change back.
        return (
          !Number.isNaN(change.at.getTime()) &&
          change.at.getTime() <= now + MAX_STATE_CHANGE_CLOCK_SKEW_IN_MS
        );
      },
    );
    const byId: Array<OpenStackStateChange> = usable.filter(
      (change: OpenStackStateChange): boolean => {
        return Boolean(change.externalId);
      },
    );
    const services: Array<OpenStackStateChange> = usable.filter(
      (change: OpenStackStateChange): boolean => {
        return !change.externalId && Boolean(change.binary && change.host);
      },
    );
    const unmatched: Array<OpenStackStateChange> = [];

    if (byId.length > 0) {
      const rows: Array<JSONObject> = (await this.getRepository().manager.query(
        `
        SELECT DISTINCT ON (part."kind", part."externalId") part."kind", part."externalId"
        FROM "OpenStackResource" AS part
        JOIN unnest($3::text[], $4::text[]) AS change("kind", "externalId")
          ON part."kind" = change."kind" AND part."externalId" = change."externalId"
        WHERE part."projectId" = $1 AND part."openStackCloudId" = $2
        `,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          byId.map((change: OpenStackStateChange): string => {
            return change.kind;
          }),
          byId.map((change: OpenStackStateChange): string => {
            return change.externalId;
          }),
        ],
      )) as Array<JSONObject>;
      const found: Set<string> = new Set(
        rows.map((row: JSONObject): string => {
          return `${row["kind"]}/${row["externalId"]}`;
        }),
      );

      await this.getRepository().manager.query(
        `
        UPDATE "OpenStackResource" AS part
        SET "stateChangedAt" = change."at", "updatedAt" = now()
        FROM unnest($3::text[], $4::text[], $5::timestamptz[])
          AS change("kind", "externalId", "at")
        WHERE part."projectId" = $1 AND part."openStackCloudId" = $2
          AND part."kind" = change."kind" AND part."externalId" = change."externalId"
          AND (
            part."stateChangedAt" IS NULL
            OR part."stateChangedAt" < change."at"
            OR (
              part."stateChangedAt" = part."lastSeenAt"
              AND change."at" > part."stateChangedAt" - interval '10 minutes'
            )
          )
        `,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          byId.map((change: OpenStackStateChange): string => {
            return change.kind;
          }),
          byId.map((change: OpenStackStateChange): string => {
            return change.externalId;
          }),
          byId.map((change: OpenStackStateChange): string => {
            return change.at.toISOString();
          }),
        ],
      );

      for (const change of byId) {
        if (!found.has(`${change.kind}/${change.externalId}`)) {
          unmatched.push(change);
        }
      }
    }

    if (services.length > 0) {
      /*
       * A worker's id holds its region, which a notification does not say, so it is
       * found by its binary and host, which Nova's service list and its notifications
       * both write the same way.
       */
      await this.getRepository().manager.query(
        `
        UPDATE "OpenStackResource" AS part
        SET "stateChangedAt" = change."at", "updatedAt" = now()
        FROM unnest($3::text[], $4::text[], $5::timestamptz[])
          AS change("binary", "host", "at")
        WHERE part."projectId" = $1 AND part."openStackCloudId" = $2
          AND part."kind" = '${OpenStackResourceKind.Service}'
          AND part."name" = change."binary"
          AND part."facts"->>'host' = change."host"
          AND (
            part."stateChangedAt" IS NULL
            OR part."stateChangedAt" < change."at"
            OR (
              part."stateChangedAt" = part."lastSeenAt"
              AND change."at" > part."stateChangedAt" - interval '10 minutes'
            )
          )
        `,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          services.map((change: OpenStackStateChange): string => {
            return change.binary;
          }),
          services.map((change: OpenStackStateChange): string => {
            return change.host;
          }),
          services.map((change: OpenStackStateChange): string => {
            return change.at.toISOString();
          }),
        ],
      );
    }

    return unmatched;
  }

  /**
   * The cloud's numbers, counted from its rows. One indexed read, so the list page,
   * the sidebar and the Overview can never disagree.
   *
   * A service someone disabled is not counted as down: that is planned work. Nor is
   * an instance's flavor counted towards capacity: only a Hypervisor row has any.
   *
   * Capacity is what the cloud can give: a hypervisor Nova lost or someone disabled is
   * in neither number, because Nova keeps reporting its last figures and those must
   * not read as room to spare. Nova's "internal" zone is where its own control services
   * sit and no instance can go, so it is not a zone anyone would count.
   *
   * With a region, what that region holds. Projects and domains belong to a Keystone
   * rather than to a region, so they count whichever one is read.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    regionName?: string | null | undefined;
  }): Promise<OpenStackInventorySummary> {
    const scope: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
      data.regionName || null,
    ];
    const inRegion: string = `($3::text IS NULL OR "regionName" = $3 OR "regionName" IS NULL)`;

    const rows: Array<{
      kind: string;
      count: string;
      activeCount: string;
      downCount: string;
      vcpuCapacity: string | null;
      vcpuAllocated: string | null;
      memoryCapacity: string | null;
      memoryAllocated: string | null;
      diskCapacity: string | null;
      diskAllocated: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "kind",
              COUNT(*)::text AS "count",
              COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::text AS "activeCount",
              COUNT(*) FILTER (
                WHERE "status" = '${OPENSTACK_SERVICE_STATUS_DOWN}'
                  AND COALESCE("adminState", '') NOT IN ('disabled', 'down')
              )::text AS "downCount",
              SUM("vcpuCapacity") FILTER (WHERE ${CAN_GIVE})::text AS "vcpuCapacity",
              SUM("vcpuAllocated") FILTER (WHERE ${CAN_GIVE})::text AS "vcpuAllocated",
              SUM("memoryCapacityBytes") FILTER (WHERE ${CAN_GIVE})::text AS "memoryCapacity",
              SUM("memoryAllocatedBytes") FILTER (WHERE ${CAN_GIVE})::text AS "memoryAllocated",
              SUM("diskCapacityBytes") FILTER (WHERE ${CAN_GIVE})::text AS "diskCapacity",
              SUM("diskAllocatedBytes") FILTER (WHERE ${CAN_GIVE})::text AS "diskAllocated"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
         AND ${inRegion}
       GROUP BY "kind"`,
      scope,
    );

    const places: Array<{
      regionCount: string;
      availabilityZoneCount: string;
      services: Array<string> | null;
    }> = await this.getRepository().manager.query(
      `SELECT COUNT(DISTINCT "regionName")::text AS "regionCount",
              ARRAY_AGG(DISTINCT "name") FILTER (
                WHERE "kind" = '${OpenStackResourceKind.Api}'
              ) AS "services",
              COUNT(DISTINCT "availabilityZone") FILTER (
                WHERE "availabilityZone" <> 'internal' AND (
                  "kind" = '${OpenStackResourceKind.Hypervisor}'
                  OR ("kind" = '${OpenStackResourceKind.Service}'
                    AND "facts"->>'family' = 'compute')
                )
              )::text AS "availabilityZoneCount"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
         AND ${inRegion}
         AND "kind" IN (
           '${OpenStackResourceKind.Api}',
           '${OpenStackResourceKind.Hypervisor}',
           '${OpenStackResourceKind.Service}'
         )`,
      scope,
    );

    const toNumber: (value: string | null | undefined) => number = (
      value: string | null | undefined,
    ): number => {
      const parsed: number = Number.parseFloat(value || "0");
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const rowOf: (
      kind: OpenStackResourceKind,
    ) => (typeof rows)[number] | null = (
      kind: OpenStackResourceKind,
    ): (typeof rows)[number] | null => {
      return (
        rows.find((row: (typeof rows)[number]) => {
          return row.kind === kind;
        }) || null
      );
    };
    const countOf: (kind: OpenStackResourceKind) => number = (
      kind: OpenStackResourceKind,
    ): number => {
      return toNumber(rowOf(kind)?.count);
    };

    const hypervisors: (typeof rows)[number] | null = rowOf(
      OpenStackResourceKind.Hypervisor,
    );
    const pools: (typeof rows)[number] | null = rowOf(
      OpenStackResourceKind.StoragePool,
    );

    return {
      regionCount: toNumber(places[0]?.regionCount),
      availabilityZoneCount: toNumber(places[0]?.availabilityZoneCount),
      hypervisorCount: countOf(OpenStackResourceKind.Hypervisor),
      instanceCount: countOf(OpenStackResourceKind.Instance),
      activeInstanceCount: toNumber(
        rowOf(OpenStackResourceKind.Instance)?.activeCount,
      ),
      volumeCount: countOf(OpenStackResourceKind.Volume),
      networkCount: countOf(OpenStackResourceKind.Network),
      routerCount: countOf(OpenStackResourceKind.Router),
      floatingIpCount: countOf(OpenStackResourceKind.FloatingIp),
      projectCount: countOf(OpenStackResourceKind.Project),
      serviceCount: countOf(OpenStackResourceKind.Service),
      downServiceCount: toNumber(
        rowOf(OpenStackResourceKind.Service)?.downCount,
      ),
      bareMetalNodeCount: countOf(OpenStackResourceKind.BareMetalNode),
      bareMetalProviderCount: countOf(OpenStackResourceKind.PlacementProvider),
      services: (places[0]?.services || []).filter(
        (service: string | null): service is string => {
          return Boolean(service);
        },
      ),
      vcpuCapacity: toNumber(hypervisors?.vcpuCapacity),
      vcpuAllocated: toNumber(hypervisors?.vcpuAllocated),
      memoryCapacityBytes: toNumber(hypervisors?.memoryCapacity),
      memoryAllocatedBytes: toNumber(hypervisors?.memoryAllocated),
      storageCapacityBytes: toNumber(pools?.diskCapacity),
      storageUsedBytes: toNumber(pools?.diskAllocated),
      stackCount: countOf(OpenStackResourceKind.Stack),
      containerClusterCount: countOf(OpenStackResourceKind.ContainerCluster),
    };
  }

  /**
   * What each region holds, for the Overview's Regions card: one read grouped by region
   * and kind, so a cloud of many regions costs what a cloud of one does. Capacity is
   * what a region can give, as getInventorySummary counts it. A row with no region is
   * Keystone's, or was collected before anything named its region, and is in none.
   */
  @CaptureSpan()
  public async getRegionSummaries(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<Array<OpenStackRegionSummary>> {
    const rows: Array<{
      regionName: string;
      kind: string;
      count: string;
      downCount: string;
      vcpuCapacity: string | null;
      vcpuAllocated: string | null;
      memoryCapacity: string | null;
      memoryAllocated: string | null;
      diskCapacity: string | null;
      diskAllocated: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "kind",
              COUNT(*)::text AS "count",
              COUNT(*) FILTER (
                WHERE "status" = '${OPENSTACK_SERVICE_STATUS_DOWN}'
                  AND COALESCE("adminState", '') NOT IN ('disabled', 'down')
              )::text AS "downCount",
              SUM("vcpuCapacity") FILTER (WHERE ${CAN_GIVE})::text AS "vcpuCapacity",
              SUM("vcpuAllocated") FILTER (WHERE ${CAN_GIVE})::text AS "vcpuAllocated",
              SUM("memoryCapacityBytes") FILTER (WHERE ${CAN_GIVE})::text AS "memoryCapacity",
              SUM("memoryAllocatedBytes") FILTER (WHERE ${CAN_GIVE})::text AS "memoryAllocated",
              SUM("diskCapacityBytes") FILTER (WHERE ${CAN_GIVE})::text AS "diskCapacity",
              SUM("diskAllocatedBytes") FILTER (WHERE ${CAN_GIVE})::text AS "diskAllocated"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
         AND "regionName" IS NOT NULL
         AND "kind" IN (
           '${OpenStackResourceKind.Api}',
           '${OpenStackResourceKind.Service}',
           '${OpenStackResourceKind.Hypervisor}',
           '${OpenStackResourceKind.Instance}',
           '${OpenStackResourceKind.StoragePool}'
         )
       GROUP BY "regionName", "kind"`,
      [data.projectId.toString(), data.openStackCloudId.toString()],
    );

    const toNumber: (value: string | null | undefined) => number = (
      value: string | null | undefined,
    ): number => {
      const parsed: number = Number.parseFloat(value || "0");
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const regions: Map<string, OpenStackRegionSummary> = new Map();

    for (const row of rows) {
      const region: OpenStackRegionSummary = regions.get(row.regionName) || {
        regionName: row.regionName,
        apiCount: 0,
        downApiCount: 0,
        serviceCount: 0,
        downServiceCount: 0,
        hypervisorCount: 0,
        instanceCount: 0,
        vcpuCapacity: 0,
        vcpuAllocated: 0,
        memoryCapacityBytes: 0,
        memoryAllocatedBytes: 0,
        storageCapacityBytes: 0,
        storageUsedBytes: 0,
      };

      switch (row.kind) {
        case OpenStackResourceKind.Api:
          region.apiCount = toNumber(row.count);
          region.downApiCount = toNumber(row.downCount);
          break;
        case OpenStackResourceKind.Service:
          region.serviceCount = toNumber(row.count);
          region.downServiceCount = toNumber(row.downCount);
          break;
        case OpenStackResourceKind.Hypervisor:
          region.hypervisorCount = toNumber(row.count);
          region.vcpuCapacity = toNumber(row.vcpuCapacity);
          region.vcpuAllocated = toNumber(row.vcpuAllocated);
          region.memoryCapacityBytes = toNumber(row.memoryCapacity);
          region.memoryAllocatedBytes = toNumber(row.memoryAllocated);
          break;
        case OpenStackResourceKind.Instance:
          region.instanceCount = toNumber(row.count);
          break;
        case OpenStackResourceKind.StoragePool:
          region.storageCapacityBytes = toNumber(row.diskCapacity);
          region.storageUsedBytes = toNumber(row.diskAllocated);
          break;
        default:
          break;
      }

      regions.set(row.regionName, region);
    }

    return Array.from(regions.values()).sort(
      (first: OpenStackRegionSummary, second: OpenStackRegionSummary) => {
        return first.regionName.localeCompare(second.regionName);
      },
    );
  }

  /**
   * Who holds the most of a cloud or a region, for the Overview. Two indexed reads
   * grouped by project: what a project runs and what it has asked Cinder for, which are
   * what Nova and Cinder say. How busy any of it is takes host or libvirt data.
   */
  @CaptureSpan()
  public async getTopConsumers(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    regionName?: string | null | undefined;
  }): Promise<OpenStackTopConsumers> {
    const scope: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
      data.regionName || null,
    ];

    const top: (query: {
      kind: OpenStackResourceKind;
      value: string;
    }) => Promise<Array<{ projectId: string; value: string }>> = async (query: {
      kind: OpenStackResourceKind;
      value: string;
    }): Promise<Array<{ projectId: string; value: string }>> => {
      return await this.getRepository().manager.query(
        `SELECT "openStackProjectId" AS "projectId", ${query.value}::text AS "value"
         FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${query.kind}' AND "deletedAt" IS NULL
           AND "openStackProjectId" IS NOT NULL
           AND ($3::text IS NULL OR "regionName" = $3)
         GROUP BY "openStackProjectId"
         ORDER BY ${query.value} DESC NULLS LAST, "openStackProjectId" ASC
         LIMIT ${OPENSTACK_TOP_CONSUMERS_LIMIT}`,
        scope,
      );
    };

    const byInstances: Array<{ projectId: string; value: string }> = await top({
      kind: OpenStackResourceKind.Instance,
      value: `COUNT(*)`,
    });
    const byVolumeBytes: Array<{ projectId: string; value: string }> =
      await top({
        kind: OpenStackResourceKind.Volume,
        value: `COALESCE(SUM("diskCapacityBytes"), 0)`,
      });

    const projectIds: Array<string> = Array.from(
      new Set(
        [...byInstances, ...byVolumeBytes].map(
          (row: { projectId: string; value: string }): string => {
            return row.projectId;
          },
        ),
      ),
    );
    const names: Record<string, string> = {};
    if (projectIds.length > 0) {
      const named: Array<{ externalId: string; name: string | null }> =
        await this.getRepository().manager.query(
          `SELECT "externalId", "name" FROM "OpenStackResource"
           WHERE "projectId" = $1 AND "openStackCloudId" = $2
             AND "kind" = '${OpenStackResourceKind.Project}'
             AND "externalId" = ANY($3::text[]) AND "deletedAt" IS NULL`,
          [
            data.projectId.toString(),
            data.openStackCloudId.toString(),
            projectIds,
          ],
        );
      for (const row of named) {
        if (row.name) {
          names[row.externalId] = row.name;
        }
      }
    }

    const toConsumers: (
      rows: Array<{ projectId: string; value: string }>,
    ) => Array<OpenStackTopConsumer> = (
      rows: Array<{ projectId: string; value: string }>,
    ): Array<OpenStackTopConsumer> => {
      return rows.map((row: { projectId: string; value: string }) => {
        const value: number = Number.parseFloat(row.value);
        return {
          projectId: row.projectId,
          name: names[row.projectId] || null,
          value: Number.isFinite(value) ? value : 0,
        };
      });
    };

    return {
      projectsByInstances: toConsumers(byInstances),
      projectsByVolumeBytes: toConsumers(byVolumeBytes),
    };
  }

  /**
   * The rows that may need someone, read with one indexed statement per kind so a
   * cloud of hundreds of thousands of instances answers as fast as a small one. This
   * chooses by the same lines as OpenStackHealth, and OpenStackHealth has the last
   * word on each row: a line drawn a little wide here costs a row, never a mistake.
   *
   * Hypervisors and services are read whole up to a line, because the rules read them together:
   * how many schedulers are left, how many instances a dead host held. A cloud of thousands of
   * hosts holds tens of thousands of them, nearly all fine, so past it only those that may need
   * someone are read, and the rest are counted (readWholeKind).
   */
  @CaptureSpan()
  public async getAttentionRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    now: Date;
    /*
     * Only what these OpenStack projects own: the parts of a page of the Projects list,
     * or of one project's page. The cloud's own services and hosts are nobody's.
     */
    openStackProjectIds?: Array<string> | undefined;
    rowsPerKind?: number | undefined;
    /*
     * Only what is in this region, so each region of a cloud gets a whole answer of its
     * own however much is wrong elsewhere. A project belongs to no region, and says
     * which region its quota is in.
     */
    regionName?: string | null | undefined;
  }): Promise<OpenStackAttentionRows> {
    const instanceStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_INSTANCE_STUCK_MINUTES,
    );
    const volumeStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_VOLUME_STUCK_MINUTES,
    );
    const imageStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_IMAGE_STUCK_MINUTES,
    );
    const stackStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_STACK_STUCK_MINUTES,
    );
    const clusterStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_CONTAINER_CLUSTER_STUCK_MINUTES,
    );
    const bareMetalStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_BARE_METAL_STUCK_MINUTES,
    );
    const base: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];

    const statuses: (values: ReadonlySet<string>) => Array<string> = (
      values: ReadonlySet<string>,
    ): Array<string> => {
      return Array.from(values);
    };

    const queries: Array<{
      kind: OpenStackResourceKind;
      where: string;
      params: Array<unknown>;
      orderBy?: string;
      // Read through readWholeKind: see above.
      whole?: boolean;
    }> = [
      {
        kind: OpenStackResourceKind.Api,
        where: `("status" = '${OPENSTACK_SERVICE_STATUS_DOWN}'
          OR (NOT ("name" = ANY($3::text[])) AND "lastSeenAt" <= $4))`,
        params: [
          Array.from(OPENSTACK_SERVICES_EVERY_CLOUD_RUNS),
          OneUptimeDate.addRemoveMinutes(
            data.now,
            -OPENSTACK_QUIET_SERVICE_MINUTES,
          ),
        ],
      },
      {
        kind: OpenStackResourceKind.Service,
        where: "TRUE",
        params: [],
        whole: true,
      },
      {
        kind: OpenStackResourceKind.Hypervisor,
        where: "TRUE",
        params: [],
        whole: true,
      },
      // How many of a cluster are left is what decides how bad one down is, as for workers.
      {
        kind: OpenStackResourceKind.ControlPlane,
        where: "TRUE",
        params: [],
        whole: true,
      },
      {
        kind: OpenStackResourceKind.StoragePool,
        /*
         * Past the line, or on a Ceph cluster someone linked it to, which is what can say
         * a half-empty pool is in trouble: the API adds that cluster's health to these rows.
         */
        where: `("diskAllocatedBytes" * 100 > "diskCapacityBytes" * ${OPENSTACK_STORAGE_POOL_WARNING_PERCENT}
          OR "facts" ? 'cephLink' OR "facts" ? 'cephFsid')`,
        params: [],
      },
      {
        kind: OpenStackResourceKind.Instance,
        where: `("status" = 'ERROR' OR ("status" = ANY($3::text[]) AND "stateChangedAt" <= $4))`,
        params: [
          statuses(OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES),
          instanceStuckBefore,
        ],
        orderBy: `"stateChangedAt" DESC NULLS LAST`,
      },
      {
        kind: OpenStackResourceKind.Volume,
        where: `("status" = ANY($3::text[]) OR ("status" = ANY($4::text[]) AND "stateChangedAt" <= $5))`,
        params: [
          statuses(OPENSTACK_VOLUME_ERROR_STATUSES),
          statuses(OPENSTACK_VOLUME_TRANSITIONAL_STATUSES),
          volumeStuckBefore,
        ],
        orderBy: `"stateChangedAt" DESC NULLS LAST`,
      },
      {
        kind: OpenStackResourceKind.Image,
        where: `"status" = ANY($3::text[]) AND "stateChangedAt" <= $4`,
        params: [
          statuses(OPENSTACK_IMAGE_TRANSITIONAL_STATUSES),
          imageStuckBefore,
        ],
        orderBy: `"stateChangedAt" DESC NULLS LAST`,
      },
      {
        kind: OpenStackResourceKind.Stack,
        where: `("status" = ANY($3::text[]) OR ("status" = ANY($4::text[]) AND "stateChangedAt" <= $5))`,
        params: [
          statuses(OPENSTACK_STACK_FAILED_STATUSES),
          statuses(OPENSTACK_STACK_IN_PROGRESS_STATUSES),
          stackStuckBefore,
        ],
        orderBy: `"stateChangedAt" DESC NULLS LAST`,
      },
      {
        kind: OpenStackResourceKind.ContainerCluster,
        where: `("status" = ANY($3::text[])
          OR ("status" = ANY($4::text[]) AND "stateChangedAt" <= $5)
          OR "facts"->>'healthStatus' = '${OPENSTACK_CONTAINER_CLUSTER_UNHEALTHY}')`,
        params: [
          statuses(OPENSTACK_CONTAINER_CLUSTER_FAILED_STATUSES),
          statuses(OPENSTACK_CONTAINER_CLUSTER_IN_PROGRESS_STATUSES),
          clusterStuckBefore,
        ],
        orderBy: `"stateChangedAt" DESC NULLS LAST`,
      },
      {
        kind: OpenStackResourceKind.BareMetalNode,
        /*
         * Failed; on its way for too long; in maintenance for too long; or deployed with its power
         * off, unless Nova says the instance on it was stopped, which is planned. Nova names a
         * node's instance's hypervisor by the node's UUID.
         */
        where: `("status" = ANY($3::text[])
          OR ("status" = ANY($4::text[])
            AND COALESCE("adminState", '') <> '${OPENSTACK_BARE_METAL_IN_MAINTENANCE}'
            AND ("facts"->>'provisionUpdatedAt' <= $5
              OR ("facts"->>'provisionUpdatedAt' IS NULL AND "stateChangedAt" <= $6)))
          OR ("adminState" = '${OPENSTACK_BARE_METAL_IN_MAINTENANCE}' AND "stateChangedAt" <= $7)
          OR ("status" = 'active' AND "facts"->>'powerState' = 'power off'
            AND COALESCE("adminState", '') <> '${OPENSTACK_BARE_METAL_IN_MAINTENANCE}'
            AND NOT EXISTS (
              SELECT 1 FROM "OpenStackResource" AS instance
              WHERE instance."projectId" = $1 AND instance."openStackCloudId" = $2
                AND instance."kind" = '${OpenStackResourceKind.Instance}'
                AND instance."deletedAt" IS NULL
                AND instance."hypervisorName" = "OpenStackResource"."externalId"
                AND instance."status" = 'SHUTOFF'
            )))`,
        params: [
          statuses(OPENSTACK_BARE_METAL_ERROR_STATES),
          statuses(OPENSTACK_BARE_METAL_TRANSITIONAL_STATES),
          bareMetalStuckBefore.toISOString(),
          bareMetalStuckBefore,
          OneUptimeDate.addRemoveMinutes(
            data.now,
            -OPENSTACK_BARE_METAL_MAINTENANCE_WARNING_DAYS * 24 * 60,
          ),
        ],
        // What failed before what can wait, however many of those there are.
        orderBy: `CASE WHEN "status" = ANY($3::text[]) THEN 0 ELSE 1 END, "name" ASC NULLS LAST`,
      },
      {
        kind: OpenStackResourceKind.Network,
        where: `"facts"->>'isExternal' = 'true'
          AND ("facts"->>'ipsUsed')::numeric * 100 > ("facts"->>'ipsTotal')::numeric * ${OPENSTACK_IP_POOL_WARNING_PERCENT}`,
        params: [],
      },
      {
        kind: OpenStackResourceKind.Router,
        where: `COALESCE("adminState", 'up') <> 'down'
          AND (("status" IS NOT NULL AND "status" <> 'ACTIVE') OR "facts" ? 'l3Agents')`,
        params: [],
      },
      {
        kind: OpenStackResourceKind.FloatingIp,
        where: `"status" <> 'ACTIVE'
          AND COALESCE("facts"->>'routerId', "facts"->>'portId', '') <> ''`,
        params: [],
      },
      {
        kind: OpenStackResourceKind.Project,
        where: getOpenStackQuotaAtLineSql({
          linePercent: OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
          observedSinceParam: "$3",
        }),
        params: [
          OneUptimeDate.addRemoveMinutes(
            data.now,
            -OPENSTACK_QUOTA_STALE_MINUTES,
          ).toISOString(),
        ],
      },
    ];

    const rows: Array<JSONObject> = [];
    const totalsByKind: Record<string, number> = {};
    const rowsPerKind: number = data.rowsPerKind || ATTENTION_ROWS_PER_KIND;
    const leftOut: Array<OpenStackRowsLeftOut> = [];

    for (const query of queries) {
      let ownedBy: string = "";
      const params: Array<unknown> = [...base, ...query.params];
      if (data.openStackProjectIds) {
        // A project's parts, so the cloud's own services and hosts are left out.
        if (query.whole || query.kind === OpenStackResourceKind.Api) {
          continue;
        }
        params.push(data.openStackProjectIds);
        ownedBy = `AND "openStackProjectId" = ANY($${params.length}::text[])`;
      }
      if (data.regionName && query.kind !== OpenStackResourceKind.Project) {
        params.push(data.regionName);
        ownedBy = `${ownedBy} AND "regionName" = $${params.length}`;
      }

      if (query.whole) {
        const read: {
          rows: Array<JSONObject>;
          leftOut: Array<OpenStackRowsLeftOut>;
        } = await this.readWholeKind({
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: query.kind,
          regionName: data.regionName,
        });

        rows.push(...read.rows);
        leftOut.push(...read.leftOut);
        totalsByKind[query.kind] =
          read.rows.length +
          read.leftOut.reduce(
            (sum: number, group: OpenStackRowsLeftOut): number => {
              return sum + group.count;
            },
            0,
          );
        continue;
      }

      const limit: string = `LIMIT ${rowsPerKind}`;
      const found: Array<JSONObject> = (
        (await this.getRepository().manager.query(
          `SELECT ${ROW_COLUMNS}
           FROM "OpenStackResource"
           WHERE "projectId" = $1 AND "openStackCloudId" = $2
             AND "kind" = '${query.kind}' AND "deletedAt" IS NULL
             AND ${query.where}
             ${ownedBy}
           ORDER BY ${query.orderBy || `"name" ASC NULLS LAST`}
           ${limit}`,
          params,
        )) as Array<JSONObject>
      ).map(toRowWithNumbers);
      rows.push(...found);

      if (found.length < rowsPerKind) {
        totalsByKind[query.kind] = found.length;
      } else {
        const counted: Array<{ count: string }> =
          await this.getRepository().manager.query(
            `SELECT COUNT(*)::text AS "count"
             FROM "OpenStackResource"
             WHERE "projectId" = $1 AND "openStackCloudId" = $2
               AND "kind" = '${query.kind}' AND "deletedAt" IS NULL
               AND ${query.where}
               ${ownedBy}`,
            params,
          );
        totalsByKind[query.kind] = Number.parseInt(
          counted[0]?.count || "0",
          10,
        );
      }
    }

    return { rows, totalsByKind, leftOut };
  }

  /**
   * Hosts, workers or what a cloud stands on, for a page that has to count them. All of them up to
   * OPENSTACK_WHOLE_KIND_ROWS. Past that, the ones a person could need to read, down first, with
   * how many others there are by state. Those are never fewer than the rules need: a worker of
   * which one down of several matters is always read, and so is a host past an allocation line.
   */
  private async readWholeKind(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    kind: OpenStackResourceKind;
    regionName?: string | null | undefined;
    // What a person searched for: a host or binary, which a page cannot look for in what it has not read.
    search?: string | null | undefined;
  }): Promise<{
    rows: Array<JSONObject>;
    leftOut: Array<OpenStackRowsLeftOut>;
  }> {
    const params: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];
    let scope: string = "";

    if (data.regionName) {
      params.push(data.regionName);
      scope = `AND "regionName" = $${params.length}`;
    }

    const table: string = `"OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${data.kind}' AND "deletedAt" IS NULL
         ${scope}`;

    const all: Array<JSONObject> = (
      (await this.getRepository().manager.query(
        `SELECT ${ROW_COLUMNS} FROM ${table}
         ORDER BY "name" ASC NULLS LAST
         LIMIT ${OPENSTACK_WHOLE_KIND_ROWS + 1}`,
        params,
      )) as Array<JSONObject>
    ).map(toRowWithNumbers);

    const isHost: boolean = data.kind === OpenStackResourceKind.Hypervisor;

    if (
      all.length <= OPENSTACK_WHOLE_KIND_ROWS ||
      (!isHost && data.kind !== OpenStackResourceKind.Service)
    ) {
      return { rows: all, leftOut: [] };
    }

    const isUnwell: string = `COALESCE("status", '') = '${OPENSTACK_SERVICE_STATUS_DOWN}'
      OR COALESCE("adminState", '') IN ('disabled', 'down')`;
    const pastLine: (allocated: string, capacity: string) => string = (
      allocated: string,
      capacity: string,
    ): string => {
      return `"${allocated}" * 100 > "${capacity}" * ${OPENSTACK_ALLOCATION_WARNING_PERCENT}`;
    };
    const isWorthReading: string = isHost
      ? `${isUnwell}
         OR ${pastLine("vcpuAllocated", "vcpuCapacity")}
         OR ${pastLine("memoryAllocatedBytes", "memoryCapacityBytes")}
         OR ${pastLine("diskAllocatedBytes", "diskCapacityBytes")}`
      : `${isUnwell}
         OR "name" IN (${Array.from(OPENSTACK_REDUNDANT_WORKERS)
           .map((worker: string): string => {
             return `'${worker}'`;
           })
           .join(", ")})`;

    let searched: string = "";
    const readParams: Array<unknown> = [...params];

    if (data.search) {
      readParams.push(`%${data.search.replace(/[\\%_]/g, "\\$&")}%`);
      searched = `OR "name" ILIKE $${readParams.length} OR "facts"->>'host' ILIKE $${readParams.length}`;
    }

    const rows: Array<JSONObject> = (
      (await this.getRepository().manager.query(
        `SELECT ${ROW_COLUMNS} FROM ${table}
           AND (${isWorthReading} ${searched})
         ORDER BY CASE WHEN "status" = '${OPENSTACK_SERVICE_STATUS_DOWN}' THEN 0 ELSE 1 END,
           "name" ASC NULLS LAST
         LIMIT ${OPENSTACK_WHOLE_KIND_ROWS}`,
        readParams,
      )) as Array<JSONObject>
    ).map(toRowWithNumbers);

    const stateOf: string = `CASE
        WHEN COALESCE("adminState", '') IN ('disabled', 'down') THEN 'disabled'
        WHEN "status" = '${OPENSTACK_SERVICE_STATUS_DOWN}' THEN 'down'
        ELSE 'up'
      END`;
    const nameOf: string = isHost ? "NULL::text" : `"name"`;
    const familyOf: string = isHost ? "NULL::text" : `"facts"->>'family'`;

    const counted: Array<{
      regionName: string | null;
      name: string | null;
      family: string | null;
      state: OpenStackRowState;
      count: string;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", ${nameOf} AS "name", ${familyOf} AS "family",
              ${stateOf} AS "state", COUNT(*)::text AS "count"
       FROM ${table}
       GROUP BY 1, 2, 3, 4`,
      params,
    );

    const keyOf: (group: {
      regionName: string | null;
      name: string | null;
      family: string | null;
      state: OpenStackRowState;
    }) => string = (group: {
      regionName: string | null;
      name: string | null;
      family: string | null;
      state: OpenStackRowState;
    }): string => {
      return JSON.stringify([
        group.regionName,
        group.name,
        group.family,
        group.state,
      ]);
    };

    // What was read comes off what was counted, and what is left is what a page did not get.
    const read: Map<string, number> = new Map();

    for (const row of rows) {
      const adminState: unknown = row["adminState"];
      const facts: JSONObject = (row["facts"] as JSONObject) || {};
      const key: string = keyOf({
        regionName: (row["regionName"] as string | null) ?? null,
        name: isHost ? null : (row["name"] as string | null) ?? null,
        family: isHost ? null : (facts["family"] as string | null) ?? null,
        state:
          adminState === "disabled" || adminState === "down"
            ? "disabled"
            : row["status"] === OPENSTACK_SERVICE_STATUS_DOWN
              ? "down"
              : "up",
      });

      read.set(key, (read.get(key) || 0) + 1);
    }

    const leftOut: Array<OpenStackRowsLeftOut> = [];

    for (const group of counted) {
      const count: number =
        Number.parseInt(group.count, 10) - (read.get(keyOf(group)) || 0);

      if (count > 0) {
        leftOut.push({
          kind: data.kind,
          regionName: group.regionName,
          name: group.name,
          family: group.family,
          state: group.state,
          count: count,
        });
      }
    }

    return { rows, leftOut };
  }

  /**
   * A cloud's workers for its Services page, as much of them as it can read: see readWholeKind. A
   * search brings what it finds, wherever that is in the cloud.
   */
  @CaptureSpan()
  public async getServiceRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    search?: string | null | undefined;
  }): Promise<OpenStackServiceRowsRead> {
    const workers: {
      rows: Array<JSONObject>;
      leftOut: Array<OpenStackRowsLeftOut>;
    } = await this.readWholeKind({
      projectId: data.projectId,
      openStackCloudId: data.openStackCloudId,
      kind: OpenStackResourceKind.Service,
      search: data.search,
    });

    return { workers: workers.rows, leftOut: workers.leftOut };
  }

  /**
   * How many of a kind there are by what they hold, in each region, and what they add up
   * to. One statement over the (projectId, openStackCloudId, kind, ...) indexes, so a list
   * can say how many instances use each flavor on its page without a count per flavor.
   */
  @CaptureSpan()
  public async getCounts(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    kind: OpenStackResourceKind;
    by: OpenStackCountBy;
  }): Promise<Array<OpenStackCountRow>> {
    const column: string = COUNT_COLUMNS[data.by];
    const rows: Array<{
      value: string | null;
      regionName: string | null;
      count: string;
      sizeBytes: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT ${column} AS "value", "regionName",
              COUNT(*)::text AS "count",
              SUM("diskCapacityBytes")::text AS "sizeBytes"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = $3 AND "deletedAt" IS NULL
       GROUP BY ${column}, "regionName"
       ORDER BY COUNT(*) DESC, ${column} ASC
       LIMIT ${OPENSTACK_COUNT_LIMIT}`,
      [data.projectId.toString(), data.openStackCloudId.toString(), data.kind],
    );
    return rows.map((row: (typeof rows)[number]): OpenStackCountRow => {
      return {
        value: row.value,
        regionName: row.regionName,
        count: Number.parseInt(row.count, 10) || 0,
        sizeBytes: Number.parseFloat(row.sizeBytes || "0") || 0,
      };
    });
  }

  /**
   * What a failed part takes with it, by count and by project. One small indexed read
   * per kind of thing affected, so a hypervisor on a cloud of hundreds of thousands of
   * instances answers as fast as one on a small cloud.
   *
   *  - A hypervisor, or the nova-compute on it: its instances. Nova's service knows its
   *    host by the short name and its instances by the full one.
   *  - A Neutron L3 agent: the routers no other alive agent holds, and the floating IPs
   *    going through them. A router another agent can carry has lost nothing.
   *  - A router: the floating IPs going through it.
   *  - A storage pool: its volumes, when the source says where a volume is (the probe
   *    does, the exporter does not, and then this says it cannot tell).
   *  - A bare metal node: the instance Nova has on it, which names the node's UUID as its
   *    hypervisor.
   *  - A service's API in a region: everything of that service in that region, because
   *    nobody there can manage any of it.
   *  - A stack and the Magnum cluster built with it: each names the other, because a failure of
   *    one is the same failure. Only a cluster's stack_id says so, which is on every cluster's
   *    series. What else a stack owns takes a read of its resources, which nothing makes yet.
   */
  @CaptureSpan()
  public async getBlastRadius(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    part: {
      kind: OpenStackResourceKind;
      name?: string | null | undefined;
      regionName?: string | null | undefined;
      hypervisorName?: string | null | undefined;
      externalId?: string | null | undefined;
      facts?: JSONObject | null | undefined;
    };
    // For what has to find one project among them, past the ones an answer names.
    includeEveryProject?: boolean | undefined;
  }): Promise<OpenStackBlastRadius> {
    const { part } = data;
    const counts: Array<{
      count: OpenStackBlastRadiusCount;
      byProject: Array<{ projectId: string | null; count: number }>;
    }> = [];

    const countByProject: (query: {
      kind: OpenStackResourceKind;
      where: string;
      params: Array<unknown>;
    }) => Promise<
      Array<{ projectId: string | null; count: number }>
    > = async (query: {
      kind: OpenStackResourceKind;
      where: string;
      params: Array<unknown>;
    }): Promise<Array<{ projectId: string | null; count: number }>> => {
      const rows: Array<{ projectId: string | null; count: string }> =
        await this.getRepository().manager.query(
          `SELECT "openStackProjectId" AS "projectId", COUNT(*)::text AS "count"
           FROM "OpenStackResource"
           WHERE "projectId" = $1 AND "openStackCloudId" = $2
             AND "kind" = '${query.kind}' AND "deletedAt" IS NULL
             AND ${query.where}
           GROUP BY "openStackProjectId"`,
          [
            data.projectId.toString(),
            data.openStackCloudId.toString(),
            ...query.params,
          ],
        );
      return rows.map((row: { projectId: string | null; count: string }) => {
        return {
          projectId: row.projectId,
          count: Number.parseInt(row.count, 10),
        };
      });
    };

    const finish: (isKnown?: boolean) => Promise<OpenStackBlastRadius> = async (
      isKnown: boolean = true,
    ): Promise<OpenStackBlastRadius> => {
      const projectIds: Array<string> = Array.from(
        new Set(
          counts.flatMap((part: (typeof counts)[number]) => {
            return part.byProject
              .map((one: { projectId: string | null; count: number }) => {
                return one.projectId;
              })
              .filter((projectId: string | null): projectId is string => {
                return Boolean(projectId);
              });
          }),
        ),
      );
      const projectNames: Record<string, string> = {};
      const projectDomains: Record<string, string> = {};
      if (projectIds.length > 0) {
        const named: Array<{
          externalId: string;
          name: string | null;
          domainId: string | null;
        }> = await this.getRepository().manager.query(
          `SELECT "externalId", "name", "facts"->>'domainId' AS "domainId"
             FROM "OpenStackResource"
             WHERE "projectId" = $1 AND "openStackCloudId" = $2
               AND "kind" = '${OpenStackResourceKind.Project}'
               AND "externalId" = ANY($3::text[]) AND "deletedAt" IS NULL`,
          [
            data.projectId.toString(),
            data.openStackCloudId.toString(),
            projectIds,
          ],
        );
        for (const row of named) {
          if (row.name) {
            projectNames[row.externalId] = row.name;
          }
          if (row.domainId) {
            projectDomains[row.externalId] = row.domainId;
          }
        }
      }
      return buildOpenStackBlastRadius({
        counts,
        projectNames,
        projectDomains,
        isKnown,
        includeEveryProject: data.includeEveryProject,
      });
    };

    const floatingIpsThrough: (
      routerIds: Array<string>,
    ) => Promise<void> = async (routerIds: Array<string>): Promise<void> => {
      if (routerIds.length === 0) {
        return;
      }
      counts.push({
        count: "floatingIpCount",
        byProject: await countByProject({
          kind: OpenStackResourceKind.FloatingIp,
          where: `"facts"->>'routerId' = ANY($3::text[])`,
          params: [routerIds],
        }),
      });
    };

    const instancesOn: (hypervisorName: string) => Promise<void> = async (
      hypervisorName: string,
    ): Promise<void> => {
      counts.push({
        count: "instanceCount",
        byProject: await countByProject({
          kind: OpenStackResourceKind.Instance,
          where: `"hypervisorName" = $3 AND "regionName" IS NOT DISTINCT FROM $4`,
          params: [hypervisorName, part.regionName ?? null],
        }),
      });
    };

    if (part.kind === OpenStackResourceKind.Hypervisor) {
      if (part.hypervisorName) {
        await instancesOn(part.hypervisorName);
      }
      return await finish();
    }

    if (
      part.kind === OpenStackResourceKind.Service &&
      part.name === "nova-compute"
    ) {
      const host: string = getOpenStackShortHostName(
        (part.facts?.["host"] as string | undefined) || "",
      );
      // A service says compute-01 where its instances say compute-01.example.internal.
      const hypervisors: Array<{ hypervisorName: string | null }> =
        await this.getRepository().manager.query(
          `SELECT "hypervisorName" FROM "OpenStackResource"
           WHERE "projectId" = $1 AND "openStackCloudId" = $2
             AND "kind" = '${OpenStackResourceKind.Hypervisor}' AND "deletedAt" IS NULL
             AND "regionName" IS NOT DISTINCT FROM $3
             AND ("hypervisorName" = $4 OR "hypervisorName" LIKE $5)`,
          [
            data.projectId.toString(),
            data.openStackCloudId.toString(),
            part.regionName ?? null,
            host,
            // A host's own _ or % is a character, not LIKE's wildcard.
            `${host.replace(/[\\%_]/g, "\\$&")}.%`,
          ],
        );
      for (const hypervisor of hypervisors) {
        if (hypervisor.hypervisorName) {
          await instancesOn(hypervisor.hypervisorName);
        }
      }
      return await finish();
    }

    if (
      part.kind === OpenStackResourceKind.Service &&
      part.name === "neutron-l3-agent"
    ) {
      const agentId: string | undefined = part.facts?.["agentId"] as
        | string
        | undefined;
      if (!agentId) {
        return getEmptyOpenStackBlastRadius(false);
      }
      const routers: Array<{
        externalId: string;
        openStackProjectId: string | null;
        facts: JSONObject;
      }> = await this.getRepository().manager.query(
        `SELECT "externalId", "openStackProjectId", "facts" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Router}' AND "deletedAt" IS NULL
           AND "facts"->'l3Agents' ? $3`,
        [data.projectId.toString(), data.openStackCloudId.toString(), agentId],
      );
      const stranded: typeof routers = routers.filter(
        (router: (typeof routers)[number]) => {
          const others: Array<OpenStackL3AgentFact> = getOpenStackRouterAgents(
            this.withoutAgent(router.facts, agentId),
          );
          return !others.some((agent: OpenStackL3AgentFact) => {
            return agent.isAlive && agent.isAdminUp;
          });
        },
      );
      const byProject: Map<string | null, number> = new Map();
      for (const router of stranded) {
        byProject.set(
          router.openStackProjectId,
          (byProject.get(router.openStackProjectId) || 0) + 1,
        );
      }
      counts.push({
        count: "routerCount",
        byProject: Array.from(byProject.entries()).map(
          ([projectId, count]: [string | null, number]) => {
            return { projectId, count };
          },
        ),
      });
      await floatingIpsThrough(
        stranded.map((router: (typeof routers)[number]) => {
          return router.externalId;
        }),
      );
      return await finish();
    }

    if (part.kind === OpenStackResourceKind.Router) {
      if (part.externalId) {
        await floatingIpsThrough([part.externalId]);
      }
      return await finish();
    }

    if (part.kind === OpenStackResourceKind.BareMetalNode) {
      if (part.externalId) {
        await instancesOn(part.externalId);
      }
      return await finish();
    }

    if (part.kind === OpenStackResourceKind.StoragePool) {
      counts.push({
        count: "volumeCount",
        byProject: await countByProject({
          kind: OpenStackResourceKind.Volume,
          where: `"facts"->>'pool' = $3 AND "regionName" IS NOT DISTINCT FROM $4`,
          params: [part.name || "", part.regionName ?? null],
        }),
      });
      const found: boolean = (counts[0]?.byProject.length || 0) > 0;
      if (found) {
        // What those volumes are attached to, which lose their disks with them.
        const instances: Array<{ projectId: string | null; count: string }> =
          await this.getRepository().manager.query(
            `SELECT instance."openStackProjectId" AS "projectId",
                    COUNT(DISTINCT instance."externalId")::text AS "count"
             FROM "OpenStackResource" AS volume
             JOIN "OpenStackResource" AS instance
               ON instance."projectId" = volume."projectId"
              AND instance."openStackCloudId" = volume."openStackCloudId"
              AND instance."kind" = '${OpenStackResourceKind.Instance}'
              AND instance."externalId" = volume."facts"->>'attachedToInstance'
              AND instance."deletedAt" IS NULL
             WHERE volume."projectId" = $1 AND volume."openStackCloudId" = $2
               AND volume."kind" = '${OpenStackResourceKind.Volume}'
               AND volume."deletedAt" IS NULL
               AND volume."facts"->>'pool' = $3
               AND volume."regionName" IS NOT DISTINCT FROM $4
             GROUP BY instance."openStackProjectId"`,
            [
              data.projectId.toString(),
              data.openStackCloudId.toString(),
              part.name || "",
              part.regionName ?? null,
            ],
          );
        counts.push({
          count: "instanceCount",
          byProject: instances.map(
            (row: { projectId: string | null; count: string }) => {
              return {
                projectId: row.projectId,
                count: Number.parseInt(row.count, 10),
              };
            },
          ),
        });
      }
      if (found) {
        return await finish();
      }
      /*
       * No volume names this pool. If any of the cloud's volumes names a pool, this one holds
       * none. If none does, nothing says where they are, so it cannot tell: the agent's
       * exporter never says, and neither does a probe whose credential Cinder won't tell.
       */
      const named: Array<unknown> = await this.getRepository().manager.query(
        `SELECT 1 FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Volume}' AND "deletedAt" IS NULL
           AND "regionName" IS NOT DISTINCT FROM $3
           AND "facts"->>'pool' IS NOT NULL
         LIMIT 1`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          part.regionName ?? null,
        ],
      );
      return await finish(named.length > 0);
    }

    if (part.kind === OpenStackResourceKind.Api) {
      const kinds: Partial<
        Record<
          string,
          Array<[OpenStackResourceKind, OpenStackBlastRadiusCount]>
        >
      > = {
        [OpenStackServiceType.Compute]: [
          [OpenStackResourceKind.Instance, "instanceCount"],
        ],
        [OpenStackServiceType.Volume]: [
          [OpenStackResourceKind.Volume, "volumeCount"],
        ],
        [OpenStackServiceType.Network]: [
          [OpenStackResourceKind.Router, "routerCount"],
          [OpenStackResourceKind.FloatingIp, "floatingIpCount"],
        ],
        /*
         * Without Keystone nobody can do anything anywhere, and it is global, so it
         * reaches every instance of the cloud.
         */
        [OpenStackServiceType.Identity]: [
          [OpenStackResourceKind.Instance, "instanceCount"],
        ],
        /*
         * Without Placement nothing can be scheduled and without Glance nothing can
         * boot, so every project in the region with an instance is affected, though what
         * runs keeps running.
         */
        [OpenStackServiceType.Placement]: [
          [OpenStackResourceKind.Instance, "instanceCount"],
        ],
        [OpenStackServiceType.Image]: [
          [OpenStackResourceKind.Instance, "instanceCount"],
        ],
        /*
         * Without Heat or Magnum nothing of theirs can be created, changed or deleted, though what
         * they already built keeps running.
         */
        [OpenStackServiceType.Orchestration]: [
          [OpenStackResourceKind.Stack, "stackCount"],
        ],
        [OpenStackServiceType.ContainerInfra]: [
          [OpenStackResourceKind.ContainerCluster, "containerClusterCount"],
        ],
      };
      for (const [kind, count] of kinds[part.name || ""] || []) {
        counts.push({
          count,
          byProject: await countByProject(
            part.name === OpenStackServiceType.Identity
              ? { kind, where: "TRUE", params: [] }
              : {
                  kind,
                  where: `"regionName" IS NOT DISTINCT FROM $3`,
                  params: [part.regionName ?? null],
                },
          ),
        });
      }
      return await finish();
    }

    if (part.kind === OpenStackResourceKind.Stack && part.externalId) {
      return {
        ...(await finish()),
        belongsTo: await this.readClustersOfStack({
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          stackId: part.externalId,
        }),
      };
    }

    if (part.kind === OpenStackResourceKind.ContainerCluster) {
      const stackId: unknown = part.facts?.["stackId"];
      return {
        ...(await finish()),
        belongsTo:
          typeof stackId === "string" && stackId
            ? await this.readStacksById({
                projectId: data.projectId,
                openStackCloudId: data.openStackCloudId,
                stackIds: [stackId],
              })
            : [],
      };
    }

    // Nothing else has a reach of its own that this can read.
    return getEmptyOpenStackBlastRadius(false);
  }

  // The Magnum cluster a stack was built for. More than one would be a guess: see OpenStackLinks.
  private async readClustersOfStack(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    stackId: string;
  }): Promise<Array<OpenStackBlastRadiusOwner>> {
    const rows: Array<OpenStackBlastRadiusOwner> =
      await this.getRepository().manager.query(
        `SELECT "kind", "externalId", "name", "status" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.ContainerCluster}'
           AND "deletedAt" IS NULL
           AND "facts"->>'stackId' = $3
         LIMIT 2`,
        [data.projectId.toString(), data.openStackCloudId.toString(), data.stackId],
      );
    return rows.length === 1 ? rows : [];
  }

  private async readStacksById(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    stackIds: Array<string>;
  }): Promise<Array<OpenStackBlastRadiusOwner>> {
    return await this.getRepository().manager.query(
      `SELECT "kind", "externalId", "name", "status" FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Stack}'
         AND "deletedAt" IS NULL
         AND "externalId" = ANY($3::text[])`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        data.stackIds,
      ],
    );
  }

  /**
   * What there is of each resource class, for the Bare Metal page: one statement over a node's rows,
   * so it reads the same however many there are. What can take an instance is
   * canOpenStackBareMetalNodeTakeAnInstance, which a test holds this to on the same rows.
   */
  @CaptureSpan()
  public async getBareMetalClasses(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    regionName?: string | null | undefined;
  }): Promise<Array<OpenStackBareMetalClass>> {
    const rows: Array<{
      resourceClass: string | null;
      nodeCount: string;
      availableCount: string;
      deployedCount: string;
      maintenanceCount: string;
      failedCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "facts"->>'resourceClass' AS "resourceClass",
              COUNT(*)::text AS "nodeCount",
              COUNT(*) FILTER (
                WHERE "status" = 'available'
                  AND COALESCE("adminState", '') <> '${OPENSTACK_BARE_METAL_IN_MAINTENANCE}'
                  AND COALESCE("facts"->>'powerState', '') NOT IN ('', 'error')
                  AND COALESCE("facts"->>'isRetired', 'false') <> 'true'
              )::text AS "availableCount",
              COUNT(*) FILTER (WHERE "status" = 'active')::text AS "deployedCount",
              COUNT(*) FILTER (
                WHERE "adminState" = '${OPENSTACK_BARE_METAL_IN_MAINTENANCE}'
              )::text AS "maintenanceCount",
              COUNT(*) FILTER (WHERE "status" = ANY($3::text[]))::text AS "failedCount"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.BareMetalNode}' AND "deletedAt" IS NULL
         AND ($4::text IS NULL OR "regionName" = $4)
       GROUP BY "facts"->>'resourceClass'
       ORDER BY COUNT(*) DESC, "facts"->>'resourceClass' ASC NULLS LAST
       LIMIT ${OPENSTACK_BARE_METAL_CLASS_LIMIT}`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        Array.from(OPENSTACK_BARE_METAL_ERROR_STATES),
        data.regionName || null,
      ],
    );

    return rows.map((row: (typeof rows)[number]): OpenStackBareMetalClass => {
      return {
        resourceClass: row.resourceClass,
        nodeCount: Number.parseInt(row.nodeCount, 10) || 0,
        availableCount: Number.parseInt(row.availableCount, 10) || 0,
        deployedCount: Number.parseInt(row.deployedCount, 10) || 0,
        maintenanceCount: Number.parseInt(row.maintenanceCount, 10) || 0,
        failedCount: Number.parseInt(row.failedCount, 10) || 0,
      };
    });
  }

  /**
   * What each of a page of projects runs, in one grouped read per page over
   * (kind, openStackProjectId), so a cloud of any size answers as fast as a small one.
   */
  @CaptureSpan()
  public async getProjectSummaries(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    openStackProjectIds: Array<string>;
  }): Promise<Array<OpenStackProjectSummary>> {
    const ids: Array<string> = data.openStackProjectIds.slice(
      0,
      OPENSTACK_PROJECTS_PER_READ,
    );
    if (ids.length === 0) {
      return [];
    }

    const rows: Array<{
      openStackProjectId: string;
      kind: string;
      count: string;
      activeCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "openStackProjectId", "kind",
              COUNT(*)::text AS "count",
              COUNT(*) FILTER (WHERE "status" = 'ACTIVE')::text AS "activeCount"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
         AND "kind" = ANY($3::text[])
         AND "openStackProjectId" = ANY($4::text[])
       GROUP BY "openStackProjectId", "kind"`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        [
          OpenStackResourceKind.Instance,
          OpenStackResourceKind.Volume,
          OpenStackResourceKind.Network,
          OpenStackResourceKind.Router,
          OpenStackResourceKind.FloatingIp,
          OpenStackResourceKind.Stack,
          OpenStackResourceKind.ContainerCluster,
        ],
        ids,
      ],
    );

    const summaries: Map<string, OpenStackProjectSummary> = new Map(
      ids.map((id: string): [string, OpenStackProjectSummary] => {
        return [
          id,
          {
            projectId: id,
            instanceCount: 0,
            activeInstanceCount: 0,
            volumeCount: 0,
            networkCount: 0,
            routerCount: 0,
            floatingIpCount: 0,
            stackCount: 0,
            containerClusterCount: 0,
          },
        ];
      }),
    );

    for (const row of rows) {
      const summary: OpenStackProjectSummary | undefined = summaries.get(
        row.openStackProjectId,
      );
      if (!summary) {
        continue;
      }
      const count: number = Number.parseInt(row.count, 10);
      switch (row.kind) {
        case OpenStackResourceKind.Instance:
          summary.instanceCount = count;
          summary.activeInstanceCount = Number.parseInt(row.activeCount, 10);
          break;
        case OpenStackResourceKind.Volume:
          summary.volumeCount = count;
          break;
        case OpenStackResourceKind.Network:
          summary.networkCount = count;
          break;
        case OpenStackResourceKind.Router:
          summary.routerCount = count;
          break;
        case OpenStackResourceKind.FloatingIp:
          summary.floatingIpCount = count;
          break;
        case OpenStackResourceKind.Stack:
          summary.stackCount = count;
          break;
        case OpenStackResourceKind.ContainerCluster:
          summary.containerClusterCount = count;
          break;
        default:
          break;
      }
    }

    return Array.from(summaries.values());
  }

  /**
   * One project's page: what it runs, which of its parts may need someone, the hosts
   * that are down with its instances on them (the failure nobody in the project caused
   * and everybody in it feels), and the labels its instances carry.
   */
  @CaptureSpan()
  public async getProjectOverview(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    openStackProjectId: string;
    now: Date;
  }): Promise<OpenStackProjectOverview> {
    const params: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
      data.openStackProjectId,
    ];

    const [summaries, attention, hostsDown, labels]: [
      Array<OpenStackProjectSummary>,
      OpenStackAttentionRows,
      Array<{
        hypervisorName: string;
        regionName: string | null;
        externalId: string;
        instanceCount: string;
      }>,
      Array<{ key: string; value: string; instanceCount: string }>,
    ] = await Promise.all([
      this.getProjectSummaries({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        openStackProjectIds: [data.openStackProjectId],
      }),
      this.getAttentionRows({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        now: data.now,
        openStackProjectIds: [data.openStackProjectId],
        rowsPerKind: OPENSTACK_PROJECT_ATTENTION_ROWS_PER_KIND,
      }),
      this.getRepository().manager.query(
        `SELECT host."hypervisorName", host."regionName", host."externalId",
                COUNT(*)::text AS "instanceCount"
         FROM "OpenStackResource" AS instance
         JOIN "OpenStackResource" AS host
           ON host."projectId" = instance."projectId"
          AND host."openStackCloudId" = instance."openStackCloudId"
          AND host."kind" = '${OpenStackResourceKind.Hypervisor}'
          AND host."hypervisorName" = instance."hypervisorName"
          AND host."regionName" IS NOT DISTINCT FROM instance."regionName"
          AND host."deletedAt" IS NULL
         WHERE instance."projectId" = $1 AND instance."openStackCloudId" = $2
           AND instance."kind" = '${OpenStackResourceKind.Instance}'
           AND instance."openStackProjectId" = $3
           AND instance."deletedAt" IS NULL
           AND host."status" = '${OPENSTACK_SERVICE_STATUS_DOWN}'
           AND COALESCE(host."adminState", '') NOT IN ('disabled', 'down')
         GROUP BY host."hypervisorName", host."regionName", host."externalId"
         ORDER BY COUNT(*) DESC, host."hypervisorName" ASC
         LIMIT ${OPENSTACK_PROJECT_HOSTS_DOWN_LIMIT}`,
        params,
      ),
      this.getRepository().manager.query(
        `SELECT label.key AS "key", label.value AS "value",
                COUNT(*)::text AS "instanceCount"
         FROM "OpenStackResource",
              jsonb_each_text(
                CASE WHEN jsonb_typeof("facts"->'labels') = 'object'
                  THEN "facts"->'labels' ELSE '{}'::jsonb END
              ) AS label
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Instance}'
           AND "openStackProjectId" = $3 AND "deletedAt" IS NULL
         GROUP BY label.key, label.value
         ORDER BY COUNT(*) DESC, label.key ASC, label.value ASC
         LIMIT ${OPENSTACK_PROJECT_LABEL_LIMIT}`,
        params,
      ),
    ]);

    return {
      summary: summaries[0]!,
      attention,
      hostsDown: hostsDown.map(
        (host: {
          hypervisorName: string;
          regionName: string | null;
          externalId: string;
          instanceCount: string;
        }): OpenStackProjectHostDown => {
          return {
            hypervisorName: host.hypervisorName,
            regionName: host.regionName,
            externalId: host.externalId,
            instanceCount: Number.parseInt(host.instanceCount, 10),
          };
        },
      ),
      labels: labels.map(
        (label: {
          key: string;
          value: string;
          instanceCount: string;
        }): OpenStackProjectLabel => {
          return {
            key: label.key,
            value: label.value,
            instanceCount: Number.parseInt(label.instanceCount, 10),
          };
        },
      ),
    };
  }

  /**
   * How many projects each domain holds. Domains are few and so is this read: it walks
   * the cloud's project rows and no others.
   */
  @CaptureSpan()
  public async getDomainSummaries(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<Array<OpenStackDomainSummary>> {
    const rows: Array<{
      domainId: string;
      projectCount: string;
      enabledProjectCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "facts"->>'domainId' AS "domainId",
              COUNT(*)::text AS "projectCount",
              COUNT(*) FILTER (WHERE "status" = 'enabled')::text AS "enabledProjectCount"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
         AND "kind" = '${OpenStackResourceKind.Project}'
         AND "facts"->>'domainId' IS NOT NULL
       GROUP BY "facts"->>'domainId'`,
      [data.projectId.toString(), data.openStackCloudId.toString()],
    );

    return rows.map(
      (row: {
        domainId: string;
        projectCount: string;
        enabledProjectCount: string;
      }): OpenStackDomainSummary => {
        return {
          domainId: row.domainId,
          projectCount: Number.parseInt(row.projectCount, 10),
          enabledProjectCount: Number.parseInt(row.enabledProjectCount, 10),
        };
      },
    );
  }

  // The IDs a filter by domain narrows a list to, since a row knows only its project.
  @CaptureSpan()
  public async getProjectIdsOfDomain(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    domainId: string;
  }): Promise<{ projectIds: Array<string>; isPartial: boolean }> {
    const rows: Array<{ externalId: string }> =
      await this.getRepository().manager.query(
        `SELECT "externalId" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
           AND "kind" = '${OpenStackResourceKind.Project}'
           AND "facts"->>'domainId' = $3
         ORDER BY "externalId" ASC
         LIMIT ${OPENSTACK_DOMAIN_PROJECT_ID_LIMIT + 1}`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          data.domainId,
        ],
      );

    return {
      projectIds: rows
        .slice(0, OPENSTACK_DOMAIN_PROJECT_ID_LIMIT)
        .map((row: { externalId: string }): string => {
          return row.externalId;
        }),
      isPartial: rows.length > OPENSTACK_DOMAIN_PROJECT_ID_LIMIT,
    };
  }

  /**
   * What the cloud's map is drawn from: see OpenStackTopologyRead. Every read here is
   * bounded by a stated limit and goes through an index on (kind, ...), so the largest
   * cloud answers with a few thousand rows however many instances it holds.
   */
  @CaptureSpan()
  public async getTopologyRead(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    now: Date;
    /*
     * Only this region's map, which is what a reader of one region asked to see. Past the
     * stated size a region is summarized on its own numbers, so a small region of a very
     * large cloud is drawn whole. Nothing named reads the whole cloud.
     */
    regionName?: string | null | undefined;
  }): Promise<OpenStackTopologyRead> {
    const base: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
      data.regionName || null,
    ];
    const inRegion: string = `($3::text IS NULL OR "regionName" = $3 OR "regionName" IS NULL)`;

    const totals: Array<{ kind: string; count: string }> =
      await this.getRepository().manager.query(
        `SELECT "kind", COUNT(*)::text AS "count" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
           AND ${inRegion}
         GROUP BY "kind"`,
        base,
      );
    const totalsByKind: Record<string, number> = {};
    for (const row of totals) {
      totalsByKind[row.kind] = Number.parseInt(row.count, 10);
    }

    // What the map draws: a flavor or an image is no part of where anything runs.
    const drawnKinds: Array<OpenStackResourceKind> = [
      OpenStackResourceKind.Api,
      OpenStackResourceKind.Service,
      OpenStackResourceKind.Hypervisor,
      OpenStackResourceKind.Instance,
      OpenStackResourceKind.Volume,
      OpenStackResourceKind.StoragePool,
      OpenStackResourceKind.Network,
      OpenStackResourceKind.Subnet,
      OpenStackResourceKind.Router,
      OpenStackResourceKind.FloatingIp,
    ];
    const drawnTotal: number = drawnKinds.reduce(
      (sum: number, kind: OpenStackResourceKind): number => {
        return sum + (totalsByKind[kind] || 0);
      },
      0,
    );
    const isSummarized: boolean =
      drawnTotal > OPENSTACK_TOPOLOGY_FULL_PART_LIMIT;

    const read: (query: {
      kind: OpenStackResourceKind;
      where?: string | undefined;
      params?: Array<unknown> | undefined;
      limit: number;
    }) => Promise<Array<JSONObject>> = async (query: {
      kind: OpenStackResourceKind;
      where?: string | undefined;
      params?: Array<unknown> | undefined;
      limit: number;
    }): Promise<Array<JSONObject>> => {
      const found: Array<JSONObject> = await this.getRepository().manager.query(
        `SELECT ${ROW_COLUMNS} FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
           AND "kind" = '${query.kind}' AND ${inRegion}
           ${query.where ? `AND ${query.where}` : ""}
         ORDER BY "externalId" ASC
         LIMIT ${query.limit}`,
        [...base, ...(query.params || [])],
      );
      return found.map(toRowWithNumbers);
    };

    const rows: Array<JSONObject> = [];

    if (!isSummarized) {
      for (const kind of drawnKinds) {
        rows.push(
          ...(await read({ kind, limit: OPENSTACK_TOPOLOGY_FULL_PART_LIMIT })),
        );
      }
    } else {
      // The structure, which is what everything hangs from.
      for (const kind of [
        OpenStackResourceKind.Api,
        OpenStackResourceKind.Hypervisor,
        OpenStackResourceKind.StoragePool,
      ]) {
        rows.push(
          ...(await read({ kind, limit: OPENSTACK_TOPOLOGY_STRUCTURE_LIMIT })),
        );
      }

      /*
       * A host's state is on its own row. Its workers add a node each on the control plane, thousands
       * of them saying nothing, so past the line only those that may need someone are drawn, and the
       * map's count says how many it left out.
       */
      rows.push(
        ...(
          await this.readWholeKind({
            projectId: data.projectId,
            openStackCloudId: data.openStackCloudId,
            kind: OpenStackResourceKind.Service,
          })
        ).rows,
      );
      rows.push(
        ...(await read({
          kind: OpenStackResourceKind.Network,
          where: `"facts"->>'isExternal' = 'true'`,
          limit: OPENSTACK_TOPOLOGY_STRUCTURE_LIMIT,
        })),
      );
      rows.push(
        ...(await read({
          kind: OpenStackResourceKind.Router,
          limit: OPENSTACK_TOPOLOGY_FAILED_PER_KIND,
        })),
      );

      /*
       * What has failed. The same rows Needs attention asks about, so the map and the
       * Overview start from one answer.
       */
      const attention: OpenStackAttentionRows = await this.getAttentionRows({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        now: data.now,
        rowsPerKind: OPENSTACK_TOPOLOGY_FAILED_PER_KIND,
        regionName: data.regionName,
      });
      const seen: Set<string> = new Set<string>(
        rows.map((row: JSONObject): string => {
          return `${row["kind"]}/${row["externalId"]}`;
        }),
      );
      for (const row of attention.rows) {
        const key: string = `${row["kind"]}/${row["externalId"]}`;
        if (!seen.has(key) && row["kind"] !== OpenStackResourceKind.Project) {
          seen.add(key);
          rows.push(row);
        }
      }

      /*
       * And what that takes with it: the instances on the hosts that are down, which are
       * the "instances beneath it" a failed host is drawn with.
       */
      const hostsDown: Array<JSONObject> = rows.filter((row: JSONObject) => {
        return (
          row["kind"] === OpenStackResourceKind.Hypervisor &&
          row["status"] === OPENSTACK_SERVICE_STATUS_DOWN &&
          !["disabled", "down"].includes(String(row["adminState"] || ""))
        );
      });
      const namesDown: Array<string> = hostsDown
        .map((row: JSONObject): string => {
          return String(row["hypervisorName"] || "");
        })
        .filter(Boolean);
      if (namesDown.length > 0) {
        const affected: Array<JSONObject> = await read({
          kind: OpenStackResourceKind.Instance,
          where: `"hypervisorName" = ANY($4::text[])`,
          params: [namesDown],
          limit: OPENSTACK_TOPOLOGY_AFFECTED_INSTANCES,
        });
        for (const row of affected) {
          const key: string = `${row["kind"]}/${row["externalId"]}`;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push(row);
          }
        }
      }

      // The volumes attached to the instances that are drawn.
      const instanceIds: Array<string> = rows
        .filter((row: JSONObject): boolean => {
          return row["kind"] === OpenStackResourceKind.Instance;
        })
        .map((row: JSONObject): string => {
          return String(row["externalId"]);
        });
      if (instanceIds.length > 0) {
        const attached: Array<JSONObject> = await read({
          kind: OpenStackResourceKind.Volume,
          where: `"facts"->>'attachedToInstance' = ANY($4::text[])`,
          params: [instanceIds],
          limit: OPENSTACK_TOPOLOGY_AFFECTED_INSTANCES,
        });
        for (const row of attached) {
          const key: string = `${row["kind"]}/${row["externalId"]}`;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push(row);
          }
        }
      }
    }

    const hosts: Array<{
      regionName: string | null;
      hypervisorName: string;
      count: string;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "hypervisorName", COUNT(*)::text AS "count"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
         AND "kind" = '${OpenStackResourceKind.Instance}'
         AND "hypervisorName" IS NOT NULL AND ${inRegion}
       GROUP BY "regionName", "hypervisorName"`,
      base,
    );

    const projectIds: Array<string> = Array.from(
      new Set<string>(
        rows
          .map((row: JSONObject): string => {
            return String(row["openStackProjectId"] || "");
          })
          .filter(Boolean),
      ),
    );
    const projectNames: Record<string, string> = {};
    if (projectIds.length > 0) {
      const named: Array<{ externalId: string; name: string | null }> =
        await this.getRepository().manager.query(
          `SELECT "externalId", "name" FROM "OpenStackResource"
           WHERE "projectId" = $1 AND "openStackCloudId" = $2
             AND "kind" = '${OpenStackResourceKind.Project}'
             AND "externalId" = ANY($3::text[]) AND "deletedAt" IS NULL`,
          [
            data.projectId.toString(),
            data.openStackCloudId.toString(),
            projectIds,
          ],
        );
      for (const row of named) {
        if (row.name) {
          projectNames[row.externalId] = row.name;
        }
      }
    }

    return {
      rows,
      totalsByKind,
      instancesByHost: hosts.map(
        (host: {
          regionName: string | null;
          hypervisorName: string;
          count: string;
        }) => {
          return {
            regionName: host.regionName,
            hypervisorName: host.hypervisorName,
            instanceCount: Number.parseInt(host.count, 10),
          };
        },
      ),
      isSummarized,
      projectNames,
    };
  }

  private withoutAgent(facts: JSONObject, agentId: string): JSONObject {
    const agents: JSONObject = {
      ...((facts["l3Agents"] as JSONObject | undefined) || {}),
    };
    delete agents[agentId];
    return { l3Agents: agents };
  }

  /**
   * A cloud's own rows, in order of their IDs, from after the one a read stopped at: for what
   * walks a whole kind, such as an export. One unique index serves any depth, so the last page of
   * 200,000 costs what the first does, where an OFFSET reads everything before it.
   */
  @CaptureSpan()
  public async getRowsAfter(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    kind: OpenStackResourceKind;
    afterExternalId?: string | null | undefined;
    regionName?: string | null | undefined;
    status?: string | null | undefined;
    limit?: number | undefined;
  }): Promise<{ rows: Array<JSONObject>; nextExternalId: string | null }> {
    const limit: number = Math.min(
      Math.max(1, data.limit || OPENSTACK_ROWS_PER_READ),
      OPENSTACK_ROWS_PER_READ,
    );
    const params: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
      data.kind,
    ];
    const conditions: Array<string> = [];

    if (data.afterExternalId) {
      params.push(data.afterExternalId);
      conditions.push(`AND "externalId" > $${params.length}`);
    }
    if (data.regionName) {
      params.push(data.regionName);
      conditions.push(`AND "regionName" = $${params.length}`);
    }
    if (data.status) {
      params.push(data.status);
      conditions.push(`AND "status" = $${params.length}`);
    }

    const rows: Array<JSONObject> = (
      (await this.getRepository().manager.query(
        `SELECT ${ROW_COLUMNS} FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "kind" = $3
           AND "deletedAt" IS NULL ${conditions.join(" ")}
         ORDER BY "externalId" ASC
         LIMIT ${limit + 1}`,
        params,
      )) as Array<JSONObject>
    ).map(toRowWithNumbers);

    const page: Array<JSONObject> = rows.slice(0, limit);

    return {
      rows: page,
      nextExternalId:
        rows.length > limit
          ? String(page[page.length - 1]?.["externalId"])
          : null,
    };
  }

  /**
   * How many instances there are by status and by project, in each region, for the series a cloud
   * in summary mode keeps in place of one per instance. Grouped on the server, so a cloud of any
   * size costs one read over its instances' rows.
   */
  @CaptureSpan()
  public async getInstanceCounts(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<{
    byStatus: Array<{
      regionName: string | null;
      status: string | null;
      count: number;
    }>;
    byProject: Array<{
      regionName: string | null;
      openStackProjectId: string;
      count: number;
    }>;
  }> {
    const params: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];
    const byStatus: Array<{
      regionName: string | null;
      status: string | null;
      count: string;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "status", COUNT(*)::text AS "count"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Instance}' AND "deletedAt" IS NULL
       GROUP BY "regionName", "status"`,
      params,
    );
    const byProject: Array<{
      regionName: string | null;
      openStackProjectId: string;
      count: string;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "openStackProjectId", COUNT(*)::text AS "count"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Instance}' AND "deletedAt" IS NULL
         AND "openStackProjectId" IS NOT NULL
       GROUP BY "regionName", "openStackProjectId"`,
      params,
    );

    return {
      byStatus: byStatus.map((row: (typeof byStatus)[number]) => {
        return {
          regionName: row.regionName,
          status: row.status,
          count: Number.parseInt(row.count, 10),
        };
      }),
      byProject: byProject.map((row: (typeof byProject)[number]) => {
        return {
          regionName: row.regionName,
          openStackProjectId: row.openStackProjectId,
          count: Number.parseInt(row.count, 10),
        };
      }),
    };
  }

  /**
   * A hypervisor's state is its nova-compute's. The fold joins them when one batch holds both, and
   * a collector that sends a large scrape in several batches can part them: a hypervisor's numbers
   * in one and its service in another. So this does the same join for those hosts from the rows
   * (the batch has just written both), and changes only what differs. Hosts by short name.
   */
  @CaptureSpan()
  public async reconcileHypervisorStates(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    shortHostNames: Array<string>;
  }): Promise<void> {
    if (data.shortHostNames.length === 0) {
      return;
    }

    const shortName: (column: string) => string = (column: string): string => {
      return `(CASE WHEN ${column} ~ '^[0-9.]+$' OR ${column} LIKE '%:%' THEN ${column} ELSE split_part(${column}, '.', 1) END)`;
    };

    await this.getRepository().manager.query(
      `UPDATE "OpenStackResource" AS host
       SET "status" = service."status",
           "adminState" = service."adminState",
           "disabledReason" = service."disabledReason",
           "availabilityZone" = COALESCE(host."availabilityZone", service."availabilityZone"),
           "stateChangedAt" = CASE
             WHEN host."status" IS DISTINCT FROM service."status"
               OR host."adminState" IS DISTINCT FROM service."adminState"
             THEN COALESCE(service."stateChangedAt", service."lastSeenAt")
             ELSE host."stateChangedAt"
           END,
           "updatedAt" = now()
       FROM "OpenStackResource" AS service
       WHERE host."projectId" = $1 AND host."openStackCloudId" = $2
         AND host."kind" = '${OpenStackResourceKind.Hypervisor}'
         AND service."projectId" = $1 AND service."openStackCloudId" = $2
         AND service."kind" = '${OpenStackResourceKind.Service}'
         AND service."name" = 'nova-compute'
         AND service."regionName" IS NOT DISTINCT FROM host."regionName"
         AND ${shortName(`service."facts"->>'host'`)} = ${shortName(`host."hypervisorName"`)}
         AND ${shortName(`host."hypervisorName"`)} = ANY($3::text[])
         AND (host."status" IS DISTINCT FROM service."status"
           OR host."adminState" IS DISTINCT FROM service."adminState"
           OR host."disabledReason" IS DISTINCT FROM service."disabledReason"
           OR (host."availabilityZone" IS NULL AND service."availabilityZone" IS NOT NULL))`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        data.shortHostNames,
      ],
    );
  }

  /**
   * What a cloud's capacity is worked out from. Hypervisors, flavors, pools and external networks
   * stay few at any size, and one indexed read each brings only the columns a sum needs.
   */
  @CaptureSpan()
  public async getCapacityRows(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<OpenStackCapacityRows> {
    const read: (
      kind: OpenStackResourceKind,
      limit: number,
      where?: string,
    ) => Promise<Array<JSONObject>> = async (
      kind: OpenStackResourceKind,
      limit: number,
      where?: string,
    ): Promise<Array<JSONObject>> => {
      return (
        (await this.getRepository().manager.query(
          `SELECT "externalId", "name", "regionName", "availabilityZone", "hypervisorName",
                  "status", "adminState", "instanceCount", "vcpuCapacity", "memoryCapacityBytes",
                  "diskCapacityBytes", "diskAllocatedBytes", "facts"
           FROM "OpenStackResource"
           WHERE "projectId" = $1 AND "openStackCloudId" = $2
             AND "kind" = '${kind}' AND "deletedAt" IS NULL
             ${where ? `AND ${where}` : ""}
           ORDER BY "externalId" ASC
           LIMIT ${limit}`,
          [data.projectId.toString(), data.openStackCloudId.toString()],
        )) as Array<JSONObject>
      ).map(toRowWithNumbers);
    };

    return {
      hypervisors: await read(
        OpenStackResourceKind.Hypervisor,
        OPENSTACK_TOPOLOGY_STRUCTURE_LIMIT,
      ),
      flavors: await read(
        OpenStackResourceKind.Flavor,
        OPENSTACK_CAPACITY_FLAVOR_ROWS,
      ),
      storagePools: await read(
        OpenStackResourceKind.StoragePool,
        OPENSTACK_CAPACITY_POOL_ROWS,
      ),
      externalNetworks: await read(
        OpenStackResourceKind.Network,
        OPENSTACK_CAPACITY_POOL_ROWS,
        `"facts"->>'isExternal' = 'true'`,
      ),
    };
  }

  /**
   * How many instances of each flavor each host holds, and how many of those are on their way
   * somewhere. One statement over every instance's row, so not one to run on every refresh of a
   * large cloud. Null when there's more than a read holds: a part of the answer would read as
   * instances missing from hosts, and that is exactly the finding this is for.
   */
  @CaptureSpan()
  public async getInstancesOnHosts(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<Array<OpenStackInstancesOnHost> | null> {
    const rows: Array<{
      regionName: string | null;
      hypervisorName: string;
      flavorId: string | null;
      count: string;
      movingCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "hypervisorName", "facts"->>'flavorId' AS "flavorId",
              COUNT(*)::text AS "count",
              COUNT(*) FILTER (WHERE "status" = ANY($3::text[]))::text AS "movingCount"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Instance}' AND "deletedAt" IS NULL
         AND "hypervisorName" IS NOT NULL
       GROUP BY "regionName", "hypervisorName", "facts"->>'flavorId'
       LIMIT ${OPENSTACK_CAPACITY_INSTANCES_ON_HOSTS_ROWS}`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        Array.from(OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES),
      ],
    );

    if (rows.length >= OPENSTACK_CAPACITY_INSTANCES_ON_HOSTS_ROWS) {
      return null;
    }

    return rows.map((row: (typeof rows)[number]): OpenStackInstancesOnHost => {
      return {
        regionName: row.regionName,
        hypervisorName: row.hypervisorName,
        flavorId: row.flavorId,
        count: Number.parseInt(row.count, 10) || 0,
        movingCount: Number.parseInt(row.movingCount, 10) || 0,
      };
    });
  }

  /**
   * What Placement will promise on a hypervisor, worked out from its row's facts. A collector can
   * send one scrape's series in several batches, so one batch can hold a host's total and another
   * its ratio. Each writes the number it has (setInventoryFacts), and this does the sum once they
   * are all on the row, the same one the fold does when a batch holds them all. A number not
   * reported yet leaves its class alone, and only what differs is written.
   */
  @CaptureSpan()
  public async reconcileHypervisorCapacity(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    hypervisorNames: Array<string>;
  }): Promise<void> {
    if (data.hypervisorNames.length === 0) {
      return;
    }

    const capacity: (resourceClass: string, scale: number) => string = (
      resourceClass: string,
      scale: number,
    ): string => {
      const number: (field: string) => string = (field: string): string => {
        return `("facts"->>'${getOpenStackInventoryFactKey(resourceClass, field as OpenStackInventoryField)}')::numeric`;
      };

      const unreserved: string = `(${number("total")} - ${number("reserved")})`;

      // Not GREATEST: it skips a null, so a host with no reserved reading yet would read as 0.
      return `TRUNC((CASE WHEN ${unreserved} < 0 THEN 0 ELSE ${unreserved} END) * ${number("ratio")} * ${scale})`;
    };

    const vcpu: string = capacity("VCPU", 1);
    const memory: string = capacity("MEMORY_MB", 1024 * 1024);
    const disk: string = capacity("DISK_GB", 1024 * 1024 * 1024);

    await this.getRepository().manager.query(
      `UPDATE "OpenStackResource"
       SET "vcpuCapacity" = COALESCE(${vcpu}, "vcpuCapacity"),
           "memoryCapacityBytes" = COALESCE(${memory}, "memoryCapacityBytes"),
           "diskCapacityBytes" = COALESCE(${disk}, "diskCapacityBytes"),
           "updatedAt" = now()
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Hypervisor}'
         AND "hypervisorName" = ANY($3::text[])
         AND "deletedAt" IS NULL
         AND ("vcpuCapacity" IS DISTINCT FROM COALESCE(${vcpu}, "vcpuCapacity")
           OR "memoryCapacityBytes" IS DISTINCT FROM COALESCE(${memory}, "memoryCapacityBytes")
           OR "diskCapacityBytes" IS DISTINCT FROM COALESCE(${disk}, "diskCapacityBytes"))`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        data.hypervisorNames,
      ],
    );
  }

  /**
   * A router whose agents were all taken off it has no series left to say so, and a row's facts
   * merge key by key, so it would name them for ever: a dead agent it no longer has would still
   * read as an outage, and a live one as carrying it. So a router heard from long after its agents
   * were last heard from has none (getOpenStackRoutersWithoutAgents has how long, and why).
   * Changes only what differs, so most clouds' routers, which have no agents to forget, cost one
   * indexed read per batch.
   */
  @CaptureSpan()
  public async forgetAgentsOfRouters(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    routers: Array<{ externalId: string; agentsReportedBefore: Date }>;
  }): Promise<void> {
    if (data.routers.length === 0) {
      return;
    }

    await this.getRepository().manager.query(
      `UPDATE "OpenStackResource" AS router
       SET "facts" = router."facts" - 'l3Agents' - 'l3AgentsReportedAt',
           "updatedAt" = now()
       FROM unnest($3::text[], $4::timestamptz[]) AS heard("externalId", "agentsReportedBefore")
       WHERE router."projectId" = $1 AND router."openStackCloudId" = $2
         AND router."kind" = '${OpenStackResourceKind.Router}'
         AND router."externalId" = heard."externalId"
         AND router."facts" ? 'l3Agents'
         AND COALESCE(
           (router."facts"->>'l3AgentsReportedAt')::timestamptz,
           '-infinity'::timestamptz
         ) < heard."agentsReportedBefore"`,
      [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        data.routers.map(
          (router: { externalId: string; agentsReportedBefore: Date }) => {
            return router.externalId;
          },
        ),
        data.routers.map(
          (router: { externalId: string; agentsReportedBefore: Date }) => {
            return router.agentsReportedBefore;
          },
        ),
      ],
    );
  }

  /**
   * Magnum's series have no project in them, recorded on every scene, and its API says one only on
   * a cluster's own read, which the exporter never makes. Heat's list says whose every stack is,
   * and each cluster names its stack. So a cluster's project is its stack's: recorded together on a
   * real cloud, and the same project Magnum's own read gives. A cluster and its stack arrive in
   * separate batches, so this runs after either, and writes only what is missing: what a probe read
   * from Magnum itself is left alone. A credential Heat refuses leaves clusters without a project,
   * and a page says so rather than filing them under none.
   */
  @CaptureSpan()
  public async reconcileContainerClusterProjects(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<void> {
    await this.getRepository().manager.query(
      `UPDATE "OpenStackResource" AS cluster
       SET "openStackProjectId" = stack."openStackProjectId",
           "updatedAt" = now()
       FROM "OpenStackResource" AS stack
       WHERE cluster."projectId" = $1 AND cluster."openStackCloudId" = $2
         AND cluster."kind" = '${OpenStackResourceKind.ContainerCluster}'
         AND cluster."openStackProjectId" IS NULL
         AND cluster."deletedAt" IS NULL
         AND stack."projectId" = $1 AND stack."openStackCloudId" = $2
         AND stack."kind" = '${OpenStackResourceKind.Stack}'
         AND stack."externalId" = cluster."facts"->>'stackId'
         AND stack."openStackProjectId" IS NOT NULL
         AND stack."deletedAt" IS NULL`,
      [data.projectId.toString(), data.openStackCloudId.toString()],
    );
  }

  /**
   * What a scrape of a service a cloud may not run says, beside the exporter's own series, to the row
   * that service already has. An UPDATE and never an INSERT, because these read the same on a cloud
   * that has never run it: a scrape that read nothing cannot put a service on a cloud.
   *
   * On a row that is there, it says three things the exporter's series can't, because they are gone
   * by then:
   *
   *  - The scrape failed: nothing answered, and `_up` is not there to say so. Down, as for a core
   *    service, and the next good scrape's `_up` brings it back.
   *  - The exporter answered with nothing: the catalog no longer names this service, or Keystone
   *    could not be logged in to. When that started goes on the row, and only
   *    forgetOptionalServicesThatLeft decides which of those two it was.
   *  - How long the collection took.
   */
  @CaptureSpan()
  public async recordOptionalServiceScrapes(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    scrapes: ReadonlyArray<OpenStackOptionalServiceScrape>;
  }): Promise<void> {
    for (const scrape of data.scrapes) {
      const isFailed: boolean = scrape.answered === false;
      const isEmpty: boolean =
        scrape.answered === true &&
        scrape.samples === 0 &&
        !getOpenStackOptionalService(scrape.service)?.isEmptyWhenStopped;
      const facts: JSONObject = {
        ...(scrape.seconds !== null
          ? { collectionSeconds: scrape.seconds }
          : {}),
        ...(scrape.answered !== null ? { scrapeFailed: isFailed } : {}),
      };
      // A key set to null is how a fact that went away says so: bulkUpsert reads it that way too.
      const emptySinceClause: string = isEmpty
        ? `|| jsonb_build_object('${OPENSTACK_EMPTY_ANSWER_SINCE_FACT}',
             COALESCE("facts"->>'${OPENSTACK_EMPTY_ANSWER_SINCE_FACT}', $4::text))`
        : (scrape.samples || 0) > 0
          ? `|| jsonb_build_object('${OPENSTACK_EMPTY_ANSWER_SINCE_FACT}', NULL::text)`
          : "";

      await this.getRepository().manager.query(
        `UPDATE "OpenStackResource"
         SET "facts" = COALESCE("facts", '{}'::jsonb) || $3::jsonb ${emptySinceClause},
             "status" = CASE WHEN $5::boolean
               THEN '${OPENSTACK_SERVICE_STATUS_DOWN}' ELSE "status" END,
             "stateChangedAt" = CASE
               WHEN $5::boolean AND "status" IS DISTINCT FROM '${OPENSTACK_SERVICE_STATUS_DOWN}'
               THEN $4::text::timestamptz ELSE "stateChangedAt" END,
             "updatedAt" = now()
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Api}'
           AND "externalId" = $6
           AND "deletedAt" IS NULL`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          JSON.stringify(facts),
          scrape.observedAt.toISOString(),
          isFailed,
          getOpenStackApiRowExternalId(scrape.regionName, scrape.service),
        ],
      );
    }
  }

  /**
   * How long a row may go unseen after its service's last good scrape. Three times
   * the slowest scrape interval (5 minutes) by default; OPENSTACK_INVENTORY_STALE_MINUTES
   * overrides it, for a cloud scraped more slowly.
   */
  public getStaleWindowInMinutes(): number {
    const raw: string | undefined =
      process.env["OPENSTACK_INVENTORY_STALE_MINUTES"];
    const parsed: number = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed)) {
      return DEFAULT_STALE_MINUTES;
    }
    return Math.max(MINIMUM_STALE_MINUTES, parsed);
  }

  /*
   * How long an unchanged row can go without being rewritten: see
   * MAX_ROW_TOUCH_INTERVAL_IN_SECONDS for why a third of the window is always safe.
   */
  public getRowTouchIntervalInSeconds(): number {
    return Math.min(
      MAX_ROW_TOUCH_INTERVAL_IN_SECONDS,
      Math.floor((this.getStaleWindowInMinutes() * 60) / 3),
    );
  }

  /**
   * Remove parts that have really gone. A part is gone only when its own service's
   * scrape, in its own region, succeeded after the part was last seen by more than
   * the stale window. So:
   *
   *  - A failing Nova removes nothing: its Api row stops moving, and so does the
   *    cutoff. A failing service is not a service whose parts are gone.
   *  - A cloud deleting its last instance still removes that row, because the cutoff
   *    comes from the service's scrape and not from the newest row of the kind.
   *  - A Service row (a worker) is vouched for by its family's API, in its region.
   *  - It measures from the read before the latest. A read's `up` can land before its own
   *    rows, in another batch or another upload of a large scrape. So the latest read is not
   *    yet evidence of anything, least of all after an outage longer than the window, when every
   *    row is older than the window before it, and those very rows are on their way. A part
   *    reported by a read whose rows have landed is never older than that read by more than the
   *    touch interval (MAX_ROW_TOUCH_INTERVAL_IN_SECONDS), which is a third of the window.
   *
   * The exporter says a service is up while any one of its reads works, so a read
   * that fails alone (a policy change takes one list away) looks like those parts
   * going, after the window. The access check is what tells those two apart.
   *
   * A service whose rows are sent in turns says how long a turn takes, and its rows get that
   * much longer: a row that has not changed comes round that often, and has not gone.
   *
   * Runs small DELETEs per region and service, at most STALE_DELETE_BATCH_SIZE rows each and
   * each a transaction of its own, so even a region's worth of rows going at once never holds
   * a long transaction, and every other writer gets a turn between them.
   */
  @CaptureSpan()
  public async deleteStaleForCloud(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<number> {
    const apis: Array<{
      regionName: string | null;
      name: string | null;
      vouchedAt: string | null;
      refreshCycleMinutes: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "name", "facts"->>'previousVouchedAt' AS "vouchedAt",
              "facts"->>'previousRefreshCycleMinutes' AS "refreshCycleMinutes"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Api}'
         AND "status" = '${OPENSTACK_SERVICE_STATUS_UP}'`,
      [data.projectId.toString(), data.openStackCloudId.toString()],
    );

    const staleWindowInMinutes: number = this.getStaleWindowInMinutes();
    let affected: number = 0;

    for (const api of apis) {
      const service: OpenStackServiceType | undefined = Object.values(
        OpenStackServiceType,
      ).find((type: OpenStackServiceType) => {
        return type === api.name;
      });
      if (!service || !api.vouchedAt) {
        continue;
      }

      const vouchedAt: Date = new Date(api.vouchedAt);
      if (isNaN(vouchedAt.getTime())) {
        continue;
      }
      const refreshCycleInMinutes: number =
        Number.parseFloat(api.refreshCycleMinutes || "0") || 0;
      const cutoff: Date = OneUptimeDate.addRemoveMinutes(
        vouchedAt,
        -(staleWindowInMinutes + refreshCycleInMinutes),
      );

      const kinds: ReadonlyArray<OpenStackResourceKind> =
        OPENSTACK_KINDS_BY_SERVICE[service];

      /*
       * Workers are one kind across several services, so each family's rows answer
       * to their own API. Identity's kinds are global, so its deletes take no region.
       */
      const family: OpenStackServiceFamily | null =
        OPENSTACK_WORKER_FAMILY_BY_SERVICE[service] || null;

      const isGlobal: boolean = service === OpenStackServiceType.Identity;
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.openStackCloudId.toString(),
        cutoff,
        [...kinds],
      ];
      let regionClause: string = "";
      if (!isGlobal) {
        params.push(api.regionName);
        regionClause = `AND "regionName" IS NOT DISTINCT FROM $${params.length}`;
      }
      let familyClause: string = "";
      if (family) {
        params.push(family);
        familyClause = `OR ("kind" = '${OpenStackResourceKind.Service}' AND "facts"->>'family' = $${params.length})`;
      }

      if (kinds.length === 0 && !family) {
        continue;
      }

      for (;;) {
        const result: unknown = await this.getRepository().manager.query(
          `DELETE FROM "OpenStackResource"
           WHERE "_id" IN (
             SELECT "_id" FROM "OpenStackResource"
             WHERE "projectId" = $1 AND "openStackCloudId" = $2
               AND "lastSeenAt" < $3
               ${regionClause}
               AND ("kind" = ANY($4::text[]) ${familyClause})
             LIMIT ${STALE_DELETE_BATCH_SIZE}
           )`,
          params,
        );

        // The Postgres driver returns [rows, affected] for DELETE.
        const deleted: number =
          Array.isArray(result) && typeof result[1] === "number"
            ? result[1]
            : 0;

        affected += deleted;

        if (deleted < STALE_DELETE_BATCH_SIZE) {
          break;
        }
      }
    }

    affected += await this.forgetOptionalServicesThatLeft(data);

    /*
     * No OpenStack service vouches for what a cloud stands on, because none reports it. So a
     * machine of it is gone when the agent has gone on reporting without it: someone stopped
     * naming that target. A target that is down still reports, through its `up` of 0, so
     * this never takes one that has only failed. An agent that stopped moves nothing, and
     * removes nothing. Measured from the read before the latest, as above: an agent back after a
     * while answers its API jobs a minute or so before these.
     */
    const reporting: Array<{ newest: string | null }> =
      await this.getRepository().manager.query(
        `SELECT MAX("facts"->>'previousVouchedAt') AS "newest"
         FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Api}'`,
        [data.projectId.toString(), data.openStackCloudId.toString()],
      );
    if (reporting[0]?.newest) {
      const gone: unknown = await this.getRepository().manager.query(
        `DELETE FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.ControlPlane}'
           AND "lastSeenAt" < $3`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          OneUptimeDate.addRemoveMinutes(
            new Date(reporting[0].newest),
            -staleWindowInMinutes,
          ),
        ],
      );
      if (Array.isArray(gone) && typeof gone[1] === "number") {
        affected += gone[1];
      }

      affected += await this.forgetQuietServices({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        reportedAt: new Date(reporting[0].newest),
      });
    }

    if (affected > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `OpenStackResource cleanup deleted ${affected} rows for cloud ${data.openStackCloudId.toString()}: check this was a real change to the cloud.`,
      );
    }

    return affected;
  }

  /**
   * A service the cloud no longer runs. Its own rows can't say so: its API's series stopped with
   * it, so nothing moves the cutoff the stale rule goes by and its last answer would read as the
   * truth for ever, on Services, in the menu and in Recommendations. So its scrape's empty answer
   * is what says so (recordOptionalServiceScrapes), once something the cloud always runs has gone on
   * answering for long enough in that region: an empty answer on its own is also what a Keystone
   * nobody can log in to gives, and that must never empty a cloud's inventory.
   *
   * Removes the API's own row with the rest, which is what takes the service out of the menu. It
   * comes back with the next `_up`, if the service does.
   */
  private async forgetOptionalServicesThatLeft(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<number> {
    const apis: Array<{
      regionName: string | null;
      name: string | null;
      emptySince: string | null;
      vouchedAt: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "name",
              "facts"->>'${OPENSTACK_EMPTY_ANSWER_SINCE_FACT}' AS "emptySince",
              "facts"->>'previousVouchedAt' AS "vouchedAt"
       FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "openStackCloudId" = $2
         AND "kind" = '${OpenStackResourceKind.Api}'
         AND "deletedAt" IS NULL`,
      [data.projectId.toString(), data.openStackCloudId.toString()],
    );

    const coreAnsweredAt: (regionName: string | null) => Date | null = (
      regionName: string | null,
    ): Date | null => {
      let latest: Date | null = null;
      for (const api of apis) {
        if (
          api.regionName === regionName &&
          OPENSTACK_SERVICES_EVERY_CLOUD_RUNS.has(api.name || "") &&
          api.vouchedAt
        ) {
          const answeredAt: Date = new Date(api.vouchedAt);
          if (
            !isNaN(answeredAt.getTime()) &&
            (!latest || answeredAt > latest)
          ) {
            latest = answeredAt;
          }
        }
      }
      return latest;
    };

    let affected: number = 0;

    for (const api of apis) {
      if (
        !isOpenStackOptionalService(api.name) ||
        !api.emptySince ||
        !hasOpenStackOptionalServiceLeft({
          emptySince: new Date(api.emptySince),
          coreAnsweredAt: coreAnsweredAt(api.regionName),
          windowInMinutes: this.getStaleWindowInMinutes(),
        })
      ) {
        continue;
      }

      const service: OpenStackServiceType = api.name as OpenStackServiceType;
      const result: unknown = await this.getRepository().manager.query(
        `DELETE FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "regionName" IS NOT DISTINCT FROM $3
           AND (
             "kind" = ANY($4::text[])
             OR ("kind" = '${OpenStackResourceKind.Service}' AND "facts"->>'family' = $5)
             OR ("kind" = '${OpenStackResourceKind.Api}' AND "name" = $6)
           )`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          api.regionName,
          [...OPENSTACK_KINDS_BY_SERVICE[service]],
          OPENSTACK_WORKER_FAMILY_BY_SERVICE[service] || null,
          service,
        ],
      );
      if (Array.isArray(result) && typeof result[1] === "number") {
        affected += result[1];
      }
    }

    return affected;
  }

  /*
   * A service a cloud may not run that has said nothing for weeks, while the rest of the cloud went
   * on reporting. Nothing can vouch for its rows now (see deleteStaleForCloud), and a stopped API
   * reads the same as one taken away, so they go only after this long, and come back if it does:
   * OPENSTACK_QUIET_SERVICE_FORGOTTEN_DAYS.
   */
  private async forgetQuietServices(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    reportedAt: Date;
  }): Promise<number> {
    const quiet: Array<{ name: string; regionName: string | null }> =
      await this.getRepository().manager.query(
        `SELECT "name", "regionName"
         FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Api}'
           AND NOT ("name" = ANY($3::text[]))
           AND "lastSeenAt" < $4`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          Array.from(OPENSTACK_SERVICES_EVERY_CLOUD_RUNS),
          OneUptimeDate.addRemoveMinutes(
            data.reportedAt,
            -OPENSTACK_QUIET_SERVICE_FORGOTTEN_DAYS * 24 * 60,
          ),
        ],
      );

    let affected: number = 0;

    for (const api of quiet) {
      const kinds: ReadonlyArray<OpenStackResourceKind> =
        OPENSTACK_KINDS_BY_SERVICE[api.name as OpenStackServiceType] || [];

      const result: unknown = await this.getRepository().manager.query(
        `DELETE FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "regionName" IS NOT DISTINCT FROM $3
           AND (
             ("kind" = '${OpenStackResourceKind.Api}' AND "name" = $4)
             OR "kind" = ANY($5::text[])
             OR ("kind" = '${OpenStackResourceKind.Service}' AND "facts"->>'family' = $4)
           )`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          api.regionName,
          api.name,
          [...kinds],
        ],
      );

      if (Array.isArray(result) && typeof result[1] === "number") {
        affected += result[1];
      }
    }

    return affected;
  }
}

export default new Service();
