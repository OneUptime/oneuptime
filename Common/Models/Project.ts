import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
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

@CrudApiEndpoint(new Route('/project'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Project',
})
export default class Model extends BaseModel {
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public name?: string = undefined;

    @TableColumn({ required: true, unique: true, type: TableColumnType.Slug })
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
    })
    public slug?: string = undefined;

    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderPlanId?: string = undefined;

    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderSubscriptionId?: string = undefined;

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

    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public createdByUserId?: ObjectID;

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

    @TableColumn({ type: TableColumnType.SmallPositiveNumber })
    @Column({
        type: ColumnType.SmallPositiveNumber,
        nullable: true,
        unique: false,
    })
    public unpaidSubscriptionNotificationCount?: PositiveNumber;

    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentFailedDate?: Date = undefined;

    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentSuccessDate?: Date = undefined;
}
