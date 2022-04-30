import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';

@Entity({
    name: 'ExternalStatusPage',
})
export default class ExternalStatusPage extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public name!: string;

    @Column()
    public url!: URL;

    @Column()
    public description!: string;

    @Column()
    public statusPage!: StatusPage;
    @Column()
    public project!: Project;

    @Column()
    public deletedByUser!: User;

    @Column()
    public createdByUser!: User;
}
