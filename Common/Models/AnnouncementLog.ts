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
    public announcement?: Announcement;

    @Index()
    @Column()
    public project?: Project;

    @Column()
    public statusPage?: StatusPage;

    @Column()
    public startDate?: Date = undefined;

    @Column()
    public endDate?: Date = undefined;

    @Column()
    public deletedByUser?: User;

    @Column()
    public createdByUser?: User;

    @Column()
    public active?: boolean = undefined;
}
