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
 * applied for whoever holds it - and the webhook URL and its signing secret,
 * both bearer credentials that let whoever holds them impersonate OneUptime to
 * the member's endpoint, become readable on every member's row in the project.
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
 * One path does not pass through this list at all: a nested relation select
 * made FROM a model whose own read is admin-wide - today UserNotificationRule -
 * is checked by QueryPermission.checkRelationQueryPermission, which skips the
 * column check outright for a column marked `canReadOnRelationQuery: true` and
 * never consults this table list. Neither credential is: the webhook URL and
 * its signing secret both carry `false`, and are kept encrypted at rest, so a
 * rule table names the webhook a rule points at by its `name` alone.
 */
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-webhook"))
@Entity({
  name: "UserWebhook",
})
@TableMetadata({
  tableName: "UserWebhook",
  singularName: "Webhook",
  pluralName: "Webhooks",
  icon: IconProp.Webhook,
  tableDescription:
    "Webhook URLs used for outbound HTTP notifications to your own services.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserWebhook extends BaseModel {
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
  @TableColumn({
    title: "Name",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description: "Label for this webhook (e.g. 'My Slack', 'Internal alerts').",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  /*
   * A webhook URL is a bearer credential in its own right. Slack, Discord and
   * Teams hooks all carry their secret in the path, so anyone who can read this
   * string can post into the channel it belongs to. Its owner reads it - the
   * Webhooks table shows it, and the Edit dialog edits it - and it is kept
   * encrypted at rest (`encrypted: true`): DatabaseService encrypts it on
   * every write and decrypts it on every read, a notification rule's read of
   * its webhook through the userWebhook relation included, so every page is
   * posted to the address as it was typed. The EncryptWebhookAddresses data
   * migration encrypts the addresses stored before. Text, as a ciphertext is
   * longer than the address.
   *
   * Never read through a relation by a request (EncryptedColumnsStayOffRelations):
   * a rule table says which webhook a rule points at by the webhook's name
   * (NotificationMethodUtil), and the readiness view by its masked name
   * (OnCallReadinessService).
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Webhook URL",
    required: true,
    unique: false,
    encrypted: true,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    description:
      "HTTPS endpoint that will receive POST requests with notification payloads. Kept encrypted at rest.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    unique: false,
    nullable: false,
  })
  public webhookUrl?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  /*
   * The HMAC signing key. Reading it is forging requests. Its owner still
   * reads it - the Edit dialog shows it, and clearing it there stops the
   * signing - and it is kept encrypted at rest (`encrypted: true`):
   * DatabaseService encrypts it on every write and decrypts it on every
   * read, a notification rule's read of its webhook through the userWebhook
   * relation included, so every request is signed with the secret as it
   * was typed. The EncryptProjectCredentials data migration encrypts the
   * secrets stored before. Text, as a ciphertext is longer than the secret.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    secret: true,
    encrypted: true,
    title: "Signing Secret",
    required: false,
    unique: false,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    description:
      "Optional shared secret used to compute an HMAC-SHA256 signature for each request (sent in X-OneUptime-Signature). Kept encrypted at rest.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    unique: false,
    nullable: true,
  })
  public secret?: string = undefined;

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
    description: "Relation to User who this Webhook belongs to",
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
    description: "User ID who this Webhook belongs to",
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
}

export default UserWebhook;
