import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { JSONObject } from "../../Types/JSON";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

const READ: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ReadVMwareSource,
  Permission.ReadVMwareResource,
];
const EDIT: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditVMwareSource,
];
const CREATE: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateVMwareSource,
];

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: CREATE,
  read: READ,
  update: EDIT,
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteVMwareSource,
  ],
})
@CrudApiEndpoint(new Route("/vmware-source"))
@Index(["projectId", "sourceIdentifier"], { unique: true })
@Index(["projectId", "isArchived"])
@TableMetadata({
  tableName: "VMwareSource",
  singularName: "VMware Source",
  pluralName: "VMware Sources",
  icon: IconProp.Server,
  tableDescription:
    "A VMware vCenter or standalone ESXi collection source, identified independently of its display name.",
})
@Entity({ name: "VMwareSource" })
export default class VMwareSource extends BaseModel {
  @ColumnAccessControl({ create: CREATE, read: READ, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "project relation",
  })
  @ManyToOne(() => Project, {
    eager: false,
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;
  @ColumnAccessControl({ create: CREATE, read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "Immutable project identifier",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: CREATE, read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    canReadOnRelationQuery: true,
    title: "sourceIdentifier",
    description:
      "Immutable collector identity. Never truncated or derived from a display name.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
    length: ColumnLength.LongText,
  })
  public sourceIdentifier?: string = undefined;

  @ColumnAccessControl({ create: CREATE, read: READ, update: EDIT })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    canReadOnRelationQuery: true,
    title: "name",
    description: "Display name",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
    length: ColumnLength.LongText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({ create: CREATE, read: READ, update: EDIT })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "description",
    description: "Description of this source",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "kind",
    description: "vcenter or esxi",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public kind?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    canReadOnRelationQuery: true,
    title: "metrics",
    description: "Latest numeric metrics keyed by full metric name",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public metrics?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    canReadOnRelationQuery: true,
    title: "lastSeenAt",
    description:
      "Timestamp of the latest collector telemetry, including incomplete or failed collections",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Collection At",
    description: "Latest collector health report, including failed collections",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastCollectionAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Collection Interval Seconds",
    description:
      "Configured collector interval; freshness should allow at least three intervals",
  })
  @Column({ type: ColumnType.Number, nullable: true })
  public collectionIntervalSeconds?: number = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    canReadOnRelationQuery: true,
    title: "lastSuccessfulCollectionAt",
    description: "Latest successful complete inventory collection",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSuccessfulCollectionAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: EDIT })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    canReadOnRelationQuery: true,
    title: "isArchived",
    description: "Archived sources are excluded from monitoring",
  })
  @Column({ type: ColumnType.Boolean, nullable: false, default: false })
  public isArchived?: boolean = undefined;
}
