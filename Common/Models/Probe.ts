import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import BaseModel from './BaseModel';
import ColumnLength from '../Types/Database/ColumnLength';
import ColumnType from '../Types/Database/ColumnType';
import Project from './Project';
import ObjectID from '../Types/ObjectID';
import Version from '../Types/Version';
import RequiredColumn from '../Types/Database/RequiredColumnDecorator';
import UniqueColumn from '../Types/Database/UniqueColumnDecorator';
import SlugifyColumn from '../Types/Database/SlugifyColumnDecorator';
import URL from '../Types/API/URL';
import User from './User';

@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Probe',
})
export default class Probe extends BaseModel {
    @RequiredColumn()
    @UniqueColumn()
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        unique: true,
        length: ColumnLength.ObjectID,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public key!: ObjectID;

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

    @RequiredColumn()
    @Column({
        nullable: false,
        type: ColumnType.Version,
        length: ColumnLength.Version,
        transformer: Version.getDatabaseTransformer(),
    })
    public probeVersion!: Version;

    @RequiredColumn()
    @Column({
        nullable: false,
        default: () => {
            return 'CURRENT_TIMESTAMP';
        },
        type: ColumnType.Date,
    })
    public lastAlive!: Date;

    @Column({
        type: ColumnType.ShortURL,
        nullable: true,
        length: ColumnLength.ShortURL,
        transformer: URL.getDatabaseTransformer(),
    })
    public iconUrl?: URL;

    
     // If this probe is custom to the project and only monitoring reosurces in this project.
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
    
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public projectId?: ObjectID;
     

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
        nullable: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public deletedByUserId?: ObjectID;

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
}
