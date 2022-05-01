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
    public statusPage!: StatusPage;

    @Column()
    public project!: Project;

    @Column()
    public slug!: string;

    @Column()
    public hideAnnouncement!: boolean;

    @Column()
    public deletedByUser!: User;

    @Column()
    public createdByUser!: User;

    @Column()
    public name!: string;

    @Column()
    public description!: string;

    @Column()
    public resolved!: boolean;
}
