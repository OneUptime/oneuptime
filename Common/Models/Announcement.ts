import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';

@Entity({
    name: 'Announcement',
})
export default class Announcement extends BaseModel {
    @Column()
    public statusPage?: StatusPage;

    @Column()
    public project?: Project;

    @Column()
    public slug? : string = undefined;

    @Column()
    public hideAnnouncement?: boolean = undefined;

    @Column()
    public deletedByUser?: User;

    @Column()
    public createdByUser?: User;

    @Column()
    public name? : string = undefined;

    @Column()
    public description? : string = undefined;

    @Column()
    public resolved?: boolean = undefined;
}
