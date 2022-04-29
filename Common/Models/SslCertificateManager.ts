import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
       name: "SslCertificateManager"
})
export default class Model extends BaseModel {

       @Column()
       subject!: string;

       @Column()
       altnames!: Array<string>;

       @Column()
       renewAt!: Date;

       @Column()
       expiresAt!: Date;

       @Column()
       issuedAt!: Date;
}









