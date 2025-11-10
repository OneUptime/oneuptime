import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Project from "./Project";
import StatusPage from "./StatusPage";
import StatusPagePrivateUser from "./StatusPagePrivateUser";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import ColumnLength from "../../Types/Database/ColumnLength";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation({
  isMasterAdminApiDocs: true,
})
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "StatusPagePrivateUserSession",
})
@TableMetadata({
  tableName: "StatusPagePrivateUserSession",
  singularName: "Status Page Session",
  pluralName: "Status Page Sessions",
  icon: IconProp.Clock,
  tableDescription:
    "Stores refresh tokens and metadata for authenticated status page sessions.",
})
@CurrentUserCanAccessRecordBy("statusPagePrivateUserId")
class StatusPagePrivateUserSession extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPagePrivateUserId",
    type: TableColumnType.Entity,
    title: "Private User",
    description: "Status page private user associated with this session.",
    modelType: StatusPagePrivateUser,
  })
  @ManyToOne(() => {
    return StatusPagePrivateUser;
  })
  @JoinColumn({ name: "statusPagePrivateUserId" })
  public statusPagePrivateUser?: StatusPagePrivateUser = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Private User ID",
    description: "ID of the status page private user.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPagePrivateUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "statusPageId",
    type: TableColumnType.Entity,
    title: "Status Page",
    description: "Status page for which this session is valid.",
    modelType: StatusPage,
  })
  @ManyToOne(() => {
    return StatusPage;
  })
  @JoinColumn({ name: "statusPageId" })
  public statusPage?: StatusPage = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Status Page ID",
    description: "Identifier of the status page tied to this session.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public statusPageId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    title: "Project",
    description: "Project that owns the status page.",
    modelType: Project,
  })
  @ManyToOne(() => {
    return Project;
  })
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "Project identifier for this session.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Refresh Token",
    description: "Refresh token for this session.",
    hashed: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
    unique: true,
  })
  public refreshToken?: string = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Expires At",
    description: "When this refresh token expires.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    default: () => {
      return "now()";
    },
  })
  public refreshTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Used At",
    description: "When this session was last used.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    default: () => {
      return "now()";
    },
  })
  public lastUsedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "IP Address",
    description: "IP address associated with this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public ipAddress?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "User Agent",
    description: "User agent information for this session.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public userAgent?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device",
    description: "Device description captured for this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public device?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is Revoked",
    description: "Marks whether this session has been revoked.",
    isDefaultValueColumn: true,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isRevoked?: boolean = undefined;
}

export default StatusPagePrivateUserSession;
