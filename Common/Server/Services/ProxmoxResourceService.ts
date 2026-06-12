import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProxmoxResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * ProxmoxResourceService
 *
 * Writes and reads the Proxmox inventory table populated by the
 * telemetry ingest path. Callers are either:
 *   - OtelMetricsIngestService (bulkUpsert + bulkUpdateLatestMetrics,
 *     from the pve_* snapshot scan in processMetricsAsync)
 *   - CleanupStaleResources worker (deleteStaleForCluster)
 *   - ProxmoxResourceAPI / the dashboard pages (reads via the
 *     inherited DatabaseService CRUD)
 *
 * Identity + status and the latest-metric mirror both arrive on the
 * same metric scrape (unlike K8s, which needs a separate k8sobjects
 * log stream for identity), so both writes happen in the same flush.
 *
 * ------------------------------------------------------------------
 */

export interface ParsedProxmoxResource {
  kind: string; // Node | Guest | Storage
  externalId: string; // raw pve `id` label, e.g. node/pve1, qemu/100
  name: string | null;
  vmid: number | null;
  guestType: string | null; // qemu | lxc
  parentNodeName: string | null;
  isUp: boolean | null;
  haState: string | null;
  onboot: boolean | null;
  uptimeSeconds: number | null;
  lastSeenAt: Date;
}

export interface ProxmoxResourceLatestMetric {
  kind: string;
  externalId: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  maxMemoryBytes: number | null;
  memoryPercent: number | null;
  diskBytes: number | null;
  maxDiskBytes: number | null;
  observedAt: Date;
}

export interface ProxmoxInventorySummary {
  countsByKind: Record<string, number>;
  nodeOnlineCount: number;
  guestRunningCount: number;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * Column order used by bulkUpsert() and its generated parameter tuples.
 * Keep this and the INSERT column list in perfect sync.
 */
const UPSERT_COLUMNS: Array<string> = [
  "projectId",
  "proxmoxClusterId",
  "kind",
  "externalId",
  "name",
  "vmid",
  "guestType",
  "parentNodeName",
  "isUp",
  "haState",
  "onboot",
  "uptimeSeconds",
  "lastSeenAt",
  "version",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed resources for a single (project, cluster)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, proxmoxClusterId,
   * kind, externalId) index with a dominance guard on lastSeenAt so
   * out-of-order ingest never regresses a newer snapshot.
   *
   * Identity/status columns COALESCE against the existing row (unlike
   * the K8s upsert, which overwrites): a pve-exporter batch is usually
   * a complete scrape, but a batch that happens to lack an info series
   * (e.g. only pve_up made it through a pipeline filter) must not blank
   * name/vmid/haState that an earlier batch already filled.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    resources: Array<ParsedProxmoxResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < data.resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedProxmoxResource> = data.resources.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const r of chunk) {
        const placeholders: Array<string> = [];
        for (let c: number = 0; c < UPSERT_COLUMNS.length; c++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        params.push(
          data.projectId.toString(),
          data.proxmoxClusterId.toString(),
          r.kind,
          r.externalId,
          r.name,
          r.vmid,
          r.guestType,
          r.parentNodeName,
          r.isUp,
          r.haState,
          r.onboot,
          r.uptimeSeconds !== null ? Math.trunc(r.uptimeSeconds) : null,
          r.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "ProxmoxResource" (
          "projectId", "proxmoxClusterId", "kind", "externalId",
          "name", "vmid", "guestType", "parentNodeName",
          "isUp", "haState", "onboot", "uptimeSeconds",
          "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "proxmoxClusterId", "kind", "externalId")
        DO UPDATE SET
          "name" = COALESCE(EXCLUDED."name", "ProxmoxResource"."name"),
          "vmid" = COALESCE(EXCLUDED."vmid", "ProxmoxResource"."vmid"),
          "guestType" = COALESCE(EXCLUDED."guestType", "ProxmoxResource"."guestType"),
          "parentNodeName" = COALESCE(EXCLUDED."parentNodeName", "ProxmoxResource"."parentNodeName"),
          "isUp" = COALESCE(EXCLUDED."isUp", "ProxmoxResource"."isUp"),
          "haState" = COALESCE(EXCLUDED."haState", "ProxmoxResource"."haState"),
          "onboot" = COALESCE(EXCLUDED."onboot", "ProxmoxResource"."onboot"),
          "uptimeSeconds" = COALESCE(EXCLUDED."uptimeSeconds", "ProxmoxResource"."uptimeSeconds"),
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "ProxmoxResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Update the latest-metric mirror columns for a batch of resources.
   * Plain UPDATE: in practice the row always exists because bulkUpsert
   * runs in the same flush; if it somehow doesn't, the write is
   * silently skipped and the next flush catches up.
   *
   * Guarded by metricsUpdatedAt so out-of-order points don't regress a
   * newer observation. COALESCE keeps the existing value when a batch
   * lacks a series — notably latestDiskBytes stays NULL (never 0) for
   * qemu guests without the QEMU guest agent.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    metrics: Array<ProxmoxResourceLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ProxmoxResourceLatestMetric> = data.metrics.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.proxmoxClusterId.toString(),
      ];
      let paramIndex: number = 3;

      for (const m of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::timestamptz)`,
        );
        params.push(
          m.kind,
          m.externalId,
          m.cpuPercent !== null && m.cpuPercent !== undefined
            ? m.cpuPercent
            : null,
          m.memoryBytes !== null && m.memoryBytes !== undefined
            ? Math.trunc(m.memoryBytes).toString()
            : null,
          m.maxMemoryBytes !== null && m.maxMemoryBytes !== undefined
            ? Math.trunc(m.maxMemoryBytes).toString()
            : null,
          m.memoryPercent !== null && m.memoryPercent !== undefined
            ? m.memoryPercent
            : null,
          m.diskBytes !== null && m.diskBytes !== undefined
            ? Math.trunc(m.diskBytes).toString()
            : null,
          m.maxDiskBytes !== null && m.maxDiskBytes !== undefined
            ? Math.trunc(m.maxDiskBytes).toString()
            : null,
          m.observedAt,
        );
      }

      const sql: string = `
        UPDATE "ProxmoxResource" AS p
        SET
          "latestCpuPercent" = COALESCE(v."cpu", p."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(v."mem", p."latestMemoryBytes"),
          "maxMemoryBytes" = COALESCE(v."maxMem", p."maxMemoryBytes"),
          "latestMemoryPercent" = COALESCE(v."memPct", p."latestMemoryPercent"),
          "latestDiskBytes" = COALESCE(v."disk", p."latestDiskBytes"),
          "maxDiskBytes" = COALESCE(v."maxDisk", p."maxDiskBytes"),
          "metricsUpdatedAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("kind", "externalId", "cpu", "mem", "maxMem", "memPct", "disk", "maxDisk", "observedAt")
        WHERE
          p."projectId" = $1
          AND p."proxmoxClusterId" = $2
          AND p."kind" = v."kind"
          AND p."externalId" = v."externalId"
          AND (p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete all resources in a cluster whose last scrape is older
   * than olderThan. Returns the number of deleted rows. Only called by
   * the cleanup worker for clusters that are still connected — a
   * disconnected cluster keeps its last-known inventory.
   */
  @CaptureSpan()
  public async deleteStaleForCluster(data: {
    proxmoxClusterId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "ProxmoxResource" WHERE "proxmoxClusterId" = $1 AND "lastSeenAt" < $2`,
        [data.proxmoxClusterId.toString(), data.olderThan],
      );

    // Postgres driver returns [rows, affected] for DELETE — normalize.
    let affected: number = 0;
    if (Array.isArray(result) && result.length >= 2) {
      const second: unknown = (result as Array<unknown>)[1];
      if (typeof second === "number") {
        affected = second;
      }
    }

    if (affected > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `ProxmoxResource cleanup deleted ${affected} stale rows for cluster ${data.proxmoxClusterId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * Compute the sidebar/overview summary in Postgres: counts per kind
   * plus the online/running breakdowns, in a single round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
  }): Promise<ProxmoxInventorySummary> {
    const rows: Array<{
      kind: string;
      count: string;
      upCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "kind",
              COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE "isUp" IS TRUE)::text AS "upCount"
       FROM "ProxmoxResource"
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2 AND "deletedAt" IS NULL
       GROUP BY "kind"`,
      [data.projectId.toString(), data.proxmoxClusterId.toString()],
    );

    const countsByKind: Record<string, number> = {};
    let nodeOnlineCount: number = 0;
    let guestRunningCount: number = 0;
    for (const row of rows) {
      countsByKind[row.kind] = parseInt(row.count, 10) || 0;
      if (row.kind === "Node") {
        nodeOnlineCount = parseInt(row.upCount, 10) || 0;
      }
      if (row.kind === "Guest") {
        guestRunningCount = parseInt(row.upCount, 10) || 0;
      }
    }

    return {
      countsByKind,
      nodeOnlineCount,
      guestRunningCount,
    };
  }

  /**
   * Host cross-link heuristic (WI-17): resolve the cluster a guest
   * with this name belongs to. Case-insensitive — host.name casing
   * (canonicalized at ingest) rarely matches the PVE guest name's
   * casing exactly. Returns null when no guest matches.
   */
  @CaptureSpan()
  public async findGuestClusterIdByName(data: {
    projectId: ObjectID;
    name: string;
  }): Promise<ObjectID | null> {
    const guest: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        kind: "Guest",
        name: QueryHelper.findWithSameText(data.name),
      },
      select: {
        _id: true,
        proxmoxClusterId: true,
      },
      props: {
        isRoot: true,
      },
    });

    return guest?.proxmoxClusterId || null;
  }

  /**
   * Helper for the cleanup worker: snapshot-interval aware cutoff.
   * 3× the 5-minute scrape interval by default. Tune via
   * PVE_INVENTORY_STALE_MINUTES (min 5).
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined = process.env["PVE_INVENTORY_STALE_MINUTES"];
    if (raw) {
      const parsed: number = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 5) {
        return parsed;
      }
    }
    return 15;
  }
}

export default new Service();
