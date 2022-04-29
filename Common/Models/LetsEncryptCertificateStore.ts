import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
       name: "UserAlerts"
})
export default class Model extends BaseModel {

       @Column()
       certificateId!: string;

       @Column()
       privateKeyPem!: string;

       @Column()
       privateKeyJwk!: string;

       @Column()
       publicKeyPem!: string;

       @Column()
       publicKeyJwk!: string;

       @Column()
       key!: string;
}









