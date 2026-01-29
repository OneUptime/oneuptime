import Label from "./Label";
import Monitor from "./Monitor";
import MonitorStatus from "./MonitorStatus";
import Project from "./Project";
import ScheduledMaintenanceState from "./ScheduledMaintenanceState";
import StatusPage from "./StatusPage";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import MultiTenentQueryAllowed from "../../Types/Database/MultiTenentQueryAllowed";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import Recurring from "../../Types/Events/Recurring";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";

@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@EnableDocumentation()
@AccessControlColumn("labels")
@MultiTenentQueryAllowed(true)
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateScheduledMaintenanceTemplate,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadScheduledMaintenanceTemplate,
    Permission.ReadAllProjectResources,
    ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteScheduledMaintenanceTemplate,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditScheduledMaintenanceTemplate,
  ],
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-template"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "ScheduledMaintenanceTemplate",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  singularName: "Scheduled Maintenance Template",
  pluralName: "Scheduled Maintenance Templates",
  icon: IconProp.Clock,
  tableName: "ScheduledMaintenanceTemplate",
  tableDescription: "Manage scheduled maintenance templates for your project",
})
export default class ScheduledMaintenanceTemplate extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of the Scheduled Maintenance Template",
    example: "Database Upgrade Template",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public templateName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Template Description",
    description: "Description of the Scheduled Maintenance Template",
    example:
      "Use this template for scheduled database upgrades and migrations. Includes pre-maintenance notifications, maintenance window updates, and post-maintenance completion notifications.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public templateDescription?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Title",
    description: "Title of this scheduled event.",
    example: "Scheduled Database Maintenance - PostgreSQL Upgrade",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Description",
    description:
      "Description of this scheduled event that will show up on Status Page. This is a markdown field.",
    example:
      "## Scheduled Maintenance\n\nWe will be performing a scheduled upgrade of our PostgreSQL database servers.\n\n**Start Time:** 2:00 AM UTC\n**Expected Duration:** 2 hours\n\n**Impact:** Brief service interruptions may occur during the maintenance window.\n\nThank you for your patience.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public description?: string = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
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
    example: "database-upgrade-template",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
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
    example: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description: "List of monitors attached to this event",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "ScheduledMaintenanceTemplateMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "scheduledMaintenanceTemplateId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined; // monitors affected by this scheduledMaintenance.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: StatusPage,
    title: "Status Pages",
    description: "List of status pages to show this event on",
  })
  @ManyToMany(
    () => {
      return StatusPage;
    },
    { eager: false },
  )
  @JoinTable({
    name: "ScheduledMaintenanceTemplateStatusPage",
    inverseJoinColumn: {
      name: "statusPageId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "scheduledMaintenanceTemplateId",
      referencedColumnName: "_id",
    },
  })
  public statusPages?: Array<StatusPage> = undefined; // visible on which status page?

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
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
    name: "ScheduledMaintenanceTemplateLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "scheduledMaintenanceTemplateId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "changeMonitorStatusToId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenanceState,
    title: "Change Monitor Status To",
    description:
      "Relation to Monitor Status Object. All monitors connected to this event will be changed to this status when the event is ongoing.",
  })
  @ManyToOne(
    () => {
      return MonitorStatus;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "changeMonitorStatusToId" })
  public changeMonitorStatusTo?: MonitorStatus = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Change Monitor Status To ID",
    description:
      "Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the event is ongoing.",
    example: "d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public changeMonitorStatusToId?: ObjectID = undefined;

  // RECURRING EVENT PROPS

  @TableColumn({
    title: "Schedule First Event At",
    type: TableColumnType.Date,
    required: false,
    description: "When would you like to schedule the first event?",
    example: "2024-03-15T02:00:00.000Z",
  })
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public firstEventScheduledAt?: Date = undefined;

  @TableColumn({
    title: "First Event Start At",
    type: TableColumnType.Date,
    required: false,
    description: "When does the first event start?",
    example: "2024-03-15T02:00:00.000Z",
  })
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public firstEventStartsAt?: Date = undefined;

  @TableColumn({
    title: "First Event Ends At",
    type: TableColumnType.Date,
    required: false,
    description: "When does the first event end?",
    example: "2024-03-15T04:00:00.000Z",
  })
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public firstEventEndsAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Recurring Interval",
    description: "How often should this event recur?",
    example: { intervalType: "weeks", intervalCount: 2 },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    transformer: Recurring.getDatabaseTransformer(),
  })
  public recurringInterval?: Recurring = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceNoteTemplate,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Boolean,
    title: "Is Recurring Event",
    description: "Is this a recurring event?",
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isRecurringEvent?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceNoteTemplate,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    type: TableColumnType.Date,
    title: "Schedule Next Event At",
    description: "When is the next event scheduled?",
    example: "2024-03-29T02:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public scheduleNextEventAt?: Date = undefined;

  // Recurring Props End.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceNoteTemplate,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified when event is created?",
    description: "Should subscribers be notified about this event creation?",
    defaultValue: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldStatusPageSubscribersBeNotifiedOnEventCreated?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceNoteTemplate,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified when event is changed to ongoing?",
    description:
      "Should subscribers be notified about this event event is changed to ongoing?",
    defaultValue: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceNoteTemplate,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified when event is changed to ended?",
    description:
      "Should subscribers be notified about this event event is changed to ended?",
    defaultValue: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Custom Fields",
    description: "Custom Fields on this resource.",
    example: {
      department: "DevOps",
      maintenanceType: "upgrade",
      approvalRequired: true,
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public customFields?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceTemplate,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    isDefaultValueColumn: false,
    title: "Subscriber notifications before the event",
    description: "Should subscribers be notified before the event?",
    example: [
      { intervalType: "hours", intervalCount: 24 },
      { intervalType: "hours", intervalCount: 1 },
    ],
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    transformer: Recurring.getDatabaseTransformer(),
  })
  public sendSubscriberNotificationsOnBeforeTheEvent?: Array<Recurring> =
    undefined;
}
