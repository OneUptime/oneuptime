import Incident from "./Incident";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "./OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "./OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "./OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "./OnCallDutyPolicySchedule";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../Types/UserNotification/UserNotificationExecutionStatus";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import AlertEpisode from "./AlertEpisode";
import IncidentEpisode from "./IncidentEpisode";
import Alert from "./Alert";

@EnableDocumentation()
@TenantColumn("projectId")
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TableAccessControl({
  create: [],
  read: [Permission.CurrentUser],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/user-notification-log"))
@Entity({
  name: "UserOnCallLog",
})
@TableMetadata({
  tableName: "UserOnCallLog",
  singularName: "User Notification Log",
  pluralName: "User Notification Logs",
  icon: IconProp.Logs,
  tableDescription: "Log events for user notifications",
})
export default class UserOnCallLog extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "Relation to User who this log belongs to",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description: "User ID who this log belongs to",
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
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userBelongsToTeamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Which team did the user belong to when the alert was sent?",
    description: "Which team did the user belong to when the alert was sent?",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userBelongsToTeamId" })
  public userBelongsToTeam?: Team = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Which team did the user belong to when the alert was sent?",
    description: "Which team did the user belong to when the alert was sent?",
    example: "8d0e1f2a-3b4c-5d6e-7f8a-9b0c1d2e3f4a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userBelongsToTeamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
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
    read: [Permission.CurrentUser],
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
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicy,
    title: "On-Call Policy",
    description:
      "Relation to On-Call Policy which belongs to this execution log event.",
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy ID",
    description:
      "ID of your On-Call Policy which belongs to this execution log event.",
    example: "9e1f2a3b-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyExecutionLogId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicyExecutionLog,
    title: "On-Call Policy Execution Log",
    description:
      "Relation to On-Call Policy Execution Log which belongs to this execution log event.",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicyExecutionLog;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyExecutionLogId" })
  public onCallDutyPolicyExecutionLog?: OnCallDutyPolicyExecutionLog =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy Execution Log ID",
    description:
      "ID of your On-Call Policy execution log which belongs to this log event.",
    example: "0f1a2b3c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyExecutionLogId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyEscalationRuleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicyEscalationRule,
    title: "On-Call Policy Escalation Rule",
    description:
      "Relation to On-Call Policy Escalation Rule which belongs to this execution log event.",
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
  @JoinColumn({ name: "onCallDutyPolicyEscalationRuleId" })
  public onCallDutyPolicyEscalationRule?: OnCallDutyPolicyEscalationRule =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy Escalation Rule ID",
    description:
      "ID of your On-Call Policy Escalation Rule which belongs to this log event.",
    example: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyEscalationRuleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByIncidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Triggered By Incident",
    description:
      "Relation to Incident which triggered this on-call duty policy.",
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Triggered By Incident ID",
    required: false,
    description:
      "ID of the incident which triggered this on-call escalation policy.",
    example: "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByIncidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByAlertId",
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Triggered By Alert",
    description: "Relation to Alert which triggered this on-call duty policy.",
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Triggered By Alert ID",
    required: false,
    description:
      "ID of the Alert which triggered this on-call escalation policy.",
    example: "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByAlertId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByAlertEpisodeId",
    type: TableColumnType.Entity,
    modelType: AlertEpisode,
    title: "Triggered By Alert Episode",
    description:
      "Relation to Alert Episode which triggered this on-call duty policy.",
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Triggered By Alert Episode ID",
    required: false,
    description:
      "ID of the Alert Episode which triggered this on-call escalation policy.",
    example: "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByAlertEpisodeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "triggeredByIncidentEpisodeId",
    type: TableColumnType.Entity,
    modelType: IncidentEpisode,
    title: "Triggered By Incident Episode",
    description:
      "Relation to Incident Episode which triggered this on-call duty policy.",
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Triggered By Incident Episode ID",
    required: false,
    description:
      "ID of the Incident Episode which triggered this on-call escalation policy.",
    example: "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByIncidentEpisodeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Status of this execution",
    canReadOnRelationQuery: false,
    example: "Success",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: UserNotificationExecutionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Notification Event Type",
    description: "Notification Event Type of this execution",
    canReadOnRelationQuery: false,
    example: "Incident Created",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public userNotificationEventType?: UserNotificationEventType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyExecutionLogTimelineId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicyExecutionLogTimeline,
    title: "On-Call Policy Execution Log Timeline",
    description:
      "Relation to On-Call Policy Execution Log Timeline where this timeline event belongs.",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicyExecutionLogTimeline;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyExecutionLogTimelineId" })
  public onCallDutyPolicyExecutionLogTimeline?: OnCallDutyPolicyExecutionLogTimeline =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy Execution Log ID",
    description:
      "ID of your On-Call Policy Execution Log where this timeline event belongs.",
    example: "4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyExecutionLogTimelineId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Status Message",
    description: "Status message of this execution",
    canReadOnRelationQuery: false,
    example: "Notification sent successfully via email to user",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
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
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "acknowledgedByUserId",
    type: TableColumnType.Entity,
    title: "Acknowledged by User",
    description:
      "Relation to User who acknowledged this policy execution (if this policy was acknowledged by a User)",
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
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Acknowledged by User ID",
    description:
      "User ID who acknowledged this object (if this object was acknowledged by a User)",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public acknowledgedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],

    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    example: "2024-01-15T10:30:00Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public acknowledgedAt?: Date = undefined;

  /**
   *
   * In the format of {
   *  [notificationRuleId]: DateOfExecution,
   * }
   */

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    example: {
      "rule-1": "2024-01-15T10:30:00Z",
      "rule-2": "2024-01-15T10:35:00Z",
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    unique: false,
  })
  public executedNotificationRules?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyScheduleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicySchedule,
    title: "On Call Schedule",
    description:
      "Which schedule did the user belong to when the alert was sent?",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicySchedule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyScheduleId" })
  public onCallDutySchedule?: OnCallDutyPolicySchedule = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "On Call Schedule ID",
    description:
      "Which schedule ID did the user belong to when the alert was sent?",
    example: "5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyScheduleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "overridedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Overridden by User",
    description: "Relation to User who overrode this alert",
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
  @JoinColumn({ name: "overridedByUserId" })
  public overridedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Overridden by User ID",
    description: "User ID who overrode this alert",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public overridedByUserId?: ObjectID = undefined;
}
