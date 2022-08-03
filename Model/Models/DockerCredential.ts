import { Column, Entity, Index } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'DockerCredential',
})
export default class DockerCredential extends BaseModel {
    @Column()
    public dockerRegistryUrl?: URL;

    @Column()
    public dockerUsername?: string = undefined;

    @Column()
    public dockerPassword?: string = undefined;

    @Column()
    public iv?: Buffer;

    @Index()
    @Column()
    public project?: Project;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
