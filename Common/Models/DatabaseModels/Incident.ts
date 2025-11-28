import IncidentSeverity from "./IncidentSeverity";
import IncidentState from "./IncidentState";
import Label from "./Label";
import Monitor from "./Monitor";
import MonitorStatus from "./MonitorStatus";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import Probe from "./Probe";
import Project from "./Project";
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
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import { TelemetryQuery } from "../../Types/Telemetry/TelemetryQuery";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";

@EnableDocumentation()
@AccessControlColumn("labels")
@MultiTenentQueryAllowed(true)
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateProjectIncident,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadProjectIncident,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteProjectIncident,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditProjectIncident,
  ],
})
@CrudApiEndpoint(new Route("/incident"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "Incident",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "Incident",
  singularName: "Incident",
  pluralName: "Incidents",
  icon: IconProp.Alert,
  tableDescription: "Manage incidents for your project",
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
export default class Incident extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
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
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
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
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Title",
    description: "Title of this incident",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Description",
    description:
      "Short description of this incident. This is in markdown and will be visible on the status page.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Declared At",
    description: "Date and time when this incident was declared.",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    default: () => "now()",
  })
  public declaredAt?: Date = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
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
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
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
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
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
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description: "List of monitors affected by this incident",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined; // monitors affected by this incident.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "On-Call Duty Policies",
    description: "List of on-call duty policy affected by this incident.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined; // monitors affected by this incident.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
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
    name: "IncidentLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "currentIncidentStateId",
    type: TableColumnType.Entity,
    computed: true,
    modelType: IncidentState,
    title: "Current Incident State",
    description:
      "Current state of this incident. Is the incident acknowledged? or resolved?. This is related to Incident State",
  })
  @ManyToOne(
    () => {
      return IncidentState;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "currentIncidentStateId" })
  public currentIncidentState?: IncidentState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    isDefaultValueColumn: true,
    required: true,
    title: "Current Incident State ID",
    description: "Current Incident State ID",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public currentIncidentStateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Incident Severity",
    description:
      "How severe is this incident. Is it critical? or a minor incident?. This is related to Incident Severity.",
  })
  @ManyToOne(
    () => {
      return IncidentSeverity;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentSeverityId" })
  public incidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Incident Severity ID",
    description: "Incident Severity ID",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "changeMonitorStatusToId",
    type: TableColumnType.Entity,
    modelType: IncidentState,
    title: "Change Monitor Status To",
    description:
      "Relation to Monitor Status Object. All monitors connected to this incident will be changed to this status when the incident is created.",
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
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Change Monitor Status To ID",
    description:
      "Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the incident is created.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public changeMonitorStatusToId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.ShortText,
    title: "Subscriber Notification Status",
    description:
      "Status of notification sent to subscribers about this incident",
    defaultValue: StatusPageSubscriberNotificationStatus.Pending,
  })
  @Column({
    type: ColumnType.ShortText,
    default: StatusPageSubscriberNotificationStatus.Pending,
  })
  public subscriberNotificationStatusOnIncidentCreated?: StatusPageSubscriberNotificationStatus =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Notification Status Message",
    description:
      "Status message for subscriber notifications - includes success messages, failure reasons, or skip reasons",
    required: false,
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public subscriberNotificationStatusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified?",
    description: "Should subscribers be notified about this incident?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldStatusPageSubscribersBeNotifiedOnIncidentCreated?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    hideColumnInDocumentation: true,
    required: true,
    isDefaultValueColumn: true,
    title: "Are Owners Notified Of Resource Creation?",
    description: "Are owners notified of when this resource is created?",
    defaultValue: false,
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
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    isDefaultValueColumn: false,
    title: "Root Cause",
    description: "What is the root cause of this incident?",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public rootCause?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    isDefaultValueColumn: false,
    title: "Postmortem Note",
    description: "Document the postmortem summary for this incident.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public postmortemNote?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    unique: false,
  })
  public createdStateLog?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    isDefaultValueColumn: false,
    title: "Created Criteria ID",
    description:
      "If this incident was created by a Probe, this is the ID of the criteria that created it.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public createdCriteriaId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    isDefaultValueColumn: false,
    title: "Created Incident Template ID",
    description:
      "If this incident was created by a Probe, this is the ID of the incident template that was used for creation.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public createdIncidentTemplateId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByProbeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Created By Probe",
    description:
      "If this incident was created by a Probe, this is the probe that created it.",
  })
  @ManyToOne(
    () => {
      return Probe;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByProbeId" })
  public createdByProbe?: Probe = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Created By Probe ID",
    description:
      "If this incident was created by a Probe, this is the ID of the probe that created it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByProbeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is created automatically?",
    description:
      "Is this incident created by OneUptime Probe or Workers automatically (and not created manually by a user)?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isCreatedAutomatically?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Remediation Notes",
    description:
      "Notes on how to remediate this incident. This is in markdown.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public remediationNotes?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Telemetry Query",
    description: "Telemetry query for this incident",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public telemetryQuery?: TelemetryQuery = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.Number,
    title: "Incident Number",
    description: "Incident Number",
    computed: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public incidentNumber?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Post Updates To Workspace Channel Name",
    description: "Post Updates To Workspace Channel Name",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public postUpdatesToWorkspaceChannels?: Array<NotificationRuleWorkspaceChannel> =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should be visible on status page?",
    description: "Should this incident be visible on the status page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: true,
  })
  public isVisibleOnStatusPage?: boolean = undefined;
}
