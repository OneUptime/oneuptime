import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from './BaseModel';
import RequiredColumn from '../Types/Database/RequiredColumnDecorator';
import UniqueColumn from '../Types/Database/UniqueColumnDecorator';
import User from './User';
import Project from './Project';
import ColumnType from '../Types/Database/ColumnType';
import PositiveNumber from '../Types/PositiveNumber';
import ObjectID from '../Types/ObjectID';
import ColumnLength from '../Types/Database/ColumnLength';

@Entity({
    name: 'Project',
})
export default class Model extends BaseModel {
    @RequiredColumn()
    @Column({
        nullable: false,
        type: ColumnType.Name,
        length: ColumnLength.Name,
    })
    public name!: string;

    @RequiredColumn()
    @UniqueColumn()
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
    })
    public slug!: string;

    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderPlanId?: string;

    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderSubscriptionId?: string;

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
    @JoinColumn({ name: 'parentProjectId' })
    public parentProject?: Project;

    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public parentProjectId?: ObjectID;

    @Column({
        type: ColumnType.SmallPositiveNumber,
        nullable: false,
        unique: false,
        default: 1,
    })
    public numberOfLicensesIssued!: PositiveNumber;

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

    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public createdByUserId?: ObjectID;

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

    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
        default: ObjectID.generate(),
    })
    public apiKey!: ObjectID;

    @RequiredColumn()
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public alertsEnabled!: boolean;

    @RequiredColumn()
    @Column({
        type: ColumnType.SmallPositiveNumber,
        nullable: false,
        unique: false,
        default: 0,
    })
    public alertAccountBalance!: number;

    @RequiredColumn()
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isBlocked!: boolean;

    @Column({
        type: ColumnType.SmallPositiveNumber,
        nullable: true,
        unique: false,
    })
    public unpaidSubscriptionNotificationCount!: PositiveNumber;

    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentFailedDate?: Date;

    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentSuccessDate?: Date;
}
