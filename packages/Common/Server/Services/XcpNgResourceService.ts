import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/XcpNgResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import logger from "../Utils/Logger";
import XcpNgResourceKind from "../../Types/XcpNg/XcpNgResourceKind";
import { ParsedXcpNgResource } from "../Utils/Telemetry/XcpNgSnapshotScan";
import { XCP_NG_VM_RAN_RECENTLY_HOURS } from "../../Types/XcpNg/XcpNgTelemetry";

export { ParsedXcpNgResource };

/*
 * The pool's counts and capacity, recounted from the stored inventory
 * (XcpNgPoolService.updateLastSeen writes them). Read from the rows rather
 * than one batch: the agent's batch processor can split one scrape of a big
 * pool across several requests.
 */
export interface XcpNgInventorySummary {
  hostCount: number;
  runningHostCount: number;
  disabledHostCount: number;
  vmCount: number;
  runningVmCount: number;
  storageRepositoryCount: number;
  vdiCount: number;
  storageCapacityBytes: number;
  storageUsedBytes: number;
}

const UPSERT_BATCH_SIZE: number = 300;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * Column order of bulkUpsert's INSERT and its parameter tuples. Keep this
 * and the INSERT column list in perfect sync (XcpNgResourceService.test.ts
 * holds the two together).
 */
export const XCP_NG_RESOURCE_UPSERT_COLUMNS: ReadonlyArray<string> = [
  "projectId",
  "xcpNgPoolId",
  "kind",
  "externalId",
  "name",
  "powerState",
  "isUp",
  "isEnabled",
  "isControlDomain",
  "parentHostExternalId",
  "parentHostName",
  "storageRepositoryExternalId",
  "storageRepositoryName",
  "vmExternalId",
  "vmName",
  "uptimeSeconds",
  "lastRunningAt",
  "latestCpuPercent",
  "cpuCount",
  "runningVcpuCount",
  "loadAverage",
  "latestMemoryBytes",
  "maxMemoryBytes",
  "latestMemoryPercent",
  "latestDiskBytes",
  "maxDiskBytes",
  "latestDiskPercent",
  "virtualAllocationBytes",
  "srType",
  "contentType",
  "isShared",
  "powerWatts",
  "tags",
  "metricsUpdatedAt",
  "lastSeenAt",
  "version",
];

/*
 * Identity and the objects a row belongs to are kept when a batch does not
 * carry them (COALESCE), so a request that holds only part of a scrape never
 * blanks a name. A VDI's VM and a storage repository's host are readings: a
 * detached disk stops naming its VM, so those follow the batch as they are.
 * lastRunningAt only moves forward.
 */
const COALESCED_COLUMNS: ReadonlyArray<string> = [
  "name",
  "powerState",
  "isUp",
  "isEnabled",
  "isControlDomain",
  "parentHostExternalId",
  "parentHostName",
  "storageRepositoryExternalId",
  "storageRepositoryName",
  "uptimeSeconds",
  "latestCpuPercent",
  "cpuCount",
  "runningVcpuCount",
  "loadAverage",
  "latestMemoryBytes",
  "maxMemoryBytes",
  "latestMemoryPercent",
  "latestDiskBytes",
  "maxDiskBytes",
  "latestDiskPercent",
  "virtualAllocationBytes",
  "srType",
  "contentType",
  "isShared",
  "powerWatts",
  "tags",
];

/*
 * The bulk paths go through manager.query(), which skips the length checks
 * DatabaseService applies to ordinary writes, so one oversized name would
 * abort the whole INSERT chunk it rides in. Clamp per value instead.
 */
export function sanitizeXcpNgResource(
  r: ParsedXcpNgResource,
): ParsedXcpNgResource {
  return {
    ...r,
    externalId: truncateShortText(r.externalId) || r.externalId,
    name: truncateShortText(r.name),
    powerState: truncateShortText(r.powerState),
    parentHostExternalId: truncateShortText(r.parentHostExternalId),
    parentHostName: truncateShortText(r.parentHostName),
    storageRepositoryExternalId: truncateShortText(
      r.storageRepositoryExternalId,
    ),
    storageRepositoryName: truncateShortText(r.storageRepositoryName),
    vmExternalId: truncateShortText(r.vmExternalId),
    vmName: truncateShortText(r.vmName),
    srType: truncateShortText(r.srType),
    contentType: truncateShortText(r.contentType),
    tags: truncateLongText(r.tags),
  };
}

function bigintParam(value: number | null): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value)).toString();
}

function intParam(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.trunc(value);
}

function decimalParam(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

// The parameter tuple of one row, in XCP_NG_RESOURCE_UPSERT_COLUMNS order.
export function getXcpNgResourceUpsertParams(data: {
  projectId: ObjectID;
  xcpNgPoolId: ObjectID;
  resource: ParsedXcpNgResource;
}): Array<unknown> {
  const r: ParsedXcpNgResource = data.resource;
  return [
    data.projectId.toString(),
    data.xcpNgPoolId.toString(),
    r.kind,
    r.externalId,
    r.name,
    r.powerState,
    r.isUp,
    r.isEnabled,
    r.isControlDomain,
    r.parentHostExternalId,
    r.parentHostName,
    r.storageRepositoryExternalId,
    r.storageRepositoryName,
    r.vmExternalId,
    r.vmName,
    intParam(r.uptimeSeconds),
    r.lastRunningAt,
    decimalParam(r.latestCpuPercent),
    intParam(r.cpuCount),
    intParam(r.runningVcpuCount),
    decimalParam(r.loadAverage),
    bigintParam(r.latestMemoryBytes),
    bigintParam(r.maxMemoryBytes),
    decimalParam(r.latestMemoryPercent),
    bigintParam(r.latestDiskBytes),
    bigintParam(r.maxDiskBytes),
    decimalParam(r.latestDiskPercent),
    bigintParam(r.virtualAllocationBytes),
    r.srType,
    r.contentType,
    r.isShared,
    decimalParam(r.powerWatts),
    r.tags,
    r.lastSeenAt,
    r.lastSeenAt,
    0, // version (BaseModel @VersionColumn)
  ];
}

export function getXcpNgResourceUpsertSql(rowCount: number): string {
  const columnCount: number = XCP_NG_RESOURCE_UPSERT_COLUMNS.length;
  const valueFragments: Array<string> = [];
  let paramIndex: number = 1;
  for (let row: number = 0; row < rowCount; row++) {
    const placeholders: Array<string> = [];
    for (let c: number = 0; c < columnCount; c++) {
      placeholders.push(`$${paramIndex++}`);
    }
    valueFragments.push(`(${placeholders.join(", ")})`);
  }

  const coalesced: string = COALESCED_COLUMNS.map((column: string) => {
    return `"${column}" = COALESCE(EXCLUDED."${column}", "XcpNgResource"."${column}"),`;
  }).join("\n          ");

  return `
        INSERT INTO "XcpNgResource" (
          ${XCP_NG_RESOURCE_UPSERT_COLUMNS.map((c: string) => {
            return `"${c}"`;
          }).join(", ")}
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "xcpNgPoolId", "kind", "externalId")
        DO UPDATE SET
          ${coalesced}
          "vmExternalId" = CASE WHEN EXCLUDED."kind" = '${XcpNgResourceKind.VDI}' THEN EXCLUDED."vmExternalId" ELSE COALESCE(EXCLUDED."vmExternalId", "XcpNgResource"."vmExternalId") END,
          "vmName" = CASE WHEN EXCLUDED."kind" = '${XcpNgResourceKind.VDI}' THEN EXCLUDED."vmName" ELSE COALESCE(EXCLUDED."vmName", "XcpNgResource"."vmName") END,
          "lastRunningAt" = GREATEST(EXCLUDED."lastRunningAt", "XcpNgResource"."lastRunningAt"),
          "metricsUpdatedAt" = EXCLUDED."metricsUpdatedAt",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "XcpNgResource"."lastSeenAt"
      `;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert one batch's objects of one pool. ON CONFLICT on the unique
   * (projectId, xcpNgPoolId, kind, externalId) index, with a dominance guard
   * on lastSeenAt so an out-of-order batch never regresses a newer one.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    resources: Array<ParsedXcpNgResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    const resources: Array<ParsedXcpNgResource> = data.resources
      .filter((r: ParsedXcpNgResource) => {
        return Boolean(r.externalId);
      })
      .map(sanitizeXcpNgResource);

    for (let i: number = 0; i < resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedXcpNgResource> = resources.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );
      const params: Array<unknown> = [];
      for (const resource of chunk) {
        params.push(
          ...getXcpNgResourceUpsertParams({
            projectId: data.projectId,
            xcpNgPoolId: data.xcpNgPoolId,
            resource,
          }),
        );
      }
      await this.getRepository().manager.query(
        getXcpNgResourceUpsertSql(chunk.length),
        params,
      );
    }
  }

  /**
   * Delete the rows of a pool that its reads stopped reporting: a host
   * removed from the pool, a deleted VM, storage repository or disk. Anchored
   * on the pool's own last read, so a pool Xen Orchestra lost keeps its last
   * inventory (shown as such) instead of emptying. Returns how many rows went.
   */
  @CaptureSpan()
  public async deleteStaleForPool(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: unknown = await this.getRepository().manager.query(
      `DELETE FROM "XcpNgResource"
       WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "lastSeenAt" < $3`,
      [data.projectId.toString(), data.xcpNgPoolId.toString(), data.olderThan],
    );

    const affected: number = Array.isArray(result)
      ? Number((result as Array<unknown>)[1]) || 0
      : 0;

    if (affected > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `Deleted ${affected} stale XcpNgResource rows for XCP-ng pool ${data.xcpNgPoolId.toString()}.`,
      );
    }
    return affected;
  }

  /**
   * The pool's counts and capacity from its rows. A storage repository's
   * capacity counts when it holds VM disks: ISO libraries and removable
   * media (content type iso / disk) are left out, and so is one that
   * reports no size.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
  }): Promise<XcpNgInventorySummary> {
    const rows: Array<Record<string, unknown>> =
      await this.getRepository().manager.query(
        `SELECT
          COUNT(*) FILTER (WHERE "kind" = $3) AS "hostCount",
          COUNT(*) FILTER (WHERE "kind" = $3 AND "isUp" IS TRUE) AS "runningHostCount",
          COUNT(*) FILTER (WHERE "kind" = $3 AND "isEnabled" IS FALSE) AS "disabledHostCount",
          COUNT(*) FILTER (WHERE "kind" = $4 AND "isControlDomain" IS NOT TRUE) AS "vmCount",
          COUNT(*) FILTER (WHERE "kind" = $4 AND "isControlDomain" IS NOT TRUE AND "isUp" IS TRUE) AS "runningVmCount",
          COUNT(*) FILTER (WHERE "kind" = $5) AS "storageRepositoryCount",
          COUNT(*) FILTER (WHERE "kind" = $6) AS "vdiCount",
          COALESCE(SUM("maxDiskBytes") FILTER (WHERE "kind" = $5 AND COALESCE("contentType", '') NOT IN ('iso', 'disk') AND "maxDiskBytes" > 0), 0) AS "storageCapacityBytes",
          COALESCE(SUM("latestDiskBytes") FILTER (WHERE "kind" = $5 AND COALESCE("contentType", '') NOT IN ('iso', 'disk') AND "maxDiskBytes" > 0), 0) AS "storageUsedBytes"
        FROM "XcpNgResource"
        WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "deletedAt" IS NULL`,
        [
          data.projectId.toString(),
          data.xcpNgPoolId.toString(),
          XcpNgResourceKind.Host,
          XcpNgResourceKind.VM,
          XcpNgResourceKind.StorageRepository,
          XcpNgResourceKind.VDI,
        ],
      );

    const row: Record<string, unknown> = rows[0] || {};
    const read: (key: string) => number = (key: string): number => {
      const value: number = Number(row[key]);
      return Number.isFinite(value) ? value : 0;
    };

    return {
      hostCount: read("hostCount"),
      runningHostCount: read("runningHostCount"),
      disabledHostCount: read("disabledHostCount"),
      vmCount: read("vmCount"),
      runningVmCount: read("runningVmCount"),
      storageRepositoryCount: read("storageRepositoryCount"),
      vdiCount: read("vdiCount"),
      storageCapacityBytes: read("storageCapacityBytes"),
      storageUsedBytes: read("storageUsedBytes"),
    };
  }

  /**
   * Of these VMs of a pool, the ones last reported Running within the past
   * XCP_NG_VM_RAN_RECENTLY_HOURS hours: a stop of one of them is worth an
   * alert (xcp_ng.vm.stopped_after_running), while a VM nobody has seen
   * running for a day is taken to be off on purpose.
   */
  @CaptureSpan()
  public async findVmsThatRanRecently(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    vmExternalIds: Array<string>;
    now: Date;
  }): Promise<Set<string>> {
    const ids: Array<string> = Array.from(
      new Set(
        data.vmExternalIds
          .map((id: string) => {
            return id.toLowerCase();
          })
          .filter(Boolean),
      ),
    );
    if (ids.length === 0) {
      return new Set<string>();
    }

    const since: Date = new Date(
      data.now.getTime() - XCP_NG_VM_RAN_RECENTLY_HOURS * 60 * 60 * 1000,
    );
    const rows: Array<{ externalId: string }> =
      await this.getRepository().manager.query(
        `SELECT "externalId" FROM "XcpNgResource"
         WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "kind" = $3
           AND "externalId" = ANY($4) AND "lastRunningAt" >= $5
           AND "deletedAt" IS NULL`,
        [
          data.projectId.toString(),
          data.xcpNgPoolId.toString(),
          XcpNgResourceKind.VM,
          ids,
          since,
        ],
      );

    return new Set<string>(
      rows.map((row: { externalId: string }) => {
        return row.externalId;
      }),
    );
  }
}

export default new Service();
