import KubernetesCluster from "./KubernetesCluster";
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
 *                         KubernetesResource
 * ------------------------------------------------------------------
 *
 * Inventory snapshot of a single Kubernetes object (Pod, Node,
 * Deployment, ...) in a single cluster. Populated by the OTel logs
 * ingest path from the k8sobjects receiver snapshot stream
 * (kubernetes-agent pulls every 5 min by default).
 *
 * The overview page reads aggregates from this table instead of
 * groupBy-ing over 24h of ClickHouse metric/log data.
 *
 * Rows are upserted per snapshot and hard-deleted once lastSeenAt
 * falls behind "now - 15min" for clusters that remain connected.
 *
 * Writes go through KubernetesResourceService under isRoot; users
 * never create/update/delete rows directly.
 *
 * ------------------------------------------------------------------
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsManager,
  Permission.ReadKubernetesCluster,
  Permission.ReadAllProjectResources,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/kubernetes-resource"))
@TableMetadata({
  tableName: "KubernetesResource",
  singularName: "Kubernetes Resource",
  pluralName: "Kubernetes Resources",
  icon: IconProp.Cube,
  tableDescription:
    "Snapshot of a Kubernetes object (pod, node, deployment, etc.) as last reported by the kubernetes-agent. Populated by the telemetry ingest pipeline; not user-editable.",
})
@Index(["projectId", "kubernetesClusterId", "kind", "namespaceKey", "name"], {
  unique: true,
})
@Entity({
  name: "KubernetesResource",
})
export default class KubernetesResource extends BaseModel {
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
    manyToOneRelationColumn: "kubernetesClusterId",
    type: TableColumnType.Entity,
    modelType: KubernetesCluster,
    title: "Kubernetes Cluster",
    description: "Cluster this resource lives in.",
  })
  @ManyToOne(
    () => {
      return KubernetesCluster;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "kubernetesClusterId" })
  public kubernetesCluster?: KubernetesCluster = undefined;

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
    title: "Kubernetes Cluster ID",
    description: "ID of the Kubernetes Cluster this resource lives in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public kubernetesClusterId?: ObjectID = undefined;

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
      "Kubernetes resource kind in singular PascalCase (e.g. Pod, Node, Deployment).",
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
    title: "Namespace Key",
    description:
      "Kubernetes namespace, or empty string for cluster-scoped resources. Kept non-null so the upsert unique index works.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "",
  })
  public namespaceKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Kubernetes resource name (metadata.name).",
  })
  @Column({
    nullable: false,
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
    title: "UID",
    description: "Kubernetes metadata.uid — stable identity across restarts.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public uid?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Phase",
    description:
      "Pod.status.phase (Running / Pending / Failed / Succeeded / Unknown). Null for non-Pod kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public phase?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Ready",
    description:
      "True if Node.status.conditions[type=Ready].status == True. Null for non-Node kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isReady?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Has Memory Pressure",
    description: "Node MemoryPressure condition. Null for non-Node kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public hasMemoryPressure?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Has Disk Pressure",
    description: "Node DiskPressure condition. Null for non-Node kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public hasDiskPressure?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Has PID Pressure",
    description: "Node PIDPressure condition. Null for non-Node kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public hasPidPressure?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Labels",
    description: "Kubernetes metadata.labels.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public labels?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Annotations",
    description: "Kubernetes metadata.annotations.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public annotations?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Owner References",
    description: "Kubernetes metadata.ownerReferences array.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public ownerReferences?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Spec",
    description: "Kubernetes spec block, verbatim from the last snapshot.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public spec?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Status",
    description: "Kubernetes status block, verbatim from the last snapshot.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public status?: JSONObject = undefined;

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
      "Agent-observed timestamp of the most recent snapshot for this resource. Also acts as the monotonic guard for upserts.",
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
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Resource Creation Timestamp",
    description: "Kubernetes metadata.creationTimestamp of this object.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public resourceCreationTimestamp?: Date = undefined;

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
