import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import DockerCredential from './DockerCredential';
import Component from './Component';
import ResourceLabel from './ResourceLabel';

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
    public dockerCredential!: DockerCredential;

    @Column()
    public imagePath!: string;

    @Column()
    public imageTags!: string;

    @Column()
    public component!: Component;

    @Column()
    public resourceLabel!: ResourceLabel;

    @Column()
    public deleteAt!: Date;

    @Column()
    public lastScan!: Date;

    @Column()
    public scanned!: boolean;

    @Column()
    public scanning!: boolean;
}
