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
import OnCallDutyPolicy from './OnCallDutyPolicy';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';
import Incident from './Incident';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import UserNotificationEventType from 'Common/Types/UserNotification/UserNotificationEventType';
import OnCallDutyPolicyExecutionLog from './OnCallDutyPolicyExecutionLog';
import OnCallDutyPolicyEscalationRule from './OnCallDutyPolicyEscalationRule';
import Team from './Team';
import OnCallDutyPolicyExecutionLogTimeline from './OnCallDutyPolicyExecutionLogTimeline';

@EnableDocumentation()
@TenantColumn('projectId')
@TableAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    delete: [],
    update: [],
})
@CrudApiEndpoint(new Route('/user-notification-log'))
@Entity({
    name: 'UserNotificationLog',
})
@TableMetadata({
    tableName: 'UserNotificationLog',
    singularName: 'User Notification Log',
    pluralName: 'User Notification Logs',
    icon: IconProp.Logs,
    tableDescription: 'Log events for user notifications',
})
export default class UserNotificationLog extends BaseModel {
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
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userId?: ObjectID = undefined;

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
        manyToOneRelationColumn: 'onCallDutyPolicyId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicy,
        title: 'On Call Policy',
        description:
            'Relation to On Call Policy which belongs to this execution log event.',
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
        title: 'On Call Policy ID',
        description:
            'ID of your On Call Policy which belongs to this execution log event.',
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
        manyToOneRelationColumn: 'onCallDutyPolicyExecutionLogId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicyExecutionLog,
        title: 'On Call Policy Execution Log',
        description:
            'Relation to On Call Policy Execution Log which belongs to this execution log event.',
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
        title: 'On Call Policy Execution Log ID',
        description:
            'ID of your On Call Policy execution log which belongs to this log event.',
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
        manyToOneRelationColumn: 'onCallDutyPolicyEscalationRuleId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicyEscalationRule,
        title: 'On Call Policy Escalation Rule',
        description:
            'Relation to On Call Policy Escalation Rule which belongs to this execution log event.',
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
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnRelationQuery: true,
        title: 'On Call Policy Escalation Rule ID',
        description:
            'ID of your On Call Policy Escalation Rule which belongs to this log event.',
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
        manyToOneRelationColumn: 'triggeredByIncidentId',
        type: TableColumnType.Entity,
        modelType: Incident,
        title: 'Triggered By Incident',
        description:
            'Relation to Incident which triggered this on call duty policy.',
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
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Triggered By Incident ID',
        description:
            'ID of the incident which triggered this on call escalation policy.',
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
        required: true,
        type: TableColumnType.ShortText,
        title: 'Status',
        description: 'Status of this execution',
        canReadOnRelationQuery: false,
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
    @TableColumn({
        manyToOneRelationColumn: 'onCallDutyPolicyExecutionLogTimelineId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicyExecutionLogTimeline,
        title: 'On Call Policy Execution Log Timeline',
        description:
            'Relation to On Call Policy Execution Log Timeline where this timeline event belongs.',
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
        title: 'On Call Policy Execution Log ID',
        description:
            'ID of your On Call Policy Execution Log where this timeline event belongs.',
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
        title: 'Status Message',
        description: 'Status message of this execution',
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
        type: TableColumnType.ObjectID,
        title: 'Deleted by User ID',
        description:
            'User ID who deleted this object (if this object was deleted by a User)',
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
        manyToOneRelationColumn: 'acknowledgedByUserId',
        type: TableColumnType.Entity,
        title: 'Acknowledged by User',
        description:
            'Relation to User who acknowledged this policy execution (if this policy was acknowledged by a User)',
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
    @JoinColumn({ name: 'acknowledgedByUserId' })
    public acknowledgedByUser?: User = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Deleted by User ID',
        description:
            'User ID who acknowledged this object (if this object was acknowledged by a User)',
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
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public acknowledgedAt?: Date = undefined;
}
