import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
} from "../../Types/Runbook/RunbookSchedule";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@OperationalResource()
@EnableDocumentation()
@AccessControlColumn("labels")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateRunbook,
    Permission.ProjectMember,
    Permission.RunbookAdmin,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.RunbookAdmin,
    Permission.RunbookMember,
    Permission.RunbookViewer,
    Permission.ReadRunbook,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteRunbook,
    Permission.ProjectMember,
    Permission.RunbookAdmin,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditRunbook,
    Permission.RunbookAdmin,
  ],
})
@CrudApiEndpoint(new Route("/runbook"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "Runbook",
})
@TableMetadata({
  tableName: "Runbook",
  singularName: "Runbook",
  pluralName: "Runbooks",
  icon: IconProp.BookOpen,
  tableDescription:
    "Reusable response procedures (manual checklists or scripts) that can be attached to incidents, alerts, or scheduled maintenance.",
})
export default class Runbook extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "Database failover runbook",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example:
      "Steps the on-call responder should follow when the primary database is unreachable.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Is this runbook enabled?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Steps",
    description:
      "Ordered list of steps to run for this runbook. Each step is one of Manual, JavaScript, HTTP request, Bash or AI.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public steps?: JSONArray = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  /*
   * THE RUNBOOK'S TRIGGERS: a schedule and a webhook URL, set on its
   * Triggers page (Types/Runbook/RunbookSchedule, RunbookWebhook).
   *
   * Turning either on, or changing the schedule, lets the runbook run with
   * nobody there, so it takes permission to run the runbook as well as to
   * edit it: RunbookService refuses a write to these columns from a caller
   * who may not start a run of this runbook (RunbookTriggerAccess). A
   * runbook turned off (isEnabled) runs neither.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Run on Schedule",
    description:
      "Whether the runbook runs on its schedule (Schedule Cron, read in Schedule Time Zone). Turning it on takes permission to run the runbook as well as to edit it.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isScheduleEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Schedule Cron",
    description:
      "When the runbook runs on its schedule: a five-field cron expression (minute, hour, day of month, month, day of week), read on the wall clock of Schedule Time Zone. Runbooks run at most once a minute.",
    example: "0 9 * * 1-5",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public scheduleCron?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Schedule Time Zone",
    description:
      "The IANA time zone the schedule is read in, such as Europe/London or America/New_York. A 09:00 schedule runs at 09:00 there all year, also after the clocks change for daylight saving time. Left out, it is UTC.",
    example: "Europe/London",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public scheduleTimezone?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "If a Run Is Still Going",
    description:
      'What a scheduled time does while a run of the runbook is still queued, running or waiting for someone: "Skip" (the default) starts nothing for that time, "RunAfter" starts one run as soon as the current run ends.',
    example: "Skip",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public scheduleOverlapPolicy?: RunbookScheduleOverlapPolicy = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Missed Scheduled Runs",
    description:
      'What happens to scheduled times OneUptime could not start a run at, because it was down: "RunOnce" (the default) starts one run when it is back, "Skip" starts none.',
    example: "RunOnce",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public scheduleMissedRunPolicy?: RunbookScheduleMissedRunPolicy = undefined;

  /*
   * The scheduler's own: when the schedule's next run is due, worked out on
   * every change to the schedule and moved on by the Worker that starts the
   * run (RunbookScheduler), which claims each due time with a
   * compare-and-set on this column so two Workers never start it twice.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Next Scheduled Run At",
    description:
      "When the runbook's schedule starts its next run. Worked out by OneUptime; empty while the schedule is off.",
  })
  @Index()
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public scheduleNextRunAt?: Date = undefined;

  // The scheduler's own: the scheduled time a run is waiting for the current one to end for.
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Waiting Scheduled Run",
    description:
      'The scheduled time a run is waiting for the current run to end for, when "If a Run Is Still Going" is "RunAfter". Set and cleared by OneUptime.',
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public scheduleQueuedRunAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbook,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbook,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbook,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Run from Webhook",
    description:
      "Whether a POST request to the runbook's webhook URL starts a run. The URL holds a secret key OneUptime generates when this is first turned on, shown on the runbook's Triggers page to people who may edit and run the runbook. Turning it on takes permission to run the runbook as well as to edit it.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isWebhookEnabled?: boolean = undefined;

  /*
   * The secret part of the webhook URL. Never read or written through the
   * API's runbook routes - not even by those who may see it: the Triggers
   * page reads and resets it through the runbook service's own routes
   * (App/FeatureSet/Runbook/API/RunbookWebhook), which ask that the caller
   * may both change the runbook's triggers and run it. Generated on the
   * server (32 random bytes) the first time the webhook is turned on, and
   * compared in constant time on every call.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Webhook Secret Key",
    description:
      "The secret part of the runbook's webhook URL. Not readable through the API; the runbook's Triggers page shows it to people who may edit and run the runbook.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public webhookSecretKey?: string = undefined;
}
