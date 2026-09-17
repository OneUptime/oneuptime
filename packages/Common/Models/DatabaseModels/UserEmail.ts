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
import Email from "../../Types/Email";
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
 * applied for whoever holds it - and the raw email address and the
 * verification code become readable on every member's row in the project.
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
 */
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-email"))
@Entity({
  name: "UserEmail",
})
@TableMetadata({
  tableName: "UserEmail",
  singularName: "Email for Notifications",
  pluralName: "Emails for Notifications",
  icon: IconProp.Email,
  tableDescription: "Emails which will be used for notifications.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserEmail extends BaseModel {
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
    update: [],
  })
  /*
   * A personal email address, and a directly addressable delivery target. An
   * administrator auditing somebody's on-call setup needs to know THAT an email
   * method exists and whether it is verified; they do not need the address, and
   * handing it over turns a rules audit into a contact-details export.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Email",
    required: true,
    unique: false,
    type: TableColumnType.Email,
    canReadOnRelationQuery: true,
    example: "john.smith@example.com",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    unique: false,
    nullable: false,
    transformer: Email.getDatabaseTransformer(),
  })
  public email?: Email = undefined;

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
    description: "Relation to User who this email belongs to",
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
    description: "User ID who this email belongs to",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
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
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
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
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
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
    description: "Is this verified?",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isVerified?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  /*
   * A live verification code. Reading somebody else's is claiming their
   * notification channel, so this one is not a privacy question but an account
   * takeover one.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Verification Code",
    description:
      "Keyed digest of the temporary verification code — never the code itself",
    isDefaultValueColumn: true,
    computed: true,
    required: true,
    type: TableColumnType.ShortText,
    /*
     * A row is born with NO usable code on it: a 64-character random
     * placeholder that no six-digit code can ever hash to. The real code is
     * generated, hashed and sent by this channel's service once the row
     * exists — the row id is part of the hashed message, so the digest cannot
     * be computed before the insert has assigned one.
     *
     * This stays a forced default rather than moving wholly into the service
     * hook because the column is NOT NULL and must be satisfied on every
     * create path, including those that pass props.ignoreHooks.
     */
    forceGetDefaultValueOnCreate: () => {
      return Text.generateRandomText(64);
    },
    example: "9f2c1b4a7d3e6058c1f0a9b8d7e6f5c4b3a291807f6e5d4c3b2a19081726354",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public verificationCode?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  /*
   * When the code currently on this row stops being accepted.
   *
   * NULL means there is no live code: none was ever issued, or the last one
   * was used, or it was burned by the attempt limit — or the row predates
   * this column, which is read the same conservative way. Without an expiry
   * the six-digit code space stood open indefinitely, which is what made
   * walking it worthwhile.
   */
  @TableColumn({
    title: "Verification Code Expires At",
    description: "When the verification code on this row stops being accepted",
    computed: true,
    type: TableColumnType.Date,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public verificationCodeExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  /*
   * Wrong guesses made against the code currently on this row, reset to zero
   * each time a code is issued.
   *
   * This is the counter that stops /verify being an unlimited oracle over a
   * space small enough to walk in minutes. It is incremented with a single
   * atomic UPDATE ... RETURNING rather than a read-modify-write, because
   * requests racing each other are the normal shape of the attack.
   */
  @TableColumn({
    title: "Verification Failed Attempts",
    description:
      "Incorrect verification attempts made against the current verification code",
    computed: true,
    type: TableColumnType.Number,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public verificationFailedAttempts?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  /*
   * When a verification code was last sent for this row.
   *
   * Drives the resend cooldown. Without it, "spend the five attempts, ask for
   * a fresh code, repeat" costs an attacker nothing — and the resend control
   * doubles as a way to send somebody unsolicited messages at whatever rate
   * the network allows, at the project's expense.
   */
  @TableColumn({
    title: "Verification Code Sent At",
    description: "When a verification code was last sent for this row",
    computed: true,
    type: TableColumnType.Date,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public verificationCodeSentAt?: Date = undefined;
}

export default UserEmail;
