import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';


@Entity({
    name: 'SslCertificate',
})
export default class SslCertificate extends BaseModel {
    
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
