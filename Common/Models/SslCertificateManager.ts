import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';


@Entity({
    name: 'SslCertificateManager',
})
export default class Model extends BaseModel {
    
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
