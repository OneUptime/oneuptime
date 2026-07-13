import {
  buildClickhousePruningPlan,
  ClickhouseDiskSnapshot,
  ClickhousePartitionCandidate,
  ClickhousePlannedPartition,
  ClickhousePruningPlan,
} from "../../../../Server/Utils/AnalyticsDatabase/ClickhouseCapacity";
import "../../TestingUtils/Init";

function disk(data: {
  host: string;
  diskName?: string;
  usedInBytes: number;
  totalInBytes?: number;
}): ClickhouseDiskSnapshot {
  const totalInBytes: number = data.totalInBytes ?? 100;
  const unreservedInBytes: number = totalInBytes - data.usedInBytes;

  return {
    shardNum: 1,
    host: data.host,
    diskName: data.diskName || "default",
    path: "/var/lib/clickhouse",
    freeInBytes: unreservedInBytes,
    unreservedInBytes,
    totalInBytes,
    usedInBytes: data.usedInBytes,
    utilizationPercent: (data.usedInBytes / totalInBytes) * 100,
  };
}

function candidate(data: {
  partitionId: string;
  host: string;
  diskName?: string;
  sizeInBytes: number;
  tableName?: string;
}): ClickhousePartitionCandidate {
  return {
    tableName: data.tableName || "LogItemV3Local",
    partitionId: data.partitionId,
    partition: data.partitionId,
    locations: [
      {
        shardNum: 1,
        host: data.host,
        diskName: data.diskName || "default",
        sizeInBytes: data.sizeInBytes,
      },
    ],
    totalSizeInBytes: data.sizeInBytes,
  };
}

describe("ClickHouse capacity pruning planner", () => {
  test("sorts oldest-first and stops as soon as every disk reaches the target", () => {
    const plan: ClickhousePruningPlan = buildClickhousePruningPlan({
      disks: [
        disk({ host: "shard-1", usedInBytes: 95 }),
        disk({ host: "shard-2", usedInBytes: 60 }),
      ],
      candidates: [
        candidate({
          partitionId: "20260103",
          host: "shard-1",
          sizeInBytes: 10,
        }),
        candidate({
          partitionId: "20260101",
          host: "shard-1",
          sizeInBytes: 10,
        }),
        candidate({
          partitionId: "20260102",
          host: "shard-1",
          sizeInBytes: 10,
        }),
      ],
      targetPercent: 80,
    });

    expect(
      plan.partitions.map((partition: ClickhousePlannedPartition) => {
        return partition.partitionId;
      }),
    ).toStrictEqual(["20260101", "20260102"]);
    expect(plan.estimatedFreedBytes).toBe(20);
    expect(plan.projectedMaxUtilizationPercent).toBe(75);
    expect(plan.targetReachable).toBe(true);
  });

  test("only selects partitions that relieve a physical disk still over target", () => {
    const plan: ClickhousePruningPlan = buildClickhousePruningPlan({
      disks: [
        disk({
          host: "shard-1",
          diskName: "hot",
          usedInBytes: 95,
        }),
        disk({
          host: "shard-1",
          diskName: "archive",
          usedInBytes: 40,
        }),
      ],
      candidates: [
        candidate({
          partitionId: "20260101",
          host: "shard-1",
          diskName: "archive",
          sizeInBytes: 30,
        }),
        candidate({
          partitionId: "20260102",
          host: "shard-1",
          diskName: "hot",
          sizeInBytes: 20,
        }),
      ],
      targetPercent: 80,
    });

    expect(plan.partitions).toStrictEqual([
      {
        tableName: "LogItemV3Local",
        partitionId: "20260102",
        estimatedFreedBytes: 20,
      },
    ]);
    expect(plan.projectedMaxUtilizationPercent).toBe(75);
    expect(plan.targetReachable).toBe(true);
  });

  test("caps a run at 25 partitions and reports when the target is unreachable", () => {
    const candidates: Array<ClickhousePartitionCandidate> = Array.from(
      { length: 30 },
      (_value: unknown, index: number): ClickhousePartitionCandidate => {
        return candidate({
          partitionId: `202601${String(index + 1).padStart(2, "0")}`,
          host: "shard-1",
          sizeInBytes: 1,
        });
      },
    );

    const plan: ClickhousePruningPlan = buildClickhousePruningPlan({
      disks: [disk({ host: "shard-1", usedInBytes: 100 })],
      candidates,
      targetPercent: 50,
      maxPartitions: 100,
    });

    expect(plan.partitions).toHaveLength(25);
    expect(plan.estimatedFreedBytes).toBe(25);
    expect(plan.projectedMaxUtilizationPercent).toBe(75);
    expect(plan.targetReachable).toBe(false);
  });
});
