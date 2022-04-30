import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Project from './Project';

@Entity({
    name: 'DomainVerificationToken',
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
    @Index()
    @Column()
    public domain!: string; // The main or base domain eg oneuptime.com

    @Column()
    public verificationToken!: string;

    @Column()
    public verified!: boolean;

    @Column()
    public verifiedAt!: Date;

    @Column()
    public project!: Project;
}
