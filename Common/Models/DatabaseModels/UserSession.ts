import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Project from "./Project";
import User from "./User";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";
import ColumnLength from "../../Types/Database/ColumnLength";
import HashedString from "../../Types/HashedString";

@EnableDocumentation({
  isMasterAdminApiDocs: true,
})
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-session"))
@Entity({
  name: "UserSession",
})
@TableMetadata({
  tableName: "UserSession",
  singularName: "User Session",
  pluralName: "User Sessions",
  icon: IconProp.Clock,
  tableDescription: "Stores refresh tokens and metadata for authenticated dashboard sessions.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserSession extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    title: "User",
    description: "User associated with this session.",
    modelType: User,
  })
  @ManyToOne(() => {
    return User;
  })
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description: "ID of the user associated with this session.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.HashedString,
    title: "Refresh Token Hash",
    description: "Hashed refresh token for this session.",
    hashed: true,
    required: true,
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
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Expires At",
    description: "When this refresh token expires.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    default: () => "now()",
  })
  public refreshTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Used At",
    description: "When this session was last used.",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    default: () => "now()",
  })
  public lastUsedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "IP Address",
    description: "IP address used when this session was created or refreshed.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public ipAddress?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "User Agent",
    description: "User agent string associated with this session.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public userAgent?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device",
    description: "Device description associated with this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public device?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
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

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Global Login",
    description: "Indicates if this session was created via global login (non-SSO).",
    isDefaultValueColumn: true,
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isGlobalLogin?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    title: "Project",
    description: "Project tied to this session when authenticated via SSO.",
    modelType: Project,
  })
  @ManyToOne(() => {
    return Project;
  })
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "Project identifier for SSO sessions.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;
}

export default UserSession;
