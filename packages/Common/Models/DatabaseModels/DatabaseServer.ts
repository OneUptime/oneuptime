import DockerHost from "./DockerHost";
import KubernetesCluster from "./KubernetesCluster";
import Label from "./Label";
import PodmanHost from "./PodmanHost";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import TelemetryRetentionConfig from "../../Types/Telemetry/TelemetryRetentionConfig";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * A database server a project runs or talks to - PostgreSQL, MySQL, Redis,
 * MongoDB and the rest of the engines in Types/DatabaseServer/DatabaseSystem.
 *
 * Not called `Database`: DatabaseService is the base class of every service,
 * and MonitorType.Database / EntityType.Database already exist. The display
 * names are still "Database" / "Databases".
 *
 * Rows come from five discovery sources (discoverySource, first creator
 * wins): OTel Collector database receivers at ingest, CLIENT spans of
 * instrumented applications, database workloads on a monitored Kubernetes
 * cluster, database containers on a monitored Docker / Podman host, and
 * manual creation in the dashboard. Every non-manual path writes as root.
 *
 * Telemetry is selected by entity keys, never by a column here: the keys of
 * the row's endpoints (DatabaseServerEndpoint, one owner per endpoint per
 * project) plus the workload member keys in memberEntityKeys.
 *
 * COLUMN ACCESS: DatabaseService.create runs onBeforeCreate BEFORE the column
 * permission check, so every column DatabaseServerService.onBeforeCreate sets
 * during a manual (non-root) create - name, description, dbSystem,
 * serverAddress, serverPort, databaseIdentifier, discoverySource, labels -
 * carries create permission for the table's create roles, or a manual create
 * is refused with "User is not allowed to Create on <column>". Columns only
 * the discovery paths write are create: [] and update: [].
 */
@AccessControlColumn("labels")
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateDatabaseServer,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadDatabaseServer,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteDatabaseServer,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditDatabaseServer,
  ],
})
@CrudApiEndpoint(new Route("/database-server"))
@SlugifyColumn("name", "slug")
/*
 * DB-level identity guard. Every discovery path find-or-creates by
 * databaseIdentifier ("<system>|<endpoint>" or the workload form), and several
 * ingest pods / worker runs can race on the same database - only this index
 * collapses them into one row. The display name is deliberately NOT unique:
 * two engines can legitimately share a host name.
 */
@Index(["projectId", "databaseIdentifier"], { unique: true })
@Index(["projectId", "isArchived"])
@Index(["projectId", "dbSystem"])
/*
 * Named for the same reason as IDX_ceph_cluster_slug: TypeORM's schema
 * builder matches database indexes to entity metadata by name and drops every
 * one it cannot find, so a partial unique index must be declared here, by
 * name, to survive the next generated migration.
 */
@Index("IDX_database_server_slug", ["slug"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
/*
 * One row per discovered workload (Kubernetes StatefulSet / Deployment /
 * operator cluster, Docker / Podman container group). Partial so the many
 * endpoint-only rows (NULL workloadIdentifier) never collide, and so an
 * adopted row keeps being found by its workload after the discovery worker
 * sets the column on it.
 */
@Index("IDX_database_server_workload", ["projectId", "workloadIdentifier"], {
  unique: true,
  where: '"workloadIdentifier" IS NOT NULL AND "deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "DatabaseServer",
  singularName: "Database",
  pluralName: "Databases",
  icon: IconProp.Database,
  tableDescription:
    "Database servers this project runs or talks to. Each database is discovered from OpenTelemetry Collector database receivers, from database calls in application traces, from database workloads on monitored Kubernetes clusters and Docker / Podman hosts, or added manually.",
})
@Entity({
  name: "DatabaseServer",
})
export default class DatabaseServer extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * Display name only - identity lives in databaseIdentifier. Discovered rows are
   * named "<Engine> <host:port>" (buildDatabaseServerDisplayName), so a label or
   * owner rule name pattern such as ^PostgreSQL expresses "every PostgreSQL
   * database".
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditDatabaseServer,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Name of this database. Discovered databases are named after their engine and endpoint, e.g. PostgreSQL orders-db.internal:5432. Not unique - rename freely.",
    example: "PostgreSQL orders-db.internal:5432",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditDatabaseServer,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Friendly description for this database",
    example: "Primary PostgreSQL database for the orders service",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * Creatable, never updatable - see the identical note on
   * CloudResource.resourceIdentifier. For a manual create
   * DatabaseServerService.onBeforeCreate computes it from dbSystem and the
   * canonical endpoint, which is exactly why it must stay user-creatable: the
   * column permission check runs after that hook.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Database Identifier",
    description:
      "Stable identity of this database within the project: the engine and its canonical endpoint joined with '|' (e.g. postgresql|orders-db.internal:5432), or the workload form for databases discovered on Kubernetes / Docker / Podman (e.g. postgresql|kubernetes:prod-cluster/data/statefulset/orders-db). Computed by the server for manually added databases.",
    example: "postgresql|orders-db.internal:5432",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public databaseIdentifier?: string = undefined;

  /*
   * Root-only. Set by the container discovery worker on rows it creates AND on
   * endpoint rows it adopts, so the workload is found again by this column on
   * every run (IDX_database_server_workload) rather than by alias.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Workload Identifier",
    description:
      "Identity of the Kubernetes / Docker / Podman workload this database runs as, e.g. postgresql|kubernetes:prod-cluster/data/statefulset/orders-db. Empty for databases that are only known by their endpoint.",
    example: "postgresql|kubernetes:prod-cluster/data/statefulset/orders-db",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public workloadIdentifier?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Database Engine",
    description:
      "Database engine family as an OpenTelemetry db.system.name value, e.g. postgresql, mysql, redis, mongodb, microsoft.sql_server.",
    example: "postgresql",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public dbSystem?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Server Address",
    description:
      "Host name or IP address of the primary endpoint of this database (the OpenTelemetry server.address attribute).",
    example: "orders-db.internal",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public serverAddress?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Server Port",
    description:
      "Port of the primary endpoint of this database (the OpenTelemetry server.port attribute). Defaults to the engine's standard port when not given.",
    example: "5432",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public serverPort?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Database Version",
    description:
      "Engine version last reported for this database, from the collector receiver or the container image tag.",
    example: "16.4",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public dbVersion?: string = undefined;

  /*
   * Which path created the row: collector, client-spans, kubernetes, docker,
   * podman or manual (DatabaseServerDiscoverySource). First creator wins; it is
   * never overwritten. Creatable because onBeforeCreate stamps "manual".
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Discovery Source",
    description:
      "How this database was first discovered: collector, client-spans, kubernetes, docker, podman or manual.",
    example: "collector",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public discoverySource?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "kubernetesClusterId",
    type: TableColumnType.Entity,
    modelType: KubernetesCluster,
    title: "Kubernetes Cluster",
    description:
      "Kubernetes cluster this database runs on, when it was discovered as a workload on a monitored cluster.",
  })
  @ManyToOne(
    () => {
      return KubernetesCluster;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "kubernetesClusterId" })
  public kubernetesCluster?: KubernetesCluster = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Kubernetes Cluster ID",
    description:
      "ID of the Kubernetes cluster this database runs on, when it was discovered as a workload on a monitored cluster.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public kubernetesClusterId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Kubernetes Namespace",
    description: "Kubernetes namespace of the workload this database runs as.",
    example: "data",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kubernetesNamespace?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Workload Kind",
    description:
      "Kind of workload this database runs as, e.g. StatefulSet, Deployment, Cluster (an operator-managed cluster) or Container.",
    example: "StatefulSet",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public workloadKind?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Workload Name",
    description:
      "Name of the workload (StatefulSet, Deployment, operator cluster or container group) this database runs as.",
    example: "orders-db",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public workloadName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "dockerHostId",
    type: TableColumnType.Entity,
    modelType: DockerHost,
    title: "Docker Host",
    description:
      "Docker host this database runs on, when it was discovered as a container on a monitored host.",
  })
  @ManyToOne(
    () => {
      return DockerHost;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dockerHostId" })
  public dockerHost?: DockerHost = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Docker Host ID",
    description:
      "ID of the Docker host this database runs on, when it was discovered as a container on a monitored host.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dockerHostId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "podmanHostId",
    type: TableColumnType.Entity,
    modelType: PodmanHost,
    title: "Podman Host",
    description:
      "Podman host this database runs on, when it was discovered as a container on a monitored host.",
  })
  @ManyToOne(
    () => {
      return PodmanHost;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "podmanHostId" })
  public podmanHost?: PodmanHost = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Podman Host ID",
    description:
      "ID of the Podman host this database runs on, when it was discovered as a container on a monitored host.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public podmanHostId?: ObjectID = undefined;

  /*
   * Telemetry entity keys of the workload's members (Kubernetes pod / deployment
   * keys, container keys) mapped to the ISO time each was last seen
   * (DatabaseServerMemberKeys). Merged - never replaced - on every discovery run
   * and pruned by age, so logs of a pod that was replaced last week still show
   * on the page.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Member Entity Keys",
    description:
      "Telemetry entity keys of the pods / containers this database runs as, each with the time it was last seen. Maintained by discovery.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public memberEntityKeys?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Instance Count",
    description:
      "Number of running instances (pods / containers) last seen for this database's workload.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public instanceCount?: number = undefined;

  /*
   * Collector liveness ONLY: "connected" while an OTel Collector database
   * receiver (or the OneUptime Database Agent) keeps reporting engine metrics for
   * this database, "disconnected" once it has stopped (the stale-collector
   * sweep). Empty (NULL) while no collector ever reported - no DB default, so
   * a database that is merely queried by applications, seen as a container or
   * added by hand never claims a collector that "disconnected". lastSeenAt is
   * the any-source signal.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "OTel Collector Status",
    description:
      "Whether engine metrics are currently being received from a collector / agent for this database (connected) or a collector reported and has stopped (disconnected). Empty when no collector has ever reported.",
    example: "connected",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public otelCollectorStatus?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Collector Last Seen At",
    description:
      "When engine telemetry from a collector / agent was last received for this database.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public collectorLastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Agent Version",
    description:
      "Version of the OneUptime agent reporting this database, as self-reported via the oneuptime.agent.version resource attribute",
    example: "1.0.0",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public agentVersion?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description:
      "When this database was last seen by any discovery source - engine telemetry, application database calls or the workload inventory.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  /*
   * Set only by the auto-archive sweep (DatabaseServer:CleanupStaleResources) and
   * cleared when the database is seen again. It is what lets discovery un-archive
   * a row it archived itself while never touching one a person archived.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Auto Archived At",
    description:
      "When this database was archived automatically because no discovery source had seen it for a while. Empty when it was archived by a person or is not archived.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public autoArchivedAt?: Date = undefined;

  /*
   * Set when a PERSON restores the row from the archive (a hooked update to
   * isArchived=false), cleared when a person archives it. The auto-archive
   * sweep leaves such a row alone until discovery sees it again or a long
   * grace period passes - otherwise a Restore of a stale discovered database
   * would be undone by the next five-minute sweep.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Manually Restored At",
    description:
      "When a person last restored this database from the archive. Automatic archiving leaves it alone until it is seen again or a grace period passes.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public manuallyRestoredAt?: Date = undefined;

  /*
   * Which evidence set dbSystem (DatabaseSystemEvidence in
   * DatabaseServerService): manual > collector > container > client-spans.
   * A stronger source may correct the engine a weaker one guessed (a pgx
   * client saying "postgresql" for CockroachDB), any source may refine an
   * engine to a fork of it (redis -> valkey), and nothing ever downgrades.
   * Empty on a row whose engine was set by the path that created it - its
   * discoverySource then says which evidence that was.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Database Engine Source",
    description:
      "What the database engine was last determined from: manual, collector, container or client-spans. Stronger evidence may correct the engine; weaker evidence never changes it.",
    example: "container",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public dbSystemSource?: string = undefined;

  /*
   * When Kubernetes / Docker / Podman discovery last saw this row's workload.
   * Unlike lastSeenAt, application traces and collector heartbeats never move
   * it, so it is what tells a workload that is gone (its endpoints may be
   * handed to the workload that replaced it) from one that is merely quiet.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Workload Last Seen At",
    description:
      "When Kubernetes, Docker or Podman discovery last saw the workload this database runs as. Empty for a database that is not a discovered workload.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public workloadLastSeenAt?: Date = undefined;

  /*
   * The labels and owners that rules and ingest attached to this row on their
   * own ({ labelIds, ownerUserIds, ownerTeamIds }, ids as lowercase strings).
   * The auto-archive sweep counts only the OTHER labels and owners as a sign
   * that somebody cares about the row, so a catch-all label or owner rule
   * cannot keep every discovered database alive forever. A person adding
   * one of these labels or owners again takes it off the list.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Automatic Assignments",
    description:
      "Label and owner ids that label rules, owner rules or telemetry attached automatically. Maintained by OneUptime.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public automaticAssignments?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditDatabaseServer,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Archived",
    description:
      "Is this database archived? Archived databases are hidden from lists but keep collecting telemetry.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description: "When was this database archived?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public archivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "archivedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Archived by User",
    description:
      "Relation to User who archived this object (if this object was archived by a User)",
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
  @JoinColumn({ name: "archivedByUserId" })
  public archivedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Archived by User ID",
    description:
      "User ID who archived this object (if this object was archived by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public archivedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditDatabaseServer,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "DatabaseServerLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "databaseServerId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditDatabaseServer,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Retain Telemetry Data For Days",
    description:
      "Number of days to retain telemetry collected from this database by a collector / agent. Leave blank to use the project-wide default.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  public retainTelemetryDataForDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateDatabaseServer,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadDatabaseServer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditDatabaseServer,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Telemetry Data Retention Overrides",
    description:
      "Per-pillar retention overrides for telemetry collected from this database by a collector / agent (logs by severity, traces by status, metrics, profiles). Unset fields fall back to the database default, then the project's retention settings.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public telemetryRetentionConfig?: TelemetryRetentionConfig = undefined;
}
