import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/VMwareResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * VMwareResourceService
 *
 * Writes and reads the VMware inventory table populated by the
 * telemetry ingest path. Callers are either:
 *   - OtelMetricsIngestService (bulkUpsert + bulkUpdateLatestMetrics,
 *     from the vcenter.* snapshot scan in processMetricsAsync)
 *   - CleanupStaleResources worker (deleteStaleForVCenter)
 *   - VMwareResourceAPI / the dashboard pages (reads via the
 *     inherited DatabaseService CRUD)
 *
 * The OpenTelemetry Collector `vcenter` receiver emits one OTLP
 * resource per vSphere object (datacenter, cluster, ESXi host, virtual
 * machine, VM template, datastore, resource pool) and carries identity
 * in that resource's attributes, so identity and the latest-metric
 * mirror both arrive on the same collection — like Proxmox, and unlike
 * Kubernetes (which needs a separate k8sobjects log stream for
 * identity). Both writes happen in the same flush.
 *
 * ------------------------------------------------------------------
 */

export interface ParsedVMwareResource {
  /** Datacenter | Cluster | Host | VirtualMachine | Datastore | ResourcePool */
  kind: string;
  /*
   * Immutable, collision-free within a vCenter (see the model header):
   * datacenter/<dc>, cluster/<dc>/<cluster>, host/<dc>/<host>,
   * vm/<vcenter.vm.id | vcenter.vm_template.id>,
   * datastore/<dc>/<datastore>, resourcepool/<inventory path>.
   * Already bound to 100 chars by boundVMwareExternalId in the snapshot
   * scan (prefix + "~" + 16-hex sha1 suffix for long ids); the clamp
   * and dedupe below are the defensive backstop, not the primary guard.
   */
  externalId: string;
  /** Display name of the vSphere object. */
  name: string | null;
  datacenterName: string | null;
  /** Owning cluster (hosts / VMs / resource pools in a cluster). */
  clusterName: string | null;
  /**
   * Parent ESXi host for VMs and templates; owning host for a resource
   * pool on a standalone host.
   */
  hostName: string | null;
  resourcePoolName: string | null;
  /**
   * vSphere inventory path of the resource pool (or vApp, for VMs that
   * live in one). LongText — inventory paths nest arbitrarily deep.
   */
  resourcePoolPath: string | null;
  virtualAppName: string | null;
  /** vcenter.vm.id / vcenter.vm_template.id — the VM's instance UUID. */
  vmInstanceUuid: string | null;
  /** VM rows only: true for a VM template, false for a real VM. */
  isTemplate: boolean | null;
  /*
   * VM rows only, inferred rather than reported: the receiver emits
   * vcenter.vm.cpu.* solely for powered-on VMs, so a VM whose batch
   * carried memory/disk points but no CPU point is off (or suspended).
   * null = template, non-VM kind, or the batch carried no VM points
   * (keeps the last-known value via COALESCE).
   */
  isPoweredOn: boolean | null;
  lastSeenAt: Date;
}

export interface VMwareResourceLatestMetric {
  kind: string;
  externalId: string;
  cpuPercent: number | null;
  cpuMhz: number | null;
  cpuCapacityMhz: number | null;
  cpuEffectiveMhz: number | null;
  memoryBytes: number | null;
  maxMemoryBytes: number | null;
  memoryEffectiveBytes: number | null;
  memoryPercent: number | null;
  diskBytes: number | null;
  maxDiskBytes: number | null;
  diskPercent: number | null;
  cpuReadinessPercent: number | null;
  memoryBalloonedBytes: number | null;
  memorySwappedBytes: number | null;
  hostCount: number | null;
  effectiveHostCount: number | null;
  poweredOnHostCount: number | null;
  vmCount: number | null;
  poweredOnVmCount: number | null;
  vmTemplateCount: number | null;
  datastoreCount: number | null;
  clusterCount: number | null;
  observedAt: Date;
}

export interface VMwareInventorySummary {
  /** Raw row count per kind (VirtualMachine includes templates). */
  countsByKind: Record<string, number>;
  datacenterCount: number;
  clusterCount: number;
  hostCount: number;
  /**
   * Non-template VM rows — the same population VMwareVCenter.vmCount
   * counts, so the sidebar and the vCenter list agree.
   */
  virtualMachineCount: number;
  /** VM rows whose inferred power state is on. */
  poweredOnVirtualMachineCount: number;
  /** VM template rows (kind VirtualMachine, isTemplate = true). */
  virtualMachineTemplateCount: number;
  datastoreCount: number;
  resourcePoolCount: number;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

/*
 * Column order used by bulkUpsert() and its generated parameter tuples.
 * Keep this and the INSERT column list in perfect sync.
 */
const UPSERT_COLUMNS: Array<string> = [
  "projectId",
  "vmwareVCenterId",
  "kind",
  "externalId",
  "name",
  "datacenterName",
  "clusterName",
  "hostName",
  "resourcePoolName",
  "resourcePoolPath",
  "virtualAppName",
  "vmInstanceUuid",
  "isTemplate",
  "isPoweredOn",
  "lastSeenAt",
  "version",
];

/*
 * VMwareResource's text columns are ShortText (100 chars) except
 * resourcePoolPath, which is LongText (500) because vSphere inventory
 * paths nest. The bulk paths below go through manager.query(), which
 * skips the length validation DatabaseService applies to ordinary
 * writes, so a single oversized value aborts the whole 500-row INSERT
 * chunk it rides in. Clamp per value instead, so one pathological VM
 * name can never drop the rest of the collection.
 */
function sanitizeResource(r: ParsedVMwareResource): ParsedVMwareResource {
  return {
    ...r,
    kind: truncateShortText(r.kind),
    externalId: truncateShortText(r.externalId),
    name: truncateShortText(r.name),
    datacenterName: truncateShortText(r.datacenterName),
    clusterName: truncateShortText(r.clusterName),
    hostName: truncateShortText(r.hostName),
    resourcePoolName: truncateShortText(r.resourcePoolName),
    resourcePoolPath: truncateLongText(r.resourcePoolPath),
    virtualAppName: truncateShortText(r.virtualAppName),
    vmInstanceUuid: truncateShortText(r.vmInstanceUuid),
  };
}

/*
 * Collapse entries that share a conflict key AFTER the clamp. The
 * snapshot scan bounds every externalId to 100 chars with a sha1
 * suffix, so in practice the sanitized key is already unique — but a
 * caller that bypasses the scan (or a future kind that forgets to) can
 * still hand us two ids that only differ past character 100. Those
 * clamp to the same (projectId, vmwareVCenterId, kind, externalId), and
 * Postgres refuses two VALUES tuples with one conflict target in a
 * single statement: SQLSTATE 21000 "ON CONFLICT DO UPDATE command
 * cannot affect row a second time" — which would abort the whole
 * 500-row chunk and, since the ingest flush only warns, silently stop
 * every row of that vCenter from landing. Keep the newest entry per key
 * (the dominance guard would have picked it anyway) and preserve first-
 * seen ordering so chunk boundaries stay deterministic.
 */
function dedupeByConflictKey<T extends { kind: string; externalId: string }>(
  entries: Array<T>,
  timestampOf: (entry: T) => Date,
): { entries: Array<T>; droppedCount: number } {
  const byKey: Map<string, T> = new Map();
  let droppedCount: number = 0;

  for (const entry of entries) {
    const key: string = `${entry.kind}|${entry.externalId}`;
    const existing: T | undefined = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      continue;
    }
    droppedCount++;
    if (timestampOf(entry).getTime() >= timestampOf(existing).getTime()) {
      // Map.set on an existing key keeps its original insertion position.
      byKey.set(key, entry);
    }
  }

  if (droppedCount === 0) {
    return { entries, droppedCount };
  }
  return { entries: Array.from(byKey.values()), droppedCount };
}

function numericOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined ? value : null;
}

/**
 * Whole-number columns (integer): truncate so a fractional gauge can
 * never fail the cast.
 */
function integerOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined ? Math.trunc(value) : null;
}

/**
 * bigint columns are sent as strings to avoid JS precision loss above
 * 2^53 (a multi-PB datastore is well within reach of that).
 */
function bigintOrNull(value: number | null | undefined): string | null {
  return value !== null && value !== undefined
    ? Math.trunc(value).toString()
    : null;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of parsed resources for a single (project, vCenter)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, vmwareVCenterId,
   * kind, externalId) index with a dominance guard on lastSeenAt so
   * out-of-order ingest never regresses a newer snapshot.
   *
   * Identity/status columns COALESCE against the existing row (unlike
   * the K8s upsert, which overwrites): the agent config forbids
   * splitting one collection across exports, so a batch is normally a
   * complete inventory, but a batch that happens to lack an attribute
   * (e.g. a VM briefly reported without its resource pool during a
   * vMotion) must not blank a value an earlier batch already filled.
   * isPoweredOn is boolean, so a genuine on→off transition (false)
   * still lands through COALESCE — only null keeps the prior value.
   */
  @CaptureSpan()
  public async bulkUpsert(data: {
    projectId: ObjectID;
    vmwareVCenterId: ObjectID;
    resources: Array<ParsedVMwareResource>;
  }): Promise<void> {
    if (data.resources.length === 0) {
      return;
    }

    const sanitizedResources: Array<ParsedVMwareResource> = data.resources.map(
      (r: ParsedVMwareResource) => {
        const sanitized: ParsedVMwareResource = sanitizeResource(r);
        if (sanitized.externalId !== r.externalId) {
          logger.warn(
            `VMwareResource externalId exceeds ${ColumnLength.ShortText} chars; truncated to "${sanitized.externalId}" (vCenter ${data.vmwareVCenterId.toString()}).`,
          );
        }
        return sanitized;
      },
    );

    const deduped: {
      entries: Array<ParsedVMwareResource>;
      droppedCount: number;
    } = dedupeByConflictKey(
      sanitizedResources,
      (r: ParsedVMwareResource): Date => {
        return r.lastSeenAt;
      },
    );
    if (deduped.droppedCount > 0) {
      logger.warn(
        `VMwareResource bulkUpsert dropped ${deduped.droppedCount} duplicate (kind, externalId) ${deduped.droppedCount === 1 ? "entry" : "entries"} after clamping, keeping the newest lastSeenAt per key (vCenter ${data.vmwareVCenterId.toString()}).`,
      );
    }
    const resources: Array<ParsedVMwareResource> = deduped.entries;

    // Chunk to keep individual statement parameter counts reasonable.
    for (let i: number = 0; i < resources.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<ParsedVMwareResource> = resources.slice(
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
          data.vmwareVCenterId.toString(),
          r.kind,
          r.externalId,
          r.name,
          r.datacenterName,
          r.clusterName,
          r.hostName,
          r.resourcePoolName,
          r.resourcePoolPath,
          r.virtualAppName,
          r.vmInstanceUuid,
          r.isTemplate,
          r.isPoweredOn,
          r.lastSeenAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "VMwareResource" (
          "projectId", "vmwareVCenterId", "kind", "externalId",
          "name", "datacenterName", "clusterName", "hostName",
          "resourcePoolName", "resourcePoolPath", "virtualAppName", "vmInstanceUuid",
          "isTemplate", "isPoweredOn",
          "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "vmwareVCenterId", "kind", "externalId")
        DO UPDATE SET
          "name" = COALESCE(EXCLUDED."name", "VMwareResource"."name"),
          "datacenterName" = COALESCE(EXCLUDED."datacenterName", "VMwareResource"."datacenterName"),
          "clusterName" = COALESCE(EXCLUDED."clusterName", "VMwareResource"."clusterName"),
          "hostName" = COALESCE(EXCLUDED."hostName", "VMwareResource"."hostName"),
          "resourcePoolName" = COALESCE(EXCLUDED."resourcePoolName", "VMwareResource"."resourcePoolName"),
          "resourcePoolPath" = COALESCE(EXCLUDED."resourcePoolPath", "VMwareResource"."resourcePoolPath"),
          "virtualAppName" = COALESCE(EXCLUDED."virtualAppName", "VMwareResource"."virtualAppName"),
          "vmInstanceUuid" = COALESCE(EXCLUDED."vmInstanceUuid", "VMwareResource"."vmInstanceUuid"),
          "isTemplate" = COALESCE(EXCLUDED."isTemplate", "VMwareResource"."isTemplate"),
          "isPoweredOn" = COALESCE(EXCLUDED."isPoweredOn", "VMwareResource"."isPoweredOn"),
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "VMwareResource"."lastSeenAt"
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
   * lacks a series — notably a powered-off VM carries no
   * vcenter.vm.cpu.* points, so its CPU columns keep the last powered-on
   * reading rather than reading 0, and a host without
   * vcenter.host.memory.capacity enabled keeps maxMemoryBytes NULL.
   */
  @CaptureSpan()
  public async bulkUpdateLatestMetrics(data: {
    projectId: ObjectID;
    vmwareVCenterId: ObjectID;
    metrics: Array<VMwareResourceLatestMetric>;
  }): Promise<void> {
    if (data.metrics.length === 0) {
      return;
    }

    /*
     * The identity clamps MUST match bulkUpsert's, or this mirror
     * UPDATE would silently miss the row the upsert just wrote under
     * the truncated externalId — and, like bulkUpsert, two entries that
     * clamp to one key must collapse to a single VALUES tuple (newest
     * observedAt wins) so the UPDATE ... FROM (VALUES ...) join never
     * carries the same target twice.
     */
    const sanitizedMetrics: Array<VMwareResourceLatestMetric> =
      data.metrics.map((m: VMwareResourceLatestMetric) => {
        return {
          ...m,
          kind: truncateShortText(m.kind),
          externalId: truncateShortText(m.externalId),
        };
      });

    const deduped: {
      entries: Array<VMwareResourceLatestMetric>;
      droppedCount: number;
    } = dedupeByConflictKey(
      sanitizedMetrics,
      (m: VMwareResourceLatestMetric): Date => {
        return m.observedAt;
      },
    );
    if (deduped.droppedCount > 0) {
      logger.warn(
        `VMwareResource bulkUpdateLatestMetrics dropped ${deduped.droppedCount} duplicate (kind, externalId) ${deduped.droppedCount === 1 ? "entry" : "entries"} after clamping, keeping the newest observedAt per key (vCenter ${data.vmwareVCenterId.toString()}).`,
      );
    }
    const metrics: Array<VMwareResourceLatestMetric> = deduped.entries;

    for (let i: number = 0; i < metrics.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<VMwareResourceLatestMetric> = metrics.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.vmwareVCenterId.toString(),
      ];
      let paramIndex: number = 3;

      for (const m of chunk) {
        valueFragments.push(
          `(` +
            `$${paramIndex++}, $${paramIndex++}, ` + // kind, externalId
            `$${paramIndex++}::numeric, $${paramIndex++}::integer, $${paramIndex++}::integer, $${paramIndex++}::integer, ` + // cpu, cpuMhz, cpuCap, cpuEff
            `$${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::numeric, ` + // mem, maxMem, memEff, memPct
            `$${paramIndex++}::bigint, $${paramIndex++}::bigint, $${paramIndex++}::numeric, ` + // disk, maxDisk, diskPct
            `$${paramIndex++}::numeric, $${paramIndex++}::bigint, $${paramIndex++}::bigint, ` + // cpuReady, balloon, swap
            `$${paramIndex++}::integer, $${paramIndex++}::integer, $${paramIndex++}::integer, ` + // hostCnt, effHostCnt, onHostCnt
            `$${paramIndex++}::integer, $${paramIndex++}::integer, $${paramIndex++}::integer, ` + // vmCnt, onVmCnt, tmplCnt
            `$${paramIndex++}::integer, $${paramIndex++}::integer, ` + // dsCnt, clCnt
            `$${paramIndex++}::timestamptz` + // observedAt
            `)`,
        );
        params.push(
          m.kind,
          m.externalId,
          numericOrNull(m.cpuPercent),
          integerOrNull(m.cpuMhz),
          integerOrNull(m.cpuCapacityMhz),
          integerOrNull(m.cpuEffectiveMhz),
          bigintOrNull(m.memoryBytes),
          bigintOrNull(m.maxMemoryBytes),
          bigintOrNull(m.memoryEffectiveBytes),
          numericOrNull(m.memoryPercent),
          bigintOrNull(m.diskBytes),
          bigintOrNull(m.maxDiskBytes),
          numericOrNull(m.diskPercent),
          numericOrNull(m.cpuReadinessPercent),
          bigintOrNull(m.memoryBalloonedBytes),
          bigintOrNull(m.memorySwappedBytes),
          integerOrNull(m.hostCount),
          integerOrNull(m.effectiveHostCount),
          integerOrNull(m.poweredOnHostCount),
          integerOrNull(m.vmCount),
          integerOrNull(m.poweredOnVmCount),
          integerOrNull(m.vmTemplateCount),
          integerOrNull(m.datastoreCount),
          integerOrNull(m.clusterCount),
          m.observedAt,
        );
      }

      const sql: string = `
        UPDATE "VMwareResource" AS p
        SET
          "latestCpuPercent" = COALESCE(v."cpu", p."latestCpuPercent"),
          "latestCpuMhz" = COALESCE(v."cpuMhz", p."latestCpuMhz"),
          "cpuCapacityMhz" = COALESCE(v."cpuCap", p."cpuCapacityMhz"),
          "cpuEffectiveMhz" = COALESCE(v."cpuEff", p."cpuEffectiveMhz"),
          "latestMemoryBytes" = COALESCE(v."mem", p."latestMemoryBytes"),
          "maxMemoryBytes" = COALESCE(v."maxMem", p."maxMemoryBytes"),
          "memoryEffectiveBytes" = COALESCE(v."memEff", p."memoryEffectiveBytes"),
          "latestMemoryPercent" = COALESCE(v."memPct", p."latestMemoryPercent"),
          "latestDiskBytes" = COALESCE(v."disk", p."latestDiskBytes"),
          "maxDiskBytes" = COALESCE(v."maxDisk", p."maxDiskBytes"),
          "latestDiskPercent" = COALESCE(v."diskPct", p."latestDiskPercent"),
          "cpuReadinessPercent" = COALESCE(v."cpuReady", p."cpuReadinessPercent"),
          "memoryBalloonedBytes" = COALESCE(v."balloon", p."memoryBalloonedBytes"),
          "memorySwappedBytes" = COALESCE(v."swap", p."memorySwappedBytes"),
          "hostCount" = COALESCE(v."hostCnt", p."hostCount"),
          "effectiveHostCount" = COALESCE(v."effHostCnt", p."effectiveHostCount"),
          "poweredOnHostCount" = COALESCE(v."onHostCnt", p."poweredOnHostCount"),
          "vmCount" = COALESCE(v."vmCnt", p."vmCount"),
          "poweredOnVmCount" = COALESCE(v."onVmCnt", p."poweredOnVmCount"),
          "vmTemplateCount" = COALESCE(v."tmplCnt", p."vmTemplateCount"),
          "datastoreCount" = COALESCE(v."dsCnt", p."datastoreCount"),
          "clusterCount" = COALESCE(v."clCnt", p."clusterCount"),
          "metricsUpdatedAt" = v."observedAt",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v(
            "kind", "externalId",
            "cpu", "cpuMhz", "cpuCap", "cpuEff",
            "mem", "maxMem", "memEff", "memPct",
            "disk", "maxDisk", "diskPct",
            "cpuReady", "balloon", "swap",
            "hostCnt", "effHostCnt", "onHostCnt",
            "vmCnt", "onVmCnt", "tmplCnt", "dsCnt", "clCnt",
            "observedAt"
          )
        WHERE
          p."projectId" = $1
          AND p."vmwareVCenterId" = $2
          AND p."kind" = v."kind"
          AND p."externalId" = v."externalId"
          AND (p."metricsUpdatedAt" IS NULL OR v."observedAt" >= p."metricsUpdatedAt")
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete all resources in a vCenter whose last collection is
   * older than olderThan. Returns the number of deleted rows. Only
   * called by the cleanup worker for vCenters that are still connected
   * — a disconnected vCenter keeps its last-known inventory.
   */
  @CaptureSpan()
  public async deleteStaleForVCenter(data: {
    vmwareVCenterId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "VMwareResource" WHERE "vmwareVCenterId" = $1 AND "lastSeenAt" < $2`,
        [data.vmwareVCenterId.toString(), data.olderThan],
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
        `VMwareResource cleanup deleted ${affected} stale rows for vCenter ${data.vmwareVCenterId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  /**
   * Compute the sidebar/overview summary in Postgres: counts per kind
   * plus the powered-on / template breakdowns for virtual machines, in
   * a single round-trip.
   */
  @CaptureSpan()
  public async getInventorySummary(data: {
    projectId: ObjectID;
    vmwareVCenterId: ObjectID;
  }): Promise<VMwareInventorySummary> {
    const rows: Array<{
      kind: string;
      count: string;
      poweredOnCount: string;
      templateCount: string;
    }> = await this.getRepository().manager.query(
      `SELECT "kind",
              COUNT(*)::text AS count,
              COUNT(*) FILTER (WHERE "isPoweredOn" IS TRUE)::text AS "poweredOnCount",
              COUNT(*) FILTER (WHERE "isTemplate" IS TRUE)::text AS "templateCount"
       FROM "VMwareResource"
       WHERE "projectId" = $1 AND "vmwareVCenterId" = $2 AND "deletedAt" IS NULL
       GROUP BY "kind"`,
      [data.projectId.toString(), data.vmwareVCenterId.toString()],
    );

    const countsByKind: Record<string, number> = {};
    let poweredOnVirtualMachineCount: number = 0;
    let virtualMachineTemplateCount: number = 0;
    for (const row of rows) {
      countsByKind[row.kind] = parseInt(row.count, 10) || 0;
      if (row.kind === "VirtualMachine") {
        poweredOnVirtualMachineCount = parseInt(row.poweredOnCount, 10) || 0;
        virtualMachineTemplateCount = parseInt(row.templateCount, 10) || 0;
      }
    }

    const virtualMachineRows: number = countsByKind["VirtualMachine"] || 0;

    return {
      countsByKind,
      datacenterCount: countsByKind["Datacenter"] || 0,
      clusterCount: countsByKind["Cluster"] || 0,
      hostCount: countsByKind["Host"] || 0,
      virtualMachineCount: Math.max(
        0,
        virtualMachineRows - virtualMachineTemplateCount,
      ),
      poweredOnVirtualMachineCount,
      virtualMachineTemplateCount,
      datastoreCount: countsByKind["Datastore"] || 0,
      resourcePoolCount: countsByKind["ResourcePool"] || 0,
    };
  }

  /**
   * Helper for the cleanup worker: collection-interval aware cutoff.
   * 15 minutes by default — 7x the receiver's default 2-minute
   * collection_interval, and 3x the 5-minute ingest maintenance fence.
   * Tune via VMWARE_INVENTORY_STALE_MINUTES (min 5).
   */
  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined =
      process.env["VMWARE_INVENTORY_STALE_MINUTES"];
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
