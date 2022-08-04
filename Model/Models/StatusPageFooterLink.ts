import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import StatusPage from './StatusPage';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public statusPage?: StatusPage;

    @Column()
    public title?: string = undefined;

    @Column()
    public url?: string = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
