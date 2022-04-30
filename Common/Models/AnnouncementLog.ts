import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Announcement from './Announcement';
import StatusPage from './StatusPage';
import Project from './Project';

@Entity({
    name: 'AnnouncementLog',
})
export default class AnnouncementLog extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public announcement!: Announcement;

    @Index()
    @Column()
    public project!: Project;

    @Column()
    public statusPage!: StatusPage;

    @Column()
    public startDate!: Date;

    @Column()
    public endDate!: Date;

    @Column()
    public deletedByUser!: User;

    @Column()
    public createdByUser!: User;

    @Column()
    public active!: boolean;
}
