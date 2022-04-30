import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Component from './Component';
import ResourceLabel from './ResourceLabel';

@Entity({
    name: 'ErrorTrackerContainer',
})
export default class ErrorTrackerContainer extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public component!: Component;

    @Column()
    public name!: string;

    @Column()
    public slug!: string;

    @Column()
    public key!: string;

    @Column()
    public showQuickStart!: boolean;

    @Column()
    public resourceLabel!: ResourceLabel;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
