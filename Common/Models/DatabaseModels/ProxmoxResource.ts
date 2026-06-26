import ProxmoxCluster from "./ProxmoxCluster";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ------------------------------------------------------------------
 *                          ProxmoxResource
 * ------------------------------------------------------------------
 *
 * Inventory snapshot of a single Proxmox VE object (Node, Guest or
 * Storage) in a single cluster. Populated by the OTel metrics ingest
 * path from the pve-exporter scrape stream — identity and status
 * already arrive in every metric batch, so no separate object stream
 * (à la k8sobjects) is needed.
 *
 * `externalId` is the pve-exporter `id` datapoint label verbatim
 * (`node/pve1`, `qemu/100`, `lxc/101`, `storage/local`) — immutable
 * and collision-free within a cluster.
 *
 * Latest-metric delta vs KubernetesResource: pve_cpu_usage_ratio is
 * already a true 0..1 ratio, so latestCpuPercent is just ratio * 100 —
 * no allocatable-denominator cache is needed (unlike K8s
 * cpuCoresToPercent).
 *
 * The list/detail pages read this table instead of groupBy-ing over
 * 24h of ClickHouse metric data. Rows are upserted per scrape and
 * hard-deleted once lastSeenAt falls behind "now - 15min" for clusters
 * that remain connected.
 *
 * Writes go through ProxmoxResourceService under isRoot; users never
 * create/update/delete rows directly.
 *
 * ------------------------------------------------------------------
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadProxmoxCluster,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/proxmox-resource"))
@TableMetadata({
  tableName: "ProxmoxResource",
  singularName: "Proxmox Resource",
  pluralName: "Proxmox Resources",
  icon: IconProp.Cube,
  tableDescription:
    "Snapshot of a Proxmox VE object (node, guest or storage) as last reported by the Proxmox agent. Populated by the telemetry ingest pipeline; not user-editable.",
})
@Index(["projectId", "proxmoxClusterId", "kind", "externalId"], {
  unique: true,
})
@Entity({
  name: "ProxmoxResource",
})
export default class ProxmoxResource extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project this resource belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the Project this resource belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "proxmoxClusterId",
    type: TableColumnType.Entity,
    modelType: ProxmoxCluster,
    title: "Proxmox Cluster",
    description: "Cluster this resource lives in.",
  })
  @ManyToOne(
    () => {
      return ProxmoxCluster;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "proxmoxClusterId" })
  public proxmoxCluster?: ProxmoxCluster = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Proxmox Cluster ID",
    description: "ID of the Proxmox Cluster this resource lives in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public proxmoxClusterId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "Proxmox resource kind in singular PascalCase: Node, Guest or Storage.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "External ID",
    description:
      "The pve-exporter `id` datapoint label verbatim (e.g. node/pve1, qemu/100, lxc/101, storage/local). Immutable and collision-free within a cluster; also the detail-route param.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public externalId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Human-friendly name from the pve_node_info / pve_guest_info `name` label or the pve_storage_info `storage` label. Null until the matching info series is scraped.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "VMID",
    description:
      "Proxmox VMID for Guest kinds (the numeric part of qemu/100). Null for Node and Storage kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public vmid?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Guest Type",
    description:
      "Guest virtualization type: qemu or lxc. Null for non-Guest kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public guestType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Parent Node Name",
    description:
      "The `node` label — the cluster node this guest or storage belongs to. Null for Node kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public parentNodeName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Up",
    description:
      "True when the latest pve_up value for this resource is 1 (node online / guest running / storage available).",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isUp?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "HA State",
    description:
      "Current HA state — the `state` label of the pve_ha_state enum-series whose value is 1 (e.g. started, stopped, error, fence). Null when the resource is not HA-managed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public haState?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "On Boot",
    description:
      "True when pve_onboot_status == 1 (guest configured to start on node boot). Null for non-Guest kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public onboot?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Backed Up",
    description:
      "True when this guest is covered by at least one backup job. Derived from the cluster-level backup-info collector: a pve_not_backed_up_info series carrying this guest's id means NOT covered. NULL for non-Guest kinds and until the collector reports. Coverage by a job is NOT the same as recent/successful backups.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isBackedUp?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Uptime Seconds",
    description:
      "Latest pve_uptime_seconds value for this node or guest. Null for Storage kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public uptimeSeconds?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest CPU Percent",
    description:
      "Most recent CPU utilization percent (pve_cpu_usage_ratio * 100 — already a true ratio; no allocatable-denominator cache needed, unlike K8s). Stored as decimal so sub-percent precision survives the round trip. Null until the first metric arrives.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestCpuPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Latest Memory Bytes",
    description:
      "Most recent memory usage (pve_memory_usage_bytes). Stored as bigint so values past 2 GiB don't overflow.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestMemoryBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Max Memory Bytes",
    description:
      "Total memory available to this node or guest (pve_memory_size_bytes). The denominator for the memory usage bar.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public maxMemoryBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest Memory Percent",
    description:
      "Most recent memory usage as a percent of maxMemoryBytes. Stored as decimal — mirrors latestCpuPercent — so list views can sort/filter without dividing bigints client-side.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestMemoryPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Latest Disk Bytes",
    description:
      "Most recent disk usage (pve_disk_usage_bytes). NULL for qemu guests without the QEMU guest agent — render N/A, never 0.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestDiskBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Max Disk Bytes",
    description:
      "Total disk size (pve_disk_size_bytes). The denominator for the disk/storage usage bar. NULL for qemu guests without the QEMU guest agent.",
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public maxDiskBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Metrics Updated At",
    description:
      "Observed timestamp of the latest metric point. Acts as the monotonic guard for metric updates and the cutoff for staleness rendering.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public metricsUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description:
      "Agent-observed timestamp of the most recent scrape containing this resource. Also acts as the monotonic guard for upserts.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description:
      "Not user-facing; ingest writes as isRoot so this stays null in practice.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this row.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
