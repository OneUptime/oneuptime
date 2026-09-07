import VMwareSource from "./VMwareSource";
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
  Permission.ReadVMwareResource,
];
const EDIT: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditVMwareResource,
];
const CREATE: Array<Permission> = [];

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({ create: CREATE, read: READ, update: EDIT, delete: [] })
@CrudApiEndpoint(new Route("/vmware-resource"))
@Index(["projectId", "sourceId", "resourceType", "resourceIdentifier"], {
  unique: true,
})
@Index(["projectId", "isArchived"])
@TableMetadata({
  tableName: "VMwareResource",
  singularName: "VMware Resource",
  pluralName: "VMware Resources",
  icon: IconProp.Server,
  tableDescription:
    "Persistent VMware inventory. Missing telemetry does not retire a resource.",
})
@Entity({ name: "VMwareResource" })
export default class VMwareResource extends BaseModel {
  @ColumnAccessControl({ create: CREATE, read: READ, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "project relation",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
    },
  )
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

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "sourceId",
    type: TableColumnType.Entity,
    modelType: VMwareSource,
    title: "Source",
    description: "source relation",
  })
  @ManyToOne(
    () => {
      return VMwareSource;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
    },
  )
  @JoinColumn({ name: "sourceId" })
  public source?: VMwareSource = undefined;
  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Source ID",
    description: "Immutable source identifier",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public sourceId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    canReadOnRelationQuery: true,
    title: "resourceIdentifier",
    description:
      "Immutable collector identity. Never truncated or derived from a display name.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
    length: ColumnLength.LongText,
  })
  public resourceIdentifier?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
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

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "resourceType",
    description: "host, vm, datastore or cluster",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public resourceType?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    canReadOnRelationQuery: true,
    title: "metadata",
    description:
      "Latest collector metadata with full oneuptime.vmware attribute keys",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public metadata?: JSONObject = undefined;

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
      "Timestamp of the latest observed telemetry; missing-resource reports do not advance this value",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    canReadOnRelationQuery: true,
    title: "lastReportedAt",
    description:
      "Timestamp of the latest inventory report, including explicit unknown reports",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastReportedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: EDIT })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    canReadOnRelationQuery: true,
    title: "expectedRunning",
    description:
      "Optional expected-running override; null inherits collector policy",
  })
  @Column({ type: ColumnType.Boolean, nullable: true })
  public expectedRunning?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: EDIT })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    canReadOnRelationQuery: true,
    title: "maintenanceMode",
    description:
      "Optional maintenance override; null inherits collector policy",
  })
  @Column({ type: ColumnType.Boolean, nullable: true })
  public maintenanceMode?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: READ, update: EDIT })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    canReadOnRelationQuery: true,
    title: "isArchived",
    description: "Archived resources are excluded from monitoring",
  })
  @Column({ type: ColumnType.Boolean, nullable: false, default: false })
  public isArchived?: boolean = undefined;
}
