import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
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
import Phone from "../../Types/Phone";
import Text from "../../Types/Text";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-incoming-call-number"))
@Entity({
  name: "UserIncomingCallNumber",
})
@TableMetadata({
  tableName: "UserIncomingCallNumber",
  singularName: "Phone Number for Incoming Call Routing",
  pluralName: "Phone Numbers for Incoming Call Routing",
  icon: IconProp.Call,
  tableDescription:
    "Phone Number which will be used for receiving routed incoming calls.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserIncomingCallNumber extends BaseModel {
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
  @TableColumn({
    title: "Phone",
    required: true,
    unique: false,
    type: TableColumnType.Phone,
    canReadOnRelationQuery: true,
    example: "+1-555-123-4567",
  })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    unique: false,
    nullable: false,
    transformer: Phone.getDatabaseTransformer(),
  })
  public phone?: Phone = undefined;

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
    description: "Relation to User who this phone number belongs to",
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
    description: "User ID who this phone number belongs to",
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
    description: "Is this phone number verified?",
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

export default UserIncomingCallNumber;
