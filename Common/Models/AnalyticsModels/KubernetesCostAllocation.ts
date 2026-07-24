import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

/*
 * One cost-allocation record for a Kubernetes workload over a time window,
 * as computed by an in-cluster cost engine (OpenCost / Kubecost cost-model)
 * and shipped by the OneUptime Kubernetes agent's cost poller. Each row is
 * one (cluster, window, namespace, controller, pod, container) slice with
 * pre-priced cpu/ram/gpu/pv/network/load-balancer cost components and
 * request-vs-usage efficiency ratios.
 *
 * Idle and unallocated capacity arrive as regular rows whose namespace is
 * the engine's sentinel ("__idle__" / "__unallocated__"), so idle spend is
 * queryable with the same GROUP BY as workload spend.
 *
 * Access control mirrors the KubernetesCluster database model — cost rows
 * are an attribute of the cluster they were metered on.
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadKubernetesCluster,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateKubernetesCluster,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteKubernetesCluster,
];

type CostColumnDef = {
  key: string;
  title: string;
  description: string;
};

export default class KubernetesCostAllocation extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project",
      required: true,
      type: TableColumnType.ObjectID,
      isTenantId: true,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const kubernetesClusterIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "kubernetesClusterId",
        title: "Kubernetes Cluster ID",
        description:
          "ID of the KubernetesCluster this cost row was metered on. Resolved at ingest from the cluster name (findOrCreateByClusterIdentifier), so every stored row has one.",
        required: true,
        type: TableColumnType.ObjectID,
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });

    const clusterNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "clusterName",
      title: "Cluster Name",
      description:
        "Cluster identifier as reported by the agent (matches KubernetesCluster.clusterIdentifier and the resource.k8s.cluster.name metric attribute).",
      required: true,
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_cluster_name",
        type: SkipIndexType.Set,
        params: [100],
        granularity: 4,
      },
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const k8sClusterEntityKeyColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "k8sClusterEntityKey",
        title: "Kubernetes Cluster Entity Key",
        description:
          "Stable 16-hex entity key of the cluster (see Common/Utils/Telemetry/EntityKey.keyForKubernetesCluster); joins cost rows to the metric rollups keyed by the same column.",
        required: true,
        defaultValue: "",
        type: TableColumnType.Text,
        codec: { codec: "ZSTD", level: 1 },
        skipIndex: {
          name: "idx_k8s_cluster_entity_key",
          type: SkipIndexType.BloomFilter,
          params: [0.01],
          granularity: 1,
        },
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });

    const windowStartColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "windowStart",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Window Start",
      description: "Start of the allocation window this row covers.",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const windowEndColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "windowEnd",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Window End",
      description: "End of the allocation window this row covers.",
      required: true,
      type: TableColumnType.DateTime64,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const namespaceColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "namespace",
      title: "Namespace",
      description:
        'Kubernetes namespace of the workload. Engine sentinels ("__idle__", "__unallocated__") mark non-workload capacity.',
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_namespace",
        type: SkipIndexType.Set,
        params: [100],
        granularity: 4,
      },
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const controllerKindColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "controllerKind",
        isLowCardinality: true,
        title: "Controller Kind",
        description:
          "Kind of the owning controller (deployment / statefulset / daemonset / job / cronjob / replicaset / pod).",
        required: true,
        defaultValue: "",
        type: TableColumnType.Text,
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      },
    );

    const controllerNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "controllerName",
        title: "Controller Name",
        description: "Name of the owning controller (the workload).",
        required: true,
        defaultValue: "",
        type: TableColumnType.Text,
        skipIndex: {
          name: "idx_controller_name",
          type: SkipIndexType.BloomFilter,
          params: [0.01],
          granularity: 1,
        },
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      },
    );

    const podNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "podName",
      title: "Pod Name",
      description: "Name of the pod, when the row is pod- or container-level.",
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_pod_name",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const containerNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "containerName",
      title: "Container Name",
      description: "Name of the container, when the row is container-level.",
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const nodeNameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "nodeName",
      title: "Node Name",
      description: "Node the workload ran on during the window.",
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      skipIndex: {
        name: "idx_node_name",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const providerIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "providerId",
      title: "Provider ID",
      description:
        "Cloud provider instance identifier of the node, when known.",
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const labelsColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "labels",
      codec: { codec: "ZSTD", level: 3 },
      title: "Labels",
      description:
        "Kubernetes labels of the workload (merged pod/namespace labels as reported by the cost engine). Enables cost-by-label (team / app / env) queries.",
      required: true,
      defaultValue: {},
      type: TableColumnType.MapStringString,
      mapKeysColumn: "labelKeys",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const labelKeysColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "labelKeys",
      codec: { codec: "ZSTD", level: 3 },
      title: "Label Keys",
      description: "Label keys extracted from labels",
      required: true,
      defaultValue: [],
      type: TableColumnType.ArrayText,
      skipIndex: {
        name: "idx_label_keys",
        type: SkipIndexType.BloomFilter,
        params: [0.01],
        granularity: 1,
      },
      accessControl: labelsColumn.accessControl,
    });

    /*
     * Cost / usage / efficiency measures. All Float64 (Decimal), non-Nullable
     * with a 0 default — the ingest service always writes every measure, and
     * non-Nullable keeps sum()/avg() aggregations state-free.
     */
    const measureColumns: Array<AnalyticsTableColumn> = (
      [
        {
          key: "cpuCoreHours",
          title: "CPU Core Hours",
          description: "CPU core-hours allocated over the window.",
        },
        {
          key: "cpuCoreRequestAverage",
          title: "CPU Core Request Average",
          description: "Average CPU cores requested over the window.",
        },
        {
          key: "cpuCoreUsageAverage",
          title: "CPU Core Usage Average",
          description: "Average CPU cores actually used over the window.",
        },
        {
          key: "cpuCost",
          title: "CPU Cost",
          description: "Cost of allocated CPU over the window.",
        },
        {
          key: "gpuHours",
          title: "GPU Hours",
          description: "GPU-hours allocated over the window.",
        },
        {
          key: "gpuCost",
          title: "GPU Cost",
          description: "Cost of allocated GPUs over the window.",
        },
        {
          key: "ramByteHours",
          title: "RAM Byte Hours",
          description: "RAM byte-hours allocated over the window.",
        },
        {
          key: "ramBytesRequestAverage",
          title: "RAM Bytes Request Average",
          description: "Average RAM bytes requested over the window.",
        },
        {
          key: "ramBytesUsageAverage",
          title: "RAM Bytes Usage Average",
          description: "Average RAM bytes actually used over the window.",
        },
        {
          key: "ramCost",
          title: "RAM Cost",
          description: "Cost of allocated RAM over the window.",
        },
        {
          key: "pvByteHours",
          title: "PV Byte Hours",
          description:
            "Persistent-volume byte-hours allocated over the window.",
        },
        {
          key: "pvCost",
          title: "PV Cost",
          description: "Cost of persistent volumes over the window.",
        },
        {
          key: "networkCost",
          title: "Network Cost",
          description: "Network egress cost over the window.",
        },
        {
          key: "loadBalancerCost",
          title: "Load Balancer Cost",
          description: "Load balancer cost over the window.",
        },
        {
          key: "sharedCost",
          title: "Shared Cost",
          description:
            "Share of cluster overhead distributed to this workload.",
        },
        {
          key: "externalCost",
          title: "External Cost",
          description:
            "Out-of-cluster cost attributed to this workload, when the engine reports one.",
        },
        {
          key: "totalCost",
          title: "Total Cost",
          description:
            "Total cost of the row over the window (all components).",
        },
        {
          key: "cpuEfficiency",
          title: "CPU Efficiency",
          description: "CPU usage / request ratio over the window (0..1+).",
        },
        {
          key: "ramEfficiency",
          title: "RAM Efficiency",
          description: "RAM usage / request ratio over the window (0..1+).",
        },
        {
          key: "totalEfficiency",
          title: "Total Efficiency",
          description:
            "Cost-weighted cpu+ram efficiency over the window (0..1+).",
        },
      ] as Array<CostColumnDef>
    ).map((def: CostColumnDef): AnalyticsTableColumn => {
      return new AnalyticsTableColumn({
        key: def.key,
        title: def.title,
        description: def.description,
        required: true,
        defaultValue: 0,
        type: TableColumnType.Decimal,
        codec: [{ codec: "Gorilla" }, { codec: "ZSTD", level: 1 }],
        accessControl: {
          read: readPermissions,
          create: createPermissions,
          update: [],
        },
      });
    });

    const currencyColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "currency",
      isLowCardinality: true,
      title: "Currency",
      description:
        'Currency code of the cost figures as configured in the cost engine (e.g. "USD"). Empty when the engine reports none — treat as USD.',
      required: true,
      defaultValue: "",
      type: TableColumnType.Text,
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
      },
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      codec: [{ codec: "DoubleDelta" }, { codec: "ZSTD", level: 1 }],
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion, computed at ingest time as windowStart + the cluster's (or project's) telemetry retention days",
      required: true,
      type: TableColumnType.Date,
      defaultValue: undefined,
    });

    super({
      tableName: AnalyticsTableName.KubernetesCostAllocation,
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Kubernetes Cost Allocation",
      pluralName: "Kubernetes Cost Allocations",
      accessControl: {
        read: readPermissions,
        create: createPermissions,
        update: [],
        delete: deletePermissions,
      },
      crudApiPath: new Route("/kubernetes-cost-allocation"),
      enableMCP: true,
      enableDocumentation: true,
      tableDescription:
        "Kubernetes cost allocations — pre-priced cpu/ram/gpu/pv/network cost per workload per time window, as computed by an in-cluster cost engine (OpenCost / Kubecost) and shipped by the OneUptime Kubernetes agent. Query spend by cluster, namespace, controller, pod, or label over time.",
      tableColumns: [
        projectIdColumn,
        kubernetesClusterIdColumn,
        clusterNameColumn,
        k8sClusterEntityKeyColumn,
        windowStartColumn,
        windowEndColumn,
        namespaceColumn,
        controllerKindColumn,
        controllerNameColumn,
        podNameColumn,
        containerNameColumn,
        nodeNameColumn,
        providerIdColumn,
        labelsColumn,
        labelKeysColumn,
        ...measureColumns,
        currencyColumn,
        retentionDateColumn,
      ],
      sortKeys: [
        "projectId",
        "kubernetesClusterId",
        "windowStart",
        "namespace",
      ],
      primaryKeys: [
        "projectId",
        "kubernetesClusterId",
        "windowStart",
        "namespace",
      ],
      partitionKey: "toYYYYMMDD(windowStart)",
      /*
       * Shard by cluster so one cluster's cost rows co-locate (every query
       * filters by cluster or fans out across all of a project's clusters).
       */
      shardingKey: "cityHash64(projectId, kubernetesClusterId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
      defaultSortColumn: "windowStart",
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get kubernetesClusterId(): ObjectID | undefined {
    return this.getColumnValue("kubernetesClusterId") as ObjectID | undefined;
  }

  public set kubernetesClusterId(v: ObjectID | undefined) {
    this.setColumnValue("kubernetesClusterId", v);
  }

  public get clusterName(): string | undefined {
    return this.getColumnValue("clusterName") as string | undefined;
  }

  public set clusterName(v: string | undefined) {
    this.setColumnValue("clusterName", v);
  }

  public get k8sClusterEntityKey(): string | undefined {
    return this.getColumnValue("k8sClusterEntityKey") as string | undefined;
  }

  public set k8sClusterEntityKey(v: string | undefined) {
    this.setColumnValue("k8sClusterEntityKey", v);
  }

  public get windowStart(): Date | undefined {
    return this.getColumnValue("windowStart") as Date | undefined;
  }

  public set windowStart(v: Date | undefined) {
    this.setColumnValue("windowStart", v);
  }

  public get windowEnd(): Date | undefined {
    return this.getColumnValue("windowEnd") as Date | undefined;
  }

  public set windowEnd(v: Date | undefined) {
    this.setColumnValue("windowEnd", v);
  }

  public get namespace(): string | undefined {
    return this.getColumnValue("namespace") as string | undefined;
  }

  public set namespace(v: string | undefined) {
    this.setColumnValue("namespace", v);
  }

  public get controllerKind(): string | undefined {
    return this.getColumnValue("controllerKind") as string | undefined;
  }

  public set controllerKind(v: string | undefined) {
    this.setColumnValue("controllerKind", v);
  }

  public get controllerName(): string | undefined {
    return this.getColumnValue("controllerName") as string | undefined;
  }

  public set controllerName(v: string | undefined) {
    this.setColumnValue("controllerName", v);
  }

  public get podName(): string | undefined {
    return this.getColumnValue("podName") as string | undefined;
  }

  public set podName(v: string | undefined) {
    this.setColumnValue("podName", v);
  }

  public get containerName(): string | undefined {
    return this.getColumnValue("containerName") as string | undefined;
  }

  public set containerName(v: string | undefined) {
    this.setColumnValue("containerName", v);
  }

  public get nodeName(): string | undefined {
    return this.getColumnValue("nodeName") as string | undefined;
  }

  public set nodeName(v: string | undefined) {
    this.setColumnValue("nodeName", v);
  }

  public get providerId(): string | undefined {
    return this.getColumnValue("providerId") as string | undefined;
  }

  public set providerId(v: string | undefined) {
    this.setColumnValue("providerId", v);
  }

  public get labels(): Record<string, string> | undefined {
    return this.getColumnValue("labels") as Record<string, string> | undefined;
  }

  public set labels(v: Record<string, string> | undefined) {
    this.setColumnValue("labels", v);
  }

  public get labelKeys(): Array<string> | undefined {
    return this.getColumnValue("labelKeys") as Array<string> | undefined;
  }

  public set labelKeys(v: Array<string> | undefined) {
    this.setColumnValue("labelKeys", v);
  }

  public get cpuCoreHours(): number | undefined {
    return this.getColumnValue("cpuCoreHours") as number | undefined;
  }

  public set cpuCoreHours(v: number | undefined) {
    this.setColumnValue("cpuCoreHours", v);
  }

  public get cpuCoreRequestAverage(): number | undefined {
    return this.getColumnValue("cpuCoreRequestAverage") as number | undefined;
  }

  public set cpuCoreRequestAverage(v: number | undefined) {
    this.setColumnValue("cpuCoreRequestAverage", v);
  }

  public get cpuCoreUsageAverage(): number | undefined {
    return this.getColumnValue("cpuCoreUsageAverage") as number | undefined;
  }

  public set cpuCoreUsageAverage(v: number | undefined) {
    this.setColumnValue("cpuCoreUsageAverage", v);
  }

  public get cpuCost(): number | undefined {
    return this.getColumnValue("cpuCost") as number | undefined;
  }

  public set cpuCost(v: number | undefined) {
    this.setColumnValue("cpuCost", v);
  }

  public get gpuHours(): number | undefined {
    return this.getColumnValue("gpuHours") as number | undefined;
  }

  public set gpuHours(v: number | undefined) {
    this.setColumnValue("gpuHours", v);
  }

  public get gpuCost(): number | undefined {
    return this.getColumnValue("gpuCost") as number | undefined;
  }

  public set gpuCost(v: number | undefined) {
    this.setColumnValue("gpuCost", v);
  }

  public get ramByteHours(): number | undefined {
    return this.getColumnValue("ramByteHours") as number | undefined;
  }

  public set ramByteHours(v: number | undefined) {
    this.setColumnValue("ramByteHours", v);
  }

  public get ramBytesRequestAverage(): number | undefined {
    return this.getColumnValue("ramBytesRequestAverage") as number | undefined;
  }

  public set ramBytesRequestAverage(v: number | undefined) {
    this.setColumnValue("ramBytesRequestAverage", v);
  }

  public get ramBytesUsageAverage(): number | undefined {
    return this.getColumnValue("ramBytesUsageAverage") as number | undefined;
  }

  public set ramBytesUsageAverage(v: number | undefined) {
    this.setColumnValue("ramBytesUsageAverage", v);
  }

  public get ramCost(): number | undefined {
    return this.getColumnValue("ramCost") as number | undefined;
  }

  public set ramCost(v: number | undefined) {
    this.setColumnValue("ramCost", v);
  }

  public get pvByteHours(): number | undefined {
    return this.getColumnValue("pvByteHours") as number | undefined;
  }

  public set pvByteHours(v: number | undefined) {
    this.setColumnValue("pvByteHours", v);
  }

  public get pvCost(): number | undefined {
    return this.getColumnValue("pvCost") as number | undefined;
  }

  public set pvCost(v: number | undefined) {
    this.setColumnValue("pvCost", v);
  }

  public get networkCost(): number | undefined {
    return this.getColumnValue("networkCost") as number | undefined;
  }

  public set networkCost(v: number | undefined) {
    this.setColumnValue("networkCost", v);
  }

  public get loadBalancerCost(): number | undefined {
    return this.getColumnValue("loadBalancerCost") as number | undefined;
  }

  public set loadBalancerCost(v: number | undefined) {
    this.setColumnValue("loadBalancerCost", v);
  }

  public get sharedCost(): number | undefined {
    return this.getColumnValue("sharedCost") as number | undefined;
  }

  public set sharedCost(v: number | undefined) {
    this.setColumnValue("sharedCost", v);
  }

  public get externalCost(): number | undefined {
    return this.getColumnValue("externalCost") as number | undefined;
  }

  public set externalCost(v: number | undefined) {
    this.setColumnValue("externalCost", v);
  }

  public get totalCost(): number | undefined {
    return this.getColumnValue("totalCost") as number | undefined;
  }

  public set totalCost(v: number | undefined) {
    this.setColumnValue("totalCost", v);
  }

  public get cpuEfficiency(): number | undefined {
    return this.getColumnValue("cpuEfficiency") as number | undefined;
  }

  public set cpuEfficiency(v: number | undefined) {
    this.setColumnValue("cpuEfficiency", v);
  }

  public get ramEfficiency(): number | undefined {
    return this.getColumnValue("ramEfficiency") as number | undefined;
  }

  public set ramEfficiency(v: number | undefined) {
    this.setColumnValue("ramEfficiency", v);
  }

  public get totalEfficiency(): number | undefined {
    return this.getColumnValue("totalEfficiency") as number | undefined;
  }

  public set totalEfficiency(v: number | undefined) {
    this.setColumnValue("totalEfficiency", v);
  }

  public get currency(): string | undefined {
    return this.getColumnValue("currency") as string | undefined;
  }

  public set currency(v: string | undefined) {
    this.setColumnValue("currency", v);
  }

  public get retentionDate(): Date | undefined {
    return this.getColumnValue("retentionDate") as Date | undefined;
  }

  public set retentionDate(v: Date | undefined) {
    this.setColumnValue("retentionDate", v);
  }
}
