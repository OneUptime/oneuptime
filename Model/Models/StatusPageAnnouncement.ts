import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';
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
import CanAccessIfCanReadOn from 'Common/Types/Database/CanAccessIfCanReadOn';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';
import StatusPage from './StatusPage';

@TenantColumn('projectId')
@CanAccessIfCanReadOn('statusPages')
@TableAccessControl({
    create: [
        Permission.ProjectOwner,
        Permission.CanCreateStatusPageAnnouncement],
    read: [
        Permission.ProjectOwner,
        Permission.CanReadStatusPageAnnouncement,
        ],
    delete: [
        Permission.ProjectOwner,
        Permission.CanDeleteStatusPageAnnouncement],
    update: [Permission.ProjectOwner, Permission.CanEditStatusPageAnnouncement],
})
@CrudApiEndpoint(new Route('/status-page-announcement'))
@SlugifyColumn('name', 'slug')
@SingularPluralName('Status Page Announcement', 'Status Page Announcements')
@Entity({
    name: 'StatusPageAnnouncement',
})
export default class StatusPageAnnouncement extends BaseModel {
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
            ],
        update: [],
    })
    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, required: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
            ],
        update: [],
    })
    @TableColumn({
        required: false,
        type: TableColumnType.EntityArray,
        modelType: StatusPage,
    })
    @ManyToMany(
        () => {
            return StatusPage;
        },
        { eager: false }
    )
    @JoinTable({
        name: 'AnnouncementStatusPage',
        inverseJoinColumn: {
            name: 'statusPageId',
            referencedColumnName: '_id',
        },
        joinColumn: {
            name: 'announcementId',
            referencedColumnName: '_id',
        },
    })
    public statusPages?: Array<StatusPage> = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
            ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditStatusPageAnnouncement],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public title?: string = undefined;

    @TableColumn({
        title: 'Show At',
        type: TableColumnType.Date,
        required: true,
    })
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
            ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditStatusPageAnnouncement],
    })
    @Column({
        nullable: false,
        type: ColumnType.Date,
    })
    public showAnnouncementAt?: Date = undefined;

    @TableColumn({
        title: 'End At',
        type: TableColumnType.Date,
        required: true,
    })
    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
            ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditStatusPageAnnouncement],
    })
    @Column({
        nullable: false,
        type: ColumnType.Date,
    })
    public endAnnouncementAt?: Date = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
            ],
        update: [
            Permission.ProjectOwner,
            Permission.CanEditStatusPageAnnouncement],
    })
    @TableColumn({ required: true, type: TableColumnType.Markdown })
    @Column({
        nullable: false,
        type: ColumnType.Markdown,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
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
        create: [
            Permission.ProjectOwner,
            Permission.CanCreateStatusPageAnnouncement],
        read: [
            Permission.ProjectOwner,
            Permission.CanReadStatusPageAnnouncement,
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
            Permission.CanReadStatusPageAnnouncement,
            ],
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
}
