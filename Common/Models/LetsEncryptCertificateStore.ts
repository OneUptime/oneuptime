import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';

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
    public certificateId!: string;

    @Column()
    public privateKeyPem!: string;

    @Column()
    public privateKeyJwk!: string;

    @Column()
    public publicKeyPem!: string;

    @Column()
    public publicKeyJwk!: string;

    @Column()
    public key!: string;
}
