import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: 'GitCredential',
})
export default class GitCredential extends BaseModel {
    @Column()
    public gitUsername!: string;

    @Column()
    public gitPassword!: string;

    @Column()
    public sshTitle!: string;

    @Column()
    public sshPrivateKey!: string;

    @Column()
    public iv!: Buffer;

    @Index()
    @Column()
    public project!: Project;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
