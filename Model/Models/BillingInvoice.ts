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
import ColumnLength from 'Common/Types/Database/ColumnLength';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import Permission from 'Common/Types/Permission';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import AllowAccessIfSubscriptionIsUnpaid from 'Common/Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid';
import URL from 'Common/Types/API/URL';

@AllowAccessIfSubscriptionIsUnpaid()
@TenantColumn('projectId')
@TableAccessControl({
    create: [],
    read: [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CanReadInvoices,
    ],
    delete: [],
    update: [],
})
@CrudApiEndpoint(new Route('/billing-invoices'))
@TableMetadata({
    tableName: 'BillingInvoice',
    singularName: 'Invoice',
    pluralName: 'Invoices',
    icon: IconProp.Invoice,
    tableDescription: 'Manage invoices for your project',
})
@Entity({
    name: 'BillingInvoice',
})
export default class BillingInvoice extends BaseModel {
    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'projectId',
        type: TableColumnType.Entity,
        modelType: Project,
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
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @Index()
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnPopulate: true,
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
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'createdByUserId',
        type: TableColumnType.Entity,
        modelType: User,
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
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
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
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'deletedByUserId',
        type: TableColumnType.Entity,
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
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
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
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Number })
    @Column({
        type: ColumnType.Decimal,
        nullable: false,
        unique: false,
    })
    public amount?: number = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
        unique: false,
    })
    public currencyCode?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.LongURL })
    @Column({
        type: ColumnType.LongURL,
        nullable: false,
        unique: false,
        transformer: URL.getDatabaseTransformer(),
    })
    public downloadableLink?: URL = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
        unique: false,
    })
    public status?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
        unique: false,
    })
    public paymentProviderCustomerId?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderSubscriptionId?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.CanReadInvoices,
        ],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: false,
        unique: false,
    })
    public paymentProviderInvoiceId?: string = undefined;
}
