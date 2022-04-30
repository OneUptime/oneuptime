import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
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
    @Column()
    public user!: User;

    @Column()
    public sentTo!: string;

    @Column()
    public project!: Project;

    @Column()
    public content!: string;

    @Column()
    public deletedByUser!: User;

    @Column()
    public status!: string;

    @Column()
    public error!: string;
}
