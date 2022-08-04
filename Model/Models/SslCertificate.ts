import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

@Entity({
    name: 'SslCertificate',
})
export default class SslCertificate extends BaseModel {
    @Column()
    public certificateId?: string = undefined;

    @Column()
    public privateKeyPem?: string = undefined;

    @Column()
    public privateKeyJwk?: string = undefined;

    @Column()
    public cert?: string = undefined;

    @Column()
    public chain?: string = undefined;

    @Column()
    public privKey?: string = undefined;

    @Column()
    public subject?: string = undefined;

    @Column()
    public altnames?: string = undefined;

    @Column()
    public issuedAt?: Date = undefined;

    @Column()
    public expiresAt?: Date = undefined;
}
