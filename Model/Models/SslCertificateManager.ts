import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'SslCertificateManager',
})
export default class Model extends BaseModel {
    @Column()
    public subject?: string = undefined;

    @Column()
    public altnames?: Array<string>;

    @Column()
    public renewAt?: Date = undefined;

    @Column()
    public expiresAt?: Date = undefined;

    @Column()
    public issuedAt?: Date = undefined;
}
