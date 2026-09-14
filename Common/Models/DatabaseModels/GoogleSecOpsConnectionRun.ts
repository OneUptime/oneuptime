import Project from "./Project";
import User from "./User";
import GoogleSecOpsConnection from "./GoogleSecOpsConnection";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
import {
  GoogleSecOpsRunType,
  GoogleSecOpsRunStatus,
} from "../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
];

// Only the worker and authorized operations API write these records.
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/google-secops-connection-run"))
@Entity({ name: "GoogleSecOpsConnectionRun" })
@Index(["projectId", "googleSecOpsConnectionId", "createdAt"])
@TableMetadata({
  tableName: "GoogleSecOpsConnectionRun",
  singularName: "Google SecOps Connection Run",
  pluralName: "Google SecOps Connection Runs",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "History of connection tests, previews, scheduled polls and historical imports. Credentials are never included.",
})
@TableAccessControl({
  create: [],
  read: readPermissions,
  update: [],
  delete: [],
})
export default class GoogleSecOpsConnectionRun extends BaseModel {
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: Project,
    manyToOneRelationColumn: "projectId",
    title: "Project",
    description: "Project for this run.",
    required: true,
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "ID of the project for this run.",
    required: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: GoogleSecOpsConnection,
    manyToOneRelationColumn: "googleSecOpsConnectionId",
    title: "Connection",
    description: "Connection for this run.",
    required: true,
  })
  @ManyToOne(
    () => {
      return GoogleSecOpsConnection;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "googleSecOpsConnectionId" })
  public googleSecOpsConnection?: GoogleSecOpsConnection = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Connection ID",
    description: "ID of the connection for this run.",
    required: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public googleSecOpsConnectionId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Entity,
    modelType: User,
    manyToOneRelationColumn: "requestedByUserId",
    title: "Requested By",
    description: "Requested By for this run.",
    required: false,
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
  @JoinColumn({ name: "requestedByUserId" })
  public requestedByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Requested By ID",
    description: "ID of the requested by for this run.",
    required: false,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public requestedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Operation",
    description: "Operation of this connection run.",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public type?: GoogleSecOpsRunType = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Status",
    description: "Status of this connection run.",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public status?: GoogleSecOpsRunStatus = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Started At",
    description: "When this run started.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Completed At",
    description: "When this run completed.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public completedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Request",
    description:
      "Validated operation and selected time range. Contains no credentials.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public request?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Result",
    description:
      "Counts, requested time range, checks and a bounded preview of detections.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public result?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Error",
    description: "The run failure with credentials redacted.",
  })
  @Column({ type: ColumnType.VeryLongText, nullable: true })
  public error?: string = undefined;
}
