import StorageArray from "./StorageArray";
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
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ------------------------------------------------------------------
 *                       StorageArrayResource
 * ------------------------------------------------------------------
 *
 * Inventory snapshot of one object inside one storage array: a volume,
 * host, pod, hardware component, drive, controller, network interface or
 * directory on a FlashArray, or a hardware component, file system or
 * bucket on a FlashBlade (see StorageArrayResourceKind). Populated by the
 * OTel metrics ingest path from the array's OpenMetrics scrape stream —
 * identity, status and the latest values all arrive in every scrape, so
 * no separate object stream is needed (same model as CephResource).
 *
 * `externalId` is the object's name as the array reports it (the `name`,
 * `host` or `component_name` label) — unique within an array and kind,
 * and the detail-route param.
 *
 * All rates are gauges the array already computes per second
 * (reads_per_sec, read_bytes_per_sec, usec_per_read_op), so unlike
 * CephResource no counters are stored.
 *
 * The list/detail pages read this table instead of groupBy-ing over
 * ClickHouse metric data. Rows are upserted per scrape and hard-deleted
 * by the StorageArray CleanupStaleResources job once lastSeenAt falls
 * behind for arrays that remain connected.
 *
 * Writes go through StorageArrayResourceService under isRoot; users never
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
  Permission.ReadStorageArray,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/storage-array-resource"))
@TableMetadata({
  tableName: "StorageArrayResource",
  singularName: "Storage Array Resource",
  pluralName: "Storage Array Resources",
  icon: IconProp.Cube,
  tableDescription:
    "Snapshot of an object inside a storage array (volume, host, pod, hardware component, drive, controller, network interface, directory, file system or bucket) as last reported by the Storage Array Agent. Populated by the telemetry ingest pipeline; not user-editable.",
})
@Index(["projectId", "storageArrayId", "kind", "externalId"], {
  unique: true,
})
@Entity({
  name: "StorageArrayResource",
})
export default class StorageArrayResource extends BaseModel {
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
    manyToOneRelationColumn: "storageArrayId",
    type: TableColumnType.Entity,
    modelType: StorageArray,
    title: "Storage Array",
    description: "Storage array this resource lives in.",
  })
  @ManyToOne(
    () => {
      return StorageArray;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "storageArrayId" })
  public storageArray?: StorageArray = undefined;

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
    title: "Storage Array ID",
    description: "ID of the Storage Array this resource lives in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public storageArrayId?: ObjectID = undefined;

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
      "Resource kind in singular PascalCase: Volume, Host, Pod, Hardware, Drive, Controller, NetworkInterface or Directory (FlashArray); Hardware, FileSystem or Bucket (FlashBlade).",
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
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "External ID",
    description:
      "The object's name as the array reports it (the name, host or component_name label). Unique within an array and kind; also the detail-route param.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Display name of the object. Usually the same as externalId.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "Latest status as the array reports it, lowercased: ok, critical, degraded, not_installed ... for hardware; healthy, failed, empty ... for drives; ready, not ready ... for controllers; healthy, critical, unused for host connectivity; the replica link status for pods; enabled or disabled for network interfaces.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Status Detail",
    description:
      "Extra status context: the connectivity detail of a host (Redundant, Single Controller, None...) or the mode of a controller (primary, secondary).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public statusDetail?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Component Type",
    description:
      "Hardware component type (chassis, controller, drive_bay, power_supply, temp_sensor, eth_port, fc_port, cooling...), drive type (SSD, NVRAM, cache) or network interface type (eth, fc).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public componentType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Model",
    description: "Hardware model, for controllers.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public model?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Firmware Version",
    description: "Firmware or software version, for controllers.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public firmwareVersion?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Group",
    description:
      "The group the object belongs to: the pod or volume group of a volume, the host group of a host, or the object store account of a bucket.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public groupName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Capacity Bytes",
    description:
      "Size of the object: provisioned size of a volume, host, pod, directory or file system; raw capacity of a drive; quota of a bucket. Null when the array does not report one.",
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
  public capacityBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Used Bytes",
    description:
      "Physical space the object uses on the array (the total_physical space series on FlashArray; total_physical / unique on FlashBlade).",
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
  public usedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Data Reduction Ratio",
    description:
      "Data reduction ratio of the object, for example 3.5 for 3.5:1.",
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
  public dataReductionRatio?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Read Latency (µs)",
    description:
      "Latest average read latency in microseconds (dimension usec_per_read_op).",
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
  public readLatencyUsec?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Write Latency (µs)",
    description:
      "Latest average write latency in microseconds (dimension usec_per_write_op).",
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
  public writeLatencyUsec?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Read IOPS",
    description: "Latest read operations per second (dimension reads_per_sec).",
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
  public readIops?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Write IOPS",
    description:
      "Latest write operations per second (dimension writes_per_sec).",
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
  public writeIops?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Read Bandwidth",
    description:
      "Latest read bandwidth in bytes per second (dimension read_bytes_per_sec).",
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
  public readBytesPerSec?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Write Bandwidth",
    description:
      "Latest write bandwidth in bytes per second (dimension write_bytes_per_sec).",
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
  public writeBytesPerSec?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Temperature (°C)",
    description: "Latest temperature of a hardware sensor in degrees Celsius.",
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
  public temperatureCelsius?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Replication Lag (ms)",
    description:
      "Largest maximum lag across a pod's replica links, in milliseconds.",
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
  public replicationLagMs?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Connections",
    description:
      "Number of volumes connected to a host, or of hosts a volume is connected to.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public connectionCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Details",
    description:
      "Vendor-specific attributes of the object that have no column of their own, as reported in the scrape: naa_id of a volume, iqn / wwn / nqn / portal of a port, speed and services of a network interface, protocol of a drive, NFS / SMB flags of a file system.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public details?: JSONObject = undefined;

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
      "Agent-observed timestamp of the most recent scrape containing this resource. Also acts as the monotonic guard for upserts and the cutoff the stale-resource cleanup uses.",
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
