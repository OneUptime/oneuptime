import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';


@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    
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
