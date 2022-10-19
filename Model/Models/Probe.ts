import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import ColumnType from 'Common/Types/Database/ColumnType';
import Project from './Project';
import ObjectID from 'Common/Types/ObjectID';
import Version from 'Common/Types/Version';
import SlugifyColumn from 'Common/Types/Database/SlugifyColumn';
import URL from 'Common/Types/API/URL';
import User from './User';
import TableColumn from 'Common/Types/Database/TableColumn';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import Route from 'Common/Types/API/Route';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import TenantColumn from 'Common/Types/Database/TenantColumn';
import Permission from 'Common/Types/Permission';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import IsPermissionsIf from 'Common/Types/Database/IsPermissionsIf';
import SingularPluralName from 'Common/Types/Database/SingularPluralName';

@IsPermissionsIf(Permission.Public, 'projectId', null)
@TenantColumn('projectId')
@CrudApiEndpoint(new Route('/probe'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Probe',
})
@SingularPluralName('Probe', 'Probes')
@TableAccessControl({
    create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
    read: [Permission.Public],
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
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public key?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.Public],
        update: [Permission.ProjectOwner, Permission.CanEditProjectProbe],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.Name,
        canReadOnPopulate: true,
    })
    @Column({
        nullable: false,
        type: ColumnType.Name,
        length: ColumnLength.Name,
    })
    public name?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.Public],
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
        read: [Permission.Public],
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
        read: [Permission.Public],
        update: [],
    })
    @TableColumn({ required: true, type: TableColumnType.Version })
    @Column({
        nullable: false,
        type: ColumnType.Version,
        length: ColumnLength.Version,
        transformer: Version.getDatabaseTransformer(),
    })
    public probeVersion?: Version = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.Public],
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
        read: [Permission.Public],
        update: [Permission.ProjectOwner, Permission.CanEditProjectProbe],
    })
    @TableColumn({ type: TableColumnType.ShortURL })
    @Column({
        type: ColumnType.ShortURL,
        nullable: true,
        length: ColumnLength.ShortURL,
        transformer: URL.getDatabaseTransformer(),
    })
    public iconUrl?: URL = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.Public],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Entity,
        required: false,
        modelType: Project,
    })
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
    public project?: Project = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.Public],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        required: true,
        canReadOnPopulate: true,
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Entity, modelType: User })
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
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID = undefined;

    @ColumnAccessControl({
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectOwner],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Entity, modelType: User })
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
        create: [Permission.ProjectOwner, Permission.CanCreateProjectProbe],
        read: [Permission.ProjectOwner],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public createdByUserId?: ObjectID = undefined;
}
