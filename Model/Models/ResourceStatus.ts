import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

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
    @Column()
    public project?: Project;

    @Column()
    public name?: string = undefined;

    @Column()
    public color?: string = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
