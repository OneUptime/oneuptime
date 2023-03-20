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
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TableColumn from 'Common/Types/Database/TableColumn';
import ColumnType from 'Common/Types/Database/ColumnType';
import ObjectID from 'Common/Types/ObjectID';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import UniqueColumnBy from 'Common/Types/Database/UniqueColumnBy';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import BaseModel from 'Common/Models/BaseModel';
import URL from 'Common/Types/API/URL';
import TableBillingAccessControl from 'Common/Types/Database/AccessControl/TableBillingAccessControl';
import { PlanSelect } from 'Common/Types/Billing/SubscriptionPlan';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import SignatureMethod from 'Common/Types/SSO/SignatureMethod';
import DigestMethod from 'Common/Types/SSO/DigestMethod';
import Team from './Team';
import MultiTenentQueryAllowed from 'Common/Types/Database/MultiTenentQueryAllowed';

@MultiTenentQueryAllowed(true)
@TableBillingAccessControl({
    create: PlanSelect.Scale,
    read: PlanSelect.Scale,
    update: PlanSelect.Scale,
    delete: PlanSelect.Scale,
})
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanCreateProjectSSO,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectUser,
        Permission.UnAuthorizedSsoUser,
        Permission.ProjectAdmin,
        Permission.ProjectUser,
        Permission.UnAuthorizedSsoUser,
        Permission.CanReadProjectSSO,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanDeleteProjectSSO,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanEditProjectSSO,
    ],
})
@CrudApiEndpoint(new Route('/project-sso'))
@TableMetadata({
    tableName: 'ProjectSSO',
    singularName: 'SSO',
    pluralName: 'SSO',
    icon: IconProp.Lock,
    tableDescription: 'Manage SSO for your project',
})
@Entity({
    name: 'ProjectSSO',
})
export default class ProjectSSO extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
            Permission.CanReadProjectSSO,
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
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
            Permission.CanReadProjectSSO,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnPopulate: true,
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
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
            Permission.CanReadProjectSSO,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnPopulate: true,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
            Permission.CanReadProjectSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongText,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.LongText,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CanReadProjectSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public signatureMethod?: SignatureMethod = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CanReadProjectSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public digestMethod?: DigestMethod = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSSO,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongURL,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.LongURL,
        transformer: URL.getDatabaseTransformer(),
    })
    @UniqueColumnBy('projectId')
    public signOnURL?: URL = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadProjectSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: Team,
    })
    @ManyToMany(
        () => {
            return Team;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'ProjectSsoTeam',
        inverseJoinColumn: {
            name: 'teamId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'projectSsoId',
            referencedColumnName: '_id',
        },
    })
    public teams?: Array<Team> = undefined; // teams that teammember should be added to when they sign into SSO for the first time.

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CanReadProjectSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongURL,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.LongURL,
        transformer: URL.getDatabaseTransformer(),
    })
    public issuerURL?: URL = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CanReadProjectSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongText,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.LongText,
    })
    public publicCertificate?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CanReadProjectSSO,
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
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CanReadProjectSSO,
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

            Permission.CanReadProjectSSO,
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

            Permission.CanReadProjectSSO,
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
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.UnAuthorizedSsoUser,
            Permission.CanReadProjectSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanEditProjectSSO,
        ],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isEnabled?: boolean = undefined;

    // Is this integration tested?
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanCreateProjectSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.CanReadProjectSSO,
        ],
        update: [],
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isTested?: boolean = undefined;
}
