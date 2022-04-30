import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';

@Entity({
    name: 'GitCredential',
})
export default class GitCredential extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
