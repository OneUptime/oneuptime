import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "../../Types/Notification/OwnerNotificationDelivery";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE OWNER NOTIFICATION, TO ONE OWNER (issue #8199).
 *
 * An owner notification job - an incident or an alert created, its state
 * changed, a note posted, an owner added, a reminder that it is still open -
 * takes the record it is about so that no later run reads it again, then
 * tells each owner. Before the take, it writes a row here for every owner it
 * is about to tell; each owner is then told by the one run that moves their
 * row from Pending to Sending, and their row says Sent once the notification
 * was handed over (Types/Notification/OwnerNotificationDelivery). So:
 *
 *   - a worker stopped hard part way - an out-of-memory kill, a node lost -
 *     leaves the owners it had not reached yet Pending, and a later run of
 *     the job tells exactly them (OwnerNotificationDeliveries.resume);
 *   - nobody is told twice: an owner whose row left Pending is never told
 *     again, even when the run that took it stopped in the middle of their
 *     send - nobody can know whether it went out;
 *   - two workers that read the same record (a run that lost its lock) tell
 *     each owner once between them.
 *
 * One row per notification and owner: the notification is its kind, the
 * record whose notification it is (eventId) and which time it goes out
 * (occurrence: a reminder's number, 1 for every other kind). Written and
 * read only by OneUptime (OwnerNotificationDeliveryService): no client can
 * read or write a row, it has no API, and it goes with its project or its
 * user. Kept for a week (the service's retention), long after any run could
 * still be telling the owners.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "OwnerNotificationDelivery",
})
@TableMetadata({
  tableName: "OwnerNotificationDelivery",
  singularName: "Owner Notification Delivery",
  pluralName: "Owner Notification Deliveries",
  icon: IconProp.Notification,
  tableDescription:
    "Internal record of each owner an incident's or an alert's owner notification is to reach, and whether it reached them.",
})
// One row per notification and owner: what makes each owner told once.
@Index(["kind", "eventId", "occurrence", "userId"], { unique: true })
/*
 * The owners still to be told, for the read that tells those a stopped run
 * left (OwnerNotificationDeliveries.resume): the few being told at any
 * moment, so the index holds only them.
 */
@Index(["kind", "attemptedAt"], {
  where: `"status" = '${OwnerNotificationDeliveryStatus.Pending}'`,
})
export default class OwnerNotificationDelivery extends BaseModel {
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
    description: "The project of the incident or alert the owners are told of.",
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
    description:
      "ID of the project of the incident or alert the owners are told of.",
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
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(OwnerNotificationKind),
    title: "Kind",
    description:
      "Which notification: an incident or an alert created, its state changed, a note posted, an owner added, or a reminder.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: OwnerNotificationKind = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Resource ID",
    description: "ID of the incident or alert the owners are told of.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resourceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Event ID",
    description:
      "ID of the record whose notification it is: the incident or alert itself, its state change, the note, or the owner row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public eventId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Occurrence",
    description:
      "Which time the record's notification goes out: a reminder's number, and 1 for every other notification, which goes out once.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
  })
  public occurrence?: number = undefined;

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
    description: "The owner told.",
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
    description: "ID of the owner told.",
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
    type: TableColumnType.Boolean,
    required: true,
    title: "Is Project Owner",
    description:
      "Whether the owner was told as one of the project's owners, because the incident or alert had no owners of its own.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
  })
  public isProjectOwner?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(OwnerNotificationDeliveryStatus),
    title: "Status",
    description:
      "How far telling this owner got: to be told, being told, told, or not told.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: OwnerNotificationDeliveryStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Attempts",
    description:
      "How many runs of the job have set out to tell this owner: the one that wrote the row, and each that took it up after a run stopped.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
  })
  public attempts?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Attempted At",
    description: "When the last of those runs set out to tell this owner.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public attemptedAt?: Date = undefined;
}
