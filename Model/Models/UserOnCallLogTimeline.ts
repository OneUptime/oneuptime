import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import User from './User';
import Project from './Project';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableColumn from 'Common/Types/Database/TableColumn';
import ColumnType from 'Common/Types/Database/ColumnType';
import ObjectID from 'Common/Types/ObjectID';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import EnableDocumentation from 'Common/Types/Model/EnableDocumentation';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import OnCallDutyPolicyExecutionLog from './OnCallDutyPolicyExecutionLog';
import Team from './Team';
import OnCallDutyPolicyEscalationRule from './OnCallDutyPolicyEscalationRule';
import Incident from './Incident';
import OnCallDutyPolicy from './OnCallDutyPolicy';
import UserOnCallLog from './UserOnCallLog';
import UserNotificationRule from './UserNotificationRule';
import UserNotificationEventType from 'Common/Types/UserNotification/UserNotificationEventType';
import UserNotificationStatus from 'Common/Types/UserNotification/UserNotificationStatus';
import OnCallDutyPolicyExecutionLogTimeline from './OnCallDutyPolicyExecutionLogTimeline';
import UserSMS from './UserSMS';
import UserEmail from './UserEmail';
import UserCall from './UserCall';
import TableBillingAccessControl from 'Common/Types/Database/AccessControl/TableBillingAccessControl';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';

@TableBillingAccessControl({
    create: PlanSelect.Growth,
    read: PlanSelect.Growth,
    update: PlanSelect.Growth,
    delete: PlanSelect.Growth,
})
@EnableDocumentation()
@TenantColumn('projectId')
@TableAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    delete: [],
    update: [],
})
@CrudApiEndpoint(new Route('/user-notification-log-timeline'))
@Entity({
    name: 'UserOnCallLogTimeline',
})
@TableMetadata({
    tableName: 'UserOnCallLogTimeline',
    singularName: 'User On-Call Log Timeline',
    pluralName: 'User  On-Call  Log Timelines',
    icon: IconProp.Logs,
    tableDescription: 'Timeline events for user on call log.',
})
export default class UserOnCallLogTimeline extends BaseModel {
    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userId',
        type: TableColumnType.Entity,
        modelType: User,
        title: 'User',
        description: 'Relation to User who this log belongs to',
    })
    @ManyToOne(
        (_type: string) => {
            return User;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userId' })
    public user?: User = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'User ID',
        description: 'User ID who this log belongs to',
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
        manyToOneRelationColumn: 'projectId',
        type: TableColumnType.Entity,
        modelType: Project,
        title: 'Project',
        description:
            'Relation to Project Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return Project;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'projectId' })
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
        title: 'Project ID',
        description:
            'ID of your OneUptime Project in which this object belongs',
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
        manyToOneRelationColumn: 'userNotificationLogId',
        type: TableColumnType.Entity,
        modelType: UserOnCallLog,
        title: 'User Notification Log',
        description:
            'Relation to User Notification Log Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserOnCallLog;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userNotificationLogId' })
    public userOnCallLog?: UserOnCallLog = undefined;

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
        title: 'User Notification Log ID',
        description:
            'ID of your OneUptime User Notification Log in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userNotificationLogId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userNotificationRuleId',
        type: TableColumnType.Entity,
        modelType: UserNotificationRule,
        title: 'User Notification Rule',
        description:
            'Relation to User Notification Rule Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserNotificationRule;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userNotificationRuleId' })
    public userNotificationRule?: UserNotificationRule = undefined;

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
        title: 'User Notification Rule ID',
        description:
            'ID of your OneUptime User Notification Rule in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userNotificationRuleId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'onCallDutyPolicyId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicy,
        title: 'OnCallDutyPolicy',
        description:
            'Relation to on call duty policy Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return OnCallDutyPolicy;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'onCallDutyPolicyId' })
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
        title: 'OnCallDutyPolicy ID',
        description:
            'ID of your OneUptime on call duty policy in which this object belongs',
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
        manyToOneRelationColumn: 'triggeredByIncidentId',
        type: TableColumnType.Entity,
        modelType: Incident,
        title: 'Incident',
        description:
            'Relation to Incident Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return Incident;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'triggeredByIncidentId' })
    public triggeredByIncident?: Incident = undefined;

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
        title: 'Incident ID',
        description:
            'ID of your OneUptime Incident in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public triggeredByIncidentId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'onCallDutyPolicyExecutionLogId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicyExecutionLog,
        title: 'On-Call Policy Execution Log',
        description:
            'Relation to On-Call Policy Execution Log where this timeline event belongs.',
    })
    @ManyToOne(
        (_type: string) => {
            return OnCallDutyPolicyExecutionLog;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'onCallDutyPolicyExecutionLogId' })
    public onCallDutyPolicyExecutionLog?: OnCallDutyPolicyExecutionLog = undefined;

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
        title: 'On-Call Policy Execution Log Timeline ID',
        description:
            'ID of your On-Call Policy Execution Log Timeline where this timeline event belongs.',
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
        manyToOneRelationColumn: 'onCallDutyPolicyExecutionLogTimelineId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicyExecutionLogTimeline,
        title: 'On-Call Policy Execution Log Timeline',
        description:
            'Relation to On-Call Policy Execution Log Timeline where this timeline event belongs.',
    })
    @ManyToOne(
        (_type: string) => {
            return OnCallDutyPolicyExecutionLogTimeline;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'onCallDutyPolicyExecutionLogTimelineId' })
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
        title: 'On-Call Policy Execution Log ID',
        description:
            'ID of your On-Call Policy Execution Log where this timeline event belongs.',
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
        manyToOneRelationColumn: 'onCallDutyPolicyEscalationRuleId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicyEscalationRule,
        title: 'On-Call Policy Escalation Rule',
        description:
            'Relation to On-Call Policy Escalation Rule where this timeline event belongs.',
    })
    @ManyToOne(
        (_type: string) => {
            return OnCallDutyPolicyEscalationRule;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'onCallDutyPolicyEscalationRuleId' })
    public onCallDutyPolicyEscalationRule?: OnCallDutyPolicyEscalationRule = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        title: 'Notification Event Type',
        description: 'Notification Event Type of this execution',
        canReadOnRelationQuery: false,
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
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnRelationQuery: true,
        title: 'On-Call Policy Escalation Rule ID',
        description:
            'ID of your On-Call Policy Escalation Rule where this timeline event belongs.',
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
        manyToOneRelationColumn: 'userBelongsToTeamId',
        type: TableColumnType.Entity,
        modelType: Team,
        title: 'Which team did the user belong to when the alert was sent?',
        description:
            'Which team did the user belong to when the alert was sent?',
    })
    @ManyToOne(
        (_type: string) => {
            return Team;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userBelongsToTeamId' })
    public userBelongsToTeam?: Team = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Which team did the user belong to when the alert was sent?',
        description:
            'Which team did the user belong to when the alert was sent?',
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
        required: true,
        type: TableColumnType.LongText,
        title: 'Status Message',
        description: 'Status message of this execution timeline event',
        canReadOnRelationQuery: false,
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
        required: true,
        type: TableColumnType.ShortText,
        title: 'Status',
        description: 'Status of this execution timeline event',
        canReadOnRelationQuery: false,
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public status?: UserNotificationStatus = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'createdByUserId',
        type: TableColumnType.Entity,
        modelType: User,
        title: 'Created by User',
        description:
            'Relation to User who created this object (if this object was created by a User)',
    })
    @ManyToOne(
        (_type: string) => {
            return User;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'createdByUserId' })
    public createdByUser?: User = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Created by User ID',
        description:
            'User ID who created this object (if this object was created by a User)',
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
        manyToOneRelationColumn: 'deletedByUserId',
        type: TableColumnType.Entity,
        title: 'Deleted by User',
        description:
            'Relation to User who deleted this object (if this object was deleted by a User)',
    })
    @ManyToOne(
        (_type: string) => {
            return User;
        },
        {
            cascade: false,
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'deletedByUserId' })
    public deletedByUser?: User = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        isDefaultValueColumn: false,
        required: false,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: true,
        unique: false,
    })
    public isAcknowledged?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        isDefaultValueColumn: false,
        required: false,
        type: TableColumnType.Date,
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public acknowledgedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userCallId',
        type: TableColumnType.Entity,
        modelType: UserCall,
        title: 'User Call',
        description:
            'Relation to User Call Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserCall;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userCallId' })
    public userCall?: UserCall = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'User Call ID',
        description: 'ID of User Call in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userCallId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userSmsId',
        type: TableColumnType.Entity,
        modelType: UserSMS,
        title: 'User SMS',
        description:
            'Relation to User SMS Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserSMS;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userSmsId' })
    public userSms?: UserSMS = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'User SMS ID',
        description: 'ID of User SMS in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userSmsId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'userEmailId',
        type: TableColumnType.Entity,
        modelType: UserEmail,
        title: 'User Email',
        description:
            'Relation to User Email Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return UserEmail;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userEmailId' })
    public userEmail?: UserEmail = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'User Email ID',
        description: 'ID of User Email in which this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userEmailId?: ObjectID = undefined;
}
