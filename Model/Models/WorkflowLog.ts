import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
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
import BaseModel from 'Common/Models/BaseModel';
import Workflow from './Workflow';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import EnableDocumentation from 'Common/Types/Model/EnableDocumentation';

@EnableDocumentation()
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanCreateWorkflowLog,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CanReadWorkflowLog,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanDeleteWorkflowLog,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanEditWorkflowLog,
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
            Permission.CanReadWorkflowLog,
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
            Permission.CanReadWorkflowLog,
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
            Permission.CanReadWorkflowLog,
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
            Permission.CanReadWorkflowLog,
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
            Permission.CanReadWorkflowLog,
        ],
        update: [],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.LongText,
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
            Permission.CanReadWorkflowLog,
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
            Permission.CanReadWorkflowLog,
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
            Permission.CanReadWorkflowLog,
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
}
