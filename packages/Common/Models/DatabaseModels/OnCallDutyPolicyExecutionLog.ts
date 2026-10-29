import Incident from "./Incident";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "./OnCallDutyPolicyEscalationRule";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import Permission from "../../Types/Permission";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import Alert from "./Alert";
import AlertEpisode from "./AlertEpisode";
import IncidentEpisode from "./IncidentEpisode";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";

/*
 * ONE PAGE: PEOPLE PAGED ABOUT AN INCIDENT, AN ALERT OR AN EPISODE, AND WHAT
 * CAME OF IT.
 *
 * Most pages are an on-call policy's run: the policy's escalation rules page
 * people in turn until somebody acknowledges. A page can also be direct -
 * people named one by one, a team's members, whoever is on call in a
 * schedule - with no policy behind it: a workflow's Page Users, Page a Team
 * and Page Whoever Is On Call steps start those (OnCallPageService). A
 * direct page has no onCallDutyPolicyId, and pages everybody it names once,
 * straight away; each person is reached through their own On-Call Rules
 * either way, and acknowledging the page acknowledges the record
 * (Types/OnCallDutyPolicy/OnCallDirectPage).
 */
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@EnableDocumentation()
@CanAccessIfCanReadOn("onCallDutyPolicy")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.CreateProjectOnCallDutyPolicyExecutionLog,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.OnCallViewer,
    Permission.ReadProjectOnCallDutyPolicyExecutionLog,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/on-call-duty-policy-execution-log"))
@OwnedThrough("onCallDutyPolicyId", OnCallDutyPolicy)
@Entity({
  name: "OnCallDutyPolicyExecutionLog",
})
/*
 * The runs whose acknowledgement timeout's clock is running
 * (acknowledgementTimeoutStartedAt): at most one for each record and policy
 * that pages again, so the index holds a handful, and the worker that pages
 * again reads them every minute (OnCallAcknowledgementTimeout).
 */
@Index(["acknowledgementTimeoutStartedAt"], {
  where:
    '"acknowledgementTimeoutStartedAt" IS NOT NULL AND "deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "OnCallDutyPolicyExecutionLog",
  singularName: "On-Call Duty Execution Log",
  pluralName: "On-Call Duty Execution Log",
  icon: IconProp.Call,
  tableDescription: "Logs for on-call duty policy execution.",
})
export default class OnCallDutyPolicyExecutionLog extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicy,
    title: "On-Call Policy",
    description:
      "Relation to On-Call Policy which belongs to this execution log event.",
    example: "e5f6a7b8-c9d0-1234-ef01-345678901234",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicy;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyId" })
  public onCallDutyPolicy?: OnCallDutyPolicy = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  /*
   * Empty for a direct page, which no on-call policy is behind. Not
   * `required`, so OneUptime's own create of one passes DatabaseService
   * .checkRequiredFields; every other create still has to name the policy
   * it runs (OnCallDutyPolicyExecutionLogService.onBeforeCreate).
   */
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "On-Call Policy ID",
    description:
      "ID of the On-Call Policy this execution log is a run of. Required when you create one. Empty for a direct page: people, a team or an on-call schedule paged without an on-call policy.",
    example: "e5f6a7b8-c9d0-1234-ef01-345678901234",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByIncidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Triggered By Incident",
    description:
      "Relation to Incident which triggered this on-call duty policy.",
    example: "f6a7b8c9-d0e1-2345-f012-456789012345",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "triggeredByIncidentId" })
  public triggeredByIncident?: Incident = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Triggered By Incident ID",
    required: false,
    description:
      "ID of the incident which triggered this on-call escalation policy.",
    example: "f6a7b8c9-d0e1-2345-f012-456789012345",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByIncidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByAlertId",
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Triggered By Alert",
    description: "Relation to Alert which triggered this on-call duty policy.",
    example: "a7b8c9d0-e1f2-3456-0123-567890123456",
  })
  @ManyToOne(
    () => {
      return Alert;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "triggeredByAlertId" })
  public triggeredByAlert?: Alert = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Triggered By Alert ID",
    required: false,
    description:
      "ID of the incident which triggered this on-call escalation policy.",
    example: "a7b8c9d0-e1f2-3456-0123-567890123456",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByAlertId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByAlertEpisodeId",
    type: TableColumnType.Entity,
    modelType: AlertEpisode,
    title: "Triggered By Alert Episode",
    description:
      "Relation to the alert episode which triggered this on-call escalation policy.",
  })
  @ManyToOne(
    () => {
      return AlertEpisode;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "triggeredByAlertEpisodeId" })
  public triggeredByAlertEpisode?: AlertEpisode = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Triggered By Alert Episode ID",
    description:
      "ID of the alert episode which triggered this on-call escalation policy.",
    example: "a7b8c9d0-e1f2-3456-0123-567890123456",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByAlertEpisodeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByIncidentEpisodeId",
    type: TableColumnType.Entity,
    modelType: IncidentEpisode,
    title: "Triggered By Incident Episode",
    description:
      "Relation to the incident episode which triggered this on-call escalation policy.",
  })
  @ManyToOne(
    () => {
      return IncidentEpisode;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "triggeredByIncidentEpisodeId" })
  public triggeredByIncidentEpisode?: IncidentEpisode = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Triggered By Incident Episode ID",
    description:
      "ID of the incident episode which triggered this on-call escalation policy.",
    example: "a7b8c9d0-e1f2-3456-0123-567890123456",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByIncidentEpisodeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Status of this execution",
    canReadOnRelationQuery: false,
    example: "Executing",
  })
  @Index()
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: OnCallDutyPolicyStatus = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Status Message",
    description: "Status message of this execution",
    canReadOnRelationQuery: false,
    example:
      "On-call policy execution started. Notifying primary on-call team members.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Notification Event Type",
    description: "Type of event that triggered this on-call duty policy.",
    canReadOnRelationQuery: false,
    example: "IncidentCreated",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public userNotificationEventType?: UserNotificationEventType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
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
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
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
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "acknowledgedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Acknowledged by User",
    description:
      "Relation to User who acknowledged this policy execution (if this policy was acknowledged by a User)",
    example: "c3d4e5f6-a7b8-9012-cdef-123456789012",
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
  @JoinColumn({ name: "acknowledgedByUserId" })
  public acknowledgedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Acknowledged by User ID",
    description:
      "User ID who acknowledged this object (if this object was acknowledged by a User)",
    example: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public acknowledgedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],

    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Acknowledged At",
    description: "When was this policy execution acknowledged?",
    example: "2024-01-15T10:45:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public acknowledgedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "acknowledgedByTeamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Acknowledged by Team",
    description:
      "Relation to Team who acknowledged this policy execution (if this policy was acknowledged by a Team)",
    example: "d4e5f6a7-b8c9-0123-def0-234567890123",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "acknowledgedByTeamId" })
  public acknowledgedByTeam?: Team = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Acknowledged by Team ID",
    description:
      "Team ID who acknowledged this object (if this object was acknowledged by a Team)",
    example: "d4e5f6a7-b8c9-0123-def0-234567890123",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public acknowledgedByTeamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Executed Escalation Rule Order",
    description: "Which escalation rule was executed?",
    canReadOnRelationQuery: true,
    example: 2,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public lastExecutedEscalationRuleOrder?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Escalation Rule Executed At",
    description: "When was the escalation rule executed?",
    canReadOnRelationQuery: true,
    example: "2024-01-15T10:30:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastEscalationRuleExecutedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "lastExecutedEscalationRuleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicyEscalationRule,
    title: "Last Executed Escalation Rule",
    description: "Relation to On-Call Policy Last Executed Escalation Rule.",
    example: "e5f6a7b8-c9d0-1234-ef01-345678901234",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicyEscalationRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "lastExecutedEscalationRuleId" })
  public lastExecutedEscalationRule?: OnCallDutyPolicyEscalationRule =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Last Executed Escalation Rule ID",
    description: "ID of your On-Call Policy Last Executed Escalation Rule.",
    example: "e5f6a7b8-c9d0-1234-ef01-345678901234",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public lastExecutedEscalationRuleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    canReadOnRelationQuery: true,
    title: "Execute next escalation rule in minutes",
    description:
      "How many minutes should we wait before executing the next escalation rule?",
    example: 15,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public executeNextEscalationRuleInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    isDefaultValueColumn: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy Execution Repeat Count",
    description: "How many times did we execute this on-call policy?",
    defaultValue: 1,
    example: 3,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public onCallPolicyExecutionRepeatCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    isDefaultValueColumn: true,
    title: "Schedule Gap Retry Count",
    description:
      "How many times the current escalation rule has been re-sampled because its target schedule(s) momentarily had no on-call user.",
    defaultValue: 0,
    example: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public scheduleGapRetryCount?: number = undefined;

  /*
   * When the run starts paging, for a run that waits to: one an on-call rule
   * held until its working hours (OnCallDutyPolicyRunWait). It is created
   * Waiting with the moment it is to start, and once the worker starts it,
   * this is the moment it did - so how long it has been starting is measured
   * from then (TimeoutStuckExecutions). Empty for a run that paged straight
   * away.
   *
   * No caller may write it: OneUptime holds a run (executePolicy) and starts
   * it (startWaitingRun).
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Paging Starts At",
    description:
      "When this run starts paging, when it waited to: an on-call rule that pages only during working hours held it until they began. Empty when it paged straight away.",
    canReadOnRelationQuery: false,
    example: "2024-01-15T09:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public pagingStartsAt?: Date = undefined;

  /*
   * Why a run that waited for working hours started paging before they
   * began: its record changed - raised to a higher severity, say - and now
   * matches an on-call rule that pages right away (WaitingRunsOnRecordChange).
   * "The alert now matches on-call rule "P1 alerts", which pages right
   * away." Its record's feed and its Slack and Microsoft Teams message say
   * so. Empty for every other run.
   *
   * No caller may write it: OneUptime starts the run (startWaitingRun).
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Paging Started Early Reason",
    description:
      "Why this run started paging before the working hours it waited for began: its record came to match an on-call rule that pages right away. Empty for every other run.",
    canReadOnRelationQuery: false,
    example:
      'The alert now matches on-call rule "P1 alerts", which pages right away.',
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public pagingStartedEarlyReason?: string = undefined;

  /*
   * For a run OneUptime AI held while it worked (OnCallPolicyAiHold): Holding
   * while it waits, then how the hold ended - Resolved by AI, Recovered on its
   * own, Handled by a person, Handed off, Hold time ran out or Page now
   * pressed. Empty for every other run.
   *
   * No caller may write it: OneUptime holds the run and ends the hold.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "OneUptime AI Hold",
    description:
      "For a run OneUptime AI held while it investigated and fixed: Holding while it waits, then how the hold ended - Resolved by AI, Recovered on its own, Handled by a person, Handed off, Hold time ran out or Page now pressed. Empty for every other run.",
    canReadOnRelationQuery: false,
    example: OnCallPolicyAiHoldOutcome.ResolvedByAI,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public aiHoldOutcome?: OnCallPolicyAiHoldOutcome = undefined;

  /*
   * The acknowledgement timeout's clock (OnCallAcknowledgementTimeout): set
   * on a policy's latest run for a record while the record is acknowledged
   * and the policy pages again after an acknowledgement - the moment the
   * record (or a page of this run) was last acknowledged. The worker that
   * pages again reads every run that has one, through the partial index
   * above, and clears it when it pages again or the clock stops. Empty for
   * every other run.
   *
   * No caller may write it: OneUptime starts and stops the clock.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Acknowledgement Timeout Started At",
    description:
      "When the acknowledgement timeout started counting for this run's record: its last acknowledgement. Empty when it is not counting.",
    canReadOnRelationQuery: false,
    example: "2024-01-15T09:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public acknowledgementTimeoutStartedAt?: Date = undefined;

  /*
   * A page again: this run pages again because its record stayed
   * acknowledged without being resolved (OnCallAcknowledgementTimeout).
   * Which time, from 1 - at most a few times for one record and policy.
   * Empty for every other run.
   *
   * No caller may write it: OneUptime starts a page again.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Page Again Number",
    description:
      "For a run that pages again because its record stayed acknowledged without being resolved: which time, from 1. Empty for every other run.",
    canReadOnRelationQuery: false,
    example: 1,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public pageAgainNumber?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Triggered by User",
    description: "Relation to User who triggered on-clal policy",
    example: "f6a7b8c9-d0e1-2345-f012-456789012345",
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
  @JoinColumn({ name: "triggeredByUserId" })
  public triggeredByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Triggered by User ID",
    description: "User ID who triggered this on-call policy",
    example: "f6a7b8c9-d0e1-2345-f012-456789012345",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByUserId?: ObjectID = undefined;

  /*
   * The workflow whose step started this page, and the name it had then:
   * a Page step, or a step that creates an execution log. Kept as the id
   * and the name rather than as a relation, as the audit log keeps them: the
   * page's feed, its Slack and Microsoft Teams message and the Dashboard say
   * "Workflow <name>" to people who may not read workflows, and long after
   * the workflow is renamed or deleted.
   *
   * No caller may write either: OneUptime stamps them once a create has
   * passed every check (OnCallDutyPolicyExecutionLogService
   * .onCreatePermitted).
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Triggered by Workflow ID",
    description:
      "ID of the workflow whose step started this page, when a workflow did.",
    example: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByWorkflowId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Triggered by Workflow Name",
    description:
      "Name of the workflow whose step started this page, as it was then.",
    example: "Page the on-call engineer for critical incidents",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public triggeredByWorkflowName?: string = undefined;
}
