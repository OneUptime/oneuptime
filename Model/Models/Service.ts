import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';
import User from './User';
import Project from './Project';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import SlugifyColumn from 'Common/Types/Database/SlugifyColumn';
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableColumn from 'Common/Types/Database/TableColumn';
import ColumnType from 'Common/Types/Database/ColumnType';
import ObjectID from 'Common/Types/ObjectID';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import UniqueColumnBy from 'Common/Types/Database/UniqueColumnBy';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import EnableWorkflow from 'Common/Types/Database/EnableWorkflow';
import IconProp from 'Common/Types/Icon/IconProp';
import EnableDocumentation from 'Common/Types/Database/EnableDocumentation';
import BaseModel from 'Common/Models/BaseModel';
import AccessControlColumn from 'Common/Types/Database/AccessControlColumn';
import Label from './Label';

@AccessControlColumn('labels')
@EnableDocumentation()
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CanCreateService,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.ProjectMember,
        Permission.CanReadService,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CanDeleteService,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.CanEditService,
    ],
})
@EnableWorkflow({
    create: true,
    delete: true,
    update: true,
    read: true,
})
@CrudApiEndpoint(new Route('/service'))
@SlugifyColumn('name', 'slug')
@TableMetadata({
    tableName: 'Service',
    singularName: 'Service',
    pluralName: 'Services',
    icon: IconProp.SquareStack,
    tableDescription:
        'Organize resources for your project by using labels / tags.',
})
@Entity({
    name: 'Service',
})
export default class Service extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
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
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
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
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanEditService,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnRelationQuery: true,
        title: 'Name',
        description: 'Any friendly name of this object',
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    @UniqueColumnBy('projectId')
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
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
    })
    public slug?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanEditService,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.LongText,
        title: 'Description',
        description: 'Friendly description that will help you remember',
    })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
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
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
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
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
        ],
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
            Permission.ProjectMember,
            Permission.CanReadService,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanEditService,
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
        name: 'ServiceLabel',
        inverseJoinColumn: {
            name: 'labelId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'serviceId',
            referencedColumnName: '_id',
        },
    })
    public labels?: Array<Label> = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanCreateService,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ProjectMember,
            Permission.CanReadService,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CanEditService,
        ],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        isDefaultValueColumn: false,
        title: 'Service Token',
        description: 'Service Token for this service',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public serviceToken?: ObjectID = undefined;
}
