import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnerOnlyColumn from "../../Types/Database/AccessControl/OwnerOnlyColumn";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnsTogether from "../../Types/Database/UniqueColumnsTogether";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * `read` names Permission.CurrentUser and nothing else, exactly like the other
 * notification-method models (UserTelegram has the full essay). That single
 * entry is what keeps every row owner-only: row scoping comes from the TABLE
 * list alone, and widening it would expose the Discord user id every project
 * member's pages are delivered to. Do not add administrator permissions here -
 * OnCallReadinessService returns the masked, admin-sanctioned view instead.
 *
 * Unlike Telegram/SMS/WhatsApp there is no verification code: a row is only
 * ever created from an existing, OAuth-established Discord account link
 * (WorkspaceUserAuthToken, written only by DiscordBindingService), so creation
 * IS verification. UserDiscordService enforces that and stamps the Discord
 * identifiers server-side. Relinking to another Discord account or unlinking
 * deletes the row (DiscordBindingService), and every send re-checks the live
 * link (WorkspaceUserNotificationService).
 */
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-discord"))
@Entity({
  name: "UserDiscord",
})
@TableMetadata({
  tableName: "UserDiscord",
  singularName: "Discord Account",
  pluralName: "Discord Accounts",
  icon: IconProp.Chat,
  tableDescription:
    "Discord accounts used for Discord direct-message notifications.",
})
@CurrentUserCanAccessRecordBy("userId")
/*
 * One live Discord method per person per project. onBeforeCreate counts first,
 * but two concurrent adds both count zero; only this index stops the second
 * row and its second set of seeded paging rules.
 */
@Index("IDX_USER_DISCORD_PROJECT_USER_UNIQUE", ["projectId", "userId"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@UniqueColumnsTogether(
  ["projectId", "userId"],
  "Discord is already added as a notification method for this project.",
)
class UserDiscord extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
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
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
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

  @ColumnAccessControl({
    /*
     * CurrentUser here does NOT mean the client may choose the value: the
     * service hook refuses any non-root payload that carries these columns
     * and then stamps them itself, and hooks run BEFORE the column
     * permission check (DatabaseService.create). The entry exists because
     * that same check runs on the STAMPED data - with an empty list the
     * server's own write is refused and no user can add this method at all.
     * Same shape as UserWebAuthn's server-stamped isVerified.
     */
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  /*
   * The Discord user id (a snowflake) the deployment bot delivers direct
   * messages to. Holding it is enough to address bot messages at that person,
   * so it is a delivery target and not a label. Captured server-side from the
   * user's own WorkspaceUserAuthToken - never writable by the client.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Discord User ID",
    required: false,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "Discord user ID captured from your connected Discord account. Populated automatically.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: true,
  })
  public discordUserId?: string = undefined;

  @ColumnAccessControl({
    /*
     * CurrentUser here does NOT mean the client may choose the value: the
     * service hook refuses any non-root payload that carries these columns
     * and then stamps them itself, and hooks run BEFORE the column
     * permission check (DatabaseService.create). The entry exists because
     * that same check runs on the STAMPED data - with an empty list the
     * server's own write is refused and no user can add this method at all.
     * Same shape as UserWebAuthn's server-stamped isVerified.
     */
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  /*
   * The person's Discord display name at the time the method was added. Only
   * a label for the row, but it is still their identity in an outside service,
   * so it stays owner-only like the Telegram handle.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Discord Username",
    required: false,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "Discord display name captured from your connected Discord account. Populated automatically.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: true,
  })
  public discordUserName?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "user",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "Relation to User who this Discord account belongs to",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
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
    description: "User ID who this Discord account belongs to",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  @Index()
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
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
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
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
    create: [],
    read: [],
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
    read: [],
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
    /*
     * CurrentUser here does NOT mean the client may choose the value: the
     * service hook refuses any non-root payload that carries these columns
     * and then stamps them itself, and hooks run BEFORE the column
     * permission check (DatabaseService.create). The entry exists because
     * that same check runs on the STAMPED data - with an empty list the
     * server's own write is refused and no user can add this method at all.
     * Same shape as UserWebAuthn's server-stamped isVerified.
     */
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    title: "Is Verified",
    description: "Is this Discord account verified?",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isVerified?: boolean = undefined;
}

export default UserDiscord;
