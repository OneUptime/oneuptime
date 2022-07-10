import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import TableColumn from '../Types/Database/TableColumn';
import ColumnType from '../Types/Database/ColumnType';
import ObjectID from '../Types/ObjectID';
import ColumnLength from '../Types/Database/ColumnLength';
import Permission from '../Types/Permission';

@CrudApiEndpoint(new Route('/api-key'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'ApiKey',
})
export default class ApiKey extends BaseModel {
    @TableColumn({
        manyToOneRelationColumn: 'projectId',
        type: TableColumnType.Entity,
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
    public project?: Project;

    @Index()
    @TableColumn({ type: TableColumnType.ObjectID })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID;

    @Index()
    @TableColumn({ required: true, type: TableColumnType.ShortText })
    @Column({
        nullable: false,
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
    })
    public name?: string = undefined;

    @TableColumn({ required: false, type: TableColumnType.LongText })
    @Column({
        nullable: true,
        type: ColumnType.LongText,
        length: ColumnLength.LongText,
    })
    public description?: string = undefined;

    @TableColumn({ required: true, unique: true, type: TableColumnType.Slug })
    @Column({
        nullable: false,
        type: ColumnType.Slug,
        length: ColumnLength.Slug,
    })
    public slug?: string = undefined;

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

    @TableColumn({ title: 'Permissions', type: TableColumnType.Array })
    @Column({
        type: ColumnType.Array,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public permissions?: Array<Permission> = undefined;

    @TableColumn({ title: 'Expires At', type: TableColumnType.Date })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public expiresAt?: Date = undefined;

    @Index()
    @TableColumn({ type: TableColumnType.ObjectID, isDefaultValueColumn: true })
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
        default: ObjectID.generate(),
    })
    public apiKey?: ObjectID;
}
