import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Project from "./Project";
import StatusPage from "./StatusPage";
import StatusPagePrivateUser from "./StatusPagePrivateUser";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import HashedString from "../../Types/HashedString";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";


@AllowAccessIfSubscriptionIsUnpaid()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@CanAccessIfCanReadOn("statusPage")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateStatusPagePrivateUser,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadStatusPagePrivateUser,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteStatusPagePrivateUser,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditStatusPagePrivateUser,
  ],
})
@CrudApiEndpoint(new Route("/status-page-private-user-session"))
@Entity({
  name: "StatusPagePrivateUserSession",
})
@TableMetadata({
  tableName: "StatusPagePrivateUserSession",
  singularName: "Status Page Private User Session",
  pluralName: "Status Page Private User Sessions",
  icon: IconProp.Lock,
  tableDescription:
    "Stores status page private user sessions, refresh tokens, and device metadata for secure access control.",
})
export default class StatusPagePrivateUserSession extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Project that owns this private status page session.",
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
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "Project identifier for this session.",
    required: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageId",
    type: TableColumnType.Entity,
    modelType: StatusPage,
    title: "Status Page",
    description: "Status page associated with this session.",
  })
  @ManyToOne(
    () => {
      return StatusPage;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "statusPageId" })
  public statusPage?: StatusPage = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Status Page ID",
    description: "Identifier for the status page.",
    required: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPageId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPagePrivateUserId",
    type: TableColumnType.Entity,
    modelType: StatusPagePrivateUser,
    title: "Status Page Private User",
    description: "Private user record associated with this session.",
  })
  @ManyToOne(
    () => {
      return StatusPagePrivateUser;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "statusPagePrivateUserId" })
  public statusPagePrivateUser?: StatusPagePrivateUser = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Status Page Private User ID",
    description: "Identifier for the status page private user.",
    required: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPagePrivateUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
     
    ],
    read: [],
    update: [],
  })
  @Index({ unique: true })
  @TableColumn({
    type: TableColumnType.HashedString,
    title: "Refresh Token",
    description: "Hashed refresh token for the private user session.",
    required: true,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: false,
    unique: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public refreshToken?: HashedString = undefined;

  @ColumnAccessControl({
    create: [
     
    ],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Refresh Token Expires At",
    description: "Expiration timestamp for the refresh token.",
    required: true,
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public refreshTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Active At",
    description: "Last time this session was active.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastActiveAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device Name",
    description: "Friendly name for the device used to access the status page.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device Type",
    description: "Type of device (desktop, mobile, etc).",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceType?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device OS",
    description: "Operating system reported for this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceOS?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Browser",
    description: "Browser or client application used for the session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceBrowser?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "IP Address",
    description: "IP address recorded for this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public ipAddress?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "User Agent",
    description: "User agent string supplied by the client.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public userAgent?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is Revoked",
    description: "Indicates if the session has been revoked.",
    isDefaultValueColumn: true,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isRevoked?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Revoked At",
    description: "Timestamp when the session was revoked, if applicable.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public revokedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Revoked Reason",
    description: "Reason provided for revoking this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public revokedReason?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateStatusPagePrivateUser,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadStatusPagePrivateUser,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditStatusPagePrivateUser,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Additional Info",
    description: "Flexible JSON payload for storing structured metadata.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public additionalInfo?: JSONObject = undefined;
}
