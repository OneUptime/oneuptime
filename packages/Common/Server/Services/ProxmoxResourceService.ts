import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProxmoxResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import { truncateShortText } from "../Utils/Database/TruncateColumnValue";
import logger from "../Utils/Logger";
import {
  ProxmoxRosterNode,
  isProxmoxSilentNodeDetectionEnabled,
} from "../Utils/Telemetry/ProxmoxNativeNodeLiveness";

const NODE_ID_PREFIX: string = "node/";

export type ProxmoxRemoveNodeResult =
  | "removed"
  | "not-found"
  | "not-native"
  | "still-reporting";

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
  /*
   * WI-24 backup coverage: true = covered by at least one backup job,
   * false = a pve_not_backed_up_info series carried this guest's id,
   * null = batch lacked the backup-info collector output (keeps the
   * last-known value via COALESCE) or non-Guest kind.
   */
  isBackedUp: boolean | null;
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
  "isBackedUp",
  "uptimeSeconds",
  "lastSeenAt",
  "isNativePush",
  "version",
];

/*
 * ProxmoxResource's text columns are all ShortText (100 chars). The
 * bulk paths below go through manager.query(), which skips the length
 * validation DatabaseService applies to ordinary writes, so a single
 * oversized value aborts the whole 500-row INSERT chunk it rides in.
 * Clamp per value instead, so one pathological guest can never drop the
 * rest of the scrape.
 */
function sanitizeResource(r: ParsedProxmoxResource): ParsedProxmoxResource {
  return {
    ...r,
    kind: truncateShortText(r.kind),
    externalId: truncateShortText(r.externalId),
    name: truncateShortText(r.name),
    guestType: truncateShortText(r.guestType),
    parentNodeName: truncateShortText(r.parentNodeName),
    haState: truncateShortText(r.haState),
  };
}

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
   *
   * isNativePush records where the batch came from — the Proxmox VE
   * native push (true) or the agent (false) — and follows the latest
   * observation, so a cluster moved from one to the other follows too.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    resources: Array<ParsedProxmoxResource>;
    isNativePush?: boolean | undefined;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    const resources: Array<ParsedProxmoxResource> = data.resources.map(
      (r: ParsedProxmoxResource) => {
        const sanitized: ParsedProxmoxResource = sanitizeResource(r);
        if (sanitized.externalId !== r.externalId) {
          logger.warn(
            `ProxmoxResource externalId exceeds ${ColumnLength.ShortText} chars; truncated to "${sanitized.externalId}" (cluster ${data.proxmoxClusterId.toString()}).`,
          );
        }
        return sanitized;
      },
    );

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedProxmoxResource> = resources.slice(
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
          r.isBackedUp,
          r.uptimeSeconds !== null ? Math.trunc(r.uptimeSeconds) : null,
          r.lastSeenAt,
          Boolean(data.isNativePush),
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "ProxmoxResource" (
          "projectId", "proxmoxClusterId", "kind", "externalId",
          "name", "vmid", "guestType", "parentNodeName",
          "isUp", "haState", "onboot", "isBackedUp", "uptimeSeconds",
          "lastSeenAt", "isNativePush", "version"
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
          "isBackedUp" = COALESCE(EXCLUDED."isBackedUp", "ProxmoxResource"."isBackedUp"),
          "uptimeSeconds" = COALESCE(EXCLUDED."uptimeSeconds", "ProxmoxResource"."uptimeSeconds"),
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "isNativePush" = EXCLUDED."isNativePush",
          "notReportingMarkedAt" = NULL,
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
        /*
         * The identity clamps MUST match bulkUpsert's, or this mirror
         * UPDATE would silently miss the row the upsert just wrote
         * under the truncated externalId.
         */
        params.push(
          truncateShortText(m.kind),
          truncateShortText(m.externalId),
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
   *
   * Exception: a Node that reports itself over the Proxmox VE native push
   * (isNativePush) is kept until it has been silent for longer than the
   * retention window, or is removed (removeOfflineNode). Those pushes
   * never say which nodes the cluster has — the Node rows ARE the
   * cluster's membership, the roster the nodes still alive report the
   * silent ones from (getNodeRoster uses the same cutoff). Pruning a
   * silent native node at the normal cutoff would drop it from the
   * roster: it would never be reported down, its Node Offline alert
   * would resolve, and Quorum at Risk would stop counting it. That
   * holds whether or not it has been marked Offline yet — a node that
   * died just before or during a OneUptime outage is only marked once
   * the nodes have pushed again for two minutes after it. With silent-node
   * detection switched off (PVE_NATIVE_NODE_SILENCE_DETECTION=false)
   * nothing would ever mark such a node, so the keep is off too and every
   * row ages out as before.
   */
  @CaptureSpan()
  public async deleteStaleForCluster(data: {
    proxmoxClusterId: ObjectID;
    olderThan: Date;
    now?: Date | undefined;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      isProxmoxSilentNodeDetectionEnabled()
        ? await this.getRepository().manager.query(
            `DELETE FROM "ProxmoxResource"
             WHERE "proxmoxClusterId" = $1
               AND "lastSeenAt" < $2
               AND NOT ("kind" = 'Node'
                        AND "isNativePush" IS TRUE
                        AND "lastSeenAt" >= $3)`,
            [
              data.proxmoxClusterId.toString(),
              data.olderThan,
              this.getSilentNodeRetentionCutoff(data.now),
            ],
          )
        : await this.getRepository().manager.query(
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
   * The cluster's nodes, for deciding which ones have stopped reporting
   * (ProxmoxNativeNodeLiveness). A node silent for longer than the
   * retention window drops out, so a node removed from the cluster stops
   * being reported after at most that long even if nobody removes it.
   */
  @CaptureSpan()
  public async getNodeRoster(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    now?: Date | undefined;
  }): Promise<Array<ProxmoxRosterNode>> {
    const seenSince: Date = this.getSilentNodeRetentionCutoff(data.now);
    const rows: Array<{
      externalId: string;
      lastSeenAt: Date | string;
      isUp: boolean | null;
      notReportingMarkedAt: Date | string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "externalId", "lastSeenAt", "isUp", "notReportingMarkedAt" FROM "ProxmoxResource"
         WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
           AND "kind" = 'Node' AND "deletedAt" IS NULL
           AND "lastSeenAt" >= $3`,
      [data.projectId.toString(), data.proxmoxClusterId.toString(), seenSince],
    );

    const roster: Array<ProxmoxRosterNode> = [];
    for (const row of rows) {
      if (!row.externalId || !row.externalId.startsWith(NODE_ID_PREFIX)) {
        continue;
      }
      const nodeName: string = row.externalId.substring(NODE_ID_PREFIX.length);
      const lastSeenAt: Date = new Date(row.lastSeenAt);
      if (!nodeName || isNaN(lastSeenAt.getTime())) {
        continue;
      }
      const markedAt: Date | null =
        row.notReportingMarkedAt instanceof Date ||
        typeof row.notReportingMarkedAt === "string"
          ? new Date(row.notReportingMarkedAt)
          : null;
      roster.push({
        nodeName,
        lastSeenAt,
        isUp: typeof row.isUp === "boolean" ? row.isUp : null,
        notReportingMarkedAt:
          markedAt && !isNaN(markedAt.getTime()) ? markedAt : null,
      });
    }
    return roster;
  }

  /**
   * Mark nodes that their live siblings report as not reporting
   * (Proxmox VE native push) as Offline: isUp = false, uptimeSeconds
   * cleared. Never touches lastSeenAt or metricsUpdatedAt, which stay the
   * node's own last push. The node's next push flips it back through
   * bulkUpsert (a newer lastSeenAt, isUp = true). A row the node itself
   * refreshed after `silentBefore` is left alone, so a late report can
   * never mark a live node down. Returns the number of rows written.
   *
   * A node the native pushes report is a member of a native-push cluster,
   * so the mark also sets isNativePush: a node that was already down when
   * the cluster moved from the agent to the native push (or before this
   * column existed) is then kept like any other native node instead of
   * being pruned while it is still being reported.
   *
   * The mark itself is notReportingMarkedAt, refreshed at most once a
   * minute while the node stays reported: the "marked recently" the
   * reports of an Offline node rely on to carry on through a gap
   * (ProxmoxNativeNodeLiveness). It is written as `markedAt`, on the
   * caller's (the ingest worker's) clock — the clock it is later judged
   * against — never the database's now(), and only here; the node's own
   * next push clears it (bulkUpsert).
   */
  @CaptureSpan()
  public async markNodesNotReporting(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    nodeNames: Array<string>;
    // The report's own time minus the silence window, on the PVE clock.
    silentBefore: Date;
    // Now, on the ingest worker's clock.
    markedAt?: Date | undefined;
  }): Promise<number> {
    if (data.nodeNames.length === 0) {
      return 0;
    }
    const markedAt: Date = data.markedAt || OneUptimeDate.getCurrentDate();
    const externalIds: Array<string> = data.nodeNames.map(
      (nodeName: string) => {
        return truncateShortText(`${NODE_ID_PREFIX}${nodeName}`) as string;
      },
    );

    const result: unknown = await this.getRepository().manager.query(
      `UPDATE "ProxmoxResource"
       SET "isUp" = false,
           "uptimeSeconds" = NULL,
           "isNativePush" = true,
           "notReportingMarkedAt" = $5,
           "updatedAt" = now()
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND "kind" = 'Node' AND "externalId" = ANY($3)
         AND "deletedAt" IS NULL
         AND "lastSeenAt" < $4
         AND ("isUp" IS DISTINCT FROM false
              OR "isNativePush" IS DISTINCT FROM true
              OR "notReportingMarkedAt" IS NULL
              OR "notReportingMarkedAt" < $6)`,
      [
        data.projectId.toString(),
        data.proxmoxClusterId.toString(),
        externalIds,
        data.silentBefore,
        markedAt,
        OneUptimeDate.addRemoveSeconds(markedAt, -60),
      ],
    );

    // Postgres driver returns [rows, affected] for UPDATE — normalize.
    if (Array.isArray(result) && typeof result[1] === "number") {
      return result[1];
    }
    return 0;
  }

  /**
   * Take a cluster's Node rows into the native-push keep. Called when the
   * cluster's native push is flushed (fenced by the caller): a node that
   * was already down under the Proxmox Agent — or before isNativePush
   * existed — never pushes itself, so without this its old row would be
   * pruned in the two minutes before the live nodes first report it, and
   * it would drop off the roster while still down. Only rows last seen no
   * later than `seenUpTo` (the batch's newest observation) are taken: a
   * native batch processed late, after the cluster moved back to the
   * agent, must not take the agent's newer rows. It is not a report: the
   * rows' notReportingMarkedAt is left alone. Returns the number of rows
   * flagged.
   */
  @CaptureSpan()
  public async adoptNodesAsNativePush(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    seenUpTo: Date;
  }): Promise<number> {
    const result: unknown = await this.getRepository().manager.query(
      `UPDATE "ProxmoxResource"
       SET "isNativePush" = true
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND "kind" = 'Node' AND "deletedAt" IS NULL
         AND "isNativePush" IS DISTINCT FROM true
         AND "lastSeenAt" <= $3`,
      [
        data.projectId.toString(),
        data.proxmoxClusterId.toString(),
        data.seenUpTo,
      ],
    );

    // Postgres driver returns [rows, affected] for UPDATE — normalize.
    if (Array.isArray(result) && typeof result[1] === "number") {
      return result[1];
    }
    return 0;
  }

  /**
   * Remove a node that has stopped reporting — for a node taken out of
   * the cluster for good, which OneUptime cannot tell apart from a dead
   * one on the Proxmox VE native push. Its siblings stop reporting it
   * within a minute and its Node Offline alert resolves. Only such a node
   * is removed:
   *   - "not-found": no such node in this cluster;
   *   - "not-native": an agent node — the agent lets a node go on its own
   *     once the cluster no longer lists it, and would re-create a node
   *     it still lists on the next scrape;
   *   - "still-reporting": the node is up; it would reappear on its next
   *     push.
   */
  @CaptureSpan()
  public async removeOfflineNode(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    externalId: string;
  }): Promise<ProxmoxRemoveNodeResult> {
    if (!data.externalId.startsWith(NODE_ID_PREFIX)) {
      return "not-found";
    }
    // Clamped the way bulkUpsert stored it.
    const params: Array<string> = [
      data.projectId.toString(),
      data.proxmoxClusterId.toString(),
      truncateShortText(data.externalId) as string,
    ];

    const result: unknown = await this.getRepository().manager.query(
      `DELETE FROM "ProxmoxResource"
       WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
         AND "kind" = 'Node' AND "externalId" = $3
         AND "deletedAt" IS NULL
         AND "isUp" IS FALSE AND "isNativePush" IS TRUE`,
      params,
    );

    // Postgres driver returns [rows, affected] for DELETE — normalize.
    if (
      Array.isArray(result) &&
      typeof result[1] === "number" &&
      result[1] > 0
    ) {
      return "removed";
    }

    // Not deleted: say why, so the caller can answer precisely.
    const rows: Array<{ isUp: boolean | null; isNativePush: boolean | null }> =
      await this.getRepository().manager.query(
        `SELECT "isUp", "isNativePush" FROM "ProxmoxResource"
         WHERE "projectId" = $1 AND "proxmoxClusterId" = $2
           AND "kind" = 'Node' AND "externalId" = $3
           AND "deletedAt" IS NULL`,
        params,
      );
    const row:
      | { isUp: boolean | null; isNativePush: boolean | null }
      | undefined = rows[0];
    if (!row) {
      return "not-found";
    }
    if (row.isNativePush !== true) {
      return "not-native";
    }
    return "still-reporting";
  }

  /**
   * The oldest last report a native-push node may have and still be kept
   * and reported: now minus getSilentNodeRetentionHours().
   */
  public getSilentNodeRetentionCutoff(now?: Date | undefined): Date {
    return OneUptimeDate.addRemoveHours(
      now || OneUptimeDate.getCurrentDate(),
      -this.getSilentNodeRetentionHours(),
    );
  }

  /**
   * How long a node that stopped reporting is still reported (and kept
   * as Offline) before it is treated as gone. 7 days by default — long
   * enough to outlast a weekend, short enough that a node removed from
   * the cluster without using "Remove Node" eventually lets go. Tune via
   * PVE_SILENT_NODE_RETENTION_HOURS (min 1).
   */
  public getSilentNodeRetentionHours(): number {
    const raw: string | undefined =
      process.env["PVE_SILENT_NODE_RETENTION_HOURS"];
    if (raw) {
      const parsed: number = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        return parsed;
      }
    }
    return 7 * 24;
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
