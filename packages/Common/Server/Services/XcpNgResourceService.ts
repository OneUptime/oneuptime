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
import {
  XCP_NG_MAX_PATCHES_PER_HOST,
  XcpNgHostPatches,
} from "../../Types/XcpNg/XcpNgPoolEvents";
import {
  XcpNgStoredResource,
  XcpNgVmBackupUpdate,
} from "../Utils/XcpNg/XcpNgPoolEventsProcessing";

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

// How long a row may go unreported before the prune takes it, by default.
export const XCP_NG_INVENTORY_STALE_MINUTES: number = 15;

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

/*
 * ---------------------------------------------------------------
 * #10997: a VM's last backup, its jobs' interval, a host's missing
 * patches - written by the events ingest (XcpNgPoolEventsIngest), each as
 * one parameterized UPDATE ... FROM (VALUES ...) per batch, and only to
 * rows of the pool's own kind and project.
 * ---------------------------------------------------------------
 */

export interface XcpNgSqlStatement {
  sql: string;
  params: Array<unknown>;
}

const EVENT_WRITE_BATCH_SIZE: number = 200;

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];
  for (let index: number = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/*
 * One update per VM: the newest run's "last backup", and the newest
 * success of any run in the batch.
 */
export function collapseXcpNgVmBackupUpdates(
  updates: Array<XcpNgVmBackupUpdate>,
): Array<XcpNgVmBackupUpdate> {
  const byVm: Map<string, XcpNgVmBackupUpdate> = new Map();

  for (const update of updates) {
    const vmId: string = update.vmId.toLowerCase();
    const known: XcpNgVmBackupUpdate | undefined = byVm.get(vmId);
    if (!known) {
      byVm.set(vmId, { ...update, vmId: vmId });
      continue;
    }
    const newest: XcpNgVmBackupUpdate =
      update.lastBackupAt.getTime() >= known.lastBackupAt.getTime()
        ? { ...update, vmId: vmId }
        : { ...known };
    const successes: Array<Date> = [
      known.lastSuccessfulBackupAt,
      update.lastSuccessfulBackupAt,
    ].filter((date: Date | null): date is Date => {
      return Boolean(date);
    });
    newest.lastSuccessfulBackupAt =
      successes.length > 0
        ? new Date(
            Math.max(
              ...successes.map((date: Date): number => {
                return date.getTime();
              }),
            ),
          )
        : null;
    byVm.set(vmId, newest);
  }

  return Array.from(byVm.values());
}

/*
 * The VMs' "last backup": written only where it is newer than what the row
 * holds, so a run delivered late never undoes a newer one.
 */
export function getXcpNgVmLastBackupStatements(data: {
  projectId: ObjectID;
  xcpNgPoolId: ObjectID;
  updates: Array<XcpNgVmBackupUpdate>;
}): Array<XcpNgSqlStatement> {
  return chunk(data.updates, EVENT_WRITE_BATCH_SIZE).map(
    (batch: Array<XcpNgVmBackupUpdate>): XcpNgSqlStatement => {
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.xcpNgPoolId.toString(),
        XcpNgResourceKind.VM,
      ];
      const rows: Array<string> = batch.map(
        (update: XcpNgVmBackupUpdate): string => {
          const start: number = params.length + 1;
          params.push(
            update.vmId.toLowerCase(),
            update.lastBackupAt,
            truncateShortText(update.lastBackupStatus),
            truncateShortText(update.lastBackupJobName),
            update.lastBackupError === null
              ? null
              : truncateLongText(update.lastBackupError),
            update.lastBackupBytes === null
              ? null
              : Math.max(0, Math.trunc(update.lastBackupBytes)).toString(),
          );
          return `($${start}::text, $${start + 1}::timestamptz, $${start + 2}::text, $${start + 3}::text, $${start + 4}::text, $${start + 5}::bigint)`;
        },
      );

      return {
        sql: `UPDATE "XcpNgResource" AS r SET
          "lastBackupAt" = v."lastBackupAt",
          "lastBackupStatus" = v."lastBackupStatus",
          "lastBackupJobName" = v."lastBackupJobName",
          "lastBackupError" = v."lastBackupError",
          "lastBackupBytes" = v."lastBackupBytes",
          "updatedAt" = now()
        FROM (VALUES ${rows.join(", ")}) AS v("externalId", "lastBackupAt", "lastBackupStatus", "lastBackupJobName", "lastBackupError", "lastBackupBytes")
        WHERE r."projectId" = $1 AND r."xcpNgPoolId" = $2 AND r."kind" = $3
          AND r."externalId" = v."externalId" AND r."deletedAt" IS NULL
          AND (r."lastBackupAt" IS NULL OR r."lastBackupAt" <= v."lastBackupAt")`,
        params: params,
      };
    },
  );
}

// The VMs' newest successful backup, whichever run brought it.
export function getXcpNgVmLastSuccessStatements(data: {
  projectId: ObjectID;
  xcpNgPoolId: ObjectID;
  updates: Array<XcpNgVmBackupUpdate>;
}): Array<XcpNgSqlStatement> {
  const successes: Array<XcpNgVmBackupUpdate> = data.updates.filter(
    (update: XcpNgVmBackupUpdate): boolean => {
      return Boolean(update.lastSuccessfulBackupAt);
    },
  );

  return chunk(successes, EVENT_WRITE_BATCH_SIZE).map(
    (batch: Array<XcpNgVmBackupUpdate>): XcpNgSqlStatement => {
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.xcpNgPoolId.toString(),
        XcpNgResourceKind.VM,
      ];
      const rows: Array<string> = batch.map(
        (update: XcpNgVmBackupUpdate): string => {
          const start: number = params.length + 1;
          params.push(update.vmId.toLowerCase(), update.lastSuccessfulBackupAt);
          return `($${start}::text, $${start + 1}::timestamptz)`;
        },
      );

      return {
        sql: `UPDATE "XcpNgResource" AS r SET
          "lastSuccessfulBackupAt" = GREATEST(r."lastSuccessfulBackupAt", v."at"),
          "updatedAt" = now()
        FROM (VALUES ${rows.join(", ")}) AS v("externalId", "at")
        WHERE r."projectId" = $1 AND r."xcpNgPoolId" = $2 AND r."kind" = $3
          AND r."externalId" = v."externalId" AND r."deletedAt" IS NULL`,
        params: params,
      };
    },
  );
}

// How often each VM is backed up; null for a VM no scheduled job backs up.
export function getXcpNgVmIntervalStatements(data: {
  projectId: ObjectID;
  xcpNgPoolId: ObjectID;
  updates: Array<{ vmId: string; intervalSeconds: number | null }>;
}): Array<XcpNgSqlStatement> {
  return chunk(data.updates, EVENT_WRITE_BATCH_SIZE).map(
    (
      batch: Array<{ vmId: string; intervalSeconds: number | null }>,
    ): XcpNgSqlStatement => {
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.xcpNgPoolId.toString(),
        XcpNgResourceKind.VM,
      ];
      const rows: Array<string> = batch.map(
        (update: { vmId: string; intervalSeconds: number | null }): string => {
          const start: number = params.length + 1;
          params.push(
            update.vmId.toLowerCase(),
            update.intervalSeconds === null
              ? null
              : Math.max(0, Math.trunc(update.intervalSeconds)),
          );
          return `($${start}::text, $${start + 1}::integer)`;
        },
      );

      return {
        sql: `UPDATE "XcpNgResource" AS r SET
          "backupIntervalSeconds" = v."intervalSeconds",
          "updatedAt" = now()
        FROM (VALUES ${rows.join(", ")}) AS v("externalId", "intervalSeconds")
        WHERE r."projectId" = $1 AND r."xcpNgPoolId" = $2 AND r."kind" = $3
          AND r."externalId" = v."externalId" AND r."deletedAt" IS NULL`,
        params: params,
      };
    },
  );
}

// Each host's missing patches, as last checked.
export function getXcpNgHostPatchStatements(data: {
  projectId: ObjectID;
  xcpNgPoolId: ObjectID;
  hosts: Array<XcpNgHostPatches>;
}): Array<XcpNgSqlStatement> {
  return chunk(data.hosts, EVENT_WRITE_BATCH_SIZE).map(
    (batch: Array<XcpNgHostPatches>): XcpNgSqlStatement => {
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.xcpNgPoolId.toString(),
        XcpNgResourceKind.Host,
      ];
      const rows: Array<string> = batch.map(
        (host: XcpNgHostPatches): string => {
          const start: number = params.length + 1;
          params.push(
            host.hostId.toLowerCase(),
            Math.max(0, Math.trunc(host.patchCount)),
            JSON.stringify(host.patches.slice(0, XCP_NG_MAX_PATCHES_PER_HOST)),
          );
          return `($${start}::text, $${start + 1}::integer, $${start + 2}::jsonb)`;
        },
      );

      return {
        sql: `UPDATE "XcpNgResource" AS r SET
          "missingPatchCount" = v."count",
          "missingPatches" = v."patches",
          "updatedAt" = now()
        FROM (VALUES ${rows.join(", ")}) AS v("externalId", "count", "patches")
        WHERE r."projectId" = $1 AND r."xcpNgPoolId" = $2 AND r."kind" = $3
          AND r."externalId" = v."externalId" AND r."deletedAt" IS NULL`,
        params: params,
      };
    },
  );
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
   * The cutoff below which a row of a pool is stale: 15 minutes (three
   * missed scrapes of a minute, and five of the agent's batches) before the
   * pool's own last read, not before now - a pool nobody can read keeps its
   * last inventory. XCP_NG_INVENTORY_STALE_MINUTES overrides it (at least
   * 5).
   */
  public getStaleThresholdDate(poolLastSeenAt?: Date | undefined): Date {
    const configured: number = Number(
      process.env["XCP_NG_INVENTORY_STALE_MINUTES"],
    );
    const minutes: number =
      Number.isFinite(configured) && configured >= 5
        ? configured
        : XCP_NG_INVENTORY_STALE_MINUTES;
    const anchor: Date =
      poolLastSeenAt && !isNaN(poolLastSeenAt.getTime())
        ? poolLastSeenAt
        : new Date();
    return new Date(anchor.getTime() - minutes * 60 * 1000);
  }

  /**
   * Delete the rows of a pool that its reads stopped reporting: a host
   * removed from the pool, a deleted VM, storage repository or disk. Called
   * with a cutoff anchored on the pool's own last read, so a pool Xen
   * Orchestra lost keeps its last inventory (shown as such) instead of
   * emptying. And never the whole inventory at once: with no row fresher
   * than the cutoff, the reads stopped describing the pool (an ingest
   * backlog, an agent clock off), and nothing is pruned until one does
   * again - as Proxmox's prune. Returns how many rows went.
   */
  @CaptureSpan()
  public async deleteStaleForPool(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: unknown = await this.getRepository().manager.query(
      `DELETE FROM "XcpNgResource" AS stale
       WHERE stale."projectId" = $1 AND stale."xcpNgPoolId" = $2
         AND stale."lastSeenAt" < $3
         AND EXISTS (
           SELECT 1 FROM "XcpNgResource" AS fresh
           WHERE fresh."projectId" = $1 AND fresh."xcpNgPoolId" = $2
             AND fresh."lastSeenAt" >= $3
         )`,
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

  /**
   * What the events ingest needs of a pool's inventory (#10997): its
   * hosts, VMs, storage repositories and virtual disks, by name and state,
   * with each VM's backups and each host's patches as last written.
   */
  @CaptureSpan()
  public async findForEvents(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
  }): Promise<Array<XcpNgStoredResource>> {
    const rows: Array<Record<string, unknown>> =
      await this.getRepository().manager.query(
        `SELECT "kind", "externalId", "name", "isUp", "isEnabled",
          "isControlDomain", "lastSuccessfulBackupAt", "backupIntervalSeconds",
          "missingPatchCount"
        FROM "XcpNgResource"
        WHERE "projectId" = $1 AND "xcpNgPoolId" = $2 AND "deletedAt" IS NULL`,
        [data.projectId.toString(), data.xcpNgPoolId.toString()],
      );

    return rows.map((row: Record<string, unknown>): XcpNgStoredResource => {
      const lastSuccess: unknown = row["lastSuccessfulBackupAt"];
      return {
        kind: String(row["kind"] || ""),
        externalId: String(row["externalId"] || "").toLowerCase(),
        name: typeof row["name"] === "string" ? (row["name"] as string) : null,
        isUp:
          typeof row["isUp"] === "boolean" ? (row["isUp"] as boolean) : null,
        isEnabled:
          typeof row["isEnabled"] === "boolean"
            ? (row["isEnabled"] as boolean)
            : null,
        isControlDomain:
          typeof row["isControlDomain"] === "boolean"
            ? (row["isControlDomain"] as boolean)
            : null,
        lastSuccessfulBackupAt:
          lastSuccess instanceof Date
            ? lastSuccess
            : lastSuccess
              ? new Date(String(lastSuccess))
              : null,
        backupIntervalSeconds:
          row["backupIntervalSeconds"] === null ||
          row["backupIntervalSeconds"] === undefined
            ? null
            : Number(row["backupIntervalSeconds"]),
        missingPatchCount:
          row["missingPatchCount"] === null ||
          row["missingPatchCount"] === undefined
            ? null
            : Number(row["missingPatchCount"]),
      };
    });
  }

  // Each statement is one auto-committed UPDATE, run one after another.
  private async runStatements(
    statements: Array<XcpNgSqlStatement>,
  ): Promise<void> {
    for (const statement of statements) {
      await this.getRepository().manager.query(statement.sql, statement.params);
    }
  }

  @CaptureSpan()
  public async applyVmBackups(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    updates: Array<XcpNgVmBackupUpdate>;
  }): Promise<void> {
    const updates: Array<XcpNgVmBackupUpdate> = collapseXcpNgVmBackupUpdates(
      data.updates,
    );
    if (updates.length === 0) {
      return;
    }
    await this.runStatements([
      ...getXcpNgVmLastBackupStatements({ ...data, updates: updates }),
      ...getXcpNgVmLastSuccessStatements({ ...data, updates: updates }),
    ]);
  }

  @CaptureSpan()
  public async applyVmBackupIntervals(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    updates: Array<{ vmId: string; intervalSeconds: number | null }>;
  }): Promise<void> {
    if (data.updates.length === 0) {
      return;
    }
    await this.runStatements(getXcpNgVmIntervalStatements(data));
  }

  @CaptureSpan()
  public async applyHostPatches(data: {
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
    hosts: Array<XcpNgHostPatches>;
  }): Promise<void> {
    if (data.hosts.length === 0) {
      return;
    }
    await this.runStatements(getXcpNgHostPatchStatements(data));
  }
}

export default new Service();
