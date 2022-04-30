import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';

@Entity({
    name: 'UserVerificationToken',
})
export default class UserVerificationToken extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column({ nullable: false })
    public user!: User;

    @Index()
    @Column({ nullable: false })
    public token!: string;

    @Column({ nullable: false })
    public expires!: Date;
}
