import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
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
    project!: Project;

    @Column()
    name!: string;

    @Column()
    color!: string;

    @Column()
    createdByUser!: User;

    @Column()
    deletedByUser!: User;
}
