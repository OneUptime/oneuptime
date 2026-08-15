import IncidentSeverity from "./IncidentSeverity";
import AlertSeverity from "./AlertSeverity";
import Project from "./Project";
import User from "./User";
import UserCall from "./UserCall";
import UserEmail from "./UserEmail";
import UserPush from "./UserPush";
import UserSMS from "./UserSMS";
import UserTelegram from "./UserTelegram";
import UserWebhook from "./UserWebhook";
import UserWhatsApp from "./UserWhatsApp";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
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
import NotificationRuleType from "../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who, other than the owner, may look at a member's paging configuration, and
 * who may repair it. Named once and spread everywhere so the table-level gate
 * and the per-column gates cannot drift apart - a column quietly narrower than
 * its table is how a required field becomes unwritable by the very permission
 * that was supposed to be able to write it.
 */
const ADMIN_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadProjectUserNotificationRule,
];

const ADMIN_WRITE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectUserNotificationRule,
];

/*
 * Two audiences, one table, and the difference between them is decided by which
 * permission let the caller through rather than by two different endpoints.
 *
 * Permission.CurrentUser stays first in every list and
 * @CurrentUserCanAccessRecordBy("userId") stays on the class, because together
 * they are what keeps an ordinary member scoped. TenantPermission
 * .isAccessGrantedOnlyByCurrentUser intersects what the caller holds with what
 * the model accepts: a plain member matches nothing here but the auto-granted
 * CurrentUser, so addCurrentUserScopeToQuery rewrites their query to
 * `userId = me` and rejects outright any attempt to name somebody else. Adding
 * the admin entries below does not weaken that - a member holds none of them,
 * so their intersection is unchanged.
 *
 * For a caller who DOES hold one of them the intersection is no longer
 * CurrentUser alone, the ownership predicate is not applied, and they can read
 * and repair another member's rules. TeamMember already carries exactly this
 * combination and behaves the same way, which is the reason to reuse the
 * mechanism here rather than invent a second one.
 *
 * That capability is the entire point of this table being reachable by an
 * administrator at all. An on-call policy can say "page the engineer on duty",
 * but whether that page arrives is decided by rows in THIS table, and until now
 * nobody but the engineer themselves could see them. A member with no matching
 * rule was silently unpageable, and the only person able to notice was the
 * person who was not being notified.
 *
 * ProjectOwner and ProjectAdmin are listed ALONGSIDE the granular permissions,
 * not instead of them, and that is load-bearing rather than belt-and-braces.
 * Existing project teams are seeded with ROLES only, so a brand-new granular
 * permission is held by literally nobody on the day it ships; a list containing
 * only EditProjectUserNotificationRule would leave the feature dead on arrival
 * for every project that already exists.
 *
 * Note the asymmetry with the seven notification-method models this rule points
 * at (UserEmail, UserSMS, UserCall, UserPush, UserWhatsApp, UserTelegram,
 * UserWebhook). There, only `read` is widened. An administrator may see which
 * methods a member has and repair the rules that route to them, but may never
 * create or edit a method on somebody else's behalf. Letting them would hand
 * any administrator a paging-hijack primitive - add a phone number or webhook
 * you control, point the victim's rules at it, and their pages arrive at your
 * device - and it would not even solve the problem it appears to solve, because
 * a member with no methods needs to verify a device THEY own. The lever for
 * that case is a reminder, not a keyboard.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
  read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
  delete: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
  update: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
})
@CrudApiEndpoint(new Route("/user-notification-rule"))
@Entity({
  name: "UserNotificationRule",
})
@TableMetadata({
  tableName: "UserNotificationRule",
  singularName: "Notification Rule",
  pluralName: "Notification Rules",
  icon: IconProp.Email,
  tableDescription: "Rules which will be used to send notifications.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserNotificationRule extends BaseModel {
  /*
   * Writable at create, readable by an administrator, and permanently frozen
   * afterwards - see the essay on `userId` below, which applies to this column
   * for the same reason. A rule that could be moved between projects would
   * escape the tenant scope it was created under.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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

  /*
   * update: [] - deliberately, and not merely inherited from the shape this
   * model had before administrators could touch it. See `userId`.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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

  /*
   * The rule type, together with the severity relations further down, is the
   * ADDRESS of this rule - the cell in the grid it occupies. Changing it would
   * silently move a rule from one cell to another, which reads as an edit but
   * behaves as a delete plus a create, so it stays create-only for everybody.
   * An administrator repairing a member's setup adds and removes rules; they do
   * not slide an existing one sideways.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    title: "Rule Type",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    example: "Send Notification When Incident Created",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: false,
  })
  public ruleType?: NotificationRuleType = undefined;

  /*
   * The relation spelling of the ownership column. It is `update: []` for the
   * same reason `userId` is, and it has to be stated separately because the two
   * are different decorated members over one physical column: an update
   * expressed as `user: { _id }` is resolved by TypeORM to the same join column
   * that `userId` writes. Closing one spelling and leaving the other open would
   * close nothing at all.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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

  /*
   * READ THIS BEFORE WIDENING `update` HERE.
   *
   * This column is the ownership column - the one @CurrentUserCanAccessRecordBy
   * points at, and therefore the one that decides whose pages this rule is
   * consulted for. It is writable at CREATE, because provisioning a rule on
   * behalf of a member who has none is the entire point of the administrator
   * capability; it is writable at UPDATE by nobody, including the
   * administrators who may otherwise rewrite every other field on the row.
   *
   * The temptation to mirror the widened lists onto this column is strong and
   * wrong. An administrator who can re-point an EXISTING rule's userId does not
   * gain a convenience, they gain a paging hijack: take a rule that already
   * points at their own verified phone, move its userId to a colleague, and the
   * colleague's pages now ring the administrator's handset - or take the
   * colleague's rule and hand it to themselves. Nothing about that is
   * distinguishable from a legitimate edit at the row level, and it is exactly
   * the hole the create-side ownership gate was written to close
   * (Common/Server/Types/Database/Permissions/CreatePermission.ts), reopened
   * through a different verb.
   *
   * Create is safe by comparison only because it is guarded: the create gate
   * defers to a real role permission rather than stamping the caller, and the
   * service layer verifies that the supplied userId is a member of
   * props.tenantId before the row is written. A rule pointed at a stranger from
   * another project is refused there, not here.
   *
   * The correct way for an administrator to move a rule to a different member is
   * to delete it and create another. That leaves two audit events instead of a
   * silent mutation, which is the behaviour we want.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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

  /*
   * Read is widened but create is not, because this column is stamped
   * server-side from props.userId after the permission checks have run and is
   * never accepted from a request body. Widening the read matters for a reason
   * beyond completeness: it is what lets a member see that a rule on their own
   * account was written by an administrator rather than by themselves.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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

  /*
   * THE SEVEN METHOD RELATIONS BELOW ARE THE MOST DANGEROUS COLUMNS ON THIS
   * MODEL. What follows applies to every one of them - userCall, userPush,
   * userSms, userWhatsApp, userTelegram, userWebhook and userEmail, in both
   * their relation and their `*Id` spelling - and is written out once here
   * rather than fourteen times.
   *
   * A rule is a pair: the ownership column decides WHOSE pages select the row,
   * and the method relation decides WHERE those pages are delivered. The two
   * halves are read from different tables and nothing in the schema requires
   * them to agree. A row owned by a victim and pointing at an administrator's
   * own webhook or email is perfectly well-formed, and it silently redirects the
   * victim's pages to the administrator's device. That is the whole hijack, and
   * it needs no other bug to work.
   *
   * The `*Id` columns are open to UPDATE because repairing a member's routing is
   * the capability this phase exists to provide: "your rules point at an email
   * you never verified" is only actionable if somebody can re-point them at one
   * the member did verify. But THIS ACCESS CONTROL LIST IS NOT WHAT MAKES THAT
   * SAFE. A column list answers "may this caller write this column at all"; it
   * never sees the VALUE being written, so it cannot tell a repair from a
   * redirect.
   *
   * What makes it safe is a service-layer assertion: whenever one of these FKs
   * is written, on create or on update, the referenced method row must belong to
   * the same user as the rule's own userId - and on update that userId is
   * re-read from the database rather than taken from the request body, because
   * the body is exactly what an attacker controls. DO NOT REMOVE THAT ASSERTION
   * BELIEVING THIS DECORATOR COVERS IT. It does not, and the failure is silent:
   * everything keeps working, pages just start arriving somewhere else.
   *
   * The relation spellings stay `update: []` while the `*Id` spellings open.
   * That is not an oversight. They are two decorated members over one physical
   * join column, so leaving both writable would give the same hijack two
   * different shapes to arrive in, and the ownership assertion would have to
   * recognise both to be complete. One spelling in, one spelling out, and the
   * check has exactly one form to validate.
   */
  /*
   * READ IS OWNER-ONLY ON THE RELATION, EVEN THOUGH THIS TABLE IS ADMIN-READABLE.
   *
   * Widening the relation would re-open the exposure that reverting the seven
   * method models was meant to close, by a different route. A read of this
   * table is NOT pinned to the caller's own rows for an administrator - that is
   * the whole point of the phase - and QueryPermission.checkRelationQueryPermission
   * authorises each nested field with relatedModel.hasReadPermissions, a
   * name-intersection in which Permission.CurrentUser is auto-granted to every
   * authenticated caller. So `select: { userCall: { phone: true } }` on somebody
   * else's rule would hand back their raw phone number with no row scope
   * anywhere in the path.
   *
   * The FK below stays admin-readable: an id is not sensitive, and it is what
   * correlates a rule with the masked entry in OnCallReadinessService's
   * ReadinessMethod { methodId, methodType, maskedIdentifier, isVerified }.
   * That masked payload is the administrator's sanctioned view of a method.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userCallId",
    type: TableColumnType.Entity,
    modelType: UserCall,
    title: "User Call",
    description: "Relation to User Call Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return UserCall;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userCallId" })
  public userCall?: UserCall = undefined;

  // Re-pointable by an administrator. Read the essay above `userCall` first.
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User Call ID",
    description: "ID of User Call in which this object belongs",
    example: "9e8d7c6b-5a4f-3e2d-1c0b-9a8f7e6d5c4b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userCallId?: ObjectID = undefined;

  /*
   * READ IS OWNER-ONLY ON THE RELATION, EVEN THOUGH THIS TABLE IS ADMIN-READABLE.
   *
   * Widening the relation would re-open the exposure that reverting the seven
   * method models was meant to close, by a different route. A read of this
   * table is NOT pinned to the caller's own rows for an administrator - that is
   * the whole point of the phase - and QueryPermission.checkRelationQueryPermission
   * authorises each nested field with relatedModel.hasReadPermissions, a
   * name-intersection in which Permission.CurrentUser is auto-granted to every
   * authenticated caller. So `select: { userPush: { deviceToken: true } }` on somebody
   * else's rule would hand back their raw device token with no row scope
   * anywhere in the path.
   *
   * The FK below stays admin-readable: an id is not sensitive, and it is what
   * correlates a rule with the masked entry in OnCallReadinessService's
   * ReadinessMethod { methodId, methodType, maskedIdentifier, isVerified }.
   * That masked payload is the administrator's sanctioned view of a method.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userPushId",
    type: TableColumnType.Entity,
    modelType: UserPush,
    title: "User Push",
    description: "Relation to User Push Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return UserPush;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userPushId" })
  public userPush?: UserPush = undefined;

  // Re-pointable by an administrator. Read the essay above `userCall` first.
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User Push ID",
    description: "ID of User Push in which this object belongs",
    example: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userPushId?: ObjectID = undefined;

  /*
   * READ IS OWNER-ONLY ON THE RELATION, EVEN THOUGH THIS TABLE IS ADMIN-READABLE.
   *
   * Widening the relation would re-open the exposure that reverting the seven
   * method models was meant to close, by a different route. A read of this
   * table is NOT pinned to the caller's own rows for an administrator - that is
   * the whole point of the phase - and QueryPermission.checkRelationQueryPermission
   * authorises each nested field with relatedModel.hasReadPermissions, a
   * name-intersection in which Permission.CurrentUser is auto-granted to every
   * authenticated caller. So `select: { userSms: { phone: true } }` on somebody
   * else's rule would hand back their raw phone number with no row scope
   * anywhere in the path.
   *
   * The FK below stays admin-readable: an id is not sensitive, and it is what
   * correlates a rule with the masked entry in OnCallReadinessService's
   * ReadinessMethod { methodId, methodType, maskedIdentifier, isVerified }.
   * That masked payload is the administrator's sanctioned view of a method.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userSmsId",
    type: TableColumnType.Entity,
    modelType: UserSMS,
    title: "User SMS",
    description: "Relation to User SMS Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return UserSMS;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userSmsId" })
  public userSms?: UserSMS = undefined;

  // Re-pointable by an administrator. Read the essay above `userCall` first.
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User SMS ID",
    description: "ID of User SMS in which this object belongs",
    example: "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userSmsId?: ObjectID = undefined;

  /*
   * READ IS OWNER-ONLY ON THE RELATION, EVEN THOUGH THIS TABLE IS ADMIN-READABLE.
   *
   * Widening the relation would re-open the exposure that reverting the seven
   * method models was meant to close, by a different route. A read of this
   * table is NOT pinned to the caller's own rows for an administrator - that is
   * the whole point of the phase - and QueryPermission.checkRelationQueryPermission
   * authorises each nested field with relatedModel.hasReadPermissions, a
   * name-intersection in which Permission.CurrentUser is auto-granted to every
   * authenticated caller. So `select: { userWhatsApp: { phone: true } }` on somebody
   * else's rule would hand back their raw phone number with no row scope
   * anywhere in the path.
   *
   * The FK below stays admin-readable: an id is not sensitive, and it is what
   * correlates a rule with the masked entry in OnCallReadinessService's
   * ReadinessMethod { methodId, methodType, maskedIdentifier, isVerified }.
   * That masked payload is the administrator's sanctioned view of a method.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userWhatsAppId",
    type: TableColumnType.Entity,
    modelType: UserWhatsApp,
    title: "User WhatsApp",
    description:
      "Relation to User WhatsApp Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return UserWhatsApp;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userWhatsAppId" })
  public userWhatsApp?: UserWhatsApp = undefined;

  // Re-pointable by an administrator. Read the essay above `userCall` first.
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User WhatsApp ID",
    description: "ID of User WhatsApp in which this object belongs",
    example: "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userWhatsAppId?: ObjectID = undefined;

  /*
   * READ IS OWNER-ONLY ON THE RELATION, EVEN THOUGH THIS TABLE IS ADMIN-READABLE.
   *
   * Widening the relation would re-open the exposure that reverting the seven
   * method models was meant to close, by a different route. A read of this
   * table is NOT pinned to the caller's own rows for an administrator - that is
   * the whole point of the phase - and QueryPermission.checkRelationQueryPermission
   * authorises each nested field with relatedModel.hasReadPermissions, a
   * name-intersection in which Permission.CurrentUser is auto-granted to every
   * authenticated caller. So `select: { userTelegram: { telegramChatId: true } }` on somebody
   * else's rule would hand back their raw Telegram chat id with no row scope
   * anywhere in the path.
   *
   * The FK below stays admin-readable: an id is not sensitive, and it is what
   * correlates a rule with the masked entry in OnCallReadinessService's
   * ReadinessMethod { methodId, methodType, maskedIdentifier, isVerified }.
   * That masked payload is the administrator's sanctioned view of a method.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userTelegramId",
    type: TableColumnType.Entity,
    modelType: UserTelegram,
    title: "User Telegram",
    description:
      "Relation to User Telegram Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return UserTelegram;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userTelegramId" })
  public userTelegram?: UserTelegram = undefined;

  // Re-pointable by an administrator. Read the essay above `userCall` first.
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User Telegram ID",
    description: "ID of User Telegram in which this object belongs",
    example: "8f7e6d5c-4b3a-2f1e-0d9c-8b7a6f5e4d3c",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userTelegramId?: ObjectID = undefined;

  /*
   * READ IS OWNER-ONLY ON THE RELATION, EVEN THOUGH THIS TABLE IS ADMIN-READABLE.
   *
   * Widening the relation would re-open the exposure that reverting the seven
   * method models was meant to close, by a different route. A read of this
   * table is NOT pinned to the caller's own rows for an administrator - that is
   * the whole point of the phase - and QueryPermission.checkRelationQueryPermission
   * authorises each nested field with relatedModel.hasReadPermissions, a
   * name-intersection in which Permission.CurrentUser is auto-granted to every
   * authenticated caller. So `select: { userWebhook: { webhookUrl: true } }` on somebody
   * else's rule would hand back their raw webhook URL with no row scope
   * anywhere in the path.
   *
   * The FK below stays admin-readable: an id is not sensitive, and it is what
   * correlates a rule with the masked entry in OnCallReadinessService's
   * ReadinessMethod { methodId, methodType, maskedIdentifier, isVerified }.
   * That masked payload is the administrator's sanctioned view of a method.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userWebhookId",
    type: TableColumnType.Entity,
    modelType: UserWebhook,
    title: "User Webhook",
    description:
      "Relation to User Webhook Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return UserWebhook;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userWebhookId" })
  public userWebhook?: UserWebhook = undefined;

  // Re-pointable by an administrator. Read the essay above `userCall` first.
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User Webhook ID",
    description: "ID of User Webhook in which this object belongs",
    example: "9e8d7c6b-5a4f-3e2d-1c0b-9a8f7e6d5c4b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userWebhookId?: ObjectID = undefined;

  /*
   * READ IS OWNER-ONLY ON THE RELATION, EVEN THOUGH THIS TABLE IS ADMIN-READABLE.
   *
   * Widening the relation would re-open the exposure that reverting the seven
   * method models was meant to close, by a different route. A read of this
   * table is NOT pinned to the caller's own rows for an administrator - that is
   * the whole point of the phase - and QueryPermission.checkRelationQueryPermission
   * authorises each nested field with relatedModel.hasReadPermissions, a
   * name-intersection in which Permission.CurrentUser is auto-granted to every
   * authenticated caller. So `select: { userEmail: { email: true } }` on somebody
   * else's rule would hand back their raw email address with no row scope
   * anywhere in the path.
   *
   * The FK below stays admin-readable: an id is not sensitive, and it is what
   * correlates a rule with the masked entry in OnCallReadinessService's
   * ReadinessMethod { methodId, methodType, maskedIdentifier, isVerified }.
   * That masked payload is the administrator's sanctioned view of a method.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userEmailId",
    type: TableColumnType.Entity,
    modelType: UserEmail,
    title: "User Email",
    description: "Relation to User Email Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return UserEmail;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userEmailId" })
  public userEmail?: UserEmail = undefined;

  // Re-pointable by an administrator. Read the essay above `userCall` first.
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User Email ID",
    description: "ID of User Email in which this object belongs",
    example: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userEmailId?: ObjectID = undefined;

  /*
   * The escalation delay, and one of only two plain preference columns an
   * administrator may rewrite. It is here rather than frozen because "you are
   * on the escalation policy but your first rule waits thirty minutes" is a
   * real, common misconfiguration, and correcting a number carries none of the
   * redirect risk the method relations do - the page still goes to the same
   * place, it just goes sooner.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    isDefaultValueColumn: true,
    canReadOnRelationQuery: true,
    title: "Notify After Minutes",
    description:
      "How long should we wait before sending a notification to the user after the event has occurred?",
    example: 5,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public notifyAfterMinutes?: number = undefined;

  /*
   * Part of the rule's address, like `ruleType` - create-only for everybody.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Incident Severity",
    description:
      "Relation to Incident Severity Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return IncidentSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentSeverityId" })
  public incidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Incident Severity ID",
    description: "ID of Incident Severity in which this object belongs",
    example: "5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentSeverityId?: ObjectID = undefined;

  // alert severity.

  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertSeverityId",
    type: TableColumnType.Entity,
    modelType: AlertSeverity,
    title: "Alert Severity",
    description:
      "Relation to Alert Severity Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return AlertSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertSeverityId" })
  public alertSeverity?: AlertSeverity = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Alert Severity ID",
    description: "ID of Alert Severity in which this object belongs",
    example: "6f7a8b9c-0d1e-2f3a-4b5c-6d7e8f9a0b1c",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertSeverityId?: ObjectID = undefined;

  /*
   * An opt-out row is a rule that exists in order to send nothing. It carries a
   * `ruleType` and a severity exactly like a normal rule, sets `isOptOut` to true, and
   * holds NO notification-method relation at all — there is no userEmail, userSms,
   * userCall, userPush, userWhatsApp, userTelegram or userWebhook on it, and that
   * absence is the point rather than a misconfiguration.
   *
   * It exists because "this user has zero rules matching this ruleType and severity" is
   * otherwise two completely different situations wearing the same clothes. Almost
   * always it means the user never configured anything for that cell — a severity added
   * after they joined, an episode rule type they never opened the page for — and a page
   * routed to them must still land somewhere. Occasionally it means the user genuinely
   * asked not to be woken for that cell, and paging them anyway would be the bug.
   *
   * Before this column the runtime could not tell those apart, so it chose the safe-
   * looking option and delivered nothing, which is how pages were being lost silently.
   * Making deliberate silence expressible as a row is the precondition for the fallback:
   * once "do not page me" has somewhere to live, the remaining zero-row cases can be
   * treated as misconfiguration and rescued by notifying the user on whatever verified
   * method they do have.
   *
   * Note the `update` permission below. Every column on this model except
   * `notifyAfterMinutes` is `update: []`, so copying a neighbour's access control would
   * have left this flag writable only at create time — a user could opt out but never
   * opt back in without deleting and recreating the row. Muting and unmuting is exactly
   * the kind of preference that gets toggled, so it is explicitly updatable by its owner.
   *
   * An administrator may toggle it too, and that deserves a word because it looks
   * like the one place where the admin capability could be used to silence somebody.
   * It could - but an administrator who wanted a colleague unpageable has a far
   * blunter tool available in the same breath, which is to delete their rules
   * outright, and that is a capability nobody proposes withholding. The reason
   * this direction matters more is the opposite one: a member who opted out of a
   * severity months ago and forgot is precisely the invisible gap this phase
   * exists to close, and leaving an administrator able to SEE the opt-out but not
   * lift it would stop one step short of the fix. Both directions are audited
   * against props.userId, so a suppression an administrator made is attributable.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [Permission.CurrentUser, ...ADMIN_WRITE_PERMISSIONS],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    isDefaultValueColumn: true,
    title: "Opt Out of Notifications",
    description:
      "When true, this rule deliberately suppresses notifications for its rule type and severity instead of delivering any. A rule with this set carries no notification method.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public isOptOut?: boolean = undefined;
}

export default UserNotificationRule;
