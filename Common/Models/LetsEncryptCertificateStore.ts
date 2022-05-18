import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public certificateId? : string = undefined;

    @Column()
    public privateKeyPem? : string = undefined;

    @Column()
    public privateKeyJwk? : string = undefined;

    @Column()
    public publicKeyPem? : string = undefined;

    @Column()
    public publicKeyJwk? : string = undefined;

    @Column()
    public key? : string = undefined;
}
