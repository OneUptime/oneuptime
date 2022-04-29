import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
       name: "SslCertificate"
})
export default class SslCertificate extends BaseModel {

       @Column()
       certificateId!: string;

       @Column()
       privateKeyPem!: string;

       @Column()
       privateKeyJwk!: string;

       @Column()
       cert!: string;

       @Column()
       chain!: string;

       @Column()
       privKey!: string;

       @Column()
       subject!: string;

       @Column()
       altnames!: string;

       @Column()
       issuedAt!: Date;

       @Column()
       expiresAt!: Date;
}








