import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Component from './Component';
import ResourceLabel from './ResourceLabel';
import GitCredential from './GitCredential';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public name!: string;

    @Column()
    public slug!: string;

    @Column()
    public gitRepositoryurl!: string;

    @Column()
    public gitCredential!: GitCredential;

    @Column()
    public component!: Component;

    @Column()
    public resourceLabel!: ResourceLabel;

    @Column()
    public lastScan!: Date;

    @Column()
    public scanned!: boolean;

    @Column()
    public scanning!: boolean;
}
