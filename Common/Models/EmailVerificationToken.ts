import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import ColumnType from '../Types/Database/ColumnType';
import ObjectID from '../Types/ObjectID';
import BaseModel from './BaseModel';
import RequiredColumn from '../Types/Database/RequiredColumn';
import UniqueColumn from '../Types/Database/UniqueColumn';

import User from './User';
import ColumnLength from '../Types/Database/ColumnLength';
import Email from '../Types/Email';

@Entity({
    name: 'EmailVerificationToken',
})
export default class EmailVerificationToken extends BaseModel {
    @RequiredColumn()
    @ManyToOne(
        (_type: string) => {
            return User;
        },
        {
            eager: false,
            nullable: false,
            onDelete: 'CASCADE',
            orphanedRowAction: 'nullify',
        }
    )
    @JoinColumn({ name: 'userId' })
    public user?: User;

    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public userId?: ObjectID;

    @Column({
        type: ColumnType.Email,
        length: ColumnLength.Email,
        nullable: false,
        transformer: Email.getDatabaseTransformer(),
    })
    public email?:Email = undefined;

    @Index()
    @RequiredColumn()
    @UniqueColumn()
    @Column({
        type: ColumnType.ObjectID,
        nullable: false,
        unique: true,
        length: ColumnLength.ObjectID,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public token?: ObjectID;

    @RequiredColumn()
    @Column({
        nullable: false,
        type: ColumnType.Date,
    })
    public expires?: Date = undefined;
}
