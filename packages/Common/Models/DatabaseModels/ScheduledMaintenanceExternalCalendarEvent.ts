import Project from "./Project";
import ScheduledMaintenanceExternalCalendar from "./ScheduledMaintenanceExternalCalendar";
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
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One event of a calendar from outside the project, as OneUptime last read
 * it (ScheduledMaintenanceExternalCalendar): a repeating event is stored once
 * for each time it happens in the window, its times worked out in its own
 * time zone. The scheduled maintenance calendar reads them for the period it
 * shows and draws them beside the project's own events.
 *
 * Written by the Workers alone - every read of a calendar replaces its events
 * in one transaction (ScheduledMaintenanceExternalCalendarEventService) - so
 * create, update and delete are [] for everyone, and a calendar's deletion
 * takes its events with it (ON DELETE CASCADE). Read like the project's own
 * events: whoever may read scheduled maintenance may read these. Never part
 * of the project's own calendar links.
 *
 * An event with no title, or one its calendar marks private, has an empty
 * title; the calendar says "Busy" for it in the reader's language.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.ScheduledMaintenanceViewer,
  Permission.ReadProjectScheduledMaintenance,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-external-calendar-event"))
@Entity({
  name: "ScheduledMaintenanceExternalCalendarEvent",
})
@TableMetadata({
  tableName: "ScheduledMaintenanceExternalCalendarEvent",
  singularName: "Scheduled Maintenance External Calendar Event",
  pluralName: "Scheduled Maintenance External Calendar Events",
  icon: IconProp.Calendar,
  tableDescription:
    "The events of a calendar from outside the project, as OneUptime last read it, for the scheduled maintenance calendar to draw. Read-only.",
})
@Index(["scheduledMaintenanceExternalCalendarId", "startsAt"])
export default class ScheduledMaintenanceExternalCalendarEvent extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
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
    read: readPermissions,
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceExternalCalendarId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenanceExternalCalendar,
    title: "External Calendar",
    description: "The calendar this event was read from",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenanceExternalCalendar;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenanceExternalCalendarId" })
  public scheduledMaintenanceExternalCalendar?: ScheduledMaintenanceExternalCalendar =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "External Calendar ID",
    description: "ID of the calendar this event was read from",
    example: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceExternalCalendarId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Title",
    description:
      "The event's title (its SUMMARY). Empty for an event with none, or one its calendar marks private.",
    example: "Christmas Day",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Starts At",
    description:
      "When the event starts. For an all-day event, midnight UTC of its first day.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public startsAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Ends At",
    description:
      "When the event ends. For an all-day event, midnight UTC of the day after its last day.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public endsAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    defaultValue: false,
    title: "Is All Day",
    description:
      "True for an event of whole days, such as a public holiday: it falls on the same dates in every time zone.",
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isAllDay?: boolean = undefined;
}
