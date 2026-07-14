import { ClickhouseDatabase } from "../../EnvironmentConfig";
import {
  ClickhouseAppInstance,
  ClickhouseClient,
} from "../../Infrastructure/ClickhouseDatabase";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../Types/JSON";
import { getClickhouseClusterName, getStorageTableName } from "./ClusterConfig";

export interface ClickhouseDiskSnapshot {
  shardNum: number;
  host: string;
  diskName: string;
  path: string;
  freeInBytes: number;
  unreservedInBytes: number;
  totalInBytes: number;
  usedInBytes: number;
  utilizationPercent: number;
}

export interface ClickhouseLocalTableSize {
  shardNum: number;
  host: string;
  tableName: string;
  sizeInBytes: number;
  rowCount: number;
  partCount: number;
}

export interface ClickhousePartitionLocation {
  shardNum: number;
  host: string;
  diskName: string;
  sizeInBytes: number;
}

export interface ClickhousePartitionCandidate {
  tableName: string;
  partitionId: string;
  partition: string;
  locations: Array<ClickhousePartitionLocation>;
  totalSizeInBytes: number;
}

export interface ClickhousePlannedPartition {
  tableName: string;
  partitionId: string;
  estimatedFreedBytes: number;
}

export interface ClickhousePruningPlan {
  partitions: Array<ClickhousePlannedPartition>;
  estimatedFreedBytes: number;
  projectedMaxUtilizationPercent: number;
  targetReachable: boolean;
}

export interface ClickhousePartitionReclaimState {
  inactivePartCount: number;
  inactiveBytes: number;
}

type ClickhouseJsonResult = { data: Array<JSONObject> };

/*
 * Emergency capacity pruning is intentionally narrower than the complete
 * analytics schema. These are high-volume telemetry tables whose partitions
 * are date-based and can be removed as whole units. Audit logs (compliance),
 * mutable metrics (current lifecycle state), and derived monthly rollups are
 * deliberately excluded.
 */
const PRUNABLE_LOCAL_TABLES: ReadonlySet<string> = new Set<string>([
  getStorageTableName(AnalyticsTableName.Log),
  getStorageTableName(AnalyticsTableName.Metric),
  getStorageTableName(AnalyticsTableName.Span),
  getStorageTableName(AnalyticsTableName.ExceptionInstance),
  getStorageTableName(AnalyticsTableName.MonitorLog),
  getStorageTableName(AnalyticsTableName.Profile),
  getStorageTableName(AnalyticsTableName.ProfileSample),
]);

const DAILY_PARTITION_ID_PATTERN: RegExp = /^\d{8}$/;
const DEFAULT_MAX_PARTITIONS_PER_RUN: number = 25;

function toNumber(value: unknown): number {
  const parsed: number = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function getClient(): ClickhouseClient {
  const client: ClickhouseClient | null = ClickhouseAppInstance.getDataSource();

  if (!client) {
    throw new Error("ClickHouse is not connected.");
  }

  return client;
}

async function queryJson(query: string): Promise<Array<JSONObject>> {
  const result: ClickhouseJsonResult = (await (
    await getClient().query({
      query,
      format: "JSON",
      clickhouse_settings: {
        max_execution_time: 10,
      },
    })
  ).json()) as ClickhouseJsonResult;

  return result.data || [];
}

function diskKey(host: string, diskName: string): string {
  return `${host}\u0000${diskName}`;
}

/*
 * One row per physical, writable local disk. Capacity and destructive pruning
 * decisions use filesystem `free_space`: `unreserved_space` also subtracts
 * temporary merge/insert reservations and can fall sharply during normal
 * background work, so treating it as physically used could prune real data on
 * a transient reservation. Keeping disks separate prevents one roomy volume
 * from hiding another volume that is nearly full.
 */
export async function getClickhouseDiskSnapshots(): Promise<
  Array<ClickhouseDiskSnapshot>
> {
  const cluster: string = escapeStringLiteral(getClickhouseClusterName());

  const rows: Array<JSONObject> = await queryJson(
    `SELECT _shard_num AS shard_num, hostName() AS host, name AS disk_name, path, free_space, unreserved_space, total_space FROM clusterAllReplicas('${cluster}', system.disks) WHERE total_space > 0 AND is_remote = 0 AND is_read_only = 0 AND is_broken = 0 ORDER BY shard_num ASC, host ASC, disk_name ASC`,
  );

  return rows.map((row: JSONObject): ClickhouseDiskSnapshot => {
    const totalInBytes: number = toNumber(row["total_space"]);
    const freeInBytes: number = toNumber(row["free_space"]);
    const unreservedInBytes: number = toNumber(row["unreserved_space"]);
    const usedInBytes: number = Math.max(0, totalInBytes - freeInBytes);

    return {
      shardNum: toNumber(row["shard_num"]),
      host: String(row["host"] || ""),
      diskName: String(row["disk_name"] || ""),
      path: String(row["path"] || ""),
      freeInBytes,
      unreservedInBytes,
      totalInBytes,
      usedInBytes,
      utilizationPercent:
        totalInBytes > 0 ? (usedInBytes / totalInBytes) * 100 : 0,
    };
  });
}

export function getMaxClickhouseDiskUtilization(
  disks: Array<ClickhouseDiskSnapshot>,
): number | null {
  if (disks.length === 0) {
    return null;
  }

  return disks.reduce(
    (maximum: number, disk: ClickhouseDiskSnapshot): number => {
      return Math.max(maximum, disk.utilizationPercent);
    },
    0,
  );
}

/*
 * Exact replica-local table sizes. `_shard_num` comes from the cluster table
 * function and remains reliable even when system.clusters.host_name is a DNS
 * alias that does not match the remote node's hostName().
 */
export async function getClickhouseLocalTableSizes(): Promise<
  Array<ClickhouseLocalTableSize>
> {
  const cluster: string = escapeStringLiteral(getClickhouseClusterName());
  const database: string = escapeStringLiteral(ClickhouseDatabase);

  const rows: Array<JSONObject> = await queryJson(
    `SELECT _shard_num AS shard_num, hostName() AS host, table, sum(bytes_on_disk) AS bytes, sum(rows) AS row_count, count() AS part_count FROM clusterAllReplicas('${cluster}', system.parts) WHERE active AND database = '${database}' AND endsWith(table, 'Local') GROUP BY shard_num, host, table ORDER BY shard_num ASC, host ASC, bytes DESC`,
  );

  return rows.map((row: JSONObject): ClickhouseLocalTableSize => {
    return {
      shardNum: toNumber(row["shard_num"]),
      host: String(row["host"] || ""),
      tableName: String(row["table"] || ""),
      sizeInBytes: toNumber(row["bytes"]),
      rowCount: toNumber(row["row_count"]),
      partCount: toNumber(row["part_count"]),
    };
  });
}

/*
 * Return complete date partitions grouped globally by table + partition id,
 * with their physical footprint on every replica/disk. The newest partition
 * of every table is always protected, even if ingest has stopped and it is no
 * longer today's partition. This is intentionally more conservative than
 * merely comparing against the wall clock.
 */
export async function getClickhousePrunablePartitions(): Promise<
  Array<ClickhousePartitionCandidate>
> {
  const cluster: string = escapeStringLiteral(getClickhouseClusterName());
  const database: string = escapeStringLiteral(ClickhouseDatabase);
  const tableList: string = Array.from(PRUNABLE_LOCAL_TABLES)
    .map((tableName: string): string => {
      return `'${escapeStringLiteral(tableName)}'`;
    })
    .join(", ");

  const rows: Array<JSONObject> = await queryJson(
    `SELECT _shard_num AS shard_num, hostName() AS host, disk_name, table, partition, partition_id, sum(bytes_on_disk) AS bytes FROM clusterAllReplicas('${cluster}', system.parts) WHERE active AND database = '${database}' AND table IN (${tableList}) GROUP BY shard_num, host, disk_name, table, partition, partition_id ORDER BY partition_id ASC, table ASC`,
  );

  const latestPartitionByTable: Map<string, string> = new Map<string, string>();

  for (const row of rows) {
    const tableName: string = String(row["table"] || "");
    const partitionId: string = String(row["partition_id"] || "");

    if (
      !PRUNABLE_LOCAL_TABLES.has(tableName) ||
      !DAILY_PARTITION_ID_PATTERN.test(partitionId)
    ) {
      continue;
    }

    const latest: string | undefined = latestPartitionByTable.get(tableName);
    if (!latest || partitionId > latest) {
      latestPartitionByTable.set(tableName, partitionId);
    }
  }

  const candidatesByKey: Map<string, ClickhousePartitionCandidate> = new Map<
    string,
    ClickhousePartitionCandidate
  >();

  for (const row of rows) {
    const tableName: string = String(row["table"] || "");
    const partitionId: string = String(row["partition_id"] || "");

    if (
      !PRUNABLE_LOCAL_TABLES.has(tableName) ||
      !DAILY_PARTITION_ID_PATTERN.test(partitionId) ||
      latestPartitionByTable.get(tableName) === partitionId
    ) {
      continue;
    }

    const key: string = `${tableName}\u0000${partitionId}`;
    const candidate: ClickhousePartitionCandidate = candidatesByKey.get(
      key,
    ) || {
      tableName,
      partitionId,
      partition: String(row["partition"] || partitionId),
      locations: [],
      totalSizeInBytes: 0,
    };
    const sizeInBytes: number = toNumber(row["bytes"]);

    candidate.locations.push({
      shardNum: toNumber(row["shard_num"]),
      host: String(row["host"] || ""),
      diskName: String(row["disk_name"] || ""),
      sizeInBytes,
    });
    candidate.totalSizeInBytes += sizeInBytes;
    candidatesByKey.set(key, candidate);
  }

  return Array.from(candidatesByKey.values()).sort(
    (
      left: ClickhousePartitionCandidate,
      right: ClickhousePartitionCandidate,
    ): number => {
      return (
        left.partitionId.localeCompare(right.partitionId) ||
        left.tableName.localeCompare(right.tableName)
      );
    },
  );
}

/*
 * A DROP PARTITION can return before ClickHouse removes the inactive parts from
 * disk. Capacity automation must not select another historical batch while the
 * prior batch still occupies space, or delayed cleanup could eventually drive
 * utilization far below the configured target. Query every replica and fail
 * closed in the caller until these exact inactive parts are gone.
 */
export async function getClickhousePartitionReclaimState(
  partitions: Array<ClickhousePlannedPartition>,
): Promise<ClickhousePartitionReclaimState> {
  if (partitions.length === 0) {
    return {
      inactivePartCount: 0,
      inactiveBytes: 0,
    };
  }

  const uniqueReferences: Map<string, ClickhousePlannedPartition> = new Map<
    string,
    ClickhousePlannedPartition
  >();

  for (const partition of partitions) {
    if (!PRUNABLE_LOCAL_TABLES.has(partition.tableName)) {
      throw new Error(
        `ClickHouse table is not eligible for pruning reconciliation: ${partition.tableName}`,
      );
    }

    if (!DAILY_PARTITION_ID_PATTERN.test(partition.partitionId)) {
      throw new Error(
        `Invalid ClickHouse daily partition id for reconciliation: ${partition.partitionId}`,
      );
    }

    uniqueReferences.set(
      `${partition.tableName}\u0000${partition.partitionId}`,
      partition,
    );
  }

  const cluster: string = escapeStringLiteral(getClickhouseClusterName());
  const database: string = escapeStringLiteral(ClickhouseDatabase);
  const tupleList: string = Array.from(uniqueReferences.values())
    .map((partition: ClickhousePlannedPartition): string => {
      return `('${escapeStringLiteral(partition.tableName)}', '${escapeStringLiteral(partition.partitionId)}')`;
    })
    .join(", ");
  const rows: Array<JSONObject> = await queryJson(
    `SELECT count() AS part_count, coalesce(sum(bytes_on_disk), 0) AS bytes FROM clusterAllReplicas('${cluster}', system.parts) WHERE active = 0 AND database = '${database}' AND (table, partition_id) IN (${tupleList})`,
  );

  return {
    inactivePartCount: toNumber(rows[0]?.["part_count"]),
    inactiveBytes: toNumber(rows[0]?.["bytes"]),
  };
}

/*
 * Simulate global partition drops against each physical disk independently.
 * A global table/partition drop is selected only when it relieves at least one
 * disk that remains over the requested target; its footprint is then removed
 * from every matching replica/disk projection. The result is bounded so one
 * controller tick can never issue an unbounded destructive batch.
 */
export function buildClickhousePruningPlan(data: {
  disks: Array<ClickhouseDiskSnapshot>;
  candidates: Array<ClickhousePartitionCandidate>;
  targetPercent: number;
  maxPartitions?: number | undefined;
}): ClickhousePruningPlan {
  if (
    !Number.isFinite(data.targetPercent) ||
    data.targetPercent < 1 ||
    data.targetPercent > 100
  ) {
    throw new Error("ClickHouse pruning target must be between 1 and 100.");
  }

  const maxPartitions: number = Math.max(
    1,
    Math.min(
      data.maxPartitions || DEFAULT_MAX_PARTITIONS_PER_RUN,
      DEFAULT_MAX_PARTITIONS_PER_RUN,
    ),
  );
  const projectedByDisk: Map<
    string,
    { totalInBytes: number; usedInBytes: number }
  > = new Map();

  for (const disk of data.disks) {
    projectedByDisk.set(diskKey(disk.host, disk.diskName), {
      totalInBytes: disk.totalInBytes,
      usedInBytes: disk.usedInBytes,
    });
  }

  const isOverTarget: (projection: {
    totalInBytes: number;
    usedInBytes: number;
  }) => boolean = (projection: {
    totalInBytes: number;
    usedInBytes: number;
  }): boolean => {
    return (
      projection.totalInBytes > 0 &&
      (projection.usedInBytes / projection.totalInBytes) * 100 >
        data.targetPercent
    );
  };

  const selected: Array<ClickhousePlannedPartition> = [];
  let estimatedFreedBytes: number = 0;

  const oldestCandidatesFirst: Array<ClickhousePartitionCandidate> = [
    ...data.candidates,
  ].sort(
    (
      left: ClickhousePartitionCandidate,
      right: ClickhousePartitionCandidate,
    ): number => {
      return (
        left.partitionId.localeCompare(right.partitionId) ||
        left.tableName.localeCompare(right.tableName)
      );
    },
  );

  for (const candidate of oldestCandidatesFirst) {
    if (selected.length >= maxPartitions) {
      break;
    }

    const relievesOverTargetDisk: boolean = candidate.locations.some(
      (location: ClickhousePartitionLocation): boolean => {
        const projection:
          | { totalInBytes: number; usedInBytes: number }
          | undefined = projectedByDisk.get(
          diskKey(location.host, location.diskName),
        );
        return Boolean(projection && isOverTarget(projection));
      },
    );

    if (!relievesOverTargetDisk) {
      continue;
    }

    selected.push({
      tableName: candidate.tableName,
      partitionId: candidate.partitionId,
      estimatedFreedBytes: candidate.totalSizeInBytes,
    });
    estimatedFreedBytes += candidate.totalSizeInBytes;

    for (const location of candidate.locations) {
      const key: string = diskKey(location.host, location.diskName);
      const projection:
        | { totalInBytes: number; usedInBytes: number }
        | undefined = projectedByDisk.get(key);

      if (projection) {
        projection.usedInBytes = Math.max(
          0,
          projection.usedInBytes - location.sizeInBytes,
        );
      }
    }

    if (
      Array.from(projectedByDisk.values()).every(
        (projection: {
          totalInBytes: number;
          usedInBytes: number;
        }): boolean => {
          return !isOverTarget(projection);
        },
      )
    ) {
      break;
    }
  }

  const projectedUtilizations: Array<number> = Array.from(
    projectedByDisk.values(),
  ).map((projection: { totalInBytes: number; usedInBytes: number }): number => {
    return projection.totalInBytes > 0
      ? (projection.usedInBytes / projection.totalInBytes) * 100
      : 0;
  });
  const projectedMaxUtilizationPercent: number =
    projectedUtilizations.length > 0 ? Math.max(...projectedUtilizations) : 0;

  return {
    partitions: selected,
    estimatedFreedBytes,
    projectedMaxUtilizationPercent,
    targetReachable: projectedMaxUtilizationPercent <= data.targetPercent,
  };
}

export async function dropClickhousePartition(data: {
  tableName: string;
  partitionId: string;
}): Promise<void> {
  if (!PRUNABLE_LOCAL_TABLES.has(data.tableName)) {
    throw new Error(
      `ClickHouse table is not eligible for pruning: ${data.tableName}`,
    );
  }

  if (!DAILY_PARTITION_ID_PATTERN.test(data.partitionId)) {
    throw new Error(
      `Invalid ClickHouse daily partition id: ${data.partitionId}`,
    );
  }

  const database: string = quoteIdentifier(ClickhouseDatabase);
  const tableName: string = quoteIdentifier(data.tableName);
  const cluster: string = escapeStringLiteral(getClickhouseClusterName());
  const partitionId: string = escapeStringLiteral(data.partitionId);

  await getClient().command({
    query: `ALTER TABLE ${database}.${tableName} ON CLUSTER '${cluster}' DROP PARTITION ID '${partitionId}'`,
  });
}
