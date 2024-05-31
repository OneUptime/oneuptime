import Project from './Project';
import StatusPage from './StatusPage';
import User from './User';
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import URL from 'Common/Types/API/URL';
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
import UniqueColumnBy from 'Common/Types/Database/UniqueColumnBy';
import IconProp from 'Common/Types/Icon/IconProp';
import ObjectID from 'Common/Types/ObjectID';
import Permission from 'Common/Types/Permission';
import DigestMethod from 'Common/Types/SSO/DigestMethod';
import SignatureMethod from 'Common/Types/SSO/SignatureMethod';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

@EnableDocumentation()
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
        Permission.CreateStatusPageSSO,
    ],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectUser,
        Permission.Public,
        Permission.ProjectAdmin,
        Permission.ReadStatusPageSSO,
    ],
    delete: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.DeleteStatusPageSSO,
    ],
    update: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.EditStatusPageSSO,
    ],
})
@CrudApiEndpoint(new Route('/status-page-sso'))
@TableMetadata({
    tableName: 'StatusPageSSO',
    singularName: 'Status Page SSO',
    pluralName: 'Status Page SSO',
    icon: IconProp.Lock,
    tableDescription: 'Configure Status Page SSO',
})
@Entity({
    name: 'StatusPageSSO',
})
export default class StatusPageSSO extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.Public,
            Permission.ReadStatusPageSSO,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.Public,
            Permission.ReadStatusPageSSO,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadStatusPageSSO,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'statusPageId',
        type: TableColumnType.Entity,
        modelType: StatusPage,
        title: 'Status Page',
        description:
            'Relation to Status Page Resource in which this object belongs',
    })
    @ManyToOne(
        (_type: string) => {
            return StatusPage;
        },
        {
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'statusPageId' })
    public statusPage?: StatusPage = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.ReadStatusPageSSO,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        title: 'Status Page ID',
        description:
            'ID of your Status Page resource where this object belongs',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public statusPageId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.Public,
            Permission.ReadStatusPageSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
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
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.Public,
            Permission.ReadStatusPageSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongText,
        canReadOnRelationQuery: true,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadStatusPageSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnRelationQuery: true,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadStatusPageSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.ShortText,
        canReadOnRelationQuery: true,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ReadStatusPageSSO,
            Permission.ProjectUser,
            Permission.Public,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongURL,
        canReadOnRelationQuery: true,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadStatusPageSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.LongURL,
        canReadOnRelationQuery: true,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadStatusPageSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.VeryLongText,
        canReadOnRelationQuery: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.VeryLongText,
    })
    public publicCertificate?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadStatusPageSSO,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadStatusPageSSO,
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

            Permission.ReadStatusPageSSO,
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

            Permission.ReadStatusPageSSO,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectUser,
            Permission.Public,
            Permission.ReadStatusPageSSO,
        ],
        update: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.EditStatusPageSSO,
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
            Permission.CreateStatusPageSSO,
        ],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,

            Permission.ReadStatusPageSSO,
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
