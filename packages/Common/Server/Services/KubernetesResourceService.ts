import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/KubernetesResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { ParsedKubernetesResource } from "../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  KUBERNETES_FAILING_WAIT_REASONS,
  KubernetesAttentionFinding,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesObjectRef,
  getKubernetesAttentionFindings,
  getKubernetesHealthSeverity,
  getKubernetesOwners,
  getKubernetesPodWorkload,
} from "../../Types/Kubernetes/KubernetesHealth";
import {
  KUBERNETES_VOLUME_FILL_MAX_WINDOW_MS,
  KubernetesStorageRow,
} from "../../Types/Kubernetes/KubernetesStorageHealth";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * KubernetesResourceService
 *
 * Writes and reads the inventory table populated by the telemetry
 * ingest path. Callers are either:
 *   - OtelLogsIngestService (bulkUpsert, from processLogsAsync)
 *   - CleanupStaleResources worker (deleteStaleForCluster)
 *   - KubernetesResourceAPI / KubernetesObjectFetcher (reads via
 *     the inherited DatabaseService CRUD)
 *
 * ------------------------------------------------------------------
 */

export type { ParsedKubernetesResource };

export interface ResourceLatestMetric {
  kind: string;
  namespaceKey: string;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryPercent: number | null;
  observedAt: Date;
  /*
   * Optional Pod controller lineage. Read from
   * resource.k8s.deployment.name / resource.k8s.cronjob.name on the
   * metric stream. Persisted via COALESCE so once written they stick
   * even if a later batch lacks the attribute.
   */
  controllerDeploymentName?: string | null;
  controllerCronJobName?: string | null;
}

/*
 * A persistent volume claim's latest usage, as the kubelet measured the
 * claim's volume (the kubeletstats receiver's k8s.volume.* series, which the
 * kubernetes-agent names by k8s.persistentvolumeclaim.name). A null reading
 * keeps the one stored: one batch may carry a claim's capacity, the next its
 * inodes.
 */
export interface ResourceLatestVolumeStats {
  namespaceKey: string;
  // The claim's name.
  name: string;
  capacityBytes: number | null;
  availableBytes: number | null;
  inodes: number | null;
  inodesFree: number | null;
  observedAt: Date;
}

/*
 * A node's latest disk reading: its root filesystem (k8s.node.filesystem.*,
 * the disk the kubelet evicts pods by) and the filesystem that holds its
 * container images (each container's root filesystem, container.filesystem.*).
 * A null reading keeps the stored one.
 */
export interface ResourceLatestNodeFilesystem {
  // The node's name.
  name: string;
  capacityBytes: number | null;
  availableBytes: number | null;
  imageFs: KubernetesImageFsReading;
  observedAt: Date;
}

/*
 * The image filesystem, as one scrape showed it beside the root filesystem
 * (KubernetesStorageHealth.isSeparateKubernetesImageFs): a disk of its own,
 * whose reading is stored; the root filesystem itself, which clears what is
 * stored; or a batch that could not tell, which keeps it.
 */
export type KubernetesImageFsReading =
  | { state: "separate"; capacityBytes: number; availableBytes: number }
  | { state: "same" }
  | { state: "unknown" };

export interface InventorySummary {
  countsByKind: Record<string, number>;
  /*
   * Sum of the denormalized containerCount column across all pods in
   * the cluster. Containers aren't a top-level kind in the inventory,
   * so we derive the total server-side so the sidebar badge and the
   * Containers page agree.
   */
  containerCount: number;
  podPhaseCounts: {
    running: number;
    pending: number;
    failed: number;
    succeeded: number;
    unknown: number;
  };
  /*
   * Each pod once, by what kubectl's STATUS column would say of it
   * (KubernetesHealth.getKubernetesPodStatusBucket): a pod whose container
   * cannot run is counted under that word - CrashLoopBackOff,
   * ImagePullBackOff - and not as Running or Pending, which its phase still
   * says. What the cluster's hero shows; podPhaseCounts stays the phases.
   */
  podStatusCounts: KubernetesPodStatusCounts;
  nodeReadyCounts: {
    ready: number;
    notReady: number;
  };
  nodePressureCounts: {
    memoryPressure: number;
    diskPressure: number;
    pidPressure: number;
  };
}

export interface KubernetesPodStatusCounts {
  // Running, no container that cannot run.
  running: number;
  // Pending, no container that cannot run.
  pending: number;
  failed: number;
  succeeded: number;
  // Kubernetes' Unknown phase: the pod's node stopped reporting it.
  unknown: number;
  /*
   * The pods a container of which cannot run, by kubectl's word for it
   * ("CrashLoopBackOff", "Init:Error"), the most first; "" when no word
   * could be read.
   */
  cannotRun: Array<{ reason: string; count: number }>;
}

/*
 * The word kubectl's STATUS shows for a pod whose container cannot run -
 * the same word KubernetesHealth.assessKubernetesPod gives it: the first
 * container waiting for a reason that means it cannot run, else the first
 * init container waiting so or ended in failure, as "Init:<reason>". Read
 * only for the pods ingest flagged critical, which are exactly those
 * (healthSeverity); $3 is { reasons: KUBERNETES_FAILING_WAIT_REASONS }.
 */
export const POD_CANNOT_RUN_REASON_SQL: string = `COALESCE(
  jsonb_path_query_first(
    "status",
    '$.containerStatuses[*] ? (@.state == "waiting" && @.reason == $reasons[*]).reason',
    $3::jsonb
  ) #>> '{}',
  'Init:' || (jsonb_path_query_first(
    "status",
    '$.initContainerStatuses[*] ? ((@.state == "waiting" && @.reason == $reasons[*]) || (@.state == "terminated" && @.reason != "" && @.reason != "Completed")).reason',
    $3::jsonb
  ) #>> '{}'),
  ''
)`;

/*
 * What a cluster's Needs attention reads (getNeedsAttention). The objects
 * that need attention are few in a working cluster; these bound what one
 * read can cost in a broken one. The worst come first, so a cluster with
 * more than the limit still shows its critical findings.
 */
export const NEEDS_ATTENTION_ROW_LIMIT: number = 2000;
export const NEEDS_ATTENTION_WORKLOAD_LIMIT: number = 5000;
export const NEEDS_ATTENTION_FINDING_LIMIT: number = 500;

// The workloads a pod's or a Job's finding folds into.
const NEEDS_ATTENTION_WORKLOAD_KINDS: Array<string> = [
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
];

export interface KubernetesNeedsAttention {
  findings: Array<KubernetesAttentionFinding>;
  // More needed attention than one read takes: the worst are listed.
  isTruncated: boolean;
}

/*
 * An object's own page reads it with what it runs (getPart): a workload's
 * pods, a node's pods, a CronJob's Jobs and their pods. A node runs at most
 * a few hundred pods and a namespace's workloads a few thousand; these
 * bound one read.
 */
export const PART_POD_LIMIT: number = 1000;
export const PART_CANDIDATE_LIMIT: number = 5000;

/*
 * The disk columns of a row (KubernetesStorageRow): a claim's filesystem, a
 * node's root and image filesystems, when each was measured and a claim's
 * fill baseline. The rules read them, so every read that hands rows to the
 * rules selects them.
 */
export const KUBERNETES_DISK_COLUMNS: Array<keyof KubernetesStorageRow> = [
  "latestVolumeCapacityBytes",
  "latestVolumeAvailableBytes",
  "latestVolumeInodes",
  "latestVolumeInodesFree",
  "latestVolumeMeasuredAt",
  "latestVolumeUsedBaselineBytes",
  "latestVolumeUsedBaselineAt",
  "latestImageFsCapacityBytes",
  "latestImageFsAvailableBytes",
];

function quotedColumns(
  columns: Array<string>,
  table?: string | undefined,
): string {
  return columns
    .map((column: string): string => {
      return table ? `${table}."${column}"` : `"${column}"`;
    })
    .join(", ");
}

// What the rules read of a row, with its id and the verdict stored for it.
const HEALTH_COLUMNS: Array<string> = [
  "_id",
  "kind",
  "namespaceKey",
  "name",
  "phase",
  "isReady",
  "hasMemoryPressure",
  "hasDiskPressure",
  "hasPidPressure",
  "labels",
  "ownerReferences",
  "spec",
  "status",
  "lastSeenAt",
  "resourceCreationTimestamp",
  "healthSeverity",
  ...KUBERNETES_DISK_COLUMNS,
  "metricsUpdatedAt",
];

// A row an UPDATE returned, for its verdict to be worked out again.
type HealthRefreshRow = KubernetesHealthRow & {
  _id: string;
  healthSeverity: string | null;
};

/*
 * A new object under a name an old one had - a claim deleted and created
 * again, a node replaced - starts with no disk reading: the old one's would
 * read as the new one's until a pod mounts it.
 */
const UID_CHANGED_SQL: string = `"KubernetesResource"."uid" IS NOT NULL AND EXCLUDED."uid" IS NOT NULL AND "KubernetesResource"."uid" <> EXCLUDED."uid"`;

// A claim's used bytes in a reading, when its capacity and free space are known.
const VOLUME_USED_SQL: string = `(CASE
  WHEN COALESCE(v."capacity", k."latestVolumeCapacityBytes") IS NULL
    OR COALESCE(v."available", k."latestVolumeAvailableBytes") IS NULL
  THEN NULL
  ELSE GREATEST(COALESCE(v."capacity", k."latestVolumeCapacityBytes") - COALESCE(v."available", k."latestVolumeAvailableBytes"), 0)
END)`;

const FILL_MAX_WINDOW_SQL: string = `interval '${Math.round(
  KUBERNETES_VOLUME_FILL_MAX_WINDOW_MS / 1000,
)} seconds'`;

// No baseline yet, or one from a later clock: this reading starts one.
const BASELINE_RESTARTS_SQL: string = `k."latestVolumeUsedBaselineAt" IS NULL OR k."latestVolumeUsedBaselineBytes" IS NULL OR v."observedAt" < k."latestVolumeUsedBaselineAt"`;

/*
 * A baseline older than the window moves halfway to this reading, a point
 * on the same line: the rate stays, and the window is half as long again.
 */
const BASELINE_TOO_OLD_SQL: string = `v."observedAt" - k."latestVolumeUsedBaselineAt" > ${FILL_MAX_WINDOW_SQL}`;

// A row as getPart and the pages read it: what the rules and the lists use.
export interface KubernetesPartRow extends KubernetesHealthRow {
  _id: string;
  latestCpuPercent: number | string | null;
  latestMemoryBytes: number | string | null;
  latestMemoryPercent: number | string | null;
  metricsUpdatedAt: Date | null;
}

export interface KubernetesPart {
  // Null when the cluster's inventory holds no such object.
  part: KubernetesPartRow | null;
  /*
   * Its pods, the most recently seen first. A namespace's: the ones in it
   * that need attention, the worst first.
   */
  pods: Array<KubernetesPartRow>;
  // A CronJob's Jobs; empty for any other kind.
  jobs: Array<KubernetesPartRow>;
  /*
   * A namespace's other objects that need attention, with the workloads in
   * it a pod's finding folds into (as the cluster's Needs attention reads
   * them); empty for any other kind.
   */
  objects: Array<KubernetesPartRow>;
  // It runs more pods than one read takes.
  isPodsTruncated: boolean;
}

// The kinds whose page lists the pods they run.
export const KINDS_WITH_PODS: ReadonlySet<string> = new Set<string>([
  "Node",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "DeploymentConfig",
]);

const UPSERT_BATCH_SIZE: number = 500;
// How many pod-owned claims one cluster's read takes.
export const POD_OWNED_CLAIMS_LIMIT: number = 20000;
// How many pods one read for the claims Needs attention lists takes.
export const NEEDS_ATTENTION_CLAIM_POD_LIMIT: number = 2000;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * Column order used by both bulkUpsert() and its generated parameter tuples.
 * Keep this and the INSERT column list in perfect sync.
 */
const UPSERT_COLUMNS: Array<keyof ParsedKubernetesResource | string> = [
  "projectId",
  "kubernetesClusterId",
  "kind",
  "namespaceKey",
  "name",
  "uid",
  "phase",
  "isReady",
  "hasMemoryPressure",
  "hasDiskPressure",
  "hasPidPressure",
  "labels",
  "annotations",
  "ownerReferences",
  "spec",
  "containerCount",
  "status",
  "lastSeenAt",
  "resourceCreationTimestamp",
  "healthSeverity",
  "version",
];

/*
 * KubernetesResource's text columns are bounded varchars — name and
 * controllerDeploymentName at 500 chars, kind / namespaceKey / uid /
 * phase at 100. The bulk paths below go through manager.query(), which
 * skips the length validation DatabaseService applies to ordinary
 * writes, so a single oversized value aborts the whole 500-row INSERT
 * chunk it rides in. Clamp per value instead, so one pathological
 * object can never drop the rest of the snapshot.
 */
function sanitizeResource(
  r: ParsedKubernetesResource,
): ParsedKubernetesResource {
  return {
    ...r,
    kind: truncateShortText(r.kind),
    namespaceKey: truncateShortText(r.namespaceKey),
    name: truncateLongText(r.name),
    uid: truncateShortText(r.uid),
    phase: truncateShortText(r.phase),
    healthSeverity: truncateShortText(r.healthSeverity ?? null) as
      | ParsedKubernetesResource["healthSeverity"]
      | null,
  };
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed resources for a single (project, cluster)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, clusterId, kind,
   * namespaceKey, name) index with a dominance guard on lastSeenAt
   * so out-of-order ingest never regresses a newer snapshot.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    resources: Array<ParsedKubernetesResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    const resources: Array<ParsedKubernetesResource> = data.resources.map(
      (r: ParsedKubernetesResource) => {
        const sanitized: ParsedKubernetesResource = sanitizeResource(r);
        if (sanitized.name !== r.name) {
          logger.warn(
            `KubernetesResource name exceeds ${ColumnLength.LongText} chars; truncated to "${sanitized.name}" (cluster ${data.kubernetesClusterId.toString()}).`,
          );
        }
        return sanitized;
      },
    );

    await this.withStoredDiskVerdicts({
      projectId: data.projectId,
      kubernetesClusterId: data.kubernetesClusterId,
      resources: resources,
    });

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedKubernetesResource> = resources.slice(
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
          data.kubernetesClusterId.toString(),
          r.kind,
          r.namespaceKey,
          r.name,
          r.uid,
          r.phase,
          r.isReady,
          r.hasMemoryPressure,
          r.hasDiskPressure,
          r.hasPidPressure,
          r.labels ? JSON.stringify(r.labels) : null,
          r.annotations ? JSON.stringify(r.annotations) : null,
          r.ownerReferences ? JSON.stringify(r.ownerReferences) : null,
          r.spec ? JSON.stringify(r.spec) : null,
          r.containerCount,
          r.status ? JSON.stringify(r.status) : null,
          r.lastSeenAt,
          r.resourceCreationTimestamp,
          r.healthSeverity ?? null,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "KubernetesResource" (
          "projectId", "kubernetesClusterId", "kind", "namespaceKey", "name",
          "uid", "phase", "isReady",
          "hasMemoryPressure", "hasDiskPressure", "hasPidPressure",
          "labels", "annotations", "ownerReferences", "spec", "containerCount", "status",
          "lastSeenAt", "resourceCreationTimestamp", "healthSeverity", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "kubernetesClusterId", "kind", "namespaceKey", "name")
        DO UPDATE SET
          "uid" = EXCLUDED."uid",
          "phase" = EXCLUDED."phase",
          "isReady" = EXCLUDED."isReady",
          "hasMemoryPressure" = EXCLUDED."hasMemoryPressure",
          "hasDiskPressure" = EXCLUDED."hasDiskPressure",
          "hasPidPressure" = EXCLUDED."hasPidPressure",
          "labels" = EXCLUDED."labels",
          "annotations" = EXCLUDED."annotations",
          "ownerReferences" = EXCLUDED."ownerReferences",
          "spec" = EXCLUDED."spec",
          "containerCount" = EXCLUDED."containerCount",
          "status" = EXCLUDED."status",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "resourceCreationTimestamp" = EXCLUDED."resourceCreationTimestamp",
          "healthSeverity" = EXCLUDED."healthSeverity",
          ${KUBERNETES_DISK_COLUMNS.map((column: string): string => {
            return `"${column}" = CASE WHEN ${UID_CHANGED_SQL} THEN NULL ELSE "KubernetesResource"."${column}" END`;
          }).join(",\n          ")},
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "KubernetesResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /*
   * A claim's or a node's verdict needs its disk as well as its snapshot,
   * and the snapshot carries no disk: the metrics path writes that. So the
   * verdict of each claim and node of a snapshot is worked out with the
   * disk reading its row holds - unless the object is a new one under the
   * same name, whose old reading the upsert clears. Without this, every
   * snapshot would clear a nearly full claim's verdict until its next
   * reading flagged it again.
   */
  private async withStoredDiskVerdicts(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    resources: Array<ParsedKubernetesResource>;
  }): Promise<void> {
    const withDisks: Array<ParsedKubernetesResource> = data.resources.filter(
      (resource: ParsedKubernetesResource): boolean => {
        return (
          resource.kind === "PersistentVolumeClaim" || resource.kind === "Node"
        );
      },
    );
    if (withDisks.length === 0) {
      return;
    }

    const stored: Array<
      KubernetesStorageRow & {
        kind: string;
        namespaceKey: string;
        name: string;
        uid: string | null;
      }
    > = await this.getRepository().manager.query(
      `SELECT "kind", "namespaceKey", "name", "uid",
         ${quotedColumns([...KUBERNETES_DISK_COLUMNS, "metricsUpdatedAt"])}
       FROM "KubernetesResource"
       WHERE "projectId" = $1
         AND "kubernetesClusterId" = $2
         AND "deletedAt" IS NULL
         AND "kind" = ANY($3)
         AND "name" = ANY($4)
         AND (
           "latestVolumeCapacityBytes" IS NOT NULL
           OR "latestVolumeInodes" IS NOT NULL
           OR "latestImageFsCapacityBytes" IS NOT NULL
         )`,
      [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
        Array.from(
          new Set(
            withDisks.map((resource: ParsedKubernetesResource): string => {
              return resource.kind;
            }),
          ),
        ),
        Array.from(
          new Set(
            withDisks.map((resource: ParsedKubernetesResource): string => {
              return resource.name;
            }),
          ),
        ),
      ],
    );

    const byKey: Map<string, (typeof stored)[number]> = new Map();
    for (const row of stored) {
      byKey.set(`${row.kind}|${row.namespaceKey || ""}|${row.name}`, row);
    }

    for (const resource of withDisks) {
      const row: (typeof stored)[number] | undefined = byKey.get(
        `${resource.kind}|${resource.namespaceKey || ""}|${resource.name}`,
      );
      if (!row || (row.uid && resource.uid && row.uid !== resource.uid)) {
        continue;
      }
      const disk: KubernetesStorageRow = {};
      for (const column of [
        ...KUBERNETES_DISK_COLUMNS,
        "metricsUpdatedAt" as const,
      ]) {
        (disk as Record<string, unknown>)[column] = row[column];
      }
      resource.healthSeverity = getKubernetesHealthSeverity({
        ...resource,
        ...disk,
      });
    }
  }

  /*
   * A claim's or a node's verdict worked out again with the disk reading
   * an UPDATE just wrote, for the rows it returned. Written only where it
   * changed, and only while the stored verdict is still the one read, so a
   * snapshot written in between - which works its own out with the disk
   * (withStoredDiskVerdicts) - is never overwritten by an older one.
   */
  private async refreshHealthSeverity(
    rows: Array<HealthRefreshRow>,
  ): Promise<void> {
    const changed: Array<{
      id: string;
      severity: string | null;
      previous: string | null;
    }> = [];

    for (const row of rows) {
      if (!row || !row._id) {
        continue;
      }
      const severity: string | null = getKubernetesHealthSeverity(row) || null;
      const previous: string | null = row.healthSeverity || null;
      if (severity !== previous) {
        changed.push({ id: row._id, severity: severity, previous: previous });
      }
    }

    for (let i: number = 0; i < changed.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<{
        id: string;
        severity: string | null;
        previous: string | null;
      }> = changed.slice(i, i + UPSERT_BATCH_SIZE);
      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;
      for (const entry of chunk) {
        valueFragments.push(
          `($${paramIndex++}::uuid, $${paramIndex++}::text, $${paramIndex++}::text)`,
        );
        params.push(entry.id, entry.severity, entry.previous);
      }
      await this.getRepository().manager.query(
        `UPDATE "KubernetesResource" AS k
         SET "healthSeverity" = v."severity", "updatedAt" = now()
         FROM (VALUES ${valueFragments.join(", ")}) AS v("id", "severity", "previous")
         WHERE k."_id" = v."id"
           AND k."healthSeverity" IS NOT DISTINCT FROM v."previous"`,
        params,
      );
    }
  }

  // The rows an UPDATE ... RETURNING handed back, whatever the driver's shape.
  private static returnedRows(result: unknown): Array<HealthRefreshRow> {
    if (!Array.isArray(result)) {
      return [];
    }
    // The pg driver hands an UPDATE's RETURNING rows as [rows, count].
    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[0] as Array<HealthRefreshRow>;
    }
    return result as Array<HealthRefreshRow>;
  }

  /**
   * Update latestCpuPercent / latestMemoryBytes / metricsUpdatedAt for
   * a batch of resources (typically Pods or Nodes). Plain UPDATE: if
   * the snapshot row doesn't exist yet, the metric write is silently
   * skipped — the next k8sobjects snapshot creates the row, and the
   * next metric flush catches up.
   *
   * Guarded by metricsUpdatedAt so out-of-order points don't regress
   * a newer observation.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    metrics: Array<ResourceLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ResourceLatestMetric> = data.metrics.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
      ];
      let paramIndex: number = 3;

      for (const m of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::numeric, $${paramIndex++}::timestamptz, $${paramIndex++}, $${paramIndex++})`,
        );
        /*
         * The identity clamps MUST match bulkUpsert's, or this mirror
         * UPDATE would silently miss the row the upsert just wrote
         * under the truncated name. controllerDeploymentName /
         * controllerCronJobName are assigned columns, so an oversized
         * value there aborts the chunk exactly like the INSERT path.
         */
        params.push(
          truncateShortText(m.kind),
          truncateShortText(m.namespaceKey),
          truncateLongText(m.name),
          m.cpuPercent !== null && m.cpuPercent !== undefined
            ? m.cpuPercent
            : null,
          m.memoryBytes !== null && m.memoryBytes !== undefined
            ? Math.trunc(m.memoryBytes).toString()
            : null,
          m.memoryPercent !== null && m.memoryPercent !== undefined
            ? m.memoryPercent
            : null,
          m.observedAt,
          truncateLongText(m.controllerDeploymentName ?? null),
          truncateShortText(m.controllerCronJobName ?? null),
        );
      }

      const sql: string = `
        UPDATE "KubernetesResource" AS k
        SET
          "latestCpuPercent" = COALESCE(v."cpu", k."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(v."mem", k."latestMemoryBytes"),
          "latestMemoryPercent" = COALESCE(v."memPct", k."latestMemoryPercent"),
          "metricsUpdatedAt" = v."observedAt",
          "controllerDeploymentName" = COALESCE(v."deployName", k."controllerDeploymentName"),
          "controllerCronJobName" = COALESCE(v."cronName", k."controllerCronJobName"),
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("kind", "ns", "name", "cpu", "mem", "memPct", "observedAt", "deployName", "cronName")
        WHERE
          k."projectId" = $1
          AND k."kubernetesClusterId" = $2
          AND k."kind" = v."kind"
          AND k."namespaceKey" = v."ns"
          AND k."name" = v."name"
          AND (k."metricsUpdatedAt" IS NULL OR v."observedAt" >= k."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Mirror each persistent volume claim's latest usage onto its row:
   * capacity, available bytes and inodes as the kubelet last measured the
   * claim's volume. The claim mirror of bulkUpdateLatestMetrics, with the
   * same rules: a plain UPDATE, so a claim whose row the next k8sobjects
   * snapshot has yet to write is skipped and caught up on the next flush; a
   * null reading keeps the stored one; and metricsUpdatedAt guards it, so an
   * older point never overwrites a newer one.
   *
   * It also moves the claim's fill baseline (how fast it is filling,
   * KubernetesStorageHealth), and works out again the verdict of each claim
   * it touched: a claim that reached 80% is listed under Needs attention
   * from this reading on, not from the next snapshot.
   */
  @CaptureSpan()
  public async bulkUpdateLatestVolumeStats(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    volumes: Array<ResourceLatestVolumeStats>;
  }): Promise<void> {
    if (data.volumes.length === 0) {
      return;
    }

    const toBigint: (value: number | null) => string | null = (
      value: number | null,
    ): string | null => {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return null;
      }
      return Math.max(0, Math.trunc(value)).toString();
    };

    for (let i: number = 0; i < data.volumes.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ResourceLatestVolumeStats> = data.volumes.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
      ];
      let paramIndex: number = 3;

      for (const v of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::timestamptz)`,
        );
        // The identity clamps MUST match bulkUpsert's, or the claim is missed.
        params.push(
          truncateShortText(v.namespaceKey),
          truncateLongText(v.name),
          toBigint(v.capacityBytes),
          toBigint(v.availableBytes),
          toBigint(v.inodes),
          toBigint(v.inodesFree),
          v.observedAt,
        );
      }

      const sql: string = `
        UPDATE "KubernetesResource" AS k
        SET
          "latestVolumeCapacityBytes" = COALESCE(v."capacity", k."latestVolumeCapacityBytes"),
          "latestVolumeAvailableBytes" = COALESCE(v."available", k."latestVolumeAvailableBytes"),
          "latestVolumeInodes" = COALESCE(v."inodes", k."latestVolumeInodes"),
          "latestVolumeInodesFree" = COALESCE(v."inodesFree", k."latestVolumeInodesFree"),
          "latestVolumeMeasuredAt" = v."observedAt",
          "latestVolumeUsedBaselineBytes" = CASE
            WHEN ${VOLUME_USED_SQL} IS NULL THEN k."latestVolumeUsedBaselineBytes"
            WHEN ${BASELINE_RESTARTS_SQL} THEN ${VOLUME_USED_SQL}
            WHEN ${BASELINE_TOO_OLD_SQL}
              THEN k."latestVolumeUsedBaselineBytes" + (${VOLUME_USED_SQL} - k."latestVolumeUsedBaselineBytes") / 2
            ELSE k."latestVolumeUsedBaselineBytes"
          END,
          "latestVolumeUsedBaselineAt" = CASE
            WHEN ${VOLUME_USED_SQL} IS NULL THEN k."latestVolumeUsedBaselineAt"
            WHEN ${BASELINE_RESTARTS_SQL} THEN v."observedAt"
            WHEN ${BASELINE_TOO_OLD_SQL}
              THEN k."latestVolumeUsedBaselineAt" + (v."observedAt" - k."latestVolumeUsedBaselineAt") / 2
            ELSE k."latestVolumeUsedBaselineAt"
          END,
          "metricsUpdatedAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("ns", "name", "capacity", "available", "inodes", "inodesFree", "observedAt")
        WHERE
          k."projectId" = $1
          AND k."kubernetesClusterId" = $2
          AND k."kind" = 'PersistentVolumeClaim'
          AND k."namespaceKey" = v."ns"
          AND k."name" = v."name"
          AND (k."metricsUpdatedAt" IS NULL OR v."observedAt" >= k."metricsUpdatedAt")
        RETURNING ${quotedColumns(HEALTH_COLUMNS, "k")}
      `;

      const updated: unknown = await this.getRepository().manager.query(
        sql,
        params,
      );
      await this.refreshHealthSeverity(Service.returnedRows(updated));
    }
  }

  /**
   * Mirror each node's latest disk reading onto its row: its root
   * filesystem (latestVolume*, as a claim's) and, when it is a disk of its
   * own, its image filesystem (latestImageFs*), dated by
   * latestVolumeMeasuredAt, which also guards it - a node's
   * metricsUpdatedAt moves with its CPU and memory, which this leaves
   * alone. A plain UPDATE, like the others: a node the next snapshot has
   * yet to write is caught up on the next flush. Then each node's verdict
   * is worked out again with its disks (Needs attention lists a node
   * nearly out of disk).
   */
  @CaptureSpan()
  public async bulkUpdateLatestNodeFilesystems(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    nodes: Array<ResourceLatestNodeFilesystem>;
  }): Promise<void> {
    if (data.nodes.length === 0) {
      return;
    }

    const toBigint: (value: number | null) => string | null = (
      value: number | null,
    ): string | null => {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return null;
      }
      return Math.max(0, Math.trunc(value)).toString();
    };

    for (let i: number = 0; i < data.nodes.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ResourceLatestNodeFilesystem> = data.nodes.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
      ];
      let paramIndex: number = 3;

      for (const node of chunk) {
        valueFragments.push(
          `($${paramIndex++}, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::text, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::timestamptz)`,
        );
        // The identity clamp MUST match bulkUpsert's, or the node is missed.
        params.push(
          truncateLongText(node.name),
          toBigint(node.capacityBytes),
          toBigint(node.availableBytes),
          node.imageFs.state,
          node.imageFs.state === "separate"
            ? toBigint(node.imageFs.capacityBytes)
            : null,
          node.imageFs.state === "separate"
            ? toBigint(node.imageFs.availableBytes)
            : null,
          node.observedAt,
        );
      }

      const imageFsColumn: (column: string, value: string) => string = (
        column: string,
        value: string,
      ): string => {
        return `CASE v."imageFsState"
            WHEN 'separate' THEN v."${value}"
            WHEN 'same' THEN NULL
            ELSE k."${column}"
          END`;
      };

      const sql: string = `
        UPDATE "KubernetesResource" AS k
        SET
          "latestVolumeCapacityBytes" = COALESCE(v."capacity", k."latestVolumeCapacityBytes"),
          "latestVolumeAvailableBytes" = COALESCE(v."available", k."latestVolumeAvailableBytes"),
          "latestImageFsCapacityBytes" = ${imageFsColumn("latestImageFsCapacityBytes", "imageCapacity")},
          "latestImageFsAvailableBytes" = ${imageFsColumn("latestImageFsAvailableBytes", "imageAvailable")},
          "latestVolumeMeasuredAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("name", "capacity", "available", "imageFsState", "imageCapacity", "imageAvailable", "observedAt")
        WHERE
          k."projectId" = $1
          AND k."kubernetesClusterId" = $2
          AND k."kind" = 'Node'
          AND k."namespaceKey" = ''
          AND k."name" = v."name"
          AND (k."latestVolumeMeasuredAt" IS NULL OR v."observedAt" >= k."latestVolumeMeasuredAt")
        RETURNING ${quotedColumns(HEALTH_COLUMNS, "k")}
      `;

      const updated: unknown = await this.getRepository().manager.query(
        sql,
        params,
      );
      await this.refreshHealthSeverity(Service.returnedRows(updated));
    }
  }

  /**
   * The claims a pod owns, by the pod's name: the ones Kubernetes makes
   * from a pod's generic ephemeral volume (`ephemeral:`), named
   * `<pod>-<volume>`. The kubelet stats receiver labels no such volume, so
   * ingest files its usage under its claim by these
   * (KubernetesEphemeralVolumeClaims). Bounded: a cluster holds at most a
   * few thousand.
   */
  @CaptureSpan()
  public async getPodOwnedVolumeClaims(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<Array<{ namespace: string; name: string; podName: string }>> {
    const rows: Array<{
      namespaceKey: string | null;
      name: string | null;
      podName: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "namespaceKey", "name",
         jsonb_path_query_first("ownerReferences", '$.items[*] ? (@.kind == "Pod").name') #>> '{}' AS "podName"
       FROM "KubernetesResource"
       WHERE "projectId" = $1
         AND "kubernetesClusterId" = $2
         AND "kind" = 'PersistentVolumeClaim'
         AND "deletedAt" IS NULL
         AND jsonb_path_exists("ownerReferences", '$.items[*] ? (@.kind == "Pod")')
       LIMIT ${POD_OWNED_CLAIMS_LIMIT}`,
      [data.projectId.toString(), data.kubernetesClusterId.toString()],
    );

    return rows
      .filter(
        (row: {
          namespaceKey: string | null;
          name: string | null;
          podName: string | null;
        }): boolean => {
          return Boolean(row.name && row.podName);
        },
      )
      .map(
        (row: {
          namespaceKey: string | null;
          name: string | null;
          podName: string | null;
        }): { namespace: string; name: string; podName: string } => {
          return {
            namespace: row.namespaceKey || "",
            name: row.name as string,
            podName: row.podName as string,
          };
        },
      );
  }

  /**
   * Hard-delete all resources in a cluster whose last snapshot is
   * older than olderThan. Returns the number of deleted rows.
   */
  @CaptureSpan()
  public async deleteStaleForCluster(data: {
    kubernetesClusterId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "KubernetesResource" WHERE "kubernetesClusterId" = $1 AND "lastSeenAt" < $2`,
        [data.kubernetesClusterId.toString(), data.olderThan],
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
        `KubernetesResource cleanup deleted ${affected} stale rows for cluster ${data.kubernetesClusterId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * The nodes and pods of a project that hold any of these addresses, at
   * most `limit`, by id (issue #5340: what the Traffic pages call an
   * address). A node holds its InternalIP and ExternalIP addresses
   * (status.addresses); a pod its podIP - unless it is on the node's own
   * network (podIP is hostIP), where the address is the node's. Raw SQL on
   * purpose: "an object of the jsonb array has one of these" is something
   * the query builder cannot say. Pinned to the project; callers read the
   * rows themselves, with the caller's own rights.
   */
  @CaptureSpan()
  public async findIdsHoldingAddresses(data: {
    projectId: ObjectID;
    addresses: Array<string>;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const addresses: Array<string> = Array.from(
      new Set<string>(
        data.addresses
          .map((address: string): string => {
            return address.trim().toLowerCase();
          })
          .filter((address: string): boolean => {
            return address.length > 0;
          }),
      ),
    );

    if (addresses.length === 0 || data.limit <= 0) {
      return [];
    }

    const rows: unknown = await this.getRepository().manager.query(
      `SELECT "_id"
        FROM "KubernetesResource"
        WHERE "projectId" = $1
          AND "deletedAt" IS NULL
          AND (
            (
              "kind" = 'Pod'
              AND jsonb_typeof("status") = 'object'
              AND LOWER("status" ->> 'podIP') = ANY($2::text[])
              AND COALESCE("status" ->> 'hostIP', '') <> COALESCE("status" ->> 'podIP', '')
            )
            OR (
              "kind" = 'Node'
              AND jsonb_typeof("status") = 'object'
              AND jsonb_typeof("status" -> 'addresses') = 'array'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements("status" -> 'addresses') AS node_address(item)
                WHERE jsonb_typeof(node_address.item) = 'object'
                  AND node_address.item ->> 'type' IN ('InternalIP', 'ExternalIP')
                  AND LOWER(node_address.item ->> 'address') = ANY($2::text[])
              )
            )
          )
        ORDER BY "_id"
        LIMIT $3`,
      [data.projectId.toString(), addresses, data.limit],
    );

    return (Array.isArray(rows) ? rows : [])
      .map((row: unknown): string => {
        const record: Record<string, unknown> =
          row && typeof row === "object"
            ? (row as Record<string, unknown>)
            : {};

        return String(record["_id"] || "");
      })
      .filter((id: string): boolean => {
        return ObjectID.isValidUUID(id);
      })
      .map((id: string): ObjectID => {
        return new ObjectID(id);
      });
  }

  /**
   * Compute the overview-page summary in Postgres. Returns counts per
   * resource kind plus pod phase / node condition breakdowns in a
   * single round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<InventorySummary> {
    const manager: ReturnType<Service["getRepository"]>["manager"] =
      this.getRepository().manager;

    const [kindRows, podRows, nodeRows, containerRows]: [
      Array<{ kind: string; count: string }>,
      Array<{
        phase: string | null;
        // Null unless ingest flagged the pod critical: a container can't run.
        cannotRunReason: string | null;
        count: string;
      }>,
      Array<{
        ready: string;
        notReady: string;
        memoryPressure: string;
        diskPressure: string;
        pidPressure: string;
      }>,
      Array<{ total: string }>,
    ] = await Promise.all([
      manager.query(
        `SELECT "kind", COUNT(*)::text AS count
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "deletedAt" IS NULL
         GROUP BY "kind"`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
      manager.query(
        /*
         * One pass for both the phases and each pod's kubectl status: a
         * pod ingest flagged critical has a container that cannot run, and
         * its word is read from its status (POD_CANNOT_RUN_REASON_SQL) -
         * only for those few rows, as CASE reads it for no other.
         */
        `SELECT "phase",
           CASE WHEN "healthSeverity" = '${KubernetesHealthSeverity.Critical}'
             THEN ${POD_CANNOT_RUN_REASON_SQL}
             ELSE NULL
           END AS "cannotRunReason",
           COUNT(*)::text AS count
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "kind" = 'Pod' AND "deletedAt" IS NULL
         GROUP BY 1, 2`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          JSON.stringify({
            reasons: Array.from(KUBERNETES_FAILING_WAIT_REASONS),
          }),
        ],
      ),
      manager.query(
        `SELECT
           COUNT(*) FILTER (WHERE "isReady" IS TRUE)::text AS "ready",
           COUNT(*) FILTER (WHERE "isReady" IS FALSE)::text AS "notReady",
           COUNT(*) FILTER (WHERE "hasMemoryPressure" IS TRUE)::text AS "memoryPressure",
           COUNT(*) FILTER (WHERE "hasDiskPressure" IS TRUE)::text AS "diskPressure",
           COUNT(*) FILTER (WHERE "hasPidPressure" IS TRUE)::text AS "pidPressure"
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "kind" = 'Node' AND "deletedAt" IS NULL`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
      manager.query(
        /*
         * containerCount is cached on the row during ingest
         * (KubernetesInventoryExtractor sets it from
         * spec.containers.length), so this is a plain int sum instead
         * of a JSONB scan. Rows written before that ingest change may
         * have NULL; SUM treats those as 0, which matches the old
         * behavior.
         */
        `SELECT COALESCE(SUM("containerCount"), 0)::text AS total
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2 AND "kind" = 'Pod' AND "deletedAt" IS NULL`,
        [data.projectId.toString(), data.kubernetesClusterId.toString()],
      ),
    ]);

    const countsByKind: Record<string, number> = {};
    for (const row of kindRows) {
      countsByKind[row.kind] = parseInt(row.count, 10) || 0;
    }

    const podPhaseCounts: InventorySummary["podPhaseCounts"] = {
      running: 0,
      pending: 0,
      failed: 0,
      succeeded: 0,
      unknown: 0,
    };
    const podStatusCounts: KubernetesPodStatusCounts = {
      running: 0,
      pending: 0,
      failed: 0,
      succeeded: 0,
      unknown: 0,
      cannotRun: [],
    };
    const cannotRunByReason: Map<string, number> = new Map<string, number>();

    for (const row of podRows) {
      const phase: string = row.phase || "Unknown";
      const count: number = parseInt(row.count, 10) || 0;
      if (phase === "Running") {
        podPhaseCounts.running += count;
      } else if (phase === "Pending") {
        podPhaseCounts.pending += count;
      } else if (phase === "Failed") {
        podPhaseCounts.failed += count;
      } else if (phase === "Succeeded") {
        podPhaseCounts.succeeded += count;
      } else {
        podPhaseCounts.unknown += count;
      }

      /*
       * A pod that cannot run never ended (the rules call a Failed or
       * Succeeded pod by its phase); a verdict stored by older rules that
       * says otherwise is counted by its phase too.
       */
      if (
        row.cannotRunReason !== null &&
        row.cannotRunReason !== undefined &&
        phase !== "Failed" &&
        phase !== "Succeeded"
      ) {
        const reason: string = row.cannotRunReason;
        cannotRunByReason.set(
          reason,
          (cannotRunByReason.get(reason) || 0) + count,
        );
        continue;
      }

      if (phase === "Running") {
        podStatusCounts.running += count;
      } else if (phase === "Pending") {
        podStatusCounts.pending += count;
      } else if (phase === "Failed") {
        podStatusCounts.failed += count;
      } else if (phase === "Succeeded") {
        podStatusCounts.succeeded += count;
      } else if (row.phase === "Unknown") {
        // Kubernetes' own Unknown; a pod with no phase yet is no problem.
        podStatusCounts.unknown += count;
      }
    }

    podStatusCounts.cannotRun = Array.from(cannotRunByReason.entries())
      .map(([reason, count]: [string, number]) => {
        return { reason: reason, count: count };
      })
      .sort(
        (
          a: { reason: string; count: number },
          b: { reason: string; count: number },
        ): number => {
          return b.count - a.count || a.reason.localeCompare(b.reason);
        },
      );

    const nodeRow:
      | {
          ready: string;
          notReady: string;
          memoryPressure: string;
          diskPressure: string;
          pidPressure: string;
        }
      | undefined = nodeRows[0];

    const containerCount: number =
      parseInt(containerRows[0]?.total || "0", 10) || 0;

    return {
      countsByKind,
      containerCount,
      podPhaseCounts,
      podStatusCounts,
      nodeReadyCounts: {
        ready: parseInt(nodeRow?.ready || "0", 10) || 0,
        notReady: parseInt(nodeRow?.notReady || "0", 10) || 0,
      },
      nodePressureCounts: {
        memoryPressure: parseInt(nodeRow?.memoryPressure || "0", 10) || 0,
        diskPressure: parseInt(nodeRow?.diskPressure || "0", 10) || 0,
        pidPressure: parseInt(nodeRow?.pidPressure || "0", 10) || 0,
      },
    };
  }

  /**
   * What needs attention in a cluster, the most urgent first: every
   * object ingest flagged (healthSeverity, read through its partial
   * index), with the workloads of the namespaces they are in, so a pod's
   * finding folds into its Deployment and a Job into its CronJob
   * (KubernetesHealth.getKubernetesAttentionFindings). The rules run again
   * on the rows read, at the time each was seen, so the findings say why
   * in today's words even for a row flagged before an upgrade.
   */
  @CaptureSpan()
  public async getNeedsAttention(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }): Promise<KubernetesNeedsAttention> {
    const manager: ReturnType<Service["getRepository"]>["manager"] =
      this.getRepository().manager;

    const columns: string = `"kind", "namespaceKey", "name", "phase", "isReady",
      "hasMemoryPressure", "hasDiskPressure", "hasPidPressure", "labels",
      "ownerReferences", "spec", "status", "lastSeenAt", "resourceCreationTimestamp",
      ${quotedColumns([...KUBERNETES_DISK_COLUMNS, "metricsUpdatedAt"])}`;

    const flagged: Array<KubernetesHealthRow> = await manager.query(
      `SELECT ${columns}
       FROM "KubernetesResource"
       WHERE "projectId" = $1
         AND "kubernetesClusterId" = $2
         AND "deletedAt" IS NULL
         AND "healthSeverity" IS NOT NULL
       ORDER BY
         CASE "healthSeverity" WHEN 'critical' THEN 0 ELSE 1 END,
         "lastSeenAt" DESC
       LIMIT ${NEEDS_ATTENTION_ROW_LIMIT + 1}`,
      [data.projectId.toString(), data.kubernetesClusterId.toString()],
    );

    const isRowLimitHit: boolean = flagged.length > NEEDS_ATTENTION_ROW_LIMIT;
    const rows: Array<KubernetesHealthRow> = flagged.slice(
      0,
      NEEDS_ATTENTION_ROW_LIMIT,
    );

    // The namespaces whose workloads a flagged pod or Job may fold into.
    const namespaces: Array<string> = Array.from(
      new Set(
        rows
          .filter((row: KubernetesHealthRow): boolean => {
            return Boolean(row.namespaceKey);
          })
          .map((row: KubernetesHealthRow): string => {
            return row.namespaceKey as string;
          }),
      ),
    );

    const workloads: Array<KubernetesHealthRow> =
      namespaces.length > 0
        ? await manager.query(
            `SELECT ${columns}
             FROM "KubernetesResource"
             WHERE "projectId" = $1
               AND "kubernetesClusterId" = $2
               AND "deletedAt" IS NULL
               AND "kind" = ANY($3)
               AND "namespaceKey" = ANY($4)
             LIMIT ${NEEDS_ATTENTION_WORKLOAD_LIMIT}`,
            [
              data.projectId.toString(),
              data.kubernetesClusterId.toString(),
              NEEDS_ATTENTION_WORKLOAD_KINDS,
              namespaces,
            ],
          )
        : [];

    const findings: Array<KubernetesAttentionFinding> =
      getKubernetesAttentionFindings([...workloads, ...rows]);
    const shown: Array<KubernetesAttentionFinding> = findings.slice(
      0,
      NEEDS_ATTENTION_FINDING_LIMIT,
    );

    await this.addClaimPods({
      projectId: data.projectId,
      kubernetesClusterId: data.kubernetesClusterId,
      findings: shown,
      rows: rows,
    });

    return {
      findings: shown,
      isTruncated:
        isRowLimitHit || findings.length > NEEDS_ATTENTION_FINDING_LIMIT,
    };
  }

  /*
   * A claim listed under Needs attention names a pod that mounts it, as a
   * step to the workload that writes to it: its owner for a generic
   * ephemeral volume's claim, else a pod in its namespace whose spec mounts
   * it - one read for every claim listed, a running pod first.
   */
  private async addClaimPods(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    findings: Array<KubernetesAttentionFinding>;
    rows: Array<KubernetesHealthRow>;
  }): Promise<void> {
    const claims: Array<KubernetesAttentionFinding> = data.findings.filter(
      (finding: KubernetesAttentionFinding): boolean => {
        return finding.kind === "PersistentVolumeClaim";
      },
    );
    if (claims.length === 0) {
      return;
    }

    const claimKey: (namespace: string, name: string) => string = (
      namespace: string,
      name: string,
    ): string => {
      return `${namespace}/${name}`;
    };

    const ownerPods: Map<string, string> = new Map();
    for (const row of data.rows) {
      if (row.kind !== "PersistentVolumeClaim") {
        continue;
      }
      const owner: { kind: string; name: string } | undefined =
        getKubernetesOwners(row).find(
          (ref: { kind: string; name: string }): boolean => {
            return ref.kind === "Pod";
          },
        );
      if (owner) {
        ownerPods.set(
          claimKey(row.namespaceKey || "", row.name || ""),
          owner.name,
        );
      }
    }

    const toFind: Array<KubernetesAttentionFinding> = [];
    for (const claim of claims) {
      const owner: string | undefined = ownerPods.get(
        claimKey(claim.namespace, claim.name),
      );
      if (owner) {
        claim.pod = owner;
      } else {
        toFind.push(claim);
      }
    }
    if (toFind.length === 0) {
      return;
    }

    const pods: Array<{
      namespaceKey: string | null;
      name: string | null;
      phase: string | null;
      spec: { volumes?: unknown } | null;
    }> = await this.getRepository().manager.query(
      `SELECT "namespaceKey", "name", "phase", "spec"
       FROM "KubernetesResource"
       WHERE "projectId" = $1
         AND "kubernetesClusterId" = $2
         AND "deletedAt" IS NULL
         AND "kind" = 'Pod'
         AND "namespaceKey" = ANY($3)
         AND jsonb_path_exists(
           "spec",
           '$.volumes[*] ? (@.type == "persistentVolumeClaim" && @.source == $claims[*])',
           jsonb_build_object('claims', $4::jsonb)
         )
       ORDER BY "name" ASC
       LIMIT ${NEEDS_ATTENTION_CLAIM_POD_LIMIT}`,
      [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
        Array.from(
          new Set(
            toFind.map((claim: KubernetesAttentionFinding): string => {
              return claim.namespace;
            }),
          ),
        ),
        JSON.stringify(
          Array.from(
            new Set(
              toFind.map((claim: KubernetesAttentionFinding): string => {
                return claim.name;
              }),
            ),
          ),
        ),
      ],
    );

    // A running pod first, then by name: the one that writes to it now.
    const mountedBy: Map<string, { name: string; isRunning: boolean }> =
      new Map();
    for (const pod of pods) {
      const volumes: unknown = pod.spec?.volumes;
      if (!pod.name || !Array.isArray(volumes)) {
        continue;
      }
      const isRunning: boolean = pod.phase === "Running";
      for (const volume of volumes) {
        if (
          !volume ||
          typeof volume !== "object" ||
          (volume as { type?: unknown }).type !== "persistentVolumeClaim"
        ) {
          continue;
        }
        const source: unknown = (volume as { source?: unknown }).source;
        if (typeof source !== "string" || !source) {
          continue;
        }
        const key: string = claimKey(pod.namespaceKey || "", source);
        const current: { name: string; isRunning: boolean } | undefined =
          mountedBy.get(key);
        if (!current || (isRunning && !current.isRunning)) {
          mountedBy.set(key, { name: pod.name, isRunning: isRunning });
        }
      }
    }

    for (const claim of toFind) {
      const pod: { name: string } | undefined = mountedBy.get(
        claimKey(claim.namespace, claim.name),
      );
      if (pod) {
        claim.pod = pod.name;
      }
    }
  }

  /**
   * An object with what it runs, for its own page: a Deployment,
   * StatefulSet, DaemonSet, Job or DeploymentConfig with its pods, a
   * CronJob with its Jobs and their pods, a node with the pods scheduled
   * on it. The pods are found in SQL on what names them - their owner
   * references, a node's name in their spec - and then held to the same
   * owner rule the findings use (getKubernetesPodWorkload), so `checkout`
   * never collects `checkout-v2`'s pods.
   *
   * Without a namespace the object is the first of that name by namespace,
   * so an address without one always opens the same object.
   */
  @CaptureSpan()
  public async getPart(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    kind: string;
    name: string;
    namespace?: string | undefined;
  }): Promise<KubernetesPart> {
    const manager: ReturnType<Service["getRepository"]>["manager"] =
      this.getRepository().manager;

    const columns: string = `"_id", "kind", "namespaceKey", "name", "phase", "isReady",
      "hasMemoryPressure", "hasDiskPressure", "hasPidPressure", "labels",
      "ownerReferences", "spec", "status", "lastSeenAt", "resourceCreationTimestamp",
      "latestCpuPercent", "latestMemoryBytes", "latestMemoryPercent", "metricsUpdatedAt",
      ${quotedColumns(KUBERNETES_DISK_COLUMNS)}`;

    const scope: Array<unknown> = [
      data.projectId.toString(),
      data.kubernetesClusterId.toString(),
    ];
    const live: string = `"projectId" = $1 AND "kubernetesClusterId" = $2 AND "deletedAt" IS NULL`;

    const parts: Array<KubernetesPartRow> = await manager.query(
      `SELECT ${columns}
       FROM "KubernetesResource"
       WHERE ${live}
         AND "kind" = $3
         AND "name" = $4
         ${data.namespace !== undefined ? `AND "namespaceKey" = $5` : ""}
       ORDER BY "namespaceKey" ASC
       LIMIT 1`,
      data.namespace !== undefined
        ? [...scope, data.kind, data.name, data.namespace]
        : [...scope, data.kind, data.name],
    );

    const part: KubernetesPartRow | null = parts[0] || null;

    /*
     * A namespace's page counts what in it needs attention and lists it
     * (#9595): its flagged pods, worst first, and its other flagged objects
     * with the workloads a pod folds into - read only when a pod needs them
     * - through the same partial index the cluster's Needs attention reads.
     */
    if (part && data.kind === "Namespace") {
      const namespaceName: string = part.name || data.name;
      const flaggedPods: Array<KubernetesPartRow> = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "namespaceKey" = $3
           AND "kind" = 'Pod'
           AND "healthSeverity" IS NOT NULL
         ORDER BY
           CASE "healthSeverity" WHEN 'critical' THEN 0 ELSE 1 END,
           "lastSeenAt" DESC
         LIMIT ${PART_POD_LIMIT + 1}`,
        [...scope, namespaceName],
      );
      const objects: Array<KubernetesPartRow> = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "namespaceKey" = $3
           AND "kind" <> 'Pod'
           AND (
             "healthSeverity" IS NOT NULL
             ${flaggedPods.length > 0 ? `OR "kind" = ANY($4)` : ""}
           )
         ORDER BY
           CASE "healthSeverity" WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
           "lastSeenAt" DESC
         LIMIT ${PART_CANDIDATE_LIMIT}`,
        flaggedPods.length > 0
          ? [...scope, namespaceName, NEEDS_ATTENTION_WORKLOAD_KINDS]
          : [...scope, namespaceName],
      );
      return {
        part: part,
        pods: flaggedPods.slice(0, PART_POD_LIMIT),
        jobs: [],
        objects: objects,
        isPodsTruncated: flaggedPods.length > PART_POD_LIMIT,
      };
    }

    if (!part || !KINDS_WITH_PODS.has(data.kind)) {
      return {
        part: part,
        pods: [],
        jobs: [],
        objects: [],
        isPodsTruncated: false,
      };
    }

    const namespace: string = part.namespaceKey || "";
    let jobs: Array<KubernetesPartRow> = [];
    let candidates: Array<KubernetesPartRow> = [];

    if (data.kind === "Node") {
      candidates = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Pod'
           AND "spec"->>'nodeName' = $3
         ORDER BY "lastSeenAt" DESC
         LIMIT ${PART_POD_LIMIT + 1}`,
        [...scope, data.name],
      );
    } else if (data.kind === "Deployment" || data.kind === "DeploymentConfig") {
      /*
       * A Deployment's pods belong to its ReplicaSets, `<name>-<hash>`; a
       * DeploymentConfig's to its ReplicationControllers, `<name>-<n>`,
       * and OpenShift labels them with its name. A name prefix finds them,
       * and a longer-named neighbour's too: the owner rule below drops
       * those.
       */
      const ownerKind: string =
        data.kind === "Deployment" ? "ReplicaSet" : "ReplicationController";
      candidates = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Pod'
           AND "namespaceKey" = $3
           AND (
             jsonb_path_exists(
               "ownerReferences",
               '$.items[*] ? (@.kind == $kind && @.name starts with $prefix)',
               jsonb_build_object('kind', $4::text, 'prefix', $5::text)
             )
             OR "labels"->>'deploymentconfig' = $6
             OR "labels"->>'openshift.io/deployment-config.name' = $6
           )
         ORDER BY "lastSeenAt" DESC
         LIMIT ${PART_CANDIDATE_LIMIT}`,
        [...scope, namespace, ownerKind, `${data.name}-`, data.name],
      );
    } else if (data.kind === "CronJob") {
      jobs = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Job'
           AND "namespaceKey" = $3
           AND "ownerReferences"->'items' @> jsonb_build_array(
             jsonb_build_object('kind', 'CronJob', 'name', $4::text)
           )
         ORDER BY "resourceCreationTimestamp" DESC NULLS LAST
         LIMIT ${PART_CANDIDATE_LIMIT}`,
        [...scope, namespace, data.name],
      );
      // A CronJob's Jobs are `<cronjob>-<scheduled minute>`.
      candidates =
        jobs.length > 0
          ? await manager.query(
              `SELECT ${columns}
               FROM "KubernetesResource"
               WHERE ${live}
                 AND "kind" = 'Pod'
                 AND "namespaceKey" = $3
                 AND jsonb_path_exists(
                   "ownerReferences",
                   '$.items[*] ? (@.kind == "Job" && @.name starts with $prefix)',
                   jsonb_build_object('prefix', $4::text)
                 )
               ORDER BY "lastSeenAt" DESC
               LIMIT ${PART_CANDIDATE_LIMIT}`,
              [...scope, namespace, `${data.name}-`],
            )
          : [];
    } else {
      // A StatefulSet, DaemonSet or Job owns its pods by name.
      candidates = await manager.query(
        `SELECT ${columns}
         FROM "KubernetesResource"
         WHERE ${live}
           AND "kind" = 'Pod'
           AND "namespaceKey" = $3
           AND "ownerReferences"->'items' @> jsonb_build_array(
             jsonb_build_object('kind', $4::text, 'name', $5::text)
           )
         ORDER BY "lastSeenAt" DESC
         LIMIT ${PART_POD_LIMIT + 1}`,
        [...scope, namespace, data.kind, data.name],
      );
    }

    const jobNames: Set<string> = new Set<string>(
      jobs.map((job: KubernetesPartRow): string => {
        return job.name || "";
      }),
    );

    const pods: Array<KubernetesPartRow> = candidates.filter(
      (pod: KubernetesPartRow): boolean => {
        if (data.kind === "Node") {
          return true;
        }
        const workload: KubernetesObjectRef | null =
          getKubernetesPodWorkload(pod);
        if (!workload) {
          return false;
        }
        if (data.kind === "CronJob") {
          return workload.kind === "Job" && jobNames.has(workload.name);
        }
        return workload.kind === data.kind && workload.name === data.name;
      },
    );

    return {
      part: part,
      pods: pods.slice(0, PART_POD_LIMIT),
      jobs: jobs,
      objects: [],
      isPodsTruncated: pods.length > PART_POD_LIMIT,
    };
  }

  /**
   * Aggregate the latest pod CPU/memory by namespace. Used by the
   * Namespaces list view, replacing the prior ClickHouse groupBy
   * scan. Only counts pods whose metricsUpdatedAt is within the
   * staleness window so we don't surface stale numbers as current.
   */
  @CaptureSpan()
  public async getLatestMetricsByNamespace(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    staleAfter: Date;
  }): Promise<
    Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    >
  > {
    const rows: Array<{
      namespaceKey: string;
      cpu: string | null;
      mem: string | null;
      memPct: string | null;
    }> = await this.getRepository().manager.query(
      `SELECT "namespaceKey",
              SUM("latestCpuPercent")::text AS cpu,
              SUM("latestMemoryBytes")::text AS mem,
              SUM("latestMemoryPercent")::text AS "memPct"
       FROM "KubernetesResource"
       WHERE "projectId" = $1
         AND "kubernetesClusterId" = $2
         AND "kind" = 'Pod'
         AND "deletedAt" IS NULL
         AND "metricsUpdatedAt" IS NOT NULL
         AND "metricsUpdatedAt" >= $3
       GROUP BY "namespaceKey"`,
      [
        data.projectId.toString(),
        data.kubernetesClusterId.toString(),
        data.staleAfter,
      ],
    );

    const out: Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    > = new Map();
    for (const row of rows) {
      out.set(row.namespaceKey || "", {
        cpuPercent: row.cpu ? parseFloat(row.cpu) || 0 : 0,
        memoryBytes: row.mem ? parseInt(row.mem, 10) || 0 : 0,
        memoryPercent: row.memPct ? parseFloat(row.memPct) || 0 : 0,
      });
    }
    return out;
  }

  /**
   * Aggregate the latest pod CPU/memory by owner (Deployment /
   * StatefulSet / DaemonSet / Job / CronJob).
   *
   * Direct-owner kinds (StatefulSet, DaemonSet, Job) read from the
   * Pod's ownerReferences JSONB. Indirect-owner kinds (Deployment,
   * CronJob) read from the denormalized controllerDeploymentName /
   * controllerCronJobName columns populated by the metric ingest
   * path — Pods don't directly own to those kinds, so we can't walk
   * ownerReferences for them.
   *
   * Returns a Map keyed by namespace and owner name,
   * `<namespace>/<name>`: a `checkout` Deployment in `shop` and one in
   * `payments` are two workloads, and each list row reads its own pods
   * (keyed by name alone, both rows read the two namespaces' pods added
   * up). Pods without recent metrics (metricsUpdatedAt past the
   * staleness cutoff) are excluded so the sum reflects "right now," not
   * "ever observed."
   */
  @CaptureSpan()
  public async getLatestMetricsByOwner(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    ownerKind: string;
    staleAfter: Date;
  }): Promise<
    Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    >
  > {
    let rows: Array<{
      namespaceKey: string | null;
      ownerName: string;
      cpu: string | null;
      mem: string | null;
      memPct: string | null;
    }>;

    if (data.ownerKind === "Deployment" || data.ownerKind === "CronJob") {
      const column: string =
        data.ownerKind === "Deployment"
          ? "controllerDeploymentName"
          : "controllerCronJobName";
      rows = await this.getRepository().manager.query(
        `SELECT
           "namespaceKey",
           "${column}" AS "ownerName",
           SUM("latestCpuPercent")::text AS cpu,
           SUM("latestMemoryBytes")::text AS mem,
           SUM("latestMemoryPercent")::text AS "memPct"
         FROM "KubernetesResource"
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Pod'
           AND "deletedAt" IS NULL
           AND "metricsUpdatedAt" IS NOT NULL
           AND "metricsUpdatedAt" >= $3
           AND "${column}" IS NOT NULL
         GROUP BY "namespaceKey", "${column}"`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          data.staleAfter,
        ],
      );
    } else if (data.ownerKind === "DeploymentConfig") {
      /*
       * A DeploymentConfig's pods belong to the ReplicationController of its
       * rollout (<name>-<version>), so ownerReferences never name it, and
       * metrics carry no controller column for it. OpenShift labels each of
       * them deploymentconfig=<name>, whichever rollout made it.
       */
      rows = await this.getRepository().manager.query(
        `SELECT
           "namespaceKey",
           "labels"->>'deploymentconfig' AS "ownerName",
           SUM("latestCpuPercent")::text AS cpu,
           SUM("latestMemoryBytes")::text AS mem,
           SUM("latestMemoryPercent")::text AS "memPct"
         FROM "KubernetesResource"
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Pod'
           AND "deletedAt" IS NULL
           AND "metricsUpdatedAt" IS NOT NULL
           AND "metricsUpdatedAt" >= $3
           AND "labels"->>'deploymentconfig' IS NOT NULL
         GROUP BY "namespaceKey", "labels"->>'deploymentconfig'`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          data.staleAfter,
        ],
      );
    } else {
      rows = await this.getRepository().manager.query(
        `SELECT
           "namespaceKey",
           (owner->>'name') AS "ownerName",
           SUM("latestCpuPercent")::text AS cpu,
           SUM("latestMemoryBytes")::text AS mem,
           SUM("latestMemoryPercent")::text AS "memPct"
         FROM "KubernetesResource",
              jsonb_array_elements("ownerReferences"->'items') AS owner
         WHERE "projectId" = $1
           AND "kubernetesClusterId" = $2
           AND "kind" = 'Pod'
           AND "deletedAt" IS NULL
           AND "metricsUpdatedAt" IS NOT NULL
           AND "metricsUpdatedAt" >= $3
           AND "ownerReferences" IS NOT NULL
           AND owner->>'kind' = $4
         GROUP BY "namespaceKey", (owner->>'name')`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          data.staleAfter,
          data.ownerKind,
        ],
      );
    }

    const out: Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    > = new Map();
    for (const row of rows) {
      if (!row.ownerName) {
        continue;
      }
      out.set(`${row.namespaceKey || ""}/${row.ownerName}`, {
        cpuPercent: row.cpu ? parseFloat(row.cpu) || 0 : 0,
        memoryBytes: row.mem ? parseInt(row.mem, 10) || 0 : 0,
        memoryPercent: row.memPct ? parseFloat(row.memPct) || 0 : 0,
      });
    }
    return out;
  }

  /**
   * Helper for the cleanup worker: snapshot-interval aware cutoff.
   * 3× the 5-minute snapshot interval by default. Tune via
   * K8S_INVENTORY_STALE_MINUTES — a value below 5 is ignored and the
   * 15-minute default applies, so it is not clamped to the floor. Keep the
   * threshold above the agent's resourceSpecs interval: CleanupStaleResources
   * hard-deletes inventory rows whose lastSeenAt is older than this cutoff.
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined = process.env["K8S_INVENTORY_STALE_MINUTES"];
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
