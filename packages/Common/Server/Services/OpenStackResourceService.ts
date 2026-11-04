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
import { JSONObject } from "../../Types/JSON";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
  OPENSTACK_IMAGE_TRANSITIONAL_STATUSES,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_KINDS_BY_SERVICE,
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_SERVICE_STATUS_UP,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
} from "../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackRegionSummary,
  OpenStackTopConsumer,
  OpenStackTopConsumers,
} from "../../Types/OpenStack/OpenStackOverview";
import {
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  buildOpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "../../Types/OpenStack/OpenStackBlastRadius";
import {
  OPENSTACK_COUNT_LIMIT,
  OpenStackCountBy,
  OpenStackCountRow,
} from "../../Types/OpenStack/OpenStackCounts";
import {
  OPENSTACK_IMAGE_STUCK_MINUTES,
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
  OPENSTACK_PROJECT_QUOTA_WARNING_PERCENT,
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
  vcpuCapacity: number;
  vcpuAllocated: number;
  memoryCapacityBytes: number;
  memoryAllocatedBytes: number;
  storageCapacityBytes: number;
  storageUsedBytes: number;
}

export interface OpenStackAttentionRows {
  // The rows that may need someone, at most ATTENTION_ROWS_PER_KIND of each kind.
  rows: Array<JSONObject>;
  // How many there are of each kind, so a list can say "and 1,240 more".
  totalsByKind: Record<string, number>;
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
const ATTENTION_ROWS_PER_KIND: number = 100;
const STALE_DELETE_WARN_THRESHOLD: number = 1000;
const DEFAULT_STALE_MINUTES: number = 15;
const MINIMUM_STALE_MINUTES: number = 5;

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

    const resources: Array<ParsedOpenStackResource> = data.resources.map(
      (resource: ParsedOpenStackResource) => {
        const sanitized: ParsedOpenStackResource = sanitize(resource);
        if (sanitized.externalId !== resource.externalId) {
          logger.warn(
            `OpenStackResource externalId exceeds ${ColumnLength.ShortText} chars; truncated to "${sanitized.externalId}" (cloud ${data.openStackCloudId.toString()}).`,
          );
        }
        return sanitized;
      },
    );

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
            THEN EXCLUDED."lastSeenAt"
            ELSE COALESCE("OpenStackResource"."stateChangedAt", EXCLUDED."stateChangedAt")
          END,
          ${coalesce("vcpuCapacity")},
          ${coalesce("vcpuAllocated")},
          ${coalesce("memoryCapacityBytes")},
          ${coalesce("memoryAllocatedBytes")},
          ${coalesce("diskCapacityBytes")},
          ${coalesce("diskAllocatedBytes")},
          ${coalesce("instanceCount")},
          "facts" = COALESCE("OpenStackResource"."facts", '{}'::jsonb) || EXCLUDED."facts",
          "metricsUpdatedAt" = EXCLUDED."metricsUpdatedAt",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "OpenStackResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
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
    }> = await this.getRepository().manager.query(
      `SELECT COUNT(DISTINCT "regionName")::text AS "regionCount",
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
      vcpuCapacity: toNumber(hypervisors?.vcpuCapacity),
      vcpuAllocated: toNumber(hypervisors?.vcpuAllocated),
      memoryCapacityBytes: toNumber(hypervisors?.memoryCapacity),
      memoryAllocatedBytes: toNumber(hypervisors?.memoryAllocated),
      storageCapacityBytes: toNumber(pools?.diskCapacity),
      storageUsedBytes: toNumber(pools?.diskAllocated),
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
   * Hypervisors, services and pools are always read, whole, because the rules need
   * them all: how many schedulers are left, how many instances a dead host held.
   * There are few of those, even on a large cloud.
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
      // Read whole: see above.
      whole?: boolean;
    }> = [
      {
        kind: OpenStackResourceKind.Api,
        where: `"status" = '${OPENSTACK_SERVICE_STATUS_DOWN}'`,
        params: [],
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
      {
        kind: OpenStackResourceKind.StoragePool,
        where: `"diskAllocatedBytes" * 100 > "diskCapacityBytes" * ${OPENSTACK_STORAGE_POOL_WARNING_PERCENT}`,
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
      const limit: string = query.whole ? "" : `LIMIT ${rowsPerKind}`;
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

      if (query.whole || found.length < rowsPerKind) {
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

    return { rows, totalsByKind };
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
   *  - A service's API in a region: everything of that service in that region, because
   *    nobody there can manage any of it.
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

    if (part.kind === OpenStackResourceKind.StoragePool) {
      counts.push({
        count: "volumeCount",
        byProject: await countByProject({
          kind: OpenStackResourceKind.Volume,
          where: `"facts"->>'pool' = $3`,
          params: [part.name || ""],
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
             GROUP BY instance."openStackProjectId"`,
            [
              data.projectId.toString(),
              data.openStackCloudId.toString(),
              part.name || "",
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
      // No volume names a pool: either it holds none, or nothing says where they are.
      return await finish(found);
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

    // Nothing else has a reach of its own that this can read.
    return getEmptyOpenStackBlastRadius(false);
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
  }): Promise<OpenStackTopologyRead> {
    const base: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];

    const totals: Array<{ kind: string; count: string }> =
      await this.getRepository().manager.query(
        `SELECT "kind", COUNT(*)::text AS "count" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2 AND "deletedAt" IS NULL
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
           AND "kind" = '${query.kind}'
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
      // The structure, which is few parts on any cloud and is what everything hangs from.
      for (const kind of [
        OpenStackResourceKind.Api,
        OpenStackResourceKind.Service,
        OpenStackResourceKind.Hypervisor,
        OpenStackResourceKind.StoragePool,
      ]) {
        rows.push(
          ...(await read({ kind, limit: OPENSTACK_TOPOLOGY_STRUCTURE_LIMIT })),
        );
      }
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
          where: `"hypervisorName" = ANY($3::text[])`,
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
          where: `"facts"->>'attachedToInstance' = ANY($3::text[])`,
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
         AND "hypervisorName" IS NOT NULL
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
          [...base, projectIds],
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
   *
   * The exporter says a service is up while any one of its reads works, so a read
   * that fails alone (a policy change takes one list away) looks like those parts
   * going, after the window. The access check is what tells those two apart.
   *
   * Runs one small DELETE per region and service, so even a large cloud's sweep
   * touches an index range rather than holding a long transaction.
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
    }> = await this.getRepository().manager.query(
      `SELECT "regionName", "name", "facts"->>'vouchedAt' AS "vouchedAt"
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
      const cutoff: Date = OneUptimeDate.addRemoveMinutes(
        vouchedAt,
        -staleWindowInMinutes,
      );

      const kinds: ReadonlyArray<OpenStackResourceKind> =
        OPENSTACK_KINDS_BY_SERVICE[service];

      /*
       * Workers are one kind across three services, so each family's rows answer
       * to their own API. Identity's kinds are global, so its deletes take no region.
       */
      const family: string | null =
        service === OpenStackServiceType.Compute
          ? "compute"
          : service === OpenStackServiceType.Network
            ? "network"
            : service === OpenStackServiceType.Volume
              ? "volume"
              : null;

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

      const result: unknown = await this.getRepository().manager.query(
        `DELETE FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "lastSeenAt" < $3
           ${regionClause}
           AND ("kind" = ANY($4::text[]) ${familyClause})`,
        params,
      );

      // The Postgres driver returns [rows, affected] for DELETE.
      if (Array.isArray(result) && typeof result[1] === "number") {
        affected += result[1];
      }
    }

    if (affected > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `OpenStackResource cleanup deleted ${affected} rows for cloud ${data.openStackCloudId.toString()}: check this was a real change to the cloud.`,
      );
    }

    return affected;
  }
}

export default new Service();
