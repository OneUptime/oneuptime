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
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * What a batch row records about one flush attempt.
 *
 *   Claimed - the insert won the epoch and the send has not finished yet.
 *   Sent    - the rollup email was handed to the mailer and awaited.
 *   Empty   - the claim won but nothing was still pending by the time the
 *             rows were read back; another replica had already taken them.
 *   Skipped - the bucket was deliberately not sent (its project or user had
 *             gone away, say), and the claim is kept so the epoch stays used.
 *   Failed  - the send threw. statusMessage carries why.
 */
export enum RollupBatchStatus {
  Claimed = "Claimed",
  Sent = "Sent",
  Empty = "Empty",
  Skipped = "Skipped",
  Failed = "Failed",
}

/*
 * One row per flush attempt, and the exactly-once mechanism of the whole
 * rollup feature.
 *
 * THE UNIQUE INDEX IS THE MECHANISM. Not the Redis semaphore around the
 * sweep, and not the "is it still pending?" predicate on the stamping update:
 * DatabaseService resolves an update's predicate in a separate read and then
 * issues one update per matched row, so a conditional update here would be a
 * check-then-act race rather than a compare-and-swap. The UNIQUE index over
 * (projectId, userId, toEmail, claimEpochStartsAt) is genuinely atomic in
 * Postgres. Two replicas that both decide the same address is due at the same
 * instant both try to insert, exactly one wins, and the loser recognises
 * 23505 and stands down. The semaphore is an optimisation layered on top of
 * this; if Redis is down, this is still correct.
 *
 * WHICH MAKES claimEpochStartsAt LOAD-BEARING, and it is derived from the
 * WALL CLOCK ONLY - floor(now / CLAIM_EPOCH_MINUTES) - never from the data
 * being flushed. That is the entire reason the index works: two replicas
 * computing it at any instant inside the same epoch necessarily get the same
 * value, so they necessarily collide. Derive it from, say, the oldest pending
 * item's createdAt and two replicas reading slightly different row sets would
 * compute different keys and both send.
 *
 * And because CLAIM_EPOCH_MINUTES equals FLUSH_AFTER_MINUTES, a legitimate
 * consecutive flush of the same bucket always lands in a later epoch, so the
 * index never blocks real work - it only ever blocks a duplicate.
 *
 * ROOT ONLY, for the same reason the item table is: a user who could delete
 * their own claim rows could re-send a rollup, and one who could insert one
 * could stop the next one being sent. The CRUD route exists only so the model
 * is addressable like every other tenant model; every operation is denied.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/user-notification-email-rollup-batch"))
@Entity({
  name: "UserNotificationEmailRollupBatch",
})
@TableMetadata({
  tableName: "UserNotificationEmailRollupBatch",
  singularName: "Notification Email Rollup Batch",
  pluralName: "Notification Email Rollup Batches",
  icon: IconProp.Layers,
  tableDescription:
    "One rollup email send attempt, claimed under a unique index so an address gets at most one rollup per epoch.",
})
@Index(["projectId", "userId", "toEmail", "claimEpochStartsAt"], {
  unique: true,
})
export default class UserNotificationEmailRollupBatch extends BaseModel {
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
    description: "Relation to the User this rollup email was addressed to",
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
    description: "ID of the User this rollup email was addressed to",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
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
    required: true,
    type: TableColumnType.Email,
    title: "To Email",
    description: "Email address this rollup was sent to",
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
   * floor(now / CLAIM_EPOCH_MINUTES), from the wall clock and nothing else.
   * The fourth column of the unique index and the reason it is a real mutual
   * exclusion rather than a hopeful one.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Claim Epoch Starts At",
    description:
      "Start of the wall-clock epoch this claim belongs to; part of the unique claim key",
    example: "2024-01-15T17:05:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public claimEpochStartsAt?: Date = undefined;

  /*
   * When the claim was actually inserted, as opposed to which epoch it
   * belongs to. Diagnostics only: the gap between the two says how late in
   * its epoch a sweep got to this bucket.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Claimed At",
    description: "When a worker claimed this rollup for sending",
    example: "2024-01-15T17:05:03.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public claimedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Sent At",
    description:
      "When the rollup email was sent; NULL while claimed, and for a claim that never sent",
    example: "2024-01-15T17:05:04.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public sentAt?: Date = undefined;

  /*
   * How many notifications this one email replaced. This is the number the
   * feature is judged on, and the only place it is ever written down.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Item Count",
    description: "How many notifications this single rollup email replaced",
    example: 17,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public itemCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Claimed, Sent, Empty, Skipped or Failed",
    example: "Sent",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public status?: RollupBatchStatus = undefined;

  /*
   * Truncated error text. For a rollup that was claimed and then dropped this
   * is the only record of why, so it is worth the column even though nothing
   * reads it in the product.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Status Message",
    description: "Why this rollup ended in the status it did, if not Sent",
    example: "SMTP connection refused",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public statusMessage?: string = undefined;
}
