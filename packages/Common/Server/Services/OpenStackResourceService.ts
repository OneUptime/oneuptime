import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OpenStackResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OPENSTACK_KINDS_BY_SERVICE,
  OPENSTACK_SERVICE_STATUS_DOWN,
  OPENSTACK_SERVICE_STATUS_UP,
  OPENSTACK_VOLUME_ERROR_STATUSES,
  OPENSTACK_VOLUME_TRANSITIONAL_STATUSES,
} from "../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackBlastRadius,
  OpenStackBlastRadiusCount,
  buildOpenStackBlastRadius,
  getEmptyOpenStackBlastRadius,
} from "../../Types/OpenStack/OpenStackBlastRadius";
import {
  OPENSTACK_INSTANCE_STUCK_MINUTES,
  OPENSTACK_IP_POOL_WARNING_PERCENT,
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

/*
 * Whether a row's capacity counts: see getInventorySummary. Only a hypervisor has a
 * state and capacity both, so this leaves storage pools alone.
 */
const CAN_GIVE: string = `COALESCE("status", '') <> '${OPENSTACK_SERVICE_STATUS_DOWN}'
  AND COALESCE("adminState", '') NOT IN ('disabled', 'down')`;

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

      const coalesce = (column: string): string => {
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
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }): Promise<OpenStackInventorySummary> {
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
       GROUP BY "kind"`,
      [data.projectId.toString(), data.openStackCloudId.toString()],
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
         AND "kind" IN (
           '${OpenStackResourceKind.Api}',
           '${OpenStackResourceKind.Hypervisor}',
           '${OpenStackResourceKind.Service}'
         )`,
      [data.projectId.toString(), data.openStackCloudId.toString()],
    );

    const toNumber = (value: string | null | undefined): number => {
      const parsed: number = Number.parseFloat(value || "0");
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const rowOf = (kind: OpenStackResourceKind): (typeof rows)[number] | null => {
      return (
        rows.find((row: (typeof rows)[number]) => {
          return row.kind === kind;
        }) || null
      );
    };
    const countOf = (kind: OpenStackResourceKind): number => {
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
  }): Promise<OpenStackAttentionRows> {
    const instanceStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_INSTANCE_STUCK_MINUTES,
    );
    const volumeStuckBefore: Date = OneUptimeDate.addRemoveMinutes(
      data.now,
      -OPENSTACK_VOLUME_STUCK_MINUTES,
    );
    const base: Array<unknown> = [
      data.projectId.toString(),
      data.openStackCloudId.toString(),
    ];

    const statuses = (values: ReadonlySet<string>): Array<string> => {
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
    ];

    const rows: Array<JSONObject> = [];
    const totalsByKind: Record<string, number> = {};

    for (const query of queries) {
      const limit: string = query.whole
        ? ""
        : `LIMIT ${ATTENTION_ROWS_PER_KIND}`;
      const found: Array<JSONObject> = await this.getRepository().manager.query(
        `SELECT "_id", "kind", "externalId", "name", "regionName", "availabilityZone",
                "hypervisorName", "openStackProjectId", "status", "adminState",
                "disabledReason", "stateChangedAt", "vcpuCapacity", "vcpuAllocated",
                "memoryCapacityBytes", "memoryAllocatedBytes", "diskCapacityBytes",
                "diskAllocatedBytes", "instanceCount", "facts", "lastSeenAt"
         FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${query.kind}' AND "deletedAt" IS NULL
           AND ${query.where}
         ORDER BY ${query.orderBy || `"name" ASC NULLS LAST`}
         ${limit}`,
        [...base, ...query.params],
      );
      rows.push(...found);

      if (query.whole || found.length < ATTENTION_ROWS_PER_KIND) {
        totalsByKind[query.kind] = found.length;
      } else {
        const counted: Array<{ count: string }> =
          await this.getRepository().manager.query(
            `SELECT COUNT(*)::text AS "count"
             FROM "OpenStackResource"
             WHERE "projectId" = $1 AND "openStackCloudId" = $2
               AND "kind" = '${query.kind}' AND "deletedAt" IS NULL
               AND ${query.where}`,
            [...base, ...query.params],
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

    const countByProject = async (query: {
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

    const finish = async (
      isKnown: boolean = true,
    ): Promise<OpenStackBlastRadius> => {
      const projectIds: Array<string> = Array.from(
        new Set(
          counts.flatMap(({ byProject }) => {
            return byProject
              .map(({ projectId }) => {
                return projectId;
              })
              .filter((projectId: string | null): projectId is string => {
                return Boolean(projectId);
              });
          }),
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
      return buildOpenStackBlastRadius({ counts, projectNames, isKnown });
    };

    const floatingIpsThrough = async (
      routerIds: Array<string>,
    ): Promise<void> => {
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

    const instancesOn = async (hypervisorName: string): Promise<void> => {
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
            `${host.replace(/[\%_]/g, "\$&")}.%`,
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
      // No volume names a pool: either it holds none, or nothing says where they are.
      return await finish(found);
    }

    if (part.kind === OpenStackResourceKind.Api) {
      const kinds: Partial<
        Record<string, Array<[OpenStackResourceKind, OpenStackBlastRadiusCount]>>
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
