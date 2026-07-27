import KubernetesCostAllocation from "../../../Models/AnalyticsModels/KubernetesCostAllocation";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Permission from "../../../Types/Permission";

describe("Analytics KubernetesCostAllocation model", () => {
  const model: KubernetesCostAllocation = new KubernetesCostAllocation();

  test("has the expected table identity and API path", () => {
    expect(model.tableName).toBe("KubernetesCostAllocationV1");
    expect(model.crudApiPath?.toString()).toBe("/kubernetes-cost-allocation");
  });

  test("sorts and partitions by cluster and window", () => {
    expect(model.sortKeys).toEqual([
      "projectId",
      "kubernetesClusterId",
      "windowStart",
      "namespace",
    ]);
    expect(model.primaryKeys).toEqual(model.sortKeys);
    expect(model.partitionKey).toBe("toYYYYMMDD(windowStart)");
    expect(model.shardingKey).toBe(
      "cityHash64(projectId, kubernetesClusterId)",
    );
  });

  test("expires rows via the retentionDate TTL", () => {
    expect(model.ttlExpression).toBe("retentionDate DELETE");
    const retentionDate: AnalyticsTableColumn | null =
      model.getTableColumn("retentionDate");
    expect(retentionDate?.type).toBe(TableColumnType.Date);
  });

  test("declares every cost / usage / efficiency measure as a required Decimal", () => {
    const measures: Array<string> = [
      "cpuCoreHours",
      "cpuCoreRequestAverage",
      "cpuCoreUsageAverage",
      "cpuCost",
      "gpuHours",
      "gpuCost",
      "ramByteHours",
      "ramBytesRequestAverage",
      "ramBytesUsageAverage",
      "ramCost",
      "pvByteHours",
      "pvCost",
      "networkCost",
      "loadBalancerCost",
      "sharedCost",
      "externalCost",
      "totalCost",
      "cpuEfficiency",
      "ramEfficiency",
      "totalEfficiency",
    ];

    for (const key of measures) {
      const column: AnalyticsTableColumn | null = model.getTableColumn(key);
      expect(column).not.toBeNull();
      expect(column?.type).toBe(TableColumnType.Decimal);
      expect(column?.required).toBe(true);
    }
  });

  test("declares the workload identity dimensions", () => {
    const dimensions: Array<string> = [
      "clusterName",
      "k8sClusterEntityKey",
      "namespace",
      "controllerKind",
      "controllerName",
      "podName",
      "containerName",
      "nodeName",
      "providerId",
      "currency",
    ];

    for (const key of dimensions) {
      const column: AnalyticsTableColumn | null = model.getTableColumn(key);
      expect(column).not.toBeNull();
      expect(column?.type).toBe(TableColumnType.Text);
    }

    expect(model.getTableColumn("windowStart")?.type).toBe(
      TableColumnType.DateTime64,
    );
    expect(model.getTableColumn("windowEnd")?.type).toBe(
      TableColumnType.DateTime64,
    );
    expect(model.getTableColumn("kubernetesClusterId")?.type).toBe(
      TableColumnType.ObjectID,
    );
  });

  test("stores labels as a map with an extracted key column", () => {
    const labels: AnalyticsTableColumn | null = model.getTableColumn("labels");
    expect(labels?.type).toBe(TableColumnType.MapStringString);
    expect(labels?.mapKeysColumn).toBe("labelKeys");

    const labelKeys: AnalyticsTableColumn | null =
      model.getTableColumn("labelKeys");
    expect(labelKeys?.type).toBe(TableColumnType.ArrayText);
  });

  test("access control mirrors the KubernetesCluster model", () => {
    expect(model.accessControl?.read).toContain(
      Permission.ReadKubernetesCluster,
    );
    expect(model.accessControl?.create).toContain(
      Permission.CreateKubernetesCluster,
    );
    expect(model.accessControl?.delete).toContain(
      Permission.DeleteKubernetesCluster,
    );
    // Cost rows are immutable facts — nothing may update them.
    expect(model.accessControl?.update).toEqual([]);
  });

  test("deserializes ClickHouse DateTime64 window values as Dates", () => {
    const row: KubernetesCostAllocation = KubernetesCostAllocation.fromJSON(
      {
        windowStart: "2026-07-24 10:00:00.000000000",
        windowEnd: "2026-07-24 11:00:00.000000000",
      },
      KubernetesCostAllocation,
    ) as KubernetesCostAllocation;

    expect(row.windowStart).toBeInstanceOf(Date);
    expect(row.windowStart?.toISOString()).toBe("2026-07-24T10:00:00.000Z");
    expect(row.windowEnd?.toISOString()).toBe("2026-07-24T11:00:00.000Z");
  });
});
