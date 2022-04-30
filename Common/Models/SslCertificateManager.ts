import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';

@Entity({
    name: 'SslCertificateManager',
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
    public subject!: string;

    @Column()
    public altnames!: Array<string>;

    @Column()
    public renewAt!: Date;

    @Column()
    public expiresAt!: Date;

    @Column()
    public issuedAt!: Date;
}
