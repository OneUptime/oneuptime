import Project from './Project';
import ScheduledMaintenance from './ScheduledMaintenance';
import User from './User';
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import CanAccessIfCanReadOn from 'Common/Types/Database/CanAccessIfCanReadOn';
import ColumnType from 'Common/Types/Database/ColumnType';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import EnableDocumentation from 'Common/Types/Database/EnableDocumentation';
import EnableWorkflow from 'Common/Types/Database/EnableWorkflow';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@EnableDocumentation()
@CanAccessIfCanReadOn('scheduledMaintenance')
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ReadScheduledMaintenancePublicNote,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.DeleteScheduledMaintenancePublicNote,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.EditScheduledMaintenancePublicNote,
    ],
})
@EnableWorkflow({
    create: true,
    delete: true,
    update: true,
    read: true,
})
@CrudApiEndpoint(new Route('/scheduled-maintenance-public-note'))
@Entity({
    name: 'ScheduledMaintenancePublicNote',
})
@TableMetadata({
    tableName: 'ScheduledMaintenancePublicNote',
    singularName: 'Scheduled Event Public Note',
    pluralName: 'Scheduled Event Public Notes',
    icon: IconProp.Public,
    tableDescription: 'Manage public notes for your scheduled event',
})
export default class ScheduledMaintenancePublicNote extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
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
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'scheduledMaintenanceId',
        type: TableColumnType.Entity,
        modelType: ScheduledMaintenance,
        title: 'Scheduled Maintenance',
        description:
            'Relation to Scheduled Maintenance Event this resource belongs to',
    })
    @ManyToOne(
        (_type: string) => {
            return ScheduledMaintenance;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'scheduledMaintenanceId' })
    public scheduledMaintenance?: ScheduledMaintenance = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        title: 'Scheduled Maintenance ID',
        description: 'ID of Scheduled Maintenance this resource belongs to',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public scheduledMaintenanceId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
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
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditScheduledMaintenancePublicNote,
        ],
    })
    @TableColumn({
        type: TableColumnType.Markdown,
        title: 'Note',
        description: 'Notes in markdown',
    })
    @Column({
        type: ColumnType.Markdown,
        nullable: false,
        unique: false,
    })
    public note?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
        ],
        update: [],
    })
    @TableColumn({
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        title: 'Are subscribers notified?',
        description: 'Are subscribers notified about this note?',
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isStatusPageSubscribersNotifiedOnNoteCreated?: boolean = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
        ],
        update: [],
    })
    @TableColumn({
        isDefaultValueColumn: true,
        type: TableColumnType.Boolean,
        title: 'Should subscribers be notified?',
        description: 'Should subscribers be notified about this note?',
    })
    @Column({
        type: ColumnType.Boolean,
        default: true,
    })
    public shouldStatusPageSubscribersBeNotifiedOnNoteCreated?: boolean = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.Boolean,
        required: true,
        isDefaultValueColumn: true,
        title: 'Are Owners Notified',
        description: 'Are owners notified of this resource ownership?',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        default: false,
    })
    public isOwnerNotified?: boolean = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateScheduledMaintenancePublicNote,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadScheduledMaintenancePublicNote,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.EditScheduledMaintenancePublicNote,
        ],
    })
    @TableColumn({
        title: 'Note Posted At',
        description: 'Date and time when the note was posted',
        type: TableColumnType.Date,
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public postedAt?: Date = undefined;
}
