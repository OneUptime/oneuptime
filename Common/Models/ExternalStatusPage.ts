import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';

@Entity({
    name: 'ExternalStatusPage',
})
export default class ExternalStatusPage extends BaseModel {
    @Column()
    public name? : string = undefined;

    @Column()
    public url?: URL;

    @Column()
    public description? : string = undefined;

    @Column()
    public statusPage?: StatusPage;
    @Column()
    public project?: Project;

    @Column()
    public deletedByUser?: User;

    @Column()
    public createdByUser?: User;
}
