import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import User from "./User";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import HashedString from "../../Types/HashedString";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

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
  icon: IconProp.Lock,
  tableDescription:
    "Active user sessions with refresh tokens and device metadata for enhanced authentication security.",
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
    modelType: User,
    title: "User",
    description: "User account this session belongs to.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "User ID",
    description: "Identifier for the user that owns this session.",
    canReadOnRelationQuery: true,
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
  @Index({ unique: true })
  @TableColumn({
    type: TableColumnType.HashedString,
    title: "Refresh Token",
    description: "Hashed refresh token for this session.",
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
    create: [],
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Active At",
    description: "Last time this session was used.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastActiveAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device Name",
    description: "Friendly name for the device used to sign in.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Device Type",
    description: "Type of device (e.g., desktop, mobile).",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Browser",
    description: "Browser or client application used for this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public deviceBrowser?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "IP Address",
    description: "IP address observed for this session.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public ipAddress?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "User Agent",
    description: "Complete user agent string supplied by the client.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public userAgent?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Is Revoked",
    description: "Marks whether the session has been explicitly revoked.",
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
    read: [Permission.CurrentUser],
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Revoked Reason",
    description: "Optional reason describing why the session was revoked.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public revokedReason?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Additional Info",
    description: "Flexible JSON payload for storing structured session metadata.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public additionalInfo?: JSONObject = undefined;
}

export default UserSession;
