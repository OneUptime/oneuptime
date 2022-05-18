import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';

@Entity({
    name: 'GitCredential',
})
export default class GitCredential extends BaseModel {
    @Column()
    public gitUsername? : string = undefined;

    @Column()
    public gitPassword? : string = undefined;

    @Column()
    public sshTitle? : string = undefined;

    @Column()
    public sshPrivateKey? : string = undefined;

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
