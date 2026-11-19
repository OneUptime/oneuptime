import Host from "./Host";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import {
  HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
  HostLogSessionLevel,
  HostLogSessionStatus,
} from "../../Types/Host/HostLogSession";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A log session: every app's Logcat on one Android device for a while,
 * asked for in OneUptime and allowed by the person at the device (#9806,
 * Types/Host/HostLogSession). A row is asked for on the device's host,
 * and then moved on by the device - waiting for someone at it, starting,
 * collecting, then how it ended - through the Android agent's own route
 * (POST /telemetry/android-agent/v1/log-sessions, HostLogSessionService).
 * People ask for one and may cancel it; nothing else of it is theirs to
 * write.
 *
 * Asking reads every app's logs on a device, so it takes the right to
 * change the host, and every request and cancel is in the host's audit log:
 * who asked, and when.
 */

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ReadHost,
];

const requestPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.EditHost,
];

// Set when the session is asked for, never changed after.
const askedColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: requestPermissions,
  read: readPermissions,
  update: [],
};

// Written by OneUptime and the device only.
const deviceColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@CanAccessIfCanReadOn("host")
@TenantColumn("projectId")
@EnableAuditLog({
  create: true,
  update: true,
  delete: true,
  // Who asked for a device's logs, and when, is part of its host's history.
  rootResource: { resourceType: "Host", column: "hostId" },
})
@TableAccessControl({
  create: requestPermissions,
  read: readPermissions,
  // A person's only change is to cancel it (HostLogSessionService).
  update: requestPermissions,
  // Kept as the record of who read a device's logs; it goes with its host.
  delete: [],
})
@CrudApiEndpoint(new Route("/host-log-session"))
@TableMetadata({
  tableName: "HostLogSession",
  singularName: "Log Session",
  pluralName: "Log Sessions",
  icon: IconProp.Logs,
  tableDescription:
    "Every app's logs from an Android device for a while, for troubleshooting, allowed by the person at the device.",
  // The device moves a session on while people watch its list: the list follows.
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
@Entity({
  name: "HostLogSession",
})
@Index(["hostId", "status"])
export default class HostLogSession extends BaseModel {
  @ColumnAccessControl(askedColumnAccess)
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
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl(askedColumnAccess)
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

  @ColumnAccessControl(askedColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "hostId",
    type: TableColumnType.Entity,
    modelType: Host,
    title: "Host",
    description: "The Android device whose logs the session reads.",
  })
  @ManyToOne(
    () => {
      return Host;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "hostId" })
  public host?: Host = undefined;

  @ColumnAccessControl(askedColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Host ID",
    description: "ID of the Android device whose logs the session reads.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public hostId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    // Cancelled is the only status a person sets (HostLogSessionService).
    update: requestPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(HostLogSessionStatus),
    defaultValue: HostLogSessionStatus.Requested,
    isDefaultValueColumn: true,
    title: "Status",
    description:
      "Where the session is: Requested, AwaitingApproval, Starting, Collecting, Declined, Ended, Cancelled, Expired or Unavailable.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: HostLogSessionStatus.Requested,
  })
  public status?: HostLogSessionStatus = undefined;

  @ColumnAccessControl(askedColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    defaultValue: HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
    isDefaultValueColumn: true,
    title: "Duration",
    description:
      "How many minutes the device sends every app's logs for, once allowed: 15, 30, 60, 120 or 240.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: HOST_LOG_SESSION_DEFAULT_DURATION_MINUTES,
  })
  public durationMinutes?: number = undefined;

  @ColumnAccessControl(askedColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(HostLogSessionLevel),
    defaultValue: HostLogSessionLevel.Info,
    isDefaultValueColumn: true,
    title: "Lowest Level",
    description:
      "The lowest level the device sends: info, debug or verbose. Never quieter than info.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: HostLogSessionLevel.Info,
  })
  public minimumLevel?: HostLogSessionLevel = undefined;

  @ColumnAccessControl(deviceColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Expires At",
    description:
      "Until when someone at the device can allow the session. Nobody has by then, and it expires.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public expiresAt?: Date = undefined;

  @ColumnAccessControl(deviceColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Started At",
    description: "When it was allowed at the device, by the device's clock.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public startedAt?: Date = undefined;

  @ColumnAccessControl(deviceColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Ends At",
    description:
      "When the device stops sending every app's logs, by the device's clock.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public endsAt?: Date = undefined;

  @ColumnAccessControl(deviceColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Ended At",
    description:
      "When OneUptime learned the session was over: declined, ended, cancelled, expired or unavailable.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public endedAt?: Date = undefined;

  @ColumnAccessControl(deviceColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Status Message",
    description:
      "Why the session is where it is, in the agent's words or OneUptime's: why it was declined, ended or is unavailable.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl(deviceColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Requested by",
    description: "The person who asked for the session.",
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

  @ColumnAccessControl(deviceColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Requested by User ID",
    description: "ID of the person who asked for the session.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
