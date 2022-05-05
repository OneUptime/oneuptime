import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import StatusPage from './StatusPage';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public statusPage!: StatusPage;

    @Column()
    public ipWhitelist!: string;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
