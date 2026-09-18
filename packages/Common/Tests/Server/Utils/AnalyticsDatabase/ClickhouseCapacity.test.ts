import {
  ClickhouseAppInstance,
  ClickhouseClient,
} from "../../../../Server/Infrastructure/ClickhouseDatabase";
import {
  buildClickhousePruningPlan,
  ClickhouseDiskSnapshot,
  ClickhousePartitionCandidate,
  ClickhousePlannedPartition,
  ClickhousePruningPlan,
  dropClickhousePartition,
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

describe("dropClickhousePartition", () => {
  const command: jest.Mock = jest.fn();

  beforeEach(() => {
    command.mockReset();
    command.mockResolvedValue({});
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue({
      command,
    } as unknown as ClickhouseClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A day of spans on a large instance far exceeds the server's default 50 GB
   * drop guard, which rejects the drop with TABLE_SIZE_EXCEEDS_MAX_DROP_SIZE_LIMIT
   * unless the statement lifts it. Without the SETTINGS clause capacity pruning
   * cannot prune the tables it exists for.
   */
  test("lifts the server drop-size guard on the statement", async () => {
    await dropClickhousePartition({
      tableName: "SpanItemV3Local",
      partitionId: "20260101",
    });

    expect(command).toHaveBeenCalledWith({
      query:
        "ALTER TABLE `oneuptime`.`SpanItemV3Local` ON CLUSTER 'oneuptime' " +
        "DROP PARTITION ID '20260101' SETTINGS max_partition_size_to_drop = 0",
    });
  });

  // Lifting the size guard must not widen WHAT is droppable.
  test("refuses a table outside the pruning allowlist", async () => {
    await expect(
      dropClickhousePartition({
        tableName: "AuditLogV2Local",
        partitionId: "20260101",
      }),
    ).rejects.toThrow("ClickHouse table is not eligible for pruning");

    expect(command).not.toHaveBeenCalled();
  });

  test("refuses a partition id that is not a daily partition", async () => {
    await expect(
      dropClickhousePartition({
        tableName: "SpanItemV3Local",
        partitionId: "202601",
      }),
    ).rejects.toThrow("Invalid ClickHouse daily partition id");

    expect(command).not.toHaveBeenCalled();
  });
});
