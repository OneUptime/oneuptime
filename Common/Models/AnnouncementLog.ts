import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Announcement from './Announcement';
import StatusPage from './StatusPage';
import Project from './Project';

@Entity({
    name: 'AnnouncementLog',
})
export default class AnnouncementLog extends BaseModel {
    @Column()
    announcement!: Announcement;

    @Index()
    @Column()
    project!: Project;

    @Column()
    statusPage!: StatusPage;

    @Column()
    startDate!: Date;

    @Column()
    endDate!: Date;

    @Column()
    deletedByUser!: User;

    @Column()
    createdByUser!: User;

    @Column()
    active!: boolean;
}
