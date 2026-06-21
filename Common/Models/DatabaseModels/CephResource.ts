import CephCluster from "./CephCluster";
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
 *                           CephResource
 * ------------------------------------------------------------------
 *
 * Inventory snapshot of a single Ceph object (OSD, Pool, Mon, Mgr,
 * Mds or Rgw) in a single cluster. Populated by the OTel metrics
 * ingest path from the ceph-mgr prometheus module scrape stream —
 * identity and status already arrive in every metric batch, so no
 * separate object stream is needed.
 *
 * `externalId` is the `ceph_daemon` datapoint label for daemon kinds
 * (e.g. osd.3, mon.a, mgr.x) or the `pool_id` label for Pool kinds —
 * immutable and collision-free within a cluster.
 *
 * Pool I/O note: ceph_pool_rd / ceph_pool_wr are cumulative counters.
 * readOpsCounter / writeOpsCounter store the latest raw counter values
 * (rates are computed on read from the ClickHouse time series, like
 * K8s network rates) — they are NOT per-second rates.
 *
 * The list/detail pages read this table instead of groupBy-ing over
 * 24h of ClickHouse metric data. Rows are upserted per scrape and
 * hard-deleted once lastSeenAt falls behind "now - 15min" for clusters
 * that remain connected.
 *
 * Writes go through CephResourceService under isRoot; users never
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
  Permission.ReadCephCluster,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/ceph-resource"))
@TableMetadata({
  tableName: "CephResource",
  singularName: "Ceph Resource",
  pluralName: "Ceph Resources",
  icon: IconProp.Cube,
  tableDescription:
    "Snapshot of a Ceph object (OSD, pool, mon, mgr, mds, rgw) as last reported by the Ceph agent. Populated by the telemetry ingest pipeline; not user-editable.",
})
@Index(["projectId", "cephClusterId", "kind", "externalId"], {
  unique: true,
})
@Entity({
  name: "CephResource",
})
export default class CephResource extends BaseModel {
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
    manyToOneRelationColumn: "cephClusterId",
    type: TableColumnType.Entity,
    modelType: CephCluster,
    title: "Ceph Cluster",
    description: "Cluster this resource lives in.",
  })
  @ManyToOne(
    () => {
      return CephCluster;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cephClusterId" })
  public cephCluster?: CephCluster = undefined;

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
    title: "Ceph Cluster ID",
    description: "ID of the Ceph Cluster this resource lives in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cephClusterId?: ObjectID = undefined;

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
      "Ceph resource kind in singular PascalCase: Osd, Pool, Mon, Mgr, Mds or Rgw.",
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
      "The `ceph_daemon` label for daemon kinds (e.g. osd.3, mon.a) or the `pool_id` label for Pool kinds. Immutable and collision-free within a cluster; also the detail-route param.",
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
      "Human-friendly name — the pool name from ceph_pool_metadata for Pool kinds. Null for daemon kinds (externalId is already the daemon name).",
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
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Hostname",
    description:
      "Host this daemon runs on, from the *_metadata `hostname` label. Null for Pool kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public hostname?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Daemon Version",
    description:
      "Daemon version from the *_metadata `ceph_version` label. Null for Pool kinds. (Named daemonVersion because BaseModel already owns the `version` column.)",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public daemonVersion?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Device Class",
    description:
      "OSD device class (hdd / ssd / nvme) from ceph_osd_metadata. Null for non-Osd kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public deviceClass?: string = undefined;

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
      "True when the latest ceph_osd_up value is 1. Null for non-Osd kinds.",
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
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is In",
    description:
      "True when the latest ceph_osd_in value is 1. Null for non-Osd kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isIn?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "In Quorum",
    description:
      "True when the latest ceph_mon_quorum_status value is 1. Null for non-Mon kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public inQuorum?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Stat Bytes",
    description:
      "OSD total capacity (ceph_osd_stat_bytes). Null for non-Osd kinds.",
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
  public statBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Stat Bytes Used",
    description:
      "OSD used capacity (ceph_osd_stat_bytes_used). Null for non-Osd kinds.",
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
  public statBytesUsed?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Apply Latency Ms",
    description:
      "Latest OSD apply latency in milliseconds (ceph_osd_apply_latency_ms). Stored as decimal. Null for non-Osd kinds.",
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
  public applyLatencyMs?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Commit Latency Ms",
    description:
      "Latest OSD commit latency in milliseconds (ceph_osd_commit_latency_ms). Stored as decimal. Null for non-Osd kinds.",
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
  public commitLatencyMs?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "PG Count",
    description:
      "Number of placement groups on this OSD (ceph_osd_numpg). Null for non-Osd kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public pgCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Stored Bytes",
    description:
      "Pool stored bytes (ceph_pool_stored). Null for non-Pool kinds.",
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
  public storedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Max Avail Bytes",
    description:
      "Pool max available bytes (ceph_pool_max_avail). Pool used percent = stored / (stored + max_avail) * 100. Null for non-Pool kinds.",
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
  public maxAvailBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Objects",
    description:
      "Number of objects in this pool (ceph_pool_objects). Null for non-Pool kinds.",
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
  public objects?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Read Ops Counter",
    description:
      "Latest raw value of the cumulative ceph_pool_rd counter — NOT a per-second rate. Read IOPS are computed on read from the ClickHouse time series. Null for non-Pool kinds.",
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
  public readOpsCounter?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Write Ops Counter",
    description:
      "Latest raw value of the cumulative ceph_pool_wr counter — NOT a per-second rate. Write IOPS are computed on read from the ClickHouse time series. Null for non-Pool kinds.",
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
  public writeOpsCounter?: number = undefined;

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
