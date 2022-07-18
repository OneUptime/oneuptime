import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from './BaseModel';
import ColumnLength from '../Types/Database/ColumnLength';
import ColumnType from '../Types/Database/ColumnType';
import Project from './Project';
import ObjectID from '../Types/ObjectID';
import Version from '../Types/Version';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import URL from '../Types/API/URL';
import User from './User';
import TableColumn from '../Types/Database/TableColumn';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import ProjectColumn from '../Types/Database/ProjectColumn';
import Permission from '../Types/Permission';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';
import IsPermissionsIf from '../Types/Database/IsPermissionsIf';
import EntityName from '../Types/Database/EntityName';

@IsPermissionsIf(Permission.Public, 'projectId', null)
@ProjectColumn('projectId')
@CrudApiEndpoint(new Route('/probe'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Probe',
})
@EntityName("Probe", "Probes")
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
    read: [Permission.ProjectMember, Permission.Public],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProjectProbe],
    update: [Permission.ProjectOwner, Permission.CanEditProjectProbe],
})
export default class Probe extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [],
        update: [],
    })
    @TableColumn({
        required: true,
        unique: true,
        type: TableColumnType.ObjectID,
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        unique: true,
        length: ColumnLength.ObjectID,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public key?: ObjectID;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectMember, Permission.Public],
        update: [Permission.ProjectOwner, Permission.CanEditProjectProbe],
    })
    @TableColumn({ required: true, type: TableColumnType.Name })
    @Column({
        nullable: false,
        type: ColumnType.Name,
        length: ColumnLength.Name,
    })
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectMember, Permission.Public],
        update: [Permission.ProjectOwner, Permission.CanEditProjectProbe],
    })
    @TableColumn({ required: false, type: TableColumnType.Name })
    @Column({
        nullable: true,
        type: ColumnType.Name,
        length: ColumnLength.Name,
    })
    public description?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember, Permission.Public],
        update: [],
    })
    @TableColumn({ required: true, unique: true, type: TableColumnType.Slug })
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
    })
    public slug?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember, Permission.Public],
        update: [],
    })
    @TableColumn({ required: true, type: TableColumnType.Version })
    @Column({
        nullable: false,
        type: ColumnType.Version,
        length: ColumnLength.Version,
        transformer: Version.getDatabaseTransformer(),
    })
    public probeVersion?: Version;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember, Permission.Public],
        update: [],
    })
    @TableColumn({
        isDefaultValueColumn: true,
        required: true,
        type: TableColumnType.Date,
    })
    @Column({
        nullable: false,
        default: () => {
            return 'CURRENT_TIMESTAMP';
        },
        type: ColumnType.Date,
    })
    public lastAlive?: Date = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectMember, Permission.Public],
        update: [Permission.ProjectOwner, Permission.CanEditProjectProbe],
    })
    @TableColumn({ type: TableColumnType.ShortURL })
    @Column({
        type: ColumnType.ShortURL,
        nullable: true,
        length: ColumnLength.ShortURL,
        transformer: URL.getDatabaseTransformer(),
    })
    public iconUrl?: URL;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectMember, Permission.Public],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Entity, required: false })
    @ManyToOne(
        (_type: string) => {
            return Project;
        },
        {
            cascade: false,
            eager: false,
            nullable: true,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'projectId' })
    public project?: Project;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectMember, Permission.Public],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Entity })
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
    public deletedByUser?: User;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectOwner, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
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
    public createdByUser?: User;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectOwner, Permission.ProjectMember],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public createdByUserId?: ObjectID;
}
