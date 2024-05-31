import Project from './Project';
import User from './User';
import Workflow from './Workflow';
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnType from 'Common/Types/Database/ColumnType';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import EnableDocumentation from 'Common/Types/Database/EnableDocumentation';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@EnableDocumentation()
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreateWorkflowLog,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ReadWorkflowLog,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.DeleteWorkflowLog,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditWorkflowLog,
    ],
})
@CrudApiEndpoint(new Route('/workflow-log'))
@Entity({
    name: 'WorkflowLog',
})
@TableMetadata({
    tableName: 'WorkflowLog',
    singularName: 'Workflow Log',
    pluralName: 'Workflow Logs',
    icon: IconProp.Logs,
    tableDescription: 'Logs of the workflows executed',
})
export default class WorkflowLog extends BaseModel {
    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadWorkflowLog,
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
            Permission.ReadWorkflowLog,
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
            Permission.ReadWorkflowLog,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'workflowId',
        type: TableColumnType.Entity,
        modelType: Workflow,
        title: 'Workflow',
        description: 'Workflow this logs belong to',
    })
    @ManyToOne(
        (_type: string) => {
            return Workflow;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'workflowId' })
    public workflow?: Workflow = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadWorkflowLog,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnRelationQuery: true,
        title: 'Workflow ID',
        description: 'ID of Workflow this logs belong to',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public workflowId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadWorkflowLog,
        ],
        update: [],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.VeryLongText,
        title: 'Logs',
        description: 'Logs',
    })
    @Column({
        nullable: false,
        type: ColumnType.VeryLongText,
    })
    public logs?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadWorkflowLog,
        ],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.WorkflowStatus,
        title: 'Workflow Status',
        description: 'Status of this workflow',
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
    })
    public workflowStatus?: WorkflowStatus = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadWorkflowLog,
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Started At',
        description: 'When did this workflow start',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public startedAt?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadWorkflowLog,
        ],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Date,
        title: 'Completed At',
        description: 'When did this workflow complete',
    })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public completedAt?: Date = undefined;

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
}
