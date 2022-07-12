import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
} from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import ColumnType from '../Types/Database/ColumnType';
import PositiveNumber from '../Types/PositiveNumber';
import ObjectID from '../Types/ObjectID';
import ColumnLength from '../Types/Database/ColumnLength';
import TableColumn from '../Types/Database/TableColumn';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import Permission from '../Types/Permission';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';
import ProjectColumn from '../Types/Database/ProjectColumn';

@TableAccessControl({
    create: [Permission.User],
    read: [Permission.ProjectMember],
    delete: [Permission.ProjectOwner, Permission.CanDeleteProject],
    update: [
        Permission.ProjectOwner,
        Permission.CanManageProjectBilling,
        Permission.CanUpdateProject,
    ],
})
@CrudApiEndpoint(new Route('/project'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Project',
})
@ProjectColumn('_id')
export default class Model extends BaseModel {
    @ColumnAccessControl({
        create: [Permission.User],
        read: [Permission.ProjectMember],
        update: [
            Permission.ProjectOwner,
            Permission.CanManageProjectBilling,
            Permission.CanUpdateProject,
        ],
    })
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public name?: string = undefined;

    @Index()
    @ColumnAccessControl({
        create: [Permission.User],
        read: [Permission.ProjectMember],
        update: [],
    })
    @TableColumn({ required: true, unique: true, type: TableColumnType.Slug })
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
        unique: true,
    })
    public slug?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.User],
        read: [Permission.ProjectMember],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderPlanId?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.User],
        read: [Permission.ProjectMember],
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
        read: [Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.SmallPositiveNumber,
        isDefaultValueColumn: true,
    })
    @Column({
        type: ColumnType.SmallPositiveNumber,
        nullable: false,
        unique: false,
        default: 1,
    })
    public numberOfLicensesIssued?: PositiveNumber;

    @ColumnAccessControl({
        create: [Permission.User],
        read: [Permission.ProjectMember],
        update: [],
    })
    @TableColumn({
        manyToOneRelationColumn: 'createdByUserId',
        type: TableColumnType.Entity,
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
    public createdByUser?: User;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember],
        update: [],
    })
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public createdByUserId?: ObjectID;

    @ColumnAccessControl({
        create: [],
        read: [],
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
    public deletedByUser?: User;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectMember],
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
        create: [],
        read: [Permission.ProjectMember],
        update: [
            Permission.ProjectOwner,
            Permission.CanManageProjectBilling,
            Permission.CanUpdateProject,
        ],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.Boolean,
        isDefaultValueColumn: true,
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public alertsEnabled?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.ProjectOwner, Permission.CanManageProjectBilling],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.SmallPositiveNumber,
        isDefaultValueColumn: true,
    })
    @Column({
        type: ColumnType.SmallPositiveNumber,
        nullable: false,
        unique: false,
        default: 0,
    })
    public alertAccountBalance?: number;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        required: true,
        type: TableColumnType.Boolean,
        isDefaultValueColumn: true,
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isBlocked?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.SmallPositiveNumber })
    @Column({
        type: ColumnType.SmallPositiveNumber,
        nullable: true,
        unique: false,
    })
    public unpaidSubscriptionNotificationCount?: PositiveNumber;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentFailedDate?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentSuccessDate?: Date = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({ type: TableColumnType.Array })
    @ManyToMany(() => {
        return User;
    })
    @JoinTable()
    public users?: Array<User> = undefined;
}
