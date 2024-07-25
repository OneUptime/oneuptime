import Label from "./Label";
import MonitorStatus from "./MonitorStatus";
import Project from "./Project";
import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "Common/Types/Database/AccessControlColumn";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import EnableDocumentation from "Common/Types/Database/EnableDocumentation";
import EnableWorkflow from "Common/Types/Database/EnableWorkflow";
import SlugifyColumn from "Common/Types/Database/SlugifyColumn";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import TenantColumn from "Common/Types/Database/TenantColumn";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ServerMonitorResponse from "Common/Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
@AccessControlColumn("labels")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateProjectMonitor,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadProjectMonitor,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteProjectMonitor,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditProjectMonitor,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/monitor"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "Monitor",
})
@TableMetadata({
  tableName: "Monitor",
  singularName: "Monitor",
  pluralName: "Monitors",
  icon: IconProp.AltGlobe,
  tableDescription:
    "Monitor is anything that monitors your API, Websites, IP, Network or more. You can also create static monitor that does not monitor anything.",
})
export default class Monitor extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
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
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
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
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Any friendly name for this monitor",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @Index()
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    title: "Slug",
    description: "Friendly globally unique name for your object",
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
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
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
      onDelete: "CASCADE",
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
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
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
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
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
      onDelete: "CASCADE",
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
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
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
    name: "MonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.MonitorType,
    title: "Monitor Type",
    description: "What is the type of this monitor? Website? API? etc.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public monitorType?: MonitorType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "currentMonitorStatusId",
    type: TableColumnType.Entity,
    modelType: MonitorStatus,
    title: "Current Monitor Status",
    description: "Whats the current status of this monitor?",
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
  @JoinColumn({ name: "currentMonitorStatusId" })
  public currentMonitorStatus?: MonitorStatus = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Current Monitor Status ID",
    description: "Whats the current status ID of this monitor?",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public currentMonitorStatusId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Monitor Steps",
    description: "What would you like to monitor and what is the criteria?",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    transformer: MonitorSteps.getDatabaseTransformer(),
  })
  public monitorSteps?: MonitorSteps = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Monitoring Interval",
    description: "How often would you like OneUptime to monitor this resource?",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public monitoringInterval?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Custom Fields",
    description: "Custom Fields on this resource.",
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
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    title: "Are Owners Notified Of Resource Creation?",
    description: "Are owners notified of when this resource is created?",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOwnerNotifiedOfResourceCreation?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    title: "Disable Monitoring",
    description: "Disable active monitoring for this resource?",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public disableActiveMonitoring?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title: "Incoming Request Received At",
    description:
      "This field is for Incoming Request monitor only. When was the last time we received a request?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public incomingRequestReceivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    title: "Disable Monitoring because of Ongoing Scheduled Maintenance Event",
    description:
      "Disable Monitoring because of Ongoing Scheduled Maintenance Event",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public disableActiveMonitoringBecauseOfScheduledMaintenanceEvent?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    title: "Disable Monitoring because of Manual Incident",
    description:
      "Disable Monitoring because of Incident which is creeated manually by user.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public disableActiveMonitoringBecauseOfManualIncident?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title: "Server Monitor Request Received At",
    description:
      "This field is for Server Monitor only. When was the last time we received a request?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public serverMonitorRequestReceivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    isDefaultValueColumn: false,
    title: "Server Monitor Secret Key",
    description:
      "This field is for Server Monitor only. Secret Key to authenticate the request.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serverMonitorSecretKey?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    isDefaultValueColumn: false,
    title: "Incoming Request Secret Key",
    description:
      "This field is for Incoming Request Monitor only. Secret Key to authenticate the request.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingRequestSecretKey?: ObjectID = undefined;

  // this is for incoming request monitor.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Incoming Monitor Request",
    description: "Incoming Monitor Request for Incoming Request Monitor",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public incomingMonitorRequest?: IncomingMonitorRequest = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Server Monitor Response",
    description: "Server Monitor Response for Server Monitor",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public serverMonitorResponse?: ServerMonitorResponse = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "All Probes Disconnected From This Monitor",
    description:
      "All Probes Disconnected From This Monitor. Is this monitor not being monitored?",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public isAllProbesDisconnectedFromThisMonitor?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "No Probe Enabled On This Monitor",
    description:
      "No Probe Enabled On This Monitor. Is this monitor not being monitored?",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public isNoProbeEnabledOnThisMonitor?: boolean = undefined;
}
