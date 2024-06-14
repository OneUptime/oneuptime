import IncidentSeverity from './IncidentSeverity';
import IncidentState from './IncidentState';
import Label from './Label';
import Monitor from './Monitor';
import MonitorStatus from './MonitorStatus';
import OnCallDutyPolicy from './OnCallDutyPolicy';
import Project from './Project';
import User from './User';
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import AccessControlColumn from 'Common/Types/Database/AccessControlColumn';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import ColumnType from 'Common/Types/Database/ColumnType';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import EnableDocumentation from 'Common/Types/Database/EnableDocumentation';
import EnableWorkflow from 'Common/Types/Database/EnableWorkflow';
import SlugifyColumn from 'Common/Types/Database/SlugifyColumn';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import IconProp from 'Common/Types/Icon/IconProp';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';

@EnableDocumentation()
@AccessControlColumn('labels')
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CreateIncidentTemplate,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ReadIncidentTemplate,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.DeleteIncidentTemplate,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.EditIncidentTemplate,
    ],
})
@CrudApiEndpoint(new Route('/incident-templates'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'IncidentTemplate',
})
@EnableWorkflow({
    create: true,
    delete: true,
    update: true,
    read: true,
})
@TableMetadata({
    tableName: 'IncidentTemplate',
    singularName: 'Incident Template',
    pluralName: 'Incident Templates',
    icon: IconProp.Alert,
    tableDescription: 'Manage incident templates for your project',
})
export default class IncidentTemplate extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
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
        () => {
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @Index()
    @TableColumn({
        required: true,
        type: TableColumnType.LongText,
        canReadOnRelationQuery: true,
        title: 'Title',
        description: 'Title of this incident',
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
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnRelationQuery: true,
        title: 'Name',
        description: 'Name of the Incident Template',
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
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongText,
        canReadOnRelationQuery: true,
        title: 'Template Description',
        description: 'Description of the Incident Template',
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
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.Markdown,
        title: 'Description',
        description:
            'Short description of this incident. This is in markdown and will be visible on the status page.',
    })
    @Column({
        nullable: true,
        type: ColumnType.Markdown,
    })
    public description?: string = undefined;

    @Index()
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        unique: true,
        type: TableColumnType.Slug,
        title: 'Slug',
        description: 'Friendly globally unique name for your object',
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
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
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
        () => {
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
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
        () => {
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
        read: [],
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: Monitor,
        title: 'Monitors',
        description: 'List of monitors affected by this incident',
    })
    @ManyToMany(
        () => {
            return Monitor;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'IncidentTemplateMonitor',
        inverseJoinColumn: {
            name: 'monitorId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'incidentTemplateId',
            referencedColumnName: '_id',
        },
    })
    public monitors?: Array<Monitor> = undefined; // monitors affected by this incident.

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: Monitor,
        title: 'On-Call Duty Policies',
        description: 'List of on-call duty policy affected by this incident.',
    })
    @ManyToMany(
        () => {
            return OnCallDutyPolicy;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'IncidentTemplateOnCallDutyPolicy',
        inverseJoinColumn: {
            name: 'onCallDutyPolicyId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'incidentTemplateId',
            referencedColumnName: '_id',
        },
    })
    public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined; // monitors affected by this incident.

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: Label,
        title: 'Labels',
        description:
            'Relation to Labels Array where this object is categorized in.',
    })
    @ManyToMany(
        () => {
            return Label;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'IncidentTemplateLabel',
        inverseJoinColumn: {
            name: 'labelId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'incidentTemplateId',
            referencedColumnName: '_id',
        },
    })
    public labels?: Array<Label> = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        manyToOneRelationColumn: 'incidentSeverityId',
        type: TableColumnType.Entity,
        modelType: IncidentSeverity,
        title: 'Incident Severity',
        description:
            'How severe is this incident. Is it critical? or a minor incident?. This is related to Incident Severity.',
    })
    @ManyToOne(
        () => {
            return IncidentSeverity;
        },
        {
            eager: false,
            nullable: true,
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'incidentSeverityId' })
    public incidentSeverity?: IncidentSeverity = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        title: 'Incident Severity ID',
        description: 'Incident Severity ID',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public incidentSeverityId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'changeMonitorStatusToId',
        type: TableColumnType.Entity,
        modelType: IncidentState,
        title: 'Change Monitor Status To',
        description:
            'Relation to Monitor Status Object. All monitors connected to this incident will be changed to this status when the incident is created.',
    })
    @ManyToOne(
        () => {
            return MonitorStatus;
        },
        {
            eager: false,
            nullable: true,
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'changeMonitorStatusToId' })
    public changeMonitorStatusTo?: MonitorStatus = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: false,
        title: 'Change Monitor Status To ID',
        description:
            'Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the incident is created.',
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
            Permission.CreateIncidentTemplate,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadIncidentTemplate,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditIncidentTemplate,
        ],
    })
    @TableColumn({
        isDefaultValueColumn: false,
        required: false,
        type: TableColumnType.JSON,
        title: 'Custom Fields',
        description: 'Custom Fields on this resource.',
    })
    @Column({
        type: ColumnType.JSON,
        nullable: true,
    })
    public customFields?: JSONObject = undefined;
}
