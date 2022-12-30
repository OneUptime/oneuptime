import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
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
import TenantColumn from 'Common/Types/Database/TenantColumn';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import StatusPage from './StatusPage';
import Email from 'Common/Types/Email';
import Phone from 'Common/Types/Phone';
import URL from 'Common/Types/API/URL';
import CanAccessIfCanReadOn from 'Common/Types/Database/CanAccessIfCanReadOn';

@CanAccessIfCanReadOn('statusPage')
@TenantColumn('projectId')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.CanCreateStatusPageSubscriber,
        Permission.Public,
    ],
    read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
    delete: [Permission.ProjectOwner, Permission.CanDeleteStatusPageSubscriber],
    update: [Permission.ProjectOwner, Permission.CanEditStatusPageSubscriber],
})
@CrudApiEndpoint(new Route('/status-page-subscriber'))
@SlugifyColumn('name', 'slug')
@SingularPluralName('Status Page Subscriber', 'Status Page Subscribers')
@Entity({
    name: 'StatusPageSubscriber',
})
export default class StatusPageSubscriber extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'statusPageId',
        type: TableColumnType.Entity,
        modelType: StatusPage,
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
            Permission.CanCreateStatusPageSubscriber,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
        update: [],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public statusPageId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
            Permission.Public,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditStatusPageSubscriber,
        ],
    })
    @TableColumn({ required: false, type: TableColumnType.Email })
    @Column({
        nullable: true,
        type: ColumnType.Email,
        length: ColumnLength.Email,
        transformer: Email.getDatabaseTransformer(),
    })
    public subscriberEmail?: Email = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
            Permission.Public,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditStatusPageSubscriber,
        ],
    })
    @TableColumn({ required: false, type: TableColumnType.Phone })
    @Column({
        nullable: true,
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        transformer: Phone.getDatabaseTransformer(),
    })
    public subscriberPhone?: Phone = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
            Permission.Public,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditStatusPageSubscriber,
        ],
    })
    @TableColumn({ required: false, type: TableColumnType.ShortURL })
    @Column({
        nullable: true,
        type: ColumnType.ShortURL,
        transformer: URL.getDatabaseTransformer(),
    })
    public subscriberWebhook?: URL = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageSubscriber,
        ],
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
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
        read: [Permission.ProjectOwner, Permission.CanReadStatusPageSubscriber],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'deletedByUserId',
        type: TableColumnType.ObjectID,
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
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isUnsubscribed?: boolean = undefined;
}
