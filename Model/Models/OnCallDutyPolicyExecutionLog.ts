import Incident from './Incident';
import OnCallDutyPolicy from './OnCallDutyPolicy';
import OnCallDutyPolicyEscalationRule from './OnCallDutyPolicyEscalationRule';
import Project from './Project';
import Team from './Team';
import User from './User';
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import TableBillingAccessControl from 'Common/Types/Database/AccessControl/TableBillingAccessControl';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import ColumnType from 'Common/Types/Database/ColumnType';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import EnableDocumentation from 'Common/Types/Database/EnableDocumentation';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import OnCallDutyPolicyStatus from 'Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus';
import Permission from 'Common/Types/Permission';
import UserNotificationEventType from 'Common/Types/UserNotification/UserNotificationEventType';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

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
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ReadProjectOnCallDutyPolicyExecutionLog,
    ],
    delete: [],
    update: [],
})
@CrudApiEndpoint(new Route('/on-call-duty-policy-execution-log'))
@Entity({
    name: 'OnCallDutyPolicyExecutionLog',
})
@TableMetadata({
    tableName: 'OnCallDutyPolicyExecutionLog',
    singularName: 'On-Call Duty Execution Log',
    pluralName: 'On-Call Duty Execution Log',
    icon: IconProp.Call,
    tableDescription: 'Logs for on-call duty policy execution.',
})
export default class OnCallDutyPolicyExecutionLog extends BaseModel {
    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'onCallDutyPolicyId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicy,
        title: 'On-Call Policy',
        description:
            'Relation to On-Call Policy which belongs to this execution log event.',
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnRelationQuery: true,
        title: 'On-Call Policy ID',
        description:
            'ID of your On-Call Policy which belongs to this execution log event.',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public onCallDutyPolicyId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'triggeredByIncidentId',
        type: TableColumnType.Entity,
        modelType: Incident,
        title: 'Triggered By Incident',
        description:
            'Relation to Incident which triggered this on-call duty policy.',
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Triggered By Incident ID',
        description:
            'ID of the incident which triggered this on-call escalation policy.',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public triggeredByIncidentId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
    public status?: OnCallDutyPolicyStatus = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        title: 'Notification Event Type',
        description: 'Type of event that triggered this on-call duty policy.',
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'acknowledgedByUserId',
        type: TableColumnType.Entity,
        modelType: User,
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],

        update: [],
    })
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public acknowledgedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'acknowledgedByTeamId',
        type: TableColumnType.Entity,
        title: 'Acknowledged by Team',
        description:
            'Relation to Team who acknowledged this policy execution (if this policy was acknowledged by a Team)',
    })
    @ManyToOne(
        (_type: string) => {
            return Team;
        },
        {
            cascade: false,
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'acknowledgedByTeamId' })
    public acknowledgedByTeam?: Team = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Acknowledged by Team ID',
        description:
            'Team ID who acknowledged this object (if this object was acknowledged by a Team)',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public acknowledgedByTeamId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @Index()
    @TableColumn({
        required: false,
        type: TableColumnType.Number,
        title: 'Executed Escalation Rule Order',
        description: 'Which escalation rule was executed?',
        canReadOnRelationQuery: true,
    })
    @Column({
        nullable: true,
        type: ColumnType.Number,
    })
    public lastExecutedEscalationRuleOrder?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @Index()
    @TableColumn({
        required: false,
        type: TableColumnType.Date,
        title: 'Last Escalation Rule Executed At',
        description: 'When was the escalation rule executed?',
        canReadOnRelationQuery: true,
    })
    @Column({
        nullable: true,
        type: ColumnType.Date,
    })
    public lastEscalationRuleExecutedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLogTimeline,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'lastExecutedEscalationRuleId',
        type: TableColumnType.Entity,
        modelType: OnCallDutyPolicyEscalationRule,
        title: 'Last Executed Escalation Rule',
        description:
            'Relation to On-Call Policy Last Executed Escalation Rule.',
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
    @JoinColumn({ name: 'lastExecutedEscalationRuleId' })
    public lastExecutedEscalationRule?: OnCallDutyPolicyEscalationRule = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadProjectOnCallDutyPolicyExecutionLogTimeline,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        canReadOnRelationQuery: true,
        title: 'Last Executed Escalation Rule ID',
        description: 'ID of your On-Call Policy Last Executed Escalation Rule.',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public lastExecutedEscalationRuleId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.Number,
        required: false,
        canReadOnRelationQuery: true,
        title: 'Execute next escalation rule in minutes',
        description:
            'How many minutes should we wait before executing the next escalation rule?',
    })
    @Column({
        type: ColumnType.Number,
        nullable: true,
    })
    public executeNextEscalationRuleInMinutes?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.Number,
        required: true,
        isDefaultValueColumn: true,
        canReadOnRelationQuery: true,
        title: 'On-Call Policy Execution Repeat Count',
        description: 'How many times did we execute this on-call policy?',
    })
    @Column({
        type: ColumnType.Number,
        nullable: false,
        default: 1,
    })
    public onCallPolicyExecutionRepeatCount?: number = undefined;
}
