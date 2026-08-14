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
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Text from "../../Types/Text";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * `read` names Permission.CurrentUser and nothing else. That single entry is
 * what makes every column below owner-only, and it has to stay that way.
 *
 * CurrentUser is auto-granted to every authenticated caller, so on a COLUMN
 * list it does not mean "on my own row" - column permissions are intersected
 * by NAME and never see the query at all. The row scope lives HERE:
 * TenantPermission.isAccessGrantedOnlyByCurrentUser is true exactly while this
 * table list holds nothing but CurrentUser, and that is what stamps
 * `userId = me` onto every read and refuses one that names somebody else. Add
 * a single administrator permission to this list and the stamp stops being
 * applied for whoever holds it - and the raw handle, the chat id a bot message
 * can be addressed to, and the verification code that turns possession of that
 * chat id into a verified method all become readable on every member's row in
 * the project.
 *
 * That is not hypothetical. It shipped once, and the column-level guard
 * written to contain it was walked past by nested relation selects, by `query`
 * filters it never inspected, and by the sort columns that are appended to the
 * select after it had already run. Each fix produced the next defect, because
 * this model was never designed to be read across users.
 *
 * An administrator who needs to know whether a colleague can be paged does not
 * read this table. OnCallReadinessService answers that question as root and
 * returns ReadinessMethod { methodId, methodType, maskedIdentifier,
 * isVerified } - masked server-side by the one code path that holds the raw
 * value - and the admin readiness surface already consumes it. The id is a
 * foreign key rather than a secret: it lets an administrator POINT A RULE AT a
 * method without reading the method's row, which is the thing the widening was
 * actually reaching for. Point the next admin surface there. Widening this
 * list is not a cheaper version of that; it is the version that leaks.
 *
 * One path does not pass through this list at all, and it is the reason
 * `canReadOnRelationQuery: true` below is worth reading twice: a nested
 * relation select made FROM a model whose own read is admin-wide - today
 * UserNotificationRule - is checked by
 * QueryPermission.checkRelationQueryPermission, which skips the column check
 * outright when that flag is true and never consults this table list. The
 * columns carrying the flag are reachable that way. Narrowing them is a change
 * to the rule tables that select them through the relation, not a change that
 * can be made here alone.
 */
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-telegram"))
@Entity({
  name: "UserTelegram",
})
@TableMetadata({
  tableName: "UserTelegram",
  singularName: "Telegram Account",
  pluralName: "Telegram Accounts",
  icon: IconProp.Telegram,
  tableDescription: "Telegram accounts used for Telegram notifications.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserTelegram extends BaseModel {
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
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  /*
   * The person's Telegram identity outside this product. It is how they are
   * found and messaged by anyone at all, not just by OneUptime, so it is a
   * personal contact detail rather than a label for a row.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Telegram Handle",
    required: false,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "Optional Telegram username / handle (e.g. @alice) for your own reference.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: true,
  })
  public telegramUserHandle?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  /*
   * The chat the bot delivers into. Holding it is enough to send messages to
   * that chat through the same bot, so it is a delivery target and not a label.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Telegram Chat ID",
    required: false,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "Telegram chat ID captured from the OneUptime bot after verification. Populated automatically.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: true,
  })
  public telegramChatId?: string = undefined;

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
    description: "Relation to User who this Telegram account belongs to",
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
    description: "User ID who this Telegram account belongs to",
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    title: "Is Verified",
    description: "Is this Telegram account verified?",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isVerified?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  /*
   * A live verification code. Reading somebody else's is claiming their
   * notification channel.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Verification Code",
    description:
      "Temporary Verification Code. The user sends /start <code> to the OneUptime bot to verify.",
    isDefaultValueColumn: true,
    computed: true,
    required: true,
    type: TableColumnType.ShortText,
    forceGetDefaultValueOnCreate: () => {
      return Text.generateRandomNumber(6);
    },
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public verificationCode?: string = undefined;
}

export default UserTelegram;
