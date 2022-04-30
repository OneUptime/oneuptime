import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';

@Entity({
    name: 'DockerCredential',
})
export default class DockerCredential extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public dockerRegistryUrl!: URL;

    @Column()
    public dockerUsername!: string;

    @Column()
    public dockerPassword!: string;

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
