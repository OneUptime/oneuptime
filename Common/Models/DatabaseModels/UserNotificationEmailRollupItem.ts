import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import RollupCategory from "../../Types/NotificationSetting/NotificationEmailRollupCategory";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One row per rollup-eligible owner notification email, whether it went out
 * immediately or was deferred. The table does two jobs at once, and both are
 * worth naming because they pull the schema in slightly different directions.
 *
 * FIRST, IT IS THE FLUSH QUEUE. sentAt NULL means "pending": the notification
 * was written here INSTEAD of being mailed, because this address had already
 * received BURST_THRESHOLD emails in the same category inside the burst
 * window. A once-a-minute sweep collapses everything still pending for an
 * address - across every category - into one rollup email, stamps sentAt, and
 * records which batch claimed it. Nothing is ever suppressed; the only thing
 * that changes for a flooded recipient is that the 5th through Nth
 * notifications arrive in one message instead of N.
 *
 * SECOND, IT IS AN ACCOUNTING RECORD, and the first per-event-type,
 * per-recipient email-volume record the product has ever had. An immediate
 * send writes a row too, with sentAt set at insert time and rollupBatchId
 * left NULL - that is what makes the burst counter countable at all, and it
 * is also what lets somebody answer "which event type is actually flooding
 * this customer" without adding telemetry.
 *
 * WHAT IS DELIBERATELY NOT STORED: the envelope vars, the template type, and
 * any rendered body. A rollup line is eventType + subject + an optional deep
 * link. Storing envelopes would multiply row size roughly fiftyfold, add a
 * stale-template bug class the moment a template changes under a queued row,
 * and buy nothing a reader of the rollup email ever sees.
 *
 * ROOT ONLY. Every table access list is empty. This is a mail-delivery
 * ledger, not a user-facing resource, and a user who could delete their own
 * pending rows could make the sweep drop notifications on the floor. The CRUD
 * route exists only so the model is addressable like every other tenant
 * model - exactly as UserOnCallShiftReminderLog is - and every operation on
 * it is denied.
 *
 * Rows are hard-deleted after ROLLUP_ITEM_RETENTION_DAYS by the existing
 * HardDelete cron; see UserNotificationEmailRollupItemService.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/user-notification-email-rollup-item"))
@Entity({
  name: "UserNotificationEmailRollupItem",
})
@TableMetadata({
  tableName: "UserNotificationEmailRollupItem",
  singularName: "Notification Email Rollup Item",
  pluralName: "Notification Email Rollup Items",
  icon: IconProp.Email,
  tableDescription:
    "One owner notification email, recorded so bursts can be coalesced into a single rollup email.",
})
/*
 * The burst counter's index. Its leading four columns are exactly the bucket
 * key the write path counts over, and createdAt closes it so the ten-minute
 * window is answered from the index alone, on the hot notification path.
 */
@Index(["projectId", "userId", "toEmail", "rollupCategory", "createdAt"])
/*
 * The flush sweep's index: "pending, oldest first" across every tenant. The
 * sweep is global by design, so it cannot be scoped by projectId.
 */
@Index(["sentAt", "createdAt"])
/*
 * The read-back index. A flush stamps its claimed rows and then re-reads them
 * BY BATCH, so the replica renders exactly the rows it wrote and never a row
 * a concurrent flush stamped underneath it.
 */
@Index(["rollupBatchId"])
export default class UserNotificationEmailRollupItem extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
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
    create: [],
    read: [],
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
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "Relation to the User this notification was addressed to",
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
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the User this notification was addressed to",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  /*
   * The notification loop already sends one email per verified address a user
   * owns. Keying the bucket per address rather than per user preserves that
   * fan-out exactly, and sends the rollup back to the same address the
   * individual emails would have gone to.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Email,
    title: "To Email",
    description: "Email address this notification was addressed to",
    example: "jane@example.com",
  })
  @Column({
    type: ColumnType.Email,
    length: ColumnLength.Email,
    nullable: false,
    transformer: Email.getDatabaseTransformer(),
  })
  public toEmail?: Email = undefined;

  /*
   * LongText, NOT ShortText. NotificationSettingEventType's stored value is
   * the prose sentence, not the member name - the longest today is 92
   * characters, which leaves eight characters of headroom on a 100-character
   * column. DatabaseService.checkMaxLengthOfFields THROWS on overflow, and
   * the write path's catch is fail-open, so a ShortText column here would
   * mean the day somebody writes a slightly longer event description every
   * notification silently stops being recorded.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Event Type",
    description: "The notification setting event type this email was sent for",
    example:
      "Send incident created notification when I am the owner of the incident",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public eventType?: NotificationSettingEventType = undefined;

  /*
   * A stable machine code, never a display string, because it is persisted -
   * the same hazard NotificationSettingEventType already carries. The burst
   * counter is scoped by it, so a probe storm cannot defer the first incident
   * email.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Rollup Category",
    description: "Category this notification is counted and grouped under",
    example: "incidents",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public rollupCategory?: RollupCategory = undefined;

  /*
   * The producer's already-human-written envelope subject, truncated to the
   * column length in TypeScript before the insert. It is what a rollup line
   * reads as, so nothing here is re-worded: the rollup says exactly what the
   * individual emails would have said.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Subject",
    description: "Subject line of the notification email",
    example: "[Incident] Payments API is down",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public subject?: string = undefined;

  /*
   * The deep link back into the dashboard, lifted out of the envelope vars,
   * and also the key rows are folded on when the rollup is rendered - two
   * notifications about the same incident collapse into one line with a
   * count. VeryLongText (an unbounded text column) so no length check can
   * ever throw on a URL somebody made long.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "View Link",
    description: "Deep link to the resource this notification is about",
    example: "https://oneuptime.com/dashboard/incidents/1",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public viewLink?: string = undefined;

  /*
   * NULL means pending. Set at insert time for an immediate send, and by the
   * flush claim - before the send, never after - for a deferred one. Nullable
   * with no default is correct for every row that will ever exist, which is
   * why the table needs no data migration.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Sent At",
    description: "When this notification was sent; NULL while it is pending",
    example: "2024-01-15T17:00:02.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public sentAt?: Date = undefined;

  /*
   * The batch that claimed this row, and a bare ObjectID column ON PURPOSE:
   * no @ManyToOne, no foreign key. A CASCADE would delete queue items when
   * their batch is pruned at ROLLUP_BATCH_RETENTION_DAYS, destroying the
   * volume record the table exists to keep; a SET NULL would un-stamp them
   * and hand a month-old rollup back to the sweep as pending work. Neither
   * referential action is what we want, so there is no reference.
   *
   * It doubles as the accounting flag: NULL with sentAt set means the
   * notification was sent immediately.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Rollup Batch ID",
    description:
      "ID of the rollup batch that claimed this item; NULL if it was sent immediately",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public rollupBatchId?: ObjectID = undefined;
}
