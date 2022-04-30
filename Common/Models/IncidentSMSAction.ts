import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Incident from './Incident';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public incident!: Incident;

    @Column()
    public user!: User; // Which User will perfom this action.

    @Column()
    public number!: string;

    @Column()
    public name!: string;

    @Column()
    public resolved!: boolean;

    @Column()
    public acknowledged!: boolean;

    @Column()
    public deletedByUser!: User;
}
