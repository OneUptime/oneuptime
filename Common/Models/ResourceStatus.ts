import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';

/*
 * Resource Status like Online, Degraded, Offline.
 * Customers have requested for custom status and we'll give them those.
 */
@Entity({
    name: 'ResourceStatus',
})
export default class ResourceStatus extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public project!: Project;

    @Column()
    public name!: string;

    @Column()
    public color!: string;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
