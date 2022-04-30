import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';

@Entity({
    name: 'SslCertificate',
})
export default class SslCertificate extends BaseModel {
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
    public cert!: string;

    @Column()
    public chain!: string;

    @Column()
    public privKey!: string;

    @Column()
    public subject!: string;

    @Column()
    public altnames!: string;

    @Column()
    public issuedAt!: Date;

    @Column()
    public expiresAt!: Date;
}
