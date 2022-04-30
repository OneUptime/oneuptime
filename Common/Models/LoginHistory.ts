import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
@Entity({
    name: 'LoginHistory',
})
export default class LoginHistory extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public user!: User;

    @Column()
    public ipLocationCity!: string;

    @Column()
    public ipLocationNeighbourhood!: string;

    @Column()
    public ipLocationCountry!: string;

    @Column()
    public browserName!: string;

    @Column()
    public browserVersion!: string;

    @Column()
    public deviceName!: string;

    @Column()
    public loginStatus!: string;
}
